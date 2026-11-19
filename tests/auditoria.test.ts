/**
 * Auditoria de 19/11/2026: problemas encontrados no pente fino e corrigidos.
 *  1. Cancelar 2+ reservas na mesma carona (leitura depois de escrita: o Firestore recusava).
 *  2. Corrida aceita e não iniciada em 30 min: o valor volta inteiro ao passageiro (como no Uber).
 *     Corrida com PIN termina e paga na hora em que o motorista finaliza; nada espera prazo.
 *  3. Pedido de corrida em dobro (toque duplo) cobrava duas vezes.
 *  4. Foto de perfil de quem tem viagem agendada aberta ficava visível para qualquer conta.
 *  5. Token com "kid" inventado fazia o servidor buscar as chaves do Google a cada requisição.
 *  6. Escala Brasil inteiro: buscas por região (zonas) e prazos por minuto, nunca o país inteiro com limite.
 *  7. Vitrine (caronas, retorno vazio, fretes, viagens agendadas): perto da pessoa + busca por cidade.
 *  8. Tempo real: avisos no Firebase (só um número), regras fechadas e índices das buscas.
 * Rodar: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService, STALE_ACCEPTED_MIN, minuteKey } from '../server/services.ts';
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

describe('2. corrida aceita e não iniciada (30 min) e corrida com PIN', () => {
  const MIN = 60_000;
  test('aceita e não iniciada em 30 min: cancelada e 100% de volta ao passageiro', async () => {
    assert.equal(STALE_ACCEPTED_MIN, 30);
    clock = Date.parse('2026-11-18T18:00:00Z');
    await svc.updateProfile(caio, { driverOnline: true });
    const r = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, r.id, { action: 'driver_accept' });
    clock += 29 * MIN;
    await svc.sweep(true);
    assert.equal((await store.get('rides', r.id))!.status, 'accepted', 'antes de 30 min nada muda');
    clock += 2 * MIN;
    await svc.sweep(true);
    const ride = (await store.get('rides', r.id))!;
    assert.equal(ride.status, 'cancelled');
    assert.equal(ride.cancelledBy, 'timeout_driver');
    assert.equal(await saldo(ana), 500, 'valor inteiro de volta');
    assert.equal(await saldo(caio), 0);
  });

  test('corrida com PIN: o motorista finaliza e recebe na hora; o sistema não mexe em corrida iniciada', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    await svc.updateProfile(caio, { driverOnline: true });
    const r = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, r.id, { action: 'driver_accept' });
    const pin = String((await store.get('rides', r.id))!.pinCode);
    await svc.rideAction(caio, r.id, { action: 'start', pin });
    clock += 40 * MIN;
    await svc.sweep(true);
    assert.equal((await store.get('rides', r.id))!.status, 'in_progress', 'corrida em andamento continua');
    await svc.rideAction(caio, r.id, { action: 'complete' });
    assert.equal((await store.get('rides', r.id))!.status, 'completed');
    assert.ok((await saldo(caio)) > 0, 'motorista recebeu na hora');
  });

  test('carona e viagem agendada: terminam quando o motorista encerra (sem prazo do sistema)', async () => {
    const t = await svc.publishCarpool(caio, { ...ROTA, date: SAIDA, departureTime: '08:00', totalSeats: 4, pricePerSeat: 50 });
    await svc.bookCarpool(ana, t.id, 1);
    clock = SAIDA_MS + 3 * H;
    await svc.sweep(true);
    assert.equal((await store.get('carpools', t.id))!.status, 'open', 'o sistema não encerra sozinho');
    await svc.finishCarpool(caio, t.id, 'completed');
    assert.equal((await store.get('carpools', t.id))!.status, 'completed');
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

describe('6. escala Brasil inteiro (3 milhões de corridas por dia)', () => {
  const MIN = 60_000;
  const RIO = { lat: -22.9068, lng: -43.1729 };
  const PAULISTA = { lat: -23.5614, lng: -46.6559 };
  const geo = createGridGeo();
  const cellRio = geo.cellOf(RIO.lat, RIO.lng);

  /** Milhares de pedidos procurando motorista no Rio, gravados ANTES do pedido de São Paulo. */
  async function lotarRio(n: number, extra: Record<string, unknown> = {}) {
    for (let i = 0; i < n; i++)
      await store.set('rides', `rio-${i}`, { id: `rio-${i}`, passengerId: `x${i}`, status: 'searching', categoryId: 'froc_x', originCell: cellRio, originZone: geo.zoneOf(cellRio), origin: { ...RIO, name: 'Rio' }, destination: { ...RIO, name: 'Rio' }, createdAt: new Date(clock).toISOString(), messages: [], escrowCents: 0, ...extra });
  }

  test('motorista em SP recebe o pedido de SP mesmo com 2.000 pedidos abertos no Rio', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    await lotarRio(2000);
    await svc.updateProfile(caio, { driverOnline: true });
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
    const r = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    const feed = (await svc.bootstrap(caio)).rides.filter((x) => x.status === 'searching');
    assert.ok(feed.some((x) => x.id === r.id), 'o pedido de SP chegou ao motorista de SP');
    assert.ok(!feed.some((x) => x.id.startsWith('rio-')), 'pedidos do Rio não aparecem para quem está em SP');
  });

  test('passageiro em SP vê o carro perto dele mesmo com 2.000 motoristas online no Rio', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    for (let i = 0; i < 2000; i++)
      await store.set('users', `mrio-${i}`, { uid: `mrio-${i}`, driverOnline: true, driverStatus: 'approved', driverLat: RIO.lat, driverLng: RIO.lng, driverCell: cellRio, driverZone: geo.zoneOf(cellRio), locationAt: new Date(clock).toISOString() });
    await svc.updateProfile(caio, { driverOnline: true });
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
    const { drivers } = await svc.nearbyDrivers(ana, PAULISTA.lat, PAULISTA.lng);
    assert.equal(drivers.length, 1);
  });

  test('1.200 pedidos sem motorista vencendo no mesmo minuto: todos cancelados e estornados', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    await svc.sweep(true);
    await lotarRio(1200, { searchDeadline: minuteKey(clock + 10 * MIN) });
    clock += 12 * MIN;
    await svc.sweep(true);
    const still = (await store.query('rides', [['status', '==', 'searching']], 5000)).length;
    assert.equal(still, 0);
  });

  test('relatório do Admin conta todos os motoristas online (não para em 1.000)', async () => {
    for (let i = 0; i < 1500; i++) await store.set('users', `on-${i}`, { uid: `on-${i}`, driverOnline: true });
    assert.equal((await svc.adminReports(admin, 30)).driversOnline, 1500);
  });
});

