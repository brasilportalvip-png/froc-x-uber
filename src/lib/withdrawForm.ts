/**
 * Confere o pedido de Pix ANTES de enviar e devolve um motivo legível.
 * Antes, o navegador barrava o envio em silêncio (campo com mínimo R$ 20 e máximo = ganhos,
 * botão apagado com ganhos abaixo de R$ 20) e o motorista "preenchia e não confirmava".
 */
import { pixKeyKind } from './pixKey.ts';

/** Mesmo mínimo do servidor (MIN_WITHDRAWAL_CENTS em server/services.ts). */
export const MIN_WITHDRAWAL_REAIS = 20;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Aceita "20", "20,50", "20.50", "R$ 1.234,56" e "1234.56". Devolve NaN se não for valor. */
export function parseReais(input: string): number {
  let s = String(input ?? '').replace(/[R$\s]/gi, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Number(s);
}

/** Motivo para o botão não poder ser usado agora (ou '' se pode). */
export function withdrawBlockedReason(withdrawable: number): string {
  if (withdrawable >= MIN_WITHDRAWAL_REAIS) return '';
  if (withdrawable <= 0) return `Você ainda não tem ganhos para transferir. O Pix fica liberado a partir de ${brl(MIN_WITHDRAWAL_REAIS)} em ganhos de corridas, entregas, fretes ou caronas.`;
  return `Você tem ${brl(withdrawable)} em ganhos. O Pix mínimo é ${brl(MIN_WITHDRAWAL_REAIS)}: faltam ${brl(Math.round((MIN_WITHDRAWAL_REAIS - withdrawable) * 100) / 100)}.`;
}

export type WithdrawCheck = { ok: true; amount: number } | { ok: false; error: string };

export function checkWithdrawal(amountText: string, withdrawable: number, pixKey: string): WithdrawCheck {
  const blocked = withdrawBlockedReason(withdrawable);
  if (blocked) return { ok: false, error: blocked };
  const amount = parseReais(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Digite o valor do Pix (ex.: 20 ou 20,50).' };
  if (amount < MIN_WITHDRAWAL_REAIS) return { ok: false, error: `O Pix mínimo é ${brl(MIN_WITHDRAWAL_REAIS)}.` };
  if (amount > withdrawable + 1e-9) return { ok: false, error: `Você pode transferir até ${brl(withdrawable)} (seus ganhos). Toque em "Tudo".` };
  if (!String(pixKey ?? '').trim()) return { ok: false, error: 'Digite a chave Pix de destino.' };
  if (!pixKeyKind(pixKey)) return { ok: false, error: 'Chave Pix inválida. Use CPF, CNPJ, e-mail, celular com DDD ou chave aleatória.' };
  return { ok: true, amount };
}
