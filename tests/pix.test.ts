/**
 * Saque por Pix (teste real de 18/11/2026: motorista tentou mandar Pix para a chave de e-mail e "não funcionou").
 * Causa: o tipo da chave vinha "CPF" por padrão e o servidor recusava com "tipo não combina".
 * Rodar: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { isAmbiguousPixKey, normalizePixKey, pixKeyKind, resolvePixKeyType } from '../src/lib/pixKey.ts';

const LEGAL = { cnhExpiry: '2035-01-01', city: 'Campinas', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true, rntrc: true, ciotPiso: true, lei12009: true } };
const passageira: AuthUser = { uid: 'p1', email: 'esposa@exemplo.com', emailVerified: true, name: 'Esposa' };
const tio: AuthUser = { uid: 'd1', email: 'tio@exemplo.com', emailVerified: true, name: 'Tio' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };

let svc: FrocService;
let store: MemoryStore;
let approved: Map<string, number>;

const payments: PaymentsGateway = {
  configured: true,
  async createCheckout({ reference }) {
    return { checkoutUrl: 'https://www.mercadopago.com.br/checkout/' + reference, preferenceId: 'pref-' + reference };
  },
  async findApproved(reference) {
    const cents = approved.get(reference);
    return cents ? { paymentId: 'pay-' + reference, amountCents: cents } : null;
  },
  async getPayment() {
    return null;
  },
};

async function expectError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof AppError && e.code === code);
}

/** Esposa recarrega, chama corrida, tio aceita, confere o PIN e termina: o tio fica com ganho para sacar. */
async function tioGanhaUmaCorrida() {
  const { topupId } = await svc.createTopup(passageira, 200);
  approved.set(topupId, 20000);
  await svc.confirmTopup(topupId, passageira.uid);
  for (const doc of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(tio, 'driver', doc, 'image/png', Buffer.from('foto').toString('base64'));
  await svc.applyAsProvider(tio, 'driver', { ...LEGAL, phone: '(11) 98888-7777', vehicle: 'Onix Prata', plate: 'ABC1D23' });
  await svc.reviewApplication(admin, tio.uid, 'driver', 'approved', '');
  await svc.updateProfile(tio, { driverOnline: true });
  const ride = await svc.createRide(passageira, { ...SP, categoryId: 'froc_comfort' });
  await svc.rideAction(tio, ride.id, { action: 'driver_accept' });
  await svc.rideAction(tio, ride.id, { action: 'start', pin: ride.pinCode });
  await svc.rideAction(tio, ride.id, { action: 'complete' });
  const ganho = (await svc.bootstrap(tio)).profile.withdrawableBalance ?? 0;
  assert.ok(ganho >= 20, `ganho da corrida (${ganho}) precisa dar o saque mínimo de R$ 20`);
  return ganho;
}

beforeEach(async () => {
  store = new MemoryStore();
  approved = new Map();
  svc = new FrocService(store, {
    payments,
    adminEmails: ['dono@froc.com'],
    files: { async save() {}, async signedUrl(path) { return 'https://arquivos.exemplo/' + path; } },
  });
  for (const u of [passageira, tio, admin]) await svc.ensureUser(u);
});

describe('chave Pix: tipo e formato', () => {
  test('a chave digitada manda no tipo, mesmo com outro tipo marcado', () => {
    assert.equal(resolvePixKeyType('tio.froc@gmail.com', 'cpf'), 'email', 'o bug do teste real');
    assert.equal(resolvePixKeyType('tio.froc@gmail.com', ''), 'email');
    assert.equal(resolvePixKeyType('11.222.333/0001-81', 'cpf'), 'cnpj');
    assert.equal(resolvePixKeyType('123e4567-e89b-12d3-a456-426614174000', 'email'), 'aleatoria');
    assert.equal(resolvePixKeyType('+55 11 98888-7777', 'cpf'), 'telefone');
    assert.equal(resolvePixKeyType('isso não é chave', 'email'), '');
  });

  test('11 números: vale a escolha entre CPF e celular', () => {
    assert.equal(isAmbiguousPixKey('11988887777'), true);
    assert.equal(isAmbiguousPixKey('+5511988887777'), false);
    assert.equal(resolvePixKeyType('11988887777', 'telefone'), 'telefone');
    assert.equal(resolvePixKeyType('11988887777', 'cpf'), 'cpf');
    assert.equal(resolvePixKeyType('123.456.789-09', 'email'), 'cpf');
  });

  test('chave fica no formato que o banco aceita', () => {
    assert.equal(normalizePixKey('  Tio.Froc@Gmail.COM ', 'email'), 'tio.froc@gmail.com');
    assert.equal(normalizePixKey('123.456.789-09', 'cpf'), '12345678909');
    assert.equal(normalizePixKey('11.222.333/0001-81', 'cnpj'), '11222333000181');
    assert.equal(normalizePixKey('(11) 98888-7777', 'telefone'), '+5511988887777');
    assert.equal(normalizePixKey('+55 (11) 98888-7777', 'telefone'), '+5511988887777');
    assert.equal(normalizePixKey('123E4567-E89B-12D3-A456-426614174000', 'aleatoria'), '123e4567-e89b-12d3-a456-426614174000');
    assert.equal(pixKeyKind('caio@pix.com'), 'email');
  });
});

describe('saque por Pix do motorista', () => {
  test('Pix para chave de e-mail com "CPF" marcado agora funciona (bug do teste real)', async () => {
    const ganho = await tioGanhaUmaCorrida();
    const saldoAntes = (await svc.bootstrap(tio)).profile.walletBalance;
    const r = await svc.requestWithdrawal(tio, 20, ' Tio.Froc@Gmail.com ', 'cpf');
    assert.equal(r.status, 'pending');
    assert.equal(r.pixKeyType, 'email');
    assert.equal(r.pixKey, 'tio.froc@gmail.com', 'chave salva limpa para o Financeiro copiar');
    const boot = await svc.bootstrap(tio);
    assert.equal(boot.profile.walletBalance, Math.round((saldoAntes - 20) * 100) / 100, 'sai do saldo uma vez só');
    assert.equal(boot.profile.withdrawableBalance, Math.round((ganho - 20) * 100) / 100);
    const saved = await store.get<Record<string, unknown>>('withdrawals', r.id);
    assert.equal(saved?.pixKey, 'tio.froc@gmail.com');
    assert.equal(saved?.pixKeyType, 'email');
  });

  test('motorista acompanha o pedido: em análise → liberado → Pix enviado', async () => {
    await tioGanhaUmaCorrida();
    const { id } = await svc.requestWithdrawal(tio, 20, 'tio.froc@gmail.com', 'email');
    let lista = (await svc.bootstrap(tio)).withdrawals;
    assert.equal(lista.length, 1);
    assert.equal(lista[0].status, 'pending');
    assert.equal(lista[0].amount, 20);
    assert.equal(lista[0].pixKeyType, 'email');
    assert.equal(lista[0].pixKey, 'tio…com', 'chave mascarada no app');

    await svc.resolveWithdrawal(admin, id, 'approved');
    lista = (await svc.bootstrap(tio)).withdrawals;
    assert.equal(lista[0].status, 'approved', 'sem envio automático configurado: fica "Pix a enviar"');

    await svc.resolveWithdrawal(admin, id, 'paid');
    lista = (await svc.bootstrap(tio)).withdrawals;
    assert.equal(lista[0].status, 'paid');
  });

  test('recusado aparece como recusado e o valor volta', async () => {
    const ganho = await tioGanhaUmaCorrida();
    const { id } = await svc.requestWithdrawal(tio, 20, 'tio.froc@gmail.com', 'email');
    await svc.resolveWithdrawal(admin, id, 'rejected');
    const boot = await svc.bootstrap(tio);
    assert.equal(boot.withdrawals[0].status, 'rejected');
    assert.equal(boot.profile.withdrawableBalance, ganho);
  });

  test('cada um só vê os próprios pedidos de Pix', async () => {
    await tioGanhaUmaCorrida();
    await svc.requestWithdrawal(tio, 20, 'tio.froc@gmail.com', 'email');
    assert.equal((await svc.bootstrap(passageira)).withdrawals.length, 0);
  });

  test('chave inválida continua recusada e nada sai do saldo', async () => {
    await tioGanhaUmaCorrida();
    const antes = (await svc.bootstrap(tio)).profile.walletBalance;
    await expectError(svc.requestWithdrawal(tio, 20, 'tio.froc@gmail', 'email'), 'invalid_pix_key');
    assert.equal((await svc.bootstrap(tio)).profile.walletBalance, antes);
    assert.equal((await svc.bootstrap(tio)).withdrawals.length, 0);
  });
});
