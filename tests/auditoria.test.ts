/**
 * Auditoria de 19/11/2026: problemas encontrados no pente fino e corrigidos.
 *  1. Cancelar 2+ reservas na mesma carona (leitura depois de escrita: o Firestore recusava).
 *  2. Dinheiro retido preso: corrida/viagem/carona que o motorista esqueceu de encerrar.
 *  3. Pedido de corrida em dobro (toque duplo) cobrava duas vezes.
 *  4. Foto de perfil de quem tem viagem agendada aberta ficava visível para qualquer conta.
 *  5. Token com "kid" inventado fazia o servidor buscar as chaves do Google a cada requisição.
 * Rodar: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService, STALE_ACCEPTED_H, STALE_IN_PROGRESS_H, STALE_TRIP_H } from '../server/services.ts';
import type { AuthUser } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import { createTokenVerifier } from '../server/firebaseToken.ts';

const H = 3600_000;
const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };
const ROTA = { originId: 'sp-tiete', destinationId: 'br-campinas' };
const SAIDA = '27/11/2026';
const SAIDA_MS = Date.parse('2026-11-27T11:00:00Z');
const ana: AuthUser = { uid: 'p1', email: 'ana@x.com', emailVerified: true, name: 'Ana' };
const bia: AuthUser = { uid: 'p2', email: 'bia@x.com', emailVerified: true, name: 'Bia' };
const caio: AuthUser = { uid: 'd1', email: 'caio@x.com', emailVerified: true, name: 'Caio' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const LEGAL = { cnhExpiry: '2035-01-01', city: 'São Paulo', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true } };

let store: MemoryStore;
let svc: FrocService;
let clock: number;
const saldo = async (u: AuthUser) => Number((await store.get<{ balanceCents: number }>('users', u.uid))!.balanceCents) / 100;
async function erro(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code, `esperava ${code}`);
}

beforeEach(async () => {
  clock = SAIDA_MS - 5 * 864e5;
  store = new MemoryStore();
  const files = {
    async save() {},
    async signedUrl(p: string) {
      return 'https://x/' + p;
    },
    async read() {
      return { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' };
    },
  };
  svc = new FrocService(store, { now: () => new Date(clock), adminEmails: ['dono@froc.com'], geo: createGridGeo(), files });
  for (const u of [ana, bia, caio, admin]) await svc.ensureUser(u);
  for (const u of [ana, bia]) await store.update('users', u.uid, { balanceCents: 50000 });
  for (const d of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(caio, 'driver', d, 'image/png', 'eA==');
  await svc.applyAsProvider(caio, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix Prata', plate: 'ABC1D23' });
  await svc.reviewApplication(admin, caio.uid, 'driver', 'approved', '');
});

describe('1. caronas: cancelar várias reservas de uma vez', () => {
  test('duas reservas na mesma carona: cancela as duas e devolve tudo', async () => {
    const t = await svc.publishCarpool(caio, { ...ROTA, date: SAIDA, departureTime: '08:00', totalSeats: 4, pricePerSeat: 50 });
    await svc.bookCarpool(ana, t.id, 1);
    await svc.bookCarpool(ana, t.id, 2);
    assert.equal(await saldo(ana), 350);
    clock = SAIDA_MS - 48 * H;
    const after = await svc.cancelCarpoolBooking(ana, t.id);
    assert.equal(await saldo(ana), 500, '100% de volta das duas reservas');
    assert.equal(await saldo(caio), 0, 'caução das duas reservas voltou');
    assert.equal(after.availableSeats, 4);
    await erro(svc.cancelCarpoolBooking(ana, t.id), 'not_found');
  });
});

describe('2. dinheiro retido nunca fica preso', () => {
  test('corrida aceita e nunca iniciada: cancelada e 100% de volta ao passageiro', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    await svc.updateProfile(caio, { driverOnline: true });
    const r = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, r.id, { action: 'driver_accept' });
    clock += (STALE_ACCEPTED_H - 1) * H;
    await svc.sweep(true);
    assert.equal((await store.get('rides', r.id))!.status, 'accepted', 'antes do prazo nada muda');
    clock += 2 * H;
    await svc.sweep(true);
    const ride = (await store.get('rides', r.id))!;
    assert.equal(ride.status, 'cancelled');
    assert.equal(ride.cancelledBy, 'timeout_driver');
    assert.equal(await saldo(ana), 500);
  });

  test('corrida iniciada com PIN e não finalizada: finalizada e o motorista recebe', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    await svc.updateProfile(caio, { driverOnline: true });
    const r = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, r.id, { action: 'driver_accept' });
    const pin = String((await store.get('rides', r.id))!.pinCode);
    await svc.rideAction(caio, r.id, { action: 'start', pin });
    clock += (STALE_IN_PROGRESS_H + 1) * H;
    await svc.sweep(true);
    assert.equal((await store.get('rides', r.id))!.status, 'completed');
    assert.ok((await saldo(caio)) > 0, 'motorista recebeu');
  });

  test('carona passada e esquecida: quem não embarcou recebe de volta, caução volta', async () => {
    const t = await svc.publishCarpool(caio, { ...ROTA, date: SAIDA, departureTime: '08:00', totalSeats: 4, pricePerSeat: 50 });
    await svc.bookCarpool(ana, t.id, 1);
    clock = SAIDA_MS + (STALE_TRIP_H - 1) * H;
    await svc.sweep(true);
    assert.equal((await store.get('carpools', t.id))!.status, 'open');
    clock = SAIDA_MS + (STALE_TRIP_H + 1) * H;
    await svc.sweep(true);
    assert.equal((await store.get('carpools', t.id))!.status, 'completed');
    assert.equal(await saldo(ana), 500);
    assert.equal(await saldo(caio), 0);
  });

  test('viagem agendada passada e esquecida: sem embarque confirmado, o valor volta', async () => {
    const req = await svc.createInDrive(ana, { ...ROTA, date: SAIDA, time: '08:00', passengerOffer: 400, shareMode: 'individual', seats: 1 });
    const withOffer = await svc.sendInDriveOffer(caio, req.id, { offeredPrice: 400, etaMin: 10 });
    await svc.acceptInDriveOffer(ana, req.id, withOffer.offers[0].id);
    assert.equal(await saldo(ana), 100);
    clock = SAIDA_MS + (STALE_TRIP_H + 3) * H;
    await svc.sweep(true);
    assert.equal((await store.get('indrive', req.id))!.status, 'completed');
    assert.equal(await saldo(ana), 500);
    assert.equal(await saldo(caio), 0, 'caução devolvida');
  });
});

describe('3. corrida pedida em dobro', () => {
  test('dois pedidos ao mesmo tempo: só um é criado e cobrado', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    const results = await Promise.allSettled([svc.createRide(ana, { ...SP, categoryId: 'froc_x' }), svc.createRide(ana, { ...SP, categoryId: 'froc_x' })]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, 'ride_in_progress');
    assert.equal((await store.query('rides', [['passengerId', '==', ana.uid]])).length, 1);
  });

  test('depois de cancelar, pode pedir de novo', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    const r = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(ana, r.id, { action: 'cancel' });
    await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
  });
});

describe('4. foto de perfil', () => {
  test('pedido de viagem agendada aberto: motorista aprovado vê a foto; outra conta não', async () => {
    await store.update('users', ana.uid, { photoPath: 'rostos/p1.jpg' });
    await svc.createInDrive(ana, { ...ROTA, date: SAIDA, time: '08:00', passengerOffer: 400, shareMode: 'individual', seats: 1 });
    await erro(svc.profilePhoto(bia, ana.uid), 'forbidden');
    const img = await svc.profilePhoto(caio, ana.uid);
    assert.equal(img.contentType, 'image/jpeg');
  });
});

describe('5. login: chave desconhecida não sobrecarrega', () => {
  test('kid inventado busca as chaves no máximo 1 vez por minuto', async () => {
    let fetches = 0;
    let t = 1_800_000_000;
    const verify = createTokenVerifier({
      projectId: 'p',
      nowSeconds: () => t,
      fetchCerts: async () => {
        fetches++;
        return { certs: {}, maxAgeSeconds: 3600 };
      },
    });
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'RS256', kid: 'falso' })}.${b64({ aud: 'p', iss: 'https://securetoken.google.com/p', exp: t + 600, iat: t, sub: 'u' })}.x`;
    for (let i = 0; i < 5; i++) await assert.rejects(verify(token));
    assert.equal(fetches, 1);
    t += 61;
    await assert.rejects(verify(token));
    assert.equal(fetches, 2);
  });
});
