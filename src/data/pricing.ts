/**
 * Preço das corridas e ganho da Froc — FONTE ÚNICA (servidor cobra por aqui; o app mostra o mesmo).
 *
 * Preço ao passageiro (estilo Uber): bandeirada + km + minutos da categoria, vezes o
 * dinâmico (faixa de horário × demanda da região), mais o adicional de área de risco
 * (que vai TODO para o motorista). Nunca passa do teto do dinâmico.
 *
 * Ganho da Froc ("a casa"): um valor FIXO de R$ 2 a R$ 8 por corrida, decidido como num
 * leilão pelos fatores do momento (horário, demanda, área de risco, distância), e nunca
 * mais que 30% do valor da corrida. O motorista fica com todo o resto.
 */

export interface TimeBand {
  id: string;
  label: string;
  /** Acréscimo no preço da corrida (%). */
  pricePct: number;
  /** Ganho base da Froc nesta faixa (R$). */
  feeBase: number;
}

/** Faixa de horário (hora de Brasília). Sexta e sábado à noite têm faixa própria. */
export function timeBandAt(date: Date): TimeBand {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const hour = Number(get('hour')) % 24;
  const minutes = hour * 60 + Number(get('minute'));
  const weekday = get('weekday'); // Mon..Sun
  const weekendNight = (weekday === 'Fri' || weekday === 'Sat') && minutes >= 22 * 60;
  const afterWeekendNight = (weekday === 'Sat' || weekday === 'Sun') && minutes < 4 * 60;
  if (weekendNight || afterWeekendNight) return { id: 'balada', label: 'Noite de fim de semana', pricePct: 25, feeBase: 6 };
  if (minutes < 6 * 60) return { id: 'madrugada', label: 'Madrugada', pricePct: 20, feeBase: 4 };
  if (minutes < 9 * 60 + 30) return { id: 'pico_manha', label: 'Pico da manhã', pricePct: 15, feeBase: 5 };
  if (minutes >= 11 * 60 + 30 && minutes < 14 * 60) return { id: 'almoco', label: 'Horário de almoço', pricePct: 10, feeBase: 4 };
  if (minutes >= 17 * 60 && minutes < 20 * 60 + 30) return { id: 'pico_noite', label: 'Pico da noite', pricePct: 20, feeBase: 5 };
  if (minutes >= 20 * 60 + 30) return { id: 'noite', label: 'Noite', pricePct: 10, feeBase: 4 };
  return { id: 'normal', label: 'Horário normal', pricePct: 0, feeBase: 3 };
}

export interface FeeLimits {
  /** Ganho mínimo da Froc por corrida (R$). */
  feeMin: number;
  /** Ganho máximo da Froc por corrida (R$). */
  feeMax: number;
  /** A Froc nunca fica com mais que esta % da corrida. */
  feeMaxPct: number;
}

export const DEFAULT_FEE_LIMITS: FeeLimits = { feeMin: 2, feeMax: 8, feeMaxPct: 30 };

/**
 * "Leilão" do ganho da Froc: parte do valor da faixa de horário e sobe com a demanda,
 * a área de risco e a distância; fica entre o mínimo e o máximo e nunca passa de 30%.
 */
export function platformFee(o: { fare: number; band: TimeBand; demand: number; riskZone: boolean; distanceKm: number }, limits: FeeLimits = DEFAULT_FEE_LIMITS) {
  let fee = o.band.feeBase;
  const reasons: string[] = [o.band.label];
  if (o.demand >= 1.6) {
    fee += 2;
    reasons.push('muita procura');
  } else if (o.demand >= 1.3) {
    fee += 1;
    reasons.push('procura alta');
  }
  if (o.riskZone) {
    fee += 1;
    reasons.push('área de risco');
  }
  if (o.distanceKm > 30) {
    fee += 2;
    reasons.push('viagem longa');
  } else if (o.distanceKm > 15) {
    fee += 1;
    reasons.push('viagem média');
  }
  fee = Math.min(limits.feeMax, Math.max(limits.feeMin, fee));
  const cap = Math.floor(o.fare * limits.feeMaxPct) / 100;
  if (fee > cap) {
    fee = Math.max(Math.min(limits.feeMin, o.fare / 2), cap);
    reasons.push(`limitado a ${limits.feeMaxPct}% da corrida`);
  }
  return { fee: Math.round(fee * 100) / 100, reasons };
}

