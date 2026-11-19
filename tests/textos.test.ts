/**
 * Textos que o público vê (app, páginas, blog, IA de atendimento) — pedido do dono, 19/11/2026:
 *  1) nunca citar outros apps de transporte (os nomes só serviram de referência na construção);
 *  2) nunca mostrar quanto a Froc ganha nem quanto o motorista recebe por km (domínio da Froc);
 *  3) a categoria "99 Pop" não existe mais.
 * O nome do app ("Froc X Uber") continua, por decisão do dono.
 * Rodar: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RIDE_CATEGORIES } from '../src/data/locations.ts';
import { PRICING_TEXT } from '../src/data/pricing.ts';
import { CARPOOL_POLICY_TEXT } from '../src/data/carpoolPolicy.ts';
import { platformKnowledge } from '../server/ai/persona.ts';
import { DEFAULT_SETTINGS } from '../server/settings.ts';

// fileURLToPath: no Windows, URL.pathname vira "/C:/..." e quebra o caminho.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((n) => {
    const rel = join(dir, n);
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });

/** Arquivos com texto que aparece para usuários. Admin e ferramentas internas ficam de fora. */
const PUBLICOS = [
  ...walk('src').filter((f) => /\.(tsx?|css)$/.test(f) && !/AdminPanel|\.d\.ts$/.test(f)),
  ...walk('public').filter((f) => /\.(html|json|webmanifest|txt|xml)$/.test(f)),
  'index.html',
  'server/guidePages.ts',
  'server/blog.ts',
];

/** Só o que vira texto: strings ('...', "...", `...`) e texto de JSX; comentários e nomes de código ficam de fora. */
function visibleText(src: string, file: string): string[] {
  if (/\.(html|json|webmanifest|txt|xml)$/.test(file)) return [src.replace(/<script[\s\S]*?<\/script>/g, (m) => (m.includes('ld+json') ? m : ''))];
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of noComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  if (file.endsWith('.tsx')) for (const m of noComments.matchAll(/>([^<>{}]+)</g)) out.push(m[1]);
  return out;
}

/** Identificadores técnicos permitidos dentro de strings (rotas e chaves internas). */
const TECNICO = /^(\/api)?\/indrive\b|^indrive\w*$|froc-x-uber|^[a-z]+(\.[a-z]+)*$/;
const MARCAS = /\buber\b|\b99\s*pop\b|\bin\s?drive\b|\bbla\s?bla\s?car\b|\b99\s*(táxi|taxi)\b|\bapp 99\b/i;

function sinsDe(file: string) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  return visibleText(src, file)
    .map((t) => t.replace(/froc[\s-]?x[\s-]?uber/gi, '').replace(/uberl[aâ]ndia/gi, ''))
    .filter((t) => !TECNICO.test(t.trim()));
}

test('nenhum texto público cita outros apps de transporte', () => {
  const achados: string[] = [];
  for (const f of PUBLICOS) for (const t of sinsDe(f)) if (MARCAS.test(t)) achados.push(`${f}: "${t.trim().slice(0, 90)}"`);
  assert.deepEqual(achados, []);
});

/** Ganho da Froc e km do motorista. */
const VALORES_INTERNOS = [
  /R\$\s*2\s*(?:,00)?\s*(?:a|e|até|–|-)\s*R?\$?\s*8\b/i, // Froc R$ 2 a 8
  /R\$\s*2\s*(?:,00)?\s*(?:a|e|até|–|-)\s*R?\$?\s*5\b[^%]{0,30}km/i, // R$ 2 a 5 por km
  /R\$\s*1,50\s*(?:a|e|até|–|-)\s*R?\$?\s*2,50/i, // moto
  /froc\s+(?:fica|cobra|ganha|recebe)\s+(?:com\s+)?(?:só\s+|apenas\s+)?(?:R\$|\d)/i,
  /\b\d{1,2}\s*%\s*(?:de\s+)?comiss/i,
  /comiss[ãa]o\s+(?:de\s+)?\d{1,2}\s*%/i,
  /\d{1,2}\s*%\s*(?:do valor total\s+)?(?:para|fica com)\s+a\s+froc/i,
];

test('nenhum texto público mostra quanto a Froc ganha ou o km do motorista', () => {
  const achados: string[] = [];
  for (const f of PUBLICOS) for (const t of sinsDe(f)) for (const re of VALORES_INTERNOS) if (re.test(t)) achados.push(`${f}: "${t.trim().slice(0, 100)}"`);
  assert.deepEqual(achados, []);
});

test('textos de preço e de regras das caronas não revelam valores internos', () => {
  for (const t of [...PRICING_TEXT, ...CARPOOL_POLICY_TEXT]) for (const re of VALORES_INTERNOS) assert.ok(!re.test(t), t);
});

test('IA de atendimento (público) não recebe valores internos nem nomes de outros apps', () => {
  const pub = platformKnowledge(DEFAULT_SETTINGS, 'publico');
  for (const re of VALORES_INTERNOS) assert.ok(!re.test(pub), `vazou ${re}`);
  assert.ok(!/CONFIDENCIAL: motorista recebe/.test(pub));
  assert.ok(!MARCAS.test(pub.replace(/froc[\s-]?x[\s-]?uber/gi, '')), 'cita outro app');
  const interno = platformKnowledge(DEFAULT_SETTINGS, 'interno');
  assert.match(interno, /CONFIDENCIAL/, 'a equipe interna continua sabendo os números');
});

test('categoria 99 Pop não existe mais', () => {
  assert.ok(!RIDE_CATEGORIES.some((c) => /99/.test(c.label + c.tag) || c.id === ('froc_99' as string)));
  assert.deepEqual(
    RIDE_CATEGORIES.map((c) => c.id),
    ['froc_x', 'froc_comfort', 'froc_moto', 'froc_delivery'],
  );
});

test('termos de uso trazem as mesmas regras das caronas', () => {
  const termos = readFileSync(join(ROOT, 'public/legal/termos.html'), 'utf8');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  for (const t of CARPOOL_POLICY_TEXT) assert.ok(termos.includes(esc(t)), `termos sem: ${t.slice(0, 60)}`);
});
