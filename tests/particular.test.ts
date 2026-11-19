/**
 * Viagens particulares (pedido do dono, 19/11/2026):
 *  - o passageiro agenda (dia, hora, pessoas) para qualquer cidade do Brasil e escolhe
 *    "individual" (carro só dele) ou "compartilhada" (divide o carro);
 *  - motoristas do Brasil inteiro filtram por cidade e mandam propostas;
 *  - o motorista monta a agenda e emenda viagens (Campinas 12h15 → Rio; Copacabana 18h → Rio das Ostras);
 *  - valem as regras das caronas (caução, cancelamento, PIN, "não apareceu"); Froc fica com 30%.
 * Rodar: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import type { GeoPoint } from '../src/types/mobility.ts';

const H = 3600_000;
const ponto = (id: string, name: string, city: string, state: string, lat: number, lng: number): GeoPoint => ({ id, name, city, state, zone: 'urban', lat, lng, kind: 'avenue' });
const VIRACOPOS = ponto('gps-vcp', 'Aeroporto de Viracopos', 'Campinas', 'SP', -23.0074, -47.1345);
const RIO = ponto('gps-rio', 'Centro do Rio', 'Rio de Janeiro', 'RJ', -22.9068, -43.1729);
const COPACABANA = ponto('gps-copa', 'Copacabana', 'Rio de Janeiro', 'RJ', -22.9711, -43.1822);
const RIO_OSTRAS = ponto('gps-ro', 'Centro', 'Rio das Ostras', 'RJ', -22.5269, -41.945);
const ARARAQUARA = ponto('gps-arq', 'Centro', 'Araraquara', 'SP', -21.7845, -48.178);

// 27/11/2026 (sexta) em Brasília
const DIA = '27/11/2026';
const at = (hhmm: string) => Date.parse(`2026-11-27T${hhmm}:00-03:00`);

const ana: AuthUser = { uid: 'p1', email: 'ana@x.com', emailVerified: true, name: 'Ana' };
const bia: AuthUser = { uid: 'p2', email: 'bia@x.com', emailVerified: true, name: 'Bia' };
const cris: AuthUser = { uid: 'p3', email: 'cris@x.com', emailVerified: true, name: 'Cris' };
const caio: AuthUser = { uid: 'd1', email: 'caio@x.com', emailVerified: true, name: 'Caio' };
const davi: AuthUser = { uid: 'd2', email: 'davi@x.com', emailVerified: true, name: 'Davi' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const LEGAL = { cnhExpiry: '2035-01-01', city: 'Araraquara', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true } };

let store: MemoryStore;
let svc: FrocService;
let clock: number;
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

const all = (col: string) => [...(store.data.get(col)?.values() || [])] as Record<string, unknown>[];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
function dinheiroFecha(passo: string) {
  const entrou = sum(all('topups').filter((t) => t.status === 'approved').map((t) => Number(t.amountCents)));
  const saldos = sum(all('users').map((u) => Number(u.balanceCents || 0)));
  const retido = sum(all('indrive').map((r) => Number(r.escrowCents || 0) + (r.status === 'matched' ? Number(r.depositCents || 0) : 0)));
  const froc = sum(all('platformLedger').map((l) => Number(l.feeCents || 0)));
  assert.equal(saldos + retido + froc, entrou, `dinheiro não fecha: ${passo}`);
}
async function erro(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code, `esperava ${code}`);
}
async function recarga(u: AuthUser, reais: number) {
  const { topupId } = await svc.createTopup(u, reais);
  approved.set(topupId, Math.round(reais * 100));
  await svc.confirmTopup(topupId, u.uid);
}
const saldo = async (u: AuthUser) => (await svc.bootstrap(u)).profile.walletBalance;
const ver = async (u: AuthUser, id: string) => (await svc.bootstrap(u)).indriveRequests.find((r) => r.id === id)!;

/** Pede, recebe a proposta do motorista e aceita. */
async function combinar(p: AuthUser, d: AuthUser, body: Record<string, unknown>, preco: number) {
  const req = await svc.createInDrive(p, body);
  const comProposta = await svc.sendInDriveOffer(d, req.id, { offeredPrice: preco, note: 'Carro com ar' });
  return svc.acceptInDriveOffer(p, req.id, comProposta.offers[0].id);
}
const pedido = (o: GeoPoint, d: GeoPoint, time: string, extra: Record<string, unknown> = {}) => ({
  originPoint: o,
  destinationPoint: d,
  originId: o.id,
  destinationId: d.id,
  date: DIA,
  time,
  passengerOffer: 600,
  ...extra,
});

