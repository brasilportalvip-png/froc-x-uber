import React, { useEffect, useRef, useState } from 'react';
import { ChevronsRight, KeyRound, MapPin, Navigation, X } from 'lucide-react';
import { formatBRL } from '../data/locations.ts';
import { kmBetween } from '../data/carpoolPolicy.ts';
import { navLinks, shortKm, slideConfirmed } from '../lib/rideFlow.ts';
import { startRing, stopRing } from '../lib/alerts.ts';
import { ProfilePhoto } from './ProfilePhoto.tsx';
import type { RideOrder } from '../types/mobility.ts';

/** Janela rápida: some sozinha em ~3 s, com botão de fechar. */
export const FlashPopup: React.FC<{ title: string; body?: string; tone?: 'ok' | 'info' | 'warn'; seconds?: number; onClose: () => void }> = ({
  title,
  body,
  tone = 'info',
  seconds = 3,
  onClose,
}) => {
  useEffect(() => {
    const t = setTimeout(onClose, seconds * 1000);
    return () => clearTimeout(t);
  }, [onClose, seconds]);
  const color = tone === 'ok' ? 'bg-emerald-600' : tone === 'warn' ? 'bg-amber-500' : 'bg-sky-600';
  return (
    <div role="status" className="fixed top-20 inset-x-0 z-[80] flex justify-center px-4 pointer-events-none">
      <div className={`pointer-events-auto max-w-sm w-full rounded-2xl ${color} text-white shadow-2xl p-4 flex items-start gap-3 animate-[pulse_1s_ease-in-out_1]`}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold">{title}</div>
          {body && <div className="text-xs mt-1 text-white/95">{body}</div>}
        </div>
        <button type="button" aria-label="Fechar" onClick={onClose} className="p-1 rounded-lg hover:bg-white/20 cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

/** Barra grande de deslizar (evita toque sem querer). */
export const SlideToConfirm: React.FC<{ label: string; disabled?: boolean; tone?: 'green' | 'red'; onConfirm: () => void }> = ({ label, disabled, tone = 'green', onConfirm }) => {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState<{ start: number; width: number } | null>(null);
  const knob = 64;
  const max = () => Math.max(1, (track.current?.clientWidth ?? 300) - knob - 8);
  const end = () => {
    if (!drag) return;
    const done = slideConfirmed(x / max());
    setDrag(null);
    setX(done ? max() : 0);
    if (done) {
      onConfirm();
      setTimeout(() => setX(0), 1200);
    }
  };
  const bg = tone === 'red' ? 'bg-rose-600' : 'bg-emerald-600';
  return (
    <div
      ref={track}
      className={`relative w-full h-[72px] rounded-full ${disabled ? 'bg-slate-300 dark:bg-slate-800' : bg} select-none touch-none overflow-hidden`}
      onPointerMove={(e) => drag && setX(Math.min(max(), Math.max(0, e.clientX - drag.start)))}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
    >
      <div className="absolute inset-0 flex items-center justify-center pl-16 pr-4 text-white text-base font-bold tracking-wide pointer-events-none">
        {label}
      </div>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setDrag({ start: e.clientX - x, width: max() });
        }}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) onConfirm();
        }}
        style={{ transform: `translateX(${x}px)`, transition: drag ? 'none' : 'transform 0.25s' }}
        className="absolute top-1 left-1 w-16 h-16 rounded-full bg-white text-slate-900 flex items-center justify-center shadow-lg cursor-grab disabled:cursor-not-allowed"
      >
        <ChevronsRight className="w-8 h-8" />
      </button>
    </div>
  );
};

/** Botões para navegar com voz (Google Maps / Waze). */
export const NavButtons: React.FC<{ to: { lat: number; lng: number }; label: string }> = ({ to, label }) => {
  const links = navLinks(to);
  return (
    <div className="flex gap-2">
      <a href={links.google} target="_blank" rel="noreferrer" className="flex-1 min-h-[44px] rounded-xl bg-sky-600 text-white text-xs font-bold flex items-center justify-center gap-1.5">
        <Navigation className="w-4 h-4" /> {label} · Google Maps
      </a>
      <a href={links.waze} target="_blank" rel="noreferrer" className="flex-1 min-h-[44px] rounded-xl bg-cyan-500 text-white text-xs font-bold flex items-center justify-center gap-1.5">
        <Navigation className="w-4 h-4" /> Waze
      </a>
    </div>
  );
};

