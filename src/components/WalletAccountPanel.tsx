import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Banknote, LogOut, QrCode, Wallet } from 'lucide-react';
import { formatBRL } from '../data/locations.ts';
import type { UserProfile, WalletTransaction } from '../types/mobility.ts';
import { ProviderOnboarding } from './ProviderOnboarding.tsx';

interface WalletAccountPanelProps {
  profile: UserProfile;
  transactions: WalletTransaction[];
  paymentsEnabled: boolean;
  onTopUp: (amount: number) => Promise<void>;
  onWithdraw: (amount: number, pixKey: string) => Promise<void>;
  onUpdateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  onUploadDocument: (kind: 'driver' | 'trucker', docType: string, file: File) => Promise<void>;
  onApply: (kind: 'driver' | 'trucker', data: Record<string, string>) => Promise<void>;
  onLogout: () => Promise<void>;
  onRedeem: () => Promise<void>;
}

export const WalletAccountPanel: React.FC<WalletAccountPanelProps> = ({
  profile,
  transactions,
  paymentsEnabled,
  onTopUp,
  onWithdraw,
  onUpdateProfile,
  onUploadDocument,
  onApply,
  onLogout,
  onRedeem,
}) => {
  const [topupAmount, setTopupAmount] = useState('50');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [city, setCity] = useState(profile.city);
  const [busy, setBusy] = useState<string | null>(null);
  const isProvider = profile.driverStatus === 'approved' || profile.truckerStatus === 'approved';

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-900 dark:bg-[#131924] border border-slate-800 text-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span>Carteira Froc</span>
          </div>
          <span className="text-xs font-mono-num text-emerald-400">Nota ★ {profile.rating}</span>
        </div>
        <div>
          <div className="text-xs text-slate-400">Saldo para corridas, caronas e fretes</div>
          <div className="text-3xl font-extrabold font-mono-num tracking-tight mt-1">{formatBRL(profile.walletBalance)}</div>
        </div>
        {paymentsEnabled ? (
          <div className="flex gap-2">
            <input
              type="number"
              min={10}
              max={5000}
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              className="w-28 min-h-[42px] rounded-xl bg-slate-800 border border-slate-700 px-3 text-sm font-bold font-mono-num text-white"
            />
            <button
              type="button"
              disabled={busy === 'topup'}
              onClick={() => run('topup', () => onTopUp(Number(topupAmount)))}
              className="flex-1 min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
              <span>{busy === 'topup' ? 'Abrindo Mercado Pago...' : 'Recarregar (Pix ou cartão)'}</span>
            </button>
          </div>
        ) : (
          <p className="text-xs text-amber-300">Recargas ainda não disponíveis: o pagamento está sendo configurado.</p>
        )}
        <p className="text-[11px] text-slate-400">
          Pagamento processado pelo Mercado Pago. O saldo entra assim que o pagamento é aprovado.
        </p>
      </div>

      <div className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-3 text-xs">
        <div>
          <div className="text-sm font-bold text-slate-900 dark:text-white">Pontos Froc: {profile.points}</div>
          <div className="text-slate-500">
            Ganhe pontos a cada serviço concluído. {profile.pointsPerRedeem} pontos = R$ 5,00 de crédito.
          </div>
        </div>
        <button
          type="button"
          disabled={profile.points < profile.pointsPerRedeem || busy === 'redeem'}
          onClick={() => run('redeem', onRedeem)}
          className="px-3 min-h-[40px] rounded-xl bg-amber-500 text-white font-bold disabled:opacity-50 cursor-pointer shrink-0"
        >
          Trocar
        </button>
      </div>

      {isProvider && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('withdraw', async () => {
              await onWithdraw(Number(withdrawAmount), pixKey);
              setWithdrawAmount('');
            });
          }}
          className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Banknote className="w-4 h-4 text-emerald-600" />
            <span>Sacar ganhos por Pix</span>
          </div>
          <div className="flex gap-2">
            <input required type="number" min={20} step="0.01" placeholder="Valor (mín. R$ 20)" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-36 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 font-mono-num" />
            <input required placeholder="Sua chave Pix" value={pixKey} onChange={(e) => setPixKey(e.target.value)} className="flex-1 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
          </div>
          <button type="submit" disabled={busy === 'withdraw'} className="w-full min-h-[40px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold disabled:opacity-60 cursor-pointer">
            {busy === 'withdraw' ? 'Solicitando...' : 'Solicitar saque'}
          </button>
          <p className="text-[11px] text-slate-500">O valor sai do saldo na hora e é transferido pela equipe Froc em até 2 dias úteis.</p>
        </form>
      )}

      <div className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Extrato</h4>
        {transactions.length === 0 && <div className="text-xs text-slate-500">Nenhuma movimentação ainda.</div>}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {transactions.slice(0, 20).map((tx) => (
            <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tx.type === 'credit' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                  {tx.type === 'credit' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-white truncate">{tx.title}</div>
                  <div className="text-[11px] text-slate-500">{tx.date}</div>
                </div>
              </div>
              <span className={`font-bold font-mono-num shrink-0 ${tx.type === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                {tx.type === 'credit' ? '+' : '-'} {formatBRL(tx.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run('profile', () => onUpdateProfile({ name, phone, city }));
        }}
        className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 text-xs"
      >
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Meus dados</h4>
        <div className="text-[11px] text-slate-500">{profile.email}{profile.emailVerified ? ' · verificado' : ' · confirme seu e-mail pelo link que enviamos'}</div>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 font-semibold" />
        <div className="grid grid-cols-2 gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Celular com DDD" className="min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cidade" className="min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
        </div>
        <button type="submit" disabled={busy === 'profile'} className="w-full min-h-[40px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold cursor-pointer">
          {busy === 'profile' ? 'Salvando...' : 'Salvar dados'}
        </button>
      </form>

      <div className="text-[11px] text-slate-500">Sua nota como passageiro: ★ {profile.passengerRating}</div>

      <ProviderOnboarding kind="driver" profile={profile} onUpload={onUploadDocument} onApply={onApply} />
      <ProviderOnboarding kind="trucker" profile={profile} onUpload={onUploadDocument} onApply={onApply} />

      <button
        type="button"
        onClick={() => void onLogout()}
        className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center justify-center gap-2 cursor-pointer"
      >
        <LogOut className="w-4 h-4" />
        Sair da conta
      </button>

      <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pb-2">
        <a href="/legal/termos.html" target="_blank" rel="noreferrer" className="underline">Termos de uso</a>
        <a href="/legal/privacidade.html" target="_blank" rel="noreferrer" className="underline">Privacidade (LGPD)</a>
        <a href="/legal/seguranca.html" target="_blank" rel="noreferrer" className="underline">Segurança</a>
        <a href="/legal/ajuda.html" target="_blank" rel="noreferrer" className="underline">Perguntas frequentes</a>
      </nav>
    </div>
  );
};
