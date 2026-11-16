/**
 * Imagens de capa do blog geradas pelo Gemini (a mesma chave da Froc.IA), com anti-queda:
 * tenta vários modelos de imagem e as chaves reservas; se nada responder, o blog usa a capa
 * da marca (desenhada pelo próprio servidor) — o post nunca fica sem imagem.
 */

export const IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image-preview'];

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: string;
  model: string;
}

export interface ImageClient {
  configured: boolean;
  generate(prompt: string): Promise<GeneratedImage>;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export function createGeminiImages(options: { apiKeys: string[]; model?: string; fetchImpl?: FetchLike; timeoutMs?: number }): ImageClient {
  const keys = options.apiKeys.filter(Boolean);
  const models = [...new Set([options.model, ...IMAGE_MODELS].filter(Boolean) as string[])];
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init) as never);
  const timeoutMs = options.timeoutMs ?? 25_000;
  return {
    configured: keys.length > 0,
    async generate(prompt) {
      const errors: string[] = [];
      for (const model of models) {
        for (const key of keys) {
          let res;
          try {
            res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
              }),
              signal: AbortSignal.timeout(timeoutMs),
            });
          } catch (e) {
            errors.push(`${model}: rede ${(e as Error).message}`);
            continue;
          }
          if (!res.ok) {
            const detail = (await res.text().catch(() => '')).slice(0, 160);
            errors.push(`${model}: ${res.status} ${detail}`);
            // Modelo inexistente: não adianta tentar com outra chave.
            if (res.status === 404) break;
            continue;
          }
          const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
          const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
          if (part?.inlineData?.data) {
            return { bytes: Buffer.from(part.inlineData.data, 'base64'), mimeType: part.inlineData.mimeType || 'image/png', model };
          }
          errors.push(`${model}: sem imagem na resposta`);
        }
      }
      throw new Error(`Nenhum modelo de imagem respondeu (${errors.slice(-3).join(' | ')})`);
    },
  };
}

/** Pedido de imagem: foto realista do assunto, sem texto, sem marcas e sem pessoas reconhecíveis. */
export function coverPrompt(topic: string, keyword: string) {
  return [
    `Fotografia realista, horizontal 16:9, para capa de um artigo de blog sobre "${keyword || topic}" no Brasil.`,
    `Assunto: ${topic}.`,
    'Cena brasileira autêntica (ruas, estradas, veículos ou cidade, conforme o assunto), luz natural bonita, composição limpa, aparência profissional de revista.',
    'Toques sutis de rosa pink e dourado na luz ou em detalhes, sem exagero.',
    'PROIBIDO: qualquer texto, letras, números, placas legíveis, logotipos, marcas reais, uniformes de empresas, rostos reconhecíveis de pessoas reais.',
  ].join(' ');
}
