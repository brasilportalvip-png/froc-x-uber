/**
 * Divisão do mapa em hexágonos com o H3 (biblioteca aberta da Uber).
 *
 * Cada ponto (lat/lng) vira o código de um hexágono. Com isso o Froc X Uber:
 * - mostra a corrida primeiro para os motoristas da mesma região (despacho);
 * - calcula o preço dinâmico comparando pedidos e motoristas na região.
 *
 * Resolução 8: hexágonos de ~0,7 km². Anel de raio 6 ≈ 3,5 km ao redor do passageiro.
 */
export interface GeoIndex {
  cellOf(lat: number, lng: number): string;
  /** Hexágonos até k passos de distância (inclui o próprio). */
  ring(cell: string, k: number): string[];
}

export const H3_RESOLUTION = 8;
export const DISPATCH_RING = 6;
export const SURGE_RING = 3;

export async function createH3Geo(): Promise<GeoIndex> {
  const h3 = await import('h3-js');
  return {
    cellOf: (lat, lng) => h3.latLngToCell(lat, lng, H3_RESOLUTION),
    ring: (cell, k) => h3.gridDisk(cell, k),
  };
}

/**
 * Grade quadrada simples (≈ 600 m), usada nos testes e como reserva se o H3 não carregar.
 * Mesmo contrato do H3, para as regras de negócio não mudarem.
 */
export function createGridGeo(step = 0.006): GeoIndex {
  return {
    cellOf: (lat, lng) => `g:${Math.floor(lat / step)}:${Math.floor(lng / step)}`,
    ring: (cell, k) => {
      const [, a, b] = cell.split(':');
      const out: string[] = [];
      for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) out.push(`g:${Number(a) + i}:${Number(b) + j}`);
      return out;
    },
  };
}
