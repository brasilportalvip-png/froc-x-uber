/**
 * Regras de respeito entre passageiro e motorista (cancelamento e tempo de espera).
 * FONTE ÚNICA: o servidor cobra por aqui e o app mostra os mesmos números ao passageiro.
 */

export const RIDE_POLICY_VERSION = '2026-11-16';

/** Cancelar até 1 min depois que o motorista aceitou: grátis. */
export const FREE_CANCEL_SEC = 60;
/** De 1 a 2 min: 50% do valor vai para o motorista. Depois de 2 min: 100%. */
export const HALF_CANCEL_SEC = 120;

/** Espera depois do aviso "motorista chegou": 1 min +10%, 2 min +30%, 3 min ou mais +50%. */
export const WAIT_TIERS: { afterSec: number; percent: number }[] = [
  { afterSec: 60, percent: 10 },
  { afterSec: 120, percent: 30 },
  { afterSec: 180, percent: 50 },
];

/** Depois de 5 min esperando, o motorista pode encerrar como "passageiro não apareceu" e recebe 100%. */
export const NO_SHOW_SEC = 5 * 60;
/** "Cheguei" só vale a até 300 m do ponto de embarque (evita motorista marcar chegada de longe). */
export const ARRIVAL_RADIUS_KM = 0.3;
/** Motorista atrasado (tempo estimado + 10 min sem chegar): passageiro cancela grátis. */
export const LATE_GRACE_MIN = 10;

/** Porcentagem do valor cobrada no cancelamento, pelo tempo desde o aceite do motorista. */
export function cancelFeePercent(secondsSinceAccept: number): 0 | 50 | 100 {
  if (secondsSinceAccept < FREE_CANCEL_SEC) return 0;
  if (secondsSinceAccept < HALF_CANCEL_SEC) return 50;
  return 100;
}

/** Acréscimo (%) pelo tempo que o motorista esperou no embarque. */
export function waitingFeePercent(waitSeconds: number): number {
  let pct = 0;
  for (const t of WAIT_TIERS) if (waitSeconds >= t.afterSec) pct = t.percent;
  return pct;
}

/** Próxima faixa de espera (para o contador do aviso). null = já está no máximo. */
export function nextWaitTier(waitSeconds: number) {
  return WAIT_TIERS.find((t) => waitSeconds < t.afterSec) ?? null;
}

export const RIDE_POLICY_TEXT = {
  title: 'Regras de respeito: cancelamento e tempo de espera',
  cancel: [
    'Cancelou até 1 minuto depois que o motorista aceitou: grátis, o dinheiro volta inteiro.',
    'Entre 1 e 2 minutos: 50% do valor vai para o motorista pelo deslocamento.',
    'Depois de 2 minutos, ou com o motorista já no embarque: o motorista recebe 100%.',
    'Antes de algum motorista aceitar, cancelar é sempre grátis.',
    'Se o motorista atrasar mais de 10 minutos além do tempo previsto, ou se ele desistir, você não paga nada.',
  ],
  wait: [
    'Quando o motorista chega, você recebe um aviso na tela. O primeiro minuto de espera é grátis.',
    'Depois de 1 minuto esperando: +10% no valor. Depois de 2 minutos: +30%. Depois de 3 minutos: +50% (máximo).',
    'Depois de 5 minutos, o motorista pode encerrar como "passageiro não apareceu" e recebe 100% do valor.',
    'O motorista só consegue avisar que chegou quando está a até 300 metros do ponto de embarque.',
  ],
};

export const policyKnowledgeText = () =>
  `${RIDE_POLICY_TEXT.title} (corridas; cobrança automática pela carteira): ${[...RIDE_POLICY_TEXT.cancel, ...RIDE_POLICY_TEXT.wait].join(' ')} Nas viagens agendadas valem as regras das caronas (caução, cancelamento conforme a antecedência, PIN de embarque). Nas entregas de lojas, a loja segue a regra de cancelamento; não há taxa de espera. A taxa vai para o motorista com o mesmo desconto da comissão de uma corrida normal.`;
