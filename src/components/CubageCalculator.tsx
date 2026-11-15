import { CARGO_VEHICLES } from '../data/cargoVehicles.ts';
import React, { useMemo, useState } from 'react';
import type { TruckType } from '../types/mobility.ts';

/** Volume (m³) e peso (kg) médios por item de mudança. Valores de referência do mercado. */
const ITEMS: { id: string; label: string; m3: number; kg: number }[] = [
  { id: 'geladeira', label: 'Geladeira', m3: 1.0, kg: 70 },
  { id: 'fogao', label: 'Fogão', m3: 0.4, kg: 40 },
  { id: 'maquina', label: 'Máquina de lavar', m3: 0.5, kg: 60 },
  { id: 'sofa3', label: 'Sofá 3 lugares', m3: 2.0, kg: 60 },
  { id: 'cama_casal', label: 'Cama de casal + colchão', m3: 1.8, kg: 70 },
  { id: 'cama_solteiro', label: 'Cama de solteiro + colchão', m3: 1.0, kg: 40 },
  { id: 'guarda_roupa', label: 'Guarda-roupa (desmontado)', m3: 1.5, kg: 90 },
  { id: 'mesa', label: 'Mesa com 4 cadeiras', m3: 1.2, kg: 45 },
  { id: 'rack', label: 'Rack / estante', m3: 0.6, kg: 35 },
  { id: 'tv', label: 'TV', m3: 0.2, kg: 15 },
  { id: 'caixa', label: 'Caixa média (60 L)', m3: 0.06, kg: 15 },
];

/** Capacidade útil aproximada de cada veículo de carga (do menor para o maior). */
const TRUCKS: { type: TruckType; m3: number; kg: number }[] = [...CARGO_VEHICLES]
  .map((v) => ({ type: v.type, m3: v.m3, kg: v.kg }))
  .sort((a, b) => a.m3 - b.m3 || a.kg - b.kg);

interface Props {
  onApply: (result: { volumeM3: number; weightKg: number; truck: TruckType }) => void;
}

/** Calculadora de cubagem: a pessoa conta os itens e o app sugere volume, peso e caminhão. */
export const CubageCalculator: React.FC<Props> = ({ onApply }) => {
  const [qty, setQty] = useState<Record<string, number>>({});
  const total = useMemo(() => {
    let m3 = 0;
    let kg = 0;
    for (const item of ITEMS) {
      m3 += (qty[item.id] || 0) * item.m3;
      kg += (qty[item.id] || 0) * item.kg;
    }
    // 20% de folga para encaixe e proteção.
    const volume = Math.round(m3 * 1.2 * 10) / 10;
    const weight = Math.round(kg);
    const truck = TRUCKS.find((t) => t.m3 >= volume && t.kg >= weight) ?? TRUCKS[TRUCKS.length - 1];
    return { volume, weight, truck: truck.type };
  }, [qty]);

  return (
    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-3 space-y-2 text-xs">
      <div className="font-semibold text-slate-900 dark:text-white">Calculadora de cubagem (opcional)</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {ITEMS.map((item) => (
          <label key={item.id} className="flex items-center justify-between gap-2">
            <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
            <input
              type="number"
              min={0}
              max={99}
              value={qty[item.id] || ''}
              placeholder="0"
              onChange={(e) => setQty((q) => ({ ...q, [item.id]: Math.max(0, Math.min(99, Number(e.target.value) || 0)) }))}
              className="w-14 min-h-[32px] rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 font-mono-num"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <span>
          ≈ <strong className="font-mono-num">{total.volume} m³</strong> · <strong className="font-mono-num">{total.weight} kg</strong> · sugerido:{' '}
          <strong>{total.truck}</strong>
        </span>
        <button
          type="button"
          disabled={total.volume === 0}
          onClick={() => onApply({ volumeM3: total.volume, weightKg: total.weight, truck: total.truck })}
          className="px-3 min-h-[32px] rounded-lg bg-slate-900 dark:bg-emerald-600 text-white font-semibold disabled:opacity-50 cursor-pointer"
        >
          Usar no pedido
        </button>
      </div>
    </div>
  );
};
