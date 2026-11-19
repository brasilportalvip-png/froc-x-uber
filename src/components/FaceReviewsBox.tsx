import React, { useCallback, useEffect, useState } from 'react';
import { ScanFace } from 'lucide-react';
import { api, apiImageUrl } from '../lib/session.ts';

interface Review {
  id: string;
  uid: string;
  name: string;
  at: string;
  result: string;
  verdict: string;
  confianca: number;
}

const RESULT: Record<string, string> = {
  bloqueado: 'Rosto não confere — motorista ficou offline',
  revisao: '3 selfies sem confirmar — motorista ficou offline',
  sem_ia: 'IA fora do ar — liberado, confira a selfie',
  cadastro_nao_confere: 'Motorista antigo: reconhecimento facial não confere com a CNH (à esquerda, a CNH)',
};

function Img({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let made = '';
    apiImageUrl(path)
      .then((u) => setUrl((made = u)))
      .catch(() => setUrl(''));
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return url ? <img src={url} alt={alt} className="w-full aspect-[3/4] object-cover rounded-xl" /> : <div className="w-full aspect-[3/4] rounded-xl bg-slate-200 dark:bg-slate-800" />;
}

/** Equipe: confere as selfies de segurança que a IA não aprovou (referência do cadastro × selfie de agora). */
export const FaceReviewsBox: React.FC<{ onToast: (m: string) => void }> = ({ onToast }) => {
  const [rows, setRows] = useState<Review[] | null>(null);
  const load = useCallback(() => api<{ reviews: Review[] }>('/api/admin/face-reviews').then((r) => setRows(r.reviews)), []);
  useEffect(() => {
    void load().catch((e) => onToast(e.message));
  }, [load, onToast]);
  const decide = async (id: string, decision: 'liberar' | 'manter_bloqueado') => {
    try {
      await api(`/api/admin/face-reviews/${id}`, { body: { decision } });
      onToast(decision === 'liberar' ? 'Motorista liberado.' : 'Mantido bloqueado.');
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Falhou.');
    }
  };
  return (
    <div className="space-y-2" data-testid="conferencias-rosto">
      <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <ScanFace className="w-4 h-4" /> Verificação de rosto dos motoristas ({rows?.length ?? '…'})
      </h4>
      {rows?.length === 0 && <div className="text-slate-500">Nenhuma selfie para conferir.</div>}
      {rows?.map((r) => (
        <div key={r.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="font-semibold text-slate-900 dark:text-white">
            {r.name} · {new Date(r.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          </div>
          <div className="text-xs">{RESULT[r.result] || r.result}</div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-center">
            <div>
              <Img path={`/api/admin/face-reviews/${r.id}/referencia`} alt="Reconhecimento do cadastro" />
              Cadastro
            </div>
            <div>
              <Img path={`/api/admin/face-reviews/${r.id}/selfie`} alt="Selfie de agora" />
              Selfie de agora
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void decide(r.id, 'liberar')} className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white font-bold cursor-pointer">
              É a mesma pessoa · liberar
            </button>
            <button type="button" onClick={() => void decide(r.id, 'manter_bloqueado')} className="flex-1 min-h-[38px] rounded-lg border border-red-300 text-red-700 font-bold cursor-pointer">
              Não é · manter bloqueado
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
