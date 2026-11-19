import React, { useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { MapPin } from 'lucide-react';
import { BRAZIL_LOCATIONS } from '../data/locations.ts';
import type { GeoPoint } from '../types/mobility.ts';
import { PlaceSearchInput } from './PlaceSearchInput.tsx';

interface PlacePickerProps {
  label: string;
  value: GeoPoint;
  onChange: (point: GeoPoint) => void;
  /** 'cities' = qualquer cidade do Brasil; 'address' = qualquer endereço do Brasil. */
  mode: 'cities' | 'address';
  placeholder?: string;
}

/**
 * Escolha de local em qualquer ponto do Brasil (busca do Google).
 * Se o Google Maps não carregar, mostra a lista de cidades principais como reserva.
 */
export const PlacePicker: React.FC<PlacePickerProps> = ({ label, value, onChange, mode, placeholder }) => {
  const placesLib = useMapsLibrary('places');
  const [editing, setEditing] = useState(false);
  // Sem cidade (ponto ainda não escolhido): mostra o pedido "Toque para escolher...".
  const shown = mode === 'cities' && value.city ? `${value.city}${value.state && value.state !== 'BR' ? ` · ${value.state}` : ''}` : value.name;

  if (!placesLib) {
    return (
      <div>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
        <select
          value={BRAZIL_LOCATIONS.some((l) => l.id === value.id) ? value.id : ''}
          onChange={(e) => {
            const found = BRAZIL_LOCATIONS.find((l) => l.id === e.target.value);
            if (found) onChange(found);
          }}
          className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-900 dark:text-white"
        >
          {!BRAZIL_LOCATIONS.some((l) => l.id === value.id) && <option value="">{shown}</option>}
          {BRAZIL_LOCATIONS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.city} · {l.state} — {l.name.split('·')[0]}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      {editing ? (
        <PlaceSearchInput
          mode={mode}
          placeholder={placeholder || (mode === 'cities' ? 'Digite a cidade (qualquer lugar do Brasil)' : 'Digite o endereço')}
          onSelectPlace={(p) => {
            onChange(p);
            setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 text-left text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2 cursor-pointer"
        >
          <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="flex-1 truncate">{shown}</span>
          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">Trocar</span>
        </button>
      )}
    </div>
  );
};
