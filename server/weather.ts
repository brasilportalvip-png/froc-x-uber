import type { RainLevel } from '../src/data/pricing.ts';

/**
 * Chuva agora no local da partida, para o leilão do preço.
 * Fonte: Open-Meteo (gratuita, sem chave). Guarda por 10 min numa grade de ~11 km
 * e, se a consulta falhar ou demorar, considera "sem chuva" (nunca encarece por engano).
 */
export type RainLookup = (lat: number, lng: number) => Promise<RainLevel>;

/** mm/h de precipitação + código do tempo (WMO) → nível de chuva. */
export function rainLevelOf(precipitationMm: number, weatherCode: number): RainLevel {
  const mm = Number.isFinite(precipitationMm) ? precipitationMm : 0;
  if (weatherCode >= 95 || [65, 67, 82].includes(weatherCode) || mm >= 4) return 'forte'; // temporal ou chuva forte
  if (mm >= 1 || weatherCode === 63 || weatherCode === 81) return 'moderada';
  if (mm > 0 || [51, 53, 55, 56, 57, 61, 66, 80].includes(weatherCode)) return 'fraca';
  return 'sem_chuva';
}

export function createOpenMeteoRain(opts: { fetchImpl?: typeof fetch; ttlMs?: number; timeoutMs?: number; now?: () => number } = {}): RainLookup {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const timeout = opts.timeoutMs ?? 2500;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; level: RainLevel }>();
  return async (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'sem_chuva';
    const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.level;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=precipitation,weather_code&timezone=America%2FSao_Paulo`;
      const res = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) return 'sem_chuva';
      const j = (await res.json()) as { current?: { precipitation?: number; weather_code?: number } };
      const level = rainLevelOf(Number(j.current?.precipitation ?? 0), Number(j.current?.weather_code ?? 0));
      cache.set(key, { at: now(), level });
      if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
      return level;
    } catch {
      return 'sem_chuva';
    } finally {
      clearTimeout(timer);
    }
  };
}
