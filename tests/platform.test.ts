/**
 * Testes das funções avançadas: H3 (preço dinâmico e despacho por região), localização
 * ao vivo, prazos automáticos, SOS, avaliação dupla, pontos, admin e pisos de preço.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService, freightFloor, negotiationFloor } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';

const ana: AuthUser = { uid: 'p1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' };
const bia: AuthUser = { uid: 'p2', email: 'bia@exemplo.com', emailVerified: true, name: 'Bia' };
const caio: AuthUser = { uid: 'd1', email: 'caio@exemplo.com', emailVerified: true, name: 'Caio' };
const duda: AuthUser = { uid: 'd2', email: 'duda@exemplo.com', emailVerified: true, name: 'Duda' };
const tonhao: AuthUser = { uid: 't1', email: 'tonhao@exemplo.com', emailVerified: true, name: 'Tonhão' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };

const PAULISTA = { lat: -23.5614, lng: -46.6559 };
const CAMPINAS = { lat: -22.9056, lng: -47.0608 };
const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };
const INTERCITY = { originId: 'sp-tiete', destinationId: 'br-campinas' };

let svc: FrocService;
let clock: number;
let approved: Map<string, number>;

const payments: PaymentsGateway = {
  configured: true,
  async createCheckout({ reference }) {
    return { checkoutUrl: 'https://mp.exemplo/' + reference, preferenceId: 'p' };
  },
  async findApproved(ref) {
    const c = approved.get(ref);
    return c ? { paymentId: '1', amountCents: c } : null;
  },
  async getPayment() {
    return null;
  },
};

async function expectError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof AppError && e.code === code);
}
async function topUp(u: AuthUser, reais: number) {
  const { topupId } = await svc.createTopup(u, reais);
  approved.set(topupId, Math.round(reais * 100));
  await svc.confirmTopup(topupId, u.uid);
}
const balance = async (u: AuthUser) => (await svc.bootstrap(u)).profile.walletBalance;
async function approve(u: AuthUser, kind: 'driver' | 'trucker') {
  for (const d of kind === 'driver' ? ['cnh', 'crlv'] : ['cnh', 'crlv', 'antt']) await svc.uploadDocument(u, kind, d, 'image/png', 'eA==');
  await svc.applyAsProvider(u, kind, { phone: '11988887777', vehicle: 'Onix Prata', plate: 'ABC1D23', truckType: 'Truck Baú' });
  await svc.reviewApplication(admin, u.uid, kind, 'approved', '');
}
const minutes = (n: number) => {
  clock += n * 60_000;
};

beforeEach(async () => {
  clock = Date.parse('2026-11-15T12:00:00Z');
  approved = new Map();
  svc = new FrocService(new MemoryStore(), {
    now: () => new Date(clock),
    payments,
    adminEmails: ['dono@froc.com'],
    geo: createGridGeo(),
    files: { async save() {}, async signedUrl(p) { return 'https://x/' + p; } },
  });
  for (const u of [ana, bia, caio, duda, tonhao, admin]) await svc.ensureUser(u);
});

describe('H3: despacho por região e preço dinâmico', () => {
  test('motorista com localização só vê pedidos da região dele', async () => {
    await approve(caio, 'driver');
    await svc.updateProfile(caio, { driverOnline: true });
    await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    await svc.createRide(bia, { originId: 'br-campinas', destinationId: 'sp-tiete', categoryId: 'froc_x', paymentMethod: 'cash' }).catch(() => undefined);
    assert.equal((await svc.bootstrap(caio)).rides.length >= 1, true, 'sem localização vê todos');
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
    const near = (await svc.bootstrap(caio)).rides;
    assert.equal(near.length, 1);
    assert.equal(near[0].passengerName, 'Ana');
    await svc.updateLocation(caio, CAMPINAS.lat, CAMPINAS.lng);
    assert.equal((await svc.bootstrap(caio)).rides.filter((r) => r.passengerName === 'Ana').length, 0);
  });

  test('muitos pedidos e nenhum motorista na região aumentam o preço; admin pode desligar', async () => {
    const calm = await svc.quoteRide(ana, SP);
    assert.equal(calm.surge, 1);
    for (const [i, u] of [bia, caio, duda, tonhao].entries()) {
      await svc.ensureUser(u);
      await svc.createRide(u, { originPoint: { ...PAULISTA, name: 'Paulista ' + i, city: 'São Paulo' }, destinationId: 'sp-pinheiros', categoryId: 'froc_x', paymentMethod: 'cash' });
    }
    const busy = await svc.quoteRide(ana, SP);
    assert.ok(busy.surge > 1, `esperava preço dinâmico, veio ${busy.surge}`);
    assert.ok(busy.surge <= 2);
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    assert.equal(ride.surgeMultiplier, busy.surge);
    await svc.updateSettings(admin, { surgeEnabled: false });
    assert.equal((await svc.quoteRide(bia, SP)).surge, 1);
  });

  test('passageiro vê a posição do motorista durante a corrida', async () => {
    await approve(caio, 'driver');
    await svc.updateProfile(caio, { driverOnline: true });
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await svc.updateLocation(caio, PAULISTA.lat + 0.001, PAULISTA.lng);
    const seen = (await svc.bootstrap(ana)).rides.find((r) => r.id === ride.id)!;
    assert.equal(seen.driverLocation?.lat, Math.round((PAULISTA.lat + 0.001) * 1e6) / 1e6);
    await expectError(svc.updateLocation(ana, 1, 1), 'not_approved');
  });
});

describe('prazos automáticos (papel do Cadence)', () => {
  test('corrida sem motorista é cancelada e estornada depois do prazo', async () => {
    await topUp(ana, 100);
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'froc_pay' });
    minutes(5);
    await svc.sweep(true);
    assert.equal((await svc.bootstrap(ana)).rides[0].status, 'searching');
    minutes(6);
    const result = await svc.sweep(true);
    assert.equal(result.ridesCancelled, 1);
    assert.equal(await balance(ana), 100);
    assert.equal((await svc.bootstrap(ana)).rides.find((r) => r.id === ride.id)!.status, 'cancelled');
  });

  test('negociação aberta expira; prazo configurável no admin', async () => {
    await svc.updateSettings(admin, { indriveOpenTimeoutMin: 5 });
    await svc.createInDrive(ana, { ...SP, passengerOffer: 20, paymentMethod: 'cash' });
    minutes(6);
    assert.equal((await svc.sweep(true)).requestsExpired, 1);
  });
});

describe('SOS', () => {
  test('participante dispara SOS com dados da viagem; admin vê e resolve', async () => {
    await approve(caio, 'driver');
    await svc.updateProfile(caio, { driverOnline: true });
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await expectError(svc.createSos(bia, { kind: 'ride', refId: ride.id }), 'forbidden');
    await svc.createSos(ana, { kind: 'ride', refId: ride.id, lat: PAULISTA.lat, lng: PAULISTA.lng, message: 'Motorista mudou o caminho' });
    const overview = await svc.adminOverview(admin);
    assert.equal(overview.totals.openSos, 1);
    assert.equal(overview.sos[0].trip?.vehiclePlate, 'ABC1D23');
    await svc.resolveSos(admin, overview.sos[0].id, 'Liguei para a passageira, tudo bem');
    assert.equal((await svc.adminOverview(admin)).totals.openSos, 0);
  });
});

describe('avaliação dos dois lados, pontos e comissão configurável', () => {
  test('motorista avalia passageiro; passageiro ganha pontos e troca por crédito', async () => {
    await approve(caio, 'driver');
    await svc.updateProfile(caio, { driverOnline: true });
    await topUp(ana, 200);
    await svc.updateSettings(admin, { pointsPerRedeem: 20 });
    const ride = await svc.createRide(ana, { originId: 'sp-paulista', destinationId: 'sp-tiete', categoryId: 'froc_comfort', paymentMethod: 'froc_pay' });
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await svc.rideAction(caio, ride.id, { action: 'start', pin: ride.pinCode });
    await svc.rideAction(caio, ride.id, { action: 'complete' });
    await svc.rideAction(caio, ride.id, { action: 'rate_passenger', stars: 3 });
    await expectError(svc.rideAction(caio, ride.id, { action: 'rate_passenger', stars: 5 }), 'invalid_state');
    const profile = (await svc.bootstrap(ana)).profile;
    assert.equal(profile.passengerRating, 3);
    assert.equal(profile.points, Math.floor(ride.price));
    const before = profile.walletBalance;
    await svc.redeemPoints(ana);
    assert.equal(await balance(ana), Math.round((before + 5) * 100) / 100);
  });

  test('comissão mudada no admin vale para os próximos pagamentos e entra no relatório', async () => {
    await approve(tonhao, 'trucker');
    await topUp(ana, 2000);
    await svc.updateSettings(admin, { commissionPercent: 10 });
    await expectError(svc.updateSettings(admin, { commissionPercent: 80 }), 'invalid_commissionPercent');
    const f = await svc.createFreight(ana, { ...INTERCITY, estimatedWeightKg: 500, estimatedVolumeM3: 12, proposedBudget: 1000, scheduledDate: 'Sábado' });
    assert.equal(f.estimatedVolumeM3, 12);
    const b = await svc.bidFreight(tonhao, f.id, { price: 1000 });
    await svc.acceptFreightBid(ana, f.id, b.bids[0].id);
    await svc.finishFreight(tonhao, f.id, 'deliver');
    assert.equal(await balance(tonhao), 900);
    const report = await svc.adminReports(admin, 30);
    assert.equal(report.completedServices, 1);
    assert.equal(report.platformRevenue, 100);
    assert.equal(report.byKind.frete.gross, 1000);
  });
});

describe('admin: usuários e bloqueio', () => {
  test('admin bloqueia com motivo; conta bloqueada não usa o app', async () => {
    await expectError(svc.setBlocked(admin, ana.uid, true, ''), 'reason_required');
    await svc.setBlocked(admin, ana.uid, true, 'Fraude no pagamento');
    await expectError(svc.checkAccess(ana), 'blocked');
    await svc.checkAccess(bia);
    const rows = await svc.adminUsers(admin, 'ana@exemplo.com');
    assert.equal(rows[0].blocked, true);
    await svc.setBlocked(admin, ana.uid, false, '');
    await svc.checkAccess(ana);
    await expectError(svc.adminUsers(bia, ''), 'forbidden');
    await expectError(svc.setBlocked(admin, admin.uid, true, 'teste de bloqueio'), 'self');
  });
});

describe('pisos de preço', () => {
  test('negociação e frete abaixo do mínimo são recusados', async () => {
    await approve(tonhao, 'trucker');
    await expectError(svc.createInDrive(ana, { originId: 'sp-tiete', destinationId: 'br-campinas', passengerOffer: 20, paymentMethod: 'cash' }), 'below_floor');
    assert.ok(negotiationFloor(90) > 100);
    await expectError(
      svc.createFreight(ana, { ...INTERCITY, estimatedWeightKg: 100, proposedBudget: 100, scheduledDate: 'Sábado' }),
      'below_floor',
    );
    const f = await svc.createFreight(ana, { ...INTERCITY, estimatedWeightKg: 100, proposedBudget: 400, scheduledDate: 'Sábado' });
    await expectError(svc.bidFreight(tonhao, f.id, { price: freightFloor(f.distanceKm) - 1 }), 'below_floor');
  });
});
