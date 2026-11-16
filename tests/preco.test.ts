/**
 * Preço estilo Uber (horários dinâmicos, demanda, área de risco) e ganho fixo da Froc (R$ 2–8),
 * mais a Equipe IA no comando: saques e lojas liberados sozinhos dentro das regras.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { FrocService } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import { platformFee, priceRide, riskZoneFor, timeBandAt } from '../src/data/pricing.ts';

const at = (iso: string) => new Date(iso); // horários em UTC; Brasília = UTC-3
const ana: AuthUser = { uid: 'p1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' };
const caio: AuthUser = { uid: 'd1', email: 'caio@exemplo.com', emailVerified: true, name: 'Caio' };
const loja: AuthUser = { uid: 'm1', email: 'loja@exemplo.com', emailVerified: true, name: 'Loja' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };
const LEGAL = { cnhExpiry: '2035-01-01', city: 'Campinas', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true } };

let store: MemoryStore;
let svc: FrocService;
let clock: number;
let approved: Map<string, number>;
let sentPix: string[];
let cnpjAtivo: boolean;
const payments: PaymentsGateway = {
  configured: true,
  async createCheckout({ reference }) {
    return { checkoutUrl: 'x/' + reference, preferenceId: 'p' };
  },
  async findApproved(ref) {
    const c = approved.get(ref);
    return c ? { paymentId: '1', amountCents: c } : null;
  },
  async getPayment() {
    return null;
  },
};
async function topUp(u: AuthUser, reais: number) {
  const { topupId } = await svc.createTopup(u, reais);
  approved.set(topupId, Math.round(reais * 100));
  await svc.confirmTopup(topupId, u.uid);
}
function build(withPayout: boolean) {
  svc = new FrocService(store, {
    now: () => new Date(clock),
    payments,
    adminEmails: ['dono@froc.com'],
    geo: createGridGeo(),
    files: { async save() {}, async signedUrl(p) { return 'https://x/' + p; } },
    payouts: withPayout
      ? {
          async send(w) {
            sentPix.push(`${w.pixKey}:${w.amountCents}`);
            return { ok: true, externalId: 'mp-' + w.id };
          },
        }
      : undefined,
    cnpjLookup: async () => ({ active: cnpjAtivo, name: 'LOJA', situation: cnpjAtivo ? 'ATIVA' : 'BAIXADA' }),
  });
}

beforeEach(async () => {
  clock = Date.parse('2026-11-18T18:00:00Z'); // quarta, 15h em Brasília (horário normal)
  approved = new Map();
  sentPix = [];
  cnpjAtivo = true;
  store = new MemoryStore();
  build(false);
  for (const u of [ana, caio, loja, admin]) await svc.ensureUser(u);
});

describe('faixas de horário (Brasília)', () => {
  for (const [iso, id, pct] of [
    ['2026-11-18T05:00:00Z', 'madrugada', 20], // 2h
    ['2026-11-18T10:00:00Z', 'pico_manha', 15], // 7h
    ['2026-11-18T15:30:00Z', 'almoco', 10], // 12h30
    ['2026-11-18T18:00:00Z', 'normal', 0], // 15h
    ['2026-11-18T21:00:00Z', 'pico_noite', 20], // 18h
    ['2026-11-19T00:30:00Z', 'noite', 10], // 21h30 quarta
    ['2026-11-21T02:00:00Z', 'balada', 25], // sexta 23h
    ['2026-11-22T05:00:00Z', 'balada', 25], // domingo 2h (saída de sábado)
  ] as const) {
    test(`${iso} → ${id} (+${pct}%)`, () => {
      const b = timeBandAt(at(iso));
      assert.equal(b.id, id);
      assert.equal(b.pricePct, pct);
    });
  }
});

describe('ganho da Froc: R$ 2 a R$ 8, nunca mais de 30%', () => {
  const band = (iso: string) => timeBandAt(at(iso));
  test('horário normal e corrida comum: perto do mínimo', () => {
    assert.equal(platformFee({ fare: 25, band: band('2026-11-18T18:00:00Z'), demand: 1, riskZone: false, distanceKm: 5 }).fee, 3);
  });
  test('pico + muita procura + área de risco + viagem longa: trava em R$ 8', () => {
    assert.equal(platformFee({ fare: 120, band: band('2026-11-18T21:00:00Z'), demand: 1.8, riskZone: true, distanceKm: 40 }).fee, 8);
  });
  test('corrida barata: a Froc nunca fica com mais de 30%', () => {
    const r = platformFee({ fare: 9, band: band('2026-11-18T21:00:00Z'), demand: 1.8, riskZone: false, distanceKm: 3 });
    assert.ok(r.fee <= 2.7 + 1e-9, String(r.fee));
    assert.ok(r.fee >= 2);
  });
  test('o ganho sobe com a procura (leilão)', () => {
    const b = band('2026-11-18T18:00:00Z');
    const calm = platformFee({ fare: 40, band: b, demand: 1, riskZone: false, distanceKm: 8 }).fee;
    const busy = platformFee({ fare: 40, band: b, demand: 1.7, riskZone: false, distanceKm: 8 }).fee;
    assert.ok(busy > calm);
  });
});

describe('preço da corrida', () => {
  test('dinâmico de horário × demanda limitado ao teto; motorista recebe total − taxa', () => {
    const p = priceRide({ base: 20, minimum: 7.5, date: at('2026-11-18T21:00:00Z'), demand: 1.8, maxSurge: 2, timeSurgeEnabled: true, risk: null, distanceKm: 6 });
    assert.equal(p.multiplier, 2, '1,2 × 1,8 = 2,16 → teto 2');
    assert.equal(p.total, 40);
    assert.equal(Math.round((p.total - p.platformFee) * 100) / 100, p.driverEarning);
  });
  test('área de risco: acréscimo vai todo para o motorista', () => {
    const zone = { id: 'z', name: 'Morro X', lat: -23.56, lng: -46.65, radiusKm: 1, surchargePct: 20, when: 'sempre' as const, active: true };
    const found = riskZoneFor([{ lat: -23.561, lng: -46.651 }], [zone], at('2026-11-18T18:00:00Z'));
    assert.equal(found?.id, 'z');
    const semRisco = priceRide({ base: 20, minimum: 7.5, date: at('2026-11-18T18:00:00Z'), demand: 1, maxSurge: 2, timeSurgeEnabled: true, risk: null, distanceKm: 5 });
    const comRisco = priceRide({ base: 20, minimum: 7.5, date: at('2026-11-18T18:00:00Z'), demand: 1, maxSurge: 2, timeSurgeEnabled: true, risk: zone, distanceKm: 5 });
    assert.equal(comRisco.total, 24);
    assert.equal(comRisco.platformFee - semRisco.platformFee, 1, 'Froc ganha só R$ 1 a mais');
    assert.equal(comRisco.driverEarning - semRisco.driverEarning, 3, 'motorista leva os R$ 4 de risco menos o R$ 1');
    assert.equal(riskZoneFor([{ lat: -23.561, lng: -46.651 }], [{ ...zone, when: 'noite' }], at('2026-11-18T18:00:00Z')), null, 'zona só de noite não vale às 15h');
  });
});

describe('corrida de verdade com o novo preço', () => {
  async function driver() {
    await svc.registerCpf(caio, { cpf: '168.995.350-09', fullName: 'Caio Souza', birthDate: '1985-01-01' }).catch(() => undefined);
    for (const d of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(caio, 'driver', d, 'image/png', 'eA==');
    await svc.applyAsProvider(caio, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix', plate: 'ABC1D23' });
    await svc.reviewApplication(admin, caio.uid, 'driver', 'approved', '');
    await svc.updateProfile(caio, { driverOnline: true });
  }

  test('passageiro paga o preço; motorista recebe tudo menos R$ 2–8; a Froc registra o ganho', async () => {
    await driver();
    await topUp(ana, 200);
    const quote = await svc.quoteRide(ana, SP);
    assert.equal(quote.band.id, 'normal');
    const q = quote.prices.find((p) => p.categoryId === 'froc_x')!;
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    assert.equal(ride.price, q.price, 'preço cobrado = preço mostrado');
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    await svc.rideAction(caio, ride.id, { action: 'start', pin: ride.pinCode });
    await svc.rideAction(caio, ride.id, { action: 'complete' });
    const fee = ride.pricing!.platformFee;
    assert.ok(fee >= 2 && fee <= 8);
    assert.equal((await svc.bootstrap(caio)).profile.walletBalance, Math.round((ride.price - fee) * 100) / 100);
    const ledger = [...(store.data.get('platformLedger')?.values() || [])];
    assert.equal(ledger.at(-1)?.feeCents, Math.round(fee * 100), 'ganho da Froc registrado nos relatórios');
  });

  test('área de risco cadastrada pela equipe muda o preço e o ganho do motorista', async () => {
    await svc.saveRiskZone(admin, { name: 'Área de teste', lat: -23.5614, lng: -46.6559, radiusKm: 2, surchargePct: 20 });
    const q = await svc.quoteRide(ana, SP);
    assert.equal(q.risk?.name, 'Área de teste');
    const x = q.prices.find((p) => p.categoryId === 'froc_x')!;
    assert.ok(x.breakdown.risk!.amount > 0);
  });
});

describe('Equipe IA no comando: saques e lojas', () => {
  async function earnedDriver(reais: number) {
    await svc.registerCpf(caio, { cpf: '168.995.350-09', fullName: 'Caio Souza', birthDate: '1985-01-01' });
    await store.update('users', caio.uid, { driverStatus: 'approved', balanceCents: reais * 100, earnedCents: reais * 100, cpfStatus: 'verified' });
  }

  test('saque dentro das regras é liberado sozinho; sem envio automático fica "Pix a enviar"', async () => {
    await earnedDriver(300);
    const { id } = await svc.requestWithdrawal(caio, 100, '168.995.350-09', 'cpf');
    const r = await svc.autoProcessWithdrawals();
    assert.equal(r.liberados, 1);
    assert.equal((await store.get<Record<string, unknown>>('withdrawals', id))?.status, 'approved');
    const log = await svc.auditLog(admin);
    assert.ok(log.some((l) => l.action === 'saque_liberado' && l.actorType === 'ia'));
  });

  test('com envio automático de Pix ligado: a Equipe IA paga sozinha', async () => {
    build(true);
    await earnedDriver(300);
    const { id } = await svc.requestWithdrawal(caio, 100, '168.995.350-09', 'cpf');
    await svc.autoProcessWithdrawals();
    assert.equal((await store.get<Record<string, unknown>>('withdrawals', id))?.status, 'paid');
    assert.deepEqual(sentPix, ['168.995.350-09:10000']);
  });

  test('acima do limite, sem CPF verificado ou com multiconta: fica para o Financeiro analisar', async () => {
    await earnedDriver(5000);
    await svc.requestWithdrawal(caio, 2000, '168.995.350-09', 'cpf');
    const r = await svc.autoProcessWithdrawals();
    assert.equal(r.liberados, 0);
    assert.match(r.paraAnalise![0], /acima de/);
  });

  test('agente não consegue dizer que pagou sem o Pix ter saído', async () => {
    await earnedDriver(300);
    const { id } = await svc.requestWithdrawal(caio, 50, '168.995.350-09', 'cpf');
    const r = await svc.resolveWithdrawal({ uid: 'ia:financeiro', email: 'ia', emailVerified: true, agent: 'Financeiro' }, id, 'paid');
    assert.equal(r.status, 'approved');
  });

  test('autonomia desligada: nada é liberado sozinho', async () => {
    await svc.updateSettings(admin, { agentAutonomy: false });
    await earnedDriver(300);
    await svc.requestWithdrawal(caio, 100, '168.995.350-09', 'cpf');
    assert.equal((await svc.autoProcessWithdrawals()).liberados, 0);
  });

  test('loja com CNPJ ativo é aprovada sozinha; CNPJ baixado é recusado com motivo', async () => {
    await svc.registerCpf(loja, { cpf: '529.982.247-25', fullName: 'Lojista Teste', birthDate: '1980-01-01' });
    await svc.applyAsMerchant(loja, { companyName: 'Pastelaria', cnpj: '11.222.333/0001-81', phone: '11977776666', pickup: { name: 'Rua A, 1', city: 'São Paulo', state: 'SP', lat: -23.56, lng: -46.65 }, declarations: { responsavel: true, proibidos: true, veracidade: true } });
    cnpjAtivo = false;
    await svc.autoReviewMerchants();
    const p = (await svc.bootstrap(loja)).profile;
    assert.equal(p.merchantStatus, 'rejected');
    assert.match(p.rejectionReason || '', /BAIXADA/);
  });
});

describe('ferramentas da Equipe IA para preço', () => {
  test('agente cadastra e lista áreas de risco', async () => {
    const { TOOL_BY_NAME } = await import('../server/ai/tools.ts');
    const ia = { uid: 'ia:precos', email: 'ia', emailVerified: true, agent: 'Preços' };
    const ctx = { service: svc, auth: ia } as never;
    await TOOL_BY_NAME.get('area_de_risco')!.run(ctx, { name: 'Zona teste', lat: -23.5, lng: -46.6, radiusKm: 1, surchargePct: 15 });
    const r = (await TOOL_BY_NAME.get('areas_de_risco')!.run(ctx, {})) as { zones: { name: string }[] };
    assert.equal(r.zones[0].name, 'Zona teste');
  });
});