describe('7. vitrine (caronas, retorno vazio, fretes, viagens agendadas) no Brasil inteiro', () => {
  const RIO = { lat: -22.9068, lng: -43.1729 };
  const PAULISTA = { lat: -23.5614, lng: -46.6559 };

  /** 500 caronas saindo do Rio, gravadas ANTES da carona de São Paulo. */
  async function lotarRio(n: number) {
    for (let i = 0; i < n; i++) {
      const origin = { id: 'rio', name: 'Rio', city: 'Rio de Janeiro', state: 'RJ', zone: 'intercity', kind: 'city', ...RIO };
      await store.set('carpools', `crio-${i}`, { id: `crio-${i}`, driverId: `m${i}`, status: 'open', origin, destination: origin, departureAt: new Date(SAIDA_MS).toISOString(), availableSeats: 3, totalSeats: 3, pricePerSeat: 50, originRegion: createGridGeo().regionOf(RIO.lat, RIO.lng), originCityKey: 'rio de janeiro', destCityKey: 'rio de janeiro' });
    }
  }

  test('passageira em SP vê a carona que sai de SP mesmo com 500 caronas abertas no Rio', async () => {
    await lotarRio(500);
    const t = await svc.publishCarpool(caio, { ...ROTA, date: SAIDA, departureTime: '08:00', totalSeats: 4, pricePerSeat: 50 });
    const view = await svc.bootstrap(ana, PAULISTA);
    assert.ok(view.carpools.some((c) => c.id === t.id), 'a carona de SP aparece');
    assert.ok(!view.carpools.some((c) => c.id.startsWith('crio-')), 'as do Rio não lotam a lista de quem está em SP');
  });

  test('busca por cidade acha a cidade no Brasil inteiro (com ou sem acento)', async () => {
    await lotarRio(500);
    const t = await svc.publishCarpool(caio, { ...ROTA, date: SAIDA, departureTime: '08:00', totalSeats: 4, pricePerSeat: 50 });
    const porDestino = await svc.searchListings(ana, 'carpools', 'campinas');
    assert.ok(porDestino.items.some((c) => (c as { id: string }).id === t.id));
    const rio = await svc.searchListings(ana, 'carpools', 'RIO DE JANEIRO');
    assert.ok(rio.items.length >= 100, 'acha as caronas do Rio buscando pela cidade');
    assert.deepEqual((await svc.searchListings(ana, 'carpools', 'ab')).items, [], 'menos de 3 letras não busca');
  });

  test('viagem agendada: motorista em SP vê o pedido de SP; passageiro comum não usa a busca de motorista', async () => {
    const req = await svc.createInDrive(ana, { ...ROTA, date: SAIDA, time: '08:00', passengerOffer: 400, shareMode: 'individual', seats: 1 });
    const feed = await svc.bootstrap(caio, PAULISTA);
    assert.ok(feed.indriveRequests.some((r) => r.id === req.id));
    assert.ok((await svc.searchListings(caio, 'indrive', 'São Paulo')).items.some((r) => (r as { id: string }).id === req.id));
    assert.deepEqual((await svc.searchListings(bia, 'indrive', 'São Paulo')).items, []);
  });

  test('ofertas antigas (sem as chaves de busca) recebem as chaves pelo agendador', async () => {
    const t = await svc.publishCarpool(caio, { ...ROTA, date: SAIDA, departureTime: '08:00', totalSeats: 4, pricePerSeat: 50 });
    await store.update('carpools', t.id, { originRegion: null, originCityKey: null, destCityKey: null });
    await svc.sweep(true);
    assert.equal((await store.get('carpools', t.id))!.originCityKey, 'sao paulo');
  });
});

