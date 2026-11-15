/**
 * Cliente do Google Gemini (a mesma IA da Froc.IA), direto pela API REST, sem bibliotecas.
 * Suporta chamada de ferramentas (function calling) e resposta em JSON.
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
}

export interface GenerateOutput {
  /** Conteúdo do modelo como veio (deve ser devolvido assim no histórico). */
  content: GeminiContent;
  text: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
  model: string;
}

export interface LlmClient {
  configured: boolean;
  generate(input: GenerateInput): Promise<GenerateOutput>;
}

/** Modelos tentados em ordem (os mesmos da Froc.IA). GEMINI_MODEL, se definido, vem primeiro. */
export const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export function createGemini(options: { apiKey?: string; model?: string; fetchImpl?: FetchLike; timeoutMs?: number }): LlmClient {
  const apiKey = options.apiKey || '';
  const models = [...new Set([options.model, ...DEFAULT_MODELS].filter(Boolean) as string[])];
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 45_000;
  let workingModel: string | null = null;

  return {
    configured: Boolean(apiKey),
    async generate(input) {
      if (!apiKey) throw new Error('GEMINI_API_KEY não configurada.');
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
      const order = workingModel ? [workingModel, ...models.filter((m) => m !== workingModel)] : models;
      let lastError = '';
      for (const model of order) {
        const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 300);
          lastError = `${model}: ${res.status} ${detail}`;
          // Modelo inexistente/indisponível para esta chave: tenta o próximo.
          if (res.status === 404 || (res.status === 400 && /model/i.test(detail)) || res.status === 503 || res.status === 429) continue;
          throw new Error(`Gemini recusou (${lastError})`);
        }
        const data = (await res.json()) as {
          candidates?: { content?: GeminiContent; finishReason?: string }[];
          promptFeedback?: { blockReason?: string };
        };
        const content: GeminiContent = data.candidates?.[0]?.content ?? { role: 'model', parts: [] };
        if (!content.role) content.role = 'model';
        content.parts ??= [];
        workingModel = model;
        return {
          content,
          model,
          text: content.parts
            .filter((p) => p.text && !p.thought)
            .map((p) => p.text)
            .join('')
            .trim(),
          functionCalls: content.parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args || {} })),
        };
      }
      throw new Error(`Nenhum modelo do Gemini respondeu (${lastError})`);
    },
  };
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
