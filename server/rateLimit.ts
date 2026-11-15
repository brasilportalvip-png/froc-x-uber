/**
 * Limite de uso que vale para todos os servidores ao mesmo tempo (fica no Firestore).
 * O limite em memória (server/app.ts) é por instância: na Vercel cada instância tem o seu,
 * então quem insiste muito passaria. Este aqui é o mesmo para todas.
 */
import { AppError } from './services.ts';
import type { Store } from './store.ts';

export async function consumeQuota(store: Store, key: string, max: number, windowMs: number, message?: string) {
  const id = key.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 140);
  const nowMs = Date.now();
  const allowed = await store.transaction(async (tx) => {
    const cur = await tx.get<{ count: number; resetAt: number }>('ratelimits', id);
    if (!cur || cur.resetAt <= nowMs) {
      tx.set('ratelimits', id, { count: 1, resetAt: nowMs + windowMs });
      return true;
    }
    if (cur.count >= max) return false;
    tx.update('ratelimits', id, { count: cur.count + 1 });
    return true;
  });
  if (!allowed) throw new AppError(429, 'rate_limited', message || 'Muitas tentativas. Aguarde um pouco e tente de novo.');
}
