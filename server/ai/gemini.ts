/**
 * Cliente do Google Gemini (a mesma IA da Froc.IA) com SISTEMA ANTI-QUEDA.
 *
 * Como ele se protege:
 *  1. Cascata de modelos: gemini-3.8-flash → 3.7-flash → 3.6-flash → (reservas) 3.5-flash-lite → 2.5-flash.
 *  2. Novas tentativas no mesmo modelo para falhas passageiras (429, 500, 502, 503, 504, rede, tempo
 *     esgotado, resposta vazia), com espera crescente e aleatória e respeitando o "Retry-After".
 *  3. Disjuntor por modelo: depois de falhas seguidas, o modelo fica de lado por um tempo e a IA
 *     segue nos outros; volta sozinho depois.
 *  4. Modelo inexistente para a chave (404) sai da lista por 30 minutos.
 *  5. Várias chaves: GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3. Se uma estourar a cota ou
 *     for recusada, as próximas assumem.
 *  6. Orçamento de tempo: nunca passa do limite do servidor (avisa em vez de travar).
 *  7. Lembra o último modelo que funcionou e começa por ele.
 *  8. Painel de saúde: estado de cada modelo e de cada chave em /api/health e no Admin.
 * Sem bibliotecas: API REST direta. Suporta ferramentas (function calling) e resposta em JSON.
 */

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /** Gemini 3 devolve uma assinatura de raciocínio que precisa voltar igual na próxima chamada. */
  thoughtSignature?: string;
  thought?: boolean;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface GenerateInput {
  system: string;
  contents: GeminiContent[];
  tools?: FunctionDeclaration[];
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  /** Tempo máximo total desta chamada (todas as tentativas). Padrão 50 s. */
  deadlineMs?: number;
}

export interface GenerateOutput {
  /** Conteúdo do modelo como veio (deve ser devolvido assim no histórico). */
  content: GeminiContent;
  text: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
  model: string;
  /** Quantas tentativas foram necessárias (1 = de primeira). */
  attempts?: number;
}

export interface ModelHealth {
  model: string;
  state: 'ok' | 'instavel' | 'desligado' | 'indisponivel';
  consecutiveFailures: number;
  successes: number;
  failures: number;
  lastError?: string;
  lastErrorAt?: string;
  lastSuccessAt?: string;
  retryAfter?: string;
  avgLatencyMs?: number;
}

export interface LlmHealth {
  configured: boolean;
  keys: number;
  keysCooling: number;
  activeModel: string | null;
  models: ModelHealth[];
}

export interface LlmClient {
  configured: boolean;
  generate(input: GenerateInput): Promise<GenerateOutput>;
  health?(): LlmHealth;
}

/** Ordem pedida: 3.8 → 3.7 → 3.6; depois duas reservas de segurança. GEMINI_MODEL, se definido, vem primeiro. */
export const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

export class LlmUnavailableError extends Error {
  code = 'ai_unavailable';
}

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
};
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<FetchResponse>;

export interface GeminiOptions {
  /** Uma chave ou várias (a 1ª é a principal). */
  apiKey?: string | string[];
  model?: string;
  models?: string[];
  fetchImpl?: FetchLike;
  /** Tempo máximo de UMA tentativa. */
  timeoutMs?: number;
  /** Tentativas no mesmo modelo para falhas passageiras (além da 1ª). */
  retriesPerModel?: number;
  /** Falhas seguidas que desligam o modelo temporariamente. */
  breakerThreshold?: number;
  /** Tempo desligado depois de abrir o disjuntor. */
  breakerCooldownMs?: number;
  /** Espera base entre tentativas (cresce 2x a cada vez, com variação aleatória). */
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

type Failure = { kind: 'transient' | 'model_missing' | 'key_problem' | 'fatal'; status: number; message: string; retryAfterMs?: number };

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function classifyFailure(status: number, detail: string): Failure['kind'] {
  if (status === 0) return 'transient'; // rede/tempo esgotado
  if (status === 404) return 'model_missing';
  if (status === 401 || status === 403 || (status === 400 && /api key|API_KEY_INVALID/i.test(detail))) return 'key_problem';
  if (status === 400 && /model|not found|unsupported/i.test(detail)) return 'model_missing';
  if (status === 429 && /quota|exhausted|billing/i.test(detail)) return 'key_problem';
  if (TRANSIENT_STATUS.has(status)) return 'transient';
  return 'fatal';
}

export function parseRetryAfter(value: string | null | undefined, detail = ''): number | undefined {
  if (value) {
    const s = Number(value);
    if (Number.isFinite(s)) return Math.min(30_000, s * 1000);
  }
  const m = /retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec(detail);
  if (m) return Math.min(30_000, Number(m[1]) * 1000);
  return undefined;
}

interface ModelStats {
  consecutive: number;
  successes: number;
  failures: number;
  openUntil: number;
  missingUntil: number;
  lastError?: string;
  lastErrorAt?: number;
  lastSuccessAt?: number;
  latencyTotal: number;
}

export function createGemini(options: GeminiOptions): LlmClient {
  const keys = (Array.isArray(options.apiKey) ? options.apiKey : [options.apiKey]).map((k) => String(k || '').trim()).filter(Boolean);
  const models = [...new Set([options.model, ...(options.models ?? DEFAULT_MODELS)].filter(Boolean) as string[])];
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponse>);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retriesPerModel ?? 2;
  const threshold = options.breakerThreshold ?? 3;
  const cooldown = options.breakerCooldownMs ?? 60_000;
  const base = options.backoffBaseMs ?? 600;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;

