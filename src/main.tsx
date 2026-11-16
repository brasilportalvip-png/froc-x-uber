import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary, installGlobalErrorReporting, reportClientError } from './components/ErrorBoundary.tsx';
import './index.css';

installGlobalErrorReporting();

createRoot(document.getElementById('root')!, {
  // Erros que o React pega fora da tela (efeitos, limpeza) também vão para a equipe.
  onUncaughtError: (error, info) => {
    const e = error as Error;
    console.error('Erro no app:', e, info?.componentStack);
    reportClientError(e?.message || String(error), e?.stack || '', info?.componentStack || '');
  },
  onCaughtError: (error, info) => {
    const e = error as Error;
    reportClientError(e?.message || String(error), e?.stack || '', info?.componentStack || '');
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
