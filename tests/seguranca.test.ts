/**
 * AUDITORIA · Ataques e erros de uso: corrida de cliques (dois pedidos ao mesmo tempo),
 * valores malucos, mexer no que é dos outros, pagar duas vezes.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';

const ana: AuthUser = { uid: 'ana', email: 'ana@x.com', emailVerified: true, name: 'Ana' };
const bia: AuthUser = { uid: 'bia', email: 'bia@x.com', emailVerified: true, name: 'Bia' };
const caio: AuthUser = { uid: 'caio', email: 'caio@x.com', emailVerified: true, name: 'Caio' };
const admin: AuthUser = { uid: 'dono', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };
const LEGAL = { cnhExpiry: '2035-01-01', city: 'Campinas', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true } };

let store: MemoryStore;
let svc: FrocService;
let approved: Map<string, number>;
const payments: PaymentsGateway = {
  configured: true,
  async createCheckout({ reference }) {
    return { checkoutUrl: 'x/' + reference, preferenceId: 'p' };
  },
  async findApproved(ref) {
    const c = approved.get(ref);
    return c ? { paymentId: '1', amountCents: c } : null;
  },
  async getPayment() {
    return null;
  },
};
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : `ERRO_INESPERADO: ${(e as Error).message}`;
  }
};
async function topUp(u: AuthUser, reais: number) {
  const { topupId } = await svc.createTopup(u, reais);
  approved.set(topupId, Math.round(reais * 100));
  await svc.confirmTopup(topupId, u.uid);
}
async function driver() {
  for (const d of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(caio, 'driver', d, 'image/png', 'eA==');
  await svc.applyAsProvider(caio, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix', plate: 'ABC1D23' });
  await svc.reviewApplication(admin, caio.uid, 'driver', 'approved', '');
  await svc.updateProfile(caio, { driverOnline: true });
}

beforeEach(async () => {
  store = new MemoryStore();
  approved = new Map();
  svc = new FrocService(store, {
    now: () => new Date('2026-11-18T18:00:00Z'),
    payments,
    adminEmails: ['dono@froc.com'],
    geo: createGridGeo(),
    files: { async save() {}, async signedUrl(p) { return p; } },
  });
  for (const u of [ana, bia, caio, admin]) await svc.ensureUser(u);
});

describe('cliques simultâneos não duplicam dinheiro', () => {
  test('dois pedidos ao mesmo tempo com saldo para um: só um passa', async () => {
    const q = (await svc.quoteRide(ana, SP)).prices.find((p) => p.categoryId === 'froc_comfort')!;
    await topUp(ana, Math.ceil(q.price * 1.5));
    const r = await Promise.allSettled([svc.createRide(ana, { ...SP, categoryId: 'froc_comfort' }), svc.createRide(ana, { ...SP, categoryId: 'froc_comfort' })]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.ok((await svc.bootstrap(ana)).profile.walletBalance >= 0);
  });

  test('finalizar duas vezes ao mesmo tempo paga uma vez só', async () => {
    await driver();
    await topUp(ana, 100);
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await svc.rideAction(caio, ride.id, { action: 'start', pin: ride.pinCode });
    const r = await Promise.allSettled([svc.rideAction(caio, ride.id, { action: 'complete' }), svc.rideAction(caio, ride.id, { action: 'complete' })]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal((await svc.bootstrap(caio)).profile.walletBalance, Math.round((ride.price - ride.pricing!.platformFee) * 100) / 100);
  });

  test('cancelar e finalizar ao mesmo tempo: só um vale e o dinheiro fecha', async () => {
    await driver();
    await topUp(ana, 100);
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await svc.rideAction(caio, ride.id, { action: 'start', pin: ride.pinCode });
    await Promise.allSettled([svc.rideAction(caio, ride.id, { action: 'complete' }), svc.rideAction(ana, ride.id, { action: 'cancel' })]);
    const a = (await svc.bootstrap(ana)).profile.walletBalance;
    const c = (await svc.bootstrap(caio)).profile.walletBalance;
    assert.equal(Math.round((a + c) * 100) + Math.round(ride.pricing!.platformFee * 100), 10000);
  });

  test('dois saques ao mesmo tempo não passam do que foi ganho', async () => {
    await driver();
    await store.update('users', caio.uid, { balanceCents: 10000, earnedCents: 6000 });
    const r = await Promise.allSettled([svc.requestWithdrawal(caio, 40, 'caio@pix.com', 'email'), svc.requestWithdrawal(caio, 40, 'caio@pix.com', 'email')]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  });

  test('recarga confirmada duas vezes credita uma vez', async () => {
    const { topupId } = await svc.createTopup(ana, 50);
    approved.set(topupId, 5000);
    await Promise.all([svc.confirmTopup(topupId, ana.uid), svc.confirmTopup(topupId, ana.uid), svc.handlePaymentNotification('qualquer').catch(() => null)]);
    assert.equal((await svc.bootstrap(ana)).profile.walletBalance, 50);
  });
});

describe('valores malucos são recusados', () => {
  test('recarga, saque, oferta e carona com valores inválidos', async () => {
    await driver();
    for (const v of [-100, 0, 5, 9.99, 5001, Number.NaN, '1e9', 'abc']) assert.notEqual(await codeOf(svc.createTopup(ana, v)), 'ok', `recarga ${v}`);
    for (const v of [-50, 0, 19.99, 'abc', 50001]) assert.notEqual(await codeOf(svc.requestWithdrawal(caio, v, 'caio@pix.com', 'email')), 'ok', `saque ${v}`);
    await topUp(ana, 100);
    for (const v of [-1, 0, 7, 5001, 'x']) assert.notEqual(await codeOf(svc.createInDrive(ana, { ...SP, passengerOffer: v })), 'ok', `oferta ${v}`);
    for (const [seats, price] of [[0, 40], [7, 40], [2, 4], [2, 2001]])
      assert.notEqual(await codeOf(svc.publishCarpool(caio, { originId: 'sp-tiete', destinationId: 'br-campinas', date: 'Sábado', departureTime: '08:00', totalSeats: seats, pricePerSeat: price })), 'ok');
    assert.equal(await codeOf(svc.createRide(ana, { originPoint: { lat: 40.7, lng: -74, name: 'Nova York' }, destinationId: 'sp-pinheiros', categoryId: 'froc_x' })), 'outside_brazil');
    assert.equal(await codeOf(svc.createRide(ana, { ...SP, categoryId: 'helicoptero' })), 'invalid_category');
  });
});

describe('ninguém mexe no que é dos outros', () => {
  test('recarga de outra pessoa, corrida própria, avaliação dupla, PIN escondido', async () => {
    await driver();
    const { topupId } = await svc.createTopup(ana, 50);
    approved.set(topupId, 5000);
    assert.equal(await codeOf(svc.confirmTopup(topupId, bia.uid)), 'not_found');
    await topUp(caio, 50);
    const own = await svc.createRide(caio, { ...SP, categoryId: 'froc_x' });
    assert.equal(await codeOf(svc.rideAction(caio, own.id, { action: 'driver_accept' })), 'own_ride');
    await svc.rideAction(caio, own.id, { action: 'cancel' });
    await topUp(ana, 100);
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    const seenByBia = (await svc.bootstrap(bia)).rides.find((r) => r.id === ride.id);
    assert.equal(seenByBia, undefined);
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    assert.equal((await svc.bootstrap(caio)).rides.find((r) => r.id === ride.id)?.pinCode, '');
    await svc.rideAction(caio, ride.id, { action: 'start', pin: ride.pinCode });
    await svc.rideAction(caio, ride.id, { action: 'complete' });
    await svc.rideAction(ana, ride.id, { action: 'rate', stars: 5 });
    assert.equal(await codeOf(svc.rideAction(ana, ride.id, { action: 'rate', stars: 1 })), 'invalid_state');
    assert.equal(await codeOf(svc.rideAction(bia, ride.id, { action: 'rate', stars: 1 })), 'forbidden');
  });

  test('usuário comum não usa nenhuma função de administração', async () => {
    for (const p of [
      svc.adminOverview(ana),
      svc.adminUsers(ana, ''),
      svc.updateSettings(ana, { platformFeeMax: 40 }),
      svc.setBlocked(ana, bia.uid, true, 'teste teste'),
      svc.resolveWithdrawal(ana, 'x', 'approved'),
      svc.reviewApplication(ana, bia.uid, 'driver', 'approved', ''),
      svc.adminIdentity(ana, bia.uid),
      svc.adminSetCpfStatus(ana, bia.uid, 'verified', ''),
      svc.saveRiskZone(ana, { name: 'x', lat: -23, lng: -46 }),
      svc.auditLog(ana),
      svc.adminReports(ana, 7),
    ])
      assert.equal(await codeOf(p), 'forbidden');
    // E-mail de admin sem confirmação também não entra.
    assert.equal(await codeOf(svc.adminOverview({ ...admin, emailVerified: false })), 'forbidden');
  });

  test('conta bloqueada não usa o app', async () => {
    await svc.setBlocked(admin, bia.uid, true, 'Fraude confirmada');
    assert.equal(await codeOf(svc.checkAccess(bia)), 'blocked');
  });
});
