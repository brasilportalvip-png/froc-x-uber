import type { GeoPoint, RideCategoryId } from '../types/mobility.ts';

export const BRAZIL_LOCATIONS: GeoPoint[] = [
  // Urban São Paulo Metropolitan Hubs
  {
    id: 'sp-paulista',
    name: 'Av. Paulista, 1578 (MASP)',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.5614,
    lng: -46.6559,
    kind: 'avenue',
  },
  {
    id: 'sp-pinheiros',
    name: 'Largo da Batata · Pinheiros',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.5672,
    lng: -46.6939,
    kind: 'neighborhood',
  },
  {
    id: 'sp-faria-lima',
    name: 'Av. Brig. Faria Lima, 3477',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.5868,
    lng: -46.6821,
    kind: 'avenue',
  },
  {
    id: 'sp-tiete',
    name: 'Terminal Rodoviário Tietê',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.5162,
    lng: -46.6254,
    kind: 'terminal',
  },
  {
    id: 'sp-cgh',
    name: 'Aeroporto de Congonhas (CGH)',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.6261,
    lng: -46.6564,
    kind: 'airport',
  },
  {
    id: 'sp-gru',
    name: 'Aeroporto de Guarulhos (GRU)',
    city: 'Guarulhos',
    state: 'SP',
    zone: 'urban',
    lat: -23.4356,
    lng: -46.4731,
    kind: 'airport',
  },
  {
    id: 'sp-centro',
    name: 'Praça da Sé · Centro Histórico',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.5503,
    lng: -46.6342,
    kind: 'neighborhood',
  },
  {
    id: 'sp-barra-funda',
    name: 'Terminal Barra Funda',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.5255,
    lng: -46.6673,
    kind: 'terminal',
  },
  {
    id: 'sp-morumbi',
    name: 'Shopping Morumbi · Marginal Pinheiros',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.6231,
    lng: -46.6989,
    kind: 'neighborhood',
  },
  {
    id: 'sp-itaquera',
    name: 'Arena Itaquera · Zona Leste',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.5453,
    lng: -46.4743,
    kind: 'neighborhood',
  },
  {
    id: 'sp-santana',
    name: 'Santana · Zona Norte',
    city: 'São Paulo',
    state: 'SP',
    zone: 'urban',
    lat: -23.5023,
    lng: -46.6248,
    kind: 'neighborhood',
  },
  {
    id: 'sp-santo-andre',
    name: 'Centro · Santo André (ABC)',
    city: 'Santo André',
    state: 'SP',
    zone: 'urban',
    lat: -23.6572,
    lng: -46.5333,
    kind: 'city',
  },
  // Intercity & Interstate Hubs (BlaBlaCar & Caminhões)
  {
    id: 'br-campinas',
    name: 'Campinas · Terminal Ramos de Azevedo',
    city: 'Campinas',
    state: 'SP',
    zone: 'intercity',
    lat: -22.9056,
    lng: -47.0608,
    kind: 'city',
  },
  {
    id: 'br-santos',
    name: 'Santos · Porto e Ponta da Praia',
    city: 'Santos',
    state: 'SP',
    zone: 'intercity',
    lat: -23.9608,
    lng: -46.3336,
    kind: 'hub',
  },
  {
    id: 'br-rio',
    name: 'Rio de Janeiro · Novo Rio / Centro',
    city: 'Rio de Janeiro',
    state: 'RJ',
    zone: 'intercity',
    lat: -22.8999,
    lng: -43.2094,
    kind: 'city',
  },
  {
    id: 'br-curitiba',
    name: 'Curitiba · Rodoferroviária / CIC',
    city: 'Curitiba',
    state: 'PR',
    zone: 'intercity',
    lat: -25.4372,
    lng: -49.2600,
    kind: 'city',
  },
  {
    id: 'br-bh',
    name: 'Belo Horizonte · Rodoviária / Contagem',
    city: 'Belo Horizonte',
    state: 'MG',
    zone: 'intercity',
    lat: -19.9167,
    lng: -43.9345,
    kind: 'city',
  },
  {
    id: 'br-florianopolis',
    name: 'Florianópolis · Centro / Continente',
    city: 'Florianópolis',
    state: 'SC',
    zone: 'intercity',
    lat: -27.5954,
    lng: -48.5480,
    kind: 'city',
  },
  {
    id: 'br-ribeirao',
    name: 'Ribeirão Preto · Polo Logístico Anhanguera',
    city: 'Ribeirão Preto',
    state: 'SP',
    zone: 'intercity',
    lat: -21.1704,
    lng: -47.8103,
    kind: 'hub',
  },
  {
    id: 'br-goiania',
    name: 'Goiânia · Polo Atacadista BR-153',
    city: 'Goiânia',
    state: 'GO',
    zone: 'intercity',
    lat: -16.6869,
    lng: -49.2648,
    kind: 'city',
  },
  {
    id: 'br-brasilia',
    name: 'Brasília · Eixo Rodoviário DF',
    city: 'Brasília',
    state: 'DF',
    zone: 'intercity',
    lat: -15.7975,
    lng: -47.8919,
    kind: 'city',
  },
  {
    id: 'br-poa',
    name: 'Porto Alegre · Zona Industrial / Centro',
    city: 'Porto Alegre',
    state: 'RS',
    zone: 'intercity',
    lat: -30.0346,
    lng: -51.2177,
    kind: 'city',
  },
  {
    id: 'br-sjc',
    name: 'São José dos Campos · Via Dutra',
    city: 'São José dos Campos',
    state: 'SP',
    zone: 'intercity',
    lat: -23.1896,
    lng: -45.8841,
    kind: 'hub',
  },
];

