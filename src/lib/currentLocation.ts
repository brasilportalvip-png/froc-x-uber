import type { GeoPoint } from '../types/mobility.ts';

/**
 * Localização atual da pessoa (GPS do celular; no computador, Wi-Fi/rede) e o endereço
 * dela em texto, para já abrir o app com o ponto A no lugar certo.
 */

export const LOCATING_NAME = 'Localizando você...';

/** Destino ainda não escolhido (B vazio): mesmo ponto da partida, só para o mapa ter onde ficar. */
export const UNSET_DEST_ID = 'choose-destination';
export const UNSET_DEST_NAME = 'Para onde vamos? Escolha o destino (B)';
export function unsetDestination(near: { lat: number; lng: number; city?: string; state?: string }): GeoPoint {
  return { id: UNSET_DEST_ID, name: UNSET_DEST_NAME, city: near.city || '', state: near.state || '', zone: 'urban', lat: near.lat, lng: near.lng, kind: 'avenue' };
}
export const isUnsetDestination = (p: { id: string }) => p.id === UNSET_DEST_ID;

/** Espera o Google Maps terminar de carregar (até alguns segundos). */
async function waitForGoogle(ms = 6000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const g = (globalThis as { google?: { maps?: { importLibrary?: unknown } } }).google;
    if (g?.maps?.importLibrary) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export function getCurrentCoords(timeoutMs = 15000): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('sem_gps'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'negado' : 'indisponivel')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

type AddressPart = { long_name?: string; short_name?: string; longText?: string | null; shortText?: string | null; types?: string[] };

function pick(parts: AddressPart[], type: string, short = false) {
  const p = parts.find((x) => x.types?.includes(type));
  if (!p) return '';
  return (short ? p.short_name ?? p.shortText : p.long_name ?? p.longText) || '';
}

/** Monta "Rua X, 123 - Bairro" + cidade/UF a partir dos componentes do Google. */
export function addressFromParts(parts: AddressPart[], fallback: string) {
  const street = pick(parts, 'route');
  const number = pick(parts, 'street_number');
  const district = pick(parts, 'sublocality_level_1') || pick(parts, 'sublocality') || pick(parts, 'neighborhood');
  const city = pick(parts, 'administrative_area_level_2') || pick(parts, 'locality');
  const state = pick(parts, 'administrative_area_level_1', true).slice(0, 2).toUpperCase();
  const line = street ? `${street}${number ? `, ${number}` : ''}${district ? ` - ${district}` : ''}` : fallback;
  return { name: line || fallback, city: city || 'Sua cidade', state: state || 'BR' };
}

/**
 * Endereço do ponto (lat/lng). Tenta o Geocoder do Google; se a chave não tiver a API de
 * Geocoding, usa o lugar mais próximo do Places; se nada der, fica "Minha localização atual".
 */
export async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; city: string; state: string }> {
  const fallback = { name: 'Minha localização atual', city: 'Sua cidade', state: 'BR' };
  await waitForGoogle();
  const g = (globalThis as { google?: { maps?: { importLibrary?: (n: string) => Promise<unknown> } } }).google;
  if (!g?.maps?.importLibrary) return fallback;
  try {
    const { Geocoder } = (await g.maps.importLibrary('geocoding')) as { Geocoder: new () => { geocode: (r: unknown) => Promise<{ results: { address_components: AddressPart[]; formatted_address: string }[] }> } };
    const { results } = await new Geocoder().geocode({ location: { lat, lng }, language: 'pt-BR', region: 'BR' });
    const best = results?.[0];
    if (best) return addressFromParts(best.address_components, best.formatted_address.split(',')[0] || fallback.name);
  } catch {
    /* Geocoding API desligada na chave: tenta o Places */
  }
  try {
    const { Place } = (await g.maps.importLibrary('places')) as {
      Place: { searchNearby: (r: unknown) => Promise<{ places: { formattedAddress?: string; displayName?: string; addressComponents?: AddressPart[] }[] }> };
    };
    const { places } = await Place.searchNearby({
      fields: ['displayName', 'formattedAddress', 'addressComponents'],
      locationRestriction: { center: { lat, lng }, radius: 60 },
      maxResultCount: 1,
      rankPreference: 'DISTANCE',
      language: 'pt-BR',
      region: 'br',
    });
    const p = places?.[0];
    if (p) {
      const parsed = addressFromParts(p.addressComponents || [], p.formattedAddress?.split(',')[0] || fallback.name);
      return { ...parsed, name: `Perto de ${p.displayName || parsed.name}` };
    }
  } catch {
    /* sem Places */
  }
  return fallback;
}

export async function currentLocationPoint(): Promise<GeoPoint> {
  const { lat, lng } = await getCurrentCoords();
  const addr = await reverseGeocode(lat, lng);
  return { id: `gps-${Date.now()}`, name: addr.name, city: addr.city, state: addr.state, zone: 'urban', lat, lng, kind: 'avenue' };
}
