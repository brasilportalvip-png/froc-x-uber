/**
 * Testes das regras de negócio com banco em memória.
 * Rodar: npm test   (usa o executor de testes do próprio Node, sem dependências extras)
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService, pixKeyKind } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { verifyMercadoPagoSignature } from '../server/mercadoPago.ts';
const LEGAL = { cnhExpiry: '2035-01-01', city: 'Campinas', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true, rntrc: true, ciotPiso: true, lei12009: true } };

const passenger: AuthUser = { uid: 'p1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' };
const other: AuthUser = { uid: 'p2', email: 'bia@exemplo.com', emailVerified: true, name: 'Bia' };
const driver: AuthUser = { uid: 'd1', email: 'caio@exemplo.com', emailVerified: true, name: 'Caio' };
const trucker: AuthUser = { uid: 't1', email: 'tonhao@exemplo.com', emailVerified: true, name: 'Tonhão' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };

let store: MemoryStore;
let svc: FrocService;
let approvedPayments: Map<string, number>;
const saved = new Map<string, number>();

const payments: PaymentsGateway = {
  configured: true,
  async createCheckout({ reference }) {
    return { checkoutUrl: 'https://www.mercadopago.com.br/checkout/' + reference, preferenceId: 'pref-' + reference };
  },
  async findApproved(reference) {
    const cents = approvedPayments.get(reference);
    return cents ? { paymentId: '123' + reference.length, amountCents: cents } : null;
  },
  async getPayment(id) {
    for (const [ref, cents] of approvedPayments) if ('123' + ref.length === id) return { reference: ref, status: 'approved', amountCents: cents };
    return null;
  },
};

async function expectError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof AppError && e.code === code);
}

async function topUp(user: AuthUser, reais: number) {
  const { topupId } = await svc.createTopup(user, reais);
  approvedPayments.set(topupId, Math.round(reais * 100));
  await svc.confirmTopup(topupId, user.uid);
}

async function balance(user: AuthUser) {
  return (await svc.bootstrap(user)).profile.walletBalance;
}

async function approve(user: AuthUser, kind: 'driver' | 'trucker') {
  for (const doc of kind === 'driver' ? ['cnh', 'crlv', 'antecedentes'] : ['cnh', 'crlv', 'antt', 'antecedentes'])
    await svc.uploadDocument(user, kind, doc, 'image/png', Buffer.from('foto').toString('base64'));
  await svc.applyAsProvider(user, kind, { ...LEGAL, phone: '(11) 98888-7777', vehicle: 'Onix Prata', plate: 'ABC1D23', truckType: 'Truck Baú', rntrc: '123456789' });
  await svc.reviewApplication(admin, user.uid, kind, 'approved', '');
}

const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };
const INTERCITY = { originId: 'sp-tiete', destinationId: 'br-campinas' };

beforeEach(async () => {
  store = new MemoryStore();
  approvedPayments = new Map();
  saved.clear();
  svc = new FrocService(store, {
    payments,
    adminEmails: ['dono@froc.com'],
    files: {
      async save(path, _type, bytes) {
        saved.set(path, bytes.length);
      },
      async signedUrl(path) {
        return 'https://arquivos.exemplo/' + path;
      },
    },
  });
  for (const u of [passenger, other, driver, trucker, admin]) await svc.ensureUser(u);
});

describe('contas e cadastro de motorista', () => {
  test('conta nova começa sem saldo e sem aprovação', async () => {
    const boot = await svc.bootstrap(passenger);
    assert.equal(boot.profile.walletBalance, 0);
    assert.equal(boot.profile.driverStatus, 'none');
    assert.equal(boot.rides.length, 0);
    assert.equal(boot.profile.isAdmin, false);
  });

  test('não pode atuar como motorista sem aprovação', async () => {
    await expectError(svc.updateProfile(driver, { driverOnline: true }), 'not_approved');
    await expectError(svc.publishCarpool(driver, { ...INTERCITY, date: 'Sábado', departureTime: '08:00', totalSeats: 3, pricePerSeat: 40 }), 'not_approved');
  });

  test('cadastro exige documentos, vai para análise e só o admin aprova', async () => {
    await expectError(svc.applyAsProvider(driver, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix', plate: 'ABC1D23' }), 'missing_documents');
    await svc.uploadDocument(driver, 'driver', 'cnh', 'image/jpeg', Buffer.from('x').toString('base64'));
    await svc.uploadDocument(driver, 'driver', 'crlv', 'application/pdf', Buffer.from('x').toString('base64'));
    await svc.uploadDocument(driver, 'driver', 'antecedentes', 'application/pdf', Buffer.from('x').toString('base64'));
    const profile = await svc.applyAsProvider(driver, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix Prata', plate: 'abc1d23' });
    assert.equal(profile.driverStatus, 'pending');
    assert.equal(profile.driverPlate, 'ABC1D23');
    await expectError(svc.reviewApplication(other, driver.uid, 'driver', 'approved', ''), 'forbidden');
    const overview = await svc.adminOverview(admin);
    assert.equal(overview.applications.length, 1);
    assert.equal(overview.applications[0].documents.length, 3);
    assert.match(overview.applications[0].documents[0].url, /^https:\/\/arquivos/);
    await svc.reviewApplication(admin, driver.uid, 'driver', 'approved', '');
    assert.equal((await svc.bootstrap(driver)).profile.driverStatus, 'approved');
  });

  test('admin precisa de e-mail verificado', async () => {
    await expectError(svc.adminOverview({ ...admin, emailVerified: false }), 'forbidden');
  });

  test('recusa exige motivo e permite reenviar', async () => {
    await svc.uploadDocument(driver, 'driver', 'cnh', 'image/png', 'eA==');
    await svc.uploadDocument(driver, 'driver', 'crlv', 'image/png', 'eA==');
    await svc.uploadDocument(driver, 'driver', 'antecedentes', 'image/png', 'eA==');
    await svc.applyAsProvider(driver, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix', plate: 'ABC1D23' });
    await expectError(svc.reviewApplication(admin, driver.uid, 'driver', 'rejected', ''), 'reason_required');
    await svc.reviewApplication(admin, driver.uid, 'driver', 'rejected', 'CNH ilegível');
    const p = (await svc.bootstrap(driver)).profile;
    assert.equal(p.driverStatus, 'rejected');
    assert.equal(p.rejectionReason, 'CNH ilegível');
    await svc.uploadDocument(driver, 'driver', 'cnh', 'image/png', 'eA==');
  });

  test('recusa arquivo grande ou de tipo errado', async () => {
    await expectError(svc.uploadDocument(driver, 'driver', 'cnh', 'text/html', 'eA=='), 'invalid_file');
    await expectError(svc.uploadDocument(driver, 'driver', 'cnh', 'image/png', Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64')), 'file_size');
  });
});

describe('carteira e Mercado Pago', () => {
  test('recarga só entra depois de aprovada e só uma vez', async () => {
    const { topupId, checkoutUrl } = await svc.createTopup(passenger, 50);
    assert.match(checkoutUrl, /^https:\/\//);
    assert.deepEqual(await svc.confirmTopup(topupId, passenger.uid), { status: 'pending' });
    assert.equal(await balance(passenger), 0);
    approvedPayments.set(topupId, 5000);
    await svc.confirmTopup(topupId, passenger.uid);
    await svc.confirmTopup(topupId, passenger.uid);
    await svc.handlePaymentNotification('123' + topupId.length);
    assert.equal(await balance(passenger), 50);
  });

  test('outra pessoa não confirma a recarga de alguém', async () => {
    const { topupId } = await svc.createTopup(passenger, 20);
    await expectError(svc.confirmTopup(topupId, other.uid), 'not_found');
  });

  test('valor pago diferente não credita', async () => {
    const { topupId } = await svc.createTopup(passenger, 100);
    approvedPayments.set(topupId, 100);
    await expectError(svc.confirmTopup(topupId, passenger.uid), 'amount_mismatch');
    assert.equal(await balance(passenger), 0);
  });

  test('sem Mercado Pago configurado, recarga é recusada (nada de saldo inventado)', async () => {
    const s = new FrocService(store, { payments: { ...payments, configured: false } });
    await expectError(s.createTopup(passenger, 50), 'payments_not_configured');
  });

  test('Pix: só os ganhos saem; recarga fica no app; admin pode recusar devolvendo', async () => {
    await topUp(passenger, 100);
    await expectError(svc.requestWithdrawal(passenger, 30, 'ana@pix.com'), 'nothing_to_withdraw');
    await approve(driver, 'driver');
    await topUp(driver, 100);
    await expectError(svc.requestWithdrawal(driver, 40, 'caio@pix.com'), 'nothing_to_withdraw');
    // Motorista ganha uma corrida de verdade.
    await svc.updateProfile(driver, { driverOnline: true });
    const ride = await svc.createRide(passenger, { ...SP, categoryId: 'froc_comfort' });
    await svc.rideAction(driver, ride.id, { action: 'driver_accept' });
    await svc.rideAction(driver, ride.id, { action: 'start', pin: ride.pinCode });
    await svc.rideAction(driver, ride.id, { action: 'complete' });
    const earned = Math.round((ride.price - (await feeOf(ride))) * 100) / 100;
    assert.equal((await svc.bootstrap(driver)).profile.withdrawableBalance, earned);
    await expectError(svc.requestWithdrawal(driver, earned + 1, 'caio@pix.com'), 'over_withdrawable');
    await expectError(svc.requestWithdrawal(driver, 20, 'isso não é chave'), 'invalid_pix_key');
    const { id } = await svc.requestWithdrawal(driver, 20, '123.456.789-09');
    assert.equal(await balance(driver), Math.round((100 + earned - 20) * 100) / 100);
    assert.equal((await svc.bootstrap(driver)).profile.withdrawableBalance, Math.round((earned - 20) * 100) / 100);
    await svc.resolveWithdrawal(admin, id, 'rejected');
    assert.equal((await svc.bootstrap(driver)).profile.withdrawableBalance, earned, 'recusado: volta para o que pode sacar');
    await expectError(svc.resolveWithdrawal(admin, id, 'paid'), 'not_pending');
  });

  test('tipo da chave Pix é reconhecido', () => {
    assert.equal(pixKeyKind('123.456.789-09'), 'cpf');
    assert.equal(pixKeyKind('11.222.333/0001-81'), 'cnpj');
    assert.equal(pixKeyKind('caio@pix.com'), 'email');
    assert.equal(pixKeyKind('(11) 98888-7777'), 'telefone');
    assert.equal(pixKeyKind('+55 11 98888-7777'), 'telefone');
    assert.equal(pixKeyKind('123e4567-e89b-12d3-a456-426614174000'), 'aleatoria');
    assert.equal(pixKeyKind('abc'), '');
  });
});

describe('1) corrida estilo Uber/99', () => {
  test('carteira: valor fica retido e vai 88% para o motorista no fim; PIN obrigatório', async () => {
    await approve(driver, 'driver');
    await svc.updateProfile(driver, { driverOnline: true });
    await topUp(passenger, 100);
    const ride = await svc.createRide(passenger, { ...SP, categoryId: 'froc_x', paymentMethod: 'froc_pay' });
    assert.equal(ride.status, 'searching');
    assert.equal(ride.driverName, undefined, 'nenhum motorista inventado');
    assert.match(ride.pinCode, /^\d{4}$/);
    assert.equal(await balance(passenger), Math.round((100 - ride.price) * 100) / 100);

    const queue = (await svc.bootstrap(driver)).rides;
    assert.equal(queue.length, 1);
    assert.equal(queue[0].pinCode, '', 'motorista não vê o PIN');

    await svc.rideAction(driver, ride.id, { action: 'driver_accept' });
    await expectError(svc.rideAction(driver, ride.id, { action: 'start', pin: '0000' }), 'wrong_pin');
    await expectError(svc.rideAction(passenger, ride.id, { action: 'complete' }), 'forbidden');
    await svc.rideAction(driver, ride.id, { action: 'start', pin: ride.pinCode });
    await svc.rideAction(driver, ride.id, { action: 'complete' });
    assert.equal(await balance(driver), Math.round((ride.price - (await feeOf(ride))) * 100) / 100, 'motorista recebe tudo menos a taxa fixa da Froc');
    assert.ok((await feeOf(ride)) >= 2 && (await feeOf(ride)) <= 8, 'Froc fica com R$ 2 a 8');

    await svc.rideAction(passenger, ride.id, { action: 'rate', stars: 4 });
    assert.equal((await svc.bootstrap(driver)).profile.rating, 4);
    await expectError(svc.rideAction(passenger, ride.id, { action: 'rate', stars: 5 }), 'invalid_state');
  });

  test('sem saldo não pede corrida; dinheiro na mão não existe mais', async () => {
    await expectError(svc.createRide(passenger, { ...SP, categoryId: 'froc_x', paymentMethod: 'froc_pay' }), 'insufficient_balance');
    await expectError(svc.createRide(passenger, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' }), 'cash_disabled');
    await expectError(svc.createInDrive(passenger, { ...SP, passengerOffer: 30, paymentMethod: 'cash' }), 'cash_disabled');
    await topUp(passenger, 100);
    const ride = await svc.createRide(passenger, { ...SP, categoryId: 'froc_x' });
    assert.equal(ride.paymentMethod, 'froc_pay', 'sem escolher, é a carteira');
    await expectError(svc.createRide(passenger, { ...SP, categoryId: 'froc_x', paymentMethod: 'froc_pay' }), 'ride_in_progress');
  });

  test('passageiro com R$ 100 pede corrida: sai do saldo na hora e cai no motorista ao finalizar', async () => {
    await approve(driver, 'driver');
    await svc.updateProfile(driver, { driverOnline: true });
    await topUp(passenger, 100);
    const ride = await svc.createRide(passenger, { ...SP, categoryId: 'froc_x' });
    assert.equal(await balance(passenger), Math.round((100 - ride.price) * 100) / 100, 'descontado no pedido');
    assert.equal(await balance(driver), 0, 'motorista ainda não recebe: a Froc guarda até finalizar');
    await svc.rideAction(driver, ride.id, { action: 'driver_accept' });
    await svc.rideAction(driver, ride.id, { action: 'start', pin: ride.pinCode });
    await svc.rideAction(driver, ride.id, { action: 'complete' });
    const cut = Math.round((ride.price - (await feeOf(ride))) * 100) / 100;
    assert.equal(await balance(driver), cut);
    const prof = (await svc.bootstrap(driver)).profile;
    assert.equal(prof.withdrawableBalance, cut, 'ganho pode ir para Pix');
  });

  test('corrida antiga em dinheiro (criada antes da mudança) ainda finaliza: taxa sai da carteira do motorista', async () => {
    await approve(driver, 'driver');
    await svc.updateProfile(driver, { driverOnline: true });
    await topUp(passenger, 100);
    const ride = await svc.createRide(passenger, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(passenger, ride.id, { action: 'cancel' });
    // Simula um pedido antigo, gravado em dinheiro antes da atualização.
    await store.set('rides', 'antiga', { ...(await store.get<Record<string, unknown>>('rides', ride.id)), id: 'antiga', status: 'searching', paymentMethod: 'cash', escrowCents: 0, priceCents: Math.round(ride.price * 100) });
    await svc.rideAction(driver, 'antiga', { action: 'driver_accept' });
    await svc.rideAction(driver, 'antiga', { action: 'start', pin: ride.pinCode });
    await svc.rideAction(driver, 'antiga', { action: 'complete' });
    const fee = Math.round(ride.price * 100) - Math.round(Math.round(ride.price * 100) * 0.88);
    assert.equal(await balance(driver), -fee / 100);
  });

  test('cancelamento do passageiro devolve; desistência do motorista volta para a fila', async () => {
    await approve(driver, 'driver');
    await svc.updateProfile(driver, { driverOnline: true });
    await topUp(passenger, 100);
    const ride = await svc.createRide(passenger, { ...SP, categoryId: 'froc_99', paymentMethod: 'froc_pay' });
    await svc.rideAction(driver, ride.id, { action: 'driver_accept' });
    const back = await svc.rideAction(driver, ride.id, { action: 'cancel' });
    assert.equal(back.status, 'searching');
    await svc.rideAction(passenger, ride.id, { action: 'cancel' });
    assert.equal(await balance(passenger), 100);
  });

  test('só um motorista aceita; motorista offline ou dono não aceitam', async () => {
    await approve(driver, 'driver');
    await approve(other, 'driver');
    await topUp(passenger, 100);
    const ride = await svc.createRide(passenger, { ...SP, categoryId: 'froc_x', paymentMethod: 'froc_pay' });
    await expectError(svc.rideAction(driver, ride.id, { action: 'driver_accept' }), 'offline');
    await svc.updateProfile(driver, { driverOnline: true });
    await svc.updateProfile(other, { driverOnline: true });
    await Promise.allSettled([
      svc.rideAction(driver, ride.id, { action: 'driver_accept' }),
      svc.rideAction(other, ride.id, { action: 'driver_accept' }),
    ]);
    const stored = await store.get<Record<string, unknown>>('rides', ride.id);
    assert.ok(stored?.driverId === driver.uid || stored?.driverId === other.uid);
    const loser = stored?.driverId === driver.uid ? other : driver;
    await expectError(svc.rideAction(loser, ride.id, { action: 'driver_accept' }), 'taken');
  });

  test('chat só entre passageiro e motorista da corrida', async () => {
    await topUp(passenger, 100);
    const ride = await svc.createRide(passenger, { ...SP, categoryId: 'froc_x', paymentMethod: 'froc_pay' });
    const r = await svc.rideAction(passenger, ride.id, { action: 'message', message: 'Estou de azul' });
    assert.equal(r.messages.length, 1);
    await expectError(svc.rideAction(other, ride.id, { action: 'message', message: 'oi' }), 'forbidden');
  });
});

describe('2) negociação estilo inDrive', () => {
  test('motoristas mandam proposta, passageiro escolhe, valor retido e liberado', async () => {
    await approve(driver, 'driver');
    await approve(other, 'driver');
    await topUp(passenger, 60);
    const req = await svc.createInDrive(passenger, { ...SP, passengerOffer: 20, paymentMethod: 'froc_pay' });
    assert.equal(req.offers.length, 0, 'nenhuma proposta inventada');
    await svc.sendInDriveOffer(driver, req.id, { offeredPrice: 25, etaMin: 4 });
    await svc.sendInDriveOffer(driver, req.id, { offeredPrice: 23, etaMin: 4 });
    await svc.sendInDriveOffer(other, req.id, { offeredPrice: 21, etaMin: 6 });
    const seenByDriver = (await svc.bootstrap(driver)).indriveRequests.find((r) => r.id === req.id)!;
    assert.equal(seenByDriver.offers.length, 1, 'motorista só vê a própria proposta');
    const mine = (await svc.bootstrap(passenger)).indriveRequests.find((r) => r.id === req.id)!;
    assert.equal(mine.offers.length, 2);
    const cheapest = mine.offers.find((o) => o.offeredPrice === 21)!;
    await svc.acceptInDriveOffer(passenger, req.id, cheapest.id);
    assert.equal(await balance(passenger), 39);
    await expectError(svc.completeInDrive(driver, req.id), 'forbidden');
    await svc.completeInDrive(other, req.id);
    const feeCents = Number((await store.get<Record<string, unknown>>('indrive', req.id))!.platformFeeCents);
    assert.ok(feeCents >= 200 && feeCents <= 800);
    assert.equal(await balance(other), (2100 - feeCents) / 100);
  });

  test('cancelar depois de aceitar devolve o valor', async () => {
    await approve(driver, 'driver');
    await topUp(passenger, 30);
    const req = await svc.createInDrive(passenger, { ...SP, passengerOffer: 20, paymentMethod: 'froc_pay' });
    const after = await svc.sendInDriveOffer(driver, req.id, { offeredPrice: 22 });
    await svc.acceptInDriveOffer(passenger, req.id, after.offers[0].id);
    await svc.cancelInDrive(passenger, req.id);
    assert.equal(await balance(passenger), 30);
  });
});

describe('3) caronas estilo BlaBlaCar', () => {
  test('reserva desconta vagas e saldo; concluir paga o motorista; cancelar devolve', async () => {
    await approve(driver, 'driver');
    await topUp(passenger, 200);
    await topUp(other, 200);
    const trip = await svc.publishCarpool(driver, { ...INTERCITY, date: 'Sábado 20/12', departureTime: '07:30', totalSeats: 3, pricePerSeat: 40 });
    await svc.bookCarpool(passenger, trip.id, 2);
    await expectError(svc.bookCarpool(other, trip.id, 2), 'no_seats');
    await svc.bookCarpool(other, trip.id, 1);
    await svc.cancelCarpoolBooking(other, trip.id);
    assert.equal(await balance(other), 200);
    const driverView = (await svc.bootstrap(driver)).carpools.find((c) => c.id === trip.id)!;
    assert.deepEqual(driverView.passengers, [{ name: 'Ana', seats: 2, phone: '' }]);
    const seenByOther = (await svc.bootstrap(other)).carpools.find((c) => c.id === trip.id)!;
    assert.equal(seenByOther.driverPhone, undefined, 'telefone do motorista só para quem reservou');
    assert.equal(driverView.availableSeats, 1);
    await svc.finishCarpool(driver, trip.id, 'completed');
    assert.equal(await balance(driver), 70.4);
    assert.equal(await balance(passenger), 120);
  });

  test('motorista cancela a carona e todos recebem de volta', async () => {
    await approve(driver, 'driver');
    await topUp(passenger, 100);
    const trip = await svc.publishCarpool(driver, { ...INTERCITY, date: 'Domingo', departureTime: '10:00', totalSeats: 2, pricePerSeat: 35 });
    await svc.bookCarpool(passenger, trip.id, 1);
    await svc.finishCarpool(driver, trip.id, 'cancelled');
    assert.equal(await balance(passenger), 100);
    await expectError(svc.bookCarpool(other, trip.id, 1), 'closed');
  });
});

describe('4) caminhões vazios e fretes/mudanças', () => {
  test('rota de retorno vazio: reservar, entregar e receber', async () => {
    await approve(trucker, 'trucker');
    await topUp(passenger, 2000);
    const route = await svc.publishEmptyTruck(trucker, {
      ...INTERCITY,
      direction: 'voltando_vazio',
      availableTons: 10,
      availableCubicM: 40,
      emptyReturnPrice: 900,
      departureDate: 'Amanhã 06:00',
    });
    assert.equal(route.truckType, 'Truck Baú');
    await expectError(svc.reserveEmptyTruck(trucker, route.id), 'own_route');
    await svc.reserveEmptyTruck(passenger, route.id);
    await expectError(svc.reserveEmptyTruck(other, route.id), 'taken');
    await expectError(svc.finishEmptyTruck(passenger, route.id, 'complete'), 'forbidden');
    await svc.finishEmptyTruck(trucker, route.id, 'complete');
    assert.equal(await balance(trucker), 792);
    assert.equal(await balance(passenger), 1100);
  });

  test('mudança: lances só de caminhoneiro aprovado, contratar retém, entrega libera', async () => {
    await approve(trucker, 'trucker');
    await topUp(passenger, 2000);
    const freight = await svc.createFreight(passenger, {
      ...INTERCITY,
      kind: 'mudanca_residencial',
      title: 'Mudança 2 quartos',
      truckTypeNeeded: '3/4 Baú',
      estimatedWeightKg: 1500,
      helpersNeeded: 2,
      proposedBudget: 1300,
      scheduledDate: 'Sábado 08:00',
    });
    assert.equal(freight.bids.length, 0, 'nenhum lance inventado');
    await expectError(svc.bidFreight(driver, freight.id, { price: 1000 }), 'not_approved');
    const withBid = await svc.bidFreight(trucker, freight.id, { price: 1250, helpersIncluded: 2 });
    await svc.acceptFreightBid(passenger, freight.id, withBid.bids[0].id);
    assert.equal(await balance(passenger), 750);
    await svc.finishFreight(trucker, freight.id, 'deliver');
    assert.equal(await balance(trucker), 1100);
  });

  test('cliente cancela frete contratado e recebe de volta', async () => {
    await approve(trucker, 'trucker');
    await topUp(passenger, 1000);
    const f = await svc.createFreight(passenger, { ...INTERCITY, estimatedWeightKg: 300, proposedBudget: 500, scheduledDate: 'Terça' });
    const b = await svc.bidFreight(trucker, f.id, { price: 480 });
    await svc.acceptFreightBid(passenger, f.id, b.bids[0].id);
    await svc.finishFreight(passenger, f.id, 'cancel');
    assert.equal(await balance(passenger), 1000);
  });
});

describe('aviso automático do Mercado Pago', () => {
  test('assinatura válida é aceita e inválida é recusada', () => {
    const secret = 'segredo-teste';
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = createHmac('sha256', secret).update(`id:123;request-id:req-1;ts:${ts};`).digest('hex');
    assert.equal(verifyMercadoPagoSignature({ secret, signatureHeader: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '123' }), true);
    assert.equal(verifyMercadoPagoSignature({ secret, signatureHeader: `ts=${ts},v1=${v1}`, requestId: 'req-2', dataId: '123' }), false);
    assert.equal(verifyMercadoPagoSignature({ secret: '', signatureHeader: `ts=${ts},v1=${v1}`, dataId: '123' }), false);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const v1old = createHmac('sha256', secret).update(`id:123;ts:${old};`).digest('hex');
    assert.equal(verifyMercadoPagoSignature({ secret, signatureHeader: `ts=${old},v1=${v1old}`, dataId: '123' }), false);
  });
});

/** Ganho da Froc (sigiloso: só existe no banco, nunca na resposta ao app). */
async function feeOf(r: { id: string }) {
  return Number((await store.get<Record<string, unknown>>('rides', r.id))!.platformFeeCents) / 100;
}
