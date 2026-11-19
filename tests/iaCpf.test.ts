/**
 * Equipe IA conferindo CPF: a IA lê o documento, o código compara (CPF, nome, nascimento).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { FrocService } from '../server/services.ts';
import type { AuthUser, FileStorage } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import { IdentityReviewer } from '../server/ai/identityCheck.ts';
import type { GenerateInput, LlmClient } from '../server/ai/gemini.ts';
import { TOOLS } from '../server/ai/tools.ts';
import { AGENTS } from '../server/ai/agents.ts';

const CPF = '529.982.247-25';
const ana: AuthUser = { uid: 'p1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' };
const caio: AuthUser = { uid: 'd1', email: 'caio@exemplo.com', emailVerified: true, name: 'Caio' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };

let store: MemoryStore;
let svc: FrocService;
let files: Map<string, Uint8Array>;
let reads: Record<string, unknown>;
let crlv: Record<string, unknown>;
let antecedentes: Record<string, unknown>;
let seen: GenerateInput[];
const fileStore: FileStorage = {
  async save(path, _type, bytes) {
    files.set(path, bytes);
  },
  async signedUrl(p) {
    return 'https://x/' + p;
  },
  async read(path) {
    const b = files.get(path);
    return b ? { bytes: b, contentType: 'image/jpeg' } : null;
  },
};
const llm: LlmClient = {
  configured: true,
  async generate(input) {
    seen.push(input);
    const body = input.system.includes('CRLV') ? crlv : input.system.includes('antecedentes') ? antecedentes : reads;
    return { content: { role: 'model', parts: [] }, text: JSON.stringify(body), functionCalls: [], model: 'fake' };
  },
};
let reviewer: IdentityReviewer;

beforeEach(async () => {
  store = new MemoryStore();
  files = new Map();
  seen = [];
  reads = { legivel: true, tipo: 'CNH', nome: 'ANA PAULA DE SOUZA LIMA', cpf: '52998224725', nascimento: '1990-05-10', validade: '2031-02-01', ear: true, pareceAdulterado: false };
  crlv = { legivel: true, placa: 'ABC-1D23', anoFabricacao: 2022, exercicio: 2026 };
  antecedentes = { legivel: true, nome: 'CAIO SOUZA', cpf: '16899535009', nadaConsta: true, emissao: '2026-11-01' };
  svc = new FrocService(store, { now: () => new Date('2026-11-16T15:00:00Z'), adminEmails: ['dono@froc.com'], geo: createGridGeo(), files: fileStore, identity: { required: true } });
  reviewer = new IdentityReviewer({ store, service: svc, llm, files: fileStore });
  for (const u of [ana, caio, admin]) await svc.ensureUser(u);
  await svc.registerCpf(ana, { cpf: CPF, fullName: 'Ana Paula Lima', birthDate: '1990-05-10' });
});

async function sendDoc() {
  const { path } = await svc.uploadIdentityDocument(ana, 'image/jpeg', Buffer.from('foto').toString('base64'));
  return reviewer.review(ana.uid, path, 'documento');
}

describe('IA confere o CPF pelo documento', () => {
  test('documento bate: CPF verificado na hora, sem o dono', async () => {
    assert.equal((await svc.bootstrap(ana)).profile.cpfStatus, 'basic');
    const r = await sendDoc();
    assert.equal(r.status, 'verificado');
    const p = (await svc.bootstrap(ana)).profile;
    assert.equal(p.cpfStatus, 'verified');
    assert.equal(p.cpfSource, 'ia_documento');
    assert.ok(seen[0].contents[0].parts.some((part) => part.inlineData?.mimeType === 'image/jpeg'), 'a imagem vai para a IA');
    assert.ok((await svc.auditLog(admin)).some((a) => a.action === 'cpf_conferido_ia'));
  });

  test('CPF de outra pessoa (autonomia ligada): a IA recusa sozinha e libera o CPF', async () => {
    reads = { ...reads, cpf: '16899535009', nome: 'BEATRIZ COSTA' };
    const r = await sendDoc();
    assert.equal(r.status, 'nao_confere');
    assert.equal((await svc.bootstrap(ana)).profile.cpfStatus, 'rejected');
    assert.ok((await svc.auditLog(admin)).some((a) => a.action === 'cpf_recusado' && a.actorType === 'ia'));
  });

  test('CPF de outra pessoa (autonomia desligada): prepara "CPF não confere" para 1 clique', async () => {
    await svc.updateSettings(admin, { agentAutonomy: false });
    reads = { ...reads, cpf: '16899535009', nome: 'BEATRIZ COSTA' };
    const r = await sendDoc();
    assert.equal(r.status, 'nao_confere');
    assert.ok(r.reasons.some((m) => /CPF/.test(m)));
    assert.equal((await svc.bootstrap(ana)).profile.cpfStatus, 'basic', 'a IA não pune sozinha');
    const proposals = [...(store.data.get('ai_proposals')?.values() || [])];
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].tool, 'marcar_cpf');
    assert.equal((proposals[0].args as Record<string, unknown>).decisao, 'rejected');
  });

  test('nascimento diferente ou documento adulterado também não passam', async () => {
    reads = { ...reads, nascimento: '1991-05-10' };
    assert.equal((await sendDoc()).status, 'nao_confere');
    reads = { ...reads, nascimento: '1990-05-10', pareceAdulterado: true };
    assert.equal((await sendDoc()).status, 'nao_confere');
  });

  test('foto ruim: pede outra, sem punir', async () => {
    reads = { legivel: false, nome: '', cpf: '' };
    const r = await sendDoc();
    assert.equal(r.status, 'ilegivel');
    assert.equal(store.data.get('ai_proposals'), undefined);
    assert.equal((await svc.bootstrap(ana)).profile.identityDocCheck?.status, 'ilegivel');
  });

  async function caioPending(extra: Record<string, unknown> = {}) {
    await svc.registerCpf(caio, { cpf: '168.995.350-09', fullName: 'Caio Souza', birthDate: '1985-01-01' });
    for (const f of ['cnh-caio', 'crlv-caio', 'ant-caio']) files.set(f, new Uint8Array([1, 2, 3]));
    await store.update('users', caio.uid, {
      driverStatus: 'pending',
      driverSubmittedAt: '2026-11-16T14:00:00.000Z',
      driverPlate: 'ABC1D23',
      driverVehicleYear: 2022,
      driverCity: 'Campinas',
      driverState: 'SP',
      driverDocs: { cnh: 'cnh-caio', crlv: 'crlv-caio', antecedentes: 'ant-caio' },
      ...extra,
    });
    reads = { legivel: true, tipo: 'CNH', nome: 'CAIO SOUZA', cpf: '16899535009', nascimento: '1985-01-01', validade: '2030-03-03', ear: true, pareceAdulterado: false };
  }

  test('cadastro tudo certo: a IA lê CNH, CRLV e antecedentes e APROVA sozinha', async () => {
    await caioPending();
    const out = await reviewer.reviewPending(2);
    assert.equal(out.conferidos, 1);
    const p = (await svc.bootstrap(caio)).profile;
    assert.equal(p.driverStatus, 'approved');
    assert.equal(p.cpfStatus, 'verified');
    assert.ok((await svc.auditLog(admin)).some((a) => a.action === 'cadastro_aprovado' && a.actorType === 'ia'));
    assert.equal((await reviewer.reviewPending(2)).conferidos, 0, 'não lê de novo');
  });

  for (const [caso, mutate, motivo] of [
    ['CNH sem EAR', () => (reads = { ...reads, ear: false }), /EAR/],
    ['placa diferente', () => (crlv = { ...crlv, placa: 'XYZ9Z99' }), /placa/],
    ['carro antigo demais', () => (crlv = { ...crlv, anoFabricacao: 2009 }), /ano de fabricação|antigo/],
    ['licenciamento atrasado', () => (crlv = { ...crlv, exercicio: 2023 }), /licenciamento/],
    ['certidão positiva', () => (antecedentes = { ...antecedentes, nadaConsta: false }), /não é negativa/],
    ['certidão velha', () => (antecedentes = { ...antecedentes, emissao: '2026-01-01' }), /90 dias/],
    ['certidão de outra pessoa', () => (antecedentes = { ...antecedentes, nome: 'JOSE PEREIRA', cpf: '52998224725' }), /outra pessoa/],
  ] as [string, () => void, RegExp][]) {
    test(`cadastro com problema (${caso}): a IA recusa sozinha explicando o motivo`, async () => {
      await caioPending();
      mutate();
      const r = await reviewer.reviewProvider(caio.uid, 'driver');
      assert.equal(r.decision, 'recusar');
      const p = (await svc.bootstrap(caio)).profile;
      assert.equal(p.driverStatus, 'rejected');
      assert.match(p.rejectionReason || '', motivo);
    });
  }

  test('rosto do reconhecimento facial diferente da CNH: a IA nunca aprova sozinha', async () => {
    await caioPending();
    await store.update('users', caio.uid, { faceRefPath: 'rosto.jpg', faceCnhMatch: 'nao_confere' });
    const r = await reviewer.reviewProvider(caio.uid, 'driver');
    assert.equal(r.decision, 'recusar');
    assert.match((await svc.bootstrap(caio)).profile.rejectionReason || '', /rosto/);
  });

  test('rosto × CNH em dúvida: a equipe confere antes (não aprova sozinho)', async () => {
    await caioPending();
    await store.update('users', caio.uid, { faceRefPath: 'rosto.jpg', faceCnhMatch: 'duvida' });
    const r = await reviewer.reviewProvider(caio.uid, 'driver');
    assert.equal(r.decision, 'aguardar');
    assert.equal((await svc.bootstrap(caio)).profile.driverStatus, 'pending');
  });

  test('autonomia desligada: a decisão fica preparada para o dono', async () => {
    await svc.updateSettings(admin, { agentAutonomy: false });
    await caioPending();
    await reviewer.reviewProvider(caio.uid, 'driver');
    assert.equal((await svc.bootstrap(caio)).profile.driverStatus, 'pending');
    const props = [...(store.data.get('ai_proposals')?.values() || [])];
    assert.equal(props[0].tool, 'aprovar_ou_recusar_cadastro');
  });

  test('IA desligada: avisa e não muda nada', async () => {
    const off = new IdentityReviewer({ store, service: svc, llm: { configured: false, async generate() { throw new Error('off'); } }, files: fileStore });
    const { path } = await svc.uploadIdentityDocument(ana, 'image/jpeg', 'eA==');
    assert.equal((await off.review(ana.uid, path, 'documento')).status, 'ia_indisponivel');
  });

  test('agentes têm as ferramentas: conferir sozinho, "não confere" só com o dono', () => {
    const byName = new Map(TOOLS.map((t) => [t.name, t]));
    assert.equal(byName.get('conferir_cpf_por_documento')?.level, 'agir');
    assert.equal(byName.get('marcar_cpf')?.level, 'confirmar');
    assert.equal(byName.get('cpfs_para_conferir')?.level, 'ler');
    const cadastros = AGENTS.find((a) => a.id === 'cadastros')!;
    assert.ok(cadastros.tools.includes('conferir_cpf_por_documento'));
  });
});
