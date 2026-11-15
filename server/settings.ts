/** Configurações da plataforma que o administrador muda pelo painel Admin. */
export interface PlatformSettings {
  /** Comissão da plataforma em % (o prestador recebe o resto). */
  commissionPercent: number;
  /** Preço dinâmico por região (H3) ligado/desligado. */
  surgeEnabled: boolean;
  /** Multiplicador máximo do preço dinâmico (ex.: 2 = até o dobro). */
  maxSurge: number;
  /** Minutos procurando motorista antes de cancelar e estornar sozinho. */
  rideSearchTimeoutMin: number;
  /** Minutos que um pedido de negociação fica aberto. */
  indriveOpenTimeoutMin: number;
  /** Pontos de fidelidade por R$ 1 gasto em serviços concluídos. */
  pointsPerReal: number;
  /** Quantos pontos valem R$ 5 de crédito. */
  pointsPerRedeem: number;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  commissionPercent: 12,
  surgeEnabled: true,
  maxSurge: 2,
  rideSearchTimeoutMin: 10,
  indriveOpenTimeoutMin: 30,
  pointsPerReal: 1,
  pointsPerRedeem: 100,
};

export const SETTINGS_LIMITS: Record<keyof PlatformSettings, [number, number] | 'boolean'> = {
  commissionPercent: [0, 40],
  surgeEnabled: 'boolean',
  maxSurge: [1, 3],
  rideSearchTimeoutMin: [3, 60],
  indriveOpenTimeoutMin: [5, 240],
  pointsPerReal: [0, 10],
  pointsPerRedeem: [20, 10000],
};

export const REDEEM_VALUE_CENTS = 500;
