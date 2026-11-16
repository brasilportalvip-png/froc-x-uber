import React from 'react';

/** Envia o erro para o servidor (Admin → Equipe IA → Manutenção vê). Nunca quebra a página. */
export function reportClientError(message: string, stack = '', extra = '') {
  try {
    const body = JSON.stringify({
      message: String(message).slice(0, 500),
      stack: String(stack).slice(0, 3000),
      extra: String(extra).slice(0, 1500),
      url: location.pathname,
      ua: navigator.userAgent.slice(0, 200),
    });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
    else void fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch {
    /* nada */
  }
}

let installed = false;
/** Captura erros soltos (fora do React) e promessas sem tratamento. */
export function installGlobalErrorReporting() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => reportClientError(e.message, e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    reportClientError(r?.message || String(e.reason), r?.stack || '', 'promessa sem tratamento');
  });
}

interface State {
  error: Error | null;
}

/**
 * Se alguma tela quebrar, mostra um aviso com "Tentar de novo" em vez de página em branco,
 * e manda o erro (com o nome real do arquivo) para a equipe.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Tela quebrou:', error, info.componentStack);
    reportClientError(error.message, error.stack || '', info.componentStack || '');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#050505] text-white">
        <div className="max-w-sm w-full space-y-4 text-center">
          <div className="font-display text-2xl font-extrabold froc-logo">Froc X Uber</div>
          <p className="text-sm text-slate-300">Algo deu errado nesta tela. A equipe já recebeu o aviso automaticamente.</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-bold cursor-pointer"
          >
            Tentar de novo
          </button>
          <button type="button" onClick={() => location.reload()} className="w-full min-h-[44px] rounded-xl border border-white/20 text-sm font-semibold cursor-pointer">
            Recarregar o app
          </button>
          <p className="text-[10px] text-slate-500 break-words">{this.state.error.message}</p>
        </div>
      </div>
    );
  }
}
