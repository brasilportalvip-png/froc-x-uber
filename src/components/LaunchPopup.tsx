import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { LAUNCH_AT, LAUNCH_LABEL, SHARE_TEXT, countdownTo } from '../lib/launch.ts';

const SEEN_KEY = 'froc-launch-popup';

/** Contagem regressiva ao vivo (dias, horas, minutos, segundos). */
export const LaunchCountdown: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [c, setC] = useState(() => countdownTo(LAUNCH_AT));
  useEffect(() => {
    const t = setInterval(() => setC(countdownTo(LAUNCH_AT)), 1000);
    return () => clearInterval(t);
  }, []);
  if (c.launched) return <div className="font-display font-extrabold froc-gold-text text-xl">Inaugurado! 🎉</div>;
  const cells: [number, string][] = [
    [c.days, 'dias'],
    [c.hours, 'horas'],
    [c.minutes, 'min'],
    [c.seconds, 'seg'],
  ];
  return (
    <div className={`grid grid-cols-4 ${compact ? 'gap-1.5' : 'gap-2.5'}`} aria-label={`Faltam ${c.days} dias para a inauguração`}>
      {cells.map(([v, l]) => (
        <div key={l} className={`rounded-xl bg-black/80 border border-amber-500/40 text-center ${compact ? 'py-1.5' : 'py-2.5'}`}>
          <div className={`font-mono-num font-bold froc-gold-text ${compact ? 'text-lg' : 'text-2xl'}`}>{String(v).padStart(2, '0')}</div>
          <div className="text-[9px] uppercase tracking-widest text-slate-400">{l}</div>
        </div>
      ))}
    </div>
  );
};

/**
 * Pop-up da grande inauguração (10/03/2027). Aparece uma vez por dia, pode ser fechado
 * a qualquer momento (botão, tecla Esc ou clique fora) e não volta no mesmo dia.
 */
export const LaunchPopup: React.FC<{ onSignup?: () => void; delayMs?: number }> = ({ onSignup, delayMs = 1800 }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (countdownTo(LAUNCH_AT).launched) return;
    let seenToday = false;
    try {
      seenToday = localStorage.getItem(SEEN_KEY) === new Date().toDateString();
    } catch {
      /* sem armazenamento */
    }
    if (seenToday) return;
    const t = setTimeout(() => setOpen(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, new Date().toDateString());
    } catch {
      /* sem armazenamento */
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={close} data-testid="launch-popup">
      <div role="dialog" aria-modal="true" aria-labelledby="launch-title" className="froc-frame froc-pop w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="relative bg-[#070707] p-6 space-y-4 text-center overflow-hidden">
          <span className="froc-sparkle" style={{ top: '12%', left: '10%' }} />
          <span className="froc-sparkle" style={{ top: '20%', right: '14%', animationDelay: '0.9s' }} />
          <span className="froc-sparkle" style={{ bottom: '18%', left: '18%', animationDelay: '1.6s' }} />
          <button type="button" onClick={close} aria-label="Fechar" className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center cursor-pointer">
            <X className="w-4 h-4" />
          </button>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-amber-300">
            <Sparkles className="w-3.5 h-3.5" /> Grande inauguração
          </div>
          <h2 id="launch-title" className="font-display text-3xl font-extrabold leading-tight">
            <span className="froc-logo">Froc X Uber</span>
            <span className="block text-lg text-white mt-1">chega em {LAUNCH_LABEL}</span>
          </h2>
          <p className="text-sm text-slate-300">
            Corridas, preço negociado, caronas e fretes num app só. Quem se cadastrar antes da inauguração entra como <strong className="text-emerald-400">membro fundador</strong>.
          </p>
          <LaunchCountdown />
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => {
                close();
                onSignup?.();
              }}
              className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-bold cursor-pointer froc-pulse-pink"
            >
              Quero ser fundador
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(SHARE_TEXT)}`}
              target="_blank"
              rel="noreferrer"
              onClick={close}
              className="w-full min-h-[44px] rounded-xl border border-amber-500/60 text-amber-200 font-semibold flex items-center justify-center"
            >
              Avisar meus amigos no WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
