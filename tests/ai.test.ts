/**
 * Equipe IA, atendimento, blog/SEO e limites — com um "Gemini de mentira" que segue um
 * roteiro, para testar de verdade as regras (permissões, propostas, auditoria) sem internet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser } from '../server/services.ts';
import { SupportDesk } from '../server/support.ts';
import { BlogService, renderPost, rssFeed, seoProblems, sitemapBlog, sitemapIndex, sitemapPages, slugify, topicForDay, createIndexNow, INDEXNOW_KEY, renderServicePage, SERVICE_PAGES } from '../server/blog.ts';
import { AiTeam, trimHistory } from '../server/ai/team.ts';
import { AGENTS } from '../server/ai/agents.ts';
import { TOOLS } from '../server/ai/tools.ts';
import { createGemini, parseJsonLoose } from '../server/ai/gemini.ts';
import type { GenerateInput, GenerateOutput, LlmClient } from '../server/ai/gemini.ts';
import { consumeQuota } from '../server/rateLimit.ts';

const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const user: AuthUser = { uid: 'u1', email: 'ana@x.com', emailVerified: true, name: 'Ana' };
const driver: AuthUser = { uid: 'd1', email: 'caio@x.com', emailVerified: true, name: 'Caio' };

type Step = { text?: string; calls?: { name: string; args: Record<string, unknown> }[] };

/** LLM falso: devolve os passos em ordem e guarda o que recebeu. */
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

const POST_JSON = {
  keyword: 'frete barato em recife',
  title: 'Frete barato em Recife: guia para economizar na mudança',
  description: 'Frete barato em Recife sem dor de cabeça: compare lances, use o retorno vazio e pague só na entrega. Veja o passo a passo no Froc X Uber.',
  h1: 'Frete barato em Recife: como economizar de verdade',
  intro:
    'Frete barato em Recife é possível quando você planeja: medir o volume, escolher o veículo certo e comparar propostas faz diferença no preço final. Neste guia você vê como fazer isso com calma, evitando surpresas no dia da mudança e escolhendo entre van, utilitário ou caminhão.',
  sections: Array.from({ length: 4 }, (_, i) => ({
    heading: `Parte ${i + 1} do frete barato em Recife`,
    paragraphs: Array.from({ length: 3 }, () =>
      'Planejar a mudança com antecedência ajuda a conseguir um valor melhor. Separe os itens, conte caixas e móveis grandes e use a calculadora de cubagem para saber o volume. Com isso, os transportadores conseguem dar lances mais precisos e você evita pagar por um veículo maior do que precisa.',
    ),
  })),
  faq: [
    { q: 'Quanto custa um frete em Recife?', a: 'Depende da distância, do volume e do veículo. Compare lances no app para ver valores reais da sua mudança.' },
    { q: 'Van ou caminhão?', a: 'Para poucos móveis, uma van costuma bastar. Use a calculadora de cubagem para decidir com segurança.' },
    { q: 'O pagamento é seguro?', a: 'O valor fica guardado e só é liberado ao transportador quando a entrega é confirmada.' },
  ],
  cta: 'Crie sua conta grátis e publique seu frete.',
  tags: ['mudança recife', 'carreto recife'],
};

function setup(steps: Step[] = []) {
  const store = new MemoryStore();
  const service = new FrocService(store, { adminEmails: [admin.email], files: { async save() {}, async signedUrl(p) { return p; } } });
  const llm = scriptedLlm(steps);
  const support = new SupportDesk(store);
  const pinged: string[][] = [];
  const blog = new BlogService(store, { llm, siteUrl: () => 'https://froc.test', indexNow: async (u) => pinged.push(u) });
  const team = new AiTeam({ store, service, support, blog, llm, configStatus: () => ({ ok: true }) });
  return { store, service, llm, support, blog, team, pinged };
}

test('A equipe tem a Froc central + 19 especialistas, todos com ferramentas que existem', () => {
  assert.equal(AGENTS.length, 20);
  assert.equal(AGENTS[0].id, 'froc');
  const names = new Set(TOOLS.map((t) => t.name));
  for (const a of AGENTS) for (const t of a.tools) assert.ok(names.has(t), `${a.id} usa ferramenta inexistente ${t}`);
  // Dinheiro, banimento, aprovação e configurações são sempre "confirmar".
  for (const n of ['aprovar_ou_recusar_cadastro', 'pagar_ou_recusar_saque', 'bloquear_ou_desbloquear_usuario', 'alterar_configuracoes'])
    assert.equal(TOOLS.find((t) => t.name === n)?.level, 'confirmar');
});

