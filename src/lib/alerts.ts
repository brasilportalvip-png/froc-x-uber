/**
 * Avisos que chamam a atenção da pessoa: vibração, um "plim" curto e, se o app estiver em
 * segundo plano (outra aba ou tela), uma notificação do navegador.
 * Sem servidor de push: funciona enquanto o navegador estiver aberto (mesmo minimizado).
 */
let audio: AudioContext | null = null;

function beep(times = 2) {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctx) return;
    audio ??= new Ctx();
    for (let i = 0; i < times; i++) {
      const start = audio.currentTime + i * 0.28;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = i % 2 ? 1175 : 880;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    }
  } catch {
    /* sem som neste aparelho */
  }
}

/** Pede permissão de notificação (chame num toque da pessoa, ex.: ao ficar online). */
export function askNotificationPermission() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
    // Libera o som (navegadores só tocam depois de um toque da pessoa).
    beep(0);
  } catch {
    /* navegador sem notificação */
  }
}

export function alertUser(title: string, body: string, options: { vibrate?: number[]; beeps?: number } = {}) {
  try {
    navigator.vibrate?.(options.vibrate ?? [300, 120, 300]);
  } catch {
    /* sem vibração */
  }
  beep(options.beeps ?? 2);
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      const n = new Notification(title, { body, icon: '/pwa-192x192.png', tag: title });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  } catch {
    /* notificação indisponível */
  }
}
