/**
 * Modo Passageiro / Motorista e mapa sem endereço fixo (pedido de 19/11/2026).
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialRole, loadRole, modeOf, roleForMode, saveRole } from '../src/lib/appMode.ts';
import { choosePoint, isPlaceMissing, locatingPoint, needLocationPoint, startPointFrom, unsetDestination } from '../src/lib/currentLocation.ts';
import type { GeoPoint } from '../src/types/mobility.ts';

const memoria = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('modo do app', () => {
  test('Passageiro e Motorista (transportador conta como motorista)', () => {
    assert.equal(modeOf('passenger'), 'passenger');
    assert.equal(modeOf('driver'), 'driver');
    assert.equal(modeOf('trucker'), 'driver');
  });

  test('tocar em Motorista na aba Cargas abre como transportador; em Corridas, motorista', () => {
    assert.equal(roleForMode('driver', 'rides', 'passenger'), 'driver');
    assert.equal(roleForMode('driver', 'carpool', 'passenger'), 'driver');
    assert.equal(roleForMode('driver', 'freight', 'passenger'), 'trucker');
    assert.equal(roleForMode('passenger', 'freight', 'trucker'), 'passenger');
  });

  test('o modo escolhido fica salvo no aparelho', () => {
    const s = memoria();
    assert.equal(loadRole(s), null);
    saveRole('driver', s);
    assert.equal(loadRole(s), 'driver');
    s.setItem('froc-mode', 'hacker');
    assert.equal(loadRole(s), null, 'valor estranho é ignorado');
    assert.equal(loadRole(null), null, 'sem armazenamento (modo privado) não quebra');
  });

  test('sem modo salvo: motorista aprovado abre como motorista', () => {
    assert.equal(initialRole(null, { driverStatus: 'approved' }), 'driver');
    assert.equal(initialRole(null, { truckerStatus: 'approved' }), 'trucker');
    assert.equal(initialRole(null, { driverStatus: 'pending' }), 'passenger');
    assert.equal(initialRole('passenger', { driverStatus: 'approved' }), 'passenger', 'a escolha da pessoa vale mais');
  });
});

describe('mapa e formulários sem endereço fixo', () => {
  const aqui: GeoPoint = { id: 'gps-1', name: 'Rua 9 de Julho, 100', city: 'Araraquara', state: 'SP', zone: 'urban', lat: -21.79, lng: -48.17, kind: 'avenue' };

  test('formulário começa onde a pessoa está', () => {
    assert.equal(startPointFrom(aqui), aqui);
  });

  test('sem localização ainda: pede para escolher (nunca uma cidade de exemplo)', () => {
    for (const p of [locatingPoint(), needLocationPoint(), unsetDestination(aqui), null, undefined]) {
      const start = startPointFrom(p as GeoPoint);
      assert.ok(isPlaceMissing(start));
      assert.equal(start.city, '');
    }
    assert.ok(isPlaceMissing(choosePoint()));
    assert.ok(!isPlaceMissing(aqui));
  });

  test('nenhuma tela começa com São Paulo → Rio ou outra cidade fixa', () => {
    const arquivos = ['src/App.tsx', 'src/components/BlaBlaCarPanel.tsx', 'src/components/TruckFreightPanel.tsx'];
    for (const f of arquivos) {
      const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
      for (const fixo of ["'sp-tiete'", "'br-rio'", "'br-curitiba'", "'br-santos'", "'sp-pinheiros'", "'sp-paulista'"]) {
        assert.ok(!src.includes(fixo), `${f} ainda tem ${fixo} fixo`);
      }
    }
  });
});
