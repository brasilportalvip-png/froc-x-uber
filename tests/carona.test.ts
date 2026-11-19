/**
 * Caronas: cancelamento justo para os dois lados, caução do motorista, PIN de embarque e
 * passageiro que não aparece (decidido com o dono em 19/11/2026, opção 3 da caução).
 * Rodar: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import { CARPOOL_POLICY, CARPOOL_POLICY_TEXT, departureMs, driverPenaltyPct, passengerRefundPct, strikesAfter } from '../src/data/carpoolPolicy.ts';
import { BRAZIL_LOCATIONS } from '../src/data/locations.ts';

const H = 3600_000;
const SAIDA = '27/11/2026';
const SAIDA_MS = Date.parse('2026-11-27T11:00:00Z'); // 27/11 às 08:00 em Brasília
const ROTA = { originId: 'sp-tiete', destinationId: 'br-campinas' };
const TIETE = BRAZIL_LOCATIONS.find((l) => l.id === 'sp-tiete')!;

describe('regras (puras)', () => {
  test('data e hora de Brasília', () => {
    assert.equal(departureMs(SAIDA, '08:00'), SAIDA_MS);
    assert.equal(departureMs('31/02/2026', '08:00'), null);
    assert.equal(departureMs('Sábado', '08:00'), null);
    assert.equal(departureMs('27/11/2026', '25:00'), null);
  });
  test('passageiro: 100% (+24h), 50% (24h–2h), 0% (menos de 2h); arrependimento de 1h', () => {
    assert.equal(passengerRefundPct(48, 600), 100);
    assert.equal(passengerRefundPct(10, 600), 50);
    assert.equal(passengerRefundPct(1, 600), 0);
    assert.equal(passengerRefundPct(-1, 600), 0, 'depois do horário');
    assert.equal(passengerRefundPct(1, 30), 100, 'reservou há 30 min: pode desistir');
    assert.equal(passengerRefundPct(-0.5, 30), 0, 'arrependimento não vale depois da saída');
  });
  test('motorista: 0% (+24h), 10% (24h–2h), 20% (menos de 2h)', () => {
    assert.equal(driverPenaltyPct(30), 0);
    assert.equal(driverPenaltyPct(5), 10);
    assert.equal(driverPenaltyPct(0.5), 20);
  });
  test('3 multas em 30 dias suspendem 7 dias; multas antigas não contam', () => {
    const now = SAIDA_MS;
    const antiga = new Date(now - 40 * 864e5).toISOString();
    const recente = new Date(now - 5 * 864e5).toISOString();
    assert.equal(strikesAfter([antiga, recente], now).suspendedUntil, null);
    const r = strikesAfter([recente, recente], now);
    assert.equal(r.strikes.length, 3);
    assert.equal(r.suspendedUntil, new Date(now + 7 * 864e5).toISOString());
  });
  test('textos das regras falam de caução, prazos e PIN', () => {
    const t = CARPOOL_POLICY_TEXT.join(' ');
    for (const s of ['caução de 20%', '24h', '2h', 'PIN', '15 minutos', '3 cancelamentos']) assert.ok(t.includes(s), s);
  });
});

// ------------------------------------------------------------------ servidor

const ana: AuthUser = { uid: 'p1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' };
const bia: AuthUser = { uid: 'p2', email: 'bia@exemplo.com', emailVerified: true, name: 'Bia' };
const caio: AuthUser = { uid: 'd1', email: 'caio@exemplo.com', emailVerified: true, name: 'Caio' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const LEGAL = { cnhExpiry: '2035-01-01', city: 'São Paulo', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true } };

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
/** Nenhum centavo some: saldos + retidos (vaga + caução) + Froc = recargas. */
function dinheiroFecha(passo: string) {
  const entrou = sum(all('topups').filter((t) => t.status === 'approved').map((t) => Number(t.amountCents)));
  const saldos = sum(all('users').map((u) => Number(u.balanceCents || 0)));
  const retido = sum(all('carpoolBookings').filter((b) => ['paid', 'boarded', 'no_show'].includes(String(b.status))).map((b) => Number(b.amountCents) + Number(b.depositCents || 0)));
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
const sacavel = async (u: AuthUser) => (await svc.bootstrap(u)).profile.withdrawableBalance ?? 0;
const pinDe = async (u: AuthUser, tripId: string) => (await svc.bootstrap(u)).carpools.find((c) => c.id === tripId)!.boardingPins![0].pin;
const visao = async (u: AuthUser, tripId: string) => (await svc.bootstrap(u)).carpools.find((c) => c.id === tripId)!;
/** Publica 27/11 08:00, R$ 50 por vaga. */
const publicar = () => svc.publishCarpool(caio, { ...ROTA, date: SAIDA, departureTime: '08:00', totalSeats: 4, pricePerSeat: 50 });

beforeEach(async () => {
  clock = SAIDA_MS - 5 * 864e5; // 22/11
  approved = new Map();
  store = new MemoryStore();
  svc = new FrocService(store, { now: () => new Date(clock), payments, adminEmails: ['dono@froc.com'], geo: createGridGeo(), files: { async save() {}, async signedUrl(p) { return 'https://x/' + p; } } });
  for (const u of [ana, bia, caio, admin]) await svc.ensureUser(u);
  for (const d of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(caio, 'driver', d, 'image/png', 'eA==');
  await svc.applyAsProvider(caio, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix', plate: 'ABC1D23' });
  await svc.reviewApplication(admin, caio.uid, 'driver', 'approved', '');
  await recarga(ana, 200);
  await recarga(bia, 200);
});

describe('publicar', () => {
  test('data precisa ser válida e futura', async () => {
    await erro(svc.publishCarpool(caio, { ...ROTA, date: 'Sábado', departureTime: '08:00', totalSeats: 2, pricePerSeat: 50 }), 'invalid_date');
    await erro(svc.publishCarpool(caio, { ...ROTA, date: '01/11/2026', departureTime: '08:00', totalSeats: 2, pricePerSeat: 50 }), 'past_date');
    const t = await publicar();
    assert.equal(t.departureAt, new Date(SAIDA_MS).toISOString());
  });
});

describe('caução do motorista (opção 3)', () => {
  test('reserva bloqueia 20% no saldo do motorista; nas 3 primeiras pode ficar negativo', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 1);
    assert.equal(await saldo(caio), -10, 'caução de R$ 10 (20% de R$ 50) sem saldo: fica devendo');
    assert.equal(await saldo(ana), 150);
    dinheiroFecha('reserva');
  });

  test('depois de 3 caronas realizadas, sem saldo não aceita reserva; com saldo aceita', async () => {
    await store.update('users', caio.uid, { carpoolsDone: 3 });
    const t = await publicar();
    await erro(svc.bookCarpool(ana, t.id, 1), 'driver_no_deposit');
    assert.equal(await saldo(ana), 200, 'nada foi cobrado da passageira');
    await recarga(caio, 30);
    await svc.bookCarpool(ana, t.id, 1);
    assert.equal(await saldo(caio), 20);
    dinheiroFecha('reserva com caução paga');
  });

  test('caução bloqueada não pode ser sacada', async () => {
    await store.update('users', caio.uid, { balanceCents: 5000, earnedCents: 5000 });
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 2); // caução R$ 20
    assert.equal(await sacavel(caio), 30);
  });
});

