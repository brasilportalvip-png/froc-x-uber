/**
 * Regras de cancelamento, caução e embarque das CARONAS — FONTE ÚNICA (servidor cobra por aqui;
 * o app e os termos mostram o mesmo). Decididas com o dono em 19/11/2026.
 *
 * Os dois lados têm dinheiro reservado na Froc:
 *  - passageiro: o valor da vaga fica retido ao reservar;
 *  - motorista: CAUÇÃO de 20% de cada reserva fica bloqueada no saldo dele até a viagem.
 *    Nas 3 primeiras caronas realizadas ele pode ficar negativo (sem barreira para começar);
 *    depois precisa ter saldo para a caução.
 */

export const CARPOOL_POLICY = {
  /** Cancelar com mais que isso de antecedência não custa nada. */
  freeHours: 24,
  /** Menos que isso = "em cima da hora". */
  lateHours: 2,
  /** Arrependimento: quem reservou há menos que isso cancela sem custo. */
  graceMinutes: 60,
  /** Passageiro que cancela entre 24h e 2h antes recebe esta % de volta. */
  passengerMidRefundPct: 50,
  /** Caução do motorista: % de cada reserva. */
  driverDepositPct: 20,
  /** Multa do motorista (vai para o passageiro): entre 24h e 2h / em cima da hora. */
  driverMidPenaltyPct: 10,
  driverLatePenaltyPct: 20,
  /** Caronas realizadas em que o motorista pode ficar negativo para cobrir a caução. */
  debtAllowedTrips: 3,
  /** Cancelamentos com multa (menos de 24h) que suspendem o motorista. */
  strikesToSuspend: 3,
  strikeWindowDays: 30,
  suspendDays: 7,
  /** Passageiro que não apareceu: o motorista espera isto depois do horário, no ponto de encontro. */
  noShowWaitMinutes: 15,
  noShowRadiusKm: 3,
  /** PINs de embarque errados seguidos antes de travar o embarque daquela carona. */
  maxWrongPins: 5,
} as const;

/** "27/11/2026" + "08:30" (hora de Brasília, UTC−3) → instante em ms. null se não der para ler. */
export function departureMs(date: string, time: string): number | null {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(date || '').trim());
  const t = /^(\d{2}):(\d{2})$/.exec(String(time || '').trim());
  if (!d || !t) return null;
  const [day, month, year, hh, mm] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hh > 23 || mm > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hh + 3, mm);
  const check = new Date(ms - 3 * 3600_000);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null; // 31/02 etc.
  return ms;
}

export const hoursUntil = (departure: number, now: number) => (departure - now) / 3600_000;

/** Quanto o PASSAGEIRO recebe de volta ao cancelar (%). */
export function passengerRefundPct(hoursBefore: number, minutesSinceBooking: number): number {
  const p = CARPOOL_POLICY;
  if (minutesSinceBooking <= p.graceMinutes && hoursBefore > 0) return 100; // arrependimento
  if (hoursBefore > p.freeHours) return 100;
  if (hoursBefore > p.lateHours) return p.passengerMidRefundPct;
  return 0;
}

/** Multa do MOTORISTA ao cancelar (% de cada reserva), que vai para o passageiro. */
export function driverPenaltyPct(hoursBefore: number): number {
  const p = CARPOOL_POLICY;
  if (hoursBefore > p.freeHours) return 0;
  if (hoursBefore > p.lateHours) return p.driverMidPenaltyPct;
  return p.driverLatePenaltyPct;
}

export const depositCentsFor = (bookingCents: number) => Math.round((bookingCents * CARPOOL_POLICY.driverDepositPct) / 100);

/** Cancelamentos com multa nos últimos 30 dias (incluindo o de agora) e se suspende. */
export function strikesAfter(previous: string[], nowMs: number) {
  const windowMs = CARPOOL_POLICY.strikeWindowDays * 864e5;
  const recent = previous.filter((iso) => nowMs - Date.parse(iso) < windowMs);
  const strikes = [...recent, new Date(nowMs).toISOString()];
  const suspendedUntil = strikes.length >= CARPOOL_POLICY.strikesToSuspend ? new Date(nowMs + CARPOOL_POLICY.suspendDays * 864e5).toISOString() : null;
  return { strikes, suspendedUntil };
}

/** Textos das regras (termos, ajuda e atendimento por IA). */
export const CARPOOL_POLICY_TEXT = [
  'Ao reservar, o valor da vaga fica retido na Froc até a viagem acontecer.',
  'O motorista deixa uma caução de 20% de cada reserva bloqueada no saldo dele até a viagem. Ela volta quando a viagem acontece ou quando ele cancela com mais de 24h de antecedência. Nas 3 primeiras caronas a caução pode deixar o saldo negativo; depois é preciso ter saldo.',
  'Passageiro que cancela: mais de 24h antes recebe 100% de volta; entre 24h e 2h antes, 50% (os outros 50% vão para o motorista); com menos de 2h ou se não aparecer, não recebe de volta. Quem reservou há menos de 1 hora pode desistir sem custo.',
  'Motorista que cancela: o passageiro sempre recebe 100% de volta. Entre 24h e 2h antes, o motorista paga multa de 10% de cada reserva; com menos de 2h, 20%. A multa sai da caução e vai inteira para o passageiro; a Froc não fica com nada.',
  '3 cancelamentos com multa em 30 dias deixam o motorista 7 dias sem publicar caronas.',
  'No embarque, o passageiro mostra o PIN de 4 números e o motorista digita no app. Sem PIN e sem prova de que o passageiro faltou, o valor volta para o passageiro.',
  'Passageiro que não aparece: o motorista espera 15 minutos no ponto de encontro e toca "Não apareceu"; o app confere pelo GPS se ele estava lá.',
];

/** Distância em linha reta (km), para conferir se o motorista estava no ponto de encontro. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
