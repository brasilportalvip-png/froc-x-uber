/**
 * Leilão automático do preço (pedido do dono, 19/11/2026):
 *  - motorista recebe LIMPO: carro R$ 2–5/km, moto R$ 1,50–2,50/km;
 *  - Froc soma R$ 2–8 por corrida;
 *  - fatores: madrugada, picos, almoço, noite, fim de semana, feriado, chuva e procura;
 *  - caronas e fretes: Froc fica com 30% do valor total.
 * Rodar: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { FrocService } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import { createOpenMeteoRain, rainLevelOf } from '../server/weather.ts';
import type { RainLevel } from '../src/data/pricing.ts';
import { KM_RANGE, MIN_BILLED_KM, FEE_LEAK, PRICING_TEXT, auctionFactors, easterSunday, holidayAt, isWeekend, priceRide } from '../src/data/pricing.ts';

const at = (iso: string) => new Date(iso); // UTC; Brasília = UTC-3
const QUARTA_15H = at('2026-11-18T18:00:00Z');
const ids = (f: { id: string }[]) => f.map((x) => x.id).sort();

describe('feriados e fim de semana (Brasília)', () => {
  test('Páscoa calculada certo', () => {
    assert.deepEqual(easterSunday(2026), { m: 4, d: 5 });
    assert.deepEqual(easterSunday(2027), { m: 3, d: 28 });
  });
  test('feriados fixos e móveis', () => {
    assert.equal(holidayAt(at('2026-11-20T15:00:00Z')), 'Consciência Negra');
    assert.equal(holidayAt(at('2026-12-25T15:00:00Z')), 'Natal');
    assert.equal(holidayAt(at('2026-02-16T15:00:00Z')), 'Carnaval');
    assert.equal(holidayAt(at('2026-02-17T15:00:00Z')), 'Carnaval');
    assert.equal(holidayAt(at('2026-04-03T15:00:00Z')), 'Sexta-feira Santa');
    assert.equal(holidayAt(at('2026-06-04T15:00:00Z')), 'Corpus Christi');
    assert.equal(holidayAt(QUARTA_15H), null);
  });
  test('vale a data de Brasília: 21h de 19/11 (00h UTC de 20/11) ainda não é feriado', () => {
    assert.equal(holidayAt(at('2026-11-20T00:00:00Z')), null);
    assert.equal(holidayAt(at('2026-11-20T03:30:00Z')), 'Consciência Negra');
  });
  test('fim de semana', () => {
    assert.equal(isWeekend(at('2026-11-21T15:00:00Z')), true); // sábado
    assert.equal(isWeekend(at('2026-11-22T15:00:00Z')), true); // domingo
    assert.equal(isWeekend(QUARTA_15H), false);
  });
});

describe('fatores do leilão', () => {
  const f = (date: Date, demand = 1, rain: RainLevel = 'sem_chuva') => auctionFactors({ date, demand, rain, timeSurgeEnabled: true });
  test('quarta 15h, sem chuva e sem procura: nenhum acréscimo', () => {
    assert.deepEqual(f(QUARTA_15H), []);
  });
  test('cada fator aparece com o motivo', () => {
    assert.deepEqual(ids(f(at('2026-11-18T05:00:00Z'))), ['madrugada']);
    assert.deepEqual(ids(f(at('2026-11-21T18:00:00Z'))), ['fim_de_semana']); // sábado 15h
    assert.deepEqual(ids(f(at('2026-11-20T18:00:00Z'))), ['feriado']); // sexta 15h, Consciência Negra
    assert.deepEqual(ids(f(QUARTA_15H, 1, 'forte')), ['chuva']);
    assert.deepEqual(ids(f(QUARTA_15H, 1.4)), ['procura']);
  });
  test('fatores se somam (pico da noite + chuva + procura)', () => {
    const all = f(at('2026-11-18T21:00:00Z'), 1.3, 'moderada');
    assert.deepEqual(ids(all), ['chuva', 'pico_noite', 'procura']);
    assert.equal(all.reduce((a, x) => a + x.pct, 0), 30 + 20 + 30);
  });
  test('noite de sexta não soma "fim de semana" em cima da faixa própria', () => {
    assert.deepEqual(ids(f(at('2026-11-28T02:00:00Z'))), ['balada']); // sexta 27/11, 23h
  });
  test('procura limitada a +60%', () => {
    assert.equal(f(QUARTA_15H, 3)[0].pct, 60);
  });
  test('admin desligou o leilão por horário: só chuva e procura valem', () => {
    assert.deepEqual(ids(auctionFactors({ date: at('2026-11-20T05:00:00Z'), demand: 1, rain: 'fraca', timeSurgeEnabled: false })), ['chuva']);
  });
});

describe('km do motorista dentro da faixa', () => {
  const base = { distanceKm: 10, demand: 1, maxSurge: 3, timeSurgeEnabled: true, risk: null };
  const carros = ['froc_x', 'froc_comfort'] as const;
  const motos = ['froc_moto', 'froc_delivery'] as const;

  test('horário calmo: carro a partir de R$ 2/km, moto a partir de R$ 1,50/km', () => {
    for (const c of carros) assert.ok(priceRide({ ...base, categoryId: c, date: QUARTA_15H }).perKm >= KM_RANGE.carro.min, c);
    for (const c of motos) assert.ok(priceRide({ ...base, categoryId: c, date: QUARTA_15H }).perKm >= KM_RANGE.moto.min, c);
    assert.equal(priceRide({ ...base, categoryId: 'froc_x', date: QUARTA_15H }).perKm, 2);
    assert.equal(priceRide({ ...base, categoryId: 'froc_moto', date: QUARTA_15H }).perKm, 1.5);
  });

  test('pior momento (feriado de madrugada, chuva forte, muita procura): trava em R$ 5 e R$ 2,50', () => {
    const extremo = { ...base, date: at('2026-12-25T05:00:00Z'), demand: 2, rain: 'forte' as const };
    for (const c of carros) assert.equal(priceRide({ ...extremo, categoryId: c }).perKm, KM_RANGE.carro.max, c);
    for (const c of motos) assert.equal(priceRide({ ...extremo, categoryId: c }).perKm, KM_RANGE.moto.max, c);
  });

  test('em nenhum horário do ano o km sai da faixa', () => {
    for (let h = 0; h < 24 * 14; h += 1) {
      const date = new Date(Date.parse('2026-12-20T00:00:00Z') + h * 3600_000);
      for (const rain of ['sem_chuva', 'forte'] as const)
        for (const demand of [1, 1.5, 2]) {
          const car = priceRide({ ...base, categoryId: 'froc_comfort', date, demand, rain }).perKm;
          const moto = priceRide({ ...base, categoryId: 'froc_moto', date, demand, rain }).perKm;
          assert.ok(car >= 2 && car <= 5, `${date.toISOString()} carro ${car}`);
          assert.ok(moto >= 1.5 && moto <= 2.5, `${date.toISOString()} moto ${moto}`);
        }
    }
  });

  test('chuva encarece; chuva mais forte encarece mais', () => {
    const p = (rain: RainLevel) => priceRide({ ...base, categoryId: 'froc_x', date: QUARTA_15H, rain }).perKm;
    assert.ok(p('sem_chuva') < p('fraca') && p('fraca') < p('moderada') && p('moderada') < p('forte'));
  });

  test('corrida curta conta no mínimo 3 km', () => {
    const curta = priceRide({ ...base, categoryId: 'froc_x', distanceKm: 1.2, date: QUARTA_15H });
    assert.equal(curta.billedKm, MIN_BILLED_KM);
    assert.equal(curta.driverEarning, Math.round(curta.perKm * 3 * 100) / 100);
  });
});

describe('ganho da Froc somado ao preço (motorista recebe limpo)', () => {
  test('total = km do motorista + R$ 2 a 8; motorista não paga taxa', () => {
    for (const [iso, demand, rain] of [
      ['2026-11-18T18:00:00Z', 1, 'sem_chuva'],
      ['2026-11-18T21:00:00Z', 1.8, 'forte'],
      ['2026-12-25T05:00:00Z', 2, 'moderada'],
    ] as const) {
      for (const distanceKm of [2, 10, 45]) {
        const p = priceRide({ categoryId: 'froc_x', distanceKm, date: at(iso), demand, rain, maxSurge: 2, timeSurgeEnabled: true, risk: null });
        assert.equal(p.driverEarning, Math.round(p.perKm * p.billedKm * 100) / 100, 'motorista recebe o km inteiro');
        assert.ok(p.platformFee >= 2 && p.platformFee <= 8, `taxa ${p.platformFee}`);
        assert.equal(p.total, Math.round((p.driverEarning + p.platformFee) * 100) / 100);
      }
    }
  });
  test('feriado e chuva também sobem o ganho da Froc (dentro de R$ 2–8)', () => {
    const calmo = priceRide({ categoryId: 'froc_x', distanceKm: 20, date: QUARTA_15H, demand: 1, maxSurge: 2, timeSurgeEnabled: true, risk: null });
    const feriadoChuva = priceRide({ categoryId: 'froc_x', distanceKm: 20, date: at('2026-11-20T18:00:00Z'), rain: 'forte', demand: 1, maxSurge: 2, timeSurgeEnabled: true, risk: null });
    assert.equal(feriadoChuva.platformFee - calmo.platformFee, 2);
  });
  test('textos públicos explicam o leilão sem contar o ganho da Froc', () => {
    const t = PRICING_TEXT.join(' ');
    assert.ok(!/R\$ 2 a R\$ 5/.test(t), 'km do motorista é do domínio da Froc (pedido do dono)');
    assert.ok(!/R\$ 1,50 a R\$ 2,50/.test(t));
    assert.match(t, /chuva/);
    assert.match(t, /feriados/);
    assert.ok(!FEE_LEAK.test(t), 'ganho da Froc é sigiloso');
  });
});

describe('chuva em tempo real (Open-Meteo)', () => {
  test('mm/h e código do tempo viram nível de chuva', () => {
    assert.equal(rainLevelOf(0, 0), 'sem_chuva');
    assert.equal(rainLevelOf(0.3, 61), 'fraca');
    assert.equal(rainLevelOf(2, 63), 'moderada');
    assert.equal(rainLevelOf(6, 65), 'forte');
    assert.equal(rainLevelOf(0, 95), 'forte', 'temporal');
    assert.equal(rainLevelOf(0, 65), 'forte', 'código de chuva forte');
  });

  test('consulta, guarda 10 min e não encarece se a API falhar', async () => {
    let calls = 0;
    let clock = 0;
    const ok = (precipitation: number, weather_code: number) =>
      (async () => {
        calls++;
        return new Response(JSON.stringify({ current: { precipitation, weather_code } }), { status: 200 });
      }) as unknown as typeof fetch;
    const rain = createOpenMeteoRain({ fetchImpl: ok(5, 65), now: () => clock });
    assert.equal(await rain(-21.79, -48.17), 'forte');
    assert.equal(await rain(-21.791, -48.171), 'forte');
    assert.equal(calls, 1, 'mesmo lugar (~11 km) usa a resposta guardada');
    clock += 11 * 60_000;
    await rain(-21.79, -48.17);
    assert.equal(calls, 2, 'depois de 10 min consulta de novo');

    const quebrada = createOpenMeteoRain({ fetchImpl: (async () => { throw new Error('rede'); }) as unknown as typeof fetch });
    assert.equal(await quebrada(-23.5, -46.6), 'sem_chuva');
    const lenta = createOpenMeteoRain({ timeoutMs: 20, fetchImpl: ((_u: string, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch });
    assert.equal(await lenta(-23.5, -46.6), 'sem_chuva');
    const erro500 = createOpenMeteoRain({ fetchImpl: (async () => new Response('x', { status: 500 })) as unknown as typeof fetch });
    assert.equal(await erro500(-23.5, -46.6), 'sem_chuva');
  });
});

describe('servidor: orçamento, corrida, caronas e fretes', () => {
  const ana: AuthUser = { uid: 'p1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' };
  const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
  const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };
  let svc: FrocService;
  let chuva: RainLevel;
  let rainCalls: number;
  const payments: PaymentsGateway = {
    configured: true,
    async createCheckout({ reference }) {
      return { checkoutUrl: 'x/' + reference, preferenceId: 'p' };
    },
    async findApproved() {
      return null;
    },
    async getPayment() {
      return null;
    },
  };

  beforeEach(async () => {
    chuva = 'sem_chuva';
    rainCalls = 0;
    svc = new FrocService(new MemoryStore(), {
      now: () => QUARTA_15H,
      payments,
      adminEmails: ['dono@froc.com'],
      geo: createGridGeo(),
      rain: async () => {
        rainCalls++;
        return chuva;
      },
    });
    for (const u of [ana, admin]) await svc.ensureUser(u);
  });

  test('chuva no local aparece como motivo e encarece todas as categorias', async () => {
    const seco = await svc.quoteRide(ana, SP);
    chuva = 'forte';
    const molhado = await svc.quoteRide(ana, SP);
    assert.deepEqual(seco.factors, []);
    assert.deepEqual(molhado.factors.map((f) => f.id), ['chuva']);
    assert.equal(molhado.rain, 'forte');
    for (const p of molhado.prices) assert.ok(p.price > seco.prices.find((s) => s.categoryId === p.categoryId)!.price, p.categoryId);
    assert.equal(rainCalls, 2, 'uma consulta de chuva por orçamento, não uma por categoria');
  });

  test('passageiro não recebe nada que revele o ganho da Froc', async () => {
    const q = await svc.quoteRide(ana, SP);
    for (const p of q.prices) {
      const b = p.breakdown as Record<string, unknown>;
      for (const k of ['platformFee', 'feeReasons', 'driverEarning', 'perKm', 'billedKm']) assert.equal(b[k], undefined, `${p.categoryId}.${k}`);
    }
  });

  test('admin desliga o leilão por chuva', async () => {
    chuva = 'forte';
    await svc.updateSettings(admin, { rainSurgeEnabled: false });
    const q = await svc.quoteRide(ana, SP);
    assert.deepEqual(q.factors, []);
    assert.equal(rainCalls, 0);
  });

  test('comissão de caronas e fretes: 30% do total por padrão, mudável de 0 a 50%', async () => {
    const cfg = await svc.settings();
    assert.equal(cfg.carpoolCommissionPercent, 30);
    assert.equal(cfg.freightCommissionPercent, 30);
    assert.equal((await svc.updateSettings(admin, { carpoolCommissionPercent: 25 })).carpoolCommissionPercent, 25);
    await assert.rejects(svc.updateSettings(admin, { carpoolCommissionPercent: 60 }));
  });
});
