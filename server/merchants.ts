/**
 * Froc Entregas para lojas: chaves de API, webhooks assinados e validação de CNPJ.
 *
 * - A chave ("froc_live_...") só aparece UMA vez, na criação. O banco guarda apenas o
 *   SHA-256 dela (se o banco vazar, as chaves continuam seguras).
 * - Webhooks: POST JSON com cabeçalho X-Froc-Signature: t=<unix>,v1=<HMAC-SHA256 de "t.corpo">.
 *   Falhou? Tenta de novo com espera crescente (1, 5, 15, 60 min, 3 h, 12 h) e desiste após 7.
 * - Endereço de webhook precisa ser https público (bloqueia localhost e redes internas).
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Doc, Store } from './store.ts';
import { AppError } from './services.ts';

export const API_KEY_PREFIX = 'froc_live_';
export const MAX_ACTIVE_KEYS = 5;
const RETRY_MINUTES = [1, 5, 15, 60, 180, 720];

const fail = (status: number, code: string, message: string): never => {
  throw new AppError(status, code, message);
};

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Confere os dígitos verificadores do CNPJ (aceita com ou sem pontuação). */
export function isValidCnpj(value: unknown): boolean {
  const d = String(value ?? '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export const formatCnpj = (value: string) => {
  const d = value.replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : value;
};

/** Só https público: bloqueia localhost, IPs internos e endereços sem domínio (proteção contra SSRF). */
export function validateWebhookUrl(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(400, 'invalid_webhook', 'Endereço do webhook inválido.');
  }
  if (url.protocol !== 'https:') fail(400, 'invalid_webhook', 'O webhook precisa usar https://.');
  if (url.username || url.password) fail(400, 'invalid_webhook', 'Não coloque usuário e senha no endereço do webhook.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const privateHost =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    /^(0|10|127)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    host.includes(':'); // IPv6 literal
  if (privateHost) fail(400, 'invalid_webhook', 'Use um endereço público (domínio na internet) para o webhook.');
  if (url.port && !['443', '8443'].includes(url.port)) fail(400, 'invalid_webhook', 'Use a porta padrão do https (443).');
  return url.toString().slice(0, 500);
}

export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** Para a loja conferir a assinatura (usado também nos testes e no exemplo da documentação). */
export function verifyWebhookSignature(secret: string, body: string, header: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(parts.v1));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------- chaves de API

export interface ApiKeyView {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string;
  revoked: boolean;
}

export async function createApiKey(store: Store, uid: string, label: unknown, now = new Date()) {
  const active = (await store.query<Doc>('api_keys', [['uid', '==', uid]], 100)).filter((k) => !k.revoked);
  if (active.length >= MAX_ACTIVE_KEYS) fail(409, 'too_many_keys', `Limite de ${MAX_ACTIVE_KEYS} chaves ativas. Revogue uma antes de criar outra.`);
  const key = API_KEY_PREFIX + randomBytes(24).toString('base64url');
  const id = sha256(key);
  const doc = {
    id,
    uid,
    label: String(label ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) || 'Minha integração',
    prefix: key.slice(0, API_KEY_PREFIX.length + 6),
    createdAt: now.toISOString(),
    lastUsedAt: '',
    revoked: false,
  };
  await store.set('api_keys', id, doc);
  return { key, ...toKeyView(doc) };
}

const toKeyView = (k: Doc): ApiKeyView => ({
  id: String(k.id),
  label: String(k.label || ''),
  prefix: String(k.prefix || ''),
  createdAt: String(k.createdAt || ''),
  lastUsedAt: String(k.lastUsedAt || ''),
  revoked: Boolean(k.revoked),
});

export async function listApiKeys(store: Store, uid: string) {
  return (await store.query<Doc>('api_keys', [['uid', '==', uid]], 100))
    .map(toKeyView)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeApiKey(store: Store, uid: string, id: string, now = new Date()) {
  const key = await store.get<Doc>('api_keys', id);
  if (!key || key.uid !== uid) fail(404, 'not_found', 'Chave não encontrada.');
  await store.update('api_keys', id, { revoked: true, revokedAt: now.toISOString() });
  return { ok: true };
}

/** Confere a chave enviada em "Authorization: Bearer froc_live_...". Devolve o dono. */
export async function authenticateApiKey(store: Store, header: unknown, now = new Date()) {
  const raw = String(header ?? '');
  const key = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw.trim();
  if (!key.startsWith(API_KEY_PREFIX) || key.length < 30 || key.length > 80)
    fail(401, 'invalid_api_key', 'Chave de API ausente ou inválida. Envie o cabeçalho Authorization: Bearer froc_live_...');
  const id = sha256(key);
  const doc = await store.get<Doc>('api_keys', id);
  if (!doc || doc.revoked) fail(401, 'invalid_api_key', 'Chave de API inválida ou revogada.');
  // Atualiza "último uso" no máximo a cada 5 minutos (economiza escritas).
  if (!doc!.lastUsedAt || now.getTime() - Date.parse(String(doc!.lastUsedAt)) > 5 * 60_000)
    await store.update('api_keys', id, { lastUsedAt: now.toISOString() }).catch(() => undefined);
  return { uid: String(doc!.uid), keyId: id };
}

// ------------------------------------------------------------------ webhooks

export const newWebhookSecret = () => 'whsec_' + randomBytes(24).toString('base64url');

export interface WebhookDispatcher {
  /** Grava o evento e tenta entregar na hora (sem travar quem chamou por mais de ~5 s). */
  emit(merchantUid: string, event: string, data: Record<string, unknown>): Promise<void>;
  /** Reenvia os eventos que falharam e já passaram da hora de tentar de novo. */
  retryDue(limit?: number): Promise<{ sent: number; failed: number }>;
  /** Envia um evento de teste para a loja conferir a integração. */
  test(merchantUid: string): Promise<{ ok: boolean; status: number; error?: string }>;
}

export function createWebhookDispatcher(store: Store, fetchImpl: typeof fetch = fetch, now = () => new Date()): WebhookDispatcher {
  const target = async (uid: string) => {
    const user = await store.get<Doc>('users', uid);
    const m = (user?.merchant || {}) as Doc;
    return { url: String(m.webhookUrl || ''), secret: String(m.webhookSecret || '') };
  };

  const send = async (url: string, secret: string, body: string, event: string, id: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FrocWebhooks/1.0',
          'X-Froc-Event': event,
          'X-Froc-Delivery-Id': id,
          'X-Froc-Signature': signWebhook(secret, body, Math.floor(now().getTime() / 1000)),
        },
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
      return { ok: res.status >= 200 && res.status < 300, status: res.status };
    } catch (e) {
      return { ok: false, status: 0, error: (e as Error)?.name === 'AbortError' ? 'tempo esgotado (5 s)' : String((e as Error)?.message || e).slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
  };

  const attempt = async (job: Doc) => {
    const { url, secret } = await target(String(job.merchantUid));
    const attempts = Number(job.attempts || 0) + 1;
    if (!url || !secret) {
      await store.update('webhook_jobs', String(job.id), { status: 'skipped', attempts, lastError: 'loja sem webhook configurado' });
      return false;
    }
    const r = await send(url, secret, String(job.body), String(job.event), String(job.id));
    if (r.ok) {
      await store.update('webhook_jobs', String(job.id), { status: 'delivered', attempts, deliveredAt: now().toISOString(), lastStatus: r.status });
      return true;
    }
    const wait = RETRY_MINUTES[attempts - 1];
    await store.update('webhook_jobs', String(job.id), {
      status: wait ? 'pending' : 'failed',
      attempts,
      lastStatus: r.status,
      lastError: r.error || `HTTP ${r.status}`,
      nextAt: wait ? new Date(now().getTime() + wait * 60_000).toISOString() : '',
    });
    return false;
  };

  return {
    async emit(merchantUid, event, data) {
      const { url } = await target(merchantUid);
      if (!url) return;
      const id = randomUUID();
      const body = JSON.stringify({ id, type: event, createdAt: now().toISOString(), data });
      const job = { id, merchantUid, event, body, status: 'pending', attempts: 0, nextAt: now().toISOString(), createdAt: now().toISOString() };
      await store.set('webhook_jobs', id, job);
      await attempt(job).catch((e) => console.warn('Webhook falhou:', e));
    },
    async retryDue(limit = 25) {
      const due = (await store.query<Doc>('webhook_jobs', [['status', '==', 'pending']], 300))
        .filter((j) => String(j.nextAt || '') <= now().toISOString())
        .slice(0, limit);
      let sent = 0;
      let failed = 0;
      for (const job of due) (await attempt(job).catch(() => false)) ? sent++ : failed++;
      return { sent, failed };
    },
    async test(merchantUid) {
      const { url, secret } = await target(merchantUid);
      if (!url || !secret) return { ok: false, status: 0, error: 'Configure o endereço do webhook primeiro.' };
      const id = randomUUID();
      const body = JSON.stringify({ id, type: 'webhook.test', createdAt: now().toISOString(), data: { message: 'Teste do Froc Entregas. Se você recebeu, está tudo certo.' } });
      return send(url, secret, body, 'webhook.test', id);
    },
  };
}
