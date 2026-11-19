import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw } from 'lucide-react';
import { canvasToUpload } from '../lib/session.ts';

/**
 * Câmera frontal ao vivo para foto de rosto (perfil, reconhecimento facial e verificação a cada 2h).
 * `liveOnly`: só câmera (sem galeria) — usado no reconhecimento facial e na verificação do motorista.
 */
export const CameraCapture: React.FC<{
  onCapture: (upload: { contentType: string; dataBase64: string }) => Promise<void> | void;
  busy?: boolean;
  label?: string;
}> = ({ onCapture, busy = false, label = 'Tirar foto' }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<{ contentType: string; dataBase64: string } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => undefined);
          setReady(true);
        }
      } catch {
        setError('Não consegui abrir a câmera. Libere o acesso à câmera nas permissões do navegador e tente de novo.');
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (error) return <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 p-3 text-xs font-semibold">{error}</div>;

  return (
    <div className="space-y-2">
      <div className="relative mx-auto w-full max-w-xs aspect-[3/4] rounded-2xl overflow-hidden bg-black">
        {preview ? (
          <img src={`data:${preview.contentType};base64,${preview.dataBase64}`} alt="Sua foto" className="w-full h-full object-cover" />
        ) : (
          <video ref={video} playsInline muted className="w-full h-full object-cover -scale-x-100" />
        )}
        {!preview && <div className="pointer-events-none absolute inset-[12%] rounded-[50%] border-4 border-white/70" aria-hidden />}
      </div>
      <p className="text-center text-[11px] text-slate-600 dark:text-slate-300">Rosto dentro do círculo, de frente, num lugar iluminado. Sem óculos escuros ou boné.</p>
      {preview ? (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => setPreview(null)} className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer inline-flex items-center justify-center gap-1">
            <RefreshCw className="w-4 h-4" /> Tirar outra
          </button>
          <button type="button" disabled={busy} onClick={() => void onCapture(preview)} className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 text-white font-bold cursor-pointer disabled:opacity-60">
            {busy ? 'Enviando...' : 'Usar esta foto'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => video.current && setPreview(canvasToUpload(video.current))}
          className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-bold cursor-pointer disabled:opacity-60 inline-flex items-center justify-center gap-2"
        >
          <Camera className="w-5 h-5" /> {ready ? label : 'Abrindo a câmera...'}
        </button>
      )}
    </div>
  );
};