beforeEach(async () => {
  clock = at('08:00') - 3 * 864e5; // 24/11
  approved = new Map();
  store = new MemoryStore();
  svc = new FrocService(store, { now: () => new Date(clock), payments, adminEmails: ['dono@froc.com'], geo: createGridGeo(), files: { async save() {}, async signedUrl(p) { return 'https://x/' + p; } } });
  for (const u of [ana, bia, cris, caio, davi, admin]) await svc.ensureUser(u);
  for (const d of [caio, davi]) {
    for (const doc of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(d, 'driver', doc, 'image/png', 'eA==');
    await svc.applyAsProvider(d, 'driver', { ...LEGAL, phone: '16999990000', vehicle: 'Corolla', plate: 'ABC1D23' });
    await svc.reviewApplication(admin, d.uid, 'driver', 'approved', '');
  }
  for (const u of [ana, bia, cris]) await recarga(u, 1000);
});

describe('pedido agendado', () => {
  test('precisa de dia e hora futuros; guarda individual/compartilhada e pessoas', async () => {
    await erro(svc.createInDrive(ana, pedido(VIRACOPOS, RIO, '12:15', { date: 'amanhã' })), 'invalid_date');
    await erro(svc.createInDrive(ana, pedido(VIRACOPOS, RIO, '12:15', { date: '01/11/2026' })), 'past_date');
    const r = await svc.createInDrive(ana, pedido(VIRACOPOS, RIO, '12:15', { shareMode: 'compartilhada', seats: 2, pickupSpot: 'Desembarque, portão 3' }));
    assert.equal(r.shareMode, 'compartilhada');
    assert.equal(r.seats, 2);
    assert.equal(r.departureAt, new Date(at('12:15')).toISOString());
    assert.equal(r.pickupSpot, 'Desembarque, portão 3');
  });

  test('compartilhada tem piso menor que individual (divide o carro)', async () => {
    await erro(svc.createInDrive(ana, pedido(VIRACOPOS, RIO, '12:15', { passengerOffer: 200 })), 'below_floor');
    await svc.createInDrive(ana, pedido(VIRACOPOS, RIO, '12:15', { passengerOffer: 200, shareMode: 'compartilhada', seats: 1 }));
  });

  test('motorista de Araraquara vê pedidos do Brasil inteiro, em ordem de horário', async () => {
    await svc.updateProfile(caio, { lat: ARARAQUARA.lat, lng: ARARAQUARA.lng });
    await svc.createInDrive(bia, pedido(COPACABANA, RIO_OSTRAS, '18:00', { passengerOffer: 300 }));
    await svc.createInDrive(ana, pedido(VIRACOPOS, RIO, '12:15'));
    const vitrine = (await svc.bootstrap(caio)).indriveRequests.filter((r) => r.status === 'open');
    assert.deepEqual(vitrine.map((r) => r.destination.city), ['Rio de Janeiro', 'Rio das Ostras']);
  });
});

describe('agenda do motorista (baldeação)', () => {
  test('emenda Campinas 12h15 → Rio e Copacabana 18h → Rio das Ostras', async () => {
    await combinar(ana, caio, pedido(VIRACOPOS, RIO, '12:15'), 650);
    // 12h15 + ~6h de viagem + 1h de folga passa das 18h: o app avisa o passageiro na hora de aceitar.
    const longe = await svc.createInDrive(bia, pedido(COPACABANA, RIO_OSTRAS, '18:00', { passengerOffer: 300 }));
    const p1 = await svc.sendInDriveOffer(caio, longe.id, { offeredPrice: 320 });
    await erro(svc.acceptInDriveOffer(bia, longe.id, p1.offers[0].id), 'driver_busy');
    const tarde = await svc.createInDrive(cris, pedido(COPACABANA, RIO_OSTRAS, '21:00', { passengerOffer: 300 }));
    const p2 = await svc.sendInDriveOffer(caio, tarde.id, { offeredPrice: 320 });
    await svc.acceptInDriveOffer(cris, tarde.id, p2.offers[0].id);
    const agenda = (await svc.bootstrap(caio)).indriveRequests.filter((r) => r.mine === 'provider' && r.status === 'matched');
    assert.equal(agenda.length, 2);
    dinheiroFecha('agenda montada');
  });

  test('individual ocupa o carro; compartilhadas no mesmo horário se juntam até 4 pessoas', async () => {
    await combinar(ana, caio, pedido(VIRACOPOS, RIO, '12:15', { shareMode: 'compartilhada', seats: 2, passengerOffer: 300 }), 300);
    await combinar(bia, caio, pedido(VIRACOPOS, RIO, '12:30', { shareMode: 'compartilhada', seats: 2, passengerOffer: 300 }), 300);
    const cheio = await svc.createInDrive(cris, pedido(VIRACOPOS, RIO, '12:20', { shareMode: 'compartilhada', seats: 1, passengerOffer: 200 }));
    const p = await svc.sendInDriveOffer(caio, cheio.id, { offeredPrice: 200 });
    await erro(svc.acceptInDriveOffer(cris, cheio.id, p.offers[0].id), 'driver_busy');
    // Outro motorista pega a Cris.
    const p2 = await svc.sendInDriveOffer(davi, cheio.id, { offeredPrice: 210 });
    await svc.acceptInDriveOffer(cris, cheio.id, p2.offers.find((o) => o.driverName === 'Davi')!.id);
  });

  test('individual não se junta com nada no mesmo horário', async () => {
    await combinar(ana, caio, pedido(VIRACOPOS, RIO, '12:15'), 650);
    const r = await svc.createInDrive(bia, pedido(VIRACOPOS, RIO, '12:30', { shareMode: 'compartilhada', passengerOffer: 300 }));
    const p = await svc.sendInDriveOffer(caio, r.id, { offeredPrice: 300 });
    await erro(svc.acceptInDriveOffer(bia, r.id, p.offers[0].id), 'driver_busy');
  });
});

describe('dinheiro: retido, caução, PIN e 30% da Froc', () => {
  test('viagem realizada com PIN: motorista recebe 70%, caução volta; passageiro não vê o ganho do motorista', async () => {
    const r = await combinar(ana, caio, pedido(VIRACOPOS, RIO, '12:15'), 600);
    assert.equal(await saldo(ana), 400);
    assert.equal(await saldo(caio), -120, 'caução de 20% (nas 3 primeiras pode ficar negativo)');
    const daAna = await ver(ana, r.id);
    assert.equal(daAna.driverEarning, undefined);
    assert.match(daAna.boardingPin!, /^\d{4}$/);
    assert.equal((await ver(caio, r.id)).boardingPin, undefined, 'motorista não vê o PIN');
    assert.equal((await ver(caio, r.id)).driverEarning, 420);
    await erro(svc.completeInDrive(caio, r.id), 'not_departed');
    clock = at('12:20');
    await svc.boardInDrive(caio, r.id, daAna.boardingPin);
    await svc.completeInDrive(caio, r.id);
    assert.equal(await saldo(caio), 420);
    dinheiroFecha('realizada');
  });

  test('sem PIN e sem prova de falta: valor volta ao passageiro', async () => {
    const r = await combinar(ana, caio, pedido(VIRACOPOS, RIO, '12:15'), 600);
    clock = at('12:20');
    await svc.completeInDrive(caio, r.id);
    assert.equal(await saldo(ana), 1000);
    assert.equal(await saldo(caio), 0);
    dinheiroFecha('sem prova');
  });

  test('passageiro não apareceu: 15 min e GPS no ponto; motorista recebe 70%', async () => {
    const r = await combinar(ana, caio, pedido(VIRACOPOS, RIO, '12:15'), 600);
    clock = at('12:20');
    await erro(svc.noShowInDrive(caio, r.id, VIRACOPOS.lat, VIRACOPOS.lng), 'too_early');
    clock = at('12:31');
    await erro(svc.noShowInDrive(caio, r.id, RIO.lat, RIO.lng), 'not_at_pickup');
    await svc.noShowInDrive(caio, r.id, VIRACOPOS.lat + 0.003, VIRACOPOS.lng);
    await svc.completeInDrive(caio, r.id);
    assert.equal(await saldo(caio), 420);
    assert.equal(await saldo(ana), 400);
    dinheiroFecha('no-show');
  });

  test('PIN errado trava depois de 5 tentativas', async () => {
    const r = await combinar(ana, caio, pedido(VIRACOPOS, RIO, '12:15'), 600);
    const certo = (await ver(ana, r.id)).boardingPin!;
    const errado = certo === '1111' ? '2222' : '1111';
    for (let i = 0; i < 5; i++) await erro(svc.boardInDrive(caio, r.id, errado), 'wrong_pin');
    await erro(svc.boardInDrive(caio, r.id, certo), 'pin_locked');
  });

  test('depois de 3 viagens o motorista precisa ter a caução', async () => {
    await store.update('users', caio.uid, { carpoolsDone: 3 });
    const req = await svc.createInDrive(ana, pedido(VIRACOPOS, RIO, '12:15'));
    const p = await svc.sendInDriveOffer(caio, req.id, { offeredPrice: 600 });
    await erro(svc.acceptInDriveOffer(ana, req.id, p.offers[0].id), 'driver_no_deposit');
    assert.equal(await saldo(ana), 1000, 'nada cobrado do passageiro');
  });
});

describe('cancelamento (mesmas regras das caronas)', () => {
  test('passageiro: +24h 100%; entre 24h e 2h 50%; menos de 2h 0%', async () => {
    const a = await combinar(ana, caio, pedido(VIRACOPOS, RIO, '08:00'), 600);
    clock = at('08:00') - 30 * H;
    assert.equal((await ver(ana, a.id)).cancelPreview!.refund, 600);
    await svc.cancelInDrive(ana, a.id);
    assert.equal(await saldo(ana), 1000);

    const b = await combinar(bia, caio, pedido(VIRACOPOS, RIO, '12:15'), 600);
    clock = at('12:15') - 10 * H;
    await svc.cancelInDrive(bia, b.id);
    assert.equal(await saldo(bia), 700);

    const c = await combinar(cris, caio, pedido(COPACABANA, RIO_OSTRAS, '21:00', { passengerOffer: 300 }), 300);
    clock = at('21:00') - 1 * H;
    await svc.cancelInDrive(cris, c.id);
    assert.equal(await saldo(cris), 700);
    assert.equal(await saldo(caio), 210 + 210, 'recebe 70% do que os passageiros perderam; cauções voltam');
    dinheiroFecha('cancelamentos');
  });

  test('motorista desiste: passageiro 100% + multa da caução e o pedido volta para a vitrine', async () => {
    await recarga(caio, 200);
    const r = await combinar(ana, caio, pedido(VIRACOPOS, RIO, '12:15'), 600);
    clock = at('12:15') - 1 * H;
    const prev = (await ver(caio, r.id)).cancelPreview!;
    assert.deepEqual([prev.penaltyPct, prev.penalty], [20, 120]);
    await svc.driverCancelInDrive(caio, r.id);
    assert.equal(await saldo(ana), 1120, '100% + 20% de compensação');
    assert.equal(await saldo(caio), 80);
    const deNovo = await ver(ana, r.id);
    assert.equal(deNovo.status, 'open', 'outro motorista pode pegar');
    assert.equal(deNovo.offers.length, 0);
    const p = await svc.sendInDriveOffer(davi, r.id, { offeredPrice: 610 });
    await svc.acceptInDriveOffer(ana, r.id, p.offers[0].id);
    dinheiroFecha('motorista desistiu e outro pegou');
  });

  test('3 desistências com multa em 30 dias: 7 dias sem pegar viagens agendadas', async () => {
    for (const p of [ana, bia, cris]) {
      const r = await combinar(p, caio, pedido(VIRACOPOS, RIO, '12:15'), 600);
      clock = at('12:15') - 1 * H;
      await svc.driverCancelInDrive(caio, r.id);
      clock = at('08:00') - 3 * 864e5;
    }
    const novo = await svc.createInDrive(ana, pedido(COPACABANA, RIO_OSTRAS, '21:00', { passengerOffer: 300 }));
    await erro(svc.sendInDriveOffer(caio, novo.id, { offeredPrice: 300 }), 'carpool_suspended');
  });
});

describe('pedidos antigos (sem data marcada)', () => {
  test('continuam funcionando pela regra antiga', async () => {
    await store.set('indrive', 'velho', {
      id: 'velho', passengerId: ana.uid, passengerName: 'Ana', origin: VIRACOPOS, destination: RIO, distanceKm: 10,
      passengerOffer: 30, paymentMethod: 'froc_pay', status: 'open', offers: [], escrowCents: 0, createdAt: new Date(clock).toISOString(),
    });
    const p = await svc.sendInDriveOffer(caio, 'velho', { offeredPrice: 30 });
    await svc.acceptInDriveOffer(ana, 'velho', p.offers[0].id);
    await svc.completeInDrive(caio, 'velho');
    assert.ok((await saldo(caio)) > 20);
  });
});
