/**
 * Preço das corridas e ganho da Froc — FONTE ÚNICA (o servidor cobra por aqui; o app mostra o mesmo).
 *
 * LEILÃO AUTOMÁTICO (pedido do dono, 19/11/2026):
 *  - O motorista recebe LIMPO por km rodado: carros de R$ 2 a R$ 5/km; motos de R$ 1,50 a R$ 2,50/km.
 *    O valor do km sobe com os fatores do momento: horário (madrugada, picos, almoço, noite),
 *    fim de semana, feriado nacional, chuva e procura na região. Corrida curta conta no mínimo 3 km.
 *  - A Froc ganha de R$ 2 a R$ 8 por corrida, SOMADOS ao preço (não sai do km do motorista).
 *  - Área de risco: acréscimo que vai todo para o motorista.
 *  - O passageiro vê o preço fechado antes de pedir e os motivos de estar mais caro (sincero);
 *    o motorista vê quanto recebe antes de aceitar.
 */

export interface TimeBand {
  id: string;
  label: string;
  /** Acréscimo no valor do km do motorista (%). */
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
  if (weekendNight || afterWeekendNight) return { id: 'balada', label: 'Noite de fim de semana', pricePct: 40, feeBase: 6 };
  if (minutes < 6 * 60) return { id: 'madrugada', label: 'Madrugada', pricePct: 35, feeBase: 4 };
  if (minutes < 9 * 60 + 30) return { id: 'pico_manha', label: 'Pico da manhã', pricePct: 25, feeBase: 5 };
  if (minutes >= 11 * 60 + 30 && minutes < 14 * 60) return { id: 'almoco', label: 'Horário de almoço', pricePct: 15, feeBase: 4 };
  if (minutes >= 17 * 60 && minutes < 20 * 60 + 30) return { id: 'pico_noite', label: 'Pico da noite', pricePct: 30, feeBase: 5 };
  if (minutes >= 20 * 60 + 30) return { id: 'noite', label: 'Noite', pricePct: 15, feeBase: 4 };
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
export function platformFee(
  o: { fare: number; band: TimeBand; demand: number; riskZone: boolean; distanceKm: number; holiday?: boolean; rain?: RainLevel },
  limits: FeeLimits = DEFAULT_FEE_LIMITS,
) {
  let fee = o.band.feeBase;
  const reasons: string[] = [o.band.label];
  if (o.holiday) {
    fee += 1;
    reasons.push('feriado');
  }
  if (o.rain === 'moderada' || o.rain === 'forte') {
    fee += 1;
    reasons.push('chuva');
  }
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

// ------------------------------------------------------------------ leilão do km

export type RainLevel = 'sem_chuva' | 'fraca' | 'moderada' | 'forte';
export type RideCategoryKey = 'froc_x' | 'froc_comfort' | 'froc_moto' | 'froc_delivery';

/** Faixa do km do motorista (limpo). Carros R$ 2–5; motos R$ 1,50–2,50. */
export const KM_RANGE = { carro: { min: 2, max: 5 }, moto: { min: 1.5, max: 2.5 } } as const;

/** Ponto de partida do km de cada categoria, sem nenhum fator (dentro da faixa). */
export const KM_BASE: Record<RideCategoryKey, { kind: keyof typeof KM_RANGE; base: number }> = {
  froc_x: { kind: 'carro', base: 2.0 },
  froc_comfort: { kind: 'carro', base: 2.9 },
  froc_moto: { kind: 'moto', base: 1.5 },
  froc_delivery: { kind: 'moto', base: 1.6 },
};

/** Corrida curta conta no mínimo estes km (o motorista não roda 1 km por R$ 2). */
export const MIN_BILLED_KM = 3;

/** Acréscimo no km por chuva. */
export const RAIN_PCT: Record<RainLevel, number> = { sem_chuva: 0, fraca: 10, moderada: 20, forte: 35 };
const RAIN_LABEL: Record<RainLevel, string> = { sem_chuva: '', fraca: 'Chuva fraca', moderada: 'Chuva', forte: 'Chuva forte' };
export const WEEKEND_PCT = 10;
export const HOLIDAY_PCT = 25;
/** Procura na região: cada 0,1 acima de 1 vale +10%, até +60%. */
export const DEMAND_MAX_PCT = 60;

// ---------- feriados nacionais (data em Brasília)

function ymdBrasilia(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), weekday: get('weekday') };
}

