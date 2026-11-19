import { FaceEnroll } from './FaceGates.tsx';
import { CARGO_VEHICLE_TYPES } from '../data/cargoVehicles.ts';
import React, { useState } from 'react';
import { CheckCircle2, Clock, FileUp, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { TruckType, UserProfile } from '../types/mobility.ts';
import { DEFAULT_MAX_VEHICLE_AGE, minVehicleYear, vehicleAgeLimit } from '../data/legal.ts';

const TRUCK_TYPES: TruckType[] = [...CARGO_VEHICLE_TYPES];
const DOCS: Record<'driver' | 'trucker', { id: string; label: string }[]> = {
  driver: [
    { id: 'cnh', label: 'CNH com a observação EAR (foto ou PDF)' },
    { id: 'crlv', label: 'CRLV do veículo (licenciamento em dia)' },
    { id: 'antecedentes', label: 'Certidão negativa de antecedentes criminais' },
  ],
  trucker: [
    { id: 'cnh', label: 'CNH compatível com o veículo, com EAR' },
    { id: 'crlv', label: 'CRLV do veículo' },
    { id: 'antt', label: 'Certificado ANTT (RNTRC)' },
    { id: 'antecedentes', label: 'Certidão negativa de antecedentes criminais' },
  ],
};

/** Declarações exigidas por lei (o servidor confere as mesmas chaves). */
const DECLARATIONS: Record<'driver' | 'moto' | 'trucker', { id: string; label: string }[]> = {
  driver: [
    { id: 'ear', label: 'Minha CNH tem a observação EAR (exerce atividade remunerada).' },
    { id: 'inss', label: 'Sou (ou serei) inscrito no INSS como contribuinte individual ou MEI, como exige a lei.' },
    { id: 'seguroApp', label: 'Tenho (ou vou contratar) o seguro de Acidentes Pessoais a Passageiros (APP) exigido pela prefeitura.' },
    { id: 'veracidade', label: 'As informações e documentos são verdadeiros. Sei que dado falso gera bloqueio.' },
  ],
  moto: [
    { id: 'ear', label: 'Minha CNH categoria A tem a observação EAR e tenho habilitação há pelo menos 2 anos.' },
    { id: 'lei12009', label: 'Tenho 21 anos ou mais, fiz o curso de mototaxista/motofretista e uso colete e equipamentos obrigatórios (Lei 12.009/2009).' },
    { id: 'inss', label: 'Sou (ou serei) inscrito no INSS como contribuinte individual ou MEI.' },
    { id: 'seguroApp', label: 'Tenho (ou vou contratar) o seguro APP exigido pela prefeitura.' },
    { id: 'veracidade', label: 'As informações e documentos são verdadeiros. Sei que dado falso gera bloqueio.' },
  ],
  trucker: [
    { id: 'ear', label: 'Minha CNH é compatível com o veículo e tem a observação EAR.' },
    { id: 'rntrc', label: 'Meu RNTRC está ativo na ANTT (obrigatório para frete pago de carga de terceiros).' },
    { id: 'ciotPiso', label: 'Sei que cada frete precisa de CIOT e não pode ficar abaixo do piso mínimo da ANTT (Lei 15.485/2026).' },
    { id: 'veracidade', label: 'As informações e documentos são verdadeiros. Sei que dado falso gera bloqueio.' },
  ],
};

interface Props {
  kind: 'driver' | 'trucker';
  profile: UserProfile;
  onUpload: (kind: 'driver' | 'trucker', docType: string, file: File) => Promise<void>;
  onApply: (kind: 'driver' | 'trucker', data: Record<string, unknown>) => Promise<void>;
  onRefresh?: () => Promise<void> | void;
}

/** Cadastro de motorista/caminhoneiro: envio de documentos e acompanhamento da análise. */
export const ProviderOnboarding: React.FC<Props> = ({ kind, profile, onUpload, onApply, onRefresh }) => {
  // Motorista: reconhecimento facial com a câmera é obrigatório antes de enviar.
  const needsFace = kind === 'driver' && Boolean(profile.photoRequired) && !profile.faceEnrolled;
  const status = kind === 'driver' ? profile.driverStatus : profile.truckerStatus;
  const [vehicle, setVehicle] = useState(kind === 'driver' ? profile.driverVehicle : profile.truckModel);
  const [plate, setPlate] = useState(kind === 'driver' ? profile.driverPlate : profile.truckPlate);
  const [phone, setPhone] = useState(profile.phone);
  const [truckType, setTruckType] = useState<TruckType>(profile.truckType);
  const [companyName, setCompanyName] = useState(profile.companyName);
  const [rntrc, setRntrc] = useState(profile.rntrc || '');
  const [vehicleType, setVehicleType] = useState<'carro' | 'moto'>(profile.driverVehicleType || 'carro');
  const [vehicleYear, setVehicleYear] = useState(profile.driverVehicleYear ? String(profile.driverVehicleYear) : '');
  const [city, setCity] = useState(profile.driverCity || profile.city || '');
  const [uf, setUf] = useState(profile.driverState || '');
  const [cnhExpiry, setCnhExpiry] = useState(profile.cnhExpiry || '');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const declarationSet = DECLARATIONS[kind === 'trucker' ? 'trucker' : vehicleType === 'moto' ? 'moto' : 'driver'];
  const allChecked = declarationSet.every((d) => checks[d.id]);
  const ageRule = vehicleAgeLimit(city, uf, profile.maxVehicleAgeYears || DEFAULT_MAX_VEHICLE_AGE);
  const minYear = minVehicleYear(ageRule.maxYears);
  const tooOld = kind === 'driver' && Number(vehicleYear) > 0 && Number(vehicleYear) < minYear;
  // Documentos já enviados ficam marcados mesmo depois de recarregar a página.
  const [sentLocal, setSent] = useState<Record<string, boolean>>({});
  const fromServer = (kind === 'driver' ? profile.driverDocsSent : profile.truckerDocsSent) || [];
  const sent: Record<string, boolean> = { ...Object.fromEntries(fromServer.map((d) => [d, true])), ...sentLocal };
  const [busy, setBusy] = useState<string | null>(null);
  const title = kind === 'driver' ? 'motorista (corridas, negociação e caronas)' : 'transportador de carga: caminhão, van, furgão, pick-up ou utilitário (fretes, mudanças e retorno vazio)';

  if (status === 'approved')
    return (
      <div className="space-y-2">
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-sm flex gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Cadastro de {title} aprovado.</span>
        </div>
        {/* Motorista aprovado antes do reconhecimento facial existir: faz agora para poder ficar online. */}
        {needsFace && <FaceEnroll enrolled={false} onDone={async () => void (await onRefresh?.())} />}
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
          await onApply(kind, {
            vehicle,
            plate,
            phone,
            truckType,
            companyName,
            rntrc,
            vehicleType,
            vehicleYear: Number(vehicleYear),
            city,
            state: uf,
            cnhExpiry,
            declarations: Object.fromEntries(declarationSet.map((d) => [d.id, Boolean(checks[d.id])])),
          });
        } catch {
          /* a mensagem de erro já aparece na tela */
        } finally {
          setBusy(null);
        }
      }}
      className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-3 text-xs"
    >
      <h4 className="text-sm font-bold text-slate-900 dark:text-white">Quero trabalhar como {title}</h4>
      {status === 'rejected' && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 flex gap-2 text-red-700 dark:text-red-300">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>Cadastro recusado: {profile.rejectionReason || 'documentos não aprovados'}. Corrija e envie de novo.</span>
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        A lei exige CNH com EAR, veículo dentro da idade permitida na sua cidade e documentos em dia.{' '}
        <a href="/regras-e-requisitos" target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 dark:text-emerald-400 underline">
          Ver regras e leis
        </a>
      </p>
      {kind === 'driver' && (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
          {(['carro', 'moto'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setVehicleType(t)}
              className={`min-h-[36px] rounded-lg text-xs font-semibold cursor-pointer ${vehicleType === t ? 'bg-white dark:bg-[#1B2436] shadow-xs text-slate-900 dark:text-white' : 'text-slate-500'}`}
            >
              {t === 'carro' ? 'Carro' : 'Moto (mototáxi e entregas)'}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">{kind === 'driver' ? (vehicleType === 'moto' ? 'Moto (modelo e cor)' : 'Carro (modelo e cor)') : 'Veículo de carga (modelo)'}</span>
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
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">Ano de fabricação</span>
          <input
            required
            inputMode="numeric"
            maxLength={4}
            value={vehicleYear}
            onChange={(e) => setVehicleYear(e.target.value.replace(/\D/g, ''))}
            placeholder={kind === 'driver' ? `${minYear} ou mais novo` : '2018'}
            className={`w-full min-h-[40px] rounded-xl border bg-transparent px-3 font-mono-num ${tooOld ? 'border-red-400' : 'border-slate-200 dark:border-slate-700'}`}
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">Validade da CNH</span>
          <input required type="date" value={cnhExpiry} onChange={(e) => setCnhExpiry(e.target.value)} className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
        </label>
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">Cidade onde vai trabalhar</span>
          <input required value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Campinas" className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
        </label>
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">UF</span>
          <input
            required
            maxLength={2}
            value={uf}
            onChange={(e) => setUf(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
            placeholder="SP"
            className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 uppercase"
          />
        </label>
        {kind === 'driver' && (
          <p className={`sm:col-span-2 text-[11px] ${tooOld ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
            {tooOld ? 'Veículo mais antigo do que o permitido. ' : ''}Aceitamos fabricação a partir de {minYear} {city && uf ? `em ${city}/${uf}` : ''} · {ageRule.source}
          </p>
        )}
        {kind === 'trucker' && (
          <>
            <label className="block">
              <span className="block text-[11px] text-slate-500 mb-1">Tipo de veículo de carga</span>
              <select value={truckType} onChange={(e) => setTruckType(e.target.value as TruckType)} className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5">
                {TRUCK_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-500 mb-1">RNTRC (registro na ANTT)</span>
              <input
                value={rntrc}
                onChange={(e) => setRntrc(e.target.value)}
                inputMode="numeric"
                placeholder="Número que está no seu certificado da ANTT"
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3"
              />
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
      {kind === 'driver' && profile.photoRequired && <FaceEnroll enrolled={Boolean(profile.faceEnrolled)} onDone={async () => void (await onRefresh?.())} />}
      <div className="space-y-1.5">
        <div className="text-[11px] text-slate-500">Declarações obrigatórias</div>
        {declarationSet.map((d) => (
          <label key={d.id} className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(checks[d.id])}
              onChange={(e) => setChecks((c) => ({ ...c, [d.id]: e.target.checked }))}
              className="mt-0.5 w-4 h-4 shrink-0"
            />
            <span className="text-slate-700 dark:text-slate-300">{d.label}</span>
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={busy !== null || DOCS[kind].some((d) => !sent[d.id]) || !allChecked || tooOld || needsFace}
        className="w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold disabled:opacity-50 cursor-pointer"
      >
        {busy === 'apply' ? 'Enviando...' : 'Enviar cadastro para análise'}
      </button>
    </form>
  );
};
