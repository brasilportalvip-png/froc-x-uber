import { ProfilePhoto } from './ProfilePhoto.tsx';
import { PhotoGate } from './FaceGates.tsx';
import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Banknote, LogOut, QrCode, Wallet } from 'lucide-react';
import { formatBRL } from '../data/locations.ts';
import type { UserProfile, WalletTransaction, MyWithdrawalView } from '../types/mobility.ts';
import { PIX_KEY_LABELS, isAmbiguousPixKey, pixKeyKind } from '../lib/pixKey.ts';
import { MIN_WITHDRAWAL_REAIS, checkWithdrawal, withdrawBlockedReason } from '../lib/withdrawForm.ts';
import { ProviderOnboarding } from './ProviderOnboarding.tsx';
import { resendVerification } from '../lib/session.ts';

const WITHDRAWAL_STATUS: Record<MyWithdrawalView['status'], { label: string; className: string }> = {
  pending: { label: 'Em análise', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  approved: { label: 'Liberado · Pix a enviar', className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' },
  paid: { label: 'Pix enviado', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  rejected: { label: 'Recusado · valor devolvido', className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
};

interface WalletAccountPanelProps {
  profile: UserProfile;
  transactions: WalletTransaction[];
  withdrawals?: MyWithdrawalView[];
  paymentsEnabled: boolean;
  onTopUp: (amount: number) => Promise<void>;
  onWithdraw: (amount: number, pixKey: string, pixKeyType: string) => Promise<void>;
  onUpdateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  onUploadDocument: (kind: 'driver' | 'trucker', docType: string, file: File) => Promise<void>;
  onApply: (kind: 'driver' | 'trucker', data: Record<string, unknown>) => Promise<void>;
  onLogout: () => Promise<void>;
  onRedeem: () => Promise<void>;
  /** Recarrega os dados depois de trocar a foto ou fazer o reconhecimento facial. */
  onRefresh?: () => Promise<void> | void;
}

export const WalletAccountPanel: React.FC<WalletAccountPanelProps> = ({
  profile,
  transactions,
  withdrawals,
  paymentsEnabled,
  onTopUp,
  onWithdraw,
  onUpdateProfile,
  onUploadDocument,
  onApply,
  onLogout,
  onRedeem,
  onRefresh,
}) => {
  const [changingPhoto, setChangingPhoto] = useState(false);
  const [topupAmount, setTopupAmount] = useState('50');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState('cpf');
  const withdrawable = profile.withdrawableBalance ?? 0;
  const myWithdrawals: MyWithdrawalView[] = withdrawals ?? [];
  const [withdrawError, setWithdrawError] = useState('');
  const withdrawBlocked = withdrawBlockedReason(withdrawable);
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [city, setCity] = useState(profile.city);
  const [busy, setBusy] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState('');
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
      <div className="rounded-2xl bg-slate-900 dark:bg-[#111013] border border-slate-800 text-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span>Carteira Froc</span>
          </div>
          <span className="text-xs font-mono-num text-emerald-400">Nota ★ {profile.rating}</span>
        </div>
        <div>
          <div className="text-xs text-slate-400">Saldo na minha conta Froc</div>
          <div className="text-3xl font-extrabold font-mono-num tracking-tight mt-1">{formatBRL(profile.walletBalance)}</div>
          {withdrawable > 0 && (
            <div className="text-[11px] text-emerald-300 mt-1">
              Ganhos disponíveis para Pix: <strong className="font-mono-num">{formatBRL(withdrawable)}</strong>
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-300">
          Na Froc tudo é pago pela carteira: o valor sai do seu saldo quando você pede e vai sozinho para a conta do motorista quando o serviço termina.
          Não existe pagamento em dinheiro na mão.
        </p>
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

      <div className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-3 text-xs">
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

      {(isProvider || withdrawable > 0) && (
        <form
          noValidate
          data-testid="form-pix"
          onSubmit={(e) => {
            e.preventDefault();
            // Confere aqui e explica o motivo (o navegador barrava em silêncio).
            const check = checkWithdrawal(withdrawAmount, withdrawable, pixKey);
            if (!check.ok) {
              setWithdrawError(check.error);
              return;
            }
            setWithdrawError('');
            void run('withdraw', async () => {
              await onWithdraw(check.amount, pixKey, pixKeyType);
              setWithdrawAmount('');
            });
          }}
          className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Banknote className="w-4 h-4 text-emerald-600" />
            <span>Transferir meus ganhos por Pix</span>
          </div>
          <div className="text-slate-500">
            Disponível: <strong className="font-mono-num text-slate-900 dark:text-white">{formatBRL(withdrawable)}</strong> · para qualquer conta, sua ou de outra pessoa.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              aria-label="Valor do Pix"
              placeholder={`Valor (mín. R$ ${MIN_WITHDRAWAL_REAIS})`}
              value={withdrawAmount}
              onChange={(e) => {
                setWithdrawAmount(e.target.value);
                setWithdrawError('');
              }}
              className="w-36 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 font-mono-num"
            />
            <button type="button" onClick={() => setWithdrawAmount(withdrawable.toFixed(2).replace('.', ','))} className="px-3 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer">
              Tudo
            </button>
          </div>
          <div className="flex gap-2">
            <select aria-label="Tipo da chave Pix" value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value)} className="w-32 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2">
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="telefone">Celular</option>
              <option value="email">E-mail</option>
              <option value="aleatoria">Aleatória</option>
            </select>
            <input
              aria-label="Chave Pix de destino"
              placeholder="Chave Pix de destino"
              value={pixKey}
              onChange={(e) => {
                const value = e.target.value;
                setPixKey(value);
                setWithdrawError('');
                // O tipo acompanha a chave digitada (e-mail, CNPJ, aleatória, +55...). 11 números: a pessoa escolhe CPF ou celular.
                const kind = pixKeyKind(value);
                if (kind && !(isAmbiguousPixKey(value) && (pixKeyType === 'cpf' || pixKeyType === 'telefone'))) setPixKeyType(kind);
              }} className="flex-1 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
          </div>
          {(withdrawError || withdrawBlocked) && (
            <div role="alert" data-testid="erro-pix" className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-3 py-2 font-semibold">
              {withdrawError || withdrawBlocked}
            </div>
          )}
          <button type="submit" disabled={busy === 'withdraw' || Boolean(withdrawBlocked)} className="w-full min-h-[40px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold disabled:opacity-60 cursor-pointer">
            {busy === 'withdraw' ? 'Solicitando...' : withdrawBlocked ? `Pix liberado a partir de R$ ${MIN_WITHDRAWAL_REAIS}` : 'Transferir por Pix'}
          </button>
          <p className="text-[11px] text-slate-500">
            Só os ganhos (corridas, entregas, fretes e caronas) podem ir para Pix; saldo de recarga fica para usar no app. Isso impede o golpe de recarregar com cartão roubado e sacar.
            O valor sai do saldo na hora e fica reservado; a equipe Froc confere e envia o Pix. Acompanhe abaixo em "Meus pedidos de Pix".
          </p>
        </form>
      )}

      {myWithdrawals.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs" data-testid="meus-saques">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">Meus pedidos de Pix</h4>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {myWithdrawals.map((w: MyWithdrawalView) => (
              <div key={w.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-white truncate">
                    {formatBRL(w.amount)} · {PIX_KEY_LABELS[w.pixKeyType as keyof typeof PIX_KEY_LABELS] ?? 'Pix'} {w.pixKey}
                  </div>
                  <div className="text-[11px] text-slate-500">{w.date}</div>
                </div>
                <span className={`shrink-0 px-2 py-1 rounded-lg font-bold ${WITHDRAWAL_STATUS[w.status].className}`}>{WITHDRAWAL_STATUS[w.status].label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
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
        className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 text-xs"
      >
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Meus dados</h4>
        <div className="flex items-center gap-3" data-testid="minha-foto">
          <ProfilePhoto uid={profile.uid} size={64} version={profile.photoAt} alt="Minha foto" />
          <div className="space-y-1">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">{profile.hasPhoto ? 'Sua foto de identificação' : 'Você ainda não tem foto'}</div>
            <button type="button" onClick={() => setChangingPhoto(true)} className="min-h-[32px] px-3 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-300 text-xs font-bold cursor-pointer">
              {profile.hasPhoto ? 'Trocar foto' : 'Adicionar foto'}
            </button>
          </div>
        </div>
        {changingPhoto && (
          <PhotoGate
            mode="change"
            onClose={() => setChangingPhoto(false)}
            onDone={async () => {
              setChangingPhoto(false);
              await onRefresh?.();
            }}
          />
        )}
        <div className="text-[11px] text-slate-500">{profile.email}{profile.emailVerified ? ' · verificado' : ' · e-mail ainda não confirmado'}</div>
        {profile.cpfMasked && (
          <div className="text-[11px] text-slate-600 dark:text-slate-300">
            CPF {profile.cpfMasked} ·{' '}
            {profile.cpfStatus === 'verified' ? (
              <strong className="text-emerald-600">
                verificado {profile.cpfSource === 'receita' ? 'na Receita Federal' : profile.cpfSource?.startsWith('ia_') ? 'pelo documento (IA Froc)' : 'pela equipe Froc'}
              </strong>
            ) : (
              <strong className="text-sky-600">cadastrado (envie um documento abaixo para ganhar o selo verde)</strong>
            )}
            . O nome vem do CPF; para corrigir, fale com o Atendimento.
          </div>
        )}
        {profile.founder && (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/60 bg-black px-3 py-1 text-[11px] font-bold">
            <span className="froc-gold-text">★ Membro fundador</span>
          </div>
        )}
        {!profile.emailVerified && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-2.5 space-y-2 text-[11px] text-amber-800 dark:text-amber-200">
            <div>Confirme seu e-mail para proteger sua conta (e, se você for o administrador, liberar a aba Admin). Depois de clicar no link do e-mail, volte aqui: a tela atualiza sozinha em alguns segundos.</div>
            <button
              type="button"
              disabled={busy === 'verify'}
              onClick={() =>
                void run('verify', async () => {
                  try {
                    const r = await resendVerification();
                    setVerifyMsg(r === 'already' ? 'E-mail já confirmado. Atualizando...' : 'Link enviado. Confira a caixa de entrada e o spam.');
                  } catch (e) {
                    setVerifyMsg((e as Error).message);
                  }
                })
              }
              className="w-full min-h-[36px] rounded-lg bg-amber-500 text-white font-bold cursor-pointer"
            >
              {busy === 'verify' ? 'Enviando...' : 'Enviar link de confirmação'}
            </button>
            {verifyMsg && <div className="font-semibold">{verifyMsg}</div>}
          </div>
        )}
        <input required value={name} disabled={Boolean(profile.cpfMasked)} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 font-semibold" />
        <div className="grid grid-cols-2 gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Celular com DDD" className="min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cidade" className="min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
        </div>
        <button type="submit" disabled={busy === 'profile'} className="w-full min-h-[40px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold cursor-pointer">
          {busy === 'profile' ? 'Salvando...' : 'Salvar dados'}
        </button>
      </form>

      <div className="text-[11px] text-slate-500">Sua nota como passageiro: ★ {profile.passengerRating}</div>

      <ProviderOnboarding kind="driver" profile={profile} onUpload={onUploadDocument} onApply={onApply} onRefresh={onRefresh} />
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
