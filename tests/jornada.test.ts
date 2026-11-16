/**
 * AUDITORIA · Jornada real de ponta a ponta, como no app em produção:
 * CPF obrigatório, autonomia da Equipe IA ligada, preço novo (taxa fixa), regras de respeito.
 *
 * Depois de CADA passo confere a lei do dinheiro: nada some e nada aparece do nada.
 *   recargas aprovadas + bônus de pontos
 *     = saldos de todos + valores retidos (corridas, negociações, caronas, fretes)
 *       + ganho da Froc + saques pedidos/liberados/pagos
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser, FileStorage, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import { IdentityReviewer } from '../server/ai/identityCheck.ts';
import type { LlmClient } from '../server/ai/gemini.ts';
import { BRAZIL_LOCATIONS } from '../src/data/locations.ts';

const ana: AuthUser = { uid: 'ana', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' };
const bia: AuthUser = { uid: 'bia', email: 'bia@exemplo.com', emailVerified: true, name: 'Bia' };
const caio: AuthUser = { uid: 'caio', email: 'caio@exemplo.com', emailVerified: true, name: 'Caio' };
const tonhao: AuthUser = { uid: 'tonhao', email: 'tonhao@exemplo.com', emailVerified: true, name: 'Tonhão' };
const ricardo: AuthUser = { uid: 'ricardo', email: 'ricardo@pastel.com', emailVerified: true, name: 'Ricardo' };
const intruso: AuthUser = { uid: 'intruso', email: 'x@x.com', emailVerified: true, name: 'X' };
const admin: AuthUser = { uid: 'dono', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };

const CPFS: Record<string, [string, string, string]> = {
  ana: ['529.982.247-25', 'Ana Paula Lima', '1990-05-10'],
  bia: ['168.995.350-09', 'Beatriz Costa', '1985-01-01'],
  caio: ['111.444.777-35', 'Caio Souza', '1988-03-03'],
  tonhao: ['123.456.789-09', 'Antonio Silva', '1975-07-07'],
  ricardo: ['935.411.347-80', 'Ricardo Alves', '1980-02-02'],
  intruso: ['714.602.380-01', 'Intruso Teste', '1995-09-09'],
};
const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };
const INTERCITY = { originId: 'sp-tiete', destinationId: 'br-campinas' };
const PAULISTA = BRAZIL_LOCATIONS.find((l) => l.id === 'sp-paulista')!;

let clock = Date.parse('2026-11-18T18:00:00Z'); // quarta, 15h (horário normal)
const tick = (sec: number) => {
  clock += sec * 1000;
};
const approvedTopups = new Map<string, number>();
const payments: PaymentsGateway = {
  configured: true,
  async createCheckout({ reference }) {
    return { checkoutUrl: 'https://mp/' + reference, preferenceId: 'p' };
  },
  async findApproved(ref) {
    const c = approvedTopups.get(ref);
    return c ? { paymentId: 'pay-' + ref, amountCents: c } : null;
  },
  async getPayment() {
    return null;
  },
};
const files = new Map<string, Uint8Array>();
const fileStore: FileStorage = {
  async save(p, _t, b) {
    files.set(p, b);
  },
  async signedUrl(p) {
    return 'https://arquivos/' + p;
  },
  async read(p) {
    const b = files.get(p);
    return b ? { bytes: b, contentType: 'image/jpeg' } : null;
  },
};
// A "IA" lê os documentos do Caio (motorista) corretamente.
const llm: LlmClient = {
  configured: true,
  async generate(input) {
    const body = input.system.includes('CRLV')
      ? { legivel: true, placa: 'BRA2E19', anoFabricacao: 2021, exercicio: 2026 }
      : input.system.includes('antecedentes')
        ? { legivel: true, nome: 'CAIO SOUZA', cpf: '11144477735', nadaConsta: true, emissao: '2026-11-10' }
        : { legivel: true, tipo: 'CNH', nome: 'CAIO SOUZA', cpf: '11144477735', nascimento: '1988-03-03', validade: '2031-01-01', ear: true, pareceAdulterado: false };
    return { content: { role: 'model', parts: [] }, text: JSON.stringify(body), functionCalls: [], model: 'fake' };
  },
};

const store = new MemoryStore();
const svc = new FrocService(store, {
  now: () => new Date(clock),
  payments,
  adminEmails: ['dono@froc.com'],
  geo: createGridGeo(),
  files: fileStore,
  identity: { required: true },
  cnpjLookup: async () => ({ active: true, name: 'PASTELARIA DO RICARDO LTDA', situation: 'ATIVA' }),
});
const reviewer = new IdentityReviewer({ store, service: svc, llm, files: fileStore });

const all = <T = Record<string, unknown>>(col: string) => [...(store.data.get(col)?.values() || [])] as T[];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** A lei do dinheiro. */
function assertMoneyConserved(step: string) {
  const entrou = sum(all('topups').filter((t) => t.status === 'approved').map((t) => Number(t.amountCents))) + sum(all('transactions').filter((t) => t.category === 'bonus').map((t) => Number(t.amountCents)));
  const saldos = sum(all('users').map((u) => Number(u.balanceCents || 0)));
  const retido =
    sum(all('rides').map((r) => Number(r.escrowCents || 0))) +
    sum(all('indrive').map((r) => Number(r.escrowCents || 0))) +
    sum(all('emptyTrucks').map((r) => Number(r.escrowCents || 0))) +
    sum(all('freights').map((r) => Number(r.escrowCents || 0))) +
    sum(all('carpoolBookings').filter((b) => b.status === 'paid').map((b) => Number(b.amountCents || 0)));
  const froc = sum(all('platformLedger').map((l) => Number(l.feeCents || 0)));
  const saques = sum(all('withdrawals').filter((w) => w.status !== 'rejected').map((w) => Number(w.amountCents)));
  assert.equal(saldos + retido + froc + saques, entrou, `dinheiro não fecha depois de: ${step} (saldos ${saldos} + retido ${retido} + Froc ${froc} + saques ${saques} ≠ entrou ${entrou})`);
  for (const u of all('users')) if (Number(u.balanceCents) < 0) assert.fail(`${u.uid} ficou com saldo negativo depois de: ${step}`);
}
async function expectError(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code, `esperava ${code}`);
}
async function topUp(u: AuthUser, reais: number) {
  const { topupId } = await svc.createTopup(u, reais);
  approvedTopups.set(topupId, Math.round(reais * 100));
  await svc.confirmTopup(topupId, u.uid);
}
const bal = async (u: AuthUser) => (await svc.bootstrap(u)).profile.walletBalance;