  const stats = new Map<string, ModelStats>();
  for (const m of models) stats.set(m, { consecutive: 0, successes: 0, failures: 0, openUntil: 0, missingUntil: 0, latencyTotal: 0 });
  const keyCoolUntil = new Map<string, number>();
  let workingModel: string | null = null;

  const st = (m: string) => stats.get(m)!;
  const recordFailure = (m: string, f: Failure) => {
    const s = st(m);
    s.failures++;
    s.lastError = `${f.status || 'rede'} ${f.message}`.slice(0, 200);
    s.lastErrorAt = now();
    if (f.kind === 'model_missing') {
      s.missingUntil = now() + 30 * 60_000;
      if (workingModel === m) workingModel = null;
      return;
    }
    s.consecutive++;
    if (s.consecutive >= threshold) {
      s.openUntil = now() + cooldown;
      if (workingModel === m) workingModel = null;
    }
  };
  const recordSuccess = (m: string, latency: number) => {
    const s = st(m);
    s.consecutive = 0;
    s.openUntil = 0;
    s.successes++;
    s.latencyTotal += latency;
    s.lastSuccessAt = now();
    workingModel = m;
  };
  const available = (m: string) => st(m).missingUntil <= now() && st(m).openUntil <= now();
  const pickKey = () => keys.find((k) => (keyCoolUntil.get(k) ?? 0) <= now()) ?? null;

