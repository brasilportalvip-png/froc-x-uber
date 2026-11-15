import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, LocateFixed, Minus, Plus, Navigation } from 'lucide-react';
import { BRAZIL_LOCATIONS } from '../data/locations.ts';
import type { AppModule, GeoPoint } from '../types/mobility.ts';

interface InteractiveMapProps {
  activeModule: AppModule;
  origin: GeoPoint;
  destination: GeoPoint;
  isDark: boolean;
  activeTripStatus?: string;
  onSelectLocationFromMap?: (point: GeoPoint, target: 'origin' | 'destination') => void;
}

interface SimVehicle {
  id: string;
  kind: 'car' | 'moto' | 'carpool' | 'truck';
  lat: number;
  lng: number;
  vx: number;
  vy: number;
  label: string;
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  activeModule,
  origin,
  destination,
  isDark,
  activeTripStatus,
  onSelectLocationFromMap,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isIntercityView =
    activeModule === 'carpool' ||
    activeModule === 'freight' ||
    origin.zone === 'intercity' ||
    destination.zone === 'intercity';

  const [zoom, setZoom] = useState<number>(isIntercityView ? 1.0 : 4.2);
  const [center, setCenter] = useState<{ lat: number; lng: number }>({
    lat: (origin.lat + destination.lat) / 2,
    lng: (origin.lng + destination.lng) / 2,
  });
  const [pickTarget, setPickTarget] = useState<'origin' | 'destination' | null>(null);
  const [userGPS, setUserGPS] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);

  const dragRef = useRef<{ dragging: boolean; lastX: number; lastY: number }>({
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  // Sync map framing when switching between urban and intercity routes
  useEffect(() => {
    const midLat = (origin.lat + destination.lat) / 2;
    const midLng = (origin.lng + destination.lng) / 2;
    setCenter({ lat: midLat, lng: midLng });
    const spread = Math.max(Math.abs(origin.lat - destination.lat), Math.abs(origin.lng - destination.lng));
    if (spread > 2.5) setZoom(0.65);
    else if (spread > 0.7) setZoom(1.45);
    else if (spread > 0.2) setZoom(3.2);
    else setZoom(5.0);
  }, [origin.id, destination.id, activeModule]);

  const vehicles = useMemo<SimVehicle[]>(() => {
    const list: SimVehicle[] = [];
    const urbanPoints = BRAZIL_LOCATIONS.filter((l) => l.zone === 'urban');
    const interPoints = BRAZIL_LOCATIONS.filter((l) => l.zone === 'intercity');

    urbanPoints.slice(0, 8).forEach((p, idx) => {
      list.push({
        id: `u-car-${idx}`,
        kind: idx % 3 === 0 ? 'moto' : 'car',
        lat: p.lat + (idx % 2 === 0 ? 0.012 : -0.014),
        lng: p.lng + (idx % 2 === 0 ? -0.01 : 0.015),
        vx: (idx % 2 === 0 ? 1 : -1) * 0.00022,
        vy: (idx % 3 === 0 ? -1 : 1) * 0.00018,
        label: idx % 3 === 0 ? 'Moto' : 'Froc',
      });
    });

    interPoints.slice(0, 6).forEach((p, idx) => {
      list.push({
        id: `h-trk-${idx}`,
        kind: idx % 2 === 0 ? 'truck' : 'carpool',
        lat: p.lat + (idx % 2 === 0 ? 0.15 : -0.12),
        lng: p.lng + (idx % 2 === 0 ? -0.18 : 0.14),
        vx: (idx % 2 === 0 ? 1 : -1) * 0.0014,
        vy: (idx % 3 === 0 ? 1 : -1) * 0.0011,
        label: idx % 2 === 0 ? 'Vazio' : 'Carona',
      });
    });
    return list;
  }, []);

  // Animation loop
  useEffect(() => {
    let rafId = 0;
    let tick = 0;

    const project = (lat: number, lng: number, width: number, height: number) => {
      const scale = 68 * zoom;
      const x = width / 2 + (lng - center.lng) * scale;
      const y = height / 2 - (lat - center.lat) * scale * 1.08;
      return { x, y };
    };

    const render = () => {
      tick += 0.025;
      const canvas = canvasRef.current;
      const box = containerRef.current;
      if (!canvas || !box) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Background canvas
      ctx.fillStyle = isDark ? '#0D131F' : '#EEF2F6';
      ctx.fillRect(0, 0, width, height);

      // Cartographic Grid & Urban Blocks
      const gridStepDeg = zoom > 3 ? 0.02 : zoom > 1.2 ? 0.25 : 1.0;
      const minLng = center.lng - width / (2 * 68 * zoom) - gridStepDeg;
      const maxLng = center.lng + width / (2 * 68 * zoom) + gridStepDeg;
      const minLat = center.lat - height / (2 * 68 * zoom * 1.08) - gridStepDeg;
      const maxLat = center.lat + height / (2 * 68 * zoom * 1.08) + gridStepDeg;

      ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(100, 116, 139, 0.13)';
      ctx.lineWidth = 1;

      const startLng = Math.floor(minLng / gridStepDeg) * gridStepDeg;
      for (let lng = startLng; lng <= maxLng; lng += gridStepDeg) {
        const p1 = project(minLat, lng, width, height);
        const p2 = project(maxLat, lng, width, height);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      const startLat = Math.floor(minLat / gridStepDeg) * gridStepDeg;
      for (let lat = startLat; lat <= maxLat; lat += gridStepDeg) {
        const p1 = project(lat, minLng, width, height);
        const p2 = project(lat, maxLng, width, height);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // Stylized Arterial Corridors / Highways (BR-116, Dutra, Bandeirantes, Anchieta)
      const corridors: [string, string][] = [
        ['sp-paulista', 'sp-pinheiros'],
        ['sp-paulista', 'sp-tiete'],
        ['sp-paulista', 'sp-cgh'],
        ['sp-tiete', 'sp-gru'],
        ['sp-faria-lima', 'sp-morumbi'],
        ['sp-paulista', 'br-sjc'],
        ['br-sjc', 'br-rio'],
        ['sp-barra-funda', 'br-campinas'],
        ['br-campinas', 'br-ribeirao'],
        ['br-ribeirao', 'br-goiania'],
        ['br-goiania', 'br-brasilia'],
        ['sp-morumbi', 'br-curitiba'],
        ['br-curitiba', 'br-florianopolis'],
        ['br-florianopolis', 'br-poa'],
        ['sp-santo-andre', 'br-santos'],
        ['sp-gru', 'br-bh'],
      ];

      ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(15, 23, 42, 0.14)';
      ctx.lineWidth = zoom > 2.5 ? 4 : 2.5;
      ctx.lineCap = 'round';
      corridors.forEach(([aId, bId]) => {
        const a = BRAZIL_LOCATIONS.find((l) => l.id === aId);
        const b = BRAZIL_LOCATIONS.find((l) => l.id === bId);
        if (!a || !b) return;
        const pa = project(a.lat, a.lng, width, height);
        const pb = project(b.lat, b.lng, width, height);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      });

      // Green urban park patches around Paulista/Ibirapuera & Serra do Mar
      const parks = [
        { lat: -23.5874, lng: -46.6576, r: 0.015 },
        { lat: -23.555, lng: -46.662, r: 0.008 },
        { lat: -23.82, lng: -46.46, r: 0.12 },
      ];
      parks.forEach((pk) => {
        const p = project(pk.lat, pk.lng, width, height);
        const rad = pk.r * 68 * zoom;
        if (rad > 4) {
          ctx.fillStyle = isDark ? 'rgba(16, 185, 129, 0.09)' : 'rgba(16, 185, 129, 0.14)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Draw location nodes
      BRAZIL_LOCATIONS.forEach((loc) => {
        if (zoom < 1.8 && loc.zone === 'urban' && loc.id !== 'sp-paulista' && loc.id !== origin.id && loc.id !== destination.id) {
          return;
        }
        const pt = project(loc.lat, loc.lng, width, height);
        if (pt.x < -60 || pt.x > width + 60 || pt.y < -60 || pt.y > height + 60) return;

        ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.45)' : 'rgba(71, 85, 105, 0.45)';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        if (loc.id !== origin.id && loc.id !== destination.id) {
          ctx.font = '500 11px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = isDark ? 'rgba(203, 213, 225, 0.72)' : 'rgba(30, 41, 59, 0.72)';
          ctx.fillText(loc.zone === 'intercity' ? loc.city : loc.name.split('·')[0].trim(), pt.x + 7, pt.y + 4);
        }
      });

      // Active Route Curve between Origin and Destination
      const pA = project(origin.lat, origin.lng, width, height);
      const pB = project(destination.lat, destination.lng, width, height);
      const midX = (pA.x + pB.x) / 2;
      const midY = (pA.y + pB.y) / 2;
      const dx = pB.x - pA.x;
      const dy = pB.y - pA.y;
      const ctrlX = midX - dy * 0.14;
      const ctrlY = midY + dx * 0.14;

      const routeColor =
        activeModule === 'freight' ? '#F59E0B' : activeModule === 'indrive' ? '#0EA5E9' : '#10B981';

      // Glow under route
      ctx.strokeStyle =
        activeModule === 'freight'
          ? 'rgba(245, 158, 11, 0.25)'
          : activeModule === 'indrive'
            ? 'rgba(14, 165, 233, 0.25)'
            : 'rgba(16, 185, 129, 0.28)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.quadraticCurveTo(ctrlX, ctrlY, pB.x, pB.y);
      ctx.stroke();

      // Main crisp route line
      ctx.strokeStyle = routeColor;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.quadraticCurveTo(ctrlX, ctrlY, pB.x, pB.y);
      ctx.stroke();

      // Animated pulse tracer along route
      const t = (tick * 0.35) % 1;
      const qx = (1 - t) * (1 - t) * pA.x + 2 * (1 - t) * t * ctrlX + t * t * pB.x;
      const qy = (1 - t) * (1 - t) * pA.y + 2 * (1 - t) * t * ctrlY + t * t * pB.y;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(qx, qy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = routeColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Simulated Fleet Vehicles
      vehicles.forEach((v, i) => {
        const curLat = v.lat + Math.sin(tick + i) * (v.kind === 'truck' || v.kind === 'carpool' ? 0.08 : 0.005);
        const curLng = v.lng + Math.cos(tick * 0.9 + i) * (v.kind === 'truck' || v.kind === 'carpool' ? 0.08 : 0.005);
        const vp = project(curLat, curLng, width, height);
        if (vp.x < -30 || vp.x > width + 30 || vp.y < -30 || vp.y > height + 30) return;

        ctx.save();
        ctx.translate(vp.x, vp.y);
        if (v.kind === 'truck') {
          ctx.fillStyle = '#F59E0B';
          ctx.fillRect(-7, -4, 14, 8);
          ctx.fillStyle = '#0F172A';
          ctx.fillRect(3, -3, 3, 6);
        } else if (v.kind === 'moto') {
          ctx.fillStyle = '#38BDF8';
          ctx.beginPath();
          ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = v.kind === 'carpool' ? '#10B981' : isDark ? '#F8FAFC' : '#0F172A';
          ctx.beginPath();
          ctx.roundRect(-6, -3.5, 12, 7, 2);
          ctx.fill();
        }
        ctx.restore();
      });

      // User GPS Beacon if available
      if (userGPS) {
        const gp = project(userGPS.lat, userGPS.lng, width, height);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
        ctx.beginPath();
        ctx.arc(gp.x, gp.y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2563EB';
        ctx.beginPath();
        ctx.arc(gp.x, gp.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Origin Pin (A)
      const drawPin = (px: number, py: number, label: string, sub: string, bg: string) => {
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(px, py, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 11px "Outfit", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, px, py + 4);
        ctx.textAlign = 'left';

        // Crisp label tag
        const textWidth = ctx.measureText(sub).width;
        const bx = px + 16;
        const by = py - 11;
        ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.94)';
        ctx.beginPath();
        ctx.roundRect(bx, by, textWidth + 16, 22, 6);
        ctx.fill();
        ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(15, 23, 42, 0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isDark ? '#F8FAFC' : '#0F172A';
        ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(sub, bx + 8, by + 15);
      };

      drawPin(pA.x, pA.y, 'A', origin.zone === 'intercity' ? origin.city : origin.name.split('·')[0].trim(), '#10B981');
      drawPin(pB.x, pB.y, 'B', destination.zone === 'intercity' ? destination.city : destination.name.split('·')[0].trim(), '#0F172A');

      ctx.restore();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [zoom, center, origin, destination, isDark, activeModule, vehicles, userGPS]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!pickTarget || !onSelectLocationFromMap || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const scale = 68 * zoom;
    const clickLng = center.lng + (clickX - rect.width / 2) / scale;
    const clickLat = center.lat - (clickY - rect.height / 2) / (scale * 1.08);

    // Find closest known hub
    let best = BRAZIL_LOCATIONS[0];
    let bestDist = Infinity;
    BRAZIL_LOCATIONS.forEach((loc) => {
      const d = Math.hypot(loc.lat - clickLat, loc.lng - clickLng);
      if (d < bestDist) {
        bestDist = d;
        best = loc;
      }
    });
    onSelectLocationFromMap(best, pickTarget);
    setPickTarget(null);
  };

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      setGpsNotice('GPS indisponível neste dispositivo — centralizado em São Paulo.');
      setCenter({ lat: origin.lat, lng: origin.lng });
      setTimeout(() => setGpsNotice(null), 3500);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserGPS(coords);
        setCenter(coords);
        setZoom(4.6);
        setGpsNotice('Localização GPS atualizada.');
        setTimeout(() => setGpsNotice(null), 2800);
      },
      () => {
        setCenter({ lat: origin.lat, lng: origin.lng });
        setZoom(4.6);
        setGpsNotice('Permissão GPS recusada — exibindo ponto de partida.');
        setTimeout(() => setGpsNotice(null), 3200);
      },
      { timeout: 5000 }
    );
  };

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[260px] select-none overflow-hidden">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseDown={(e) => {
          dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
        }}
        onMouseMove={(e) => {
          if (!dragRef.current.dragging) return;
          const dx = e.clientX - dragRef.current.lastX;
          const dy = e.clientY - dragRef.current.lastY;
          dragRef.current.lastX = e.clientX;
          dragRef.current.lastY = e.clientY;
          const scale = 68 * zoom;
          setCenter((prev) => ({
            lat: prev.lat + dy / (scale * 1.08),
            lng: prev.lng - dx / scale,
          }));
        }}
        onMouseUp={() => {
          dragRef.current.dragging = false;
        }}
        onMouseLeave={() => {
          dragRef.current.dragging = false;
        }}
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.15 : 0.87;
          setZoom((z) => Math.min(10, Math.max(0.45, z * factor)));
        }}
        className={`w-full h-full block ${pickTarget ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      />

      {/* Top Left Route Summary HUD */}
      <div className="absolute top-3 left-3 right-16 pointer-events-none flex flex-wrap items-center gap-2">
        <div className="pointer-events-auto inline-flex items-center gap-2.5 rounded-xl bg-white/95 dark:bg-[#131924]/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 px-3.5 py-2 shadow-sm text-xs">
          <Navigation className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[140px] sm:max-w-xs">
            {origin.zone === 'intercity' ? origin.city : origin.name.split('·')[0]}
          </span>
          <span className="text-slate-400">→</span>
          <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[140px] sm:max-w-xs">
            {destination.zone === 'intercity' ? destination.city : destination.name.split('·')[0]}
          </span>
          {activeTripStatus && (
            <>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                {activeTripStatus}
              </span>
            </>
          )}
        </div>

        {onSelectLocationFromMap && (
          <div className="pointer-events-auto hidden sm:inline-flex items-center gap-1 rounded-xl bg-white/95 dark:bg-[#131924]/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setPickTarget(pickTarget === 'origin' ? null : 'origin')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                pickTarget === 'origin'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {pickTarget === 'origin' ? 'Clique no mapa (A)' : 'Marcar A'}
            </button>
            <button
              type="button"
              onClick={() => setPickTarget(pickTarget === 'destination' ? null : 'destination')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                pickTarget === 'destination'
                  ? 'bg-slate-900 dark:bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {pickTarget === 'destination' ? 'Clique no mapa (B)' : 'Marcar B'}
            </button>
          </div>
        )}
      </div>

      {/* Right Map Controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(10, z * 1.25))}
          className="w-10 h-10 rounded-xl bg-white/95 dark:bg-[#131924]/95 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm cursor-pointer"
          aria-label="Aproximar mapa"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.45, z * 0.8))}
          className="w-10 h-10 rounded-xl bg-white/95 dark:bg-[#131924]/95 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm cursor-pointer"
          aria-label="Afastar mapa"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleLocateMe}
          className="w-10 h-10 rounded-xl bg-white/95 dark:bg-[#131924]/95 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm cursor-pointer"
          aria-label="Minha localização GPS"
        >
          <LocateFixed className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setCenter({ lat: -22.5, lng: -46.8 });
            setZoom(0.65);
          }}
          className="w-10 h-10 rounded-xl bg-white/95 dark:bg-[#131924]/95 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm cursor-pointer"
          aria-label="Visão Brasil / Rodovias"
        >
          <Compass className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom Legend Strip */}
      <div className="hidden sm:flex absolute bottom-3 left-3 items-center gap-4 rounded-xl bg-white/90 dark:bg-[#131924]/90 backdrop-blur-md border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-slate-900 dark:bg-white inline-block" />
          Carros Froc
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" />
          Motos
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
          Caronas BlaBlaCar
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-xs bg-amber-500 inline-block" />
          Caminhões Retorno Vazio
        </span>
      </div>

      {gpsNotice && (
        <div className="absolute bottom-3 right-3 rounded-xl bg-slate-900 text-white px-3.5 py-2 text-xs font-medium shadow-lg">
          {gpsNotice}
        </div>
      )}
    </div>
  );
};
