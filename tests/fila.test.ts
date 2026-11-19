/**
 * Fila do motorista (pedido do dono, 19/11/2026): até 3 corridas — a atual + 2 na fila.
 * Quando ele termina a atual, a próxima entra sozinha. O passageiro da fila vê que o motorista
 * termina outra corrida antes e pode cancelar sem custo.
 * Rodar: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService, MAX_DRIVER_QUEUE } from '../server/services.ts';
import type { AuthUser } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';

const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };
const pass = ['p1', 'p2', 'p3', 'p4'].map((uid, i): AuthUser => ({ uid, email: `${uid}@x.com`, emailVerified: true, name: ['Ana', 'Bia', 'Cris', 'Duda'][i] }));
const caio: AuthUser = { uid: 'd1', email: 'caio@x.com', emailVerified: true, name: 'Caio' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const LEGAL = { cnhExpiry: '2035-01-01', city: 'São Paulo', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true } };

let store: MemoryStore;
let svc: FrocService;
let clock: number;
async function erro(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code, `esperava ${code}`);
}
const corrida = async (u: AuthUser, id: string) => (await svc.bootstrap(u)).rides.find((r) => r.id === id)!;

beforeEach(async () => {
  clock = Date.parse('2026-11-18T18:00:00Z');
  store = new MemoryStore();
  svc = new FrocService(store, { now: () => new Date(clock), adminEmails: ['dono@froc.com'], geo: createGridGeo(), files: { async save() {}, async signedUrl(p) { return 'https://x/' + p; } } });
  for (const u of [...pass, caio, admin]) await svc.ensureUser(u);
  for (const u of pass) await store.update('users', u.uid, { balanceCents: 20000 });
  for (const d of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(caio, 'driver', d, 'image/png', 'eA==');
  await svc.applyAsProvider(caio, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix Prata', plate: 'ABC1D23' });
  await svc.reviewApplication(admin, caio.uid, 'driver', 'approved', '');
  await svc.updateProfile(caio, { driverOnline: true });
});

describe('fila de corridas do motorista', () => {
  test('aceita até 3; a 4ª é recusada', async () => {
    assert.equal(MAX_DRIVER_QUEUE, 3);
    const rides = [];
    for (const p of pass) rides.push(await svc.createRide(p, { ...SP, categoryId: 'froc_x' }));
    for (const r of rides.slice(0, 3)) await svc.rideAction(caio, r.id, { action: 'driver_accept' });
    await erro(svc.rideAction(caio, rides[3].id, { action: 'driver_accept' }), 'queue_full');
    const [a, b, c] = await Promise.all(rides.slice(0, 3).map((r, i) => corrida(pass[i], r.id)));
    assert.equal(a.queued, false);
    assert.equal(b.queued, true);
    assert.equal(b.queuePosition, 1);
    assert.equal(c.queuePosition, 2);
    assert.ok((b.etaMin ?? 0) > (a.etaMin ?? 0), 'quem está na fila espera mais (o motorista termina outra antes)');
  });

  test('corrida da fila não começa antes da atual terminar', async () => {
    const r1 = await svc.createRide(pass[0], { ...SP, categoryId: 'froc_x' });
    const r2 = await svc.createRide(pass[1], { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, r1.id, { action: 'driver_accept' });
    await svc.rideAction(caio, r2.id, { action: 'driver_accept' });
    await erro(svc.rideAction(caio, r2.id, { action: 'start', pin: r2.pinCode }), 'queued');
  });

  test('terminou a atual: a próxima entra sozinha e as outras sobem', async () => {
    const rides = [];
    for (const p of pass.slice(0, 3)) rides.push(await svc.createRide(p, { ...SP, categoryId: 'froc_x' }));
    for (const r of rides) await svc.rideAction(caio, r.id, { action: 'driver_accept' });
    await svc.rideAction(caio, rides[0].id, { action: 'start', pin: rides[0].pinCode });
    await svc.rideAction(caio, rides[0].id, { action: 'complete' });
    const b = await corrida(pass[1], rides[1].id);
    const c = await corrida(pass[2], rides[2].id);
    assert.equal(b.queued, false, 'a 2ª virou a atual');
    assert.equal(c.queuePosition, 1, 'a 3ª subiu');
    await svc.rideAction(caio, rides[1].id, { action: 'start', pin: rides[1].pinCode });
  });

  test('passageiro da fila cancela sem custo', async () => {
    const r1 = await svc.createRide(pass[0], { ...SP, categoryId: 'froc_x' });
    const r2 = await svc.createRide(pass[1], { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, r1.id, { action: 'driver_accept' });
    await svc.rideAction(caio, r2.id, { action: 'driver_accept' });
    clock += 5 * 60_000;
    await svc.rideAction(pass[1], r2.id, { action: 'cancel' });
    assert.equal((await svc.bootstrap(pass[1])).profile.walletBalance, 200);
  });

  test('passageiro da atual cancela: a da fila entra sozinha', async () => {
    const r1 = await svc.createRide(pass[0], { ...SP, categoryId: 'froc_x' });
    const r2 = await svc.createRide(pass[1], { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, r1.id, { action: 'driver_accept' });
    await svc.rideAction(caio, r2.id, { action: 'driver_accept' });
    await svc.rideAction(pass[0], r1.id, { action: 'cancel' });
    assert.equal((await corrida(pass[1], r2.id)).queued, false);
  });

  test('janela de chamada: 3 segundos por padrão, ajustável no Admin (3 a 30)', async () => {
    assert.equal((await svc.bootstrap(caio)).profile.rideCallSeconds, 3);
    await svc.updateSettings(admin, { rideCallSeconds: 15 });
    assert.equal((await svc.bootstrap(caio)).profile.rideCallSeconds, 15);
    await erro(svc.updateSettings(admin, { rideCallSeconds: 1 }), 'invalid_rideCallSeconds');
  });
});
