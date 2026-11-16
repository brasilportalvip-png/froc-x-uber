/**
 * Regras de respeito: cancelamento (grátis até 1 min, 50% até 2 min, 100% depois),
 * tempo de espera (+10%, +30%, +50%), "cheguei" só perto do embarque e "não apareceu".
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import { cancelFeePercent, nextWaitTier, waitingFeePercent } from '../src/data/ridePolicy.ts';

const LEGAL = { cnhExpiry: '2035-01-01', city: 'Campinas', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true } };
const ana: AuthUser = { uid: 'p1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' };
const caio: AuthUser = { uid: 'd1', email: 'caio@exemplo.com', emailVerified: true, name: 'Caio' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };

let store: MemoryStore;
let svc: FrocService;
let clock: number;
let approved: Map<string, number>;
const payments: PaymentsGateway = {
  configured: true,
  async createCheckout({ reference }) {
    return { checkoutUrl: 'https://mp/' + reference, preferenceId: 'p' };
  },
  async findApproved(ref) {
    const c = approved.get(ref);
    return c ? { paymentId: '1', amountCents: c } : null;
  },
  async getPayment() {
    return null;
  },
};
const sec = (n: number) => {
  clock += n * 1000;
};
const balance = async (u: AuthUser) => (await svc.bootstrap(u)).profile.walletBalance;
const cents = (reais: number) => Math.round(reais * 100);
async function expectError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof AppError && e.code === code);
}

beforeEach(async () => {
  clock = Date.parse('2026-11-16T15:00:00Z');
  approved = new Map();
  store = new MemoryStore();
  svc = new FrocService(store, {
    now: () => new Date(clock),
    payments,
    adminEmails: ['dono@froc.com'],
    geo: createGridGeo(),
    files: { async save() {}, async signedUrl(p) { return 'https://x/' + p; } },
  });
  for (const u of [ana, caio, admin]) await svc.ensureUser(u);
  const { topupId } = await svc.createTopup(ana, 100);
  approved.set(topupId, 10000);
  await svc.confirmTopup(topupId, ana.uid);
  for (const d of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(caio, 'driver', d, 'image/png', 'eA==');
  await svc.applyAsProvider(caio, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix', plate: 'ABC1D23' });
  await svc.reviewApplication(admin, caio.uid, 'driver', 'approved', '');
  await svc.updateProfile(caio, { driverOnline: true });
});

async function acceptedRide() {
  const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', acceptPolicy: true });
  await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
  return ride;
}
async function arrive(ride: { id: string; origin: { lat: number; lng: number } }) {
  await svc.updateLocation(caio, ride.origin.lat, ride.origin.lng);
  await svc.rideAction(caio, ride.id, { action: 'arriving' });
}

describe('regras da tabela', () => {
  test('cancelamento e espera', () => {
    assert.equal(cancelFeePercent(59), 0);
    assert.equal(cancelFeePercent(60), 50);
    assert.equal(cancelFeePercent(119), 50);
    assert.equal(cancelFeePercent(120), 100);
    assert.equal(waitingFeePercent(59), 0);
    assert.equal(waitingFeePercent(60), 10);
    assert.equal(waitingFeePercent(150), 30);
    assert.equal(waitingFeePercent(180), 50);
    assert.equal(waitingFeePercent(900), 50, 'máximo 50%');
    assert.equal(nextWaitTier(70)?.percent, 30);
    assert.equal(nextWaitTier(200), null);
  });
});

describe('cancelamento do passageiro', () => {
  test('antes de algum motorista aceitar é grátis, mesmo depois de muito tempo', async () => {
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    sec(300);
    await svc.rideAction(ana, ride.id, { action: 'cancel' });
    assert.equal(await balance(ana), 100);
  });

  test('até 1 min depois do aceite: grátis', async () => {
    const ride = await acceptedRide();
    sec(50);
    await svc.rideAction(ana, ride.id, { action: 'cancel' });
    assert.equal(await balance(ana), 100);
    assert.equal(await balance(caio), 0);
  });

  test('entre 1 e 2 min: 50% vai para o motorista', async () => {
    const ride = await acceptedRide();
    sec(90);
    const r = await svc.rideAction(ana, ride.id, { action: 'cancel' });
    assert.equal(r.cancellationFeePercent, 50);
    const fee = Math.round(cents(ride.price) / 2);
    assert.equal(cents(await balance(ana)), 10000 - fee);
    assert.equal(cents(await balance(caio)), Math.round(fee * 0.88), 'motorista recebe a taxa menos a comissão');
    assert.equal((await svc.bootstrap(caio)).profile.withdrawableBalance, Math.round(fee * 0.88) / 100, 'taxa é ganho: pode ir para Pix');
  });

  test('depois de 2 min: 100% vai para o motorista', async () => {
    const ride = await acceptedRide();
    sec(130);
    await svc.rideAction(ana, ride.id, { action: 'cancel' });
    assert.equal(cents(await balance(ana)), 10000 - cents(ride.price));
    assert.equal(cents(await balance(caio)), Math.round(cents(ride.price) * 0.88));
  });

  test('motorista já no embarque: 100% mesmo antes de 2 min', async () => {
    const ride = await acceptedRide();
    sec(40);
    await arrive(ride);
    await svc.rideAction(ana, ride.id, { action: 'cancel' });
    assert.equal(cents(await balance(ana)), 10000 - cents(ride.price));
  });

  test('motorista muito atrasado: cancelar volta a ser grátis', async () => {
    const ride = await acceptedRide();
    sec(60 * 60);
    await svc.rideAction(ana, ride.id, { action: 'cancel' });
    assert.equal(await balance(ana), 100);
  });

  test('motorista desistiu: passageiro não paga e o prazo recomeça com o próximo motorista', async () => {
    const ride = await acceptedRide();
    sec(150);
    await svc.rideAction(caio, ride.id, { action: 'cancel' });
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    sec(30);
    await svc.rideAction(ana, ride.id, { action: 'cancel' });
    assert.equal(await balance(ana), 100);
  });
});

describe('tempo de espera no embarque', () => {
  test('"cheguei" só vale perto do embarque e com localização ligada', async () => {
    const ride = await acceptedRide();
    await expectError(svc.rideAction(caio, ride.id, { action: 'arriving' }), 'location_required');
    await svc.updateLocation(caio, ride.origin.lat + 0.02, ride.origin.lng);
    await expectError(svc.rideAction(caio, ride.id, { action: 'arriving' }), 'too_far_from_pickup');
    await arrive(ride);
    const forPassenger = (await svc.bootstrap(ana)).rides.find((r) => r.id === ride.id)!;
    assert.equal(forPassenger.status, 'arriving');
    assert.ok(forPassenger.arrivedAt);
    assert.equal(forPassenger.messages.at(-1)?.sender, 'froc');
  });

  for (const [waitSec, pct] of [
    [40, 0],
    [70, 10],
    [130, 30],
    [200, 50],
    [600, 50],
  ] as const) {
    test(`esperou ${waitSec} s: +${pct}%`, async () => {
      const ride = await acceptedRide();
      await arrive(ride);
      sec(waitSec);
      await svc.rideAction(caio, ride.id, { action: 'start', pin: ride.pinCode });
      await svc.rideAction(caio, ride.id, { action: 'complete' });
      const extra = Math.round((cents(ride.price) * pct) / 100);
      assert.equal(cents(await balance(ana)), 10000 - cents(ride.price) - extra);
      assert.equal(cents(await balance(caio)), Math.round((cents(ride.price) + extra) * 0.88), 'acréscimo vai para o motorista');
      const done = (await svc.bootstrap(ana)).rides.find((r) => r.id === ride.id)!;
      assert.equal(done.waitingFeePercent ?? 0, pct);
    });
  }

  test('passageiro não apareceu: só depois de 5 min, e motorista recebe 100%', async () => {
    const ride = await acceptedRide();
    await arrive(ride);
    sec(4 * 60);
    await expectError(svc.rideAction(caio, ride.id, { action: 'no_show' }), 'too_early');
    await expectError(svc.rideAction(ana, ride.id, { action: 'no_show' }), 'forbidden');
    sec(60);
    const r = await svc.rideAction(caio, ride.id, { action: 'no_show' });
    assert.equal(r.status, 'cancelled');
    assert.equal(r.cancelledBy, 'no_show');
    assert.equal(cents(await balance(caio)), Math.round(cents(ride.price) * 0.88));
    assert.equal(cents(await balance(ana)), 10000 - cents(ride.price));
  });

  test('aceite das regras fica registrado', async () => {
    await acceptedRide();
    const u = await store.get<Record<string, unknown>>('users', ana.uid);
    assert.ok(u?.ridePolicyAcceptedAt);
  });
});

describe('negociação (inDrive)', () => {
  test('cancelar depois do acordo segue a mesma regra', async () => {
    await svc.createInDrive(ana, { ...SP, passengerOffer: 30 });
    const req = (await svc.bootstrap(ana)).indriveRequests[0];
    const withOffer = await svc.sendInDriveOffer(caio, req.id, { offeredPrice: 30, etaMin: 5 });
    await svc.acceptInDriveOffer(ana, req.id, withOffer.offers[0].id);
    sec(150);
    await svc.cancelInDrive(ana, req.id);
    assert.equal(await balance(ana), 70);
    assert.equal(cents(await balance(caio)), Math.round(3000 * 0.88));
  });
});
