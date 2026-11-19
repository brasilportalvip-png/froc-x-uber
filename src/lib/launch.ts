/** Grande inauguração do Froc X Uber: 10 de março de 2027, 00h (horário de Brasília). */
export const LAUNCH_AT = new Date('2027-03-10T00:00:00-03:00');
export const LAUNCH_LABEL = '10 de março de 2027';

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  launched: boolean;
}

export function countdownTo(target: Date, now: Date = new Date()): Countdown {
  const ms = Math.max(0, target.getTime() - now.getTime());
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    launched: ms === 0,
  };
}

/** Intenção escolhida na página inicial (motorista, caminhoneiro) para abrir o app no lugar certo. */
export type SignupIntent = 'passenger' | 'driver' | 'trucker';
const INTENT_KEY = 'froc-intent';

export function saveIntent(intent: SignupIntent) {
  try {
    localStorage.setItem(INTENT_KEY, intent);
  } catch {
    /* sem armazenamento */
  }
}

export function takeIntent(): SignupIntent | null {
  try {
    const v = localStorage.getItem(INTENT_KEY);
    localStorage.removeItem(INTENT_KEY);
    return v === 'driver' || v === 'trucker' || v === 'passenger' ? v : null;
  } catch {
    return null;
  }
}

export const SHARE_TEXT =
  'Vem aí o Froc X Uber: corridas, viagens agendadas, caronas e fretes num app só. Inauguração em 10/03/2027. Cadastre-se: https://froc-x-uber.vercel.app';
