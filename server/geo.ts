/**
 * Divisão do mapa em hexágonos com o H3 (biblioteca aberta da Uber).
 *
 * Cada ponto (lat/lng) vira o código de um hexágono. Com isso o Froc X Uber:
 * - mostra a corrida primeiro para os motoristas da mesma região (despacho);
 * - calcula o preço dinâmico comparando pedidos e motoristas na região.
 *
 * Resolução 8: hexágonos de ~0,7 km². Anel de raio 6 ≈ 3,5 km ao redor do passageiro.
 * Zona (resolução 6, ~36 km²): chave das buscas no banco (pedidos e motoristas por região).
 */
export interface GeoIndex {
  cellOf(lat: number, lng: number): string;
  /** Hexágonos até k passos de distância (inclui o próprio). */
  ring(cell: string, k: number): string[];
  /**
   * Zona (hexágono grande, ~36 km²) que contém o hexágono. As buscas no banco são feitas por
   * zona: o servidor nunca lê o Brasil inteiro para achar o que está perto.
   */
  zoneOf(cell: string): string;
}

/** Zonas que cobrem os hexágonos até k passos de um ponto (normalmente 1 a 7). */
export function zonesAround(geo: GeoIndex, cell: string, k: number): string[] {
  return [...new Set(geo.ring(cell, k).map((c) => geo.zoneOf(c)))];
}

export const H3_RESOLUTION = 8;
export const DISPATCH_RING = 6;
export const SURGE_RING = 3;
/** Carros por perto (~6 km) que o passageiro vê no mapa. */
export const NEARBY_RING = 10;
export const ZONE_RESOLUTION = 6;

export async function createH3Geo(): Promise<GeoIndex> {
  const h3 = await import('h3-js');
  return {
    cellOf: (lat, lng) => h3.latLngToCell(lat, lng, H3_RESOLUTION),
    ring: (cell, k) => h3.gridDisk(cell, k),
    zoneOf: (cell) => h3.cellToParent(cell, ZONE_RESOLUTION),
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
    zoneOf: (cell) => {
      const [, a, b] = cell.split(':');
      return `z:${Math.floor(Number(a) / 6)}:${Math.floor(Number(b) / 6)}`;
    },
  };
}
