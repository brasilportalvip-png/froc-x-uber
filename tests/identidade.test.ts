/**
 * CPF obrigatório, conferência na Receita (Serpro simulado) e "uma pessoa, uma conta".
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser, PaymentsGateway } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import { createSerproVerifier, isValidCpf, maskCpf, maskEmail, namesMatch } from '../server/identity.ts';
import type { CpfLookup } from '../server/identity.ts';

// CPFs de teste válidos (dígitos verificadores corretos).
const CPF_ANA = '529.982.247-25';
const CPF_BIA = '168.995.350-09';

const ana: AuthUser = { uid: 'p1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' };
const ana2: AuthUser = { uid: 'p1b', email: 'ana.nova@exemplo.com', emailVerified: true, name: 'Ana' };
const bia: AuthUser = { uid: 'p2', email: 'bia@exemplo.com', emailVerified: true, name: 'Bia' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };

let store: MemoryStore;
let svc: FrocService;
let receita: Map<string, CpfLookup & { birth: string }>;
let receitaFora: boolean;
const payments: PaymentsGateway = {
  configured: true,
  async createCheckout() {
    return { checkoutUrl: 'x', preferenceId: 'p' };
  },
  async findApproved() {
    return null;
  },
  async getPayment() {
    return null;
  },
};
async function expectError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof AppError && e.code === code);
}

function build(withReceita: boolean) {
  svc = new FrocService(store, {
    now: () => new Date('2026-11-16T15:00:00Z'),
    payments,
    adminEmails: ['dono@froc.com'],
    geo: createGridGeo(),
    identity: {
      required: true,
      verify: withReceita
        ? async (cpf, birth) => {
            if (receitaFora) return null;
            const r = receita.get(cpf);
            return r && r.birth === birth ? r : { found: false };
          }
        : undefined,
    },
  });
}

beforeEach(async () => {
  store = new MemoryStore();
  receitaFora = false;
  receita = new Map([
    ['52998224725', { found: true, name: 'ANA PAULA DE SOUZA LIMA', regular: true, situation: 'Regular', birth: '1990-05-10' }],
    ['16899535009', { found: true, name: 'BEATRIZ COSTA', regular: false, situation: 'Suspensa', birth: '1985-01-01' }],
  ]);
  build(true);
});

describe('validação', () => {
  test('dígitos do CPF, máscaras e comparação de nomes', () => {
    assert.ok(isValidCpf(CPF_ANA));
    assert.ok(!isValidCpf('529.982.247-24'));
    assert.ok(!isValidCpf('111.111.111-11'));
    assert.equal(maskCpf('52998224725'), '***.982.247-**');
    assert.equal(maskEmail('ana@exemplo.com'), 'a***@e***.com');
    assert.ok(namesMatch('Ana Paula Lima', 'ANA PAULA DE SOUZA LIMA'));
    assert.ok(namesMatch('Ana Lima', 'Ana Paula de Souza Lima'));
    assert.ok(!namesMatch('Maria Lima', 'ANA PAULA DE SOUZA LIMA'));
    assert.ok(!namesMatch('Ana Pereira Gomes', 'ANA PAULA DE SOUZA LIMA'));
  });
});

describe('CPF obrigatório e conferido na Receita', () => {
  test('sem CPF não pede corrida', async () => {
    await expectError(svc.createRide(ana, { ...SP, categoryId: 'froc_x' }), 'cpf_required');
    assert.equal((await svc.bootstrap(ana)).profile.identityRequired, true);
  });

  test('dados certos: verificado na Receita, nome oficial e CPF mascarado', async () => {
    const p = await svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' });
    assert.equal(p.cpfStatus, 'verified');
    assert.equal(p.cpfSource, 'receita');
    assert.equal(p.cpfMasked, '***.982.247-**');
    assert.equal(p.name, 'Ana Lima');
    const raw = JSON.stringify(await store.get('users', ana.uid));
    assert.ok(!raw.includes('52998224725') && !raw.includes('529.982.247-25'), 'CPF completo não fica no cadastro público');
    // Agora pode pedir (falta só saldo).
    await expectError(svc.createRide(ana, { ...SP, categoryId: 'froc_x' }), 'insufficient_balance');
  });

  test('nome que não bate, nascimento errado, CPF irregular e menor de idade são recusados', async () => {
    await expectError(svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Maria Lima', birthDate: '1990-05-10' }), 'cpf_name_mismatch');
    await expectError(svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1991-05-10' }), 'cpf_not_found');
    await expectError(svc.registerCpf(bia, { cpf: CPF_BIA, fullName: 'Beatriz Costa', birthDate: '1985-01-01' }), 'cpf_irregular');
    await expectError(svc.registerCpf(bia, { cpf: CPF_BIA, fullName: 'Beatriz Costa', birthDate: '2010-01-01' }), 'underage');
    await expectError(svc.registerCpf(bia, { cpf: '123.456.789-00', fullName: 'Beatriz Costa', birthDate: '1985-01-01' }), 'invalid_cpf');
    await expectError(svc.registerCpf(bia, { cpf: CPF_BIA, fullName: 'Beatriz', birthDate: '1985-01-01' }), 'invalid_name');
  });

  test('Receita fora do ar: fica "básico" e a equipe confere manualmente', async () => {
    receitaFora = true;
    const p = await svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' });
    assert.equal(p.cpfStatus, 'basic');
    const id = await svc.adminIdentity(admin, ana.uid);
    assert.equal(id?.cpf, CPF_ANA);
    await expectError(svc.adminIdentity(ana, ana.uid), 'forbidden');
    await svc.adminSetCpfStatus(admin, ana.uid, 'verified', '');
    assert.equal((await svc.bootstrap(ana)).profile.cpfStatus, 'verified');
    const audit = await svc.auditLog(admin);
    assert.ok(audit.some((a) => a.action === 'cpf_visualizado'), 'quem viu o CPF fica registrado');
  });

  test('sem Serpro contratado também funciona (básico)', async () => {
    build(false);
    const p = await svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Qualquer Nome', birthDate: '1990-05-10' });
    assert.equal(p.cpfStatus, 'basic');
  });

  test('CPF falso recusado pela equipe libera o CPF para o dono verdadeiro', async () => {
    build(false);
    await svc.registerCpf(bia, { cpf: CPF_ANA, fullName: 'Bia Usando CPF Alheio', birthDate: '1990-05-10' });
    await expectError(svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' }), 'cpf_in_use');
    await svc.adminSetCpfStatus(admin, bia.uid, 'rejected', 'CPF não é dela');
    assert.equal((await svc.bootstrap(bia)).profile.cpfStatus, 'rejected');
    await expectError(svc.createRide(bia, { ...SP, categoryId: 'froc_x' }), 'cpf_required');
    assert.equal((await svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' })).cpfStatus, 'basic');
  });
});

describe('uma pessoa, uma conta', () => {
  test('o mesmo CPF não abre segunda conta (outro e-mail, outro celular)', async () => {
    await svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' });
    await assert.rejects(
      svc.registerCpf(ana2, { cpf: '52998224725', fullName: 'Ana Paula Lima', birthDate: '1990-05-10' }),
      (e: unknown) => e instanceof AppError && e.code === 'cpf_in_use' && /a\*\*\*@e\*\*\*\.com/.test(e.message),
    );
    await expectError(svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' }), 'cpf_already');
  });

  test('conta bloqueada: o CPF fica bloqueado e não volta com conta nova', async () => {
    await svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' });
    await svc.setBlocked(admin, ana.uid, true, 'Assediou motorista');
    await expectError(svc.registerCpf(ana2, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' }), 'cpf_blocked');
  });

  test('duas contas cadastrando o mesmo CPF ao mesmo tempo: só uma consegue', async () => {
    const results = await Promise.allSettled([
      svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' }),
      svc.registerCpf(ana2, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  });

  test('3 contas no mesmo aparelho geram alerta de possível multiconta', async () => {
    for (const u of [ana, ana2, bia]) await svc.ensureUser(u);
    const device = 'aparelho-de-teste-1234567890';
    await svc.recordDevice(ana, device);
    await svc.recordDevice(ana2, device);
    assert.equal((await svc.adminUsers(admin, ana.email))[0].multiAccountFlag, '');
    await svc.recordDevice(bia, device);
    assert.match((await svc.adminUsers(admin, ana.email))[0].multiAccountFlag || '', /3 contas/);
  });

  test('admin acha a conta pelo CPF; aprovar motorista confirma o CPF pela CNH', async () => {
    build(false);
    await svc.registerCpf(ana, { cpf: CPF_ANA, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' });
    const found = await svc.adminUsers(admin, CPF_ANA);
    assert.equal(found.length, 1);
    assert.equal(found[0].uid, ana.uid);
    for (const d of ['cnh', 'crlv', 'antecedentes']) await svc.uploadDocument(ana, 'driver', d, 'image/png', 'eA==').catch(() => undefined);
    await store.update('users', ana.uid, { driverStatus: 'pending', driverDocs: { cnh: 'x', crlv: 'y', antecedentes: 'z' } });
    await svc.reviewApplication(admin, ana.uid, 'driver', 'approved', '');
    const p = (await svc.bootstrap(ana)).profile;
    assert.equal(p.cpfStatus, 'verified');
    assert.equal(p.cpfSource, 'documentos');
  });
});

describe('integração Serpro', () => {
  test('pede token, consulta com CPF + nascimento e entende a resposta', async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 });
      if (url.includes('52998224725')) return new Response(JSON.stringify({ ni: '52998224725', nome: 'ANA PAULA DE SOUZA LIMA', situacao: { codigo: '0', descricao: 'Regular' } }), { status: 200 });
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const verify = createSerproVerifier({ SERPRO_CONSUMER_KEY: 'k', SERPRO_CONSUMER_SECRET: 's' }, fake)!;
    const ok = await verify('52998224725', '1990-05-10');
    assert.deepEqual({ found: ok?.found, regular: ok?.regular, name: ok?.name }, { found: true, regular: true, name: 'ANA PAULA DE SOUZA LIMA' });
    assert.ok(calls.some((c) => c.includes('dataNascimento=1990-05-10')));
    assert.equal((await verify('16899535009', '1985-01-01'))?.found, false);
    assert.equal(createSerproVerifier({}), undefined, 'sem chave, desligado');
  });
});
