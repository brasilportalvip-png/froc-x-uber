/**
 * v4: regras legais no cadastro, carros por perto, link de acompanhamento, gravação,
 * Froc Entregas (lojas, API, webhooks) e páginas de regras/ajuda.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import {
  authenticateApiKey,
  createApiKey,
  createWebhookDispatcher,
  isValidCnpj,
  listApiKeys,
  revokeApiKey,
  sha256,
  signWebhook,
  validateWebhookUrl,
  verifyWebhookSignature,
} from '../server/merchants.ts';
import { minVehicleYear, vehicleAgeLimit, legalKnowledgeText, FAQ } from '../src/data/legal.ts';
import { renderDevelopers, renderFaq, renderHowItWorks, renderRules } from '../server/guidePages.ts';
import { sitemapPages } from '../server/blog.ts';
import { platformKnowledge } from '../server/ai/persona.ts';
import { DEFAULT_SETTINGS } from '../server/settings.ts';

const DECL = { ear: true, inss: true, seguroApp: true, veracidade: true, rntrc: true, ciotPiso: true, lei12009: true };
const LEGAL = { cnhExpiry: '2035-01-01', city: 'Campinas', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: DECL };

const ana: AuthUser = { uid: 'p1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana Paula' };
const bia: AuthUser = { uid: 'p2', email: 'bia@exemplo.com', emailVerified: true, name: 'Bia' };
const caio: AuthUser = { uid: 'd1', email: 'caio@exemplo.com', emailVerified: true, name: 'Caio Souza' };
const moto: AuthUser = { uid: 'd2', email: 'moto@exemplo.com', emailVerified: true, name: 'Duda Moto' };
const ricardo: AuthUser = { uid: 'm1', email: 'ricardo@pastelaria.com', emailVerified: true, name: 'Ricardo' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };

const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };
const PAULISTA = { lat: -23.5614, lng: -46.6559 };
const VALID_CNPJ = '11.222.333/0001-81';

let store: MemoryStore;
let svc: FrocService;
let clock: number;
let approved: Map<string, number>;
let sent: { url: string; headers: Record<string, string>; body: string }[];
let failNext = 0;

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

const fakeFetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
  sent.push({ url, headers: init.headers, body: init.body });
  if (failNext > 0) {
    failNext--;
    return new Response('erro', { status: 500 });
  }
  return new Response('ok', { status: 200 });
}) as unknown as typeof fetch;

async function expectError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof AppError && e.code === code);
}
async function topUp(u: AuthUser, reais: number) {
  const { topupId } = await svc.createTopup(u, reais);
  approved.set(topupId, Math.round(reais * 100));
  await svc.confirmTopup(topupId, u.uid);
}
const balance = async (u: AuthUser) => (await svc.bootstrap(u)).profile.walletBalance;
async function docs(u: AuthUser, kind: 'driver' | 'trucker') {
  for (const d of kind === 'driver' ? ['cnh', 'crlv', 'antecedentes'] : ['cnh', 'crlv', 'antt', 'antecedentes']) await svc.uploadDocument(u, kind, d, 'image/png', 'eA==');
}
async function approveDriver(u: AuthUser, extra: Record<string, unknown> = {}) {
  await docs(u, 'driver');
  await svc.applyAsProvider(u, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix Prata', plate: 'ABC1D23', ...extra });
  await svc.reviewApplication(admin, u.uid, 'driver', 'approved', '');
  await svc.updateProfile(u, { driverOnline: true });
}
const PICKUP = { name: 'Pastelaria do Ricardo · Av. Paulista, 1000', city: 'São Paulo', state: 'SP', lat: -23.5614, lng: -46.6559 };
async function approveMerchant(webhookUrl = 'https://pastelaria.com.br/froc') {
  await svc.applyAsMerchant(ricardo, {
    companyName: 'Pastelaria do Ricardo',
    cnpj: VALID_CNPJ,
    phone: '11977776666',
    category: 'pastelaria',
    pickup: PICKUP,
    declarations: { responsavel: true, proibidos: true, veracidade: true },
  });
  await svc.reviewApplication(admin, ricardo.uid, 'merchant', 'approved', '');
  if (webhookUrl) return svc.setMerchantWebhook(ricardo, webhookUrl);
  return null;
}
const DROP = { address: 'Rua Augusta, 500 - apto 32', lat: -23.5531, lng: -46.6537 };

beforeEach(async () => {
  clock = Date.parse('2026-11-16T15:00:00Z');
  approved = new Map();
  sent = [];
  failNext = 0;
  store = new MemoryStore();
  svc = new FrocService(store, {
    now: () => new Date(clock),
    payments,
    adminEmails: ['dono@froc.com'],
    geo: createGridGeo(),
    files: { async save() {}, async signedUrl(p) { return 'https://x/' + p; } },
    webhooks: createWebhookDispatcher(store, fakeFetch, () => new Date(clock)),
  });
  for (const u of [ana, bia, caio, moto, ricardo, admin]) await svc.ensureUser(u);
});

describe('regras legais no cadastro', () => {
  test('idade do veículo: regra da cidade mais rígida prevalece', () => {
    assert.equal(vehicleAgeLimit('São Paulo', 'SP', 10).maxYears, 8);
    assert.equal(vehicleAgeLimit('sao paulo', 'sp', 10).maxYears, 8, 'sem acento e minúsculo também');
    assert.equal(vehicleAgeLimit('Campinas', 'SP', 10).maxYears, 10);
    assert.equal(vehicleAgeLimit('Recife', 'PE', 12).maxYears, 12);
    assert.equal(vehicleAgeLimit('São Paulo', 'SP', 6).maxYears, 6, 'Froc mais rígida vale');
    assert.equal(minVehicleYear(10, new Date('2026-06-01')), 2016);
  });

  test('carro antigo demais para a cidade é recusado', async () => {
    await docs(caio, 'driver');
    await expectError(
      svc.applyAsProvider(caio, 'driver', { ...LEGAL, city: 'São Paulo', state: 'SP', vehicleYear: 2017, phone: '11988887777', vehicle: 'Onix', plate: 'ABC1D23' }),
      'vehicle_too_old',
    );
    const p = await svc.applyAsProvider(caio, 'driver', { ...LEGAL, city: 'Campinas', state: 'SP', vehicleYear: 2017, phone: '11988887777', vehicle: 'Onix', plate: 'ABC1D23' });
    assert.equal(p.driverStatus, 'pending');
  });

  test('exige antecedentes, declarações, CNH válida e cidade', async () => {
    await svc.uploadDocument(caio, 'driver', 'cnh', 'image/png', 'eA==');
    await svc.uploadDocument(caio, 'driver', 'crlv', 'image/png', 'eA==');
    const base = { ...LEGAL, phone: '11988887777', vehicle: 'Onix', plate: 'ABC1D23' };
    await expectError(svc.applyAsProvider(caio, 'driver', base), 'missing_documents');
    await svc.uploadDocument(caio, 'driver', 'antecedentes', 'application/pdf', 'eA==');
    await expectError(svc.applyAsProvider(caio, 'driver', { ...base, declarations: { ...DECL, ear: false } }), 'missing_declarations');
    await expectError(svc.applyAsProvider(caio, 'driver', { ...base, cnhExpiry: '2025-01-01' }), 'cnh_expired');
    await expectError(svc.applyAsProvider(caio, 'driver', { ...base, cnhExpiry: '' }), 'invalid_cnh_expiry');
    await expectError(svc.applyAsProvider(caio, 'driver', { ...base, city: '' }), 'invalid_city');
    await expectError(svc.applyAsProvider(caio, 'driver', { ...base, vehicleType: 'patinete' }), 'invalid_vehicle_type');
    await expectError(svc.applyAsProvider(caio, 'driver', { ...base, vehicleType: 'moto', declarations: { ...DECL, lei12009: false } }), 'missing_declarations');
    const p = await svc.applyAsProvider(caio, 'driver', base);
    assert.equal(p.driverStatus, 'pending');
    const app = (await svc.adminOverview(admin)).applications[0];
    assert.equal(app.vehicleYear, 2022);
    assert.equal(app.city, 'Campinas');
    assert.ok(app.declarations?.ear);
    assert.equal(app.documents.length, 3);
  });

  test('transportador declara CIOT e piso da ANTT', async () => {
    await docs(caio, 'trucker');
    const base = { ...LEGAL, phone: '11988887777', vehicle: 'VW Delivery', plate: 'QWE1R23', truckType: 'Truck Baú', rntrc: '123456789' };
    await expectError(svc.applyAsProvider(caio, 'trucker', { ...base, declarations: { ear: true, rntrc: true, veracidade: true } }), 'missing_declarations');
    assert.equal((await svc.applyAsProvider(caio, 'trucker', base)).truckerStatus, 'pending');
  });

  test('CNH vencida deixa o motorista offline', async () => {
    await approveDriver(caio, { cnhExpiry: '2027-01-10' });
    await svc.updateProfile(caio, { driverOnline: false });
    clock = Date.parse('2027-02-01T12:00:00Z');
    await expectError(svc.updateProfile(caio, { driverOnline: true }), 'cnh_expired');
  });

  test('moto só pega Froc Moto e entregas; carro não pega Froc Moto', async () => {
    await approveDriver(caio);
    await approveDriver(moto, { vehicleType: 'moto', vehicle: 'CG 160 Vermelha', plate: 'MOT1A23' });
    const carRide = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    const motoRide = await svc.createRide(bia, { ...SP, categoryId: 'froc_moto', paymentMethod: 'cash' });
    const motoView = (await svc.bootstrap(moto)).rides.map((r) => r.id);
    assert.ok(motoView.includes(motoRide.id) && !motoView.includes(carRide.id));
    const carView = (await svc.bootstrap(caio)).rides.map((r) => r.id);
    assert.ok(carView.includes(carRide.id) && !carView.includes(motoRide.id));
    await expectError(svc.rideAction(caio, motoRide.id, { action: 'driver_accept' }), 'wrong_vehicle');
    await svc.rideAction(moto, motoRide.id, { action: 'driver_accept' });
  });

  test('qualidade: nota baixa com 20+ avaliações marca revisão', async () => {
    await approveDriver(caio);
    await store.update('users', caio.uid, { rating: 4.4, ratingCount: 19 });
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await svc.rideAction(caio, ride.id, { action: 'start', pin: (await svc.bootstrap(ana)).rides[0].pinCode });
    await svc.rideAction(caio, ride.id, { action: 'complete' });
    await svc.rideAction(ana, ride.id, { action: 'rate', stars: 3 });
    const u = await store.get<Record<string, unknown>>('users', caio.uid);
    assert.match(String(u?.qualityAlert), /20 avaliações/);
  });
});

describe('mapa: carros por perto', () => {
  test('mostra motoristas próximos com posição deslocada e id anônimo', async () => {
    await approveDriver(caio);
    await approveDriver(moto, { vehicleType: 'moto', vehicle: 'CG 160', plate: 'MOT1A23' });
    await svc.updateLocation(caio, PAULISTA.lat + 0.001, PAULISTA.lng);
    await svc.updateLocation(caio, PAULISTA.lat + 0.002, PAULISTA.lng);
    await svc.updateLocation(moto, -22.9, -47.06); // Campinas: longe
    const { drivers } = await svc.nearbyDrivers(ana, PAULISTA.lat, PAULISTA.lng);
    assert.equal(drivers.length, 1);
    const d = drivers[0];
    assert.notEqual(d.id, caio.uid);
    assert.equal(d.kind, 'carro');
    assert.equal(d.heading, 0, 'andou para o norte');
    const offM = Math.hypot((d.lat - (PAULISTA.lat + 0.002)) * 111_000, (d.lng - PAULISTA.lng) * 102_000);
    assert.ok(offM <= 180, `deslocamento de privacidade pequeno (${Math.round(offM)} m)`);
    assert.ok(offM > 0, 'posição exata não é exposta');
    assert.equal((await svc.nearbyDrivers(caio, PAULISTA.lat, PAULISTA.lng)).drivers.length, 0, 'não vê a si mesmo');
  });

  test('localização antiga some do mapa', async () => {
    await approveDriver(caio);
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
    clock += 10 * 60_000;
    assert.equal((await svc.nearbyDrivers(ana, PAULISTA.lat, PAULISTA.lng)).drivers.length, 0);
  });

  test('corrida em andamento recebe a direção do carro', async () => {
    await approveDriver(caio);
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng + 0.002);
    const mine = (await svc.bootstrap(ana)).rides.find((r) => r.id === ride.id)!;
    assert.equal(mine.driverLocation?.heading, 90, 'andou para o leste');
  });
});

describe('compartilhar a viagem por link', () => {
  test('link mostra só o necessário e para de mostrar a posição no fim', async () => {
    await approveDriver(caio);
    await store.update('users', caio.uid, { phone: '11911112222' });
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    await expectError(svc.shareTrip(bia, 'ride', ride.id), 'forbidden');
    const share = await svc.shareTrip(ana, 'ride', ride.id);
    assert.match(share.path, /^\/acompanhar\/[A-Za-z0-9_-]{24}$/);
    assert.equal((await svc.shareTrip(ana, 'ride', ride.id)).token, share.token, 'reaproveita o link');
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
    const t = await svc.trackShare(share.token);
    assert.equal(t.active, true);
    assert.equal(t.driver?.firstName, 'Caio');
    assert.equal(t.passengerFirstName, 'Ana');
    assert.ok(t.location);
    const raw = JSON.stringify(t);
    for (const secret of ['11911112222', 'caio@exemplo.com', 'ana@exemplo.com', 'pinCode', 'price', 'Souza'])
      assert.ok(!raw.includes(secret), `não vaza ${secret}`);
    await svc.rideAction(caio, ride.id, { action: 'start', pin: (await svc.bootstrap(ana)).rides[0].pinCode });
    await svc.rideAction(caio, ride.id, { action: 'complete' });
    const done = await svc.trackShare(share.token);
    assert.equal(done.active, false);
    assert.equal(done.location, null);
    clock += 3 * 3600_000;
    await expectError(svc.trackShare(share.token), 'expired');
    await expectError(svc.trackShare('x'), 'not_found');
    await expectError(svc.trackShare('A'.repeat(24)), 'expired');
  });

  test('viagem já encerrada não gera link', async () => {
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    await svc.rideAction(ana, ride.id, { action: 'cancel' });
    await expectError(svc.shareTrip(ana, 'ride', ride.id), 'trip_ended');
  });
});

describe('gravação da viagem', () => {
  test('quem grava avisa a outra parte; quem não participa não mexe', async () => {
    await approveDriver(caio);
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', paymentMethod: 'cash' });
    await expectError(svc.recordingNotice(ana, 'ride', ride.id, 'audio'), 'invalid_state');
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await svc.recordingNotice(ana, 'ride', ride.id, 'video');
    const forDriver = (await svc.bootstrap(caio)).rides.find((r) => r.id === ride.id)!;
    assert.equal(forDriver.recording?.passenger?.mode, 'video');
    assert.match(forDriver.messages.at(-1)!.text, /gravar em vídeo/);
    await expectError(svc.recordingNotice(bia, 'ride', ride.id, 'audio'), 'forbidden');
    await svc.recordingNotice(ana, 'ride', ride.id, 'off');
    assert.equal((await svc.bootstrap(caio)).rides.find((r) => r.id === ride.id)!.recording?.passenger, null);
  });
});

describe('Froc Entregas (lojas)', () => {
  test('CNPJ e webhook são validados', () => {
    assert.equal(isValidCnpj(VALID_CNPJ), true);
    assert.equal(isValidCnpj('11.222.333/0001-82'), false);
    assert.equal(isValidCnpj('00000000000000'), false);
    assert.equal(validateWebhookUrl('https://loja.com.br/hook'), 'https://loja.com.br/hook');
    for (const bad of ['http://loja.com.br/x', 'https://localhost/x', 'https://10.0.0.5/x', 'https://192.168.0.2/x', 'https://[::1]/x', 'https://intranet/x', 'https://user:pw@loja.com/x'])
      assert.throws(() => validateWebhookUrl(bad), AppError, bad);
  });

  test('cadastro da loja passa pela aprovação do admin', async () => {
    await expectError(svc.applyAsMerchant(ricardo, { companyName: 'Loja X', cnpj: '123', phone: '11977776666', pickup: PICKUP, declarations: { responsavel: true, proibidos: true, veracidade: true } }), 'invalid_cnpj');
    await expectError(svc.createDelivery(ricardo.uid, { dropoff: DROP, recipient: { name: 'Maria', phone: '11999990000' } }, 'api'), 'merchant_not_approved');
    await svc.applyAsMerchant(ricardo, { companyName: 'Pastelaria do Ricardo', cnpj: VALID_CNPJ, phone: '11977776666', pickup: PICKUP, declarations: { responsavel: true, proibidos: true, veracidade: true } });
    const app = (await svc.adminOverview(admin)).applications.find((a) => a.kind === 'merchant')!;
    assert.equal(app.cnpj, VALID_CNPJ);
    await svc.reviewApplication(admin, ricardo.uid, 'merchant', 'approved', '');
    assert.equal((await svc.bootstrap(ricardo)).profile.merchantStatus, 'approved');
    await expectError(svc.applyAsMerchant(bia, { companyName: 'Outra', cnpj: VALID_CNPJ, phone: '11977776666', pickup: PICKUP, declarations: { responsavel: true, proibidos: true, veracidade: true } }), 'cnpj_in_use');
  });

  test('entrega completa: cobra a loja, entregador coleta e só conclui com o código do cliente', async () => {
    const hook = await approveMerchant();
    assert.match(String(hook?.secret), /^whsec_/);
    await approveDriver(moto, { vehicleType: 'moto', vehicle: 'CG 160', plate: 'MOT1A23' });
    await expectError(svc.createDelivery(ricardo.uid, { dropoff: DROP, recipient: { name: 'Maria', phone: '11999990000' } }, 'api'), 'insufficient_balance');
    await topUp(ricardo, 100);
    const d = await svc.createDelivery(ricardo.uid, { orderRef: 'PED-1', dropoff: DROP, recipient: { name: 'Maria Souza', phone: '11999990000' }, items: '2 pastéis', vehicle: 'moto' }, 'api');
    assert.equal(d.status, 'procurando_entregador');
    assert.match(d.deliveryCode, /^\d{4}$/);
    assert.match(d.trackingPath, /^\/acompanhar\//);
    assert.equal(await balance(ricardo), Math.round((100 - d.price) * 100) / 100);
    const again = await svc.createDelivery(ricardo.uid, { orderRef: 'PED-1', dropoff: DROP, recipient: { name: 'Maria Souza', phone: '11999990000' } }, 'api');
    assert.equal(again.id, d.id, 'mesmo pedido não cobra duas vezes');

    // Na fila do entregador: sem telefone do cliente e sem código.
    const queued = (await svc.bootstrap(moto)).rides.find((r) => r.id === d.id)!;
    assert.equal(queued.delivery?.recipientPhone, undefined);
    assert.equal(queued.deliveryPin, undefined);
    // A entrega não aparece como "minha corrida" para a loja.
    assert.equal((await svc.bootstrap(ricardo)).rides.length, 0);
    assert.equal((await svc.bootstrap(ricardo)).deliveries?.length, 1);

    await svc.rideAction(moto, d.id, { action: 'driver_accept' });
    const accepted = (await svc.bootstrap(moto)).rides.find((r) => r.id === d.id)!;
    assert.equal(accepted.delivery?.recipientPhone, '11999990000');
    await svc.rideAction(moto, d.id, { action: 'start' }); // coletou, sem PIN
    await expectError(svc.rideAction(moto, d.id, { action: 'complete', pin: '0000' === d.deliveryCode ? '1111' : '0000' }), 'wrong_pin');
    await svc.rideAction(moto, d.id, { action: 'complete', pin: d.deliveryCode });
    assert.equal((await svc.getDelivery(ricardo.uid, d.id)).status, 'entregue');
    assert.ok((await balance(moto)) > 0, 'entregador recebeu');
    await expectError(svc.getDelivery(bia.uid, d.id), 'not_found');

    const events = sent.map((s) => JSON.parse(s.body).type);
    assert.deepEqual(events, ['delivery.created', 'delivery.courier_assigned', 'delivery.picked_up', 'delivery.delivered']);
    for (const s of sent) assert.ok(verifyWebhookSignature(String(hook?.secret), s.body, s.headers['X-Froc-Signature'], 300, Math.floor(clock / 1000)));
  });

  test('carro não pega entrega pedida para moto; cancelamento devolve; sem entregador cancela sozinho', async () => {
    await approveMerchant('');
    await approveDriver(caio);
    await topUp(ricardo, 100);
    const d1 = await svc.createDelivery(ricardo.uid, { dropoff: DROP, recipient: { name: 'Maria', phone: '11999990000' }, vehicle: 'moto' }, 'painel');
    await expectError(svc.rideAction(caio, d1.id, { action: 'driver_accept' }), 'wrong_vehicle');
    await svc.cancelDelivery(ricardo.uid, d1.id);
    assert.equal(await balance(ricardo), 100);
    const d2 = await svc.createDelivery(ricardo.uid, { dropoff: DROP, recipient: { name: 'João', phone: '11999990001' } }, 'painel');
    clock += 15 * 60_000;
    await svc.sweep(true);
    assert.equal((await svc.getDelivery(ricardo.uid, d2.id)).status, 'procurando_entregador', 'entrega espera mais que corrida');
    clock += 6 * 60_000;
    await svc.sweep(true);
    assert.equal((await svc.getDelivery(ricardo.uid, d2.id)).status, 'cancelada');
    assert.equal(await balance(ricardo), 100);
  });

  test('entrega longe demais e endereço sem coordenadas são recusados', async () => {
    await approveMerchant('');
    await topUp(ricardo, 100);
    await expectError(svc.createDelivery(ricardo.uid, { dropoff: { address: 'Campinas', lat: -22.9, lng: -47.06 }, recipient: { name: 'Maria', phone: '11999990000' } }, 'api'), 'too_far');
    await expectError(svc.createDelivery(ricardo.uid, { dropoff: { address: 'Rua Augusta, 500' }, recipient: { name: 'Maria', phone: '11999990000' } }, 'api'), 'missing_coordinates');
    await expectError(svc.createDelivery(ricardo.uid, { dropoff: DROP, recipient: { name: 'Maria', phone: '123' } }, 'api'), 'invalid_recipient_phone');
  });

  test('chaves de API: só o hash fica no banco, revogada para de funcionar, máximo 5', async () => {
    const { key, id } = await createApiKey(store, ricardo.uid, 'Caixa');
    assert.match(key, /^froc_live_/);
    assert.equal(id, sha256(key));
    assert.ok(!JSON.stringify(store.data.get('api_keys')?.get(id)).includes(key), 'chave em texto não é guardada');
    assert.equal((await authenticateApiKey(store, `Bearer ${key}`)).uid, ricardo.uid);
    await expectError(authenticateApiKey(store, 'Bearer froc_live_inventada_aaaaaaaaaaaaaaaaaaaaa'), 'invalid_api_key');
    await expectError(authenticateApiKey(store, ''), 'invalid_api_key');
    await expectError(revokeApiKey(store, bia.uid, id), 'not_found');
    await revokeApiKey(store, ricardo.uid, id);
    await expectError(authenticateApiKey(store, `Bearer ${key}`), 'invalid_api_key');
    for (let i = 0; i < 5; i++) await createApiKey(store, ricardo.uid, `k${i}`);
    await expectError(createApiKey(store, ricardo.uid, 'sexta'), 'too_many_keys');
    assert.equal((await listApiKeys(store, ricardo.uid)).length, 6);
  });

  test('webhook que falhou é reenviado depois', async () => {
    await approveMerchant();
    await topUp(ricardo, 100);
    failNext = 1;
    await svc.createDelivery(ricardo.uid, { dropoff: DROP, recipient: { name: 'Maria', phone: '11999990000' } }, 'api');
    assert.equal(sent.length, 1);
    const job = [...store.data.get('webhook_jobs')!.values()][0];
    assert.equal(job.status, 'pending');
    await svc.sweep(true);
    assert.equal(sent.length, 1, 'ainda não chegou a hora');
    clock += 2 * 60_000;
    await svc.sweep(true);
    assert.equal(sent.length, 2);
    assert.equal([...store.data.get('webhook_jobs')!.values()][0].status, 'delivered');
  });

  test('assinatura do webhook confere e recusa adulteração ou atraso', () => {
    const body = '{"a":1}';
    const header = signWebhook('whsec_x', body, 1000);
    assert.ok(verifyWebhookSignature('whsec_x', body, header, 300, 1100));
    assert.ok(!verifyWebhookSignature('whsec_x', '{"a":2}', header, 300, 1100));
    assert.ok(!verifyWebhookSignature('whsec_y', body, header, 300, 1100));
    assert.ok(!verifyWebhookSignature('whsec_x', body, header, 300, 2000));
  });
});

describe('páginas de regras e ajuda', () => {
  const site = 'https://froc-x-uber.vercel.app';
  test('páginas têm conteúdo legal, links e dados estruturados', () => {
    const rules = renderRules(site);
    for (const t of ['EAR', 'Lei 13.640/2018', 'Lei 12.009/2009', 'RNTRC', 'CIOT', 'até 8 anos', 'canonical']) assert.ok(rules.includes(t), t);
    const faq = renderFaq(site);
    assert.ok(faq.includes('"FAQPage"'));
    assert.equal((faq.match(/<details>/g) || []).length, FAQ.length);
    assert.ok(renderHowItWorks(site).includes('"HowTo"'));
    const dev = renderDevelopers(site);
    for (const t of ['/api/v1/deliveries', 'X-Froc-Signature', 'froc_live_', 'orderRef']) assert.ok(dev.includes(t), t);
    const map = sitemapPages(site);
    for (const slug of ['como-funciona', 'regras-e-requisitos', 'perguntas-frequentes', 'desenvolvedores']) assert.ok(map.includes(`${site}/${slug}`), slug);
  });

  test('agentes de IA conhecem as regras', () => {
    const k = platformKnowledge({ ...DEFAULT_SETTINGS });
    for (const t of ['EAR', 'Lei 12.009', 'RNTRC', 'CIOT', 'DPVAT', 'Froc Entregas', 'gravar']) assert.ok(k.includes(t), t);
    assert.ok(legalKnowledgeText(9).includes('até 9 anos'));
  });
});
