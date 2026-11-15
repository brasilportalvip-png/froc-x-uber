import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Instalar App</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Smartphone className="w-4 h-4 shrink-0" />
        <span>Baixar App</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <h3 id="pwa-guide-title" className="text-lg font-bold text-slate-900 dark:text-white">
                Instalar Froc X Uber no celular ou PC
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                aria-label="Fechar guia"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Este site funciona como um aplicativo nativo (PWA) com acesso rápido na tela inicial e modo offline.
            </p>
            <div className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/70 rounded-xl p-4 border border-slate-200 dark:border-slate-800">
              {isIOS ? (
                <>
                  <p>
                    <strong>1.</strong> Toque no botão <strong>Compartilhar</strong> na barra inferior do Safari.
                  </p>
                  <p>
                    <strong>2.</strong> Role para baixo e toque em <strong>Adicionar à Tela de Início</strong>.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>Android / Chrome:</strong> Abra o menu (⋮) do navegador e toque em{' '}
                    <strong>Instalar aplicativo</strong>.
                  </p>
                  <p>
                    <strong>Desktop (Chrome / Edge):</strong> Clique no ícone de instalação na barra de endereços ou em
                    Salvar e compartilhar.
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-sm font-semibold hover:opacity-95 transition cursor-pointer"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      <span>Modo Offline · Dados em cache ativos</span>
    </div>
  );
};
