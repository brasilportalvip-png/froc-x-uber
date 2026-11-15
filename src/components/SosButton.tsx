import React, { useState } from 'react';
import { Phone, Share2, ShieldAlert } from 'lucide-react';
import { api } from '../lib/session.ts';

interface Props {
  kind: 'ride' | 'indrive' | 'carpool' | 'truck' | 'freight';
  refId: string;
  /** Texto com os dados da viagem para compartilhar com um contato de confiança. */
  shareText: string;
}

/**
 * Botão de emergência: avisa a central Froc com a localização e os dados da viagem,
 * oferece ligar para a polícia (190) e compartilhar a viagem com alguém de confiança.
 */
export const SosButton: React.FC<Props> = ({ kind, refId, shareText }) => {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000 });
    });
    try {
      await api('/api/sos', {
        body: { kind, refId, lat: position?.coords.latitude, lng: position?.coords.longitude, message: 'Alerta de emergência pelo app' },
      });
      setSent(true);
    } catch {
      setSent(false);
    } finally {
      setBusy(false);
    }
  };

  const mapsLink = (lat?: number, lng?: number) => (lat && lng ? ` Localização: https://maps.google.com/?q=${lat},${lng}` : '');

  const share = async () => {
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 5000 });
    });
    const message = `Estou numa viagem pelo Froc X Uber. ${shareText}${mapsLink(position?.coords.latitude, position?.coords.longitude)}`;
    if (navigator.share) await navigator.share({ text: message }).catch(() => undefined);
    else window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank', 'noopener');
  };

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer"
      >
        <ShieldAlert className="w-4 h-4" />
        SOS
      </button>
    );

  return (
    <div className="w-full rounded-2xl border-2 border-red-500 bg-red-50 dark:bg-red-950/40 p-3 space-y-2 text-xs">
      <div className="font-bold text-red-700 dark:text-red-300">Emergência</div>
      <a href="tel:190" className="flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-red-600 text-white font-bold">
        <Phone className="w-4 h-4" />
        Ligar 190 (Polícia)
      </a>
      <button
        type="button"
        disabled={busy || sent}
        onClick={() => void send()}
        className="w-full min-h-[40px] rounded-xl border border-red-400 text-red-700 dark:text-red-300 font-bold disabled:opacity-70 cursor-pointer"
      >
        {sent ? 'Central Froc avisada ✔' : busy ? 'Enviando alerta...' : 'Avisar a central Froc (envia localização e dados da viagem)'}
      </button>
      <button
        type="button"
        onClick={() => void share()}
        className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
      >
        <Share2 className="w-4 h-4" />
        Compartilhar viagem com alguém de confiança
      </button>
      <button type="button" onClick={() => setOpen(false)} className="w-full text-slate-500 cursor-pointer">
        Fechar
      </button>
    </div>
  );
};
