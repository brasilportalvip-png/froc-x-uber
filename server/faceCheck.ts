/**
 * Fotos e reconhecimento facial (segurança do passageiro):
 *  - todo mundo tem foto de perfil (identificação);
 *  - o motorista faz um reconhecimento facial com a câmera no cadastro (fica salvo como referência,
 *    e é comparado com a foto da CNH);
 *  - motorista online confere o rosto a cada 2 horas: garante que quem dirige é o dono da conta.
 *
 * A IA (Gemini) só OLHA e responde em JSON; quem DECIDE é o código abaixo, com regras fixas.
 * Cabelo, barba, óculos, maquiagem, luz e alguns anos de diferença não contam: a IA é instruída a
 * comparar a estrutura do rosto (olhos, nariz, boca, queixo, orelhas, proporções).
 * Dado biométrico é dado sensível (LGPD): coletado com consentimento, só para segurança.
 */
import type { LlmClient } from './ai/gemini.ts';
import { parseJsonLoose } from './ai/gemini.ts';

export interface Img {
  bytes: Uint8Array;
  mimeType: string;
}

export type FaceVerdict = 'mesma_pessoa' | 'outra_pessoa' | 'inconclusivo' | 'sem_rosto';

export interface PhotoReview {
  /** Exatamente um rosto humano, de frente e visível. */
  umRosto: boolean;
  /** Foto real de pessoa (não desenho, boneco, foto de tela/impressa, máscara). */
  fotoReal: boolean;
  nitida: boolean;
  motivo: string;
}

export interface FaceComparison {
  verdict: FaceVerdict;
  /** 0 a 1. */
  confianca: number;
  observacoes: string;
}

export interface FaceChecker {
  configured: boolean;
  reviewPhoto(img: Img): Promise<PhotoReview>;
  compare(reference: Img[], candidate: Img): Promise<FaceComparison>;
}

/** Intervalo da conferência de rosto do motorista online. */
export const FACE_CHECK_EVERY_MS = 2 * 3600_000;
/** Selfies inconclusivas seguidas antes de mandar para a equipe conferir. */
export const FACE_MAX_RETRIES = 3;
const MATCH_MIN = 0.7;
const MISMATCH_MIN = 0.6;

/** Foto de perfil aceita? (texto curto para a pessoa, ou '' se aceita) */
export function photoProblem(r: PhotoReview): string {
  if (!r.umRosto) return 'A foto precisa mostrar o seu rosto, de frente, sozinho na imagem.';
  if (!r.fotoReal) return 'Use uma foto sua de verdade (não vale desenho, foto de tela ou de outra foto).';
  if (!r.nitida) return 'A foto ficou escura ou tremida. Tire outra num lugar iluminado.';
  return '';
}

export type FaceDecision =
  | { result: 'aprovado' }
  | { result: 'repetir'; message: string }
  | { result: 'bloqueado'; message: string }
  | { result: 'revisao'; message: string };

/**
 * Regra da conferência a cada 2h:
 *  - mesma pessoa com confiança ≥ 0,7 → liberado;
 *  - outra pessoa com confiança ≥ 0,6 → offline na hora, equipe confere;
 *  - sem rosto / inconclusivo → tirar de novo; na 3ª seguida → offline e equipe confere.
 */
export function decideFaceCheck(c: FaceComparison, previousFails: number): FaceDecision {
  if (c.verdict === 'mesma_pessoa' && c.confianca >= MATCH_MIN) return { result: 'aprovado' };
  if (c.verdict === 'outra_pessoa' && c.confianca >= MISMATCH_MIN)
    return { result: 'bloqueado', message: 'O rosto não confere com o seu cadastro. Por segurança, você ficou offline e a equipe Froc vai conferir. Fale com o Atendimento.' };
  if (previousFails + 1 >= FACE_MAX_RETRIES)
    return { result: 'revisao', message: 'Não conseguimos confirmar o seu rosto. Você ficou offline e a equipe Froc vai conferir as fotos em instantes.' };
  return {
    result: 'repetir',
    message:
      c.verdict === 'sem_rosto'
        ? 'Não encontramos o seu rosto na foto. Olhe para a câmera, num lugar iluminado, sem boné ou óculos escuros.'
        : 'A foto não ficou clara o suficiente. Tire outra de frente, num lugar iluminado.',
  };
}

