/**
 * Anti-queda da IA: simula o Gemini caindo de vários jeitos e confere que a IA continua
 * respondendo pelo próximo modelo (3.8 → 3.7 → 3.6), pela próxima chave, ou avisa sem travar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODELS, LlmUnavailableError, classifyFailure, createGemini, parseRetryAfter } from '../server/ai/gemini.ts';
import { MemoryStore } from '../server/store.ts';
import { FrocService } from '../server/services.ts';
import { SupportDesk } from '../server/support.ts';
import { BlogService } from '../server/blog.ts';
import { AiTeam } from '../server/ai/team.ts';
import type { LlmClient } from '../server/ai/gemini.ts';

type Reply = { status: number; body?: unknown; text?: string; headers?: Record<string, string> } | 'network';

/** Fetch falso: para cada modelo, uma fila de respostas; registra (modelo, chave) de cada chamada. */
function fakeFetch(script: Record<string, Reply[]>, fallback: Reply = { status: 503, text: 'overloaded' }) {
  const calls: { model: string; key: string }[] = [];
  const fn = async (url: string, init: { headers: Record<string, string> }) => {
    const model = decodeURIComponent(/models\/([^:]+):/.exec(url)![1]);
    calls.push({ model, key: init.headers['x-goog-api-key'] });
    const r = script[model]?.shift() ?? fallback;
    if (r === 'network') throw new Error('fetch failed');
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => r.text ?? JSON.stringify(r.body ?? ''),
      headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
    };
  };
  return { fn, calls };
}
const ok = (text: string): Reply => ({ status: 200, body: { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] } });
const input = { system: 's', contents: [{ role: 'user' as const, parts: [{ text: 'oi' }] }] };

function client(script: Record<string, Reply[]>, extra: Partial<Parameters<typeof createGemini>[0]> = {}, fallback?: Reply) {
  let clock = 1_000_000;
  const f = fakeFetch(script, fallback);
  const waits: number[] = [];
  const llm = createGemini({
    apiKey: ['chave-1', 'chave-2'],
    fetchImpl: f.fn,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
    random: () => 0.5,
    ...extra,
  });
  return { llm, calls: f.calls, waits, advance: (ms: number) => (clock += ms) };
}

test('Ordem dos modelos é 3.8 → 3.7 → 3.6 (e depois as reservas)', () => {
  assert.deepEqual(DEFAULT_MODELS.slice(0, 3), ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']);
});

test('Falha passageira: tenta de novo no mesmo modelo com espera crescente e responde', async () => {
  const { llm, calls, waits } = client({ 'gemini-3.8-flash': [{ status: 503, text: 'overloaded' }, 'network', ok('Olá!')] });
  const out = await llm.generate(input);
  assert.equal(out.text, 'Olá!');
  assert.equal(out.model, 'gemini-3.8-flash');
  assert.equal(out.attempts, 3);
  assert.equal(calls.length, 3);
  assert.ok(waits[1] > waits[0], 'a espera cresce');
});

test('3.8 caiu de vez → responde pelo 3.7; 3.7 também → responde pelo 3.6', async () => {
  const down = Array.from({ length: 5 }, () => ({ status: 500, text: 'internal' }) as Reply);
  const a = client({ 'gemini-3.8-flash': [...down], 'gemini-3.7-flash': [ok('pelo 3.7')] });
  assert.equal((await a.llm.generate(input)).model, 'gemini-3.7-flash');

  const b = client({ 'gemini-3.8-flash': [...down], 'gemini-3.7-flash': [...down], 'gemini-3.6-flash': [ok('pelo 3.6')] });
  const out = await b.llm.generate(input);
  assert.equal(out.model, 'gemini-3.6-flash');
  assert.equal(out.text, 'pelo 3.6');
});

test('Disjuntor: modelo que falhou várias vezes fica em pausa e as próximas chamadas vão direto ao que funciona', async () => {
  const down = Array.from({ length: 10 }, () => ({ status: 503, text: 'overloaded' }) as Reply);
  const c = client({ 'gemini-3.8-flash': [...down], 'gemini-3.7-flash': [ok('1'), ok('2')] }, { breakerCooldownMs: 60_000 });
  await c.llm.generate(input);
  const before = c.calls.length;
  const second = await c.llm.generate(input);
  assert.equal(second.model, 'gemini-3.7-flash');
  assert.equal(c.calls.length - before, 1, 'não perde tempo com o 3.8 em pausa');
  const h = c.llm.health!();
  assert.equal(h.models.find((m) => m.model === 'gemini-3.8-flash')?.state, 'desligado');
  assert.equal(h.activeModel, 'gemini-3.7-flash');
  // Passado o tempo de pausa, volta a tentar o 3.8 se o 3.7 parar de responder.
  c.advance(61_000);
  assert.equal(c.llm.health!().models.find((m) => m.model === 'gemini-3.8-flash')?.state, 'instavel');
});

test('Modelo que não existe na chave (404) é pulado na hora e por 30 minutos', async () => {
  const c = client({ 'gemini-3.8-flash': [{ status: 404, text: 'model not found' }], 'gemini-3.7-flash': [ok('a'), ok('b')] });
  await c.llm.generate(input);
  await c.llm.generate(input);
  assert.equal(c.calls.filter((x) => x.model === 'gemini-3.8-flash').length, 1);
  assert.equal(c.llm.health!().models[0].state, 'indisponivel');
});

test('Cota estourada numa chave: a chave reserva assume no mesmo modelo', async () => {
  const c = client({ 'gemini-3.8-flash': [{ status: 429, text: 'RESOURCE_EXHAUSTED quota exceeded' }, ok('pela chave 2')] });
  const out = await c.llm.generate(input);
  assert.equal(out.text, 'pela chave 2');
  assert.deepEqual(c.calls.map((x) => x.key), ['chave-1', 'chave-2']);
  assert.equal(c.llm.health!().keysCooling, 1);
});

test('Resposta vazia conta como falha e tenta de novo', async () => {
  const empty: Reply = { status: 200, body: { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'OTHER' }] } };
  const c = client({ 'gemini-3.8-flash': [empty, ok('agora sim')] });
  assert.equal((await c.llm.generate(input)).text, 'agora sim');
});

