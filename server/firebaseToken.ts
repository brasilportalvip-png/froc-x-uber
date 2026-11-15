/**
 * Conferência do login (token do Firebase) feita só com o node:crypto.
 *
 * Por quê: o módulo de login do firebase-admin carrega a biblioteca "jose" (só ESM)
 * através de um require(), e o servidor da Vercel recusa isso ("require() de módulo ES não
 * é suportado"). Resultado: nenhum login passava. Aqui fazemos a mesma conferência que o
 * firebase-admin faz, seguindo a documentação oficial do Firebase:
 * https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */
import { createPublicKey, verify } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const SKEW_SECONDS = 300;

export interface DecodedFirebaseToken {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  [claim: string]: unknown;
}

class TokenError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type CertFetcher = () => Promise<{ certs: Record<string, string>; maxAgeSeconds: number }>;

async function fetchGoogleCerts() {
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new TokenError('auth/internal-error', `Não foi possível baixar as chaves do Google (${res.status}).`);
  const certs = (await res.json()) as Record<string, string>;
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  return { certs, maxAgeSeconds: maxAge ? Number(maxAge[1]) : 3600 };
}

function b64urlJson(part: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('auth/argument-error', 'Token mal formado.');
  }
}

export function createTokenVerifier(options: { projectId: string; fetchCerts?: CertFetcher; nowSeconds?: () => number }) {
  const { projectId } = options;
  if (!projectId) throw new Error('projectId do Firebase não encontrado (confira FIREBASE_SERVICE_ACCOUNT_KEY).');
  const fetchCerts = options.fetchCerts ?? fetchGoogleCerts;
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  let cache: { certs: Record<string, string>; expiresAt: number } | null = null;

  const certFor = async (kid: string) => {
    if (!cache || cache.expiresAt <= now() || !cache.certs[kid]) {
      const fresh = await fetchCerts();
      cache = { certs: fresh.certs, expiresAt: now() + Math.max(60, fresh.maxAgeSeconds) };
    }
    const pem = cache.certs[kid];
    if (!pem) throw new TokenError('auth/argument-error', 'Token assinado com chave desconhecida.');
    return pem;
  };

  return async function verifyIdToken(token: string): Promise<DecodedFirebaseToken> {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new TokenError('auth/argument-error', 'Token mal formado.');
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string')
      throw new TokenError('auth/argument-error', 'Token com algoritmo inválido.');

    const t = now();
    if (payload.aud !== projectId)
      throw new TokenError('auth/argument-error', `Firebase ID token has incorrect "aud" (audience) claim. Expected "${projectId}" but got "${String(payload.aud)}".`);
    if (payload.iss !== `https://securetoken.google.com/${projectId}`)
      throw new TokenError('auth/argument-error', 'Firebase ID token has incorrect "iss" (issuer) claim.');
    if (typeof payload.exp !== 'number' || payload.exp <= t) throw new TokenError('auth/id-token-expired', 'Token expirado.');
    if (typeof payload.iat !== 'number' || payload.iat > t + SKEW_SECONDS) throw new TokenError('auth/argument-error', 'Token emitido no futuro.');
    if (typeof payload.auth_time === 'number' && payload.auth_time > t + SKEW_SECONDS)
      throw new TokenError('auth/argument-error', 'Login com horário inválido.');
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128)
      throw new TokenError('auth/argument-error', 'Token sem usuário.');

    const key = createPublicKey(await certFor(header.kid));
    const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new TokenError('auth/argument-error', 'Assinatura do token inválida.');
    return { ...payload, uid: payload.sub } as DecodedFirebaseToken;
  };
}
