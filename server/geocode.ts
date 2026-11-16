/**
 * Geocodificação no servidor (endereço → latitude/longitude), usada pela API de entregas
 * quando o sistema da loja só tem o endereço em texto.
 *
 * Precisa de uma chave do Google SEM restrição de site (as chaves do navegador são
 * restritas ao domínio e não funcionam aqui): variável GOOGLE_SERVER_MAPS_KEY, com
 * restrição de API só para "Geocoding API". Sem a chave, a API pede latitude/longitude.
 */
export interface GeocodeResult {
  lat: number;
  lng: number;
  name: string;
  city: string;
  state: string;
}

export type Geocoder = (address: string) => Promise<GeocodeResult | null>;

export function createGoogleGeocoder(apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Geocoder | undefined {
  if (!apiKey) return undefined;
  return async (address: string) => {
    const url =
      'https://maps.googleapis.com/maps/api/geocode/json?' +
      new URLSearchParams({ address, region: 'br', language: 'pt-BR', components: 'country:BR', key: apiKey }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        status: string;
        results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } }; address_components: { long_name: string; short_name: string; types: string[] }[] }[];
      };
      const r = json.results?.[0];
      if (json.status !== 'OK' || !r) return null;
      const comp = (type: string, short = false) => {
        const c = r.address_components.find((x) => x.types.includes(type));
        return c ? (short ? c.short_name : c.long_name) : '';
      };
      return {
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        name: r.formatted_address.replace(/, Brasil$|, Brazil$/, ''),
        city: comp('administrative_area_level_2') || comp('locality'),
        state: comp('administrative_area_level_1', true),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
