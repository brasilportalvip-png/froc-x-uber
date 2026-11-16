/**
 * Ponto A real (sem endereço fixo), apagar post do blog e agendador (cron) por GET e POST.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { MemoryStore } from '../server/store.ts';
import { FrocService } from '../server/services.ts';
import { BlogService, rssFeed, sitemapBlog } from '../server/blog.ts';
import type { BlogPost } from '../server/blog.ts';
import { isGpsOrigin, isOriginPending, locatingPoint, metersBetween, needLocationPoint } from '../src/lib/currentLocation.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Ponto A: nunca começa nem cai num endereço fixo (MASP)', () => {
  const app = read('src/App.tsx');
  assert.ok(!app.includes('BRAZIL_LOCATIONS[0]'), 'App.tsx não pode usar um endereço fixo como partida');
  assert.ok(app.includes('locatingPoint()'));
  assert.ok(app.includes('watchCoords('), 'A acompanha a pessoa em tempo real');
  const a = locatingPoint();
  const b = needLocationPoint();
  assert.ok(isOriginPending(a) && isOriginPending(b));
  assert.ok(!/paulista|masp/i.test(a.name + b.name));
  assert.ok(isGpsOrigin({ id: 'gps-123' }) && !isGpsOrigin({ id: 'sp-paulista' }));
  // Pedido de corrida bloqueado enquanto A não é real.
  assert.ok(read('src/components/Uber99Panel.tsx').includes('isOriginPending(origin)'));
});

test('Ponto A: distância em metros para atualizar quando a pessoa anda', () => {
  const d = metersBetween({ lat: -23.55, lng: -46.63 }, { lat: -23.5503, lng: -46.63 });
  assert.ok(d > 30 && d < 36, String(d));
  assert.equal(metersBetween({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
});

function post(slug: string, published = true): BlogPost {
  const now = new Date().toISOString();
  return {
    id: `id-${slug}`, slug, title: `Post ${slug}`, description: 'd', keyword: slug, h1: slug, intro: 'i', sections: [], faq: [], cta: 'c', tags: [],
    topic: 't', published, author: 'a', createdAt: now, updatedAt: now, publishedAt: published ? now : '',
    image: { path: `froc-x-uber/blog/id-${slug}.png`, mimeType: 'image/png', alt: 'x', model: 'm' },
  } as BlogPost;
}

test('Blog: apagar tira do blog, do sitemap e do RSS, apaga a capa e avisa o Bing', async () => {
  const store = new MemoryStore();
  const removed: string[] = [];
  const pinged: string[][] = [];
  const blog = new BlogService(store, {
    siteUrl: () => 'https://froc.test',
    files: { async save() {}, async signedUrl(p) { return p; }, async remove(p) { removed.push(p); } },
    indexNow: async (u) => { pinged.push(u); },
  });
  await store.set('blog', 'id-teste-1', post('teste-1'));
  await store.set('blog', 'id-teste-2', post('teste-2'));
  const r = await blog.remove('teste-1');
  assert.equal(r?.ok, true);
  assert.equal(await blog.get('teste-1'), null);
  const left = await blog.list();
  assert.deepEqual(left.map((p) => p.slug), ['teste-2']);
  assert.ok(!sitemapBlog('https://froc.test', left).includes('teste-1'));
  assert.ok(!rssFeed('https://froc.test', left).includes('teste-1'));
  assert.deepEqual(removed, ['froc-x-uber/blog/id-teste-1.png']);
  assert.ok(pinged.flat().includes('https://froc.test/blog/teste-1'));
  // Também apaga pelo id e devolve null se não existir.
  assert.equal((await blog.remove('id-teste-2'))?.slug, 'teste-2');
  assert.equal(await blog.remove('nao-existe'), null);
});

test('Agendador: /api/cron/sweep aceita POST (cron-job.org) e GET (Vercel Cron), só com a chave', async (t) => {
  const src = read('server/app.ts');
  assert.ok(src.includes("app.post('/api/cron/sweep', cronHandler)") && src.includes("app.get('/api/cron/sweep', cronHandler)"));
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.crons?.[0]?.path, '/api/cron/sweep');
  let createApp: typeof import('../server/app.ts').createApp;
  try {
    ({ createApp } = await import('../server/app.ts'));
  } catch {
    t.skip('express não instalado neste ambiente');
    return;
  }
  const service = new FrocService(new MemoryStore(), {});
  const app = createApp({
    service,
    verifyToken: async () => {
      throw new Error('sem login');
    },
    publicConfig: () => ({}),
    cronSecret: 'chave-teste-123',
  });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cron/sweep`;
    assert.equal((await fetch(base, { method: 'POST' })).status, 401);
    assert.equal((await fetch(base, { method: 'POST', headers: { 'x-cron-key': 'errada' } })).status, 401);
    assert.equal((await fetch(base)).status, 401);
    const post = await fetch(base, { method: 'POST', headers: { 'x-cron-key': 'chave-teste-123' } });
    assert.equal(post.status, 200);
    assert.ok('sweep' in (await post.json()));
    const get = await fetch(base, { headers: { authorization: 'Bearer chave-teste-123' } });
    assert.equal(get.status, 200);
  } finally {
    server.close();
  }
});

test('SIGILO: o ganho da Froc não aparece em páginas públicas, termos, FAQ nem na IA de atendimento', async () => {
  const { FEE_LEAK, PRICING_TEXT } = await import('../src/data/pricing.ts');
  const { FAQ } = await import('../src/data/legal.ts').then((m) => ({ FAQ: JSON.stringify(m) }));
  assert.ok(!FEE_LEAK.test(PRICING_TEXT.join(' ')), 'texto de preço');
  assert.ok(!/R\$ ?2 a R\$ ?8|2 e R\$ 8/.test(FAQ), 'perguntas frequentes');
  assert.ok(!/R\$ 2 e R\$ 8|R\$ 2 a R\$ 8|30% do valor/.test(read('public/legal/termos.html')), 'termos');
  const { platformKnowledge } = await import('../server/ai/persona.ts');
  const { DEFAULT_SETTINGS } = await import('../server/settings.ts');
  const pub = platformKnowledge(DEFAULT_SETTINGS, 'publico');
  assert.ok(!pub.includes(`R$ ${DEFAULT_SETTINGS.platformFeeMin} a R$ ${DEFAULT_SETTINGS.platformFeeMax}`), 'atendimento não sabe o valor');
  assert.ok(pub.includes('CONFIDENCIAL'), 'atendimento recebe a regra de sigilo');
  assert.ok(platformKnowledge(DEFAULT_SETTINGS, 'interno').includes(`R$ ${DEFAULT_SETTINGS.platformFeeMin} a R$ ${DEFAULT_SETTINGS.platformFeeMax}`), 'equipe interna sabe');
  // O detector pega os jeitos comuns de escrever.
  for (const t of ['a Froc cobra só de R$ 2 a R$ 8 por corrida', 'taxa da Froc', 'entre R$ 2 e R$ 8', 'comissão da Froc de 12%']) assert.ok(FEE_LEAK.test(t), t);
  assert.ok(!FEE_LEAK.test('O motorista vê quanto vai receber antes de aceitar.'));
  const { seoReview } = await import('../server/blog.ts');
  const r = seoReview({ title: 'Quanto ganha um motorista de aplicativo', description: '', keyword: '', slug: 'x', intro: 'A Froc fica com R$ 3 por corrida.', sections: [], faq: [] } as never);
  assert.ok(r.hard.some((h) => h.includes('sigilosa')));
});

test('App Android: assetlinks.json liga o app da Play Store ao site (atualiza junto com o site)', async () => {
  const { assetLinks } = await import('../server/assetLinks.ts');
  assert.deepEqual(assetLinks(undefined, undefined), [], 'sem configuração: lista vazia');
  const fp = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0')).join(':');
  const out = assetLinks('com.frocx.app', `${fp.toLowerCase()}, lixo, ${fp}`);
  assert.equal(out.length, 1);
  assert.equal(out[0].target.package_name, 'com.frocx.app');
  assert.deepEqual(out[0].target.sha256_cert_fingerprints, [fp.toUpperCase()]);
  assert.deepEqual(assetLinks('nome invalido', fp), []);
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.rewrites[0].source, '/.well-known/assetlinks.json');
  assert.ok(read('src/main.tsx').includes('installAutoUpdate()'));
});