export const RIDE_CATEGORIES: {
  id: RideCategoryId;
  label: string;
  tag: string;
  description: string;
  baseFare: number;
  perKm: number;
  perMin: number;
  etaOffsetMin: number;
  capacity: string;
}[] = [
  {
    id: 'froc_x',
    label: 'Froc X',
    tag: 'Econômico',
    description: 'Carros compactos econômicos para o dia a dia',
    baseFare: 5.5,
    perKm: 2.15,
    perMin: 0.35,
    etaOffsetMin: 3,
    capacity: '4 passageiros',
  },
  {
    id: 'froc_comfort',
    label: 'Froc Black',
    tag: 'Executivo',
    description: 'Sedans espaçosos, ar-condicionado e nota 4.9+',
    baseFare: 8.9,
    perKm: 2.95,
    perMin: 0.48,
    etaOffsetMin: 5,
    capacity: '4 passageiros',
  },
  {
    id: 'froc_moto',
    label: 'Froc Moto',
    tag: 'Ultra rápido',
    description: 'Evite o trânsito com capacete higienizado incluso',
    baseFare: 3.5,
    perKm: 1.25,
    perMin: 0.18,
    etaOffsetMin: 2,
    capacity: '1 passageiro',
  },
  {
    id: 'froc_delivery',
    label: 'Froc Flash',
    tag: 'Envio de pacotes',
    description: 'Entrega expressa de chaves, documentos e caixas',
    baseFare: 4.5,
    perKm: 1.45,
    perMin: 0.2,
    etaOffsetMin: 3,
    capacity: 'Até 20 kg',
  },
];

export function calculateDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const straight = 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  // Road winding factor ~1.26x straight-line distance
  return Math.max(1.2, Math.round(straight * 1.26 * 10) / 10);
}

export function estimateDurationMin(distanceKm: number, mode: 'urban' | 'moto' | 'highway'): number {
  const avgSpeedKmh = mode === 'moto' ? 38 : mode === 'highway' ? 76 : 26;
  return Math.max(4, Math.round((distanceKm / avgSpeedKmh) * 60 + 2));
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