test('Tudo fora do ar: avisa com erro claro dentro do tempo (não trava o servidor)', async () => {
  const c = client({}, {}, { status: 503, text: 'overloaded' });
  await assert.rejects(c.llm.generate({ ...input, deadlineMs: 20_000 }), (e: unknown) => e instanceof LlmUnavailableError);
  const sleptTotal = c.waits.reduce((a, b) => a + b, 0);
  assert.ok(sleptTotal < 20_000, `respeita o orçamento de tempo (${sleptTotal} ms)`);
});

test('Classificação de erros e Retry-After', () => {
  assert.equal(classifyFailure(503, 'overloaded'), 'transient');
  assert.equal(classifyFailure(429, 'rate limit'), 'transient');
  assert.equal(classifyFailure(429, 'quota exhausted'), 'key_problem');
  assert.equal(classifyFailure(400, 'API key not valid. API_KEY_INVALID'), 'key_problem');
  assert.equal(classifyFailure(404, ''), 'model_missing');
  assert.equal(classifyFailure(0, ''), 'transient');
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter(null, '"retryDelay": "7s"'), 7000);
});

test('Atendimento: se a IA cair de vez, a pessoa recebe resposta e a equipe é chamada', async () => {
  const store = new MemoryStore();
  const service = new FrocService(store, {});
  const down: LlmClient = {
    configured: true,
    async generate() {
      throw new LlmUnavailableError('todos os modelos caíram');
    },
  };
  const support = new SupportDesk(store);
  const team = new AiTeam({ store, service, support, blog: new BlogService(store, { siteUrl: () => '' }), llm: down });
  const r = await team.supportMessage({ uid: 'u1', email: 'a@x.com', emailVerified: true }, 'Preciso de ajuda');
  assert.equal(r.needsHuman, true);
  assert.match(r.messages.at(-1)!.text, /equipe Froc/);
});

test('Rotina diária: se a IA falhar, tenta de novo mais tarde (não perde o post do dia)', async () => {
  const store = new MemoryStore();
  const service = new FrocService(store, {});
  let fail = true;
  const llm: LlmClient = {
    configured: true,
    async generate() {
      if (fail) throw new LlmUnavailableError('fora do ar');
      return { content: { role: 'model', parts: [{ text: 'ok' }] }, text: 'Relatório ok', functionCalls: [], model: 'gemini-3.7-flash' };
    },
  };
  const support = new SupportDesk(store);
  const blog = new BlogService(store, { llm, siteUrl: () => 'https://x.test' });
  const team = new AiTeam({ store, service, support, blog, llm });
  const first = (await team.daily()) as Record<string, unknown>;
  assert.ok(first.postErro);
  const marker = (await store.query<{ id: string; lastAttemptAt: string; done: boolean }>('jobs', []))[0];
  assert.equal(marker.done, false);
  // Logo em seguida não repete (espera 15 min)...
  assert.equal(((await team.daily()) as { skipped?: boolean }).skipped, true);
  // ...depois de 15 min tenta de novo.
  await store.update('jobs', marker.id, { lastAttemptAt: new Date(Date.now() - 16 * 60_000).toISOString() });
  fail = false;
  const again = (await team.daily()) as { skipped?: boolean };
  assert.notEqual(again.skipped, true);
});
