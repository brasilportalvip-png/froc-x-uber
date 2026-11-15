import React, { useCallback, useEffect, useState } from 'react';
import { formatBRL } from '../data/locations.ts';
import { api } from '../lib/session.ts';
import type { AdminOverview } from '../types/mobility.ts';

const DOC_LABEL: Record<string, string> = { cnh: 'CNH', crlv: 'CRLV', antt: 'ANTT' };

/** Painel da administração: aprovar motoristas/caminhoneiros e pagar saques. */
export const AdminPanel: React.FC<{ onToast: (msg: string) => void }> = ({ onToast }) => {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminOverview>('/api/admin/overview'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      onToast(msg);
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Erro.');
    }
  };

  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Carregando...</div>;

  return (
    <div className="space-y-4 text-xs">
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Usuários', data.totals.users],
          ['Cadastros p/ analisar', data.totals.pendingApplications],
          ['Saques pendentes', data.totals.pendingWithdrawals],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-3">
            <div className="text-slate-500">{label}</div>
            <div className="text-xl font-bold font-mono-num text-slate-900 dark:text-white">{value}</div>
          </div>
        ))}
      </div>

      <h4 className="text-sm font-bold text-slate-900 dark:text-white">Cadastros aguardando análise</h4>
      {data.applications.length === 0 && <div className="text-slate-500">Nenhum cadastro pendente.</div>}
      {data.applications.map((app) => {
        const key = app.uid + app.kind;
        return (
          <div key={key} className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-2">
            <div className="font-bold text-sm text-slate-900 dark:text-white">
              {app.name} · {app.kind === 'driver' ? 'Motorista' : 'Caminhoneiro'}
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              {app.email} · {app.phone}
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              {app.vehicle} · placa <strong className="font-mono-num">{app.plate}</strong>
              {app.truckType ? ` · ${app.truckType}` : ''}
              {app.companyName ? ` · ${app.companyName}` : ''}
            </div>
            <div className="flex flex-wrap gap-2">
              {app.documents.map((d) => (
                <a key={d.type} href={d.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 font-semibold text-emerald-700 dark:text-emerald-400">
                  Ver {DOC_LABEL[d.type] || d.type}
                </a>
              ))}
            </div>
            <input
              placeholder="Motivo (obrigatório para recusar)"
              value={reasons[key] || ''}
              onChange={(e) => setReasons((r) => ({ ...r, [key]: e.target.value }))}
              className="w-full min-h-[38px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => act(() => api(`/api/admin/applications/${app.uid}`, { body: { kind: app.kind, decision: 'approved' } }), 'Cadastro aprovado.')}
                className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
              >
                Aprovar
              </button>
              <button
                type="button"
                onClick={() =>
                  act(() => api(`/api/admin/applications/${app.uid}`, { body: { kind: app.kind, decision: 'rejected', reason: reasons[key] || '' } }), 'Cadastro recusado.')
                }
                className="flex-1 min-h-[38px] rounded-lg border border-red-300 text-red-700 font-bold cursor-pointer"
              >
                Recusar
              </button>
            </div>
          </div>
        );
      })}

      <h4 className="text-sm font-bold text-slate-900 dark:text-white pt-2">Saques para pagar</h4>
      {data.withdrawals.length === 0 && <div className="text-slate-500">Nenhum saque pendente.</div>}
      {data.withdrawals.map((w) => (
        <div key={w.id} className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-2">
          <div className="font-bold text-slate-900 dark:text-white">
            {w.name} · {formatBRL(w.amount)}
          </div>
          <div>
            Chave Pix: <strong className="font-mono-num select-all">{w.pixKey}</strong>
          </div>
          <div className="text-slate-500">Faça o Pix pelo banco e depois marque como pago.</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => act(() => api(`/api/admin/withdrawals/${w.id}`, { body: { decision: 'paid' } }), 'Saque marcado como pago.')} className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white font-bold cursor-pointer">
              Já paguei
            </button>
            <button type="button" onClick={() => act(() => api(`/api/admin/withdrawals/${w.id}`, { body: { decision: 'rejected' } }), 'Saque recusado e devolvido.')} className="flex-1 min-h-[38px] rounded-lg border border-red-300 text-red-700 font-bold cursor-pointer">
              Recusar (devolver)
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
