import React, { useEffect, useRef, useState } from 'react';
import { Headset, Loader2, Send, X } from 'lucide-react';
import { api } from '../lib/session.ts';

interface Msg {
  from: 'user' | 'froc' | 'equipe';
  text: string;
  at: string;
}

/**
 * Atendimento Froc: botão flutuante que abre o chat. A Froc (IA) responde na hora com base
 * na conta da pessoa; quando precisa, chama a equipe, que responde aqui mesmo.
 */
export const SupportChat: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(false);
  const seen = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ messages: Msg[] }>('/api/support')
        .then((r) => {
          if (!alive) return;
          setMsgs(r.messages || []);
          const n = (r.messages || []).length;
          if (!open && n > seen.current && r.messages?.[n - 1]?.from === 'equipe') setUnread(true);
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(load, open ? 8000 : 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      seen.current = msgs.length;
      setUnread(false);
      end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [open, msgs]);

  // Esc fecha a conversa (computador).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const m = text.trim();
    if (!m || busy) return;
    setText('');
    setError('');
    setMsgs((x) => [...x, { from: 'user', text: m, at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const r = await api<{ messages: Msg[] }>('/api/support', { body: { message: m } });
      setMsgs(r.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Atendimento Froc"
        data-testid="support-button"
        className="fixed z-40 right-4 bottom-20 lg:bottom-6 w-14 h-14 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xl froc-pulse-pink cursor-pointer"
      >
        {open ? <X className="w-6 h-6" /> : <Headset className="w-6 h-6" />}
        {unread && !open && <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-black" />}
      </button>
      {open && (
        <div className="fixed z-40 right-3 left-3 sm:left-auto bottom-36 lg:bottom-24 sm:w-96 froc-frame froc-pop" role="dialog" aria-label="Atendimento Froc">
          <div className="bg-white dark:bg-[#0b0b0c] flex flex-col max-h-[65vh]">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-display font-extrabold froc-logo">Atendimento Froc</div>
                <div className="text-[11px] text-slate-500">A Froc responde na hora; se precisar, a equipe assume aqui mesmo.</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar conversa"
                data-testid="support-close"
                className="shrink-0 -mr-1 -mt-1 w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto froc-scroll p-3 space-y-2 text-xs">
              {!msgs.length && (
                <div className="text-slate-500">
                  Olá! Sou a Froc. Me conte o que aconteceu ou o que você precisa — corrida, carona, frete, carteira ou cadastro.
                  <br />
                  <strong>Emergência?</strong> Ligue 190 ou use o botão SOS.
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={m.from === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-wrap ${
                      m.from === 'user'
                        ? 'bg-emerald-600 text-white'
                        : m.from === 'equipe'
                          ? 'bg-amber-100 dark:bg-amber-900/40 text-slate-900 dark:text-amber-50'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {m.from === 'equipe' && <div className="text-[10px] font-bold text-amber-700 dark:text-amber-300">Equipe Froc</div>}
                    {m.text}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="inline-flex items-center gap-2 text-slate-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Froc está digitando...
                </div>
              )}
              {error && <div className="text-red-600 font-semibold">{error}</div>}
              <div ref={end} />
            </div>
            <form onSubmit={send} className="p-2 border-t border-slate-200 dark:border-slate-800 flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escreva sua mensagem..."
                maxLength={1500}
                className="flex-1 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-sm"
              />
              <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar" className="w-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center cursor-pointer disabled:opacity-50">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
