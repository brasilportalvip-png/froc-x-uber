/**
 * Tema escuro: texto cinza estava difícil de ler no fundo preto (pedido de 19/11/2026).
 * Confere que os cinzas viraram branco com contraste alto (WCAG AAA = 7:1) nos fundos do app.
 * Rodar: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css: string = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/** Cor que o CSS dá para a classe no tema escuro. */
function darkColorOf(cls: string): string {
  const blocks = css.split('}').map((b: string) => b + '}');
  for (const b of blocks) {
    const sel = b.slice(0, b.indexOf('{'));
    if (sel.split(',').some((s: string) => s.trim() === `.dark .${cls.replace(':', '\\:')}`)) {
      const m = b.match(/color:\s*(#[0-9a-fA-F]{6})/);
      if (m) return m[1];
    }
  }
  throw new Error(`sem cor no tema escuro para .${cls}`);
}

const FUNDOS = { pagina: '#050505', cartao: '#111013', topo: '#101622', campo: '#18181b' };

for (const cls of ['text-slate-300', 'text-slate-400', 'text-slate-500', 'text-slate-600', 'dark:text-slate-300', 'dark:text-slate-400', 'dark:text-slate-500', 'dark:text-slate-600']) {
  test(`tema escuro: ${cls} fica claro e legível`, () => {
    const cor = darkColorOf(cls);
    for (const [nome, fundo] of Object.entries(FUNDOS)) {
      const c = contrast(cor, fundo);
      assert.ok(c >= 12, `${cls} (${cor}) no fundo ${nome} ${fundo}: contraste ${c.toFixed(1)} < 12`);
    }
    assert.ok(luminance(cor) > 0.75, `${cls} (${cor}) ainda parece cinza`);
  });
}

test('texto de exemplo nos campos também fica legível', () => {
  const m = css.match(/\.dark input::placeholder,\s*\.dark textarea::placeholder\s*\{\s*color:\s*(#[0-9a-fA-F]{6})/);
  if (!m) throw new Error('regra do placeholder no tema escuro');
  assert.ok(contrast(m[1], FUNDOS.cartao) >= 7);
});

test('a regra fica fora de @layer (vence as classes do Tailwind)', () => {
  const idx = css.indexOf('.dark .text-slate-500');
  const before = css.slice(0, idx);
  // Profundidade de chaves 0 = fora de qualquer @layer ou bloco.
  let depth = 0;
  for (const ch of before) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
  assert.equal(depth, 0);
});