describe('passageiro cancela', () => {
  test('mais de 24h antes: 100% de volta e caução volta ao motorista', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 2);
    clock = SAIDA_MS - 48 * H;
    const prev = (await visao(ana, t.id)).cancelPreview!;
    assert.equal(prev.refund, 100);
    await svc.cancelCarpoolBooking(ana, t.id);
    assert.equal(await saldo(ana), 200);
    assert.equal(await saldo(caio), 0);
    dinheiroFecha('cancelou cedo');
  });

  test('entre 24h e 2h: 50% de volta; motorista recebe a outra metade menos 30%', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 2); // R$ 100
    clock = SAIDA_MS - 10 * H;
    assert.equal((await visao(ana, t.id)).cancelPreview!.refund, 50, 'app mostra antes quanto volta');
    await svc.cancelCarpoolBooking(ana, t.id);
    assert.equal(await saldo(ana), 150);
    assert.equal(await saldo(caio), 35, 'R$ 50 × 70%');
    dinheiroFecha('cancelou no meio');
  });

  test('menos de 2h: nada volta; motorista recebe 70%', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 1);
    clock = SAIDA_MS - 1 * H;
    await svc.cancelCarpoolBooking(ana, t.id);
    assert.equal(await saldo(ana), 150);
    assert.equal(await saldo(caio), 35);
    dinheiroFecha('cancelou em cima da hora');
  });

  test('arrependimento: reservou há menos de 1h, cancela sem custo mesmo perto da saída', async () => {
    const t = await publicar();
    clock = SAIDA_MS - 5 * H;
    await svc.bookCarpool(ana, t.id, 1);
    clock += 20 * 60000;
    await svc.cancelCarpoolBooking(ana, t.id);
    assert.equal(await saldo(ana), 200);
    dinheiroFecha('arrependimento');
  });
});

