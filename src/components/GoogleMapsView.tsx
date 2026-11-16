import { isUnsetDestination, isOriginPending } from '../lib/currentLocation.ts';
import React, { useEffect, useRef, useState } from 'react';
import { AdvancedMarker, Map as GoogleMap, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { LocateFixed, Navigation } from 'lucide-react';
import type { AppModule, GeoPoint, NearbyDriver } from '../types/mobility.ts';
import { AnimatedVehicleMarker } from './VehicleMarker.tsx';

interface GoogleMapsViewProps {
  activeModule: AppModule;
  origin: GeoPoint;
  destination: GeoPoint;
  isDark: boolean;
  activeTripStatus?: string;
  onRouteTelemetry?: (distanceKm: number, durationMin: number) => void;
  onSelectLocationFromMap?: (point: GeoPoint, target: 'origin' | 'destination') => void;
  /** Posição real do motorista da corrida em andamento. */
  driverPoint?: { lat: number; lng: number; heading?: number } | null;
  /** Moto ou carro do motorista da corrida (ícone). */
  driverKind?: 'carro' | 'moto';
  /** Motoristas online por perto (antes de pedir), como no Uber. */
  nearbyDrivers?: NearbyDriver[];
}

const RouteLayer: React.FC<{
  origin: GeoPoint;
  destination: GeoPoint;
  activeModule: AppModule;
  onRouteTelemetry?: (distanceKm: number, durationMin: number) => void;
  onRouteError?: (msg: string | null) => void;
}> = ({ origin, destination, activeModule, onRouteTelemetry, onRouteError }) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!routesLib || !map) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    onRouteError?.(null);

    // Ainda sem localização: mapa do Brasil, sem ponto A inventado.
    if (isOriginPending(origin)) {
      onRouteTelemetry?.(0, 0);
      map.panTo({ lat: origin.lat, lng: origin.lng });
      map.setZoom(4);
      return;
    }
    // Sem destino ainda: mostra a pessoa onde ela está (ponto A), bem de perto.
    if (isUnsetDestination(destination)) {
      onRouteTelemetry?.(0, 0);
      map.panTo({ lat: origin.lat, lng: origin.lng });
      map.setZoom(16);
      return;
    }

    const strokeColor =
      activeModule === 'freight' ? '#D97706' : activeModule === 'indrive' ? '#0284C7' : '#059669';

    const request = {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    };

    const RouteClass = (routesLib as unknown as {
      Route: {
        computeRoutes: (req: typeof request) => Promise<{
          routes?: Array<{
            distanceMeters?: number;
            durationMillis?: number;
            viewport?: google.maps.LatLngBounds | google.maps.LatLngBoundsLiteral;
            createPolylines: () => google.maps.Polyline[];
          }>;
        }>;
      };
    }).Route;

    if (!RouteClass?.computeRoutes) return;

    let cancelled = false;

    RouteClass.computeRoutes(request)
      .then(({ routes }) => {
        if (cancelled || !routes || routes.length === 0) return;
        const primaryRoute = routes[0];
        const created = primaryRoute.createPolylines();
        created.forEach((poly) => {
          poly.setOptions({
            strokeColor,
            strokeWeight: 6,
            strokeOpacity: 0.92,
          });
          poly.setMap(map);
        });
        polylinesRef.current = created;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport, 64);
        }

        if (primaryRoute.distanceMeters && primaryRoute.durationMillis) {
          const km = Math.round((primaryRoute.distanceMeters / 1000) * 10) / 10;
          const mins = Math.max(3, Math.round(primaryRoute.durationMillis / 60000));
          onRouteTelemetry?.(km, mins);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Error computing route:', err);
        onRouteError?.('Não foi possível calcular a rota rodoviária neste trecho.');
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [routesLib, map, origin.id, origin.lat, origin.lng, destination.lat, destination.lng, activeModule]);

  return null;
};

