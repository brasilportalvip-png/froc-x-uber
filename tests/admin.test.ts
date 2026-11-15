import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrocService, parseAdminEmails } from '../server/services.ts';
import type { AuthUser } from '../server/services.ts';
import { MemoryStore } from '../server/store.ts';

test('ADMIN_EMAILS aceita aspas, espaços, ponto e vírgula e maiúsculas', () => {
  assert.deepEqual(parseAdminEmails('"Dono@Froc.com"'), ['dono@froc.com']);
  assert.deepEqual(parseAdminEmails(' a@x.com ; b@y.com,c@z.com\n'), ['a@x.com', 'b@y.com', 'c@z.com']);
  assert.deepEqual(parseAdminEmails(''), []);
  assert.deepEqual(parseAdminEmails(undefined), []);
});

test('Admin só com e-mail confirmado; perfil mostra comissão e documentos enviados', async () => {
  const svc = new FrocService(new MemoryStore(), {
    adminEmails: ['"dono@froc.com"'],
    files: { async save() {}, async signedUrl(p) { return p; } },
  });
  const unverified: AuthUser = { uid: 'a1', email: 'Dono@froc.com', emailVerified: false };
  const verified: AuthUser = { ...unverified, emailVerified: true };
  const boot1 = await svc.bootstrap(unverified);
  assert.equal(boot1.profile.isAdmin, false);
  const boot2 = await svc.bootstrap(verified);
  assert.equal(boot2.profile.isAdmin, true);
  assert.equal(boot2.profile.commissionPercent, 12);

  const driver: AuthUser = { uid: 'd1', email: 'm@x.com', emailVerified: true };
  await svc.uploadDocument(driver, 'driver', 'cnh', 'image/jpeg', Buffer.from('foto').toString('base64'));
  const boot3 = await svc.bootstrap(driver);
  assert.deepEqual(boot3.profile.driverDocsSent, ['cnh']);
  assert.deepEqual(boot3.profile.truckerDocsSent, []);
});

test('Falha do Mercado Pago vira mensagem clara e a recarga fica marcada como falha', async () => {
  const store = new MemoryStore();
  const svc = new FrocService(store, {
    payments: {
      configured: true,
      async createCheckout() {
        throw new Error('mercadopago_401: invalid access token');
      },
      async findApproved() {
        return null;
      },
      async getPayment() {
        return null;
      },
    },
  });
  const user: AuthUser = { uid: 'p1', email: 'p@x.com', emailVerified: true };
  const original = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(svc.createTopup(user, 10), (e: Error & { code?: string }) => e.code === 'payment_provider');
  } finally {
    console.error = original;
  }
  const topups = await store.query('topups', [['uid', '==', 'p1']]);
  assert.equal(topups[0].status, 'failed');
});