test('Agente consulta, prepara banimento e só o administrador executa (com auditoria)', async () => {
  const { team, store, service } = setup([
    { calls: [{ name: 'buscar_usuarios', args: { termo: 'caio@x.com' } }] },
    { calls: [{ name: 'bloquear_ou_desbloquear_usuario', args: { uid: 'd1', bloquear: true, motivo: 'Fraude confirmada em 3 corridas' } }] },
    { text: 'Preparei o bloqueio do Caio. Está em "Aguardando sua aprovação".' },
  ]);
  await service.ensureUser(driver);
  const r = await team.chat(admin, 'antifraude', 'O Caio está fraudando?');
  assert.match(r.reply, /Aguardando sua aprovação/);
  assert.deepEqual(r.actions.map((a) => a.level), ['ler', 'confirmar']);
  // Ainda NÃO bloqueou.
  assert.equal((await store.get<{ blocked?: boolean }>('users', 'd1'))?.blocked ?? false, false);
  const [p] = await team.proposals(admin);
  assert.equal(p.status, 'pending');
  // Um agente não aprova a própria proposta.
  await assert.rejects(team.decide({ uid: 'ia:x', email: 'ia', emailVerified: true, agent: 'X' }, p.id, 'approve'), /humano/);
  // Usuário comum também não.
  await assert.rejects(team.decide(user, p.id, 'approve'), (e: unknown) => e instanceof AppError && e.status === 403);
  await team.decide(admin, p.id, 'approve');
  assert.equal((await store.get<{ blocked?: boolean }>('users', 'd1'))?.blocked, true);
  await assert.rejects(team.decide(admin, p.id, 'approve'), /já foi decidida/);
  const log = await service.auditLog(admin);
  assert.ok(log.some((l) => l.action === 'usuario_bloqueado' && l.actor === admin.email));
  assert.ok(log.some((l) => l.action === 'ia_proposta' && l.actorType === 'ia'));
});

test('Agente não usa ferramenta fora da sua função; não-admin não conversa com a equipe', async () => {
  const { team } = setup([{ calls: [{ name: 'pagar_ou_recusar_saque', args: { id: 'w1', decisao: 'paid' } }] }, { text: 'Não posso.' }]);
  const r = await team.chat(admin, 'redes-sociais', 'Pague o saque w1');
  assert.equal(r.actions[0].level, 'negada');
  assert.equal((await team.proposals(admin)).length, 0);
  await assert.rejects(team.chat(user, 'froc', 'oi'), (e: unknown) => e instanceof AppError && e.status === 403);
});