export const GoogleMapsView: React.FC<GoogleMapsViewProps> = ({
  activeModule,
  origin,
  destination,
  isDark,
  activeTripStatus,
  onRouteTelemetry,
  onSelectLocationFromMap,
  driverPoint,
  driverKind = 'carro',
  nearbyDrivers = [] as NearbyDriver[],
}) => {
  const map = useMap();
  const [pickTarget, setPickTarget] = useState<'origin' | 'destination' | null>(null);
  const [userGPS, setUserGPS] = useState<{ lat: number; lng: number } | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const handleLocateMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserGPS(coords);
        if (map) {
          map.panTo(coords);
          map.setZoom(14);
        }
      },
      () => {
        if (map) {
          map.panTo({ lat: origin.lat, lng: origin.lng });
          map.setZoom(13);
        }
      },
      { timeout: 5000 }
    );
  };

  return (
    <div className="relative w-full h-full min-h-[260px]">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={{ lat: origin.lat, lng: origin.lng }}
        defaultZoom={isOriginPending(origin) ? 4 : 12}
        gestureHandling="greedy"
        disableDefaultUI={false}
        streetViewControl={false}
        mapTypeControl={false}
        colorScheme={isDark ? 'DARK' : 'LIGHT'}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
        onClick={(e) => {
          if (!pickTarget || !onSelectLocationFromMap || !e.detail.latLng) return;
          const { lat, lng } = e.detail.latLng;
          onSelectLocationFromMap(
            {
              id: `pin-${Date.now()}`,
              name: `Ponto no mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
              city: 'Local Selecionado',
              state: 'BR',
              zone: activeModule === 'carpool' || activeModule === 'freight' ? 'intercity' : 'urban',
              lat,
              lng,
              kind: 'avenue',
            },
            pickTarget
          );
          setPickTarget(null);
        }}
      >
        <RouteLayer
          origin={origin}
          destination={destination}
          activeModule={activeModule}
          onRouteTelemetry={onRouteTelemetry}
          onRouteError={setRouteError}
        />

        {!isOriginPending(origin) && (
          <AdvancedMarker position={{ lat: origin.lat, lng: origin.lng }} title={`Partida: ${origin.name}`}>
            <Pin background="#059669" borderColor="#FFFFFF" glyphColor="#FFFFFF" glyphText="A" />
          </AdvancedMarker>
        )}

        {!isUnsetDestination(destination) && (
          <AdvancedMarker position={{ lat: destination.lat, lng: destination.lng }} title={`Destino: ${destination.name}`}>
            <Pin background="#0F172A" borderColor="#FFFFFF" glyphColor="#FFFFFF" glyphText="B" />
          </AdvancedMarker>
        )}

        {!driverPoint &&
          nearbyDrivers.map((d) => (
            <AnimatedVehicleMarker
              key={d.id}
              position={{ lat: d.lat, lng: d.lng }}
              heading={d.heading}
              kind={d.kind}
              durationMs={6000}
              title={d.kind === 'moto' ? 'Moto disponível por perto' : d.kind === 'carga' ? 'Veículo de carga por perto' : 'Motorista disponível por perto'}
            />
          ))}

        {driverPoint && (
          <AnimatedVehicleMarker
            position={{ lat: driverPoint.lat, lng: driverPoint.lng }}
            heading={driverPoint.heading}
            kind={driverKind}
            highlight
            durationMs={4500}
            title="Seu motorista (ao vivo)"
          />
        )}

        {userGPS && (
          <AdvancedMarker position={userGPS} title="Sua localização atual">
            <Pin background="#2563EB" borderColor="#FFFFFF" glyphColor="#FFFFFF" glyphText="Eu" />
          </AdvancedMarker>
        )}
      </GoogleMap>

      {/* Top Route Summary HUD */}
      <div className="absolute top-3 left-3 right-16 pointer-events-none flex flex-wrap items-center gap-2 z-10">
        <div className="pointer-events-auto inline-flex items-center gap-2.5 rounded-xl bg-white/95 dark:bg-[#111013]/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 px-3.5 py-2 shadow-sm text-xs">
          <Navigation className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[140px] sm:max-w-xs">
            {origin.zone === 'intercity' ? origin.city : origin.name.split('·')[0]}
          </span>
          <span className="text-slate-400">→</span>
          <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[140px] sm:max-w-xs">
            {isUnsetDestination(destination) ? 'Escolha o destino' : destination.zone === 'intercity' ? destination.city : destination.name.split('·')[0]}
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
          <div className="pointer-events-auto hidden sm:inline-flex items-center gap-1 rounded-xl bg-white/95 dark:bg-[#111013]/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-1 shadow-sm">
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

      {/* GPS Locate Button */}
      <button
        type="button"
        onClick={handleLocateMe}
        className="absolute top-3 right-3 z-10 w-10 h-10 rounded-xl bg-white/95 dark:bg-[#111013]/95 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm cursor-pointer"
        aria-label="Centralizar no meu GPS"
      >
        <LocateFixed className="w-4 h-4" />
      </button>

      {routeError && (
        <div className="absolute bottom-4 left-4 z-10 rounded-xl bg-amber-50 dark:bg-amber-950/90 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 px-3.5 py-2 text-xs font-medium shadow-md">
          {routeError}
        </div>
      )}
    </div>
  );
};
