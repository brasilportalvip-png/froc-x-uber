import React, { useEffect, useRef, useState } from 'react';
import { APIProvider, AdvancedMarker, Map as GoogleMap, Pin, useMap } from '@vis.gl/react-google-maps';
import type { TrackView } from '../types/mobility.ts';
import { AnimatedVehicleMarker } from './VehicleMarker.tsx';

/** Segue o carro no mapa (até a pessoa mexer no mapa com o dedo). */
const Follow: React.FC<{ track: TrackView; follow: boolean }> = ({ track, follow }) => {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!map) return;
    if (track.location && follow) {
      map.panTo({ lat: track.location.lat, lng: track.location.lng });
      if (!fitted.current) map.setZoom(15);
      fitted.current = true;
      return;
    }
    if (!fitted.current) {
      const b = new google.maps.LatLngBounds();
      b.extend({ lat: track.origin.lat, lng: track.origin.lng });
      b.extend({ lat: track.destination.lat, lng: track.destination.lng });
      map.fitBounds(b, 60);
      fitted.current = true;
    }
  }, [map, track.location?.lat, track.location?.lng, follow]);
  return null;
};

/**
 * Página pública /acompanhar/:token — a família (ou o cliente da loja) acompanha a viagem
 * ao vivo sem login. Mostra só o necessário: situação, trajeto, primeiro nome do motorista,
 * carro e placa. Sem telefones, e-mails ou valores.
 */
export const TrackPage: React.FC<{ token: string }> = ({ token }) => {
  const [track, setTrack] = useState<TrackView | null>(null);
  const [error, setError] = useState('');
  const [mapsKey, setMapsKey] = useState('');
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    document.title = 'Acompanhar viagem · Froc X Uber';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    document.documentElement.classList.add('dark');
    fetch('/api/public-config')
      .then((r) => r.json())
      .then((c: { mapsApiKey?: string }) => setMapsKey(c.mapsApiKey || ''))
      .catch(() => undefined);
    return () => {
      meta.remove();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await fetch(`/api/track/${encodeURIComponent(token)}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setError((body as { error?: string }).error || 'Link inválido.');
          if (res.status === 404 || res.status === 410) return;
        } else {
          setError('');
          setTrack(body as TrackView);
          if (!(body as TrackView).active) return;
        }
      } catch {
        if (alive) setError('Sem conexão. Tentando de novo...');
      }
      timer = setTimeout(load, document.visibilityState === 'visible' ? 5000 : 15000);
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  const updated = track?.location?.at ? new Date(track.location.at) : null;
  const ago = updated ? Math.max(0, Math.round((Date.now() - updated.getTime()) / 1000)) : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#050505] text-slate-100">
      <header className="h-14 px-4 flex items-center justify-between border-b border-white/10">
        <a href="/" className="font-display text-lg font-extrabold froc-logo">
          Froc X Uber
        </a>
        <span className="text-[11px] text-slate-400">Acompanhamento ao vivo</span>
      </header>

      {!track && (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-slate-300">{error || 'Carregando a viagem...'}</div>
      )}

      {track && (
        <main className="flex-1 flex flex-col lg:grid lg:grid-cols-[380px_1fr]">
          <section className="p-4 space-y-3 order-2 lg:order-1">
            <div className="rounded-2xl border border-white/10 bg-[#111013] p-4 space-y-2">
              <div className={`text-xs font-bold ${track.active ? 'text-emerald-400' : 'text-slate-400'}`}>{track.statusLabel}</div>
              <h1 className="text-base font-bold">
                {track.kind === 'delivery' ? `Entrega para ${track.passengerFirstName}` : `Viagem de ${track.passengerFirstName}`}
                {track.merchantName ? ` · ${track.merchantName}` : ''}
              </h1>
              <div className="text-xs text-slate-300 space-y-1">
                <div>
                  <strong className="text-emerald-400">{track.kind === 'delivery' ? 'Coleta' : 'Partida'}:</strong> {track.origin.name}
                </div>
                <div>
                  <strong className="text-sky-400">Destino:</strong> {track.destination.name}
                </div>
              </div>
            </div>
            {track.driver && (
              <div className="rounded-2xl border border-white/10 bg-[#111013] p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">{track.driver.firstName}</div>
                  <div className="text-xs text-slate-400">
                    {track.driver.vehicle}
                    {track.driver.rating ? ` · ★ ${track.driver.rating}` : ''}
                  </div>
                </div>
                <span className="rounded-lg bg-white text-black px-2.5 py-1 text-xs font-mono-num font-bold">{track.driver.plate}</span>
              </div>
            )}
            <div className="text-[11px] text-slate-500 space-y-1">
              {track.active && ago !== null && <div>Posição atualizada há {ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`}.</div>}
              {!track.active && <div>Esta viagem terminou. O link expira em breve.</div>}
              {error && <div className="text-amber-400">{error}</div>}
              <div>Em emergência, ligue 190 (Polícia) ou 192 (SAMU).</div>
            </div>
          </section>
          <section className="relative h-[55vh] lg:h-auto order-1 lg:order-2">
            {mapsKey ? (
              <APIProvider apiKey={mapsKey} language="pt-BR" region="BR">
                <GoogleMap
                  mapId="DEMO_MAP_ID"
                  defaultCenter={{ lat: track.origin.lat, lng: track.origin.lng }}
                  defaultZoom={13}
                  gestureHandling="greedy"
                  colorScheme="DARK"
                  streetViewControl={false}
                  mapTypeControl={false}
                  onDragstart={() => setFollow(false)}
                  style={{ width: '100%', height: '100%' }}
                >
                  <Follow track={track} follow={follow} />
                  <AdvancedMarker position={{ lat: track.origin.lat, lng: track.origin.lng }} title="Partida">
                    <Pin background="#059669" borderColor="#FFFFFF" glyphColor="#FFFFFF" glyphText="A" />
                  </AdvancedMarker>
                  <AdvancedMarker position={{ lat: track.destination.lat, lng: track.destination.lng }} title="Destino">
                    <Pin background="#0F172A" borderColor="#FFFFFF" glyphColor="#FFFFFF" glyphText="B" />
                  </AdvancedMarker>
                  {track.location && (
                    <AnimatedVehicleMarker
                      position={{ lat: track.location.lat, lng: track.location.lng }}
                      heading={track.location.heading}
                      highlight
                      durationMs={4800}
                      title="Motorista (ao vivo)"
                    />
                  )}
                </GoogleMap>
              </APIProvider>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">Carregando o mapa...</div>
            )}
            {!follow && track.location && (
              <button type="button" onClick={() => setFollow(true)} className="absolute bottom-4 right-4 z-10 rounded-xl bg-white text-black px-3 py-2 text-xs font-bold shadow cursor-pointer">
                Seguir o carro
              </button>
            )}
          </section>
        </main>
      )}
    </div>
  );
};
