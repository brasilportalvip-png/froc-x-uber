import type { GeoPoint } from '../types/mobility.ts';

/**
 * Localização atual da pessoa (GPS do celular; no computador, Wi-Fi/rede) e o endereço
 * dela em texto, para já abrir o app com o ponto A no lugar certo.
 */

export const LOCATING_NAME = 'Localizando você...';

/**
 * Sem localização (permissão negada ou GPS sem sinal): NUNCA mostra um endereço inventado.
 * O ponto A fica pedindo a localização ou que a pessoa digite onde está.
 */
export const NEED_LOCATION_ID = 'need-location';
export const NEED_LOCATION_NAME = 'Onde você está? Permita a localização ou digite o endereço';
/** Centro do Brasil, só para o mapa ter onde ficar enquanto não há localização. */
export const BRAZIL_CENTER = { lat: -14.235, lng: -51.925 };
export function needLocationPoint(): GeoPoint {
  return { id: NEED_LOCATION_ID, name: NEED_LOCATION_NAME, city: '', state: '', zone: 'urban', lat: BRAZIL_CENTER.lat, lng: BRAZIL_CENTER.lng, kind: 'avenue' };
}
export function locatingPoint(): GeoPoint {
  return { ...needLocationPoint(), id: 'locating', name: LOCATING_NAME };
}
/** Partida ainda não é um lugar real (localizando ou sem localização). */
export const isOriginPending = (p: { id: string }) => p.id === 'locating' || p.id === NEED_LOCATION_ID;
/** Partida veio do GPS (acompanha a pessoa em tempo real até ela escolher outro ponto). */
export const isGpsOrigin = (p: { id: string }) => p.id.startsWith('gps-');

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

function position(options: PositionOptions): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('sem_gps'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'negado' : 'indisponivel')),
      options,
    );
  });
}

/**
 * Localização em duas tentativas: primeiro a rápida (rede/Wi-Fi, funciona no computador e
 * responde em 1–3 s); se não vier, a precisa (GPS do celular, até 20 s).
 */
export async function getCurrentCoords(): Promise<{ lat: number; lng: number; accuracy: number }> {
  try {
    return await position({ enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 });
  } catch (e) {
    if ((e as Error).message === 'negado' || (e as Error).message === 'sem_gps') throw e;
    return position({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }
}

/** Acompanha a pessoa em tempo real (GPS). Devolve a função para parar. */
export function watchCoords(onMove: (c: { lat: number; lng: number; accuracy: number }) => void, onError?: (why: string) => void) {
  if (!('geolocation' in navigator)) return () => undefined;
  const id = navigator.geolocation.watchPosition(
    (pos) => onMove({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
    (err) => onError?.(err.code === err.PERMISSION_DENIED ? 'negado' : 'indisponivel'),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** Distância aproximada em metros (para saber se a pessoa andou). */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
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

export async function pointAt(lat: number, lng: number): Promise<GeoPoint> {
  const addr = await reverseGeocode(lat, lng);
  return { id: `gps-${Date.now()}`, name: addr.name, city: addr.city, state: addr.state, zone: 'urban', lat, lng, kind: 'avenue' };
}

export async function currentLocationPoint(): Promise<GeoPoint> {
  const { lat, lng } = await getCurrentCoords();
  return pointAt(lat, lng);
}

/**
 * Ponto ainda não escolhido num formulário (carona, frete, retorno vazio).
 * Nunca um endereço fixo de exemplo (antes vinha São Paulo → Rio de Janeiro).
 */
export const CHOOSE_ID = 'escolher';
export function choosePoint(label = 'Toque para escolher'): GeoPoint {
  return { id: CHOOSE_ID, name: label, city: '', state: '', zone: 'urban', lat: BRAZIL_CENTER.lat, lng: BRAZIL_CENTER.lng, kind: 'avenue' };
}
export const isChoosePoint = (p: { id: string }) => p.id === CHOOSE_ID;
/** Ponto ainda sem lugar real: localizando, sem localização, destino vazio ou "escolher". */
export const isPlaceMissing = (p: { id: string }) => isOriginPending(p) || isUnsetDestination(p) || isChoosePoint(p);
/** Partida de um formulário: onde a pessoa está agora; se ainda não sabemos, pede para escolher. */
export function startPointFrom(here: GeoPoint | null | undefined, label = 'Toque para escolher a partida'): GeoPoint {
  return here && !isPlaceMissing(here) ? here : choosePoint(label);
}