/** Domingo de Páscoa (algoritmo de Meeus/Butcher). */
export function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

const FIXED_HOLIDAYS: Record<string, string> = {
  '1-1': 'Ano Novo',
  '4-21': 'Tiradentes',
  '5-1': 'Dia do Trabalho',
  '9-7': 'Independência',
  '10-12': 'Nossa Senhora Aparecida',
  '11-2': 'Finados',
  '11-15': 'Proclamação da República',
  '11-20': 'Consciência Negra',
  '12-25': 'Natal',
};

/** Feriado nacional (e Carnaval, Sexta-feira Santa e Corpus Christi) no dia, em Brasília. */
export function holidayAt(date: Date): string | null {
  const { y, m, d } = ymdBrasilia(date);
  const fixed = FIXED_HOLIDAYS[`${m}-${d}`];
  if (fixed) return fixed;
  const e = easterSunday(y);
  const easter = Date.UTC(y, e.m - 1, e.d);
  const today = Date.UTC(y, m - 1, d);
  const diff = Math.round((today - easter) / 864e5);
  if (diff === -48 || diff === -47) return 'Carnaval';
  if (diff === -2) return 'Sexta-feira Santa';
  if (diff === 60) return 'Corpus Christi';
  return null;
}

export function isWeekend(date: Date) {
  const { weekday } = ymdBrasilia(date);
  return weekday === 'Sat' || weekday === 'Sun';
}

export interface PriceFactor {
  id: string;
  label: string;
  /** Acréscimo no km (%). */
  pct: number;
}

/** Fatores do momento que mexem no valor do km (o "leilão"). */
export function auctionFactors(o: { date: Date; demand: number; rain: RainLevel; timeSurgeEnabled: boolean }): PriceFactor[] {
  const out: PriceFactor[] = [];
  if (o.timeSurgeEnabled) {
    const band = timeBandAt(o.date);
    if (band.pricePct > 0) out.push({ id: band.id, label: band.label, pct: band.pricePct });
    // Fim de semana de dia (a noite de sexta/sábado já tem faixa própria, mais alta).
    if (isWeekend(o.date) && band.id !== 'balada') out.push({ id: 'fim_de_semana', label: 'Fim de semana', pct: WEEKEND_PCT });
    const holiday = holidayAt(o.date);
    if (holiday) out.push({ id: 'feriado', label: `Feriado (${holiday})`, pct: HOLIDAY_PCT });
  }
  if (RAIN_PCT[o.rain] > 0) out.push({ id: 'chuva', label: RAIN_LABEL[o.rain], pct: RAIN_PCT[o.rain] });
  const demandPct = Math.min(DEMAND_MAX_PCT, Math.max(0, Math.round((o.demand - 1) * 100)));
  if (demandPct > 0) out.push({ id: 'procura', label: demandPct >= 30 ? 'Muita procura na região' : 'Procura alta na região', pct: demandPct });
  return out;
}

