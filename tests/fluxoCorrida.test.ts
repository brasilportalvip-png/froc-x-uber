/**
 * Fluxo da corrida no celular (pedido do dono, 19/11/2026): chamada tocando, fila de 3,
 * "cheguei" automático perto do embarque, rota ao vivo econômica e botões de navegação.
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_ARRIVE_KM,
  canAcceptMore,
  currentDriving,
  liveTarget,
  navLinks,
  needsReroute,
  nextCall,
  queuedDriving,
  shortKm,
  shouldAutoArrive,
  slideConfirmed,
} from '../src/lib/rideFlow.ts';
import { ARRIVAL_RADIUS_KM } from '../src/data/ridePolicy.ts';
import type { RideOrder } from '../src/types/mobility.ts';

const A = { id: 'a', name: 'Embarque', lat: -23.5614, lng: -46.6559 };
const B = { id: 'b', name: 'Destino', lat: -23.5672, lng: -46.6936 };
const ride = (id: string, over: Partial<RideOrder> = {}) =>
  ({ id, status: 'searching', mine: null, origin: A, destination: B, passengerName: 'Ana', messages: [], ...over }) as unknown as RideOrder;
/** ~ metros para o norte do embarque. */
const north = (m: number) => ({ lat: A.lat + m / 111_320, lng: A.lng });

describe('chamada e fila', () => {
  test('toca o pedido novo e não repete o ignorado', () => {
    const rides = [ride('r1'), ride('r2')];
    assert.equal(nextCall(rides, new Set())?.id, 'r1');
    assert.equal(nextCall(rides, new Set(['r1']))?.id, 'r2');
    assert.equal(nextCall(rides, new Set(['r1', 'r2'])), null);
  });
  test('com 3 corridas (atual + 2 na fila) não toca mais', () => {
    const mine = [
      ride('m1', { mine: 'provider', status: 'in_progress' }),
      ride('m2', { mine: 'provider', status: 'accepted', queued: true, queuePosition: 2 }),
      ride('m3', { mine: 'provider', status: 'accepted', queued: true, queuePosition: 1 }),
    ];
    assert.equal(canAcceptMore(mine), false);
    assert.equal(nextCall([...mine, ride('novo')], new Set()), null);
    assert.equal(canAcceptMore(mine.slice(0, 2)), true);
    assert.equal(currentDriving(mine)?.id, 'm1');
    assert.deepEqual(queuedDriving(mine).map((r) => r.id), ['m3', 'm2']);
  });
});

describe('cheguei automático', () => {
  const indo = ride('x', { mine: 'provider', status: 'accepted' });
  test('dispara perto do embarque, só uma vez', () => {
    assert.ok(AUTO_ARRIVE_KM < ARRIVAL_RADIUS_KM, 'abaixo do raio do servidor para o GPS não oscilar');
    assert.equal(shouldAutoArrive(indo, north(800), new Set()), false);
    assert.equal(shouldAutoArrive(indo, north(150), new Set()), true);
    assert.equal(shouldAutoArrive(indo, north(150), new Set(['x'])), false);
  });
  test('não dispara em fila, entrega, já chegou ou sem GPS', () => {
    assert.equal(shouldAutoArrive({ ...indo, queued: true }, north(50), new Set()), false);
    assert.equal(shouldAutoArrive({ ...indo, status: 'arriving' }, north(50), new Set()), false);
    assert.equal(shouldAutoArrive({ ...indo, delivery: {} as RideOrder['delivery'] }, north(50), new Set()), false);
    assert.equal(shouldAutoArrive(indo, null, new Set()), false);
  });
});

describe('rota ao vivo', () => {
  test('alvo: embarque antes de iniciar, destino em viagem, nada na fila', () => {
    assert.equal(liveTarget(ride('1', { status: 'accepted' })), A);
    assert.equal(liveTarget(ride('1', { status: 'arriving' })), A);
    assert.equal(liveTarget(ride('1', { status: 'in_progress' })), B);
    assert.equal(liveTarget(ride('1', { status: 'accepted', queued: true })), null);
    assert.equal(liveTarget(null), null);
  });
  test('recalcula só depois de andar ~150 m (economiza chamadas)', () => {
    const t0 = 1_000_000;
    const last = { from: north(0), to: B, at: t0 };
    assert.equal(needsReroute(null, north(0), B, t0), true);
    assert.equal(needsReroute(last, north(60), B, t0 + 60_000), false);
    assert.equal(needsReroute(last, north(400), B, t0 + 2_000), false, 'muito cedo');
    assert.equal(needsReroute(last, north(400), B, t0 + 20_000), true);
    assert.equal(needsReroute(last, north(10), A, t0 + 1_000), true, 'mudou o alvo (iniciou a viagem)');
  });
});

describe('telas', () => {
  test('links de navegação com voz', () => {
    const l = navLinks(B);
    assert.match(l.google, /google\.com\/maps\/dir\/\?api=1&destination=-23\.567200,-46\.693600/);
    assert.match(l.waze, /waze\.com\/ul\?ll=-23\.567200,-46\.693600&navigate=yes/);
  });
  test('distância curta e barra de deslizar', () => {
    assert.equal(shortKm(0.348), '350 m');
    assert.equal(shortKm(2.44), '2,4 km');
    assert.equal(slideConfirmed(0.5), false);
    assert.equal(slideConfirmed(0.95), true);
  });
});