/** PIN em destaque quando o motorista chega: campo grande, brilhando. */
export const PinGlow: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <div className="w-full rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-2 shadow-[0_0_24px_rgba(251,191,36,0.75)] animate-pulse focus-within:animate-none">
    <div className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200">
      <KeyRound className="w-5 h-5" /> Peça o PIN de 4 números ao passageiro
    </div>
    <input
      inputMode="numeric"
      autoFocus
      maxLength={4}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      placeholder="• • • •"
      aria-label="PIN do passageiro"
      className="w-full min-h-[60px] rounded-xl border-2 border-amber-400 bg-white dark:bg-slate-900 text-center text-3xl font-mono-num tracking-[0.6em] text-slate-900 dark:text-white"
    />
  </div>
);

/**
 * Chamada de corrida para o motorista: toca alto e vibra; some sozinha em `seconds`.
 * Mostra passageiro, partida, destino, tempo e km da viagem, distância até o passageiro e o valor.
 */
export const RideCallPopup: React.FC<{
  ride: RideOrder;
  seconds: number;
  myPos: { lat: number; lng: number } | null;
  queuedNote?: string;
  onAccept: () => void;
  onIgnore: () => void;
}> = ({ ride, seconds, myPos, queuedNote, onAccept, onIgnore }) => {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    startRing(seconds * 1000);
    const started = Date.now();
    const t = setInterval(() => {
      const l = seconds - Math.floor((Date.now() - started) / 1000);
      setLeft(l);
      if (l <= 0) onIgnore();
    }, 250);
    return () => {
      clearInterval(t);
      stopRing();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride.id]);
  const toPickup = myPos ? kmBetween(myPos, ride.origin) : null;
  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-end sm:items-center justify-center p-3" role="dialog" aria-label="Nova corrida">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#111013] border-4 border-emerald-500 shadow-2xl overflow-hidden">
        <div className="relative h-1.5 bg-slate-200 dark:bg-slate-800">
          <div className="absolute inset-y-0 left-0 bg-emerald-500 transition-all" style={{ width: `${Math.max(0, (left / seconds) * 100)}%` }} />
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-emerald-600 uppercase tracking-wide animate-pulse">Nova corrida · {Math.max(0, left)} s</div>
            <button type="button" aria-label="Fechar" onClick={onIgnore} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <ProfilePhoto uid={ride.passengerId} size={56} alt={`Foto de ${ride.passengerName}`} />
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold text-slate-900 dark:text-white truncate">{ride.passengerName}</div>
              <div className="text-xs text-amber-500 font-semibold">★ {ride.passengerRating ?? 5}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-500">Você recebe</div>
              <div className="text-2xl font-black text-emerald-600 font-mono-num">{formatBRL(ride.driverEarning ?? ride.price)}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2">
              <div className="text-[10px] text-slate-500 dark:text-slate-300">Até o passageiro</div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{toPickup === null ? '—' : shortKm(toPickup)}</div>
            </div>
            <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2">
              <div className="text-[10px] text-slate-500 dark:text-slate-300">Viagem</div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{ride.distanceKm} km</div>
            </div>
            <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2">
              <div className="text-[10px] text-slate-500 dark:text-slate-300">Tempo</div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{ride.durationMin} min</div>
            </div>
          </div>
          <div className="text-sm space-y-1.5 text-slate-700 dark:text-slate-200">
            <div className="flex gap-2">
              <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Partida:</strong> {ride.origin.name}
              </span>
            </div>
            <div className="flex gap-2">
              <MapPin className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
              <span>
                <strong>Destino:</strong> {ride.destination.name}
              </span>
            </div>
          </div>
          {queuedNote && <div className="text-xs font-semibold text-amber-600">{queuedNote}</div>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onIgnore} className="min-h-[56px] rounded-2xl border-2 border-slate-300 dark:border-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
              Ignorar
            </button>
            <button type="button" onClick={onAccept} className="min-h-[56px] rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-base font-black cursor-pointer">
              Aceitar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
