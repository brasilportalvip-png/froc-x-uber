import React from 'react';
import { ArrowUpDown, MapPin } from 'lucide-react';
import { BRAZIL_LOCATIONS } from '../data/locations.ts';
import type { GeoPoint } from '../types/mobility.ts';
import { PlaceSearchInput } from './PlaceSearchInput.tsx';

interface LocationSelectorProps {
  origin: GeoPoint;
  destination: GeoPoint;
  zoneFilter?: 'all' | 'urban' | 'intercity';
  mapsEnabled?: boolean;
  onChangeOrigin: (point: GeoPoint) => void;
  onChangeDestination: (point: GeoPoint) => void;
  onSwap: () => void;
}

export const LocationSelector: React.FC<LocationSelectorProps> = ({
  origin,
  destination,
  zoneFilter = 'all',
  mapsEnabled = false,
  onChangeOrigin,
  onChangeDestination,
  onSwap,
}) => {
  const options =
    zoneFilter === 'all' ? BRAZIL_LOCATIONS : BRAZIL_LOCATIONS.filter((l) => l.zone === zoneFilter);

  const originOptions = options.some((o) => o.id === origin.id) ? options : [origin, ...options];
  const destOptions = options.some((o) => o.id === destination.id) ? options : [destination, ...options];

  return (
    <div className="relative rounded-2xl bg-slate-100/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3 space-y-2">
      <div className="flex items-center gap-2.5 pr-10">
        <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          A
        </span>
        <div className="flex-1 min-w-0 space-y-1.5">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Ponto de partida
          </label>
          <select
            value={origin.id}
            onChange={(e) => {
              const found = BRAZIL_LOCATIONS.find((l) => l.id === e.target.value);
              if (found) onChangeOrigin(found);
            }}
            className="w-full min-h-[34px] bg-transparent text-sm font-semibold text-slate-900 dark:text-white focus:outline-none truncate cursor-pointer"
          >
            {originOptions.map((loc) => (
              <option key={loc.id} value={loc.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                {loc.name} ({loc.city}/{loc.state})
              </option>
            ))}
          </select>
          {mapsEnabled && (
            <PlaceSearchInput
              placeholder="Buscar qualquer endereço de partida..."
              onSelectPlace={onChangeOrigin}
            />
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 ml-8" />

      <div className="flex items-center gap-2.5 pr-10">
        <span className="w-6 h-6 rounded-full bg-slate-900 dark:bg-sky-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          B
        </span>
        <div className="flex-1 min-w-0 space-y-1.5">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Para onde vamos?
          </label>
          <select
            value={destination.id}
            onChange={(e) => {
              const found = BRAZIL_LOCATIONS.find((l) => l.id === e.target.value);
              if (found) onChangeDestination(found);
            }}
            className="w-full min-h-[34px] bg-transparent text-sm font-semibold text-slate-900 dark:text-white focus:outline-none truncate cursor-pointer"
          >
            {destOptions.map((loc) => (
              <option key={loc.id} value={loc.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                {loc.name} ({loc.city}/{loc.state})
              </option>
            ))}
          </select>
          {mapsEnabled && (
            <PlaceSearchInput
              placeholder="Buscar qualquer endereço de destino..."
              onSelectPlace={onChangeDestination}
            />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onSwap}
        title="Inverter origem e destino"
        aria-label="Inverter origem e destino"
        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 shadow-xs transition cursor-pointer"
      >
        <ArrowUpDown className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
        <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span>Você também pode clicar em Marcar A / B diretamente no mapa.</span>
      </div>
    </div>
  );
};
