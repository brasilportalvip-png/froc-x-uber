/**
 * Regras do fluxo da corrida no celular (sem tela): chamada, fila, "cheguei" automático,
 * quando recalcular a rota ao vivo e links de navegação por voz.
 */
import { kmBetween } from '../data/carpoolPolicy.ts';
import type { RideOrder } from '../types/mobility.ts';

export const MAX_DRIVER_QUEUE = 3;
/** "Cheguei" automático um pouco antes do raio do servidor (300 m), para o GPS não oscilar na borda. */
export const AUTO_ARRIVE_KM = 0.25;
/** Recalcula a rota ao vivo quando o carro anda mais que isto (economiza chamadas ao mapa). */
export const REROUTE_KM = 0.15;
export const REROUTE_MIN_MS = 15_000;

type Pt = { lat: number; lng: number };

const DRIVING = ['accepted', 'arriving', 'in_progress'];

/** Corridas do motorista em andamento (a atual + as da fila). */
export function drivingRides(rides: RideOrder[]) {
  return rides.filter((r) => r.mine === 'provider' && DRIVING.includes(r.status));
}

/** A corrida que o motorista está fazendo agora (não a da fila). */
export function currentDriving(rides: RideOrder[]) {
  return drivingRides(rides).find((r) => !r.queued) ?? null;
}

/** Corridas na fila do motorista, em ordem. */
export function queuedDriving(rides: RideOrder[]) {
  return drivingRides(rides)
    .filter((r) => r.queued)
    .sort((a, b) => (a.queuePosition ?? 9) - (b.queuePosition ?? 9));
}

export function canAcceptMore(rides: RideOrder[]) {
  return drivingRides(rides).length < MAX_DRIVER_QUEUE;
}

/** Próxima chamada para tocar: pedido novo, ainda não ignorado e com espaço na fila. */
export function nextCall(rides: RideOrder[], seen: ReadonlySet<string>) {
  if (!canAcceptMore(rides)) return null;
  return rides.find((r) => r.mine === null && r.status === 'searching' && !seen.has(r.id)) ?? null;
}

/** Deve mandar "cheguei" sozinho? Só uma vez por corrida, com GPS recente e perto do embarque. */
export function shouldAutoArrive(ride: RideOrder | null, pos: Pt | null, alreadySent: ReadonlySet<string>) {
  if (!ride || !pos || ride.delivery || ride.queued) return false;
  if (ride.status !== 'accepted' || alreadySent.has(ride.id)) return false;
  return kmBetween(pos, ride.origin) <= AUTO_ARRIVE_KM;
}

/** Para onde o motorista vai agora: embarque (antes de iniciar) ou destino (em viagem). */
export function liveTarget(ride: RideOrder | null | undefined): Pt | null {
  if (!ride || ride.queued) return null;
  if (ride.status === 'accepted' || ride.status === 'arriving') return ride.origin;
  if (ride.status === 'in_progress') return ride.destination;
  return null;
}

/** Recalcular a rota ao vivo? Andou mais de 150 m (e passou um tempo mínimo) ou mudou o alvo. */
export function needsReroute(last: { from: Pt; to: Pt; at: number } | null, from: Pt, to: Pt, now: number) {
  if (!last) return true;
  if (kmBetween(last.to, to) > 0.02) return true;
  return now - last.at >= REROUTE_MIN_MS && kmBetween(last.from, from) > REROUTE_KM;
}

/** Links para navegar com voz no Google Maps ou no Waze. */
export function navLinks(to: Pt) {
  const ll = `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`,
    waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
  };
}

/** Distância curta legível: "350 m" ou "2,4 km". */
export function shortKm(km: number) {
  if (!Number.isFinite(km)) return '';
  return km < 1 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

/** Barra de deslizar: confirma quando passa de 90% do caminho. */
export function slideConfirmed(fraction: number) {
  return fraction >= 0.9;
}