describe('motorista cancela', () => {
  test('mais de 24h: todos 100%, sem multa e sem marca', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 1);
    clock = SAIDA_MS - 30 * H;
    await svc.finishCarpool(caio, t.id, 'cancelled');
    assert.equal(await saldo(ana), 200);
    assert.equal(await saldo(caio), 0);
    assert.equal((await store.get<Record<string, unknown>>('users', caio.uid))?.carpoolStrikes, undefined);
    dinheiroFecha('motorista cancelou cedo');
  });

  test('entre 24h e 2h: passageira recebe 100% + 10% de compensação, paga pela caução', async () => {
    await recarga(caio, 100);
    await store.update('users', caio.uid, { earnedCents: 10000 }); // R$ 100 de ganhos
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 2); // R$ 100; caução R$ 20
    clock = SAIDA_MS - 5 * H;
    const prev = (await visao(caio, t.id)).cancelPreview!;
    assert.deepEqual([prev.penaltyPct, prev.penalty, prev.deposit], [10, 10, 20], 'motorista vê a multa antes de cancelar');
    await svc.finishCarpool(caio, t.id, 'cancelled');
    assert.equal(await saldo(ana), 210);
    assert.equal(await saldo(caio), 90);
    assert.equal(await sacavel(caio), 90, 'multa sai do que ele pode sacar');
    assert.equal(sum(all('platformLedger').map((l) => Number(l.feeCents))), 0, 'Froc não ganha com cancelamento do motorista');
    dinheiroFecha('motorista cancelou no meio');
  });

  test('em cima da hora: 20% para cada passageira', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 1);
    await svc.bookCarpool(bia, t.id, 1);
    clock = SAIDA_MS - 0.5 * H;
    await svc.finishCarpool(caio, t.id, 'cancelled');
    assert.equal(await saldo(ana), 210);
    assert.equal(await saldo(bia), 210);
    assert.equal(await saldo(caio), -20, 'caução que estava negativa vira a multa');
    dinheiroFecha('motorista cancelou em cima da hora');
  });

  test('3 cancelamentos com multa em 30 dias: 7 dias sem publicar', async () => {
    for (let i = 0; i < 3; i++) {
      const t = await publicar();
      await svc.bookCarpool(ana, t.id, 1);
      clock = SAIDA_MS - 3 * H;
      await svc.finishCarpool(caio, t.id, 'cancelled');
      clock = SAIDA_MS - 5 * 864e5 + (i + 1) * H;
    }
    await erro(publicar(), 'carpool_suspended');
    clock = SAIDA_MS + 8 * 864e5; // passou a semana de suspensão
    await svc.publishCarpool(caio, { ...ROTA, date: '10/12/2026', departureTime: '08:00', totalSeats: 2, pricePerSeat: 50 });
  });
});

