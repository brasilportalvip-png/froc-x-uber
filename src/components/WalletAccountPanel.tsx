import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, QrCode, RotateCcw, Shield, Truck, Wallet } from 'lucide-react';
import { formatBRL } from '../data/locations.ts';
import type { TruckType, UserProfile, WalletTransaction } from '../types/mobility.ts';

interface WalletAccountPanelProps {
  profile: UserProfile;
  transactions: WalletTransaction[];
  onTopUpPix: (amount: number) => Promise<void>;
  onUpdateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  onResetDemo: () => Promise<void>;
}

export const WalletAccountPanel: React.FC<WalletAccountPanelProps> = ({
  profile,
  transactions,
  onTopUpPix,
  onUpdateProfile,
  onResetDemo,
}) => {
  const [topupAmount, setTopupAmount] = useState('100');
  const [name, setName] = useState(profile.name);
  const [driverVehicle, setDriverVehicle] = useState(profile.driverVehicle);
  const [driverPlate, setDriverPlate] = useState(profile.driverPlate);
  const [truckModel, setTruckModel] = useState(profile.truckModel);
  const [truckType, setTruckType] = useState<TruckType>(profile.truckType);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdateProfile({ name, driverVehicle, driverPlate, truckModel, truckType });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Froc Pay Wallet Card */}
      <div className="rounded-2xl bg-slate-900 dark:bg-[#131924] border border-slate-800 text-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span>Carteira Froc Pay</span>
          </div>
          <span className="text-xs font-mono-num text-emerald-400">Nota ★ {profile.rating}</span>
        </div>

        <div>
          <div className="text-xs text-slate-400">Saldo disponível para corridas, caronas e fretes</div>
          <div className="text-3xl font-extrabold font-mono-num tracking-tight mt-1">
            {formatBRL(profile.walletBalance)}
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="number"
            min={10}
            value={topupAmount}
            onChange={(e) => setTopupAmount(e.target.value)}
            className="w-28 min-h-[42px] rounded-xl bg-slate-800 border border-slate-700 px-3 text-sm font-bold font-mono-num text-white"
          />
          <button
            type="button"
            onClick={() => onTopUpPix(Number(topupAmount) || 50)}
            className="flex-1 min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
            <span>Adicionar Saldo via Pix</span>
          </button>
        </div>
      </div>

      {/* Transactions */}
      <div className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Extrato recente</h4>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {transactions.slice(0, 6).map((tx) => (
            <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    tx.type === 'credit'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {tx.type === 'credit' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-white truncate">{tx.title}</div>
                  <div className="text-[11px] text-slate-500">{tx.date}</div>
                </div>
              </div>
              <span
                className={`font-bold font-mono-num shrink-0 ${
                  tx.type === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'
                }`}
              >
                {tx.type === 'credit' ? '+' : '-'} {formatBRL(tx.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Driver & Trucker Vehicle Registration */}
      <form
        onSubmit={handleSave}
        className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-3"
      >
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <Shield className="w-4 h-4 text-emerald-600" />
          <span>Cadastro de Motorista & Caminhoneiro</span>
        </div>

        <div className="space-y-2.5 text-xs">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Nome completo</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 font-semibold"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Carro (Uber/99/inDrive)</label>
              <input
                type="text"
                value={driverVehicle}
                onChange={(e) => setDriverVehicle(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 font-semibold"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Placa do carro</label>
              <input
                type="text"
                value={driverPlate}
                onChange={(e) => setDriverPlate(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 font-bold font-mono-num uppercase"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                <Truck className="w-3 h-3 inline mr-1" />
                Caminhão / Modelo
              </label>
              <input
                type="text"
                value={truckModel}
                onChange={(e) => setTruckModel(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 font-semibold"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Categoria Caminhão</label>
              <select
                value={truckType}
                onChange={(e) => setTruckType(e.target.value as TruckType)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 font-semibold"
              >
                <option value="VUC / Utilitário">VUC / Utilitário</option>
                <option value="3/4 Baú">3/4 Baú</option>
                <option value="Toco Aberto">Toco Aberto</option>
                <option value="Truck Baú">Truck Baú</option>
                <option value="Carreta Sider">Carreta Sider</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 min-h-[42px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-bold cursor-pointer"
          >
            {saving ? 'Salvando...' : savedNotice ? 'Dados atualizados!' : 'Salvar Perfil & Frota'}
          </button>
          <button
            type="button"
            onClick={onResetDemo}
            title="Restaurar dados iniciais"
            className="px-3 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Resetar</span>
          </button>
        </div>
      </form>
    </div>
  );
};
