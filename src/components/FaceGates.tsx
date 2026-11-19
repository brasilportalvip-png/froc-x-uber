import React, { useState } from 'react';
import { Camera, ImagePlus, LogOut, ScanFace, ShieldCheck, X } from 'lucide-react';
import { api, prepareUpload } from '../lib/session.ts';
import { CameraCapture } from './CameraCapture.tsx';

const shell = 'fixed inset-0 z-[85] bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-3';
const card = 'w-full max-w-md max-h-[94vh] overflow-y-auto rounded-3xl bg-white dark:bg-[#111013] border border-emerald-500/40 p-5 space-y-3 text-sm text-slate-700 dark:text-slate-200 shadow-2xl';
const errBox = 'rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 text-amber-900 dark:text-amber-100 p-3 text-xs font-semibold';

/**
 * Foto de perfil: obrigatória depois do cadastro (`mode="required"`, não fecha) ou para trocar
 * (`mode="change"`, com botão fechar). Câmera na hora ou galeria.
 */
export const PhotoGate: React.FC<{ mode: 'required' | 'change'; onDone: () => Promise<void> | void; onClose?: () => void; onLogout?: () => void }> = ({ mode, onDone, onClose, onLogout }) => {
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (upload: { contentType: string; dataBase64: string }) => {
    setBusy(true);
    setError('');
    try {
      await api('/api/me/photo', { body: upload });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar a foto.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="foto-titulo" className={shell}>
      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <h3 id="foto-titulo" className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Camera className="w-6 h-6 text-emerald-600" /> {mode === 'required' ? 'Adicione sua foto' : 'Trocar foto'}
          </h3>
          {mode === 'change' && (
            <button type="button" aria-label="Fechar" onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <p>Sua foto aparece para o motorista ou passageiro da viagem. Ela identifica você e deixa todos mais seguros.</p>
        {camera ? (
          <CameraCapture busy={busy} onCapture={send} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setCamera(true)} className="min-h-[72px] rounded-2xl bg-emerald-600 text-white font-bold cursor-pointer flex flex-col items-center justify-center gap-1">
              <Camera className="w-6 h-6" /> Tirar foto
            </button>
            <label className="min-h-[72px] rounded-2xl border-2 border-emerald-600 text-emerald-700 dark:text-emerald-300 font-bold cursor-pointer flex flex-col items-center justify-center gap-1">
              <ImagePlus className="w-6 h-6" /> {busy ? 'Enviando...' : 'Da galeria'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    const up = await prepareUpload(file);
                    await send({ contentType: up.contentType, dataBase64: up.dataBase64 });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Não foi possível ler a foto.');
                  }
                }}
              />
            </label>
          </div>
        )}
        {error && (
          <div role="alert" className={errBox}>
            {error}
          </div>
        )}
        {mode === 'required' && onLogout && (
          <button type="button" onClick={onLogout} className="w-full text-xs text-slate-500 inline-flex items-center justify-center gap-1 cursor-pointer">
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        )}
      </div>
    </div>
  );
};

/** Reconhecimento facial do cadastro de motorista (câmera ao vivo + autorização LGPD). */
export const FaceEnroll: React.FC<{ enrolled: boolean; onDone: () => Promise<void> | void }> = ({ enrolled, onDone }) => {
  const [consent, setConsent] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (enrolled)
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 p-3 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" /> Reconhecimento facial salvo.
      </div>
    );
  return (
    <div className="rounded-xl border-2 border-dashed border-emerald-500 p-3 space-y-2 text-xs" data-testid="reconhecimento-facial">
      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <ScanFace className="w-5 h-5 text-emerald-600" /> Reconhecimento facial (obrigatório)
      </div>
      <p>Tire uma selfie com a câmera agora. Ela fica salva e é comparada com a foto da sua CNH. Enquanto você estiver online, o app pede uma selfie a cada 2 horas para confirmar que é você ao volante.</p>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0" />
        <span>Autorizo a Froc a usar meu reconhecimento facial só para a segurança das viagens (dado biométrico, LGPD).</span>
      </label>
      {open ? (
        <CameraCapture
          busy={busy}
          label="Tirar selfie"
          onCapture={async (up) => {
            setBusy(true);
            setError('');
            try {
              await api('/api/me/face-enroll', { body: { ...up, consent } });
              await onDone();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <button type="button" disabled={!consent} onClick={() => setOpen(true)} className="w-full min-h-[44px] rounded-xl bg-emerald-600 text-white font-bold cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-2">
          <Camera className="w-5 h-5" /> Abrir a câmera
        </button>
      )}
      {error && (
        <div role="alert" className={errBox}>
          {error}
        </div>
      )}
    </div>
  );
};

/** Janela do reconhecimento facial (motorista aprovado que ainda não fez e tentou ficar online). */
export const FaceEnrollModal: React.FC<{ onDone: () => Promise<void> | void; onClose: () => void }> = ({ onDone, onClose }) => (
  <div role="dialog" aria-modal="true" aria-label="Reconhecimento facial" className={shell}>
    <div className={card}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Antes de ficar online</h3>
        <button type="button" aria-label="Fechar" onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>
      <FaceEnroll enrolled={false} onDone={onDone} />
    </div>
  </div>
);

/** Verificação de segurança a cada 2h com o motorista trabalhando. */
export const FaceCheckModal: React.FC<{ onDone: () => Promise<void> | void; onGoOffline: () => void }> = ({ onDone, onGoOffline }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [key, setKey] = useState(0);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="verificacao-titulo" className={shell} data-testid="verificacao-rosto">
      <div className={card}>
        <h3 id="verificacao-titulo" className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
          <ScanFace className="w-6 h-6 text-emerald-600" /> Verificação de segurança
        </h3>
        <p>A cada 2 horas online, confirmamos que é você ao volante. Leva poucos segundos. A corrida em andamento continua normalmente.</p>
        <CameraCapture
          key={key}
          busy={busy}
          label="Tirar selfie"
          onCapture={async (up) => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await api<{ result: string; message: string }>('/api/me/face-check', { body: up });
              setMsg({ text: r.message, ok: r.result === 'aprovado' });
              if (r.result === 'repetir') setKey((k) => k + 1);
              else {
                window.setTimeout(() => void onDone(), r.result === 'aprovado' ? 1200 : 3000);
              }
            } catch (err) {
              setMsg({ text: err instanceof Error ? err.message : 'Não foi possível enviar.', ok: false });
            } finally {
              setBusy(false);
            }
          }}
        />
        {msg && (
          <div role="alert" className={msg.ok ? 'rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 p-3 text-xs font-semibold' : errBox}>
            {msg.text}
          </div>
        )}
        <button type="button" onClick={onGoOffline} className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer">
          Agora não (ficar offline)
        </button>
      </div>
    </div>
  );
};
