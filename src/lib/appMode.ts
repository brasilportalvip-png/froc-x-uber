import type { AppModule, UserRole } from '../types/mobility.ts';

/**
 * Modo do app: Passageiro (pede corrida, vê caronas e oportunidades de viagem) ou
 * Motorista (fica online, se cadastra, lança caronas). Fica salvo no aparelho, então o
 * motorista não precisa trocar de modo toda vez que abre o app.
 */
export type AppMode = 'passenger' | 'driver';
const KEY = 'froc-mode';

export function modeOf(role: UserRole): AppMode {
  return role === 'passenger' ? 'passenger' : 'driver';
}

/** Papel ao tocar no modo do topo. Motorista na aba Cargas vira transportador. */
export function roleForMode(mode: AppMode, activeModule: AppModule, current: UserRole): UserRole {
  if (mode === 'passenger') return 'passenger';
  if (activeModule === 'freight') return 'trucker';
  return current === 'trucker' ? 'trucker' : 'driver';
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const storage = (): StorageLike | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function loadRole(s: StorageLike | null = storage()): UserRole | null {
  try {
    const v = s?.getItem(KEY);
    return v === 'passenger' || v === 'driver' || v === 'trucker' ? v : null;
  } catch {
    return null;
  }
}

export function saveRole(role: UserRole, s: StorageLike | null = storage()) {
  try {
    s?.setItem(KEY, role);
  } catch {
    /* modo privado do navegador: só não lembra */
  }
}

/** Sem modo salvo: quem já é motorista aprovado abre como motorista; o resto, passageiro. */
export function initialRole(saved: UserRole | null, profile?: { driverStatus?: string; truckerStatus?: string } | null): UserRole {
  if (saved) return saved;
  if (profile?.driverStatus === 'approved') return 'driver';
  if (profile?.truckerStatus === 'approved') return 'trucker';
  return 'passenger';
}
