/**
 * Viagens particulares — regras de preço mínimo (fonte única: servidor e tela usam a mesma conta).
 * O piso protege o motorista (combustível e tempo); o valor de verdade é combinado entre as partes.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Piso de viagem curta (até 50 km): combustível e tempo de cidade. */
export function urbanFloor(distanceKm: number) {
  const km = Math.max(0.1, distanceKm);
  const minutes = Math.max(1, Math.round(km * 2));
  return r2(Math.max(8.5, km * 1.65 + minutes * 0.2));
}

/**
 * Na estrada (acima de 50 km): mínimo de R$ 2,00 por km (decisão do dono, 19/11/2026).
 * Cobre manutenção, pedágio, trânsito, clima, comida e descanso do motorista e ainda sobra
 * ganho. O valor final é combinado entre passageiro e motorista, sempre acima deste mínimo.
 */
export const HIGHWAY_FLOOR_PER_KM = 2;
/** Lugares de um carro comum para dividir a viagem compartilhada. */
export const SHARED_CAR_SEATS = 4;

export type ShareMode = 'individual' | 'compartilhada';

/** Individual cobre a viagem toda; compartilhada cobre a parte das pessoas no carro. */
export function privateTripFloor(distanceKm: number, shareMode: ShareMode | string, seats: number) {
  const full = distanceKm <= 50 ? urbanFloor(distanceKm) : r2(Math.max(urbanFloor(50), distanceKm * HIGHWAY_FLOOR_PER_KM));
  return shareMode === 'compartilhada' ? r2(Math.max(8.5, (full * Math.min(SHARED_CAR_SEATS, Math.max(1, seats))) / SHARED_CAR_SEATS)) : full;
}

/** Valor sugerido para começar a conversa: 25% acima do mínimo (o combinado fica entre as partes). */
export function suggestedOffer(distanceKm: number, shareMode: ShareMode | string, seats: number) {
  return Math.ceil(privateTripFloor(distanceKm, shareMode, seats) * 1.25);
}