describe('8. tempo real (avisos), regras e índices do Firebase', () => {
  const PAULISTA = { lat: -23.5614, lng: -46.6559 };
  const tick = () => new Promise((r) => setTimeout(r, 5));

  test('pedido novo avisa a zona; ação avisa quem participa (passageiro e motorista)', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    await svc.updateProfile(caio, { driverOnline: true });
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
    const r = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    svc.notifyFrom(ana.uid, r);
    await tick();
    const zone = String((await store.get('rides', r.id))!.originZone);
    assert.ok(await store.get('zone_signals', zone), 'a zona do pedido foi avisada');
    const accepted = await svc.rideAction(caio, r.id, { action: 'driver_accept' });
    await store.remove('signals', ana.uid);
    svc.notifyFrom(caio.uid, { ride: accepted });
    await tick();
    assert.ok(await store.get('signals', ana.uid), 'a passageira foi avisada que o motorista aceitou');
    const doc = (await store.get('signals', ana.uid))!;
    assert.deepEqual(Object.keys(doc), ['v'], 'o aviso guarda só um número, nenhum dado');
  });

  test('motorista andando avisa a passageira (carro se mexendo no mapa)', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    await svc.updateProfile(caio, { driverOnline: true });
    const r = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, r.id, { action: 'driver_accept' });
    await store.remove('signals', ana.uid);
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
    await tick();
    assert.ok(await store.get('signals', ana.uid));
  });

  test('motorista online com GPS recebe as zonas para escutar; offline, nenhuma', async () => {
    clock = Date.parse('2026-11-18T18:00:00Z');
    assert.deepEqual((await svc.bootstrap(caio)).live?.zones, []);
    await svc.updateProfile(caio, { driverOnline: true });
    await svc.updateLocation(caio, PAULISTA.lat, PAULISTA.lng);
    const zones = (await svc.bootstrap(caio)).live!.zones;
    assert.ok(zones.length >= 1 && zones.length <= 20);
    assert.deepEqual((await svc.bootstrap(ana)).live?.zones, []);
  });

  test('regras: só lê o próprio aviso e o aviso das zonas; o resto do banco continua fechado', async () => {
    const { readFileSync } = await import('node:fs');
    const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.match(rules, /match \/froc_signals\/\{uid\}\s*\{\s*allow read: if request\.auth != null && request\.auth\.uid == uid;\s*\}/);
    assert.match(rules, /match \/froc_zone_signals\/\{zone\}\s*\{\s*allow read: if request\.auth != null;\s*\}/);
    assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
    assert.equal((rules.match(/allow /g) || []).length, 3, 'nenhuma outra permissão');
    assert.ok(!/allow[^;]*write: if (?!false)/.test(rules), 'o navegador nunca grava');
  });

  test('índices: toda busca com dois campos do servidor tem índice', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../server/services.ts', import.meta.url), 'utf8');
    const idx = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')).indexes as { collectionGroup: string; fields: { fieldPath: string }[] }[];
    const have = new Set(idx.map((i) => `${i.collectionGroup}|${i.fields.map((f) => f.fieldPath).join(',')}`));
    const re = /query<\w+>\((?:'(\w+)'|col),\s*\[\['(\w+)', '==', [^\]]+\],\s*\[(?:'(\w+)'|field), '=='/g;
    const found: string[] = [];
    for (const m of src.matchAll(re)) found.push(m[0]);
    assert.ok(found.length >= 5, 'achou as buscas com dois campos');
    for (const need of ['froc_rides|status,originZone', 'froc_rides|status,searchDeadline', 'froc_rides|status,startDeadline', 'froc_users|driverOnline,driverZone', 'froc_indrive|status,expireDeadline']) assert.ok(have.has(need), need);
    for (const col of ['froc_indrive', 'froc_carpools', 'froc_emptyTrucks', 'froc_freights'])
      for (const f of ['originRegion', 'originCityKey', 'destCityKey']) assert.ok(have.has(`${col}|status,${f}`), `${col} ${f}`);
  });
});
