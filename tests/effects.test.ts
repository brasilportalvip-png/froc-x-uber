import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Proteção: todo useEffect precisa ter corpo entre chaves. Um efeito escrito como
 * `useEffect(() => algo(), [...])` devolve o resultado de algo() — e se for uma Promise
 * (ex.: scrollIntoView() no Chrome novo), o React tenta chamá-la como limpeza e a tela quebra
 * ("l is not a function").
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}

test('Nenhum useEffect devolve valor sem querer (corpo sempre entre chaves)', () => {
  const bad: string[] = [];
  for (const f of files('src')) {
    readFileSync(f, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/use(Layout)?Effect\(\s*(async\s*)?\(\)\s*=>\s*[^{\s]/.test(line) || /use(Layout)?Effect\(\s*async/.test(line)) bad.push(`${f}:${i + 1}`);
      });
  }
  assert.deepEqual(bad, []);
});
