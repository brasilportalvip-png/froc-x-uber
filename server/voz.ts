/**
 * SISTEMA FROC — voz neural da marca (a mesma do Froc IA: Gemini TTS, voz "Charon", masculina,
 * calorosa e amigável). Cada frase é gerada UMA vez e guardada no Storage: depois toca sem custo.
 * Sem chave do Gemini, ou com FROC_VOZ_NEURAL=nao, o app usa a voz masculina do aparelho.
 */
import { createHash } from 'node:crypto';
import { VOZ_FROC } from '../src/data/frocVoz.ts';
import type { FileStorage } from './services.ts';

const DEFAULT_MODEL = 'gemini-3.1-flash-tts-preview';
const MAX_CHARS = 600;

export interface FrocVoice {
  configured: boolean;
  audio(text: string): Promise<{ bytes: Uint8Array; contentType: string; cached: boolean }>;
}

/** Mesma direção de voz do Froc IA (frocia2). */
export function promptDeFala(text: string) {
  const fala = String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<\/?fala>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
  if (!fala) throw new Error('speech_text_empty');
  return ['Leia exatamente o conteúdo delimitado ao final, sem alterar a fala.', ...VOZ_FROC.direcao, `<fala>${fala}</fala>`].join('\n');
}

/** PCM 16 bits → WAV (o navegador toca WAV direto). */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  const header = Buffer.alloc(44);
  const blockAlign = channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}

type Synth = (prompt: string, model: string, voice: string) => Promise<{ data: string; mimeType: string; sampleRate?: number; channels?: number }>;

/** Chamada ao Gemini TTS igual à do Froc IA (interactions.create com saída em áudio). */
function geminiSynth(apiKey: string): Synth {
  return async (prompt, model, voice) => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey }) as unknown as {
      interactions: { create(input: unknown): Promise<{ output_audio?: { data?: string; mime_type?: string; sample_rate?: number; channels?: number } }> };
    };
    const out = await ai.interactions.create({
      model,
      input: prompt,
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice, language: VOZ_FROC.idioma }] },
    });
    const a = out.output_audio;
    if (!a?.data) throw new Error('gemini_tts_empty_audio');
    return { data: a.data, mimeType: a.mime_type || 'audio/l16', sampleRate: a.sample_rate, channels: a.channels };
  };
}

export function createFrocVoice(opts: { apiKey?: string; model?: string; voice?: string; files?: FileStorage; enabled?: boolean; synth?: Synth }): FrocVoice {
  const model = opts.model?.trim() || DEFAULT_MODEL;
  const voice = opts.voice?.trim() || VOZ_FROC.voz;
  const synth = opts.synth ?? (opts.apiKey ? geminiSynth(opts.apiKey) : null);
  const memory = new Map<string, Uint8Array>();
  return {
    configured: Boolean(opts.enabled !== false && synth),
    async audio(text) {
      if (opts.enabled === false || !synth) throw new Error('voz_desligada');
      const prompt = promptDeFala(text);
      const key = createHash('sha256').update(`${model}|${voice}|${prompt}`).digest('hex').slice(0, 40);
      const hit = memory.get(key);
      if (hit) return { bytes: hit, contentType: 'audio/wav', cached: true };
      const path = `froc-x-uber/voz/${key}.wav`;
      const stored = opts.files?.read ? await opts.files.read(path).catch(() => null) : null;
      if (stored?.bytes?.length) {
        memory.set(key, stored.bytes);
        return { bytes: stored.bytes, contentType: 'audio/wav', cached: true };
      }
      const r = await synth(prompt, model, voice);
      const raw = new Uint8Array(Buffer.from(r.data, 'base64'));
      const bytes = /(?:l16|pcm)/i.test(r.mimeType) ? pcm16ToWav(raw, r.sampleRate || 24000, r.channels || 1) : raw;
      const contentType = /(?:l16|pcm)/i.test(r.mimeType) ? 'audio/wav' : r.mimeType;
      if (opts.files) await opts.files.save(path, contentType, bytes).catch((e) => console.warn('Voz Froc: não guardou o áudio:', e?.message));
      if (memory.size > 300) memory.clear();
      memory.set(key, bytes);
      return { bytes, contentType, cached: false };
    },
  };
}
