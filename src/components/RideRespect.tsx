import React, { useEffect, useRef, useState } from 'react';
import { AlarmClock, ShieldCheck } from 'lucide-react';
import { formatBRL } from '../data/locations.ts';
import {
  FREE_CANCEL_SEC,
  HALF_CANCEL_SEC,
  LATE_GRACE_MIN,
  NO_SHOW_SEC,
  RIDE_POLICY_TEXT,
  RIDE_POLICY_VERSION,
  cancelFeePercent,
  nextWaitTier,
  waitingFeePercent,
} from '../data/ridePolicy.ts';
import type { RideOrder } from '../types/mobility.ts';

/** Relógio que atualiza a cada segundo (para os contadores). */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const since = (iso: string | undefined, now: number) => (iso ? (now - Date.parse(iso)) / 1000 : 0);

const POLICY_KEY = 'froc-regras-corrida';
export function policyAccepted() {
  try {
    return localStorage.getItem(POLICY_KEY) === RIDE_POLICY_VERSION;
  } catch {
    return false;
  }
}
function rememberPolicy() {
  try {
    localStorage.setItem(POLICY_KEY, RIDE_POLICY_VERSION);
  } catch {
    /* navegador sem armazenamento */
  }
}

/** Regras de respeito mostradas antes do primeiro pedido (educação do passageiro). */
export const RidePolicyModal: React.FC<{ onAccept: () => void; onClose: () => void }> = ({ onAccept, onClose }) => (
  <div role="dialog" aria-modal="true" aria-labelledby="regras-titulo" className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
    <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-[#111013] border border-amber-500/40 p-5 space-y-3 text-sm text-slate-700 dark:text-slate-200 shadow-2xl">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-emerald-600" />
        <h3 id="regras-titulo" className="font-bold text-slate-900 dark:text-white">
          {RIDE_POLICY_TEXT.title}
        </h3>
      </div>
      <p className="text-xs text-slate-500">O motorista se desloca até você. Estas regras protegem o tempo dele e o seu dinheiro.</p>
      <div>
        <div className="text-xs font-bold text-slate-900 dark:text-white mb-1">Cancelamento</div>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          {RIDE_POLICY_TEXT.cancel.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-xs font-bold text-slate-900 dark:text-white mb-1">Tempo de espera</div>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          {RIDE_POLICY_TEXT.wait.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-slate-500">Tudo é cobrado automaticamente pela carteira Froc. A taxa vai para o motorista.</p>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-4 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold cursor-pointer">
          Agora não
        </button>
        <button
          type="button"
          onClick={() => {
            rememberPolicy();
            onAccept();
          }}
          className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
        >
          Entendi e aceito · pedir corrida
        </button>
      </div>
    </div>
  </div>
);

/** Quanto custa cancelar AGORA e até quando vale o valor atual (mesma conta do servidor). */
export function cancelQuote(ride: RideOrder, now: number) {
  if (!ride.driverName || ride.status === 'searching') return { percent: 0, fee: 0, untilSec: null as number | null, reason: 'Nenhum motorista aceitou ainda: cancelar é grátis.' };
  if (ride.status === 'arriving') return { percent: 100, fee: ride.price, untilSec: null, reason: 'O motorista já está no embarque: ele recebe 100%.' };
  const elapsed = since(ride.acceptedAt, now);
  if (elapsed > ((ride.etaMin || 5) + LATE_GRACE_MIN) * 60) return { percent: 0, fee: 0, untilSec: null, reason: 'O motorista está muito atrasado: cancelar é grátis.' };
  const percent = cancelFeePercent(elapsed);
  const untilSec = percent === 0 ? FREE_CANCEL_SEC - elapsed : percent === 50 ? HALF_CANCEL_SEC - elapsed : null;
  return {
    percent,
    fee: Math.round(ride.price * percent) / 100,
    untilSec,
    reason: percent === 0 ? 'Até 1 min depois do aceite: grátis.' : percent === 50 ? 'Entre 1 e 2 min do aceite: 50% vai para o motorista.' : 'Mais de 2 min do aceite: o motorista recebe 100%.',
  };
}

/** Botão de cancelar do passageiro, com a taxa e o contador sempre visíveis. */
export const PassengerCancelButton: React.FC<{ ride: RideOrder; onCancel: () => void }> = ({ ride, onCancel }) => {
  const now = useNow();
  const q = cancelQuote(ride, now);
  return (
    <div className="w-full space-y-1">
      <button
        type="button"
        onClick={() => {
          const msg = q.percent
            ? `Cancelar agora custa ${q.percent}% (${formatBRL(q.fee)}), que vão para o motorista. ${q.reason}\n\nCancelar mesmo assim?`
            : 'Cancelar a corrida? O valor volta inteiro para sua carteira.';
          if (window.confirm(msg)) onCancel();
        }}
        className={`px-4 min-h-[44px] rounded-xl border text-xs font-semibold transition cursor-pointer ${
          q.percent ? 'border-red-300 text-red-700 dark:text-red-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
        }`}
      >
        {q.percent ? `Cancelar (taxa ${q.percent}%: ${formatBRL(q.fee)})` : 'Cancelar corrida (grátis)'}
      </button>
      <div className="text-[11px] text-slate-500">
        {q.untilSec !== null && q.untilSec > 0
          ? q.percent === 0
            ? `Grátis por mais ${mmss(q.untilSec)}. Depois, 50%.`
            : `50% por mais ${mmss(q.untilSec)}. Depois, 100%.`
          : q.reason}
      </div>
    </div>
  );
};

/** Espera no embarque: tempo, acréscimo atual e a próxima faixa. */
export function waitInfo(ride: RideOrder, now: number) {
  const waited = since(ride.arrivedAt, now);
  const percent = waitingFeePercent(waited);
  const next = nextWaitTier(waited);
  return { waited, percent, extra: Math.round(ride.price * percent) / 100, next, nextInSec: next ? next.afterSec - waited : null };
}

/**
 * Aviso que aparece na tela do passageiro quando o motorista chega: contador da espera e
 * quanto já foi acrescentado. Vibra o celular na primeira vez.
 */
export const DriverArrivedAlert: React.FC<{ ride: RideOrder; onOnMyWay: () => void }> = ({ ride, onOnMyWay }) => {
  const now = useNow();
  const [hidden, setHidden] = useState(false);
  const buzzed = useRef('');
  useEffect(() => {
    if (ride.arrivedAt && buzzed.current !== ride.arrivedAt) {
      buzzed.current = ride.arrivedAt;
      setHidden(false);
      try {
        navigator.vibrate?.([400, 150, 400, 150, 600]);
      } catch {
        /* sem vibração */
      }
    }
  }, [ride.arrivedAt]);
  const w = waitInfo(ride, now);
  const banner = (
    <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${w.percent ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300' : 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'}`}>
      <AlarmClock className="w-4 h-4 inline mr-1 -mt-0.5" />
      Motorista esperando há {mmss(w.waited)} ·{' '}
      {w.percent ? `+${w.percent}% (${formatBRL(w.extra)})` : 'ainda grátis'}
      {w.next && w.nextInSec !== null ? ` · em ${mmss(w.nextInSec)} passa para +${w.next.percent}%` : ' · máximo atingido'}
    </div>
  );
  if (hidden) return banner;
  return (
    <>
      {banner}
      <div role="alertdialog" aria-modal="true" aria-labelledby="chegou-titulo" className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#111013] border-2 border-amber-400 p-6 text-center space-y-3 shadow-2xl froc-enter">
          <div className="text-4xl" aria-hidden>
            🚗
          </div>
          <h3 id="chegou-titulo" className="text-lg font-extrabold text-slate-900 dark:text-white">
            Seu motorista chegou!
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {ride.driverName?.split(' ')[0]} está no embarque com {ride.vehicleModel} · <strong className="font-mono-num">{ride.vehiclePlate}</strong>
          </p>
          <div className="text-4xl font-extrabold font-mono-num text-slate-900 dark:text-white">{mmss(w.waited)}</div>
          <p className={`text-sm font-bold ${w.percent ? 'text-red-600' : 'text-emerald-600'}`}>
            {w.percent ? `Acréscimo atual: +${w.percent}% (${formatBRL(w.extra)})` : `Espera grátis por mais ${mmss(60 - w.waited)}`}
          </p>
          <p className="text-[11px] text-slate-500">Depois de 1 min: +10% · 2 min: +30% · 3 min: +50%. Com 5 min, o motorista pode encerrar e receber 100%.</p>
          <button
            type="button"
            onClick={() => {
              setHidden(true);
              onOnMyWay();
            }}
            className="w-full min-h-[48px] rounded-2xl bg-emerald-600 text-white font-bold cursor-pointer"
          >
            Estou indo!
          </button>
        </div>
      </div>
    </>
  );
};

/** Para o motorista: tempo de espera, acréscimo e o botão "passageiro não apareceu". */
export const DriverWaitPanel: React.FC<{ ride: RideOrder; onNoShow: () => void }> = ({ ride, onNoShow }) => {
  const now = useNow();
  const w = waitInfo(ride, now);
  const noShowIn = NO_SHOW_SEC - w.waited;
  return (
    <div className="w-full rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 p-3 space-y-2 text-xs">
      <div className="font-semibold text-slate-900 dark:text-white">
        Esperando há {mmss(w.waited)} · {w.percent ? `acréscimo +${w.percent}% (${formatBRL(w.extra)}) para você` : '1º minuto grátis para o passageiro'}
      </div>
      <div className="text-slate-500">O passageiro foi avisado na tela. O acréscimo entra quando você confirmar o PIN.</div>
      <button
        type="button"
        disabled={noShowIn > 0}
        onClick={() => {
          if (window.confirm('Encerrar como "passageiro não apareceu"? Você recebe 100% do valor da corrida.')) onNoShow();
        }}
        className="w-full min-h-[40px] rounded-lg border border-red-300 text-red-700 dark:text-red-300 font-semibold disabled:opacity-50 cursor-pointer"
      >
        {noShowIn > 0 ? `Passageiro não apareceu (libera em ${mmss(noShowIn)})` : 'Passageiro não apareceu · receber 100%'}
      </button>
    </div>
  );
};