export interface RiskZoneLike {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
  /** Acréscimo no preço (%) que vai todo para o motorista. */
  surchargePct: number;
  /** 'sempre' ou só à noite (19h–6h). */
  when: 'sempre' | 'noite';
  active: boolean;
}

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/** Área de risco que vale para a partida OU o destino agora (a de maior acréscimo). */
export function riskZoneFor(points: { lat: number; lng: number }[], zones: RiskZoneLike[], date: Date) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(date)) % 24;
  const night = hour >= 19 || hour < 6;
  return (
    zones
      .filter((z) => z.active && (z.when === 'sempre' || night) && points.some((p) => km(p, z) <= z.radiusKm))
      .sort((a, b) => b.surchargePct - a.surchargePct)[0] || null
  );
}

export interface PriceBreakdown {
  /** Tarifa da categoria (bandeirada + km + minutos), sem dinâmico. */
  base: number;
  band: { id: string; label: string; pct: number };
  /** Multiplicador de demanda da região (H3). */
  demand: number;
  /** Multiplicador final (horário × demanda), já limitado ao teto. */
  multiplier: number;
  risk: { id: string; name: string; pct: number; amount: number } | null;
  /** O que o passageiro paga. */
  total: number;
  /** Ganho da Froc. */
  platformFee: number;
  feeReasons: string[];
  /** O que o motorista recebe. */
  driverEarning: number;
}

export function priceRide(o: {
  base: number;
  minimum: number;
  date: Date;
  demand: number;
  maxSurge: number;
  timeSurgeEnabled: boolean;
  risk: RiskZoneLike | null;
  distanceKm: number;
  limits?: FeeLimits;
}): PriceBreakdown {
  const band = timeBandAt(o.date);
  const bandPct = o.timeSurgeEnabled ? band.pricePct : 0;
  const multiplier = Math.min(o.maxSurge, Math.round((1 + bandPct / 100) * o.demand * 100) / 100);
  const fare = Math.max(o.minimum, Math.round(o.base * multiplier * 100) / 100);
  const riskAmount = o.risk ? Math.round(fare * o.risk.surchargePct) / 100 : 0;
  const total = Math.round((fare + riskAmount) * 100) / 100;
  // A taxa da Froc sai da tarifa (o adicional de risco é todo do motorista).
  const { fee, reasons } = platformFee({ fare, band, demand: o.demand, riskZone: Boolean(o.risk), distanceKm: o.distanceKm }, o.limits);
  return {
    base: Math.round(o.base * 100) / 100,
    band: { id: band.id, label: band.label, pct: bandPct },
    demand: o.demand,
    multiplier,
    risk: o.risk ? { id: o.risk.id, name: o.risk.name, pct: o.risk.surchargePct, amount: riskAmount } : null,
    total,
    platformFee: fee,
    feeReasons: reasons,
    driverEarning: Math.round((total - fee) * 100) / 100,
  };
}

export const PRICING_TEXT = [
  'O preço segue o modelo da Uber: bandeirada + quilômetros + minutos da categoria, mostrado antes de pedir.',
  'Horários dinâmicos: madrugada +20%, pico da manhã (6h–9h30) +15%, almoço (11h30–14h) +10%, pico da noite (17h–20h30) +20%, noite +10%, sexta e sábado à noite +25%. Com muita procura na região o preço sobe mais, até o teto de 2x.',
  'Área de risco: acréscimo de 10% a 30% que vai inteiro para o motorista.',
  'A Froc fica com um valor fixo de R$ 2 a R$ 8 por corrida (depende do horário, da procura, da área e da distância) e nunca mais que 30% da corrida. Todo o resto é do motorista. Na Uber, a taxa costuma ficar perto de 25% e pode chegar a cerca de 40%.',
];
