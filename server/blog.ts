/**
 * Blog do Froc X Uber com SEO: um post novo por dia (escrito pela IA), páginas em HTML
 * prontas para o Google e o Bing (título, descrição, canonical, Open Graph, JSON-LD de
 * artigo, perguntas frequentes e trilha), sitemaps e aviso automático ao Bing (IndexNow).
 *
 * Importante: nenhum sistema garante 1º lugar no Google ou no Bing. O que dá para fazer — e
 * está feito aqui — é publicar conteúdo útil e original todo dia, tecnicamente perfeito e
 * avisado na hora aos buscadores. Posição vem com tempo, links e qualidade.
 */
import { randomUUID } from 'node:crypto';
import type { Doc, Store } from './store.ts';
import type { LlmClient } from './ai/gemini.ts';
import { parseJsonLoose } from './ai/gemini.ts';
import { FROC_VOICE } from './ai/persona.ts';
import type { ImageClient } from './ai/images.ts';
import { coverPrompt } from './ai/images.ts';
import type { FileStorage } from './services.ts';

export interface BlogSection {
  heading: string;
  paragraphs: string[];
}

export interface BlogPost extends Doc {
  id: string;
  slug: string;
  title: string;
  description: string;
  keyword: string;
  h1: string;
  intro: string;
  sections: BlogSection[];
  faq: { q: string; a: string }[];
  cta: string;
  tags: string[];
  topic: string;
  published: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  /** Capa gerada pela IA (guardada no Firebase Storage). Sem ela, usa a capa da marca. */
  image?: { path: string; mimeType: string; alt: string; model: string };
  imageAttempts?: number;
}

export const SITE_NAME = 'Froc X Uber';
/** Páginas de regras e ajuda (renderizadas em server/guidePages.ts). */
export const GUIDE_SLUGS = ['como-funciona', 'regras-e-requisitos', 'perguntas-frequentes', 'desenvolvedores'];

/** Pauta: cada dia um assunto diferente, girando entre serviço, cidade e tema. */
export const TOPIC_SERVICES = [
  'corrida por aplicativo barata',
  'negociar preço de corrida',
  'carona intermunicipal dividindo custos',
  'frete barato com retorno vazio',
  'mudança residencial com van ou caminhão',
  'carreto rápido com utilitário',
  'ser motorista de aplicativo',
  'ganhar dinheiro com van ou caminhão',
  'segurança em corridas por aplicativo',
  'mototáxi e entregas por moto',
  'entregador para lanchonete e restaurante',
  'requisitos para motorista de aplicativo (EAR e ano do carro)',
  'compartilhar a viagem com a família em tempo real',
];
export const TOPIC_CITIES = [
  'São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Brasília', 'Salvador', 'Fortaleza', 'Recife', 'Curitiba', 'Porto Alegre', 'Manaus',
  'Belém', 'Goiânia', 'Campinas', 'São Luís', 'Maceió', 'Natal', 'João Pessoa', 'Teresina', 'Campo Grande', 'Cuiabá',
  'Florianópolis', 'Vitória', 'Aracaju', 'Porto Velho', 'Macapá', 'Boa Vista', 'Rio Branco', 'Palmas', 'Santos', 'Ribeirão Preto',
  'Sorocaba', 'Uberlândia', 'Joinville', 'Londrina', 'Juiz de Fora',
];
export const TOPIC_ANGLES = [
  'guia completo',
  'quanto custa e como economizar',
  'passo a passo para começar',
  'dicas de segurança',
  'erros comuns e como evitar',
  'perguntas frequentes respondidas',
];

/** Assunto do dia (determinístico: o mesmo dia sempre dá o mesmo assunto). */
export function topicForDay(dayIndex: number) {
  const service = TOPIC_SERVICES[dayIndex % TOPIC_SERVICES.length];
  const city = TOPIC_CITIES[Math.floor(dayIndex / TOPIC_SERVICES.length) % TOPIC_CITIES.length];
  const angle = TOPIC_ANGLES[dayIndex % TOPIC_ANGLES.length];
  return { service, city, angle, text: `${service} em ${city}: ${angle}` };
}

export function dayIndexOf(date: Date) {
  return Math.floor(date.getTime() / 864e5);
}

