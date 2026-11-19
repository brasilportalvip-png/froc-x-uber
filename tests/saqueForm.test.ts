/**
 * Tela de Pix do motorista (teste real de 18/11/2026: "preenche os dados e não confirma").
 * O navegador barrava em silêncio; agora cada caso tem um motivo escrito.
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_WITHDRAWAL_REAIS, checkWithdrawal, parseReais, withdrawBlockedReason } from '../src/lib/withdrawForm.ts';
import { MIN_WITHDRAWAL_CENTS } from '../server/services.ts';

const erro = (r: ReturnType<typeof checkWithdrawal>) => (r.ok ? '' : r.error);

describe('valor digitado no Pix', () => {
  test('aceita vírgula, ponto e R$', () => {
    assert.equal(parseReais('20'), 20);
    assert.equal(parseReais('20,50'), 20.5);
    assert.equal(parseReais('20.50'), 20.5);
    assert.equal(parseReais('R$ 1.234,56'), 1234.56);
    assert.equal(parseReais('1.234'), 1234);
    assert.equal(parseReais(' 35,9 '), 35.9);
  });

  test('recusa o que não é valor', () => {
    for (const v of ['', 'abc', '20,555', '-20', '20,5,0']) assert.ok(Number.isNaN(parseReais(v)), v);
  });

  test('mínimo da tela é o mesmo do servidor', () => {
    assert.equal(MIN_WITHDRAWAL_REAIS * 100, MIN_WITHDRAWAL_CENTS);
  });
});

describe('motivo de não confirmar o Pix', () => {
  test('ganhos abaixo de R$ 20: explica quanto falta (antes o botão só ficava apagado)', () => {
    assert.match(withdrawBlockedReason(12.4), /R\$\s?12,40/);
    assert.match(withdrawBlockedReason(12.4), /faltam R\$\s?7,60/);
    assert.match(erro(checkWithdrawal('12,40', 12.4, 'tio@gmail.com')), /mínimo/);
  });

  test('sem ganhos: diz que o Pix é só de ganhos', () => {
    assert.match(withdrawBlockedReason(0), /ainda não tem ganhos/);
  });

  test('com ganhos suficientes, nada bloqueia', () => {
    assert.equal(withdrawBlockedReason(20), '');
    assert.equal(withdrawBlockedReason(87.3), '');
  });

  test('cada erro de preenchimento tem mensagem', () => {
    assert.match(erro(checkWithdrawal('', 50, 'tio@gmail.com')), /Digite o valor/);
    assert.match(erro(checkWithdrawal('15', 50, 'tio@gmail.com')), /mínimo/);
    assert.match(erro(checkWithdrawal('60', 50, 'tio@gmail.com')), /até R\$\s?50,00/);
    assert.match(erro(checkWithdrawal('30', 50, '')), /chave Pix/);
    assert.match(erro(checkWithdrawal('30', 50, 'tio@gmail')), /Chave Pix inválida/);
  });

  test('pedido certo passa com o valor convertido', () => {
    assert.deepEqual(checkWithdrawal('20,50', 50, 'tio@gmail.com'), { ok: true, amount: 20.5 });
    assert.deepEqual(checkWithdrawal('50,00', 50, '123.456.789-09'), { ok: true, amount: 50 }, '"Tudo" preenche com vírgula');
  });
});
