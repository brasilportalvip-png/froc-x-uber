import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentsGateway } from './services.ts';

/**
 * Mercado Pago (Checkout Pro): a pessoa paga a recarga por Pix ou cartão na página do
 * Mercado Pago. O saldo só entra na carteira depois que o Mercado Pago confirma o
 * pagamento como aprovado (pelo aviso automático ou pela conferência na volta).
 */
export function createMercadoPago(options: {
  accessToken?: string;
  publicUrl?: string;
  fetchImpl?: typeof fetch;
}): PaymentsGateway {
  const token = options.accessToken?.trim();
  const http = options.fetchImpl ?? fetch;
  const base = (options.publicUrl || '').replace(/\/+$/, '');
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await http('https://api.mercadopago.com' + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`mercadopago_${res.status}: ${String((body as { message?: string }).message || '').slice(0, 160)}`);
    return body as Record<string, any>;
  };

  return {
    configured: Boolean(token && base),
    // O e-mail do pagador não é preenchido: se for o mesmo da conta vendedora (ex.: o dono
    // testando), o Mercado Pago recusa o pagamento. A pessoa informa os dados no checkout.
    async createCheckout({ reference, amountCents, title }) {
      const pref = await call('/checkout/preferences', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': reference },
        body: JSON.stringify({
          items: [{ id: reference, title, quantity: 1, currency_id: 'BRL', unit_price: amountCents / 100 }],
          external_reference: reference,
          back_urls: {
            success: `${base}/?recarga=${reference}`,
            pending: `${base}/?recarga=${reference}`,
            failure: `${base}/?recarga=${reference}`,
          },
          auto_return: 'approved',
          notification_url: `${base}/api/webhooks/mercadopago`,
          statement_descriptor: 'FROC X UBER',
        }),
      });
      const url = String(pref.init_point || '');
      if (!url.startsWith('https://')) throw new Error('mercadopago_checkout_url');
      return { checkoutUrl: url, preferenceId: String(pref.id) };
    },
    async findApproved(reference) {
      const found = await call(`/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc`);
      const paid = (found.results || []).find((p: any) => p.status === 'approved' && p.currency_id === 'BRL');
      return paid ? { paymentId: String(paid.id), amountCents: Math.round(Number(paid.transaction_amount) * 100) } : null;
    },
    async getPayment(paymentId) {
      if (!/^\d+$/.test(paymentId)) return null;
      const p = await call(`/v1/payments/${paymentId}`);
      return { reference: String(p.external_reference || ''), status: String(p.status), amountCents: Math.round(Number(p.transaction_amount) * 100) };
    },
  };
}

/**
 * Confere a assinatura do aviso do Mercado Pago (cabeçalho x-signature "ts=...,v1=...").
 * Sem a chave secreta configurada, recusa o aviso (a recarga ainda é conferida quando a
 * pessoa volta para o app).
 */
export function verifyMercadoPagoSignature(input: {
  secret?: string;
  signatureHeader?: string;
  requestId?: string;
  dataId?: string;
  nowMs?: number;
}): boolean {
  const secret = input.secret?.trim();
  if (!secret || !input.signatureHeader || !input.dataId) return false;
  const parts = Object.fromEntries(
    input.signatureHeader.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k, v.join('=')];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !/^[a-f0-9]{64}$/i.test(v1)) return false;
  const tsMs = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs((input.nowMs ?? Date.now()) - tsMs) > 10 * 60 * 1000) return false;
  const manifest = `id:${String(input.dataId).toLowerCase()};${input.requestId ? `request-id:${input.requestId};` : ''}ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1.toLowerCase(), 'hex'));
}