/** Data no fuso de Brasília (AAAA-MM-DD). */
export function brDate(date = new Date()) {
  return new Date(date.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

export function slugify(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function escapeHtml(text: unknown) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Confere se o post está no padrão de SEO antes de publicar. Devolve a lista de problemas. */
type SeoFields = Pick<BlogPost, 'title' | 'description' | 'keyword' | 'h1' | 'intro' | 'sections' | 'faq' | 'slug'>;

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** A palavra-chave "aparece" se o radical da palavra principal aparece (frete/fretes, mudança/mudancas). */
function hasKeyword(text: string, keyword: string) {
  const main = plain(keyword)
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort((a, b) => b.length - a.length)[0];
  if (!main) return true;
  return plain(text).includes(main.slice(0, Math.max(4, main.length - 2)));
}

/**
 * Problemas GRAVES impedem a publicação (texto sem conteúdo). Os demais são AVISOS:
 * o post é publicado e o aviso aparece no Admin.
 */
export function seoReview(p: SeoFields) {
  const hard: string[] = [];
  const soft: string[] = [];
  const words = [p.intro, ...p.sections.flatMap((s) => s.paragraphs)].join(' ').split(/\s+/).filter(Boolean).length;
  if (!p.title) hard.push('sem título');
  if (p.sections.length < 2) hard.push('menos de 2 seções');
  if (words < 350) hard.push(`texto curto demais (${words} palavras)`);
  if (!p.slug) hard.push('sem endereço (slug)');
  if (p.title.length < 30 || p.title.length > 65) soft.push(`título com ${p.title.length} caracteres (ideal 30–65)`);
  if (p.description.length < 110 || p.description.length > 160) soft.push(`descrição com ${p.description.length} caracteres (ideal 110–160)`);
  if (!p.keyword) soft.push('sem palavra-chave');
  else {
    if (!hasKeyword(p.title, p.keyword)) soft.push('palavra-chave fora do título');
    if (!hasKeyword(p.intro, p.keyword)) soft.push('palavra-chave fora do primeiro parágrafo');
  }
  if (p.sections.length < 3) soft.push('menos de 3 seções');
  if (p.faq.length < 3) soft.push('menos de 3 perguntas frequentes');
  if (words < 600) soft.push(`texto com ${words} palavras (ideal 600+)`);
  return { hard, soft };
}

/** Compatível com o nome antigo: todos os problemas (graves + avisos). */
export function seoProblems(p: SeoFields) {
  const r = seoReview(p);
  return [...r.hard, ...r.soft];
}

/** Ajusta sozinho o que dá para ajustar: tamanho do título e da descrição. */
export function autoFixSeo<T extends SeoFields>(p: T): T {
  let title = p.title.trim();
  if (title.length > 65) {
    const beforeColon = title.split(/[:|–-]/)[0].trim();
    title = beforeColon.length >= 30 && beforeColon.length <= 65 ? beforeColon : title.slice(0, 63).replace(/\s+\S*$/, '');
  }
  if (title.length < 30) title = `${title} | ${SITE_NAME}`.slice(0, 65);
  let description = p.description.trim().replace(/\s+/g, ' ');
  if (description.length > 160) {
    description = description.slice(0, 157).replace(/\s+\S*$/, '').replace(/[,;:.\s]+$/, '') + '.';
  }
  if (description.length < 110) {
    for (const extra of [`Veja dicas práticas e crie sua conta grátis no ${SITE_NAME}.`, 'Corridas, caronas e fretes em todo o Brasil.']) {
      if (description.length >= 110) break;
      description = `${description.replace(/[.\s]+$/, '')}. ${extra}`;
    }
    if (description.length > 160) description = description.slice(0, 157).replace(/\s+\S*$/, '').replace(/[,;:.\s]+$/, '') + '.';
  }
  return { ...p, title, description };
}

const POST_PROMPT = (topic: string, existingTitles: string[]) => `
Escreva UM artigo de blog original para o site ${SITE_NAME} (app 4 em 1: corridas, negociação de preço, caronas entre cidades e cargas/fretes com caminhão, van, furgão e utilitário — em todo o Brasil; inauguração em 10/03/2027).
Assunto do dia: "${topic}".
Objetivo: ser realmente útil para quem pesquisa isso no Google e no Bing (responder a dúvida de verdade, com dicas práticas), e convidar a pessoa a se cadastrar no ${SITE_NAME}.
Regras de SEO (obrigatórias):
- "keyword": a palavra-chave foco (2 a 5 palavras, como as pessoas buscam).
- "title": 40 a 62 caracteres, começa com a palavra-chave ou a contém no início.
- "description": 120 a 155 caracteres, com a palavra-chave e um convite.
- "h1": título da página (pode ser um pouco maior que o title).
- "intro": 1º parágrafo com a palavra-chave nas primeiras frases (60 a 110 palavras).
- "sections": 4 a 6 seções, cada uma com "heading" (subtítulo H2 com variações da palavra-chave) e "paragraphs" (2 a 4 parágrafos de 50 a 110 palavras).
- "faq": 4 a 6 perguntas reais que as pessoas fazem, com respostas diretas de 30 a 70 palavras.
- "cta": uma frase final convidando a criar conta grátis no ${SITE_NAME}.
- "tags": 3 a 6 palavras-chave secundárias.
Regras de conteúdo:
- Nada de números inventados: não cite preços de concorrentes, estatísticas ou leis específicas que você não tenha certeza; use faixas e explique que variam.
- Não prometa o que o app não faz. Fale do ${SITE_NAME} com naturalidade, sem exagero.
- Não copie textos de outros sites. Escreva com a voz da Froc.
- Evite títulos parecidos com estes já publicados: ${existingTitles.slice(0, 30).map((t) => `"${t}"`).join(', ') || '(nenhum)'}.
Responda SOMENTE com JSON válido: {"keyword","title","description","h1","intro","sections":[{"heading","paragraphs":[]}],"faq":[{"q","a"}],"cta","tags":[]}
`;

export interface BlogDeps {
  llm?: LlmClient;
  images?: ImageClient;
  files?: FileStorage;
  siteUrl: () => string;
  indexNow?: (urls: string[]) => Promise<unknown>;
}

/** Endereço público da capa do post (foto da IA ou capa da marca). */
export function coverUrl(post: Pick<BlogPost, 'id' | 'slug' | 'image'>) {
  if (post.image) return `/blog/img/${post.id}.${post.image.mimeType.includes('jpeg') ? 'jpg' : 'png'}`;
  return `/blog/capa/${post.slug}.svg`;
}

/** Texto alternativo da capa (acessibilidade e Google Imagens). */
export function coverAlt(post: Pick<BlogPost, 'keyword' | 'title' | 'image'>) {
  return post.image?.alt || `${post.title} — ${SITE_NAME}`;
}

export class BlogService {
  private store: Store;
  private deps: BlogDeps;
  constructor(store: Store, deps: BlogDeps) {
    this.store = store;
    this.deps = deps;
  }

  async list(opts: { includeDrafts?: boolean; limit?: number } = {}) {
    const all = await this.store.query<BlogPost>('blog', opts.includeDrafts ? [] : [['published', '==', true]], 5000);
    return all.sort((a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt))).slice(0, opts.limit ?? 5000);
  }

  async get(slug: string) {
    const found = await this.store.query<BlogPost>('blog', [['slug', '==', slug]], 1);
    return found[0] ?? null;
  }

  async setPublished(slug: string, published: boolean) {
    const post = await this.get(slug);
    if (!post) return null;
    await this.store.update('blog', post.id, { published, updatedAt: new Date().toISOString(), ...(published && !post.publishedAt ? { publishedAt: new Date().toISOString() } : {}) });
    if (published) await this.ping([this.url(slug)]);
    return { ok: true };
  }

  url(slug: string) {
    return `${this.deps.siteUrl()}/blog/${slug}`;
  }

  async ping(urls: string[]) {
    try {
      await this.deps.indexNow?.(urls);
    } catch (e) {
      console.warn('IndexNow falhou:', e);
    }
  }

  /** Já existe post publicado hoje (horário de Brasília)? */
  /** Gera a capa com a IA e guarda no Storage. Devolve true se deu certo. */
  async attachImage(slug: string) {
    const post = await this.get(slug);
    if (!post) throw new Error('Post não encontrado.');
    if (!this.deps.images?.configured || !this.deps.files) throw new Error('Imagens indisponíveis (IA ou Storage sem configuração).');
    await this.store.update('blog', post.id, { imageAttempts: Number(post.imageAttempts || 0) + 1 });
    const img = await this.deps.images.generate(coverPrompt(post.topic, post.keyword));
    const ext = img.mimeType.includes('jpeg') ? 'jpg' : 'png';
    const path = `froc-x-uber/blog/${post.id}.${ext}`;
    await this.deps.files.save(path, img.mimeType, img.bytes);
    const image = { path, mimeType: img.mimeType, alt: `Imagem ilustrativa: ${post.keyword || post.title}`, model: img.model };
    await this.store.update('blog', post.id, { image, updatedAt: new Date().toISOString() });
    return { ok: true, url: coverUrl({ ...post, image }), model: img.model };
  }

  /** Coloca capa nos posts publicados que ainda não têm (até `max` por vez; 3 tentativas por post). */
  async fillMissingImages(max = 1) {
    if (!this.deps.images?.configured || !this.deps.files) return { skipped: true };
    const pending = (await this.list({ limit: 15 })).filter((p) => !p.image && Number(p.imageAttempts || 0) < 3).slice(0, max);
    const done: string[] = [];
    for (const p of pending) {
      try {
        await this.attachImage(p.slug);
        done.push(p.slug);
      } catch (e) {
        console.warn('Capa do blog não gerada:', p.slug, e instanceof Error ? e.message : e);
      }
    }
    return { done };
  }

  async readImage(id: string) {
    const post = (await this.store.get<BlogPost>('blog', id)) ?? null;
    if (!post?.image || !this.deps.files?.read) return null;
    return this.deps.files.read(post.image.path);
  }

  async hasPostOn(day: string) {
    const recent = await this.list({ includeDrafts: true, limit: 10 });
    return recent.some((p) => brDate(new Date(p.createdAt)) === day);
  }

  /** Escreve (com a IA), confere o SEO e publica. Até 2 tentativas se o padrão não for atingido. */
  async generate(opts: { topic?: string; author?: string; publish?: boolean; now?: Date } = {}) {
    if (!this.deps.llm?.configured) throw new Error('IA não configurada (GEMINI_API_KEY).');
    const now = opts.now ?? new Date();
    const topic = opts.topic?.trim() || topicForDay(dayIndexOf(now)).text;
    const existing = await this.list({ includeDrafts: true, limit: 200 });
    const titles = existing.map((p) => p.title);
    let lastProblems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await this.deps.llm.generate({
        system: FROC_VOICE + '\nVocê é o redator de SEO da Froc. Português do Brasil, texto humano, claro e útil.',
        contents: [
          {
            role: 'user',
            parts: [{ text: POST_PROMPT(topic, titles) + (lastProblems.length ? `\nA versão anterior foi recusada por: ${lastProblems.join('; ')}. Corrija.` : '') }],
          },
        ],
        json: true,
        temperature: 0.8,
        maxOutputTokens: 8192,
      });
      const raw = parseJsonLoose<Partial<BlogPost>>(out.text);
      const post = this.normalize(raw, topic, now, opts.author || 'Froc IA · Marketing e SEO');
      let slug = post.slug;
      for (let n = 2; existing.some((p) => p.slug === slug); n++) slug = `${post.slug}-${n}`;
      post.slug = slug;
      Object.assign(post, autoFixSeo(post));
      const review = seoReview(post);
      lastProblems = [...review.hard, ...review.soft];
      // 1ª tentativa com problema GRAVE: pede de novo. Avisos leves não seguram a publicação.
      if (review.hard.length && attempt === 0) continue;
      post.published = opts.publish !== false && review.hard.length === 0;
      post.publishedAt = post.published ? now.toISOString() : '';
      await this.store.set('blog', post.id, post);
      if (post.published) await this.ping([this.url(post.slug), `${this.deps.siteUrl()}/blog`]);
      return { post, problems: lastProblems };
    }
    throw new Error('Falha ao gerar o post.');
  }

  normalize(raw: Partial<BlogPost>, topic: string, now: Date, author: string): BlogPost {
    const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    const title = str(raw.title, 70);
    const sections = (Array.isArray(raw.sections) ? raw.sections : [])
      .slice(0, 8)
      .map((s) => ({
        heading: str((s as BlogSection)?.heading, 120),
        paragraphs: (Array.isArray((s as BlogSection)?.paragraphs) ? (s as BlogSection).paragraphs : []).map((p) => str(p, 1200)).filter(Boolean).slice(0, 6),
      }))
      .filter((s) => s.heading && s.paragraphs.length);
    return {
      id: randomUUID(),
      slug: slugify(str(raw.keyword, 80) || title || topic) || slugify(topic),
      title,
      description: str(raw.description, 170),
      keyword: str(raw.keyword, 80).toLowerCase(),
      h1: str(raw.h1, 140) || title,
      intro: str(raw.intro, 1500),
      sections,
      faq: (Array.isArray(raw.faq) ? raw.faq : [])
        .map((f) => ({ q: str((f as { q: string }).q, 200), a: str((f as { a: string }).a, 800) }))
        .filter((f) => f.q && f.a)
        .slice(0, 8),
      cta: str(raw.cta, 240) || `Crie sua conta grátis no ${SITE_NAME}.`,
      tags: (Array.isArray(raw.tags) ? raw.tags : []).map((t) => str(t, 40)).filter(Boolean).slice(0, 8),
      topic,
      published: false,
      author,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      publishedAt: '',
    };
  }
}

// ------------------------------------------------------------------ HTML

const STYLE = `
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#050505;color:#f4f4f5;font:16px/1.7 'Plus Jakarta Sans',system-ui,sans-serif}
a{color:#ff5aa8}header,footer{border-color:rgba(255,255,255,.1)}header{position:sticky;top:0;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,.1);z-index:5}
.wrap{max-width:820px;margin:0 auto;padding:0 18px}.bar{display:flex;align-items:center;justify-content:space-between;height:56px}
.logo{font:800 20px Outfit,system-ui;text-decoration:none;background:linear-gradient(100deg,#fff,#f7e08a 25%,#d4af37 45%,#ff2d95 65%,#fff);background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:s 6s linear infinite}
@keyframes s{to{background-position:220% center}}
.btn{display:inline-block;padding:12px 20px;border-radius:14px;background:linear-gradient(135deg,#ff4fa7,#e6087f 55%,#b00064);color:#fff;font-weight:700;text-decoration:none;box-shadow:0 8px 26px -10px rgba(255,45,149,.8)}
.btn.gold{background:linear-gradient(135deg,#f7e08a,#d4af37 45%,#9c7a1c);color:#1a1305}
h1{font:800 clamp(28px,5vw,42px)/1.15 Outfit,system-ui;margin:28px 0 12px}h2{font:700 24px/1.3 Outfit,system-ui;margin:34px 0 8px;color:#fff}
.meta{color:#a1a1aa;font-size:13px}.lead{font-size:18px;color:#e4e4e7}
.card{border:1px solid rgba(212,175,55,.35);border-radius:18px;padding:20px;margin:28px 0;background:linear-gradient(135deg,rgba(255,45,149,.08),rgba(212,175,55,.06))}
details{border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px 16px;margin:8px 0;background:rgba(255,255,255,.03)}summary{cursor:pointer;font-weight:700}
.hero{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:18px;margin:18px 0 6px;border:1px solid rgba(212,175,55,.35);box-shadow:0 18px 50px -24px rgba(255,45,149,.6)}
.list a{display:flex;gap:14px;align-items:center;padding:16px 0;border-bottom:1px solid rgba(255,255,255,.08);text-decoration:none}.list img{width:120px;height:68px;object-fit:cover;border-radius:10px;flex-shrink:0;border:1px solid rgba(212,175,55,.3)}.list div{min-width:0}.list b{display:block;color:#fff;font-size:18px}.list span{color:#a1a1aa;font-size:14px}
.crumbs{font-size:13px;color:#a1a1aa;margin-top:18px}.crumbs a{color:#d4af37}footer{border-top:1px solid rgba(255,255,255,.1);margin-top:50px;padding:28px 0;color:#77777f;font-size:13px;text-align:center}
.tags span{display:inline-block;border:1px solid rgba(212,175,55,.4);color:#f2c14e;border-radius:999px;padding:2px 10px;font-size:12px;margin:2px}
`;

export function layout(o: { title: string; description: string; canonical: string; body: string; jsonLd: unknown[]; type?: string; publishedAt?: string; image?: string; imageAlt?: string }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.description)}">
<link rel="canonical" href="${escapeHtml(o.canonical)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="${o.type || 'website'}">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.description)}">
<meta property="og:url" content="${escapeHtml(o.canonical)}">
${o.publishedAt ? `<meta property="article:published_time" content="${escapeHtml(o.publishedAt)}">` : ''}
<meta property="og:image" content="${escapeHtml(o.image || `${o.canonical.replace(/^(https?:\/\/[^/]+).*/, '$1')}/pwa-512x512.png`)}">
${o.imageAlt ? `<meta property="og:image:alt" content="${escapeHtml(o.imageAlt)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#050505">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="alternate" type="application/rss+xml" title="${SITE_NAME} · Blog" href="/rss.xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
${o.jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header><div class="wrap bar"><a class="logo" href="/">${SITE_NAME}</a><a class="btn" href="/#entrar">Criar conta grátis</a></div></header>
<main class="wrap">${o.body}</main>
<footer><div class="wrap"><a href="/">Início</a> · <a href="/blog">Blog</a> · <a href="/como-funciona">Como funciona</a> · <a href="/regras-e-requisitos">Regras e leis</a> · <a href="/perguntas-frequentes">Perguntas frequentes</a> · <a href="/corridas-por-aplicativo">Corridas</a> · <a href="/caronas-intermunicipais">Caronas</a> · <a href="/fretes-e-mudancas">Fretes</a> · <a href="/seja-motorista">Seja motorista</a> · <a href="/desenvolvedores">Para lojas e desenvolvedores</a> · <a href="/legal/termos.html">Termos</a> · <a href="/legal/privacidade.html">Privacidade</a><br>© ${new Date().getFullYear()} ${SITE_NAME}</div></footer>
</body>
</html>`;
}

