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
  /** Idade máxima do veículo de passageiro (anos de fabricação); a regra da cidade vale se for mais rígida. */
  maxVehicleAgeYears: number;
  /** Dinâmico por faixa de horário (madrugada, picos, almoço, noite, fim de semana). */
  timeSurgeEnabled: boolean;
  /** Ganho da Froc por corrida: mínimo, máximo (R$) e teto em % da corrida. */
  platformFeeMin: number;
  platformFeeMax: number;
  platformFeeMaxPct: number;
  /** Equipe IA executa sozinha (pagar, aprovar, bloquear, configurar) — o dono não precisa clicar. */
  agentAutonomy: boolean;
  /** Valor máximo de UM saque que a Equipe IA libera sozinha (R$). Acima disso o Financeiro analisa antes. */
  autoPayoutLimit: number;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  commissionPercent: 12,
  surgeEnabled: true,
  maxSurge: 2,
  rideSearchTimeoutMin: 10,
  indriveOpenTimeoutMin: 30,
  pointsPerReal: 1,
  pointsPerRedeem: 100,
  maxVehicleAgeYears: 10,
  timeSurgeEnabled: true,
  platformFeeMin: 2,
  platformFeeMax: 8,
  platformFeeMaxPct: 30,
  agentAutonomy: true,
  autoPayoutLimit: 1000,
};

export const SETTINGS_LIMITS: Record<keyof PlatformSettings, [number, number] | 'boolean'> = {
  commissionPercent: [0, 40],
  surgeEnabled: 'boolean',
  maxSurge: [1, 3],
  rideSearchTimeoutMin: [3, 60],
  indriveOpenTimeoutMin: [5, 240],
  pointsPerReal: [0, 10],
  pointsPerRedeem: [20, 10000],
  maxVehicleAgeYears: [3, 25],
  timeSurgeEnabled: 'boolean',
  platformFeeMin: [0, 20],
  platformFeeMax: [1, 40],
  platformFeeMaxPct: [5, 50],
  agentAutonomy: 'boolean',
  autoPayoutLimit: [0, 20000],
};

export const REDEEM_VALUE_CENTS = 500;