const REVIEW_PROMPT = `Você confere FOTOS DE PERFIL de um app de transporte (segurança dos passageiros).
Responda SÓ JSON: {"umRosto": boolean, "fotoReal": boolean, "nitida": boolean, "motivo": "texto curto"}
- umRosto: true se há EXATAMENTE um rosto humano, de frente ou quase, visível (olhos, nariz e boca aparecem).
- fotoReal: false se for desenho, avatar, boneco, foto de uma tela/monitor, foto de outra foto impressa, máscara ou montagem.
- nitida: false se estiver muito escura, tremida ou cortada a ponto de não reconhecer a pessoa.
Não identifique quem é a pessoa e não comente aparência.`;

const COMPARE_PROMPT = `Você confere se a ÚLTIMA imagem é da MESMA PESSOA das imagens de referência (segurança de um app de transporte: o motorista ao volante deve ser o dono da conta).
Compare a ESTRUTURA DO ROSTO: formato dos olhos e sobrancelhas, nariz, boca, queixo, orelhas, maçãs do rosto e proporções.
IGNORE: cabelo (corte, cor, comprimento), barba e bigode (crescidos ou feitos), óculos, boné, maquiagem, luz, ângulo, qualidade da câmera e alguns anos de diferença de idade. Cabelo e barba crescem: isso NUNCA é motivo para dizer que é outra pessoa.
Responda SÓ JSON: {"verdict": "mesma_pessoa" | "outra_pessoa" | "inconclusivo" | "sem_rosto", "confianca": número de 0 a 1, "observacoes": "texto curto, sem descrever a aparência"}
- "sem_rosto": a última imagem não mostra um rosto visível.
- "inconclusivo": imagem ruim ou ângulo que não permite decidir.
- Só diga "outra_pessoa" quando a estrutura do rosto for claramente diferente.`;

const part = (i: Img) => ({ inlineData: { mimeType: i.mimeType, data: Buffer.from(i.bytes).toString('base64') } });

export function createGeminiFaces(llm: LlmClient): FaceChecker {
  return {
    get configured() {
      return llm.configured;
    },
    async reviewPhoto(img) {
      const out = await llm.generate({
        system: REVIEW_PROMPT,
        contents: [{ role: 'user', parts: [part(img), { text: 'Confira esta foto de perfil.' }] }],
        json: true,
        temperature: 0,
        maxOutputTokens: 200,
        deadlineMs: 25_000,
      });
      const j = parseJsonLoose<Partial<PhotoReview>>(out.text);
      return { umRosto: j.umRosto === true, fotoReal: j.fotoReal !== false, nitida: j.nitida !== false, motivo: String(j.motivo || '').slice(0, 160) };
    },
    async compare(reference, candidate) {
      const out = await llm.generate({
        system: COMPARE_PROMPT,
        contents: [
          {
            role: 'user',
            parts: [
              ...reference.flatMap((r, i) => [{ text: `Referência ${i + 1}:` }, part(r)]),
              { text: 'Imagem para conferir (a última):' },
              part(candidate),
            ],
          },
        ],
        json: true,
        temperature: 0,
        maxOutputTokens: 200,
        deadlineMs: 30_000,
      });
      const j = parseJsonLoose<Partial<FaceComparison> & { verdict?: string }>(out.text);
      const verdict = (['mesma_pessoa', 'outra_pessoa', 'inconclusivo', 'sem_rosto'] as const).find((v) => v === j.verdict) ?? 'inconclusivo';
      const conf = Number(j.confianca);
      return { verdict, confianca: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0, observacoes: String(j.observacoes || '').slice(0, 200) };
    },
  };
}
