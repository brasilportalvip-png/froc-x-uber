import React, { useEffect, useRef, useState } from 'react';
import { Copy, Link2, Mic, Share2, Square, Video } from 'lucide-react';
import { api } from '../lib/session.ts';
import type { TripRecordingState } from '../types/mobility.ts';
import type { ActiveRecording, RecordingMode } from '../lib/tripRecorder.ts';
import { discardRecording, heldIds, recordingFileName, recordingSupported, saveToDevice, startRecording } from '../lib/tripRecorder.ts';

interface Props {
  kind: 'ride' | 'indrive';
  tripId: string;
  /** Quem está usando: passageiro ou motorista desta viagem. */
  me: 'passenger' | 'driver';
  recording?: TripRecordingState;
  /** Texto curto para a mensagem do link (ex.: "Corrida com Carlos, Onix prata ABC1D23"). */
  shareText: string;
}

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Avisa o resto do app que existe gravação para salvar (o app mostra o aviso de recuperação). */
export const RECORDING_PENDING_EVENT = 'froc:recording-pending';

/**
 * Segurança durante a viagem: compartilhar o link ao vivo com alguém de confiança e gravar
 * áudio ou vídeo pelo próprio celular (o arquivo fica só no aparelho; a outra parte é avisada).
 */
export const TripSafetyBar: React.FC<Props> = ({ kind, tripId, me, recording, shareText }) => {
  const [link, setLink] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [msg, setMsg] = useState('');
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState<{ blob: Blob; name: string; id: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeRef = useRef<ActiveRecording | null>(null);
  const readyRef = useRef<string | null>(null);

  const other = me === 'driver' ? recording?.passenger : recording?.driver;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setElapsed(Date.now() - active.startedAt), 1000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    if (videoRef.current && active?.mode === 'video') {
      videoRef.current.srcObject = active.stream;
    }
  }, [active]);

  // Se a viagem sair da tela gravando (terminou, cancelou), para e guarda no aparelho para salvar depois.
  useEffect(() => {
    return () => {
      const rec = activeRef.current;
      if (rec) {
        heldIds.delete(rec.id);
        void rec.stop().then(() => window.dispatchEvent(new Event(RECORDING_PENDING_EVENT)));
        void api(`/api/trips/${kind}/${tripId}/recording`, { body: { mode: 'off' } }).catch(() => undefined);
      }
      if (readyRef.current) {
        heldIds.delete(readyRef.current);
        window.dispatchEvent(new Event(RECORDING_PENDING_EVENT));
      }
    };
  }, [kind, tripId]);

  const notify = (mode: RecordingMode | 'off') => api(`/api/trips/${kind}/${tripId}/recording`, { body: { mode } }).catch(() => undefined);

  const start = async (mode: RecordingMode) => {
    setMsg('');
    if (!recordingSupported(mode)) {
      setMsg('Este navegador não permite gravar. No celular, use o Chrome (Android) ou o Safari atualizado (iPhone).');
      return;
    }
    try {
      const rec = await startRecording(mode, shareText);
      activeRef.current = rec;
      setActive(rec);
      setElapsed(0);
      setReady(null);
      void notify(mode);
    } catch (e) {
      const name = (e as Error)?.name;
      setMsg(
        name === 'NotAllowedError'
          ? `Permita o ${mode === 'video' ? 'microfone e a câmera' : 'microfone'} para este site nas configurações do navegador.`
          : 'Não consegui começar a gravação neste aparelho.',
      );
    }
  };

  const stop = async () => {
    const rec = activeRef.current;
    if (!rec) return;
    activeRef.current = null;
    setActive(null);
    const blob = await rec.stop();
    void notify('off');
    readyRef.current = rec.id;
    setReady({ blob, id: rec.id, name: recordingFileName({ mode: rec.mode, mimeType: blob.type, startedAt: new Date(rec.startedAt).toISOString() }) });
  };

  const save = async () => {
    if (!ready) return;
    const r = await saveToDevice(ready.blob, ready.name);
    if (r !== 'cancelled') {
      await discardRecording(ready.id).catch(() => undefined);
      readyRef.current = null;
      setReady(null);
      setMsg(r === 'shared' ? 'Gravação enviada. Guarde em local seguro.' : 'Gravação salva nos downloads do aparelho.');
    }
  };

  const createLink = async () => {
    setSharing(true);
    setMsg('');
    try {
      const r = await api<{ path: string }>(`/api/trips/${kind}/${tripId}/share`, { body: {} });
      setLink(window.location.origin + r.path);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Não consegui criar o link agora.');
    } finally {
      setSharing(false);
    }
  };

  const shareMessage = (url: string) => `Acompanhe minha viagem pela Froc em tempo real: ${url}\n${shareText}`;
  const btn = 'inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-xl text-xs font-semibold cursor-pointer transition';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3 space-y-2">
      {other && (
        <div role="status" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
          🔴 {me === 'driver' ? 'O passageiro' : 'O motorista'} está gravando {other.mode === 'video' ? 'em vídeo' : 'o áudio de'} esta viagem pelo celular dele, por segurança.
        </div>
      )}

      {!link ? (
        <button type="button" disabled={sharing} onClick={createLink} className={`${btn} w-full bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 disabled:opacity-60`}>
          <Share2 className="w-4 h-4 text-emerald-600" />
          {sharing ? 'Criando link...' : 'Compartilhar viagem ao vivo'}
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[11px] text-slate-500">Quem abrir o link vê o carro no mapa em tempo real (sem telefones nem valores). Expira quando a viagem acaba.</div>
          <div className="grid grid-cols-3 gap-1.5">
            <a href={`https://wa.me/?text=${encodeURIComponent(shareMessage(link))}`} target="_blank" rel="noreferrer" className={`${btn} bg-emerald-600 text-white`}>
              WhatsApp
            </a>
            <button
              type="button"
              onClick={() => {
                const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
                if (nav.share) void nav.share({ title: 'Minha viagem Froc', text: shareMessage(link), url: link }).catch(() => undefined);
                else window.location.href = `sms:?&body=${encodeURIComponent(shareMessage(link))}`;
              }}
              className={`${btn} bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-700`}
            >
              <Link2 className="w-3.5 h-3.5" /> Enviar
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setMsg('Link copiado.'), () => setMsg(link));
              }}
              className={`${btn} bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-700`}
            >
              <Copy className="w-3.5 h-3.5" /> Copiar
            </button>
          </div>
        </div>
      )}

      {active ? (
        <div className="space-y-2">
          {active.mode === 'video' && <video ref={videoRef} autoPlay muted playsInline className="w-28 h-20 rounded-lg object-cover bg-black" />}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" /> Gravando {active.mode === 'video' ? 'vídeo' : 'áudio'} · {mmss(elapsed)}
            </span>
            <button type="button" onClick={stop} className={`${btn} ml-auto bg-red-600 text-white`}>
              <Square className="w-3.5 h-3.5" /> Parar
            </button>
          </div>
          <div className="text-[10px] text-slate-500">Mantenha o app aberto na tela. A gravação fica só no seu celular.</div>
        </div>
      ) : ready ? (
        <button type="button" onClick={save} className={`${btn} w-full bg-slate-900 dark:bg-emerald-600 text-white`}>
          Salvar gravação no celular
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => start('audio')} className={`${btn} bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-700`}>
            <Mic className="w-4 h-4 text-red-500" /> Gravar áudio
          </button>
          <button type="button" onClick={() => start('video')} className={`${btn} bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-700`}>
            <Video className="w-4 h-4 text-red-500" /> Filmar viagem
          </button>
        </div>
      )}
      {msg && <div className="text-[11px] text-slate-600 dark:text-slate-300 break-all">{msg}</div>}
    </div>
  );
};
