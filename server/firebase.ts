/**
 * Inicialização do Firebase no servidor (login, banco de dados e arquivos).
 * Lê a chave de serviço da variável FIREBASE_SERVICE_ACCOUNT_KEY (JSON inteiro) e a
 * configuração web pública de FIREBASE_WEB_CONFIG (JSON copiado do console do Firebase).
 */
import type { AuthUser, FileStorage } from './services.ts';

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
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');
    const { getStorage } = await import('firebase-admin/storage');
    const web = readWebConfig();
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || web?.storageBucket;
    const app =
      getApps()[0] ??
      initializeApp({ credential: cert(credentials as never), projectId: credentials.project_id, ...(bucketName ? { storageBucket: bucketName } : {}) });
    const auth = getAuth(app);
    const db = getFirestore(app);
    const files: FileStorage | undefined = bucketName
      ? {
          async save(path, contentType, bytes) {
            await getStorage(app).bucket().file(path).save(Buffer.from(bytes), { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
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
        const decoded = await auth.verifyIdToken(token, true);
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
