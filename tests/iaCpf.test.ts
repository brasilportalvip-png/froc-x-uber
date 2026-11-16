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
    return { content: { role: 'model', parts: [] }, text: JSON.stringify(reads), functionCalls: [], model: 'fake' };
  },
};
let reviewer: IdentityReviewer;

beforeEach(async () => {
  store = new MemoryStore();
  files = new Map();
  seen = [];
  reads = { legivel: true, tipo: 'CNH', nome: 'ANA PAULA DE SOUZA LIMA', cpf: '52998224725', nascimento: '1990-05-10', validade: '2031-02-01', ear: true, pareceAdulterado: false };
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

  test('CPF de outra pessoa: não verifica e prepara "CPF não confere" para 1 clique', async () => {
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

  test('rotina: lê a CNH dos motoristas pendentes, mostra EAR e validade para a equipe', async () => {
    await svc.registerCpf(caio, { cpf: '168.995.350-09', fullName: 'Caio Souza', birthDate: '1985-01-01' });
    files.set('cnh-caio', new Uint8Array([1, 2, 3]));
    await store.update('users', caio.uid, { driverStatus: 'pending', driverDocs: { cnh: 'cnh-caio', crlv: 'x', antecedentes: 'y' } });
    reads = { legivel: true, tipo: 'CNH', nome: 'CAIO SOUZA', cpf: '16899535009', nascimento: '1985-01-01', validade: '2030-03-03', ear: false, pareceAdulterado: false };
    const out = await reviewer.reviewPending(2);
    assert.equal(out.conferidos, 1);
    const app = (await svc.adminOverview(admin)).applications.find((a) => a.uid === caio.uid)!;
    assert.equal(app.aiDocCheck?.ok, true);
    assert.equal(app.aiDocCheck?.ear, false, 'equipe vê que a CNH não tem EAR');
    assert.equal(app.aiDocCheck?.validade, '2030-03-03');
    assert.equal((await reviewer.reviewPending(2)).conferidos, 0, 'não lê de novo');
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