describe('embarque com PIN e viagem realizada', () => {
  test('só quem embarcou com PIN paga o motorista; sem PIN o dinheiro volta', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 1);
    await svc.bookCarpool(bia, t.id, 1);
    const pinAna = await pinDe(ana, t.id);
    assert.match(pinAna, /^\d{4}$/);
    assert.equal((await visao(caio, t.id)).boardingPins, undefined, 'motorista não vê o PIN');
    await erro(svc.finishCarpool(caio, t.id, 'completed'), 'not_departed');
    clock = SAIDA_MS + 5 * 60000;
    await svc.boardCarpool(caio, t.id, pinAna);
    assert.equal((await visao(caio, t.id)).passengers!.find((p) => p.name === 'Ana')!.status, 'boarded');
    await erro(svc.cancelCarpoolBooking(ana, t.id), 'not_found');
    await svc.finishCarpool(caio, t.id, 'completed');
    assert.equal(await saldo(caio), 35, 'R$ 50 da Ana × 70%; cauções voltam');
    assert.equal(await saldo(bia), 200, 'Bia sem embarque confirmado: recebe de volta');
    dinheiroFecha('viagem realizada');
  });

  test('PIN errado: avisa quantas tentativas restam e trava depois de 5', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 1);
    const certo = await pinDe(ana, t.id);
    const errado = certo === '1111' ? '2222' : '1111';
    for (let i = 0; i < CARPOOL_POLICY.maxWrongPins; i++) await erro(svc.boardCarpool(caio, t.id, errado), 'wrong_pin');
    await erro(svc.boardCarpool(caio, t.id, certo), 'pin_locked');
  });

  test('outra pessoa não confirma embarque nem encerra', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 1);
    await erro(svc.boardCarpool(ana, t.id, await pinDe(ana, t.id)), 'forbidden');
    await erro(svc.finishCarpool(ana, t.id, 'completed'), 'forbidden');
  });
});

describe('passageiro não apareceu', () => {
  test('depois de 15 min e no ponto de encontro: motorista recebe', async () => {
    const t = await publicar();
    await svc.bookCarpool(ana, t.id, 1);
    const reserva = (await visao(caio, t.id)).passengers![0].bookingId!;
    clock = SAIDA_MS + 5 * 60000;
    await erro(svc.carpoolNoShow(caio, t.id, reserva, TIETE.lat, TIETE.lng), 'too_early');
    clock = SAIDA_MS + 16 * 60000;
    await erro(svc.carpoolNoShow(caio, t.id, reserva, TIETE.lat + 0.2, TIETE.lng), 'not_at_pickup');
    await svc.carpoolNoShow(caio, t.id, reserva, TIETE.lat + 0.005, TIETE.lng);
    await svc.finishCarpool(caio, t.id, 'completed');
    assert.equal(await saldo(caio), 35);
    assert.equal(await saldo(ana), 150);
    dinheiroFecha('passageira faltou');
  });
});

describe('caronas publicadas antes desta mudança', () => {
  test('reserva antiga sem PIN continua pagando o motorista ao concluir', async () => {
    const t = await publicar();
    await store.set('carpoolBookings', 'antiga', { id: 'antiga', tripId: t.id, passengerId: ana.uid, passengerName: 'Ana', seats: 1, amountCents: 5000, status: 'paid', createdAt: new Date(clock).toISOString() });
    await store.update('users', ana.uid, { balanceCents: 15000 });
    clock = SAIDA_MS + 60000;
    await svc.finishCarpool(caio, t.id, 'completed');
    assert.equal(await saldo(caio), 35);
  });
});
