/**
 * Inicialização do Firebase no servidor (login, banco de dados e arquivos).
 * Lê a chave de serviço da variável FIREBASE_SERVICE_ACCOUNT_KEY (JSON inteiro) e a
 * configuração web pública de FIREBASE_WEB_CONFIG (JSON copiado do console do Firebase).
 */
import type { AuthUser, FileStorage } from './services.ts';
import { createTokenVerifier } from './firebaseToken.ts';

export interface FirebaseBundle {
  db: unknown;
  verifyToken(token: string): Promise<AuthUser>;
  files: FileStorage | undefined;
}

export function readWebConfig(): Record<string, string> | null {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.apiKey === 'string' && typeof parsed.projectId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Diagnóstico sem segredos: confere se a chave do servidor e a configuração web são do
 * MESMO projeto Firebase (senão todo login falha com "sessão expirada") e se a chave abre.
 */
export async function firebaseDiagnostics() {
  let serviceAccountProject: string | null = null;
  let keyKind: string | null = null;
  let keyProblem: string | null = null;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) keyProblem = 'FIREBASE_SERVICE_ACCOUNT_KEY vazia';
  else {
    try {
      const parsed = JSON.parse(raw);
      serviceAccountProject = typeof parsed.project_id === 'string' ? parsed.project_id : null;
      const email = String(parsed.client_email || '');
      keyKind = email.startsWith('firebase-adminsdk') ? 'firebase-adminsdk (correta)' : email ? 'outra conta de serviço (pode não ter permissão de login)' : 'sem client_email';
      if (parsed.type !== 'service_account') keyProblem = 'o JSON não é uma chave de conta de serviço (type deveria ser service_account)';
      else if (!String(parsed.private_key || '').includes('PRIVATE KEY')) keyProblem = 'private_key ausente ou cortada';
    } catch {
      keyProblem = 'não é um JSON válido (copie o arquivo .json inteiro, de { até })';
    }
  }
  const webProject = readWebConfig()?.projectId ?? null;
  let adminInit = 'ok';
  try {
    await initFirebase();
  } catch (e) {
    adminInit = String((e as Error)?.message || e).slice(0, 200);
  }
  return {
    serviceAccountProject,
    webProject,
    sameProject: Boolean(serviceAccountProject && webProject && serviceAccountProject === webProject),
    keyKind,
    keyProblem,
    adminInit,
  };
}

/** Traduz a falha de conferência do login para algo que dá para corrigir. */
export function explainTokenError(error: unknown): { status: number; message: string; reason: string } {
  const code = String((error as { code?: string })?.code || '');
  const msg = String((error as Error)?.message || error);
  if (code === 'auth/id-token-expired') return { status: 401, message: 'Sessão expirada. Entre novamente.', reason: 'expired' };
  if (/aud|audience|iss|issuer/i.test(msg))
    return {
      status: 503,
      message:
        'Configuração do servidor: a chave FIREBASE_SERVICE_ACCOUNT_KEY é de um projeto Firebase diferente do FIREBASE_WEB_CONFIG. Abra /api/health para ver os dois projetos.',
      reason: 'project_mismatch',
    };
  if (/FIREBASE_SERVICE_ACCOUNT_KEY|private key|PEM|credential|invalid_grant|DECODER/i.test(msg))
    return {
      status: 503,
      message: 'Configuração do servidor: a chave FIREBASE_SERVICE_ACCOUNT_KEY não abriu. Abra /api/health para ver o motivo.',
      reason: 'bad_key',
    };
  if (code === 'auth/id-token-revoked' || code === 'auth/user-disabled' || code === 'auth/user-not-found')
    return { status: 401, message: 'Sessão encerrada. Entre novamente.', reason: code };
  return { status: 401, message: 'Não foi possível confirmar seu login. Saia e entre novamente.', reason: code || 'unknown' };
}

let cached: Promise<FirebaseBundle> | null = null;

export function initFirebase(): Promise<FirebaseBundle> {
  cached ??= (async () => {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY não configurada.');
    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse(raw);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY não é um JSON válido.');
    }
    if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const { getStorage } = await import('firebase-admin/storage');
    const web = readWebConfig();
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || web?.storageBucket;
    const app =
      getApps()[0] ??
      initializeApp({ credential: cert(credentials as never), projectId: credentials.project_id, ...(bucketName ? { storageBucket: bucketName } : {}) });
    // Login conferido sem o módulo firebase-admin/auth (ele não abre na Vercel; ver firebaseToken.ts).
    const verifyIdToken = createTokenVerifier({ projectId: String(credentials.project_id || readWebConfig()?.projectId || '') });
    // Projetos criados pelo AI Studio às vezes usam um banco com nome próprio.
    const databaseId = process.env.FIRESTORE_DATABASE_ID;
    const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
    const files: FileStorage | undefined = bucketName
      ? {
          async save(path, contentType, bytes) {
            await getStorage(app).bucket().file(path).save(Buffer.from(bytes), { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
          },
          async read(path) {
            const file = getStorage(app).bucket().file(path);
            const [exists] = await file.exists();
            if (!exists) return null;
            const [[bytes], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
            return { bytes, contentType: String(meta.contentType || 'application/octet-stream') };
          },
          async signedUrl(path) {
            const [url] = await getStorage(app)
              .bucket()
              .file(path)
              .getSignedUrl({ action: 'read', expires: Date.now() + 60 * 60 * 1000 });
            return url;
          },
        }
      : undefined;
    return {
      db,
      files,
      async verifyToken(token: string): Promise<AuthUser> {
        // Sem "checkRevoked": evita uma consulta extra (e uma permissão extra da chave) a cada
        // requisição. Conta bloqueada é conferida pelo próprio app (checkAccess).
        const decoded = await verifyIdToken(token);
        return {
          uid: decoded.uid,
          email: String(decoded.email || ''),
          emailVerified: decoded.email_verified === true,
          name: typeof decoded.name === 'string' ? decoded.name : undefined,
        };
      },
    };
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}
