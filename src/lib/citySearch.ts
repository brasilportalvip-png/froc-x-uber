/**
 * Busca por cidade na vitrine (caronas, retorno vazio, fretes, viagens agendadas).
 * A lista que já veio do servidor mostra o que sai perto da pessoa; ao digitar uma cidade
 * (3+ letras), o servidor procura essa cidade no Brasil inteiro (origem ou destino).
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from './session.ts';

export type CitySearchKind = 'carpools' | 'emptyTrucks' | 'freights' | 'indrive';

export function useCitySearch<T extends { id: string }>(kind: CitySearchKind, text: string, local: T[]): T[] {
  const [remote, setRemote] = useState<T[]>([]);
  const q = text.trim();
  useEffect(() => {
    if (q.length < 3) {
      setRemote([]);
      return;
    }
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ items: T[] }>(`/api/search?kind=${kind}&city=${encodeURIComponent(q)}`)
        .then((r) => {
          if (alive) setRemote(r.items || []);
        })
        .catch(() => undefined);
    };
    const first = setTimeout(load, 400); // espera a pessoa parar de digitar
    const every = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(every);
    };
  }, [kind, q]);
  return useMemo(() => {
    const seen = new Set(local.map((i) => i.id));
    return [...local, ...remote.filter((i) => !seen.has(i.id))];
  }, [local, remote]);
}
