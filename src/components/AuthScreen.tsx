import React, { useState } from 'react';
import { Car, HandCoins, Truck, Users } from 'lucide-react';
import { resetPassword, signIn, signInWithGoogle, signUp } from '../lib/session.ts';

/** Tela de entrada: entrar, criar conta ou recuperar senha. */
export const AuthScreen: React.FC<{ configError?: string | null }> = ({ configError }) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'login') await signIn(email, password);
      else if (mode === 'signup') {
        if (name.trim().length < 3) throw new Error('Informe seu nome completo.');
        await signUp(name, email, password);
      } else {
        await resetPassword(email);
        setMessage({ kind: 'ok', text: 'Enviamos um link para redefinir a senha no seu e-mail.' });
      }
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Erro inesperado.' });
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="font-display text-3xl font-extrabold text-slate-900 dark:text-white">Froc X Uber</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Corridas, negociação de preço, caronas e fretes em um só app.</p>
          <div className="flex justify-center gap-4 text-emerald-600 pt-1" aria-hidden>
            <Car className="w-5 h-5" />
            <HandCoins className="w-5 h-5" />
            <Users className="w-5 h-5" />
            <Truck className="w-5 h-5" />
          </div>
        </div>

        {configError ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{configError}</div>
        ) : (
          <form onSubmit={submit} className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : 'Recuperar senha'}
            </h2>
            {mode === 'signup' && (
              <input className={input} autoComplete="name" placeholder="Nome completo" value={name} onChange={(e) => setName(e.target.value)} required />
            )}
            <input className={input} type="email" autoComplete="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
            {mode !== 'reset' && (
              <input
                className={input}
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="Senha (mínimo 6 caracteres)"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
            {message && (
              <p role="alert" className={`text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
                {message.text}
              </p>
            )}
            <button type="submit" disabled={busy} className="w-full min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60 cursor-pointer">
              {busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar minha conta' : 'Enviar link'}
            </button>
            {mode !== 'reset' && (
              <>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                  ou
                  <span className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setMessage(null);
                    try {
                      await signInWithGoogle();
                    } catch (err) {
                      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Erro inesperado.' });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-800 dark:text-slate-100 disabled:opacity-60 cursor-pointer"
                >
                  Entrar com Google
                </button>
                <p className="text-[11px] text-slate-500">
                  Já tem conta em outro app nosso? Use o mesmo e-mail e senha (ou o mesmo Google).
                </p>
              </>
            )}
            <div className="flex justify-between text-xs text-emerald-700 dark:text-emerald-400">
              {mode !== 'login' ? (
                <button type="button" onClick={() => setMode('login')} className="cursor-pointer">Já tenho conta</button>
              ) : (
                <button type="button" onClick={() => setMode('signup')} className="cursor-pointer">Criar conta</button>
              )}
              {mode !== 'reset' && (
                <button type="button" onClick={() => setMode('reset')} className="cursor-pointer">Esqueci a senha</button>
              )}
            </div>
            {mode === 'signup' && (
              <p className="text-[11px] text-slate-500">
                Ao criar a conta você concorda com os{' '}
                <a href="/legal/termos.html" target="_blank" rel="noreferrer" className="underline">termos de uso</a> e a{' '}
                <a href="/legal/privacidade.html" target="_blank" rel="noreferrer" className="underline">política de privacidade</a>.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
