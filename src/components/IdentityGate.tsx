import React, { useState } from 'react';
import { BadgeCheck, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../lib/session.ts';
import type { UserProfile } from '../types/mobility.ts';

const maskInput = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
};

/** Mesma conta dos dígitos do servidor, para avisar na hora se o CPF foi digitado errado. */
function cpfOk(v: string) {
  const d = v.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

/**
 * Passo obrigatório depois de criar a conta: CPF, nome completo e nascimento.
 * Uma pessoa = uma conta; motoristas sabem que o passageiro é real.
 */
export const IdentityGate: React.FC<{ profile: UserProfile; onDone: () => Promise<void> | void; onLogout: () => void }> = ({ profile, onDone, onLogout }) => {
  const [fullName, setFullName] = useState(profile.cpfStatus === 'rejected' ? '' : profile.name.includes(' ') ? profile.name : '');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const typedCpf = cpf.replace(/\D/g, '').length === 11;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cpf-titulo" className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api('/api/identity/cpf', { body: { cpf, fullName, birthDate } });
            await onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Não foi possível confirmar agora.');
          } finally {
            setBusy(false);
          }
        }}
        className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl bg-white dark:bg-[#111013] border border-amber-500/40 p-5 space-y-3 text-sm text-slate-700 dark:text-slate-200 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600" />
          <h3 id="cpf-titulo" className="text-base font-extrabold text-slate-900 dark:text-white">
            Confirme quem você é
          </h3>
        </div>
        <p className="text-xs text-slate-500">
          Na Froc, motoristas e passageiros são pessoas verificadas. O motorista sabe que você é real, e você sabe quem é o motorista. Cada pessoa pode ter só uma conta.
        </p>
        {profile.cpfStatus === 'rejected' && (
          <div className="rounded-xl bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-700">
            O CPF anterior foi recusado pela equipe{profile.rejectionReason ? `: ${profile.rejectionReason}` : ''}. Informe os seus dados verdadeiros.
          </div>
        )}
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">Nome completo (como está no CPF)</span>
          <input required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[11px] text-slate-500 mb-1">CPF</span>
            <input
              required
              inputMode="numeric"
              value={cpf}
              onChange={(e) => setCpf(maskInput(e.target.value))}
              placeholder="000.000.000-00"
              className={`w-full min-h-[44px] rounded-xl border bg-transparent px-3 font-mono-num ${typedCpf && !cpfOk(cpf) ? 'border-red-400' : 'border-slate-200 dark:border-slate-700'}`}
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-slate-500 mb-1">Data de nascimento</span>
            <input required type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3" />
          </label>
        </div>
        {typedCpf && !cpfOk(cpf) && <div className="text-xs text-red-600">CPF inválido: confira os números.</div>}
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0" />
          <span>
            Declaro que os dados são meus e verdadeiros. Sei que usar CPF de outra pessoa é crime (falsa identidade) e gera bloqueio. A Froc confere os dados na Receita Federal e trata conforme a{' '}
            <a href="/legal/privacidade.html" target="_blank" rel="noreferrer" className="underline">
              política de privacidade
            </a>
            .
          </span>
        </label>
        {error && <div className="rounded-xl bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-700 dark:text-red-300">{error}</div>}
        <button
          type="submit"
          disabled={busy || !agree || !cpfOk(cpf) || !birthDate || fullName.trim().split(/\s+/).length < 2}
          className="w-full min-h-[48px] rounded-2xl bg-emerald-600 text-white font-bold disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2"
        >
          <BadgeCheck className="w-5 h-5" /> {busy ? 'Conferindo...' : 'Confirmar meu CPF'}
        </button>
        <p className="text-[11px] text-slate-500">Seu CPF completo não aparece para motoristas nem passageiros: eles veem só o selo de verificado.</p>
        <button type="button" onClick={onLogout} className="w-full text-xs text-slate-500 inline-flex items-center justify-center gap-1 cursor-pointer">
          <LogOut className="w-3.5 h-3.5" /> Sair
        </button>
      </form>
    </div>
  );
};

/** Selo mostrado ao motorista sobre o passageiro (e vice-versa). */
export const VerifiedBadge: React.FC<{ level?: string; who?: string }> = ({ level, who = 'Passageiro' }) =>
  level === 'verificado' ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
      <BadgeCheck className="w-3.5 h-3.5" /> {who} verificado
    </span>
  ) : level === 'cpf' ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600">
      <BadgeCheck className="w-3.5 h-3.5" /> CPF cadastrado
    </span>
  ) : null;
