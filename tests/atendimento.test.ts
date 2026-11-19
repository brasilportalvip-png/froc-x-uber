/**
 * Atendimento Froc (IA): enxerga a conta e a TELA da própria pessoa, registra reclamação de
 * verdade (com protocolo) e nunca diz "registrei" sem ter registrado.
 * Rodar: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { FrocService } from '../server/services.ts';
import type { AuthUser } from '../server/services.ts';
import { SupportDesk } from '../server/support.ts';
import { BlogService } from '../server/blog.ts';
import { AiTeam } from '../server/ai/team.ts';
import type { GenerateInput, GenerateOutput, LlmClient } from '../server/ai/gemini.ts';
import { readFileSync } from 'node:fs';

const ana: AuthUser = { uid: 'u1', email: 'ana@x.com', emailVerified: true, name: 'Ana' };
const bia: AuthUser = { uid: 'u2', email: 'bia@x.com', emailVerified: true, name: 'Bia' };
type Step = { text?: string; calls?: { name: string; args: Record<string, unknown> }[] };

function scriptedLlm(steps: Step[]): LlmClient & { seen: GenerateInput[] } {
  const seen: GenerateInput[] = [];
  return {
    configured: true,
    seen,
    async generate(input): Promise<GenerateOutput> {
      seen.push(JSON.parse(JSON.stringify(input)));
      const s = steps.shift() ?? { text: 'ok' };
      const parts = [...(s.text ? [{ text: s.text }] : []), ...(s.calls || []).map((c) => ({ functionCall: { name: c.name, args: c.args } }))];
      return { content: { role: 'model', parts }, text: s.text || '', functionCalls: (s.calls || []).map((c) => ({ name: c.name, args: c.args })), model: 'fake' };
    },
  };
}

function setup(steps: Step[]) {
  const store = new MemoryStore();
  const service = new FrocService(store, {});
  const llm = scriptedLlm(steps);
  const support = new SupportDesk(store);
  const team = new AiTeam({ store, service, support, blog: new BlogService(store, { siteUrl: () => '' }), llm, configStatus: () => ({ ok: true }) });
  return { store, service, llm, support, team };
}

/** Resultado que a IA recebeu de cada ferramenta (o que ela "viu"). */
const toolResults = (llm: { seen: GenerateInput[] }) =>
  llm.seen.flatMap((i) => i.contents.flatMap((c) => c.parts)).filter((p) => 'functionResponse' in p).map((p) => (p as { functionResponse: { name: string; response: Record<string, unknown> } }).functionResponse);

test('registrar reclamação grava de verdade, gera protocolo e a equipe vê no Admin', async () => {
  const { team, support, llm } = setup([
    { calls: [{ name: 'registrar_reclamacao', args: { categoria: 'erro_no_app', resumo: 'Carona vencida aparecendo na lista', detalhes: 'Viu carona de ontem' } }] },
    { text: 'Pronto, Ana! Registrei sua reclamação.' },
  ]);
  const r = await team.supportMessage(ana, 'Tem carona vencida aparecendo no app');
  const res = toolResults(llm).find((t) => t.name === 'registrar_reclamacao')!.response;
  assert.equal(res.ok, true);
  const protocolo = String(res.protocolo);
  assert.match(protocolo, /^FROC-\d{8}-[A-Z0-9]{5}$/);
  assert.ok(r.messages.at(-1)!.text.includes(protocolo), 'o protocolo chega à pessoa mesmo se a IA esquecer');
  const chat = (await support.get('u1'))!;
  assert.equal(chat.tickets?.[0].resumo, 'Carona vencida aparecendo na lista');
  assert.equal(chat.needsHuman, true);
  const open = await support.listOpen();
  assert.ok(open[0].reason.includes(protocolo));
  assert.deepEqual(open[0].protocolos, [protocolo]);
});

test('a IA confere a TELA da pessoa: vê as caronas da lista, com horário e se venceu', async () => {
  const { team, service, llm, store } = setup([{ calls: [{ name: 'ver_tela', args: { tipo: 'caronas' } }] }, { text: 'Conferi a lista.' }]);
  await service.ensureUser(ana);
  await service.ensureUser(bia);
  await store.set('carpools', 'c1', {
    id: 'c1', driverId: 'mx', status: 'open', origin: { name: 'SP', city: 'São Paulo', lat: -23.5, lng: -46.6 }, destination: { name: 'Campinas', city: 'Campinas', lat: -22.9, lng: -47.06 },
    departureAt: new Date(Date.now() + 864e5).toISOString(), pricePerSeat: 40, availableSeats: 3, totalSeats: 3, createdAt: new Date().toISOString(),
  });
  await team.supportMessage(ana, 'A lista de caronas está certa?');
  const res = toolResults(llm).find((t) => t.name === 'ver_tela')!.response as { itens: { id: string; venceu: boolean; horario: string }[] };
  assert.ok(res.itens.some((i) => i.id === 'c1' && i.venceu === false && /\d{2}\/\d{2}\/\d{4}/.test(i.horario)));
});

test('a IA vê a conta da própria pessoa (carteira) e nunca a de outra', async () => {
  const { team, service, llm, store } = setup([{ calls: [{ name: 'ver_minha_conta', args: { secao: 'carteira' } }] }, { text: 'Seu saldo está certo.' }]);
  await service.ensureUser(ana);
  await service.ensureUser(bia);
  await store.update('users', 'u1', { balanceCents: 12345 });
  await store.update('users', 'u2', { balanceCents: 99999 });
  await team.supportMessage(ana, 'Qual meu saldo?');
  const res = toolResults(llm).find((t) => t.name === 'ver_minha_conta')!.response as { dados: { saldo: number } };
  assert.equal(res.dados.saldo, 123.45);
  assert.ok(!JSON.stringify(llm.seen).includes('bia@x.com'), 'nada de outra pessoa');
});

test('a IA recebe a data e hora de Brasília e a regra de não dizer "registrei" sem protocolo', async () => {
  const { team, llm } = setup([{ text: 'Oi!' }]);
  await team.supportMessage(ana, 'oi');
  const sys = llm.seen[0].system;
  assert.ok(sys.includes('horário de Brasília'));
  assert.ok(sys.includes('NUNCA diga que registrou, salvou'));
  const names = (llm.seen[0].tools || []).map((t: { name: string }) => t.name).sort();
  assert.deepEqual(names, ['chamar_equipe', 'registrar_reclamacao', 'ver_minha_conta', 'ver_tela']);
});

test('chat de atendimento tem X para fechar (e Esc no computador)', () => {
  const src = readFileSync(new URL('../src/components/SupportChat.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('aria-label="Fechar conversa"') && src.includes('onClick={() => setOpen(false)}'));
  assert.ok(src.includes("e.key === 'Escape'"));
});
