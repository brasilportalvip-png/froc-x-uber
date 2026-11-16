/**
 * Identidade: CPF do passageiro (e de todos), conferência na Receita e "uma pessoa, uma conta".
 *
 * - CPF válido (dígitos verificadores) e de maior de 18 anos.
 * - Conferência na Receita Federal pelo Serpro (API Consulta CPF): CPF + data de nascimento
 *   precisam existir, a situação precisa ser "Regular" e o nome precisa bater. Sem o Serpro
 *   contratado, o CPF fica "conferido básico" e a equipe confere manualmente no Admin.
 * - Uma pessoa = uma conta: o CPF é a chave. Trocar de celular, de e-mail ou de chip não
 *   adianta; CPF de conta bloqueada não abre conta nova.
 */
import { createHash } from 'node:crypto';

export type CpfStatus = 'none' | 'basic' | 'verified' | 'rejected';

export function onlyDigits(v: unknown) {
  return String(v ?? '').replace(/\D/g, '');
}

/** Confere os dígitos verificadores do CPF. */
export function isValidCpf(value: unknown): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

export const formatCpf = (d: string) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
/** Mostra só o meio: ***.456.789-** (o que aparece no app). */
export const maskCpf = (d: string) => `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
/** Chave do índice "um CPF, uma conta" (o número não fica no nome do documento). */
export const cpfKey = (d: string) => createHash('sha256').update(`froc-cpf:${d}`).digest('hex');
/** E-mail mascarado para ajudar a pessoa a lembrar qual conta já tem: j***@g***.com */
export function maskEmail(email: string) {
  const [user, domain = ''] = email.split('@');
  const [host, ...rest] = domain.split('.');
  return `${user.slice(0, 1)}***@${host.slice(0, 1)}***${rest.length ? '.' + rest.join('.') : ''}`;
}

export function ageOn(birth: string, today: Date) {
  const [y, m, d] = birth.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  const md = (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
  if (md < m * 100 + d) age--;
  return age;
}

const normName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !['de', 'da', 'do', 'das', 'dos', 'e'].includes(t));

/**
 * O nome digitado bate com o da Receita? Primeiro nome igual e ao menos metade dos
 * sobrenomes digitados presentes no nome oficial (aceita abreviar ou omitir sobrenomes).
 */
export function namesMatch(declared: string, official: string) {
  const a = normName(declared);
  const b = normName(official);
  if (!a.length || !b.length || a[0] !== b[0]) return false;
  const rest = a.slice(1);
  if (!rest.length) return b.length === 1;
  const hits = rest.filter((t) => b.includes(t)).length;
  return hits >= Math.ceil(rest.length / 2);
}

// --------------------------------------------------------------- Serpro

export interface CpfLookup {
  found: boolean;
  name?: string;
  socialName?: string;
  /** true quando a situação cadastral é "Regular". */
  regular?: boolean;
  situation?: string;
}

/** Conferência na Receita. Devolve null quando o serviço está fora do ar (aí fica "básico"). */
export type CpfVerifier = (cpf: string, birthDate: string) => Promise<CpfLookup | null>;

/**
 * Serpro · Consulta CPF (contratação em loja.serpro.gov.br). Variáveis:
 *  SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET (obrigatórias para ligar),
 *  SERPRO_TOKEN_URL (padrão https://gateway.apiserpro.serpro.gov.br/token) e
 *  SERPRO_CPF_URL com {cpf} e {nascimento} (AAAA-MM-DD) — confira no menu "Demonstração" do Serpro.
 */
export function createSerproVerifier(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): CpfVerifier | undefined {
  const key = env.SERPRO_CONSUMER_KEY;
  const secret = env.SERPRO_CONSUMER_SECRET;
  if (!key || !secret) return undefined;
  const tokenUrl = env.SERPRO_TOKEN_URL || 'https://gateway.apiserpro.serpro.gov.br/token';
  const cpfUrl = env.SERPRO_CPF_URL || 'https://apicpf.estaleiro.serpro.gov.br/api/v3/cpf/{cpf}?dataNascimento={nascimento}';
  let token: { value: string; until: number } | null = null;

  const timed = async (url: string, init: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const getToken = async () => {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const res = await timed(tokenUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`token ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    token = { value: json.access_token, until: Date.now() + (json.expires_in || 3600) * 1000 };
    return token.value;
  };

  return async (cpf, birthDate) => {
    try {
      const url = cpfUrl.replace('{cpf}', cpf).replace('{nascimento}', birthDate).replace('{nascimentoBR}', birthDate.split('-').reverse().join(''));
      let res = await timed(url, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } });
      if (res.status === 401) {
        token = null;
        res = await timed(url, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } });
      }
      if (res.status === 404 || res.status === 400) return { found: false };
      if (!res.ok) return null;
      const j = (await res.json()) as Record<string, unknown>;
      const situacao = (j.situacao || {}) as Record<string, unknown>;
      const desc = String(situacao.descricao ?? j.situacao_cpf ?? j.situacaoCadastral ?? '');
      const code = String(situacao.codigo ?? '');
      // Versões antigas devolvem nascimento DDMMAAAA: confere se bate com o informado.
      const nasc = String(j.nascimento ?? j.dataNascimento ?? j.data_nascimento ?? '');
      if (/^\d{8}$/.test(nasc) && `${nasc.slice(4)}-${nasc.slice(2, 4)}-${nasc.slice(0, 2)}` !== birthDate) return { found: false };
      return {
        found: true,
        name: String(j.nome ?? j.name ?? ''),
        socialName: String(j.nomeSocial ?? j.nome_social ?? '') || undefined,
        regular: code === '0' || /regular/i.test(desc),
        situation: desc || code,
      };
    } catch (e) {
      console.warn('Consulta CPF (Serpro) indisponível:', String((e as Error)?.message || e));
      return null;
    }
  };
}
