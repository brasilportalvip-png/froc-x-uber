/**
 * SISTEMA FROC — toca as falas da Froc no app.
 * 1) Pede ao servidor o áudio na voz neural da Froc (masculina, a mesma do Froc IA).
 * 2) Sem voz neural (desligada, sem internet): voz masculina em português do próprio aparelho.
 * As falas tocam uma de cada vez, nunca por cima uma da outra. A pessoa liga/desliga no app.
 */
import { FALAS, escolherIncentivos, escolherVariante, montarFala } from '../data/frocVoz.ts';
import type { DadosFala, EscolhaFala, SituacaoFroc } from '../data/frocVoz.ts';
import { apiAudio } from './session.ts';

const LIGADA = 'froc-voz';
const RECENTES = 'froc-voz-recentes';

export function vozLigada(): boolean {
  try {
    return localStorage.getItem(LIGADA) !== 'off';
  } catch {
    return true;
  }
}

export function setVozLigada(on: boolean) {
  try {
    localStorage.setItem(LIGADA, on ? 'on' : 'off');
  } catch {
    /* sem armazenamento */
  }
  if (!on) pararVoz();
}

function recentes(): Record<string, number[]> {
  try {
    return JSON.parse(localStorage.getItem(RECENTES) || '{}') as Record<string, number[]>;
  } catch {
    return {};
  }
}

function lembrar(situacao: string, variante: number) {
  try {
    const r = recentes();
    r[situacao] = [...(r[situacao] || []), variante].slice(-4);
    localStorage.setItem(RECENTES, JSON.stringify(r));
  } catch {
    /* sem armazenamento */
  }
}

/** Mesma escolha do Froc IA: voz masculina em português; senão, qualquer pt-BR. */
export function vozMasculinaDoAparelho(voices: SpeechSynthesisVoice[]) {
  const pt = voices.filter((v) => /^pt(?:-|_)/i.test(v.lang));
  return pt.find((v) => /\b(male|masculin|daniel|felipe|ricardo|tiago|antonio|paulo|carlos)\b/i.test(v.name)) || pt.find((v) => /pt-BR/i.test(v.lang)) || pt[0];
}

let fila: Promise<void> = Promise.resolve();
let tocando: HTMLAudioElement | null = null;

export function pararVoz() {
  try {
    tocando?.pause();
    window.speechSynthesis?.cancel();
  } catch {
    /* nada tocando */
  }
}

function tocarAudio(url: string) {
  return new Promise<void>((resolve) => {
    const a = new Audio(url);
    tocando = a;
    const fim = () => {
      clearTimeout(limite);
      URL.revokeObjectURL(url);
      if (tocando === a) tocando = null;
      resolve();
    };
    const limite = setTimeout(fim, 25_000);
    a.onended = fim;
    a.onerror = fim;
    a.play().catch(fim);
  });
}

function falarNoAparelho(texto: string) {
  return new Promise<void>((resolve) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || !texto) return resolve();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'pt-BR';
    u.rate = 1;
    u.pitch = 0.85; // um pouco mais grave: mais perto da voz da Froc
    const voz = vozMasculinaDoAparelho(synth.getVoices());
    if (voz) u.voice = voz;
    const limite = setTimeout(resolve, 20_000);
    u.onend = () => (clearTimeout(limite), resolve());
    u.onerror = () => (clearTimeout(limite), resolve());
    synth.speak(u);
  });
}

async function tocar(situacao: SituacaoFroc, escolha: EscolhaFala, dados: DadosFala) {
  try {
    const { nome: _nome, ...semNome } = dados; // o servidor usa o nome do cadastro
    const url = await apiAudio('/api/voz', { situacao, ...escolha, dados: semNome });
    await tocarAudio(url);
  } catch {
    await falarNoAparelho(montarFala(situacao, escolha, dados));
  }
}

/** A Froc fala. Escolhe uma versão diferente das últimas para não repetir. */
export function falar(situacao: SituacaoFroc, dados: DadosFala = {}) {
  if (!vozLigada() || !FALAS[situacao]) return;
  const variante = escolherVariante(FALAS[situacao].length, recentes()[situacao] || []);
  lembrar(situacao, variante);
  const escolha: EscolhaFala = { variante, ...(situacao === 'corrida_encerrada' ? { incentivos: escolherIncentivos() } : {}) };
  fila = fila.then(() => tocar(situacao, escolha, dados)).catch(() => undefined);
}