test('Jornada completa: cadastro → corridas → negociação → carona → frete → entrega → saque, sem perder 1 centavo', async () => {
  // ---------------------------------------------------------- 1. contas e CPF
  for (const u of [ana, bia, caio, tonhao, ricardo, intruso, admin]) await svc.ensureUser(u);
  await expectError(svc.createRide(ana, { ...SP, categoryId: 'froc_x' }), 'cpf_required');
  for (const u of [ana, bia, caio, tonhao, ricardo, intruso]) {
    const [cpf, fullName, birthDate] = CPFS[u.uid];
    assert.equal((await svc.registerCpf(u, { cpf, fullName, birthDate })).cpfStatus, 'basic');
  }
  await expectError(svc.registerCpf(admin, { cpf: CPFS.ana[0], fullName: 'Ana Paula Lima', birthDate: '1990-05-10' }), 'cpf_in_use');
  assertMoneyConserved('cadastros');

  // ---------------------------------------------------------- 2. recargas
  await topUp(ana, 300);
  await topUp(bia, 1000);
  await topUp(ricardo, 150);
  await topUp(caio, 20); // motorista também passa a usar o app
  assertMoneyConserved('recargas');

  // ---------------------------------------------------------- 3. motorista: cadastro lido e aprovado pela IA
  for (const d of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(caio, 'driver', d, 'image/jpeg', Buffer.from('foto-' + d).toString('base64'));
  await svc.applyAsProvider(caio, 'driver', {
    phone: '11988887777', vehicle: 'Onix Prata', plate: 'BRA2E19', vehicleYear: 2021, vehicleType: 'carro', city: 'São Paulo', state: 'SP', cnhExpiry: '2031-01-01',
    declarations: { ear: true, inss: true, seguroApp: true, veracidade: true },
  });
  const check = await reviewer.reviewProvider(caio.uid, 'driver');
  assert.equal(check.decision, 'aprovar', check.reasons.join(' '));
  let caioProfile = (await svc.bootstrap(caio)).profile;
  assert.equal(caioProfile.driverStatus, 'approved', 'Equipe IA aprovou sozinha');
  assert.equal(caioProfile.cpfStatus, 'verified', 'CPF verificado pela CNH');
  await svc.updateProfile(caio, { driverOnline: true });
  await svc.updateLocation(caio, PAULISTA.lat + 0.004, PAULISTA.lng);

  // transportador aprovado pela equipe
  for (const d of ['cnh', 'crlv', 'antt', 'antecedentes']) await svc.uploadDocument(tonhao, 'trucker', d, 'image/jpeg', 'eA==');
  await svc.applyAsProvider(tonhao, 'trucker', {
    phone: '11977776666', vehicle: 'VW Delivery', plate: 'QWE1R23', vehicleYear: 2019, truckType: 'Truck Baú', rntrc: '123456789', city: 'São Paulo', state: 'SP', cnhExpiry: '2030-01-01',
    declarations: { ear: true, rntrc: true, ciotPiso: true, veracidade: true },
  });
  await svc.reviewApplication(admin, tonhao.uid, 'trucker', 'approved', '');

  // ---------------------------------------------------------- 4. passageira vê carro por perto e pede corrida
  const near = await svc.nearbyDrivers(ana, PAULISTA.lat, PAULISTA.lng);
  assert.equal(near.drivers.length, 1);
  assert.notEqual(near.drivers[0].id, caio.uid, 'id do motorista não vaza');
  const quote = await svc.quoteRide(ana, SP);
  const qx = quote.prices.find((p) => p.categoryId === 'froc_x')!;
  const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x', acceptPolicy: true });
  assert.equal(ride.price, qx.price, 'cobra o preço mostrado');
  assert.equal(await bal(ana), Math.round((300 - ride.price) * 100) / 100, 'sai do saldo no pedido');
  assertMoneyConserved('pedido de corrida');

  // intruso não enxerga nem mexe
  const intrusoView = await svc.bootstrap(intruso);
  assert.ok(!intrusoView.rides.some((r) => r.id === ride.id), 'intruso (não motorista) não vê corrida alheia');
  await expectError(svc.rideAction(intruso, ride.id, { action: 'cancel' }), 'forbidden');
  await expectError(svc.rideAction(intruso, ride.id, { action: 'message', message: 'oi' }), 'forbidden');
  await expectError(svc.shareTrip(intruso, 'ride', ride.id), 'forbidden');
  await expectError(svc.rideAction(intruso, ride.id, { action: 'driver_accept' }), 'not_approved');

  // motorista vê na fila, sem PIN; aceita; passageira compartilha
  const queue = (await svc.bootstrap(caio)).rides.find((r) => r.id === ride.id)!;
  assert.equal(queue.pinCode, '');
  assert.equal(queue.passengerVerified, 'cpf');
  assert.ok(queue.driverEarning! > 0 && queue.pricing!.platformFee >= 2);
  await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
  const share = await svc.shareTrip(ana, 'ride', ride.id);
  await svc.updateLocation(caio, PAULISTA.lat + 0.01, PAULISTA.lng);
  const tracked = await svc.trackShare(share.token);
  assert.equal(tracked.driver?.plate, 'BRA2E19');
  assert.ok(tracked.location);
  assert.ok(!JSON.stringify(tracked).includes('11988887777'), 'telefone do motorista não vaza no link');

  // chegada, espera de 70 s (+10%), PIN, gravação, fim
  await expectError(svc.rideAction(caio, ride.id, { action: 'arriving' }), 'too_far_from_pickup');
  await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
  await svc.rideAction(caio, ride.id, { action: 'arriving' });
  tick(70);
  await expectError(svc.rideAction(caio, ride.id, { action: 'start', pin: '0000' === ride.pinCode ? '1111' : '0000' }), 'wrong_pin');
  await svc.rideAction(caio, ride.id, { action: 'start', pin: ride.pinCode });
  await svc.recordingNotice(ana, 'ride', ride.id, 'audio');
  assertMoneyConserved('início com acréscimo de espera');
  const caioAntes = await bal(caio);
  await svc.rideAction(caio, ride.id, { action: 'complete' });
  await expectError(svc.rideAction(caio, ride.id, { action: 'complete' }), 'invalid_state');
  const extra = Math.round(Math.round(ride.price * 100) * 0.1);
  assert.equal(Math.round((await bal(caio)) * 100), Math.round(caioAntes * 100) + Math.round(ride.price * 100) + extra - Math.round(ride.pricing!.platformFee * 100));
  await svc.rideAction(ana, ride.id, { action: 'rate', stars: 5 });
  await svc.rideAction(caio, ride.id, { action: 'rate_passenger', stars: 5 });
  assertMoneyConserved('corrida concluída');
  tick(3 * 3600);
  await expectError(svc.trackShare(share.token), 'expired');

  // ---------------------------------------------------------- 5. cancelamento tardio (50%)
  const r2 = await svc.createRide(ana, { ...SP, categoryId: 'froc_99' });
  await svc.rideAction(caio, r2.id, { action: 'driver_accept' });
  tick(90);
  const cancelled = await svc.rideAction(ana, r2.id, { action: 'cancel' });
  assert.equal(cancelled.cancellationFeePercent, 50);
  assertMoneyConserved('cancelamento com taxa');

  // ---------------------------------------------------------- 6. negociação
  const req = await svc.createInDrive(ana, { ...SP, passengerOffer: 30 });
  const offered = await svc.sendInDriveOffer(caio, req.id, { offeredPrice: 32, etaMin: 4 });
  await svc.acceptInDriveOffer(ana, req.id, offered.offers[0].id);
  assertMoneyConserved('negociação aceita');
  await svc.completeInDrive(caio, req.id);
  assertMoneyConserved('negociação concluída');

  // ---------------------------------------------------------- 7. carona
  const trip = await svc.publishCarpool(caio, { ...INTERCITY, date: 'Sábado', departureTime: '08:00', totalSeats: 3, pricePerSeat: 45 });
  await svc.bookCarpool(bia, trip.id, 2);
  assertMoneyConserved('carona reservada');
  await svc.finishCarpool(caio, trip.id, 'completed');
  assertMoneyConserved('carona concluída');

  // ---------------------------------------------------------- 8. frete
  const freight = await svc.createFreight(bia, { ...INTERCITY, estimatedWeightKg: 400, proposedBudget: 600, scheduledDate: 'Terça' });
  const bid = await svc.bidFreight(tonhao, freight.id, { price: 650, helpersIncluded: 1 });
  await svc.acceptFreightBid(bia, freight.id, bid.bids[0].id);
  assertMoneyConserved('frete contratado');
  await svc.finishFreight(tonhao, freight.id, 'deliver');
  assertMoneyConserved('frete entregue');

  // ---------------------------------------------------------- 9. loja: aprovada pela IA e entrega com código
  await svc.applyAsMerchant(ricardo, {
    companyName: 'Pastelaria do Ricardo', cnpj: '11.222.333/0001-81', phone: '11966665555', category: 'pastelaria',
    pickup: { name: 'Av. Paulista, 1000', city: 'São Paulo', state: 'SP', lat: PAULISTA.lat, lng: PAULISTA.lng },
    declarations: { responsavel: true, proibidos: true, veracidade: true },
  });
  await svc.sweep(true); // rotina: Equipe IA aprova lojas com CNPJ ativo
  assert.equal((await svc.bootstrap(ricardo)).profile.merchantStatus, 'approved');
  const delivery = await svc.createDelivery(ricardo.uid, { orderRef: 'P-1', dropoff: { address: 'Rua Augusta, 500', lat: -23.5531, lng: -46.6537 }, recipient: { name: 'Maria', phone: '11955554444' } }, 'api');
  assertMoneyConserved('entrega criada');
  await svc.rideAction(caio, delivery.id, { action: 'driver_accept' });
  await svc.rideAction(caio, delivery.id, { action: 'start' });
  await expectError(svc.rideAction(caio, delivery.id, { action: 'complete', pin: '0000' === delivery.deliveryCode ? '1111' : '0000' }), 'wrong_pin');
  await svc.rideAction(caio, delivery.id, { action: 'complete', pin: delivery.deliveryCode });
  assertMoneyConserved('entrega concluída');

  // ---------------------------------------------------------- 10. saque: só ganhos, liberado pela Equipe IA
  caioProfile = (await svc.bootstrap(caio)).profile;
  assert.ok(caioProfile.withdrawableBalance! > 0);
  assert.ok(caioProfile.withdrawableBalance! <= caioProfile.walletBalance);
  await expectError(svc.requestWithdrawal(bia, 50, CPFS.bia[0], 'cpf'), 'nothing_to_withdraw');
  const w = await svc.requestWithdrawal(caio, 20, CPFS.caio[0], 'cpf');
  assertMoneyConserved('saque pedido');
  await svc.sweep(true);
  assert.equal(all('withdrawals').find((x) => x.id === w.id)?.status, 'approved', 'Equipe IA liberou');
  assertMoneyConserved('saque liberado');

  // ---------------------------------------------------------- 11. bloqueio vale para a pessoa
  await svc.setBlocked(admin, intruso.uid, true, 'Tentou mexer em corrida alheia');
  await expectError(svc.checkAccess(intruso), 'blocked');
  await expectError(svc.registerCpf({ uid: 'intruso2', email: 'novo@x.com', emailVerified: true }, { cpf: CPFS.intruso[0], fullName: 'Intruso Teste', birthDate: '1995-09-09' }), 'cpf_blocked');

  // ---------------------------------------------------------- 12. auditoria registra quem fez o quê
  const log = await svc.auditLog(admin, 500);
  for (const action of ['cadastro_aprovado', 'saque_liberado', 'usuario_bloqueado', 'cpf_cadastrado']) assert.ok(log.some((l) => l.action === action), `auditoria sem ${action}`);
  assert.ok(log.some((l) => l.action === 'cadastro_aprovado' && l.actorType === 'ia'), 'aprovação da IA aparece como IA');
  assertMoneyConserved('fim');
});