export interface PriceBreakdown {
  /** Fatores do leilão (o passageiro vê os motivos; nunca o ganho da Froc). */
  factors: PriceFactor[];
  /** Faixa de horário (compatibilidade com telas antigas). */
  band: { id: string; label: string; pct: number };
  /** Procura na região (1 = normal). */
  demand: number;
  rain: RainLevel;
  /** Multiplicador final do km, já limitado ao teto e à faixa. */
  multiplier: number;
  /** km do motorista (limpo) e km cobrados (mínimo 3). */
  perKm: number;
  billedKm: number;
  risk: { id: string; name: string; pct: number; amount: number } | null;
  /** O que o passageiro paga. */
  total: number;
  /** Ganho da Froc. */
  platformFee: number;
  feeReasons: string[];
  /** O que o motorista recebe. */
  driverEarning: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function priceRide(o: {
  categoryId: RideCategoryKey;
  distanceKm: number;
  date: Date;
  demand: number;
  /** Teto do multiplicador do km (configuração "maxSurge"). */
  maxSurge: number;
  timeSurgeEnabled: boolean;
  rain?: RainLevel;
  risk: RiskZoneLike | null;
  limits?: FeeLimits;
}): PriceBreakdown {
  const cat = KM_BASE[o.categoryId] ?? KM_BASE.froc_x;
  const range = KM_RANGE[cat.kind];
  const rain = o.rain ?? 'sem_chuva';
  const factors = auctionFactors({ date: o.date, demand: o.demand, rain, timeSurgeEnabled: o.timeSurgeEnabled });
  const multiplier = Math.min(Math.max(1, o.maxSurge), r2(1 + factors.reduce((acc, f) => acc + f.pct, 0) / 100));
  const perKm = r2(Math.min(range.max, Math.max(range.min, cat.base * multiplier)));
  const billedKm = Math.max(MIN_BILLED_KM, Math.round(o.distanceKm * 10) / 10);
  const kmEarning = r2(perKm * billedKm);
  const riskAmount = o.risk ? r2((kmEarning * o.risk.surchargePct) / 100) : 0;
  const band = timeBandAt(o.date);
  const { fee, reasons } = platformFee(
    { fare: kmEarning, band, demand: o.demand, riskZone: Boolean(o.risk), distanceKm: o.distanceKm, holiday: o.timeSurgeEnabled && Boolean(holidayAt(o.date)), rain },
    o.limits,
  );
  const driverEarning = r2(kmEarning + riskAmount);
  return {
    factors,
    band: { id: band.id, label: band.label, pct: o.timeSurgeEnabled ? band.pricePct : 0 },
    demand: o.demand,
    rain,
    multiplier,
    perKm,
    billedKm,
    risk: o.risk ? { id: o.risk.id, name: o.risk.name, pct: o.risk.surchargePct, amount: riskAmount } : null,
    total: r2(driverEarning + fee),
    platformFee: fee,
    feeReasons: reasons,
    driverEarning,
  };
}

export const PRICING_TEXT = [
  'O preço é calculado na hora, como um leilão automático: o valor do km sobe com a madrugada, os picos da manhã e da noite, o almoço, a noite, o fim de semana, os feriados, a chuva e a procura na região.',
  'Corridas muito curtas contam no mínimo 3 km.',
  'O passageiro vê o preço fechado antes de pedir e o motivo quando está mais caro (ex.: chuva, feriado, pico).',
  'Área de risco: acréscimo de 10% a 30% que vai inteiro para o motorista.',
  'O motorista vê quanto vai receber antes de aceitar a corrida.',
];

/**
 * SIGILOSO: o ganho da Froc por corrida (valor, faixa ou porcentagem) é segredo do negócio.
 * Não aparece em página pública, anúncio, blog, termos, app de passageiro/motorista nem na IA
 * de atendimento. Só o painel do dono (Admin) e a Equipe IA interna conhecem os números.
 */
export const FEE_IS_CONFIDENTIAL = true;

/** Texto que fala do ganho da Froc (para barrar no blog e em respostas públicas). */
export const FEE_LEAK = /(R\$\s*2\s*(?:,00)?\s*(?:a|e|até)\s*R?\$?\s*8)|(\b2\s*a\s*8\s*reais)|(taxa\s+(?:fixa\s+)?(?:da\s+)?froc)|(froc\s+(?:fica|cobra|ganha)\s+(?:com\s+)?(?:só\s+|apenas\s+)?(?:R\$|\d))|(comiss[aã]o\s+(?:da\s+)?froc)/i;