export const ORG = (site: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: site,
  logo: `${site}/pwa-512x512.png`,
});

function listItem(p: BlogPost) {
  return `<a href="/blog/${escapeHtml(p.slug)}"><img src="${escapeHtml(coverUrl(p))}" alt="${escapeHtml(coverAlt(p))}" width="240" height="135" loading="lazy"><div><b>${escapeHtml(p.title)}</b><span>${escapeHtml(p.description)}</span></div></a>`;
}

/** Capa da marca (quando a IA não gerou foto): preto, rosa e dourado com o título do post. */
export function renderCoverSvg(post: Pick<BlogPost, 'title' | 'keyword'>) {
  const words = post.title.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 26 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#050505"/><stop offset="1" stop-color="#1a0010"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f7e08a"/><stop offset=".5" stop-color="#d4af37"/><stop offset="1" stop-color="#9c7a1c"/></linearGradient>
<linearGradient id="pink" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4fa7"/><stop offset="1" stop-color="#c2006b"/></linearGradient>
<radialGradient id="glow" cx=".85" cy=".1" r=".6"><stop offset="0" stop-color="#ff2d95" stop-opacity=".45"/><stop offset="1" stop-color="#ff2d95" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1280" height="720" fill="url(#bg)"/><rect width="1280" height="720" fill="url(#glow)"/>
<rect x="24" y="24" width="1232" height="672" rx="36" fill="none" stroke="url(#gold)" stroke-width="3" opacity=".8"/>
<text x="80" y="130" font-family="Outfit,Arial,sans-serif" font-size="40" font-weight="800" fill="url(#gold)">${escapeHtml(SITE_NAME)}</text>
<rect x="80" y="160" width="140" height="8" rx="4" fill="url(#pink)"/>
${shown.map((l, i) => `<text x="80" y="${280 + i * 92}" font-family="Outfit,Arial,sans-serif" font-size="76" font-weight="800" fill="#ffffff">${escapeHtml(l)}</text>`).join('\n')}
<text x="80" y="660" font-family="Arial,sans-serif" font-size="28" fill="#d4af37">Corridas · Caronas · Fretes — todo o Brasil</text>
</svg>`;
}

export function renderPost(post: BlogPost, site: string, related: BlogPost[] = []) {
  const url = `${site}/blog/${post.slug}`;
  const body = `
<nav class="crumbs"><a href="/">Início</a> › <a href="/blog">Blog</a> › ${escapeHtml(post.title)}</nav>
<article>
<h1>${escapeHtml(post.h1)}</h1>
<div class="meta">Por ${escapeHtml(post.author)} · ${new Date(post.publishedAt || post.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>
<img class="hero" src="${escapeHtml(coverUrl(post))}" alt="${escapeHtml(coverAlt(post))}" width="1280" height="720" fetchpriority="high">
<p class="lead">${escapeHtml(post.intro)}</p>
${post.sections.map((s) => `<h2>${escapeHtml(s.heading)}</h2>${s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}`).join('\n')}
<div class="card"><h2 style="margin-top:0">Experimente o ${SITE_NAME}</h2><p>${escapeHtml(post.cta)}</p><a class="btn" href="/#entrar">Criar conta grátis</a> <a class="btn gold" href="/seja-motorista">Quero ser motorista</a></div>
${post.faq.length ? `<h2>Perguntas frequentes</h2>${post.faq.map((f) => `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`).join('')}` : ''}
${post.tags.length ? `<p class="tags">${post.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</p>` : ''}
</article>
${related.length ? `<h2>Leia também</h2><div class="list">${related.map(listItem).join('')}</div>` : ''}`;
  const image = `${site}${coverUrl(post)}`;
  return layout({
    title: post.title,
    description: post.description,
    canonical: url,
    // Rede social não mostra SVG: sem foto da IA, usa o ícone da marca.
    image: post.image ? image : undefined,
    imageAlt: coverAlt(post),
    type: 'article',
    publishedAt: post.publishedAt || post.createdAt,
    body,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.description,
        image: [image],
        mainEntityOfPage: url,
        url,
        datePublished: post.publishedAt || post.createdAt,
        dateModified: post.updatedAt || post.createdAt,
        inLanguage: 'pt-BR',
        keywords: [post.keyword, ...post.tags].join(', '),
        author: { '@type': 'Organization', name: SITE_NAME, url: site },
        publisher: ORG(site),
      },
      ...(post.faq.length
        ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: post.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }]
        : []),
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Início', item: `${site}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${site}/blog` },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      },
    ],
  });
}

export function renderBlogIndex(posts: BlogPost[], site: string) {
  const body = `
<h1>Blog do ${SITE_NAME}</h1>
<p class="lead">Dicas de corridas, caronas entre cidades, fretes, mudanças e como ganhar dinheiro dirigindo — um artigo novo todo dia.</p>
<div class="list">${posts.length ? posts.map(listItem).join('') : '<p>Os primeiros artigos chegam em breve.</p>'}</div>`;
  return layout({
    title: `Blog ${SITE_NAME}: corridas, caronas e fretes`,
    description: 'Artigos diários sobre corrida por aplicativo, carona intermunicipal, frete, mudança e como ser motorista. Dicas práticas para todo o Brasil.',
    canonical: `${site}/blog`,
    body,
    jsonLd: [
      ORG(site),
      { '@context': 'https://schema.org', '@type': 'Blog', name: `Blog ${SITE_NAME}`, url: `${site}/blog`, inLanguage: 'pt-BR' },
    ],
  });
}

// ------------------------------------------------------------- páginas de serviço

export interface ServicePage {
  slug: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  points: [string, string][];
  faq: [string, string][];
  cta: string;
}

export const SERVICE_PAGES: ServicePage[] = [
  {
    slug: 'corridas-por-aplicativo',
    title: 'Corrida por aplicativo em todo o Brasil | Froc X Uber',
    description: 'Peça corrida de carro ou moto com preço antes de embarcar, PIN de segurança, SOS e pagamento por Pix, cartão ou dinheiro. Crie sua conta grátis.',
    h1: 'Corrida por aplicativo com preço justo e segurança',
    intro: 'No Froc X Uber você pede uma corrida por aplicativo em qualquer cidade do Brasil e vê o preço antes de confirmar. São cinco categorias — do carro econômico ao conforto, além de moto e entregas — com embarque protegido por PIN.',
    points: [
      ['Preço antes de pedir', 'O valor aparece antes de você confirmar, calculado pela distância e pelo tempo do trajeto.'],
      ['PIN no embarque', 'O motorista só inicia a viagem com o PIN de 4 dígitos que você informa. Nada de entrar no carro errado.'],
      ['Pague como preferir', 'Saldo da carteira (Pix ou cartão pelo Mercado Pago) ou dinheiro direto ao motorista.'],
      ['SOS e avaliação', 'Botão SOS com localização para a equipe e avaliação dos dois lados em toda corrida.'],
    ],
    faq: [
      ['Funciona na minha cidade?', 'Sim: qualquer endereço do Brasil pode ser origem ou destino. A disponibilidade de motoristas cresce conforme a região.'],
      ['Posso negociar o preço?', 'Sim, na aba Negociar você propõe o valor e os motoristas respondem com ofertas.'],
      ['Como é a segurança?', 'Motoristas com documentos analisados, PIN no embarque, SOS, compartilhamento da viagem e avaliação.'],
    ],
    cta: 'Crie sua conta grátis e peça sua primeira corrida.',
  },
  {
    slug: 'caronas-intermunicipais',
    title: 'Carona intermunicipal dividindo custos | Froc X Uber',
    description: 'Encontre ou ofereça carona entre cidades de todo o Brasil e divida o custo da viagem. Reserva paga pelo app e reembolso se a viagem for cancelada.',
    h1: 'Carona intermunicipal: divida a viagem e economize',
    intro: 'A carona intermunicipal do Froc X Uber liga motoristas e passageiros que vão para o mesmo destino, em qualquer cidade do Brasil. O motorista define o preço por vaga e o passageiro reserva pelo app.',
    points: [
      ['Qualquer cidade', 'Saída e destino em todo o Brasil, com busca de cidades do Google.'],
      ['Pagamento protegido', 'O valor da reserva fica guardado e só vai para o motorista depois da viagem.'],
      ['Cancelou? Volta', 'Se o passageiro desistir ou o motorista cancelar, o dinheiro volta para a carteira.'],
      ['Preferências', 'Música, pet e bagagem combinados antes de reservar.'],
    ],
    faq: [
      ['Quem pode oferecer carona?', 'Motoristas com cadastro aprovado (CNH e documento do veículo analisados pela equipe).'],
      ['Quanto custa?', 'Cada motorista define o preço por vaga. Você vê o valor antes de reservar.'],
      ['E se a viagem não acontecer?', 'Cancelamentos devolvem o valor da reserva para a sua carteira.'],
    ],
    cta: 'Crie sua conta e encontre sua próxima carona.',
  },
  {
    slug: 'fretes-e-mudancas',
    title: 'Frete e mudança barata com van e caminhão | Froc X Uber',
    description: 'Contrate frete, carreto ou mudança com caminhão, van, furgão ou utilitário. Compare lances, aproveite o retorno vazio e pague só na entrega.',
    h1: 'Frete, carreto e mudança com quem já vai para lá',
    intro: 'No Froc X Uber você publica seu frete ou mudança e recebe lances de transportadores com caminhão, van, furgão, pick-up e utilitário. E pode aproveitar o retorno vazio, que costuma sair mais barato.',
    points: [
      ['Calculadora de cubagem', 'Conte os móveis e caixas e o app sugere o volume, o peso e o veículo certo.'],
      ['Compare lances', 'Transportadores aprovados enviam propostas e você escolhe a melhor.'],
      ['Retorno vazio', 'Veículos voltando vazios anunciam a rota com desconto.'],
      ['Pague na entrega', 'O valor fica guardado e só é liberado quando a entrega é confirmada.'],
    ],
    faq: [
      ['Que veículos atendem?', 'Caminhões (VUC, 3/4, toco, truck, carreta), vans de carga, furgões, pick-ups, utilitários e carro com carretinha.'],
      ['Os transportadores são verificados?', 'Sim: CNH, CRLV, comprovante ANTT e número do RNTRC passam pela análise da equipe.'],
      ['Atende entre estados?', 'Sim, coleta e entrega podem ser em qualquer endereço do Brasil.'],
    ],
    cta: 'Publique seu frete grátis e receba lances.',
  },
  {
    slug: 'seja-motorista',
    title: 'Seja motorista parceiro do Froc X Uber | Cadastre-se',
    description: 'Dirija com carro, moto, van ou caminhão no Froc X Uber: corridas, negociação, caronas e fretes num app só. Cadastro com análise rápida de documentos.',
    h1: 'Seja motorista ou transportador parceiro',
    intro: 'Quer ser motorista de aplicativo ou ganhar dinheiro com seu veículo de carga? No Froc X Uber você recebe corridas, negocia preços, oferece caronas entre cidades e faz fretes — tudo com a mesma conta.',
    points: [
      ['4 fontes de renda', 'Corridas, negociação de preço, caronas intermunicipais e fretes/mudanças.'],
      ['Receba na carteira', 'O valor cai na sua carteira quando o serviço termina; saque por Pix.'],
      ['Regras claras', 'A comissão aparece no app antes de cada serviço.'],
      ['Cadastro simples', 'Envie CNH e documento do veículo pelo celular; transportadores enviam também ANTT/RNTRC.'],
    ],
    faq: [
      ['Quais documentos preciso?', 'Motorista: CNH e CRLV. Transportador de carga: CNH, CRLV, comprovante ANTT e número do RNTRC.'],
      ['Posso usar van ou utilitário?', 'Sim, em Cargas são aceitos vans, furgões, pick-ups, utilitários e caminhões.'],
      ['Como recebo?', 'Pelo saldo da carteira, com saque via Pix a partir de R$ 20.'],
    ],
    cta: 'Cadastre-se como motorista ou transportador.',
  },
];

export function renderServicePage(page: ServicePage, site: string, latest: BlogPost[] = []) {
  const url = `${site}/${page.slug}`;
  const body = `
<nav class="crumbs"><a href="/">Início</a> › ${escapeHtml(page.h1)}</nav>
<h1>${escapeHtml(page.h1)}</h1>
<p class="lead">${escapeHtml(page.intro)}</p>
<p><a class="btn" href="/#entrar">Criar conta grátis</a> <a class="btn gold" href="/seja-motorista">Quero ser motorista</a></p>
${page.points.map(([h, t]) => `<h2>${escapeHtml(h)}</h2><p>${escapeHtml(t)}</p>`).join('')}
<div class="card"><h2 style="margin-top:0">Inauguração em 10 de março de 2027</h2><p>Cadastre-se antes e ganhe o selo de membro fundador. ${escapeHtml(page.cta)}</p><a class="btn" href="/#entrar">Quero ser fundador</a></div>
<h2>Perguntas frequentes</h2>${page.faq.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join('')}
${latest.length ? `<h2>Do nosso blog</h2><div class="list">${latest.map((r) => `<a href="/blog/${escapeHtml(r.slug)}"><b>${escapeHtml(r.title)}</b><span>${escapeHtml(r.description)}</span></a>`).join('')}</div>` : ''}`;
  return layout({
    title: page.title,
    description: page.description,
    canonical: url,
    body,
    jsonLd: [
      ORG(site),
      { '@context': 'https://schema.org', '@type': 'Service', name: page.h1, description: page.description, provider: { '@type': 'Organization', name: SITE_NAME, url: site }, areaServed: { '@type': 'Country', name: 'Brasil' }, url },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: page.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  });
}

// ------------------------------------------------------------------ sitemaps

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Data da última versão do site (fixada no build), usada como lastmod das páginas fixas. */
export const STATIC_LASTMOD = '2026-11-16';

export function sitemapIndex(site: string, latestBlog?: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${xmlEscape(site)}/sitemap-paginas.xml</loc><lastmod>${STATIC_LASTMOD}</lastmod></sitemap>
  <sitemap><loc>${xmlEscape(site)}/sitemap-blog.xml</loc><lastmod>${(latestBlog || STATIC_LASTMOD).slice(0, 10)}</lastmod></sitemap>
</sitemapindex>
`;
}

export function sitemapPages(site: string) {
  const urls = [
    { loc: `${site}/`, priority: '1.0', freq: 'daily' },
    ...SERVICE_PAGES.map((p) => ({ loc: `${site}/${p.slug}`, priority: '0.9', freq: 'weekly' })),
    ...GUIDE_SLUGS.map((slug) => ({ loc: `${site}/${slug}`, priority: '0.7', freq: 'monthly' })),
    { loc: `${site}/blog`, priority: '0.8', freq: 'daily' },
    ...['ajuda', 'seguranca', 'termos', 'privacidade'].map((p) => ({ loc: `${site}/legal/${p}.html`, priority: '0.3', freq: 'yearly' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc><lastmod>${STATIC_LASTMOD}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
}

export function sitemapBlog(site: string, posts: BlogPost[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${posts
  .map(
    (p) =>
      `  <url><loc>${xmlEscape(`${site}/blog/${p.slug}`)}</loc><lastmod>${String(p.updatedAt || p.publishedAt || p.createdAt).slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority>${
        p.image ? `<image:image><image:loc>${xmlEscape(`${site}${coverUrl(p)}`)}</image:loc></image:image>` : ''
      }</url>`,
  )
  .join('\n')}
</urlset>
`;
}

export function rssFeed(site: string, posts: BlogPost[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xmlEscape(`Blog ${SITE_NAME}`)}</title>
<link>${xmlEscape(site)}/blog</link>
<atom:link href="${xmlEscape(site)}/rss.xml" rel="self" type="application/rss+xml"/>
<description>Corridas, caronas, fretes e mobilidade em todo o Brasil.</description>
<language>pt-BR</language>
${posts
  .slice(0, 50)
  .map(
    (p) => `<item><title>${xmlEscape(p.title)}</title><link>${xmlEscape(`${site}/blog/${p.slug}`)}</link><guid>${xmlEscape(`${site}/blog/${p.slug}`)}</guid><pubDate>${new Date(p.publishedAt || p.createdAt).toUTCString()}</pubDate><description>${xmlEscape(p.description)}</description></item>`,
  )
  .join('\n')}
</channel>
</rss>
`;
}

// ------------------------------------------------------------------ IndexNow (Bing)

/** Chave pública do IndexNow (o mesmo valor fica em public/<chave>.txt). */
export const INDEXNOW_KEY = 'f7c3a9e15b8d4c2e9a61d0b47e3f5c28';

export function createIndexNow(site: () => string, fetchImpl: typeof fetch = fetch) {
  return async (urls: string[]) => {
    const base = site();
    if (!base || !urls.length) return { skipped: true };
    const host = new URL(base).host;
    const res = await fetchImpl('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${base}/${INDEXNOW_KEY}.txt`, urlList: urls.slice(0, 10000) }),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status };
  };
}
