import React, { useState } from 'react';
import { CheckCircle2, Clock, FileUp, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { TruckType, UserProfile } from '../types/mobility.ts';

const TRUCK_TYPES: TruckType[] = ['VUC / Utilitário', '3/4 Baú', 'Toco Aberto', 'Truck Baú', 'Carreta Sider'];
const DOCS: Record<'driver' | 'trucker', { id: string; label: string }[]> = {
  driver: [
    { id: 'cnh', label: 'CNH com EAR (foto ou PDF)' },
    { id: 'crlv', label: 'CRLV do veículo' },
  ],
  trucker: [
    { id: 'cnh', label: 'CNH categoria C, D ou E' },
    { id: 'crlv', label: 'CRLV do caminhão' },
    { id: 'antt', label: 'Registro ANTT (RNTRC)' },
  ],
};

interface Props {
  kind: 'driver' | 'trucker';
  profile: UserProfile;
  onUpload: (kind: 'driver' | 'trucker', docType: string, file: File) => Promise<void>;
  onApply: (kind: 'driver' | 'trucker', data: Record<string, string>) => Promise<void>;
}

/** Cadastro de motorista/caminhoneiro: envio de documentos e acompanhamento da análise. */
export const ProviderOnboarding: React.FC<Props> = ({ kind, profile, onUpload, onApply }) => {
  const status = kind === 'driver' ? profile.driverStatus : profile.truckerStatus;
  const [vehicle, setVehicle] = useState(kind === 'driver' ? profile.driverVehicle : profile.truckModel);
  const [plate, setPlate] = useState(kind === 'driver' ? profile.driverPlate : profile.truckPlate);
  const [phone, setPhone] = useState(profile.phone);
  const [truckType, setTruckType] = useState<TruckType>(profile.truckType);
  const [companyName, setCompanyName] = useState(profile.companyName);
  // Documentos já enviados ficam marcados mesmo depois de recarregar a página.
  const [sentLocal, setSent] = useState<Record<string, boolean>>({});
  const fromServer = (kind === 'driver' ? profile.driverDocsSent : profile.truckerDocsSent) || [];
  const sent: Record<string, boolean> = { ...Object.fromEntries(fromServer.map((d) => [d, true])), ...sentLocal };
  const [busy, setBusy] = useState<string | null>(null);
  const title = kind === 'driver' ? 'motorista (corridas, negociação e caronas)' : 'caminhoneiro (fretes e retorno vazio)';

  if (status === 'approved')
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-sm flex gap-2">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
        <span>Cadastro de {title} aprovado.</span>
      </div>
    );

  if (status === 'pending')
    return (
      <div className="rounded-2xl border border-sky-300 bg-sky-50 dark:bg-sky-950/30 p-4 text-sm flex gap-2">
        <Clock className="w-5 h-5 text-sky-600 shrink-0" />
        <span>
          Cadastro de {title} enviado. A equipe Froc confere os documentos e libera seu acesso. Esta tela atualiza sozinha.
        </span>
      </div>
    );

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy('apply');
        try {
          await onApply(kind, { vehicle, plate, phone, truckType, companyName });
        } catch {
          /* a mensagem de erro já aparece na tela */
        } finally {
          setBusy(null);
        }
      }}
      className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-3 text-xs"
    >
      <h4 className="text-sm font-bold text-slate-900 dark:text-white">Quero trabalhar como {title}</h4>
      {status === 'rejected' && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 flex gap-2 text-red-700 dark:text-red-300">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>Cadastro recusado: {profile.rejectionReason || 'documentos não aprovados'}. Corrija e envie de novo.</span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">{kind === 'driver' ? 'Carro (modelo e cor)' : 'Caminhão (modelo)'}</span>
          <input required value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
        </label>
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">Placa</span>
          <input required value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="ABC1D23" className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 font-mono-num uppercase" />
        </label>
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">Celular com DDD</span>
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 91234-5678" className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
        </label>
        {kind === 'trucker' && (
          <>
            <label className="block">
              <span className="block text-[11px] text-slate-500 mb-1">Tipo de caminhão</span>
              <select value={truckType} onChange={(e) => setTruckType(e.target.value as TruckType)} className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5">
                {TRUCK_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-500 mb-1">Empresa (opcional)</span>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
            </label>
          </>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-[11px] text-slate-500">Documentos (foto nítida pelo celular ou PDF até 3 MB; fotos grandes são reduzidas automaticamente)</div>
        {DOCS[kind].map((d) => (
          <label key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-3 cursor-pointer">
            <span className="flex items-center gap-2">
              {sent[d.id] ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <FileUp className="w-4 h-4 text-slate-500" />}
              {d.label}
            </span>
            <span className="text-[11px] font-semibold text-emerald-700">{busy === d.id ? 'Enviando...' : sent[d.id] ? 'Enviado' : 'Escolher arquivo'}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy(d.id);
                try {
                  await onUpload(kind, d.id, file);
                  setSent((s) => ({ ...s, [d.id]: true }));
                } catch {
                  /* a mensagem de erro já aparece na tela */
                } finally {
                  setBusy(null);
                }
              }}
            />
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={busy !== null || DOCS[kind].some((d) => !sent[d.id])}
        className="w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold disabled:opacity-50 cursor-pointer"
      >
        {busy === 'apply' ? 'Enviando...' : 'Enviar cadastro para análise'}
      </button>
    </form>
  );
};
