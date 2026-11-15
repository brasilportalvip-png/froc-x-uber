import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Search } from 'lucide-react';
import type { GeoPoint } from '../types/mobility.ts';

interface PlaceSearchInputProps {
  placeholder: string;
  onSelectPlace: (point: GeoPoint) => void;
  /** 'cities' = só cidades (caronas, rotas de caminhão). Padrão: qualquer endereço. */
  mode?: 'address' | 'cities';
}

type AddressPart = { longText?: string | null; shortText?: string | null; types?: string[] };

/** Cidade e UF a partir dos componentes de endereço do Google. */
export function cityAndState(parts: AddressPart[] | null | undefined): { city: string; state: string } {
  const list = parts || [];
  const find = (type: string) => list.find((p) => p.types?.includes(type));
  const city = find('locality') || find('administrative_area_level_2') || find('sublocality');
  const state = find('administrative_area_level_1');
  return { city: city?.longText || '', state: (state?.shortText || '').slice(0, 2).toUpperCase() };
}

export const PlaceSearchInput: React.FC<PlaceSearchInputProps> = ({ placeholder, onSelectPlace, mode = 'address' }) => {
  const placesLib = useMapsLibrary('places');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  useEffect(() => {
    if (!placesLib || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken();
    }

    const timer = setTimeout(() => {
      AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        sessionToken: sessionTokenRef.current ?? undefined,
        includedRegionCodes: ['br'],
        ...(mode === 'cities' ? { includedPrimaryTypes: ['(cities)'] } : {}),
      })
        .then((res: { suggestions?: google.maps.places.AutocompleteSuggestion[] }) => {
          setSuggestions(res.suggestions || []);
          setOpen(true);
        })
        .catch((err: unknown) => {
          console.error('Autocomplete error:', err);
          setSuggestions([]);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [placesLib, query, mode]);

  if (!placesLib) {
    return null;
  }

  const handleSelect = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'addressComponents'],
      });
      if (place.location) {
        const lat = typeof place.location.lat === 'function' ? place.location.lat() : Number(place.location.lat);
        const lng = typeof place.location.lng === 'function' ? place.location.lng() : Number(place.location.lng);
        const { city, state } = cityAndState(place.addressComponents as AddressPart[] | undefined);
        const label =
          mode === 'cities' ? `${city || place.displayName || query}${state ? ` · ${state}` : ''}` : place.displayName || place.formattedAddress || query;
        onSelectPlace({
          id: `place-${place.id || Date.now()}`,
          name: label,
          city: city || place.formattedAddress?.split(',')[1]?.trim() || 'Brasil',
          state: state || 'BR',
          zone: mode === 'cities' ? 'intercity' : 'urban',
          lat,
          lng,
          kind: mode === 'cities' ? 'city' : 'avenue',
        });
      }
      setQuery('');
      setSuggestions([]);
      setOpen(false);
      sessionTokenRef.current = null;
    } catch (err) {
      console.error('Failed to fetch place fields:', err);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131924] px-2.5 min-h-[38px]">
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="w-full bg-transparent text-xs text-slate-900 dark:text-white focus:outline-none"
        />
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-30 max-h-48 overflow-y-auto rounded-xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-700 shadow-xl divide-y divide-slate-100 dark:divide-slate-800">
          {suggestions.map((s, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => handleSelect(s)}
                className="w-full text-left px-3 py-2.5 text-xs text-slate-800 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition cursor-pointer"
              >
                {s.placePrediction?.text.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