test('O histórico mantém chamada e resposta de ferramenta juntas', async () => {
  const { team } = setup([{ calls: [{ name: 'painel_geral', args: {} }] }, { text: 'Tudo certo.' }, { text: 'Segunda resposta.' }]);
  const first = await team.chat(admin, 'froc', 'Como está?');
  const second = await team.chat(admin, 'froc', 'E agora?', first.conversationId);
  assert.equal(second.reply, 'Segunda resposta.');
  const trimmed = trimHistory(
    [
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'model', parts: [{ functionCall: { name: 'x' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] },
      { role: 'model', parts: [{ text: 'b' }] },
      { role: 'user', parts: [{ text: 'c' }] },
    ],
    3,
  );
  assert.equal(trimmed[0].parts[0].text, 'c');
});

test('Atendimento: Froc responde com dados só da própria pessoa e chama a equipe quando precisa', async () => {
  const { team, service, support, llm } = setup([
    { calls: [{ name: 'chamar_equipe', args: { motivo: 'Cobrança em dobro' } }] },
    { text: 'Já chamei a equipe, Ana. A resposta chega aqui mesmo.' },
  ]);
  await service.ensureUser(driver);
  const r = await team.supportMessage(user, 'Fui cobrada duas vezes');
  assert.equal(r.needsHuman, true);
  assert.equal(r.messages.at(-1)?.from, 'froc');
  const sys = llm.seen[0].system;
  assert.ok(sys.includes('ana@x.com'));
  assert.ok(!sys.includes('caio@x.com'), 'não pode vazar dados de outra pessoa');
  const open = await support.listOpen();
  assert.equal(open[0].needsHuman, true);
  await support.append({ uid: 'u1' }, 'equipe', 'Estornamos, Ana.', admin.email);
  assert.equal((await support.get('u1'))?.needsHuman, false);
});

test('Atendimento sem IA ligada vai direto para a equipe', async () => {
  const store = new MemoryStore();
  const service = new FrocService(store, {});
  const off: LlmClient = { configured: false, async generate() { throw new Error('off'); } };
  const support = new SupportDesk(store);
  const team = new AiTeam({ store, service, support, blog: new BlogService(store, { siteUrl: () => '' }), llm: off });
  const r = await team.supportMessage(user, 'Oi');
  assert.equal(r.needsHuman, true);
});

test('Blog: post com SEO aprovado é publicado e avisado ao Bing; páginas e sitemaps corretos', async () => {
  const { blog, pinged } = setup([{ text: JSON.stringify(POST_JSON) }]);
  const { post, problems } = await blog.generate({ topic: 'frete barato em Recife', now: new Date('2026-11-16T12:00:00Z') });
  assert.deepEqual(problems, []);
  assert.equal(post.published, true);
  assert.equal(post.slug, 'frete-barato-em-recife');
  assert.ok(pinged[0][0].endsWith('/blog/frete-barato-em-recife'));
  const html = renderPost(post, 'https://froc.test');
  assert.match(html, /<link rel="canonical" href="https:\/\/froc.test\/blog\/frete-barato-em-recife">/);
  assert.match(html, /"@type":"BlogPosting"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  const list = await blog.list();
  const sm = sitemapBlog('https://froc.test', list);
  assert.match(sm, /<loc>https:\/\/froc.test\/blog\/frete-barato-em-recife<\/loc><lastmod>2026-11-16<\/lastmod>/);
  assert.match(sitemapIndex('https://froc.test'), /sitemap-paginas.xml/);
  for (const p of SERVICE_PAGES) assert.match(sitemapPages('https://froc.test'), new RegExp(`/${p.slug}<`));
  assert.match(rssFeed('https://froc.test', list), /<item><title>Frete barato em Recife/);
  // Segundo post com o mesmo assunto ganha endereço diferente.
  const again = setup([{ text: JSON.stringify(POST_JSON) }]);
  await again.store.set('blog', 'x', { ...post, id: 'x' });
  const second = await again.blog.generate({ topic: 'frete barato em Recife' });
  assert.equal(second.post.slug, 'frete-barato-em-recife-2');
});

test('Blog: post fora do padrão vira rascunho (não publica lixo)', async () => {
  const bad = { ...POST_JSON, title: 'Curto', sections: [] };
  const { blog, pinged } = setup([{ text: JSON.stringify(bad) }, { text: JSON.stringify(bad) }]);
  const { post, problems } = await blog.generate({ topic: 'x' });
  assert.equal(post.published, false);
  assert.ok(problems.length > 0);
  assert.equal(pinged.length, 0);
});

test('SEO: regras de título/descrição, slug e pauta diária', () => {
  assert.equal(slugify('Mudança em São Paulo: guia!'), 'mudanca-em-sao-paulo-guia');
  assert.ok(seoProblems({ ...POST_JSON, slug: 'a', sections: POST_JSON.sections, faq: POST_JSON.faq }).length === 0);
  const t1 = topicForDay(20000);
  const t2 = topicForDay(20001);
  assert.notEqual(t1.text, t2.text);
  for (const p of SERVICE_PAGES) {
    assert.ok(p.title.length <= 65, p.slug);
    assert.ok(p.description.length >= 110 && p.description.length <= 160, `${p.slug}: ${p.description.length}`);
    assert.match(renderServicePage(p, 'https://froc.test'), /"@type":"Service"/);
  }
});

test('Rotina diária roda uma vez por dia e gera post + relatório', async () => {
  const { team, store } = setup([{ text: JSON.stringify(POST_JSON) }, { text: 'Relatório: tudo calmo. Prioridades: 1, 2, 3.' }]);
  const r1 = await team.daily();
  assert.equal((r1 as { relatorio?: boolean }).relatorio, true);
  assert.equal((await store.query('blog', [])).length, 1);
  const r2 = await team.daily();
  assert.equal((r2 as { skipped?: boolean }).skipped, true);
});

test('IndexNow envia a chave e as URLs para o Bing', async () => {
  let body = '';
  const fake = (async (_url: string, init: { body: string }) => {
    body = init.body;
    return { status: 200 } as Response;
  }) as unknown as typeof fetch;
  await createIndexNow(() => 'https://froc.test', fake)(['https://froc.test/blog/a']);
  const parsed = JSON.parse(body);
  assert.equal(parsed.host, 'froc.test');
  assert.equal(parsed.key, INDEXNOW_KEY);
  assert.equal(parsed.keyLocation, `https://froc.test/${INDEXNOW_KEY}.txt`);
});

test('Cliente Gemini: tenta o próximo modelo se um não existir e devolve chamadas de ferramenta', async () => {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    if (urls.length === 1) return { ok: false, status: 404, json: async () => ({}), text: async () => 'model not found' };
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'Oi' }, { functionCall: { name: 'painel_geral', args: {} }, thoughtSignature: 'abc' }] } }] }),
    };
  };
  const g = createGemini({ apiKey: 'k', model: 'modelo-inexistente', fetchImpl });
  const out = await g.generate({ system: 's', contents: [{ role: 'user', parts: [{ text: 'oi' }] }] });
  assert.match(urls[0], /modelo-inexistente/);
  assert.equal(out.text, 'Oi');
  assert.equal(out.functionCalls[0].name, 'painel_geral');
  assert.equal(out.content.parts[1].thoughtSignature, 'abc');
  assert.deepEqual(parseJsonLoose<{ a: number }>('```json\n{"a":1}\n```'), { a: 1 });
});

test('Limite persistente bloqueia depois do máximo', async () => {
  const store = new MemoryStore();
  await consumeQuota(store, 'x:u1', 2, 60_000);
  await consumeQuota(store, 'x:u1', 2, 60_000);
  await assert.rejects(consumeQuota(store, 'x:u1', 2, 60_000), (e: unknown) => e instanceof AppError && e.status === 429);
  await consumeQuota(store, 'x:u2', 2, 60_000);
});
