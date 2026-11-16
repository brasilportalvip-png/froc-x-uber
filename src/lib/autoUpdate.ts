/**
 * Atualização automática (site e app Android): cada `vercel --prod` vira a versão nova
 * no celular sem passar pela Play Store.
 *
 * - Ao voltar para o app (ou a cada 15 min aberto) pergunta ao servidor se há versão nova.
 * - Se houver, recarrega na hora se o app estiver em segundo plano; se estiver na tela,
 *   espera a pessoa sair e voltar (nunca recarrega no meio de um toque ou de uma corrida).
 */
export function installAutoUpdate() {
  if (!('serviceWorker' in navigator)) return;
  let pending = false;
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Primeira instalação (sem versão anterior) não precisa recarregar.
    if (!sessionStorageGet('froc-sw-had-controller')) return;
    if (document.visibilityState === 'hidden') reload();
    else pending = true;
  });
  if (navigator.serviceWorker.controller) sessionStorageSet('froc-sw-had-controller', '1');
  const check = () => {
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => undefined);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending) reload();
    if (document.visibilityState === 'visible') check();
  });
  setInterval(check, 15 * 60 * 1000);
}

function sessionStorageGet(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function sessionStorageSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* navegador sem armazenamento */
  }
}
