/**
 * Veículos aceitos em Cargas: caminhões, vans, furgões, pick-ups, utilitários e carro com
 * carretinha — qualquer veículo que consiga levar carga. Capacidades aproximadas (úteis).
 * Os 5 nomes antigos (VUC ... Carreta Sider) continuam iguais para não quebrar dados salvos.
 */
export const CARGO_VEHICLES = [
  { type: 'Carro com carretinha', m3: 2, kg: 400, group: 'Utilitários' },
  { type: 'Pick-up (Strada, Saveiro, Hilux)', m3: 2.5, kg: 1000, group: 'Utilitários' },
  { type: 'Utilitário pequeno (Fiorino, Kangoo)', m3: 3.2, kg: 650, group: 'Utilitários' },
  { type: 'Furgão / baú leve (HR, Bongo)', m3: 8, kg: 1800, group: 'Vans e furgões' },
  { type: 'Van de carga (Master, Ducato, Sprinter)', m3: 11, kg: 1500, group: 'Vans e furgões' },
  { type: 'VUC / Utilitário', m3: 12, kg: 3000, group: 'Caminhões' },
  { type: '3/4 Baú', m3: 22, kg: 4000, group: 'Caminhões' },
  { type: 'Toco Aberto', m3: 30, kg: 6000, group: 'Caminhões' },
  { type: 'Truck Baú', m3: 45, kg: 12000, group: 'Caminhões' },
  { type: 'Carreta Sider', m3: 90, kg: 27000, group: 'Caminhões' },
] as const;

export type CargoVehicleType = (typeof CARGO_VEHICLES)[number]['type'];

export const CARGO_VEHICLE_TYPES: CargoVehicleType[] = CARGO_VEHICLES.map((v) => v.type);
