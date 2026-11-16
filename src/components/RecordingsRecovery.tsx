import React, { useEffect, useState } from 'react';
import { assemble, discardRecording, pendingRecordings, recordingFileName, saveToDevice } from '../lib/tripRecorder.ts';
import type { SavedRecording } from '../lib/tripRecorder.ts';
import { RECORDING_PENDING_EVENT } from './TripSafetyBar.tsx';

/**
 * Gravações de viagem que ficaram no aparelho sem ser salvas (o app fechou, a viagem terminou
 * no meio da gravação...). Aparece um aviso para salvar ou apagar.
 */
export const RecordingsRecovery: React.FC = () => {
  const [items, setItems] = useState<SavedRecording[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      void pendingRecordings().then(setItems);
    };
    load();
    window.addEventListener(RECORDING_PENDING_EVENT, load);
    return () => window.removeEventListener(RECORDING_PENDING_EVENT, load);
  }, []);

  if (!items.length) return null;
  return (
    <div className="fixed bottom-20 left-3 right-3 md:left-auto md:right-4 md:w-96 z-50 rounded-2xl bg-white dark:bg-[#111013] border border-red-300 dark:border-red-900 shadow-2xl p-4 space-y-2 text-xs">
      <div className="font-bold text-slate-900 dark:text-white">Você tem {items.length === 1 ? 'uma gravação' : `${items.length} gravações`} de viagem para salvar</div>
      <p className="text-slate-500">Elas estão só neste aparelho. Salve no celular (Arquivos/Galeria) ou apague.</p>
      {items.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          <span className="flex-1 truncate">
            {r.mode === 'video' ? 'Vídeo' : 'Áudio'} · {new Date(r.startedAt).toLocaleString('pt-BR')}
          </span>
          <button
            type="button"
            disabled={busy === r.id}
            onClick={async () => {
              setBusy(r.id);
              try {
                const blob = await assemble(r.id);
                const result = await saveToDevice(blob, recordingFileName(r));
                if (result !== 'cancelled') {
                  await discardRecording(r.id);
                  setItems((list) => list.filter((x) => x.id !== r.id));
                }
              } finally {
                setBusy(null);
              }
            }}
            className="px-3 min-h-[34px] rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer disabled:opacity-60"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('Apagar esta gravação do aparelho? Não dá para desfazer.')) return;
              await discardRecording(r.id);
              setItems((list) => list.filter((x) => x.id !== r.id));
            }}
            className="px-3 min-h-[34px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
          >
            Apagar
          </button>
        </div>
      ))}
    </div>
  );
};