  async function attempt(model: string, key: string, body: string, budgetMs: number): Promise<GenerateOutput | Failure> {
    const started = now();
    let res: FetchResponse;
    try {
      res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body,
        signal: AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs, budgetMs))),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { kind: 'transient', status: 0, message: /abort|timeout/i.test(msg) ? 'tempo esgotado' : `rede: ${msg}` };
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 400);
      return { kind: classifyFailure(res.status, detail), status: res.status, message: detail, retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after'), detail) };
    }
    let data: { candidates?: { content?: GeminiContent; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return { kind: 'transient', status: 502, message: 'resposta inválida' };
    }
    if (data.promptFeedback?.blockReason) return { kind: 'fatal', status: 400, message: `bloqueado: ${data.promptFeedback.blockReason}` };
    const cand = data.candidates?.[0];
    const content: GeminiContent = cand?.content ?? { role: 'model', parts: [] };
    if (!content.role) content.role = 'model';
    content.parts ??= [];
    const text = content.parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
    const functionCalls = content.parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args || {} }));
    // Resposta vazia (sem texto e sem ferramenta) conta como falha passageira: tenta de novo / outro modelo.
    if (!text && !functionCalls.length) return { kind: 'transient', status: 502, message: `resposta vazia (${cand?.finishReason || 'sem motivo'})` };
    recordSuccess(model, now() - started);
    return { content, model, text, functionCalls };
  }

  return {
    configured: keys.length > 0,

    async generate(input) {
      if (!keys.length) throw new LlmUnavailableError('GEMINI_API_KEY não configurada.');
      const deadline = now() + (input.deadlineMs ?? 50_000);
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.contents,
        ...(input.tools?.length ? { tools: [{ functionDeclarations: input.tools }] } : {}),
        generationConfig: {
          temperature: input.temperature ?? 0.6,
          maxOutputTokens: input.maxOutputTokens ?? 4096,
          ...(input.json ? { responseMimeType: 'application/json' } : {}),
        },
      });

      // Ordem: o último que funcionou primeiro; depois os disponíveis; por último os desligados
      // pelo disjuntor (se todos estiverem desligados, ainda tenta — melhor do que desistir).
      const ordered = workingModel ? [workingModel, ...models.filter((m) => m !== workingModel)] : [...models];
      const order = [...ordered.filter(available), ...ordered.filter((m) => !available(m) && st(m).missingUntil <= now())];
      const errors: string[] = [];
      let attempts = 0;

      for (const model of order) {
        let tries = 0;
        while (tries <= retries) {
          const remaining = deadline - now();
          if (remaining < 1500) throw new LlmUnavailableError(`Tempo esgotado tentando a IA (${errors.slice(-3).join(' | ') || 'sem resposta'}).`);
          const key = pickKey();
          if (!key) throw new LlmUnavailableError(`Todas as chaves do Gemini estão sem cota ou recusadas agora (${errors.slice(-2).join(' | ')}).`);
          attempts++;
          const out = await attempt(model, key, body, remaining);
          if ('content' in out) return { ...out, attempts };
          errors.push(`${model}: ${out.status || 'rede'} ${out.message.slice(0, 80)}`);
          if (out.kind === 'key_problem') {
            // Cota/chave: esta chave descansa e a próxima chave tenta o MESMO modelo (não conta tentativa).
            keyCoolUntil.set(key, now() + (out.status === 429 ? out.retryAfterMs ?? 60_000 : 10 * 60_000));
            if (!pickKey()) throw new LlmUnavailableError(`Chaves do Gemini sem cota ou recusadas (${out.status}). Confira a cobrança no Google AI Studio.`);
            continue;
          }
          recordFailure(model, out);
          tries++;
          if (out.kind === 'model_missing' || out.kind === 'fatal') break; // próximo modelo
          if (!available(model)) break; // disjuntor abriu: próximo modelo
          if (tries <= retries) {
            const wait = out.retryAfterMs ?? Math.min(8000, base * 2 ** (tries - 1)) * (0.6 + random() * 0.8);
            if (now() + wait > deadline - 1500) break;
            await sleep(wait);
          }
        }
      }
      throw new LlmUnavailableError(`Nenhum modelo do Gemini respondeu (${errors.slice(-4).join(' | ')}).`);
    },

    health() {
      const t = now();
      return {
        configured: keys.length > 0,
        keys: keys.length,
        keysCooling: keys.filter((k) => (keyCoolUntil.get(k) ?? 0) > t).length,
        activeModel: workingModel,
        models: models.map((m) => {
          const s = st(m);
          const state: ModelHealth['state'] = s.missingUntil > t ? 'indisponivel' : s.openUntil > t ? 'desligado' : s.consecutive > 0 ? 'instavel' : 'ok';
          return {
            model: m,
            state,
            consecutiveFailures: s.consecutive,
            successes: s.successes,
            failures: s.failures,
            ...(s.lastError ? { lastError: s.lastError, lastErrorAt: new Date(s.lastErrorAt!).toISOString() } : {}),
            ...(s.lastSuccessAt ? { lastSuccessAt: new Date(s.lastSuccessAt).toISOString() } : {}),
            ...(s.openUntil > t ? { retryAfter: new Date(s.openUntil).toISOString() } : s.missingUntil > t ? { retryAfter: new Date(s.missingUntil).toISOString() } : {}),
            ...(s.successes ? { avgLatencyMs: Math.round(s.latencyTotal / s.successes) } : {}),
          };
        }),
      };
    },
  };
}

/** Chaves do Gemini a partir das variáveis de ambiente (principal + reservas). */
export function geminiKeysFromEnv(env: Record<string, string | undefined>) {
  return [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3].map((k) => String(k || '').trim()).filter(Boolean);
}

/** Tira o JSON de dentro de uma resposta (aceita ```json ... ```). */
export function parseJsonLoose<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error('A IA não devolveu um JSON válido.');
  }
}
