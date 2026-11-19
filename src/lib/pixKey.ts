/**
 * Chave Pix: reconhece o tipo e deixa no formato que o banco aceita.
 * Usado no app (escolhe o tipo sozinho enquanto a pessoa digita) e no servidor (valida o saque).
 */
export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

export const PIX_KEY_LABELS: Record<PixKeyType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  telefone: 'Celular',
  aleatoria: 'Aleatória',
};

/** Descobre o tipo da chave Pix (ou '' se não parece uma chave válida). */
export function pixKeyKind(key: string): PixKeyType | '' {
  const k = String(key ?? '').trim();
  const digits = k.replace(/\D/g, '');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return 'email';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return 'aleatoria';
  if (/^\+?55/.test(k.replace(/[\s()-]/g, '')) && (digits.length === 12 || digits.length === 13)) return 'telefone';
  if (digits.length === 14 && /^[\d./-]+$/.test(k)) return 'cnpj';
  if (digits.length === 11 && /^[\d.-]+$/.test(k)) return 'cpf';
  if ((digits.length === 10 || digits.length === 11) && /^[\d\s()+-]+$/.test(k)) return 'telefone';
  return '';
}

/** 11 números (sem +55) pode ser CPF ou celular: aí vale o tipo que a pessoa escolheu. */
export function isAmbiguousPixKey(key: string): boolean {
  const k = String(key ?? '').trim();
  return /^[\d\s().+-]+$/.test(k) && !/^\+/.test(k) && k.replace(/\D/g, '').length === 11;
}

/**
 * Tipo final da chave. A chave digitada manda: se a pessoa deixou "CPF" marcado e digitou
 * um e-mail, o tipo vira "email" (antes o saque era recusado com "tipo não combina").
 */
export function resolvePixKeyType(key: string, chosen?: string): PixKeyType | '' {
  const detected = pixKeyKind(key);
  if (!detected) return '';
  if (isAmbiguousPixKey(key) && (chosen === 'cpf' || chosen === 'telefone')) return chosen;
  return detected;
}

/** Formato do banco: e-mail minúsculo, CPF/CNPJ só números, celular +55DDDNÚMERO, aleatória minúscula. */
export function normalizePixKey(key: string, type: PixKeyType): string {
  const k = String(key ?? '').trim();
  const digits = k.replace(/\D/g, '');
  switch (type) {
    case 'email':
    case 'aleatoria':
      return k.toLowerCase();
    case 'cpf':
    case 'cnpj':
      return digits;
    case 'telefone':
      return '+' + (digits.length >= 12 && digits.startsWith('55') ? digits : '55' + digits);
  }
}
