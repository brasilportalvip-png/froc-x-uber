import React, { useEffect, useRef, useState } from 'react';
import { AdvancedMarker } from '@vis.gl/react-google-maps';

type LatLng = { lat: number; lng: number };

/** Direção (graus, 0 = norte) entre dois pontos. */
export function bearingBetween(a: LatLng, b: LatLng) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Desenho do veículo visto de cima (aponta para o norte; o marcador gira pela direção). */
const VehicleIcon: React.FC<{ kind: 'carro' | 'moto' | 'carga'; highlight: boolean }> = ({ kind, highlight }) => {
  const body = highlight ? '#ff2d95' : '#f5f5f5';
  const trim = highlight ? '#d4af37' : '#1a1a1a';
  if (kind === 'moto')
    return (
      <svg width="18" height="34" viewBox="0 0 18 34" aria-hidden>
        <rect x="6" y="1" width="6" height="8" rx="3" fill={trim} />
        <rect x="4" y="8" width="10" height="16" rx="5" fill={body} stroke={trim} strokeWidth="1.5" />
        <circle cx="9" cy="15" r="3.2" fill={trim} />
        <rect x="6" y="24" width="6" height="9" rx="3" fill={trim} />
      </svg>
    );
  if (kind === 'carga')
    return (
      <svg width="26" height="46" viewBox="0 0 26 46" aria-hidden>
        <rect x="3" y="1" width="20" height="11" rx="3" fill={body} stroke={trim} strokeWidth="1.5" />
        <rect x="6" y="3" width="14" height="4" rx="1.5" fill={trim} opacity=".75" />
        <rect x="2" y="13" width="22" height="32" rx="2" fill={highlight ? '#d4af37' : '#d4d4d8'} stroke={trim} strokeWidth="1.5" />
      </svg>
    );
  return (
    <svg width="22" height="40" viewBox="0 0 22 40" aria-hidden>
      <rect x="2" y="1" width="18" height="38" rx="7" fill={body} stroke={trim} strokeWidth="1.5" />
      <path d="M5 11 Q11 7 17 11 L16 16 H6 Z" fill={trim} opacity=".85" />
      <path d="M6 29 H16 L17 33 Q11 36 5 33 Z" fill={trim} opacity=".7" />
      <rect x="5" y="17" width="12" height="11" rx="2" fill={body} opacity=".9" />
      <rect x="3.5" y="2.5" width="4" height="2" rx="1" fill="#fff7c2" />
      <rect x="14.5" y="2.5" width="4" height="2" rx="1" fill="#fff7c2" />
    </svg>
  );
};

interface Props {
  position: LatLng;
  heading?: number | null;
  kind?: 'carro' | 'moto' | 'carga';
  /** Destaque (rosa/dourado): o carro do SEU motorista. */
  highlight?: boolean;
  title: string;
  /** Tempo do deslizamento entre uma posição e a próxima (≈ intervalo entre atualizações). */
  durationMs?: number;
}

/**
 * Carrinho que desliza suavemente de uma posição para a outra e gira na direção em que está
 * andando — como no Uber. A posição muda direto no marcador do Google (sem redesenhar a tela
 * 60 vezes por segundo).
 */
export const AnimatedVehicleMarker: React.FC<Props> = ({ position, heading, kind = 'carro', highlight = false, title, durationMs = 4000 }) => {
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const current = useRef<LatLng>(position);
  const frame = useRef(0);
  const [angle, setAngle] = useState<number>(typeof heading === 'number' ? heading : 0);
  const [fallback, setFallback] = useState<LatLng>(position);

  useEffect(() => {
    const from = { ...current.current };
    const to = { lat: position.lat, lng: position.lng };
    const moved = Math.abs(from.lat - to.lat) + Math.abs(from.lng - to.lng);
    if (typeof heading === 'number') setAngle(heading);
    else if (moved > 0.00008) setAngle(bearingBetween(from, to));
    cancelAnimationFrame(frame.current);
    // Pulo grande (GPS voltou depois de muito tempo): vai direto, sem atravessar a cidade.
    if (moved > 0.05 || moved === 0) {
      current.current = to;
      if (markerRef.current) markerRef.current.position = to;
      else setFallback(to);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / durationMs);
      const p = { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
      current.current = p;
      if (markerRef.current) markerRef.current.position = p;
      else if (k === 1 || Math.round(k * 100) % 7 === 0) setFallback(p);
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame.current);
    };
  }, [position.lat, position.lng, heading, durationMs]);

  return (
    <AdvancedMarker
      ref={(m: google.maps.marker.AdvancedMarkerElement | null) => {
        markerRef.current = m;
      }}
      // Enquanto o marcador do Google existe, a posição anda direto nele (o "fallback" fica parado
      // e o React não reposiciona). Sem acesso ao marcador, o fallback é atualizado aos poucos.
      position={fallback}
      title={title}
      zIndex={highlight ? 50 : 10}
    >
      <div
        style={{
          transform: `rotate(${angle}deg)`,
          transition: 'transform 600ms ease-out',
          filter: highlight ? 'drop-shadow(0 0 6px rgba(255,45,149,.9))' : 'drop-shadow(0 2px 3px rgba(0,0,0,.55))',
        }}
      >
        <VehicleIcon kind={kind} highlight={highlight} />
      </div>
    </AdvancedMarker>
  );
};
