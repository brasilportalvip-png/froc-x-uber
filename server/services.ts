/**
 * Regras de negócio do Froc X Uber (as 4 modalidades + carteira + administração).
 *
 * Princípios:
 * - Cada pessoa só vê e mexe no que é dela; motorista/caminhoneiro só atua depois de aprovado.
 * - TODO pagamento passa pela carteira Froc (não existe mais dinheiro em mãos): a pessoa
 *   recarrega por Pix/cartão, o valor sai da carteira dela no pedido e fica RETIDO (custódia);
 *   no fim do serviço vai sozinho para a carteira do motorista (menos a comissão).
 *   Cancelamento devolve o valor retido. O motorista saca por Pix para qualquer conta.
 * - Só o que o prestador GANHOU pode ser sacado (recarga de cartão não vira Pix: evita golpe
 *   de cartão roubado → recarga → saque).
 * - Toda mudança de dinheiro acontece dentro de uma transação (lê tudo, depois grava).
 * - Nada é simulado: sem motorista inventado, sem saldo inventado, sem pagamento sem cobrança.
 */
import { CARGO_VEHICLE_TYPES } from '../src/data/cargoVehicles.ts';
import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { minVehicleYear, vehicleAgeLimit } from '../src/data/legal.ts';
import { platformFee, priceRide, riskZoneFor, timeBandAt } from '../src/data/pricing.ts';
import type { PriceBreakdown, RiskZoneLike } from '../src/data/pricing.ts';
import { ARRIVAL_RADIUS_KM, LATE_GRACE_MIN, NO_SHOW_SEC, RIDE_POLICY_VERSION, cancelFeePercent, waitingFeePercent } from '../src/data/ridePolicy.ts';
import { formatCnpj, isValidCnpj, newWebhookSecret, validateWebhookUrl } from './merchants.ts';
import type { WebhookDispatcher } from './merchants.ts';
import type { Geocoder } from './geocode.ts';
import { ageOn, cpfKey, formatCpf, isValidCpf, maskCpf, maskEmail, namesMatch, onlyDigits } from './identity.ts';
import type { CpfStatus, CpfVerifier } from './identity.ts';
import { BRAZIL_LOCATIONS, calculateDistanceKm, estimateDurationMin, RIDE_CATEGORIES } from '../src/data/locations.ts';
import type {
  AdminOverview,
  ApprovalStatus,
  DeliveryStatus,
  DeliveryView,
  MerchantProfileView,
  NearbyDriver,
  TrackView,
  CarpoolTrip,
  EmptyTruckRoute,
  FreightRequest,
  GeoPoint,
  InDriveRequest,
  PaymentMethod,
  RideOrder,
  TruckType,
  UserProfile,
  WalletTransaction,
} from '../src/types/mobility.ts';
import type { Doc, Store, Tx } from './store.ts';
import { DEFAULT_SETTINGS, REDEEM_VALUE_CENTS, SETTINGS_LIMITS } from './settings.ts';
import type { PlatformSettings } from './settings.ts';
import { createGridGeo, DISPATCH_RING, SURGE_RING } from './geo.ts';
import type { GeoIndex } from './geo.ts';

export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status: number, code: string, message: string): never => {
  throw new AppError(status, code, message);
};

export const MIN_WITHDRAWAL_CENTS = 2000;
const TRUCK_TYPES: TruckType[] = [...CARGO_VEHICLE_TYPES];
const DOC_TYPES = { driver: ['cnh', 'crlv', 'antecedentes'], trucker: ['cnh', 'crlv', 'antt', 'antecedentes'] } as const;

/** Declarações exigidas por lei no cadastro (a pessoa marca; a equipe confere nos documentos). */
export const DECLARATIONS = {
  driver: ['ear', 'inss', 'seguroApp', 'veracidade'],
  moto: ['ear', 'inss', 'seguroApp', 'lei12009', 'veracidade'],
  trucker: ['ear', 'rntrc', 'ciotPiso', 'veracidade'],
  merchant: ['responsavel', 'proibidos', 'veracidade'],
} as const;

const MERCHANT_CATEGORIES = ['lanchonete', 'restaurante', 'pastelaria', 'pizzaria', 'padaria', 'mercado', 'farmacia', 'loja', 'pet', 'outro'];
/** Entregas sem entregador por este tempo são canceladas e o valor volta para a loja. */
const DELIVERY_SEARCH_MIN = 20;
const SHARE_TTL_MS = 24 * 3600_000;
const SHARE_AFTER_END_MS = 2 * 3600_000;
const ACTIVE_RIDE = ['searching', 'accepted', 'arriving', 'in_progress'];

const DELIVERY_STATUS: Record<string, [DeliveryStatus, string]> = {
  searching: ['procurando_entregador', 'Procurando entregador'],
  accepted: ['entregador_a_caminho', 'Entregador a caminho da loja'],
  arriving: ['entregador_na_loja', 'Entregador chegou na loja'],
  in_progress: ['saiu_para_entrega', 'Saiu para entrega'],
  completed: ['entregue', 'Entregue'],
  cancelled: ['cancelada', 'Cancelada'],
};

const firstName = (name: unknown) => String(name || '').trim().split(/\s+/)[0] || '';

/** Direção (graus, 0 = norte) de um ponto para outro: usada para girar o carrinho no mapa. */
export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/** Distância em linha reta (km), sem o fator de ruas. */
function straightKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Descobre o tipo da chave Pix (ou '' se não parece uma chave válida). */
export function pixKeyKind(key: string): string {
  const k = key.trim();
  const digits = k.replace(/\D/g, '');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return 'email';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return 'aleatoria';
  if (/^\+?55/.test(k.replace(/[\s()-]/g, '')) && (digits.length === 12 || digits.length === 13)) return 'telefone';
  if (digits.length === 14 && /^[\d./-]+$/.test(k)) return 'cnpj';
  if (digits.length === 11 && /^[\d.-]+$/.test(k)) return 'cpf';
  if ((digits.length === 10 || digits.length === 11) && /^[\d\s()+-]+$/.test(k)) return 'telefone';
  return '';
}

/** Mostra só o começo e o fim da chave Pix no extrato. */
const maskPix = (key: string) => (key.length <= 6 ? key : `${key.slice(0, 3)}…${key.slice(-3)}`);

/** Dia (AAAA-MM-DD) válido? */
function parseDay(value: unknown) {
  const v = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) ? v : '';
}
const ALLOWED_DOC_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const MAX_DOC_BYTES = 3 * 1024 * 1024;

export interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  /**
   * Preenchido só pelo próprio servidor quando quem age é um agente da Equipe IA
   * (nunca vem do navegador: o token do Firebase não tem este campo).
   */
  agent?: string;
}

/** Grande inauguração: quem cria a conta antes disso ganha o selo de membro fundador. */
export const LAUNCH_AT_ISO = '2027-03-10T03:00:00.000Z';

export interface PaymentsGateway {
  configured: boolean;
  createCheckout(input: {
    reference: string;
    amountCents: number;
    title: string;
    payerEmail: string;
  }): Promise<{ checkoutUrl: string; preferenceId: string }>;
  /** Procura um pagamento aprovado com esta referência. */
  findApproved(reference: string): Promise<{ paymentId: string; amountCents: number } | null>;
  /** Lê um pagamento (usado pelo aviso automático do Mercado Pago). */
  getPayment(paymentId: string): Promise<{ reference: string; status: string; amountCents: number } | null>;
}

export interface FileStorage {
  save(path: string, contentType: string, bytes: Uint8Array): Promise<void>;
  signedUrl(path: string): Promise<string>;
  /** Lê um arquivo (usado para servir as imagens do blog). null se não existir. */
  read?(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** Apaga um arquivo (capa de post apagado). */
  remove?(path: string): Promise<void>;
}

export interface ServiceDeps {
  now?: () => Date;
  payments?: PaymentsGateway;
  files?: FileStorage;
  adminEmails?: string[];
  /** Índice geográfico (H3 em produção; grade simples nos testes). */
  geo?: GeoIndex;
  /** Avisos automáticos para o sistema das lojas (Froc Entregas). */
  webhooks?: WebhookDispatcher;
  /** Endereço → coordenadas para a API de entregas (opcional). */
  geocode?: Geocoder;
  /**
   * CPF obrigatório (uma pessoa, uma conta) e conferência na Receita (Serpro, opcional).
   * Em produção required=true; os testes antigos ligam só quando testam isso.
   */
  identity?: { required?: boolean; verify?: CpfVerifier };
  /** Envio automático de Pix (saques). Sem ele, a Equipe IA aprova e o Pix fica "a enviar". */
  payouts?: PayoutGateway;
  /** Consulta pública de CNPJ (aprovação automática de lojas). */
  cnpjLookup?: (cnpj: string) => Promise<{ active: boolean; name: string; situation: string } | null>;
}

export interface PayoutGateway {
  send(w: { id: string; amountCents: number; pixKey: string; pixKeyType: string; name: string }): Promise<{ ok: boolean; externalId?: string; error?: string }>;
}

/** Identidade de um agente da Equipe IA agindo pelas rotinas automáticas (vale como administração). */
export const agentAuth = (id: string, name: string): AuthUser => ({ uid: `ia:${id}`, email: `ia+${id}@froc`, emailVerified: true, agent: name });

/** Localização do motorista é considerada "fresca" por 3 minutos. */
const LOCATION_FRESH_MS = 3 * 60 * 1000;

interface UserDoc extends Doc {
  uid: string;
  email: string;
  name: string;
  phone: string;
  city: string;
  rating: number;
  ratingCount: number;
  balanceCents: number;
  completedTrips: number;
  driverOnline: boolean;
  driverVehicle: string;
  driverPlate: string;
  truckModel: string;
  truckType: TruckType;
  truckPlate: string;
  companyName: string;
  /** Registro na ANTT (obrigatório para frete pago). */
  rntrc?: string;
  driverStatus: ApprovalStatus;
  truckerStatus: ApprovalStatus;
  driverDocs: Record<string, string>;
  truckerDocs: Record<string, string>;
  driverSubmittedAt?: string;
  truckerSubmittedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  blocked?: boolean;
  blockedReason?: string;
  points?: number;
  passengerRating?: number;
  passengerRatingCount?: number;
  driverLat?: number;
  driverLng?: number;
  driverCell?: string;
  locationAt?: string;
  driverHeading?: number;
  driverVehicleType?: 'carro' | 'moto';
  driverVehicleYear?: number;
  driverCity?: string;
  driverState?: string;
  cnhExpiry?: string;
  /** Declarações legais marcadas no cadastro (chave → data/hora). */
  declarations?: Record<string, string>;
  qualityAlert?: string;
  merchantStatus?: ApprovalStatus;
  merchant?: Doc;
  merchantSubmittedAt?: string;
  merchantCnpj?: string;
  /** Quanto do saldo veio de ganhos (só isso pode ser sacado). Ausente = conta antiga (usa o saldo). */
  earnedCents?: number;
  ridePolicyAccepted?: string;
  ridePolicyAcceptedAt?: string;
  cpfStatus?: CpfStatus;
  cpfMasked?: string;
  cpfKey?: string;
  /** Como o CPF foi conferido: receita (Serpro), documentos (CNH conferida pela equipe), equipe ou basico. */
  cpfSource?: string;
  cpfVerifiedAt?: string;
  legalName?: string;
  multiAccountFlag?: string;
  /** Documento com foto que o passageiro enviou para a IA conferir o CPF. */
  identityDocPath?: string;
  /** Última leitura de documento feita pela IA (resultado, EAR e validade da CNH). */
  aiDocCheck?: Doc;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const toCents = (reais: number) => Math.round(reais * 100);
const toReais = (cents: number) => round2(cents / 100);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Preço mínimo da negociação: cobre combustível e tempo (evita oferta abusiva). */
export function negotiationFloor(distanceKm: number) {
  const km = Math.max(0.1, distanceKm);
  const minutes = Math.max(1, Math.round(km * 2));
  return round2(Math.max(8.5, km * 1.65 + minutes * 0.2));
}

/** Preço mínimo de frete/mudança (protege o caminhoneiro de lance abaixo do custo). */
export function freightFloor(distanceKm: number) {
  return round2(Math.max(150, Math.max(1, distanceKm) * 2.2));
}

/**
 * Lista de e-mails de administrador. Aceita vírgula, ponto e vírgula, espaço ou quebra de
 * linha entre eles e ignora aspas coladas por engano na Vercel ("email@x.com").
 */
export function parseAdminEmails(raw: string | string[] | undefined): string[] {
  const joined = Array.isArray(raw) ? raw.join(',') : raw || '';
  return joined
    .split(/[\s,;]+/)
    .map((e) => e.replace(/^["'<]+|["'>]+$/g, '').trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

function text(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function num(value: unknown, min: number, max: number, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    fail(400, 'invalid_' + field, `Valor inválido para ${field} (entre ${min} e ${max}).`);
  return n;
}

/** Só existe a carteira Froc. Pedido "em dinheiro" (app antigo no celular) é recusado com explicação. */
function paymentMethod(value: unknown): PaymentMethod {
  if (value === 'cash')
    fail(400, 'cash_disabled', 'Pagamento em dinheiro não existe mais: tudo é pago pela carteira Froc (recarga por Pix ou cartão). Atualize a página.');
  return 'froc_pay';
}

/** Aceita um ponto do mapa (lat/lng reais do Google) ou um local da lista. */
export function resolvePoint(point: unknown, fallbackId: unknown): GeoPoint {
  if (point && typeof point === 'object') {
    const p = point as Record<string, unknown>;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && typeof p.name === 'string') {
      // O app atende todo o Brasil (inclui ilhas como Fernando de Noronha e Trindade).
      if (lat < -34.5 || lat > 5.9 || lng < -74.5 || lng > -28.5)
        fail(400, 'outside_brazil', 'Escolha um local dentro do Brasil.');
      return {
        id: text(p.id, 80) || `ponto-${lat.toFixed(5)}-${lng.toFixed(5)}`,
        name: text(p.name, 160),
        city: text(p.city, 80) || 'Brasil',
        state: text(p.state, 4) || 'BR',
        zone: p.zone === 'intercity' ? 'intercity' : 'urban',
        lat,
        lng,
        kind: (['avenue', 'airport', 'terminal', 'neighborhood', 'city', 'hub'] as const).includes(p.kind as never)
          ? (p.kind as GeoPoint['kind'])
          : 'avenue',
      };
    }
  }
  const found = BRAZIL_LOCATIONS.find((l) => l.id === fallbackId);
  return found ?? fail(400, 'invalid_location', 'Escolha um local válido de partida e destino.');
}

function involvement(uid: string, ownerId: unknown, providerId: unknown): 'owner' | 'provider' | null {
  if (ownerId === uid) return 'owner';
  if (providerId === uid) return 'provider';
  return null;
}

const byNewest = <T extends Doc>(items: T[]) =>
  items.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

function uniqueById<T extends Doc>(items: T[]): T[] {
  const seen = new Set<unknown>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

/**
 * SIGILO do ganho da Froc: tira de um pedido (ou orçamento) tudo que mostra ou permite
 * calcular quanto a Froc ganha. 'cliente' vê o preço; 'motorista' vê só quanto recebe.
 */
export function hideFee(doc: Doc, viewer: 'cliente' | 'motorista') {
  delete doc.platformFeeCents;
  delete doc.platformFee;
  delete doc.feeReasons;
  const pricing = doc.pricing as Doc | undefined;
  if (pricing && typeof pricing === 'object') {
    const p = { ...pricing };
    delete p.platformFee;
    delete p.feeReasons;
    if (viewer === 'cliente') delete p.driverEarning;
    else {
      delete p.total;
      delete p.base;
    }
    doc.pricing = p;
  }
  if (viewer === 'cliente') delete doc.driverEarning;
  else if (typeof doc.driverEarning === 'number') {
    // O motorista vê o valor dele no lugar do preço do passageiro.
    doc.price = doc.driverEarning;
  }
}

export class FrocService {
  store: Store;
  deps: ServiceDeps;
  geo: GeoIndex;
  private cfg: PlatformSettings = { ...DEFAULT_SETTINGS };
  private cfgLoadedAt = 0;
  private lastSweep = 0;
  private onlineCache: { at: number; users: UserDoc[] } = { at: 0, users: [] };
  private riskCache: { at: number; zones: RiskZoneLike[] } = { at: 0, zones: [] };

  constructor(store: Store, deps: ServiceDeps = {}) {
    this.store = store;
    this.deps = deps;
    this.geo = deps.geo ?? createGridGeo();
  }

  // ------------------------------------------------------------ configurações

  async settings(): Promise<PlatformSettings> {
    if (Date.now() - this.cfgLoadedAt > 30_000) {
      const stored = await this.store.get<Doc>('settings', 'platform');
      this.cfg = { ...DEFAULT_SETTINGS, ...(stored as Partial<PlatformSettings> | null) };
      this.cfgLoadedAt = Date.now();
    }
    return this.cfg;
  }

  /** Parte do prestador, em centavos, conforme a comissão configurada. */
  private providerCut(cents: number) {
    return Math.round(cents * (1 - this.cfg.commissionPercent / 100));
  }

  async updateSettings(auth: AuthUser, patch: Record<string, unknown>) {
    this.requireAdmin(auth);
    const current = await this.settings();
    const next: PlatformSettings = { ...current };
    for (const [key, limits] of Object.entries(SETTINGS_LIMITS) as [keyof PlatformSettings, [number, number] | 'boolean'][]) {
      if (!(key in patch)) continue;
      if (limits === 'boolean') (next as unknown as Record<string, unknown>)[key] = patch[key] === true;
      else (next as unknown as Record<string, unknown>)[key] = round2(num(patch[key], limits[0], limits[1], key));
    }
    await this.store.set('settings', 'platform', { ...next, updatedBy: auth.email, updatedAt: this.iso() });
    this.cfg = next;
    this.cfgLoadedAt = Date.now();
    await this.audit(auth, 'configuracoes_alteradas', 'platform', { antes: current, depois: next });
    return next;
  }

  /** Conta bloqueada pela administração não usa o app (conferido em toda requisição). */
  async checkAccess(auth: AuthUser) {
    const user = await this.store.get<UserDoc>('users', auth.uid);
    if (user?.blocked && !this.isAdmin(auth))
      fail(403, 'blocked', 'Sua conta está bloqueada' + (user.blockedReason ? `: ${user.blockedReason}` : '.') + ' Fale com o suporte.');
  }

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }

  private iso() {
    return this.now().toISOString();
  }

  isAdmin(auth: AuthUser) {
    if (auth.agent) return true;
    return auth.emailVerified && parseAdminEmails(this.deps.adminEmails).includes(auth.email.trim().toLowerCase());
  }

  /** Registro de auditoria: quem (pessoa ou agente de IA) fez o quê, quando. */
  async audit(auth: AuthUser | null, action: string, target: string, details: Record<string, unknown> = {}) {
    const id = randomUUID();
    await this.store
      .set('audit', id, {
        id,
        action,
        target,
        actor: auth ? auth.email || auth.uid : 'sistema',
        actorType: auth?.agent ? 'ia' : auth ? 'admin' : 'sistema',
        agent: auth?.agent || '',
        details: JSON.parse(JSON.stringify(details ?? {})),
        createdAt: this.iso(),
      })
      .catch((e) => console.error('Falha ao gravar auditoria:', e));
  }

  async auditLog(auth: AuthUser, limit = 100) {
    this.requireAdmin(auth);
    return byNewest(await this.store.query<Doc>('audit', [], 1000)).slice(0, Math.min(500, limit));
  }

  // ---------------------------------------------------------------- usuários

  async ensureUser(auth: AuthUser): Promise<UserDoc> {
    const existing = await this.store.get<UserDoc>('users', auth.uid);
    if (existing) return existing;
    const user: UserDoc = {
      uid: auth.uid,
      email: auth.email,
      name: text(auth.name, 80) || auth.email.split('@')[0],
      phone: '',
      city: '',
      rating: 5,
      ratingCount: 0,
      balanceCents: 0,
      earnedCents: 0,
      completedTrips: 0,
      driverOnline: false,
      driverVehicle: '',
      driverPlate: '',
      truckModel: '',
      truckType: '3/4 Baú',
      truckPlate: '',
      companyName: '',
      driverStatus: 'none',
      truckerStatus: 'none',
      driverDocs: {},
      truckerDocs: {},
      createdAt: this.iso(),
    };
    await this.store.set('users', auth.uid, user);
    return user;
  }

  profileView(user: UserDoc, auth: AuthUser): UserProfile {
    return {
      uid: user.uid,
      email: user.email,
      emailVerified: auth.emailVerified,
      isAdmin: this.isAdmin(auth),
      driverStatus: user.driverStatus,
      truckerStatus: user.truckerStatus,
      rejectionReason: user.rejectionReason,
      completedTrips: user.completedTrips,
      companyName: user.companyName,
      rntrc: user.rntrc || '',
      name: user.name,
      phone: user.phone,
      city: user.city,
      rating: round2(user.rating),
      walletBalance: toReais(user.balanceCents),
      driverOnline: user.driverOnline,
      driverVehicle: user.driverVehicle,
      driverPlate: user.driverPlate,
      truckModel: user.truckModel,
      truckType: user.truckType,
      truckPlate: user.truckPlate,
      points: user.points || 0,
      passengerRating: round2(user.passengerRating ?? 5),
      pointsPerRedeem: this.cfg.pointsPerRedeem,
      commissionPercent: this.cfg.commissionPercent,
      driverDocsSent: Object.keys(user.driverDocs || {}),
      truckerDocsSent: Object.keys(user.truckerDocs || {}),
      founder: String(user.createdAt || '') < LAUNCH_AT_ISO,
      driverVehicleType: user.driverVehicleType || 'carro',
      driverVehicleYear: user.driverVehicleYear,
      driverCity: user.driverCity || '',
      driverState: user.driverState || '',
      cnhExpiry: user.cnhExpiry || '',
      maxVehicleAgeYears: this.cfg.maxVehicleAgeYears,
      withdrawableBalance: toReais(this.withdrawable(user)),
      cpfStatus: user.cpfStatus || 'none',
      cpfMasked: user.cpfMasked || '',
      cpfSource: user.cpfSource || '',
      identityRequired: Boolean(this.deps.identity?.required),
      identityDocCheck: user.aiDocCheck ? { status: String(user.aiDocCheck.status), reasons: (user.aiDocCheck.reasons as string[]) || [] } : null,
      merchantStatus: user.merchantStatus || 'none',
      merchant: this.merchantView(user),
    };
  }

  private merchantView(user: UserDoc): MerchantProfileView | null {
    const m = user.merchant;
    if (!m) return null;
    return {
      companyName: String(m.companyName || ''),
      cnpj: String(m.cnpj || ''),
      phone: String(m.phone || ''),
      category: String(m.category || ''),
      pickup: (m.pickup as GeoPoint) || null,
      pickupNote: String(m.pickupNote || ''),
      webhookUrl: String(m.webhookUrl || ''),
      hasWebhookSecret: Boolean(m.webhookSecret),
      submittedAt: user.merchantSubmittedAt,
    };
  }

  async updateProfile(auth: AuthUser, patch: Record<string, unknown>) {
    const user = await this.ensureUser(auth);
    const next: Partial<UserDoc> = {};
    // Com CPF confirmado, o nome vem do cadastro do CPF (ninguém vira outra pessoa no app).
    if ('name' in patch && !['basic', 'verified'].includes(String(user.cpfStatus))) next.name = text(patch.name, 80) || user.name;
    if ('phone' in patch) next.phone = text(patch.phone, 30);
    if ('city' in patch) next.city = text(patch.city, 80);
    if ('driverOnline' in patch) {
      if (patch.driverOnline === true && user.driverStatus !== 'approved' && user.truckerStatus !== 'approved')
        fail(403, 'not_approved', 'Seu cadastro de motorista ainda não foi aprovado.');
      if (patch.driverOnline === true) this.identityGate(user);
      if (patch.driverOnline === true && user.cnhExpiry && user.cnhExpiry < this.iso().slice(0, 10))
        fail(403, 'cnh_expired', 'Sua CNH venceu. Envie a CNH nova pelo Atendimento para voltar a ficar online.');
      next.driverOnline = patch.driverOnline === true;
    }
    // Veículo só muda enquanto o cadastro não está aprovado (a aprovação vale para aquele veículo).
    if (user.driverStatus !== 'approved') {
      if ('driverVehicle' in patch) next.driverVehicle = text(patch.driverVehicle, 80);
      if ('driverPlate' in patch) next.driverPlate = text(patch.driverPlate, 10).toUpperCase();
    }
    if (user.truckerStatus !== 'approved') {
      if ('truckModel' in patch) next.truckModel = text(patch.truckModel, 80);
      if ('truckPlate' in patch) next.truckPlate = text(patch.truckPlate, 10).toUpperCase();
      if ('truckType' in patch && TRUCK_TYPES.includes(patch.truckType as TruckType)) next.truckType = patch.truckType as TruckType;
      if ('companyName' in patch) next.companyName = text(patch.companyName, 80);
    }
    await this.store.update('users', auth.uid, next);
    return this.profileView({ ...user, ...next }, auth);
  }

  private async approvedUser(auth: AuthUser, kind: 'driver' | 'trucker') {
    const user = await this.ensureUser(auth);
    const status = kind === 'driver' ? user.driverStatus : user.truckerStatus;
    if (status !== 'approved')
      fail(
        403,
        'not_approved',
        kind === 'driver'
          ? 'Para atuar como motorista, envie seus documentos na aba Conta e aguarde a aprovação.'
          : 'Para atuar como caminhoneiro, envie seus documentos na aba Conta e aguarde a aprovação.',
      );
    return user;
  }

  private async anyProvider(auth: AuthUser) {
    const user = await this.ensureUser(auth);
    if (user.driverStatus !== 'approved' && user.truckerStatus !== 'approved')
      fail(403, 'not_approved', 'Seu cadastro de motorista ainda não foi aprovado.');
    return user;
  }

  // ------------------------------------------------------------- carteira

  private ledger(tx: Tx, uid: string, title: string, category: WalletTransaction['category'], cents: number, type: 'credit' | 'debit') {
    const id = randomUUID();
    tx.set('transactions', id, { id, uid, title, category, amountCents: cents, type, createdAt: this.iso() });
  }

  private moveMoney(tx: Tx, user: UserDoc, delta: number) {
    user.balanceCents += delta;
    tx.update('users', user.uid, { balanceCents: user.balanceCents });
  }

  private debit(tx: Tx, user: UserDoc, cents: number, title: string, category: WalletTransaction['category'], allowNegative = false) {
    if (!allowNegative && user.balanceCents < cents)
      fail(402, 'insufficient_balance', 'Saldo insuficiente na carteira. Faça uma recarga por Pix ou cartão.');
    this.moveMoney(tx, user, -cents);
    this.ledger(tx, user.uid, title, category, cents, 'debit');
  }

  private credit(tx: Tx, user: UserDoc, cents: number, title: string, category: WalletTransaction['category']) {
    this.moveMoney(tx, user, cents);
    this.ledger(tx, user.uid, title, category, cents, 'credit');
  }

  private async mustGet<T extends Doc>(tx: Tx, col: string, id: string, label: string): Promise<T> {
    const doc = await tx.get<T>(col, id);
    return doc ?? fail(404, 'not_found', `${label} não encontrado(a).`);
  }

  /** Registra a comissão da plataforma (usado nos relatórios do Admin). */
  private platformRevenue(tx: Tx, kind: string, grossCents: number, feeCents: number) {
    const id = randomUUID();
    tx.set('platformLedger', id, { id, kind, grossCents, feeCents, createdAt: this.iso() });
  }

  /** Pontos de fidelidade para quem contratou o serviço. */
  private awardPoints(tx: Tx, client: UserDoc | null, cents: number) {
    if (!client || cents <= 0 || this.cfg.pointsPerReal <= 0) return;
    const pts = Math.floor((cents / 100) * this.cfg.pointsPerReal);
    if (pts <= 0) return;
    client.points = (client.points || 0) + pts;
    tx.update('users', client.uid, { points: client.points });
  }

  /** Credita um GANHO do prestador: entra no saldo e no que pode ser transferido por Pix. */
  private creditEarning(tx: Tx, provider: UserDoc, cents: number, title: string) {
    // Conta antiga sem o campo: o saldo anterior conta como ganho (era tudo de serviços).
    const before = provider.earnedCents ?? this.withdrawable(provider);
    this.credit(tx, provider, cents, title, 'ganho_motorista');
    provider.earnedCents = before + cents;
    tx.update('users', provider.uid, { earnedCents: provider.earnedCents });
  }

  /** Paga o prestador (100% menos a comissão) e registra o serviço concluído para os dois lados. */
  private payProvider(tx: Tx, provider: UserDoc, client: UserDoc | null, escrowCents: number, method: PaymentMethod, title: string, kind = 'corrida', fixedFeeCents?: number) {
    const pct = this.cfg.commissionPercent;
    if (method === 'froc_pay' && escrowCents > 0 && typeof fixedFeeCents === 'number') {
      // Modelo novo: a Froc fica com um valor fixo (R$ 2 a 8); o motorista com todo o resto.
      const fee = Math.min(escrowCents, Math.max(0, fixedFeeCents));
      this.creditEarning(tx, provider, escrowCents - fee, `Ganho · ${title}`);
      this.platformRevenue(tx, kind, escrowCents, fee);
      provider.completedTrips += 1;
      tx.update('users', provider.uid, { completedTrips: provider.completedTrips });
      if (client && client.uid !== provider.uid) {
        client.completedTrips += 1;
        tx.update('users', client.uid, { completedTrips: client.completedTrips });
        this.awardPoints(tx, client, escrowCents);
      }
      return;
    }
    if (method === 'froc_pay' && escrowCents > 0) {
      this.creditEarning(tx, provider, this.providerCut(escrowCents), `Ganho · ${title} (${100 - pct}% líquido)`);
    } else if (method === 'cash' && escrowCents > 0 && pct > 0) {
      // Só corridas antigas (criadas antes do fim do dinheiro em mãos): a comissão sai da carteira.
      this.debit(tx, provider, escrowCents - this.providerCut(escrowCents), `Taxa · ${title} (pago em dinheiro)`, 'taxa', true);
    }
    if (escrowCents > 0) this.platformRevenue(tx, kind, escrowCents, escrowCents - this.providerCut(escrowCents));
    provider.completedTrips += 1;
    tx.update('users', provider.uid, { completedTrips: provider.completedTrips });
    if (client && client.uid !== provider.uid) {
      client.completedTrips += 1;
      tx.update('users', client.uid, { completedTrips: client.completedTrips });
      this.awardPoints(tx, client, escrowCents);
    }
  }

  async transactions(uid: string): Promise<WalletTransaction[]> {
    const items = byNewest(await this.store.query<Doc>('transactions', [['uid', '==', uid]], 300)).slice(0, 60);
    return items.map((t) => ({
      id: String(t.id),
      // Lançamentos antigos traziam "(taxa Froc R$ x)": some do extrato (sigilo).
      title: String(t.title).replace(/\s*\(taxa Froc[^)]*\)/gi, '').replace(/^Taxa Froc \d+% · /, 'Taxa · '),
      category: t.category as WalletTransaction['category'],
      amount: toReais(Number(t.amountCents)),
      type: t.type as 'credit' | 'debit',
      date: new Date(String(t.createdAt)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }),
    }));
  }

  async createTopup(auth: AuthUser, amountReais: unknown) {
    const payments = this.deps.payments;
    if (!payments?.configured)
      fail(503, 'payments_not_configured', 'Recargas ainda não estão disponíveis: o Mercado Pago não foi configurado na plataforma.');
    const user = await this.ensureUser(auth);
    const amountCents = toCents(num(amountReais, 10, 5000, 'recarga'));
    const id = randomUUID();
    await this.store.set('topups', id, { id, uid: user.uid, amountCents, status: 'pending', createdAt: this.iso() });
    let checkout: { checkoutUrl: string; preferenceId: string };
    try {
      checkout = await payments!.createCheckout({
        reference: id,
        amountCents,
        title: 'Recarga Carteira Froc X Uber',
        payerEmail: user.email,
      });
    } catch (error) {
      console.error('Mercado Pago recusou a criação do pagamento:', error);
      await this.store.update('topups', id, { status: 'failed', error: String((error as Error)?.message || error).slice(0, 200) });
      return fail(
        502,
        'payment_provider',
        'O Mercado Pago não abriu o pagamento agora. Tente de novo em instantes; se continuar, o administrador deve conferir o token do Mercado Pago.',
      );
    }
    await this.store.update('topups', id, { preferenceId: checkout.preferenceId });
    return { topupId: id, checkoutUrl: checkout.checkoutUrl };
  }

  /** Confere no Mercado Pago e credita UMA vez se o pagamento foi aprovado. */
  async confirmTopup(topupId: string, uid?: string) {
    const topup = await this.store.get<Doc>('topups', topupId);
    if (!topup || (uid && topup.uid !== uid)) return fail(404, 'not_found', 'Recarga não encontrada.');
    if (topup.status === 'approved') return { status: 'approved' as const };
    const payment = await this.deps.payments?.findApproved(topupId);
    if (!payment) return { status: 'pending' as const };
    if (payment.amountCents !== Number(topup.amountCents))
      fail(409, 'amount_mismatch', 'O valor pago não corresponde à recarga.');
    await this.store.transaction(async (tx) => {
      const current = await this.mustGet<Doc>(tx, 'topups', topupId, 'Recarga');
      if (current.status === 'approved') return;
      const user = await this.mustGet<UserDoc>(tx, 'users', String(current.uid), 'Usuário');
      tx.update('topups', topupId, { status: 'approved', paymentId: payment.paymentId, approvedAt: this.iso() });
      // Conta antiga sem o campo: congela os ganhos atuais antes da recarga (a recarga não vira saque).
      if (user.earnedCents === undefined) tx.update('users', user.uid, { earnedCents: this.withdrawable(user) });
      this.credit(tx, user, Number(current.amountCents), 'Recarga via Mercado Pago (Pix/cartão)', 'recarga_pix');
    });
    return { status: 'approved' as const };
  }

  /** Aviso automático do Mercado Pago (assinatura já conferida na rota). */
  async handlePaymentNotification(paymentId: string) {
    const payment = await this.deps.payments?.getPayment(paymentId);
    if (!payment?.reference) return { handled: false };
    const topup = await this.store.get<Doc>('topups', payment.reference);
    if (!topup) return { handled: false };
    await this.confirmTopup(payment.reference);
    return { handled: true };
  }

  /** Quanto a pessoa pode sacar agora: o que ganhou (corridas, entregas, fretes), até o saldo atual. */
  private withdrawable(user: UserDoc) {
    return Math.max(0, Math.min(user.balanceCents, user.earnedCents ?? (user.driverStatus === 'approved' || user.truckerStatus === 'approved' ? user.balanceCents : 0)));
  }

  /**
   * Saque por Pix para qualquer conta (do próprio prestador ou outra que ele quiser).
   * Só sai o que foi GANHO na Froc: dinheiro de recarga fica para usar no app.
   */
  async requestWithdrawal(auth: AuthUser, amountReais: unknown, pixKey: unknown, pixKeyType?: unknown) {
    await this.identityGateFor(auth);
    const amountCents = toCents(num(amountReais, MIN_WITHDRAWAL_CENTS / 100, 50000, 'saque'));
    const key = text(pixKey, 120);
    const detected = pixKeyKind(key);
    if (!detected) fail(400, 'invalid_pix_key', 'Chave Pix inválida. Use CPF, CNPJ, e-mail, celular com DDD ou chave aleatória.');
    const chosen = String(pixKeyType || '');
    // 11 números pode ser CPF ou celular: vale o tipo escolhido pela pessoa.
    const ambiguous = key.replace(/\D/g, '').length === 11 && ['cpf', 'telefone'].includes(chosen);
    if (chosen && chosen !== detected && !ambiguous) fail(400, 'pix_type_mismatch', 'O tipo escolhido não combina com a chave Pix digitada. Confira.');
    const type = ambiguous ? chosen : detected;
    const id = randomUUID();
    await this.store.transaction(async (tx) => {
      const user = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Usuário');
      const available = this.withdrawable(user);
      if (available <= 0) fail(403, 'nothing_to_withdraw', 'Saque é para o que você ganhou na Froc. Saldo de recarga fica para usar nas corridas, caronas, fretes e entregas.');
      if (amountCents > available) fail(402, 'over_withdrawable', `Você pode sacar até ${brl(available / 100)} (seus ganhos disponíveis).`);
      const earnedBefore = user.earnedCents ?? available;
      this.debit(tx, user, amountCents, `Saque por Pix · ${type} ${maskPix(key)}`, 'saque');
      user.earnedCents = Math.max(0, earnedBefore - amountCents);
      tx.update('users', user.uid, { earnedCents: user.earnedCents });
      tx.set('withdrawals', id, { id, uid: user.uid, name: user.name, amountCents, pixKey: key, pixKeyType: type, status: 'pending', createdAt: this.iso() });
    });
    return { id };
  }

  // ------------------------------------------- cadastro de motorista/caminhoneiro

  async uploadDocument(auth: AuthUser, kind: unknown, docType: unknown, contentType: unknown, base64: unknown) {
    if (kind !== 'driver' && kind !== 'trucker') return fail(400, 'invalid_kind', 'Tipo de cadastro inválido.');
    if (!(DOC_TYPES[kind] as readonly string[]).includes(String(docType))) fail(400, 'invalid_doc', 'Documento inválido.');
    if (!ALLOWED_DOC_TYPES.has(String(contentType))) fail(400, 'invalid_file', 'Envie foto (JPG, PNG, WEBP) ou PDF.');
    if (!this.deps.files) fail(503, 'storage_not_configured', 'Envio de documentos indisponível: armazenamento não configurado.');
    const bytes = Buffer.from(String(base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (!bytes.length || bytes.length > MAX_DOC_BYTES) fail(400, 'file_size', 'O arquivo deve ter até 3 MB.');
    const user = await this.ensureUser(auth);
    const status = kind === 'driver' ? user.driverStatus : user.truckerStatus;
    if (status === 'approved' || status === 'pending') fail(409, 'already_submitted', 'Seu cadastro já foi enviado.');
    const ext = String(contentType) === 'application/pdf' ? 'pdf' : String(contentType).split('/')[1];
    const path = `froc-x-uber/documentos/${user.uid}/${kind}-${docType}-${this.now().getTime()}.${ext}`;
    await this.deps.files!.save(path, String(contentType), new Uint8Array(bytes));
    const field = kind === 'driver' ? 'driverDocs' : 'truckerDocs';
    await this.store.update('users', user.uid, { [field]: { ...(user[field] as Record<string, string>), [String(docType)]: path } });
    return { ok: true };
  }

  /** Confere as declarações exigidas por lei para este tipo de cadastro. */
  private declarations(body: Record<string, unknown>, keys: readonly string[]) {
    const given = (body.declarations && typeof body.declarations === 'object' ? body.declarations : {}) as Record<string, unknown>;
    const missing = keys.filter((k) => given[k] !== true);
    if (missing.length)
      fail(400, 'missing_declarations', 'Marque todas as declarações obrigatórias do cadastro (exigências da lei e da Froc).');
    const at = this.iso();
    return Object.fromEntries(keys.map((k) => [k, at]));
  }

  async applyAsProvider(auth: AuthUser, kind: unknown, body: Record<string, unknown>) {
    if (kind === 'merchant') return this.applyAsMerchant(auth, body);
    if (kind !== 'driver' && kind !== 'trucker') return fail(400, 'invalid_kind', 'Tipo de cadastro inválido.');
    const cfg = await this.settings();
    const user = await this.identityGateFor(auth);
    const status = kind === 'driver' ? user.driverStatus : user.truckerStatus;
    if (status === 'approved') fail(409, 'already_approved', 'Cadastro já aprovado.');
    const docs = (kind === 'driver' ? user.driverDocs : user.truckerDocs) || {};
    const missing = DOC_TYPES[kind].filter((d) => !docs[d]);
    if (missing.length)
      fail(400, 'missing_documents', 'Envie todos os documentos: ' + missing.map((d) => (d === 'antecedentes' ? 'certidão de antecedentes' : d.toUpperCase())).join(', ') + '.');
    const phone = text(body.phone, 30) || user.phone;
    if (phone.replace(/\D/g, '').length < 10) fail(400, 'invalid_phone', 'Informe um telefone com DDD.');
    const vehicle = text(body.vehicle, 80);
    const plate = text(body.plate, 10).toUpperCase();
    if (vehicle.length < 3) fail(400, 'invalid_vehicle', 'Informe o modelo e a cor do veículo.');
    if (!/^[A-Z]{3}-?[0-9][A-Z0-9][0-9]{2}$/.test(plate)) fail(400, 'invalid_plate', 'Placa inválida (ex.: ABC1D23).');
    // CNH: validade obrigatória (vencida não entra; quando vencer, o app deixa offline).
    const today = this.iso().slice(0, 10);
    const cnhExpiry = parseDay(body.cnhExpiry);
    if (!cnhExpiry) fail(400, 'invalid_cnh_expiry', 'Informe a data de validade da CNH.');
    if (cnhExpiry < today) fail(400, 'cnh_expired', 'Sua CNH está vencida. Renove no Detran antes de se cadastrar.');
    const city = text(body.city, 80);
    const state = text(body.state, 2).toUpperCase();
    if (city.length < 2 || !/^[A-Z]{2}$/.test(state)) fail(400, 'invalid_city', 'Informe a cidade e a UF onde você vai trabalhar.');
    const year = Math.round(Number(body.vehicleYear));
    const currentYear = this.now().getFullYear();
    if (!Number.isFinite(year) || year < 1980 || year > currentYear + 1) fail(400, 'invalid_vehicle_year', 'Informe o ano de fabricação do veículo.');
    const next: Partial<UserDoc> = { phone, rejectionReason: '', cnhExpiry, driverCity: city, driverState: state, driverVehicleYear: year };
    if (kind === 'driver') {
      const vehicleType = body.vehicleType === 'moto' ? 'moto' : body.vehicleType === 'carro' ? 'carro' : fail(400, 'invalid_vehicle_type', 'Escolha carro ou moto.');
      const rule = vehicleAgeLimit(city, state, cfg.maxVehicleAgeYears);
      const minYear = minVehicleYear(rule.maxYears, this.now());
      if (year < minYear)
        fail(400, 'vehicle_too_old', `Veículo muito antigo para ${city}/${state}: aceitamos fabricação a partir de ${minYear} (${rule.source})`);
      Object.assign(next, {
        driverVehicle: vehicle,
        driverPlate: plate,
        driverVehicleType: vehicleType,
        declarations: { ...(user.declarations || {}), ...this.declarations(body, DECLARATIONS[vehicleType === 'moto' ? 'moto' : 'driver']) },
        driverStatus: 'pending',
        driverSubmittedAt: this.iso(),
      });
    } else {
      const truckType = TRUCK_TYPES.includes(body.truckType as TruckType) ? (body.truckType as TruckType) : fail(400, 'invalid_truck', 'Tipo de veículo de carga inválido.');
      Object.assign(next, {
        truckModel: vehicle,
        truckPlate: plate,
        truckType,
        companyName: text(body.companyName, 80),
        rntrc: (() => {
          const digits = String(body.rntrc ?? '').replace(/\D/g, '');
          return digits.length >= 8 && digits.length <= 12
            ? digits
            : fail(400, 'invalid_rntrc', 'Informe o número do RNTRC (registro na ANTT), com 8 a 12 dígitos.');
        })(),
        declarations: { ...(user.declarations || {}), ...this.declarations(body, DECLARATIONS.trucker) },
        truckerStatus: 'pending',
        truckerSubmittedAt: this.iso(),
      });
    }
    await this.store.update('users', user.uid, next);
    return this.profileView({ ...user, ...next } as UserDoc, auth);
  }

  // --------------------------------------------------- lojas (Froc Entregas)

  async applyAsMerchant(auth: AuthUser, body: Record<string, unknown>) {
    const user = await this.identityGateFor(auth);
    if (user.merchantStatus === 'approved') fail(409, 'already_approved', 'Sua loja já está aprovada.');
    if (user.merchantStatus === 'pending') fail(409, 'already_submitted', 'O cadastro da sua loja já está em análise.');
    const companyName = text(body.companyName, 80);
    if (companyName.length < 2) fail(400, 'invalid_company', 'Informe o nome da loja.');
    const cnpj = String(body.cnpj ?? '').replace(/\D/g, '');
    if (!isValidCnpj(cnpj)) fail(400, 'invalid_cnpj', 'CNPJ inválido. Confira os 14 números.');
    const taken = await this.store.query<UserDoc>('users', [['merchantCnpj', '==', cnpj]], 5);
    if (taken.some((u) => u.uid !== user.uid && u.merchantStatus !== 'rejected')) fail(409, 'cnpj_in_use', 'Este CNPJ já está cadastrado em outra conta.');
    const phone = text(body.phone, 30) || user.phone;
    if (phone.replace(/\D/g, '').length < 10) fail(400, 'invalid_phone', 'Informe o telefone da loja com DDD.');
    const category = MERCHANT_CATEGORIES.includes(String(body.category)) ? String(body.category) : 'outro';
    const pickup = resolvePoint(body.pickup, null);
    const next: Partial<UserDoc> = {
      merchantStatus: 'pending',
      merchantSubmittedAt: this.iso(),
      merchantCnpj: cnpj,
      rejectionReason: '',
      declarations: { ...(user.declarations || {}), ...this.declarations(body, DECLARATIONS.merchant) },
      merchant: {
        ...(user.merchant || {}),
        companyName,
        cnpj: formatCnpj(cnpj),
        phone,
        category,
        pickup,
        pickupNote: text(body.pickupNote, 160),
      },
    } as Partial<UserDoc>;
    await this.store.update('users', user.uid, next);
    return this.profileView({ ...user, ...next } as UserDoc, auth);
  }

  /** Loja aprovada (para o painel e para a API). */
  async approvedMerchant(uid: string) {
    const user = (await this.store.get<UserDoc>('users', uid)) ?? fail(404, 'not_found', 'Conta não encontrada.');
    if (user.blocked) fail(403, 'blocked', 'Conta bloqueada. Fale com o suporte.');
    if (user.merchantStatus !== 'approved') fail(403, 'merchant_not_approved', 'Sua loja ainda não foi aprovada pela equipe Froc.');
    return user;
  }

  /** Endereço do webhook da loja. O segredo de assinatura aparece só quando é criado/trocado. */
  async setMerchantWebhook(auth: AuthUser, url: unknown, rotate = false) {
    const user = await this.approvedMerchant(auth.uid);
    const webhookUrl = validateWebhookUrl(url);
    const m = { ...(user.merchant || {}) };
    let secret = '';
    if (webhookUrl && (!m.webhookSecret || rotate)) {
      secret = newWebhookSecret();
      m.webhookSecret = secret;
    }
    m.webhookUrl = webhookUrl;
    await this.store.update('users', user.uid, { merchant: m });
    await this.audit(auth, 'webhook_configurado', user.uid, { url: webhookUrl, novoSegredo: Boolean(secret) });
    return { webhookUrl, secret, hasWebhookSecret: Boolean(m.webhookSecret) };
  }

  // ------------------------------------------------- identidade (CPF, 1 conta)

  /** Sem CPF confirmado, a pessoa não pede nem oferece serviços (quando o CPF é obrigatório). */
  private identityGate(user: UserDoc) {
    if (!this.deps.identity?.required) return;
    if (user.cpfStatus === 'basic' || user.cpfStatus === 'verified') return;
    fail(403, 'cpf_required', 'Confirme seu CPF na aba Conta para usar a Froc. Leva 1 minuto e protege motoristas e passageiros.');
  }

  private async identityGateFor(auth: AuthUser) {
    const user = await this.ensureUser(auth);
    this.identityGate(user);
    return user;
  }

  /**
   * Cadastro do CPF. Regras: CPF válido, maior de 18 anos, um CPF = uma conta (vale mesmo
   * trocando de celular ou de e-mail), CPF de conta bloqueada não volta. Com o Serpro ligado,
   * CPF + nascimento precisam existir na Receita, a situação precisa ser Regular e o nome bater.
   */
  async registerCpf(auth: AuthUser, body: Record<string, unknown>, deviceId?: unknown) {
    const user = await this.ensureUser(auth);
    if (user.cpfStatus === 'basic' || user.cpfStatus === 'verified')
      fail(409, 'cpf_already', 'Seu CPF já está confirmado. Para trocar, fale com o Atendimento.');
    const cpf = onlyDigits(body.cpf);
    if (!isValidCpf(cpf)) fail(400, 'invalid_cpf', 'CPF inválido. Confira os 11 números.');
    const fullName = text(body.fullName, 120).replace(/\s+/g, ' ');
    if (fullName.split(' ').filter((t) => t.length > 1).length < 2) fail(400, 'invalid_name', 'Informe seu nome completo, como está no CPF.');
    const birthDate = parseDay(body.birthDate);
    if (!birthDate) fail(400, 'invalid_birth', 'Informe sua data de nascimento.');
    const age = ageOn(birthDate, this.now());
    if (age < 18) fail(403, 'underage', 'A Froc é só para maiores de 18 anos. Menores viajam acompanhados de um adulto com conta.');
    if (age > 120) fail(400, 'invalid_birth', 'Data de nascimento inválida.');
    const key = cpfKey(cpf);
    const taken = async (idx: Doc | null) => {
      if (!idx || !idx.uid || idx.uid === user.uid) return;
      if (idx.blocked) fail(403, 'cpf_blocked', 'Este CPF está bloqueado na Froc. Fale com o Atendimento.');
      fail(409, 'cpf_in_use', `Este CPF já tem uma conta na Froc (${maskEmail(String(idx.email || ''))}). Cada pessoa pode ter só uma conta: entre nela ou fale com o Atendimento.`);
    };
    await taken(await this.store.get<Doc>('cpf_index', key));

    // Conferência na Receita (Serpro). Fora do ar: segue como "básico" e a equipe confere depois.
    let status: CpfStatus = 'basic';
    let source = 'basico';
    let legalName = fullName;
    let situation = '';
    const lookup = this.deps.identity?.verify ? await this.deps.identity.verify(cpf, birthDate) : null;
    if (lookup) {
      if (!lookup.found) fail(400, 'cpf_not_found', 'CPF e data de nascimento não conferem na Receita Federal. Confira os dados.');
      if (!lookup.regular) fail(403, 'cpf_irregular', `Seu CPF não está regular na Receita (${lookup.situation || 'situação irregular'}). Regularize em gov.br e tente de novo.`);
      const official = lookup.socialName || lookup.name || '';
      if (official && !namesMatch(fullName, official) && !(lookup.name && namesMatch(fullName, lookup.name)))
        fail(400, 'cpf_name_mismatch', 'O nome não bate com o cadastro do CPF na Receita. Digite seu nome completo como está no CPF.');
      status = 'verified';
      source = 'receita';
      legalName = official ? official.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : fullName;
      situation = lookup.situation || 'Regular';
    }
    const now = this.iso();
    await this.store.transaction(async (tx) => {
      await taken(await tx.get<Doc>('cpf_index', key)); // de novo dentro da transação (duas contas ao mesmo tempo)
      tx.set('cpf_index', key, { id: key, uid: user.uid, email: user.email, blocked: false, createdAt: now });
      tx.set('identities', user.uid, { uid: user.uid, cpf: formatCpf(cpf), birthDate, declaredName: fullName, legalName, source, situation, createdAt: now });
      tx.update('users', user.uid, {
        cpfStatus: status,
        cpfMasked: maskCpf(cpf),
        cpfKey: key,
        cpfSource: source,
        cpfVerifiedAt: now,
        legalName,
        name: legalName.split(' ').length > 1 ? `${legalName.split(' ')[0]} ${legalName.split(' ').slice(-1)[0]}` : legalName,
      });
    });
    await this.audit(auth, 'cpf_cadastrado', user.uid, { status, fonte: source });
    if (deviceId) await this.recordDevice(auth, deviceId).catch(() => undefined);
    return this.profileView((await this.store.get<UserDoc>('users', user.uid))!, auth);
  }

  /**
   * Aparelho usado (id aleatório guardado no navegador). Não bloqueia sozinho (família divide
   * celular), mas 3+ contas no mesmo aparelho viram alerta de possível multiconta para a equipe.
   */
  async recordDevice(auth: AuthUser, deviceId: unknown) {
    const raw = String(deviceId ?? '');
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(raw)) return { ok: false };
    const key = createHash('sha256').update(`froc-device:${raw}`).digest('hex');
    const doc = await this.store.get<Doc>('devices', key);
    const uids = Array.isArray(doc?.uids) ? (doc!.uids as string[]) : [];
    if (uids.includes(auth.uid)) return { ok: true };
    const next = [...uids, auth.uid].slice(-20);
    await this.store.set('devices', key, { id: key, uids: next, updatedAt: this.iso() });
    if (next.length >= 3) {
      const flag = `Mesmo aparelho usado por ${next.length} contas`;
      await Promise.all(next.map((uid) => this.store.update('users', uid, { multiAccountFlag: flag }).catch(() => undefined)));
      await this.audit(null, 'possivel_multiconta', auth.uid, { contas: next.length });
    }
    return { ok: true };
  }

  /** Equipe confere o CPF manualmente (ex.: no site da Receita) ou recusa CPF falso. */
  async adminSetCpfStatus(auth: AuthUser, uid: unknown, decision: unknown, reason: unknown) {
    this.requireAdmin(auth);
    if (decision !== 'verified' && decision !== 'rejected') return fail(400, 'invalid_decision', 'Decisão inválida.');
    const user = (await this.store.get<UserDoc>('users', String(uid))) ?? fail(404, 'not_found', 'Usuário não encontrado.');
    if (!user.cpfKey) fail(409, 'no_cpf', 'Esta conta ainda não cadastrou CPF.');
    const why = text(reason, 200);
    if (decision === 'rejected') {
      if (why.length < 5) fail(400, 'reason_required', 'Explique o motivo.');
      // Libera o CPF para o dono verdadeiro e pede um novo cadastro a esta conta.
      await this.store.update('cpf_index', user.cpfKey!, { uid: null, releasedAt: this.iso(), releasedReason: why });
      await this.store.update('users', user.uid, { cpfStatus: 'rejected', cpfKey: '', cpfMasked: '', rejectionReason: why });
    } else {
      await this.store.update('users', user.uid, { cpfStatus: 'verified', cpfSource: 'equipe', cpfVerifiedAt: this.iso() });
    }
    await this.audit(auth, decision === 'verified' ? 'cpf_conferido' : 'cpf_recusado', user.uid, { reason: why });
    return { ok: true };
  }

  /** Passageiro envia foto de CNH, RG ou CIN para a IA conferir o CPF e ganhar o selo verde. */
  async uploadIdentityDocument(auth: AuthUser, contentType: unknown, base64: unknown) {
    const user = await this.ensureUser(auth);
    if (!user.cpfKey) fail(409, 'cpf_required', 'Cadastre o CPF primeiro.');
    if (user.cpfStatus === 'verified') fail(409, 'already_verified', 'Seu CPF já está verificado.');
    if (!ALLOWED_DOC_TYPES.has(String(contentType))) fail(400, 'invalid_file', 'Envie foto (JPG, PNG, WEBP) ou PDF.');
    if (!this.deps.files) fail(503, 'storage_not_configured', 'Envio de documentos indisponível agora.');
    const bytes = Buffer.from(String(base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (!bytes.length || bytes.length > MAX_DOC_BYTES) fail(400, 'file_size', 'O arquivo deve ter até 3 MB.');
    const ext = String(contentType) === 'application/pdf' ? 'pdf' : String(contentType).split('/')[1];
    const path = `froc-x-uber/identidade/${user.uid}/documento-${this.now().getTime()}.${ext}`;
    await this.deps.files!.save(path, String(contentType), new Uint8Array(bytes));
    await this.store.update('users', user.uid, { identityDocPath: path });
    return { path };
  }

  /**
   * Resultado da leitura do documento pela IA. Bateu tudo (CPF, nome, nascimento): verificado
   * na hora. Não bateu: fica registrado para a equipe (a IA prepara "CPF não confere").
   */
  async recordDocumentCheck(uid: string, result: { ok: boolean; status: string; reasons: string[]; tipo?: string; ear?: boolean | null; validade?: string; checkedAt: string }, source: 'cnh' | 'documento') {
    const user = (await this.store.get<UserDoc>('users', uid)) ?? fail(404, 'not_found', 'Usuário não encontrado.');
    const patch: Doc = { aiDocCheck: JSON.parse(JSON.stringify({ ...result, source })) };
    const upgrade = result.ok && user.cpfStatus === 'basic';
    if (upgrade) Object.assign(patch, { cpfStatus: 'verified', cpfSource: source === 'cnh' ? 'ia_cnh' : 'ia_documento', cpfVerifiedAt: this.iso() });
    await this.store.update('users', uid, patch);
    await this.audit({ uid: 'ia:cadastros', email: 'ia+cadastros@froc', emailVerified: true, agent: 'Analista de Cadastros' }, result.ok ? 'cpf_conferido_ia' : `cpf_${result.status}_ia`, uid, {
      fonte: source,
      motivos: result.reasons,
    });
    return { upgraded: upgrade };
  }

  /** Dados do CPF para a equipe conferir (só admin). */
  async adminIdentity(auth: AuthUser, uid: unknown) {
    this.requireAdmin(auth);
    const id = await this.store.get<Doc>('identities', String(uid));
    if (id) await this.audit(auth, 'cpf_visualizado', String(uid)); // LGPD: quem viu o CPF fica registrado
    return id ? { cpf: id.cpf, birthDate: id.birthDate, declaredName: id.declaredName, legalName: id.legalName, source: id.source, situation: id.situation } : null;
  }

  // ---------------------------------------------------------------- admin

  private requireAdmin(auth: AuthUser) {
    if (!this.isAdmin(auth)) fail(403, 'forbidden', 'Acesso restrito à administração.');
  }

  async adminOverview(auth: AuthUser): Promise<AdminOverview> {
    this.requireAdmin(auth);
    const [drivers, truckers, merchants, withdrawals, users, sos, settings] = await Promise.all([
      this.store.query<UserDoc>('users', [['driverStatus', '==', 'pending']], 100),
      this.store.query<UserDoc>('users', [['truckerStatus', '==', 'pending']], 100),
      this.store.query<UserDoc>('users', [['merchantStatus', '==', 'pending']], 100),
      Promise.all([
        this.store.query<Doc>('withdrawals', [['status', '==', 'pending']], 100),
        this.store.query<Doc>('withdrawals', [['status', '==', 'approved']], 100),
      ]).then(([a, b]) => [...a, ...b]),
      this.store.count('users', []),
      this.store.query<Doc>('sos', [['status', '==', 'open']], 100),
      this.settings(),
    ]);
    const signed = async (path: string) => (this.deps.files ? this.deps.files.signedUrl(path) : '');
    const applications = await Promise.all(
      [
        ...drivers.map((u) => ({ u, kind: 'driver' as const })),
        ...truckers.map((u) => ({ u, kind: 'trucker' as const })),
      ].map(async ({ u, kind }) => {
        const docs = (kind === 'driver' ? u.driverDocs : u.truckerDocs) || {};
        const rule = vehicleAgeLimit(u.driverCity || '', u.driverState || '', settings.maxVehicleAgeYears);
        const identity = await this.store.get<Doc>('identities', u.uid);
        return {
          uid: u.uid,
          name: u.name,
          email: u.email,
          phone: u.phone,
          kind,
          vehicle: kind === 'driver' ? u.driverVehicle : u.truckModel,
          plate: kind === 'driver' ? u.driverPlate : u.truckPlate,
          vehicleType: kind === 'driver' ? u.driverVehicleType || 'carro' : undefined,
          vehicleYear: u.driverVehicleYear,
          minVehicleYear: kind === 'driver' ? minVehicleYear(rule.maxYears, this.now()) : undefined,
          vehicleAgeRule: kind === 'driver' ? rule.source : undefined,
          city: u.driverCity,
          state: u.driverState,
          cnhExpiry: u.cnhExpiry,
          declarations: u.declarations,
          cpf: identity ? String(identity.cpf) : '',
          legalName: identity ? String(identity.legalName) : '',
          cpfStatus: u.cpfStatus || 'none',
          aiDocCheck: u.aiDocCheck as never,
          truckType: kind === 'trucker' ? u.truckType : undefined,
          companyName: kind === 'trucker' ? u.companyName : undefined,
          rntrc: kind === 'trucker' ? u.rntrc : undefined,
          submittedAt: String((kind === 'driver' ? u.driverSubmittedAt : u.truckerSubmittedAt) ?? ''),
          documents: await Promise.all(Object.entries(docs).map(async ([type, path]) => ({ type, url: await signed(path) }))),
        };
      }),
    );
    for (const u of merchants) {
      const m = (u.merchant || {}) as Doc;
      applications.push({
        uid: u.uid,
        name: u.name,
        email: u.email,
        phone: String(m.phone || u.phone),
        kind: 'merchant' as never,
        vehicle: '',
        plate: '',
        companyName: String(m.companyName || ''),
        cnpj: String(m.cnpj || ''),
        category: String(m.category || ''),
        pickupAddress: String((m.pickup as Doc | undefined)?.name || ''),
        declarations: u.declarations,
        submittedAt: String(u.merchantSubmittedAt || ''),
        documents: [],
      } as never);
    }
    return {
      applications,
      withdrawals: byNewest(withdrawals).map((w) => ({
        id: String(w.id),
        uid: String(w.uid),
        name: String(w.name),
        amount: toReais(Number(w.amountCents)),
        pixKey: String(w.pixKey),
        pixKeyType: String(w.pixKeyType || ''),
        status: w.status as 'pending' | 'approved',
        createdAt: String(w.createdAt),
      })),
      totals: { users, pendingApplications: applications.length, pendingWithdrawals: withdrawals.length, openSos: sos.length },
      sos: byNewest(sos) as unknown as AdminOverview['sos'],
      settings,
    };
  }

  async reviewApplication(auth: AuthUser, uid: unknown, kind: unknown, decision: unknown, reason: unknown) {
    this.requireAdmin(auth);
    if (kind !== 'driver' && kind !== 'trucker' && kind !== 'merchant') return fail(400, 'invalid_kind', 'Tipo de cadastro inválido.');
    if (decision !== 'approved' && decision !== 'rejected') return fail(400, 'invalid_decision', 'Decisão inválida.');
    const user = (await this.store.get<UserDoc>('users', String(uid))) ?? fail(404, 'not_found', 'Usuário não encontrado.');
    const field = kind === 'driver' ? 'driverStatus' : kind === 'trucker' ? 'truckerStatus' : 'merchantStatus';
    if (user[field] !== 'pending') fail(409, 'not_pending', 'Este cadastro não está aguardando análise.');
    const why = text(reason, 300);
    if (decision === 'rejected' && why.length < 5) fail(400, 'reason_required', 'Explique o motivo da recusa.');
    await this.store.update('users', user.uid, {
      [field]: decision,
      rejectionReason: decision === 'rejected' ? why : '',
      reviewedBy: auth.email,
      reviewedAt: this.iso(),
      // Aprovar motorista/transportador = a equipe conferiu o CPF na CNH.
      ...(decision === 'approved' && kind !== 'merchant' && user.cpfStatus === 'basic' ? { cpfStatus: 'verified', cpfSource: 'documentos', cpfVerifiedAt: this.iso() } : {}),
    });
    await this.audit(auth, decision === 'approved' ? 'cadastro_aprovado' : 'cadastro_recusado', user.uid, { kind, reason: why, email: user.email });
    return { ok: true };
  }

  /**
   * Saque: "approved" (liberado: envia o Pix pelo gateway, se houver; senão fica "Pix a enviar"),
   * "paid" (Pix feito) ou "rejected" (recusado: o valor volta). Agente não pode dizer que pagou
   * sem gateway (só a pessoa que fez o Pix pode marcar como pago).
   */
  async resolveWithdrawal(auth: AuthUser, id: unknown, decision: unknown) {
    this.requireAdmin(auth);
    let d = String(decision);
    if (d !== 'paid' && d !== 'rejected' && d !== 'approved') return fail(400, 'invalid_decision', 'Decisão inválida.');
    if (auth.agent && d === 'paid' && !this.deps.payouts) d = 'approved';
    const w0 = (await this.store.get<Doc>('withdrawals', String(id))) ?? fail(404, 'not_found', 'Saque não encontrado.');
    if (d !== 'rejected' && !['pending', 'approved'].includes(String(w0.status))) fail(409, 'not_pending', 'Este saque já foi resolvido.');
    if (d === 'rejected' && w0.status !== 'pending' && w0.status !== 'approved') fail(409, 'not_pending', 'Este saque já foi resolvido.');
    // Liberado e com gateway: envia o Pix de verdade agora.
    let payout: { ok: boolean; externalId?: string; error?: string } | null = null;
    if (d === 'approved' && this.deps.payouts) {
      payout = await this.deps.payouts
        .send({ id: String(w0.id), amountCents: Number(w0.amountCents), pixKey: String(w0.pixKey), pixKeyType: String(w0.pixKeyType || ''), name: String(w0.name) })
        .catch((e) => ({ ok: false, error: String(e?.message || e) }));
      if (payout.ok) d = 'paid';
    }
    await this.store.transaction(async (tx) => {
      const w = await this.mustGet<Doc>(tx, 'withdrawals', String(id), 'Saque');
      if (!['pending', 'approved'].includes(String(w.status))) fail(409, 'not_pending', 'Este saque já foi resolvido.');
      const user = await this.mustGet<UserDoc>(tx, 'users', String(w.uid), 'Usuário');
      tx.update('withdrawals', String(id), {
        status: d,
        resolvedBy: auth.email,
        resolvedAt: this.iso(),
        ...(payout ? { payoutId: payout.externalId || '', payoutError: payout.error || '' } : {}),
      });
      if (d === 'rejected') {
        this.credit(tx, user, Number(w.amountCents), 'Saque recusado · valor devolvido', 'estorno');
        // Devolve também ao "pode sacar" (era ganho).
        tx.update('users', user.uid, { earnedCents: (user.earnedCents ?? 0) + Number(w.amountCents) });
      }
    });
    await this.audit(auth, d === 'paid' ? 'saque_pago' : d === 'approved' ? 'saque_liberado' : 'saque_recusado', String(id), payout ? { gateway: payout } : {});
    return { ok: true, status: d };
  }

  // ------------------------------------------------ Equipe IA no comando (rotinas)

  /**
   * Saques que a Equipe IA libera sozinha (regras fixas no código, a IA não decide no escuro):
   * conta não bloqueada, CPF verificado, sem alerta de multiconta e valor até o limite.
   * O resto fica para o agente Financeiro analisar.
   */
  async autoProcessWithdrawals(limit = 20) {
    const cfg = await this.settings();
    if (!cfg.agentAutonomy) return { liberados: 0, motivo: 'autonomia desligada' };
    const ia = agentAuth('financeiro', 'Financeiro');
    const pending = byNewest(await this.store.query<Doc>('withdrawals', [['status', '==', 'pending']], 200)).reverse().slice(0, limit);
    let ok = 0;
    const analise: string[] = [];
    for (const w of pending) {
      const user = await this.store.get<UserDoc>('users', String(w.uid));
      const why: string[] = [];
      if (!user || user.blocked) why.push('conta bloqueada');
      if (user && user.cpfStatus !== 'verified') why.push('CPF não verificado');
      if (user?.multiAccountFlag) why.push('alerta de multiconta');
      if (Number(w.amountCents) > cfg.autoPayoutLimit * 100) why.push(`acima de ${brl(cfg.autoPayoutLimit)}`);
      if (why.length) {
        analise.push(`${w.id}: ${why.join(', ')}`);
        continue;
      }
      await this.resolveWithdrawal(ia, w.id, 'approved').then(() => ok++).catch((e) => analise.push(`${w.id}: ${e.message}`));
    }
    return { liberados: ok, paraAnalise: analise };
  }

  /** Lojas: CNPJ ativo na consulta pública → aprovada; baixada/inapta/suspensa → recusada. */
  async autoReviewMerchants(limit = 5) {
    const cfg = await this.settings();
    if (!cfg.agentAutonomy || !this.deps.cnpjLookup) return { conferidas: 0 };
    const ia = agentAuth('cadastros', 'Analista de Cadastros');
    const pending = (await this.store.query<UserDoc>('users', [['merchantStatus', '==', 'pending']], 50)).slice(0, limit);
    let n = 0;
    for (const u of pending) {
      const r = await this.deps.cnpjLookup(String(u.merchantCnpj || '')).catch(() => null);
      if (!r) continue;
      n++;
      if (r.active) await this.reviewApplication(ia, u.uid, 'merchant', 'approved', '');
      else await this.reviewApplication(ia, u.uid, 'merchant', 'rejected', `CNPJ com situação "${r.situation}" na Receita. Regularize e envie de novo.`);
    }
    return { conferidas: n };
  }

  // ------------------------------------------------------- 1) corrida Uber/99

  /**
   * Taxa de cancelamento do passageiro (regras em src/data/ridePolicy.ts): grátis antes do aceite,
   * até 1 min depois do aceite ou com o motorista muito atrasado; 50% entre 1 e 2 min; 100% depois
   * de 2 min ou com o motorista já no embarque.
   */
  private rideCancelPercent(ride: Doc, acceptedField = 'acceptedAt'): number {
    if (!ride.driverId || !ride[acceptedField]) return 0;
    if (ride.status === 'arriving') return 100;
    const sinceAccept = (this.now().getTime() - Date.parse(String(ride[acceptedField]))) / 1000;
    const etaMin = Number(ride.etaMin ?? 5) || 5;
    if (ride.status === 'accepted' && sinceAccept > (etaMin + LATE_GRACE_MIN) * 60) return 0; // motorista atrasado
    return cancelFeePercent(sinceAccept);
  }

  /** Taxa de cancelamento/não comparecimento vai para o motorista como ganho (menos a comissão). */
  private payCancellation(tx: Tx, driver: UserDoc, feeCents: number, pct: number, label: string, kind: string, noShow = false, fixedModel = false) {
    // Modelo de taxa fixa: a taxa de cancelamento/não comparecimento é 100% do motorista.
    const cut = fixedModel ? feeCents : this.providerCut(feeCents);
    this.creditEarning(tx, driver, cut, noShow ? `Passageiro não apareceu · ${label} (100%)` : `Taxa de cancelamento ${pct}% · ${label}`);
    this.platformRevenue(tx, `cancelamento_${kind}`, feeCents, feeCents - cut);
  }

  private rideView(r: Doc, uid: string): RideOrder {
    const mine = involvement(uid, r.passengerId, r.driverId);
    const { escrowCents: _e, priceCents: _p, deliveryPin: _d, trackToken: _t, platformFeeCents: _f, ...rest } = r;
    const view = {
      ...(rest as unknown as RideOrder),
      mine,
      pinCode: mine === 'owner' ? String(r.pinCode ?? '') : '',
    };
    // SIGILO: o ganho da Froc nunca sai do servidor. O passageiro vê só o preço; o motorista
    // vê só quanto recebe (sem o preço do passageiro, para a taxa não ser deduzida).
    hideFee(view as unknown as Doc, mine === 'owner' ? 'cliente' : 'motorista');
    if (r.delivery) {
      const d = { ...(r.delivery as Doc) };
      // Telefone do cliente só para a loja e para o entregador que aceitou.
      if (!mine) delete d.recipientPhone;
      view.delivery = d as unknown as RideOrder['delivery'];
      if (mine === 'owner') view.deliveryPin = String(r.deliveryPin ?? '');
    }
    return view;
  }

  /** Carro, moto ou ambos: quem pode pegar este pedido. */
  private vehicleFits(user: UserDoc, ride: Doc) {
    const type = user.driverVehicleType || 'carro';
    if (ride.categoryId === 'froc_moto') return type === 'moto';
    if (ride.categoryId === 'froc_delivery') {
      const wanted = (ride.delivery as Doc | undefined)?.vehicle;
      return !wanted || wanted === 'qualquer' || wanted === type;
    }
    return type === 'carro';
  }

  async createRide(auth: AuthUser, body: Record<string, unknown>) {
    await this.identityGateFor(auth);
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const category = RIDE_CATEGORIES.find((c) => c.id === body.categoryId) ?? fail(400, 'invalid_category', 'Categoria inválida.');
    const method = paymentMethod(body.paymentMethod);
    const distanceKm = calculateDistanceKm(origin, destination);
    if (distanceKm > 300) fail(400, 'too_far', 'Para viagens longas, use Caronas.');
    // Preço estilo Uber: tarifa × (faixa de horário × demanda) + área de risco; a Froc fica com R$ 2–8.
    const pricing = await this.priceFor(category.id, origin, destination);
    const { durationMin } = pricing;
    const surge = pricing.multiplier;
    const price = pricing.total;
    const priceCents = toCents(price);
    const active = await this.store.query<Doc>('rides', [['passengerId', '==', auth.uid]], 200);
    if (active.some((r) => !r.delivery && ACTIVE_RIDE.includes(String(r.status))))
      fail(409, 'ride_in_progress', 'Você já tem uma corrida em andamento.');
    const id = randomUUID();
    const ride = await this.store.transaction(async (tx) => {
      const user = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Usuário');
      // Registro do aceite das regras de cancelamento e espera (mostradas antes do 1º pedido).
      if (body.acceptPolicy === true && user.ridePolicyAccepted !== RIDE_POLICY_VERSION)
        tx.update('users', user.uid, { ridePolicyAccepted: RIDE_POLICY_VERSION, ridePolicyAcceptedAt: this.iso() });
      const doc: Doc = {
        id,
        passengerId: user.uid,
        passengerName: user.name,
        passengerRating: round2(user.passengerRating ?? 5),
        origin,
        destination,
        stops: Array.isArray(body.stops) ? body.stops.map((s) => text(s, 120)).filter(Boolean).slice(0, 3) : [],
        categoryId: category.id,
        categoryLabel: category.label,
        distanceKm,
        durationMin,
        price,
        priceCents,
        discountApplied: 0,
        surgeMultiplier: surge,
        pricing: JSON.parse(JSON.stringify(pricing)),
        platformFeeCents: toCents(pricing.platformFee),
        driverEarning: pricing.driverEarning,
        originCell: this.geo.cellOf(origin.lat, origin.lng),
        paymentMethod: method,
        pinCode: String(randomInt(1000, 10000)),
        status: 'searching',
        policyVersion: RIDE_POLICY_VERSION,
        // Selo para o motorista: CPF conferido na Receita / pela equipe, ou só cadastrado.
        passengerVerified: user.cpfStatus === 'verified' ? 'verificado' : user.cpfStatus === 'basic' ? 'cpf' : '',
        escrowCents: 0,
        createdAt: this.iso(),
        messages: [],
      };
      if (method === 'froc_pay') {
        this.debit(tx, user, priceCents, `${category.label} · valor retido até o fim da corrida`, 'corrida');
        doc.escrowCents = priceCents;
      }
      tx.set('rides', id, doc);
      return doc;
    });
    return this.rideView(ride, auth.uid);
  }

  async rideAction(auth: AuthUser, rideId: string, body: Record<string, unknown>) {
    await this.settings();
    const action = String(body.action || '');
    if (action === 'driver_accept') {
      await this.approvedUser(auth, 'driver');
      const driving = await this.store.query<Doc>('rides', [['driverId', '==', auth.uid]], 200);
      if (driving.some((r) => ['accepted', 'arriving', 'in_progress'].includes(String(r.status))))
        fail(409, 'driver_busy', 'Finalize a corrida atual antes de aceitar outra.');
    }
    let statusBefore = '';
    const result = await this.store.transaction(async (tx) => {
      const ride = await this.mustGet<Doc>(tx, 'rides', rideId, 'Corrida');
      statusBefore = String(ride.status);
      const isPassenger = ride.passengerId === auth.uid;
      const isDriver = ride.driverId === auth.uid;
      const status = String(ride.status);
      const set = (patch: Doc) => {
        Object.assign(ride, patch);
        tx.update('rides', rideId, patch);
      };

      switch (action) {
        case 'driver_accept': {
          if (isPassenger) fail(403, 'own_ride', 'Você não pode aceitar a própria corrida.');
          if (status !== 'searching') fail(409, 'taken', 'Esta corrida já foi aceita por outro motorista.');
          const driver = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Motorista');
          if (!driver.driverOnline) fail(409, 'offline', 'Fique online para aceitar corridas.');
          if (!this.vehicleFits(driver, ride))
            fail(409, 'wrong_vehicle', ride.categoryId === 'froc_moto' ? 'Este pedido é para moto.' : 'Este pedido não é para o seu tipo de veículo.');
          const category = RIDE_CATEGORIES.find((c) => c.id === ride.categoryId);
          set({
            status: 'accepted',
            driverId: driver.uid,
            driverName: driver.name,
            driverRating: round2(driver.rating),
            vehicleModel: driver.driverVehicle,
            vehiclePlate: driver.driverPlate,
            etaMin: category?.etaOffsetMin ?? 5,
            acceptedAt: this.iso(),
          });
          return { ride };
        }
        case 'arriving': {
          if (!isDriver) fail(403, 'forbidden', 'Só o motorista da corrida pode fazer isso.');
          if (status !== 'accepted') fail(409, 'invalid_state', 'A corrida não está aguardando chegada.');
          // Só vale "cheguei" perto do embarque: a espera paga começa a contar daqui.
          const me = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Motorista');
          const fresh = typeof me.driverLat === 'number' && this.now().getTime() - Date.parse(String(me.locationAt || 0)) < 2 * 60_000;
          if (!fresh) fail(409, 'location_required', 'Ative a localização do celular para avisar que chegou.');
          const origin = ride.origin as GeoPoint;
          const away = straightKm({ lat: me.driverLat!, lng: me.driverLng! }, origin);
          if (away > ARRIVAL_RADIUS_KM)
            fail(409, 'too_far_from_pickup', `Você ainda está a ${away < 1 ? `${Math.round(away * 1000)} m` : `${away.toFixed(1)} km`} do embarque. Avise quando estiver no local.`);
          const messages = Array.isArray(ride.messages) ? (ride.messages as unknown[]) : [];
          const time = this.now().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
          set({
            status: 'arriving',
            etaMin: 0,
            arrivedAt: this.iso(),
            messages: [
              ...messages,
              { sender: 'froc', text: '🚗 Seu motorista chegou ao embarque. O 1º minuto de espera é grátis; depois: +10% (1 min), +30% (2 min) e +50% (3 min).', time },
            ].slice(-200),
          });
          return { ride };
        }
        case 'start': {
          if (!isDriver) fail(403, 'forbidden', 'Só o motorista da corrida pode iniciar.');
          if (status !== 'accepted' && status !== 'arriving') fail(409, 'invalid_state', 'A corrida não pode ser iniciada agora.');
          // Entrega de loja: "iniciar" = coletou o pedido (o código é pedido só na entrega ao cliente).
          if (!ride.delivery && String(body.pin || '') !== String(ride.pinCode)) fail(400, 'wrong_pin', 'PIN incorreto. Peça o PIN de 4 dígitos ao passageiro.');
          const patch: Doc = { status: 'in_progress', etaMin: ride.durationMin, startedAt: this.iso() };
          // Tempo de espera no embarque: acréscimo cobrado da carteira do passageiro.
          if (!ride.delivery && ride.arrivedAt && ride.paymentMethod === 'froc_pay') {
            const waitSec = (this.now().getTime() - Date.parse(String(ride.arrivedAt))) / 1000;
            const pct = waitingFeePercent(waitSec);
            const extra = Math.round((Number(ride.priceCents) * pct) / 100);
            if (extra > 0) {
              const passenger = await this.mustGet<UserDoc>(tx, 'users', String(ride.passengerId), 'Passageiro');
              // Pode ficar negativo: o passageiro precisa recarregar antes do próximo pedido.
              this.debit(tx, passenger, extra, `Tempo de espera ${Math.floor(waitSec / 60)} min (+${pct}%) · ${ride.categoryLabel}`, 'corrida', true);
              Object.assign(patch, { escrowCents: Number(ride.escrowCents || 0) + extra, waitingFeePercent: pct, waitingFee: toReais(extra), waitSeconds: Math.round(waitSec) });
            }
          }
          set(patch);
          return { ride };
        }
        case 'complete': {
          if (!isDriver) fail(403, 'forbidden', 'Só o motorista pode finalizar a corrida.');
          if (status !== 'in_progress') fail(409, 'invalid_state', 'A corrida ainda não foi iniciada.');
          if (ride.delivery && String(body.pin || '') !== String(ride.deliveryPin))
            fail(400, 'wrong_pin', 'Código de entrega incorreto. Peça ao cliente o código de 4 dígitos.');
          const driver = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Motorista');
          const passenger = await tx.get<UserDoc>('users', String(ride.passengerId));
          const amount = ride.paymentMethod === 'froc_pay' ? Number(ride.escrowCents) : Number(ride.priceCents);
          set({ status: 'completed', etaMin: 0, completedAt: this.iso(), escrowCents: 0 });
          this.payProvider(
            tx,
            driver,
            passenger,
            amount,
            ride.paymentMethod as PaymentMethod,
            String(ride.categoryLabel),
            ride.delivery ? 'entrega' : 'corrida',
            typeof ride.platformFeeCents === 'number' ? Number(ride.platformFeeCents) : undefined,
          );
          return { ride };
        }
        case 'cancel': {
          if (isPassenger) {
            if (!['searching', 'accepted', 'arriving'].includes(status)) fail(409, 'invalid_state', 'Não é possível cancelar agora.');
            const passenger = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Passageiro');
            const escrow = Number(ride.escrowCents || 0);
            const pct = this.rideCancelPercent(ride);
            const fee = Math.round((escrow * pct) / 100);
            // Lê tudo antes de gravar (regra do Firestore).
            const driver = fee > 0 ? await this.mustGet<UserDoc>(tx, 'users', String(ride.driverId), 'Motorista') : null;
            set({ status: 'cancelled', escrowCents: 0, cancelledAt: this.iso(), cancelledBy: 'passenger', cancellationFeePercent: pct, cancellationFee: toReais(fee) });
            if (escrow - fee > 0) this.credit(tx, passenger, escrow - fee, pct ? `Estorno parcial · ${ride.categoryLabel} cancelada (taxa ${pct}%)` : `Estorno · ${ride.categoryLabel} cancelada`, 'estorno');
            if (driver) this.payCancellation(tx, driver, fee, pct, String(ride.categoryLabel), ride.delivery ? 'entrega' : 'corrida', false, typeof ride.platformFeeCents === 'number');
            return { ride };
          }
          if (isDriver) {
            if (!['accepted', 'arriving'].includes(status)) fail(409, 'invalid_state', 'Não é possível desistir agora.');
            // Motorista desistiu: a corrida volta para a fila dos outros motoristas (sem custo ao passageiro).
            set({
              status: 'searching',
              arrivedAt: null,
              driverId: null,
              driverName: null,
              driverRating: null,
              vehicleModel: null,
              vehiclePlate: null,
              etaMin: null,
            });
            return { ride };
          }
          return fail(403, 'forbidden', 'Você não participa desta corrida.');
        }
        case 'no_show': {
          // Passageiro não apareceu depois de 5 min de espera: motorista encerra e recebe 100%.
          if (!isDriver) fail(403, 'forbidden', 'Só o motorista da corrida pode fazer isso.');
          if (status !== 'arriving' || !ride.arrivedAt) fail(409, 'invalid_state', 'Avise que chegou ao embarque primeiro.');
          const waited = (this.now().getTime() - Date.parse(String(ride.arrivedAt))) / 1000;
          if (waited < NO_SHOW_SEC) fail(409, 'too_early', `Aguarde ${Math.ceil((NO_SHOW_SEC - waited) / 60)} min de espera antes de encerrar.`);
          const escrow = Number(ride.escrowCents || 0);
          const driver = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Motorista');
          set({ status: 'cancelled', escrowCents: 0, cancelledAt: this.iso(), cancelledBy: 'no_show', cancellationFeePercent: 100, cancellationFee: toReais(escrow) });
          if (escrow > 0) this.payCancellation(tx, driver, escrow, 100, String(ride.categoryLabel), 'corrida', true, typeof ride.platformFeeCents === 'number');
          return { ride };
        }
        case 'message': {
          if (!isPassenger && !isDriver) fail(403, 'forbidden', 'Você não participa desta corrida.');
          const msg = text(body.message, 500);
          if (!msg) fail(400, 'empty_message', 'Mensagem vazia.');
          const messages = Array.isArray(ride.messages) ? (ride.messages as unknown[]) : [];
          const time = this.now().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
          set({ messages: [...messages, { sender: isDriver ? 'driver' : 'passenger', text: msg, time }].slice(-200) });
          return { ride };
        }
        case 'rate': {
          if (!isPassenger) fail(403, 'forbidden', 'Só o passageiro avalia a corrida.');
          if (status !== 'completed' || ride.ratedByPassenger) fail(409, 'invalid_state', 'Esta corrida não pode ser avaliada.');
          const stars = Math.round(num(body.stars, 1, 5, 'nota'));
          const driver = await this.mustGet<UserDoc>(tx, 'users', String(ride.driverId), 'Motorista');
          const count = Number(driver.ratingCount || 0);
          const rating = round2((driver.rating * count + stars) / (count + 1));
          // Controle de qualidade: média abaixo de 4,5 com 20+ avaliações entra em revisão da equipe.
          const alert = count + 1 >= 20 && rating < 4.5 ? `Nota ${rating} em ${count + 1} avaliações` : '';
          tx.update('users', driver.uid, { rating, ratingCount: count + 1, qualityAlert: alert });
          set({ ratedByPassenger: true, passengerStars: stars });
          return { ride };
        }
        case 'rate_passenger': {
          if (!isDriver) fail(403, 'forbidden', 'Só o motorista avalia o passageiro.');
          if (status !== 'completed' || ride.ratedByDriver) fail(409, 'invalid_state', 'Esta corrida não pode ser avaliada.');
          const stars = Math.round(num(body.stars, 1, 5, 'nota'));
          const passenger = await this.mustGet<UserDoc>(tx, 'users', String(ride.passengerId), 'Passageiro');
          const count = Number(passenger.passengerRatingCount || 0);
          const rating = round2(((passenger.passengerRating ?? 5) * count + stars) / (count + 1));
          tx.update('users', passenger.uid, { passengerRating: rating, passengerRatingCount: count + 1 });
          set({ ratedByDriver: true, driverStars: stars });
          return { ride };
        }
        default:
          return fail(400, 'invalid_action', 'Ação inválida.');
      }
    });
    if (result.ride.delivery && String(result.ride.status) !== statusBefore) await this.deliveryEvent(result.ride);
    return this.rideView(result.ride, auth.uid);
  }

  // ------------------------------------------------- 2) negociação inDrive

  private indriveView(r: Doc, uid: string): InDriveRequest {
    const { escrowCents: _e, platformFeeCents: _f, ...rest } = r;
    const mine = involvement(uid, r.passengerId, r.driverId);
    // Na negociação o preço é combinado às claras; só o detalhe da taxa fica escondido.
    if (mine === 'owner') delete (rest as Doc).driverEarning;
    const offers = (Array.isArray(r.offers) ? r.offers : []) as Doc[];
    return {
      ...(rest as unknown as InDriveRequest),
      mine,
      // Motorista só vê a própria proposta; o passageiro vê todas.
      offers: (mine === 'owner' ? offers : offers.filter((o) => o.driverId === uid)) as unknown as InDriveRequest['offers'],
    };
  }

  async createInDrive(auth: AuthUser, body: Record<string, unknown>) {
    await this.identityGateFor(auth);
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const method = paymentMethod(body.paymentMethod);
    const distanceKm = calculateDistanceKm(origin, destination);
    const suggestedPrice = round2(5.5 + distanceKm * 2.15 + 4);
    const minimum = negotiationFloor(distanceKm);
    const offer = round2(num(body.passengerOffer, 8, 5000, 'oferta'));
    if (offer < minimum)
      fail(400, 'below_floor', `A oferta mínima para ${distanceKm} km é ${brl(minimum)} (cobre combustível e tempo do motorista).`);
    const user = await this.ensureUser(auth);
    if (method === 'froc_pay' && user.balanceCents < toCents(offer))
      fail(402, 'insufficient_balance', `Saldo insuficiente: sua carteira tem ${brl(user.balanceCents / 100)}. Recarregue por Pix ou cartão.`);
    const open = await this.store.query<Doc>('indrive', [['passengerId', '==', auth.uid]], 200);
    if (open.some((r) => r.status === 'open' || r.status === 'matched'))
      fail(409, 'request_in_progress', 'Você já tem um pedido de negociação em andamento.');
    const id = randomUUID();
    const doc: Doc = {
      id,
      passengerId: user.uid,
      passengerName: user.name,
      origin,
      destination,
      distanceKm,
      suggestedPrice,
      minimumPrice: minimum,
      passengerOffer: offer,
      paymentMethod: method,
      notes: text(body.notes, 200),
      status: 'open',
      offers: [],
      escrowCents: 0,
      createdAt: this.iso(),
    };
    await this.store.set('indrive', id, doc);
    return this.indriveView(doc, auth.uid);
  }

  async sendInDriveOffer(auth: AuthUser, id: string, body: Record<string, unknown>) {
    const driver = await this.approvedUser(auth, 'driver');
    const offeredPrice = round2(num(body.offeredPrice, 8, 5000, 'proposta'));
    const reqDoc = await this.store.get<Doc>('indrive', id);
    if (reqDoc && offeredPrice < negotiationFloor(Number(reqDoc.distanceKm)))
      fail(400, 'below_floor', `A proposta mínima é ${brl(negotiationFloor(Number(reqDoc.distanceKm)))}.`);
    const etaMin = Math.round(num(body.etaMin ?? 5, 1, 60, 'tempo'));
    const req = await this.store.transaction(async (tx) => {
      const r = await this.mustGet<Doc>(tx, 'indrive', id, 'Pedido');
      if (r.passengerId === auth.uid) fail(403, 'own_request', 'Você não pode responder ao próprio pedido.');
      if (r.status !== 'open') fail(409, 'closed', 'Este pedido não está mais aberto.');
      const others = ((r.offers as Doc[]) || []).filter((o) => o.driverId !== auth.uid);
      const offer = {
        id: randomUUID(),
        driverId: driver.uid,
        driverName: driver.name,
        driverRating: round2(driver.rating),
        tripsCount: driver.completedTrips,
        vehicleModel: driver.driverVehicle,
        vehiclePlate: driver.driverPlate,
        offeredPrice,
        etaMin,
        note: text(body.note, 200),
        createdAt: this.iso(),
      };
      r.offers = [offer, ...others].slice(0, 30);
      tx.update('indrive', id, { offers: r.offers });
      return r;
    });
    return this.indriveView(req, auth.uid);
  }

  async acceptInDriveOffer(auth: AuthUser, id: string, offerId: unknown) {
    // Ganho da Froc no preço combinado (mesmo "leilão" de R$ 2–8 das corridas).
    const pre = (await this.store.get<Doc>('indrive', id)) ?? fail(404, 'not_found', 'Pedido não encontrado.');
    const chosen = ((pre.offers as Doc[]) || []).find((o) => o.id === offerId);
    const feeInfo = await this.feeForAgreedPrice(Number(chosen?.offeredPrice || pre.passengerOffer || 0), pre.origin as GeoPoint, Number(pre.distanceKm || 0));
    const req = await this.store.transaction(async (tx) => {
      const r = await this.mustGet<Doc>(tx, 'indrive', id, 'Pedido');
      if (r.passengerId !== auth.uid) fail(403, 'forbidden', 'Só quem fez o pedido pode aceitar.');
      if (r.status !== 'open') fail(409, 'closed', 'Este pedido não está mais aberto.');
      const offer = ((r.offers as Doc[]) || []).find((o) => o.id === offerId) ?? fail(400, 'invalid_offer', 'Proposta inválida.');
      const passenger = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Passageiro');
      const cents = toCents(Number(offer.offeredPrice));
      const patch: Doc = {
        platformFeeCents: toCents(feeInfo.fee),
        driverEarning: round2(Number(offer.offeredPrice) - feeInfo.fee),
        status: 'matched',
        acceptedOfferId: offer.id,
        driverId: offer.driverId,
        agreedPriceCents: cents,
        matchedAt: this.iso(),
      };
      if (r.paymentMethod === 'froc_pay') {
        this.debit(tx, passenger, cents, `Negociação · ${offer.driverName} · valor retido`, 'indrive');
        patch.escrowCents = cents;
      }
      Object.assign(r, patch);
      tx.update('indrive', id, patch);
      return r;
    });
    return this.indriveView(req, auth.uid);
  }

  async completeInDrive(auth: AuthUser, id: string) {
    await this.settings();
    const req = await this.store.transaction(async (tx) => {
      const r = await this.mustGet<Doc>(tx, 'indrive', id, 'Pedido');
      if (r.driverId !== auth.uid) fail(403, 'forbidden', 'Só o motorista escolhido pode finalizar.');
      if (r.status !== 'matched') fail(409, 'invalid_state', 'Esta viagem não está em andamento.');
      const driver = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Motorista');
      const passenger = await tx.get<UserDoc>('users', String(r.passengerId));
      const amount = r.paymentMethod === 'froc_pay' ? Number(r.escrowCents) : Number(r.agreedPriceCents);
      const patch = { status: 'completed', escrowCents: 0, completedAt: this.iso() };
      Object.assign(r, patch);
      tx.update('indrive', id, patch);
      this.payProvider(tx, driver, passenger, amount, r.paymentMethod as PaymentMethod, 'Corrida negociada', 'indrive', typeof r.platformFeeCents === 'number' ? Number(r.platformFeeCents) : undefined);
      return r;
    });
    return this.indriveView(req, auth.uid);
  }

  async cancelInDrive(auth: AuthUser, id: string) {
    const req = await this.store.transaction(async (tx) => {
      const r = await this.mustGet<Doc>(tx, 'indrive', id, 'Pedido');
      if (r.passengerId !== auth.uid) fail(403, 'forbidden', 'Só quem fez o pedido pode cancelar.');
      if (r.status !== 'open' && r.status !== 'matched') fail(409, 'invalid_state', 'Não é possível cancelar agora.');
      const passenger = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Passageiro');
      const escrow = Number(r.escrowCents || 0);
      // Mesma regra das corridas, contando a partir do acordo com o motorista.
      const pct = r.status === 'matched' ? this.rideCancelPercent({ ...r, status: 'accepted', etaMin: 60 }, 'matchedAt') : 0;
      const fee = Math.round((escrow * pct) / 100);
      const driver = fee > 0 ? await this.mustGet<UserDoc>(tx, 'users', String(r.driverId), 'Motorista') : null;
      const patch = { status: 'cancelled', escrowCents: 0, cancelledAt: this.iso(), cancellationFeePercent: pct, cancellationFee: toReais(fee) };
      Object.assign(r, patch);
      tx.update('indrive', id, patch);
      if (escrow - fee > 0) this.credit(tx, passenger, escrow - fee, pct ? `Estorno parcial · negociação cancelada (taxa ${pct}%)` : 'Estorno · negociação cancelada', 'estorno');
      if (driver) this.payCancellation(tx, driver, fee, pct, 'Corrida negociada', 'indrive', false, typeof r.platformFeeCents === 'number');
      return r;
    });
    return this.indriveView(req, auth.uid);
  }

  // ------------------------------------------------- 3) caronas BlaBlaCar

  private carpoolView(t: Doc, uid: string, myBookings: Doc[], tripBookings?: Doc[]): CarpoolTrip {
    const mine = t.driverId === uid ? 'provider' : null;
    const booked = myBookings.filter((b) => b.tripId === t.id && b.status === 'paid').reduce((acc, b) => acc + Number(b.seats), 0);
    const { driverPhone, ...rest } = t;
    return {
      ...(rest as unknown as CarpoolTrip),
      mine: mine ?? (booked > 0 ? 'owner' : null),
      bookedByUserSeats: booked,
      driverPhone: booked > 0 ? String(driverPhone || '') : undefined,
      passengers: mine && tripBookings
        ? tripBookings
            .filter((b) => b.status === 'paid')
            .map((b) => ({ name: String(b.passengerName), seats: Number(b.seats), phone: String(b.passengerPhone || '') }))
        : undefined,
    };
  }

  async publishCarpool(auth: AuthUser, body: Record<string, unknown>) {
    const driver = await this.approvedUser(auth, 'driver');
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const departureTime = /^\d{2}:\d{2}$/.test(String(body.departureTime)) ? String(body.departureTime) : fail(400, 'invalid_time', 'Horário inválido.');
    const [hh, mm] = departureTime.split(':').map(Number);
    const arr = (hh * 60 + mm + estimateDurationMin(distanceKm, 'highway')) % 1440;
    const seats = Math.round(num(body.totalSeats, 1, 6, 'vagas'));
    const id = randomUUID();
    const doc: Doc = {
      id,
      driverId: driver.uid,
      driverName: driver.name,
      driverRating: round2(driver.rating),
      driverPhone: driver.phone,
      verified: true,
      vehicleModel: driver.driverVehicle,
      origin,
      destination,
      pickupSpot: text(body.pickupSpot, 120) || `${origin.city} · ponto combinado`,
      dropoffSpot: text(body.dropoffSpot, 120) || `${destination.city} · ponto combinado`,
      date: text(body.date, 40) || fail(400, 'invalid_date', 'Informe a data da viagem.'),
      departureTime,
      arrivalTime: `${String(Math.floor(arr / 60)).padStart(2, '0')}:${String(arr % 60).padStart(2, '0')}`,
      distanceKm,
      pricePerSeat: round2(num(body.pricePerSeat, 5, 2000, 'preço por vaga')),
      totalSeats: seats,
      availableSeats: seats,
      instantBooking: true,
      preferences: { music: body.music !== false, pets: body.pets === true, luggage: 'Média', smoking: false, maxTwoBack: true },
      bookedByUserSeats: 0,
      status: 'open',
      createdAt: this.iso(),
    };
    await this.store.set('carpools', id, doc);
    return this.carpoolView(doc, auth.uid, [], []);
  }

  async bookCarpool(auth: AuthUser, tripId: string, seatsWanted: unknown) {
    await this.identityGateFor(auth);
    const seats = Math.round(num(seatsWanted, 1, 6, 'vagas'));
    const bookingId = randomUUID();
    const trip = await this.store.transaction(async (tx) => {
      const t = await this.mustGet<Doc>(tx, 'carpools', tripId, 'Carona');
      if (t.driverId === auth.uid) fail(403, 'own_trip', 'Você é o motorista desta carona.');
      if (t.status !== 'open') fail(409, 'closed', 'Esta carona não aceita mais reservas.');
      if (Number(t.availableSeats) < seats) fail(409, 'no_seats', 'Não há vagas suficientes.');
      const passenger = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Passageiro');
      const cents = toCents(Number(t.pricePerSeat)) * seats;
      this.debit(tx, passenger, cents, `Carona ${(t.origin as GeoPoint).city} → ${(t.destination as GeoPoint).city} (${seats} vaga(s)) · retido`, 'carona');
      t.availableSeats = Number(t.availableSeats) - seats;
      tx.update('carpools', tripId, { availableSeats: t.availableSeats });
      tx.set('carpoolBookings', bookingId, {
        id: bookingId,
        tripId,
        passengerId: passenger.uid,
        passengerName: passenger.name,
        passengerPhone: passenger.phone,
        seats,
        amountCents: cents,
        status: 'paid',
        createdAt: this.iso(),
      });
      return t;
    });
    const mine = await this.store.query<Doc>('carpoolBookings', [['passengerId', '==', auth.uid]], 300);
    return this.carpoolView(trip, auth.uid, mine);
  }

  async cancelCarpoolBooking(auth: AuthUser, tripId: string) {
    const mine = (await this.store.query<Doc>('carpoolBookings', [['passengerId', '==', auth.uid]], 300)).filter(
      (b) => b.tripId === tripId && b.status === 'paid',
    );
    if (!mine.length) fail(404, 'not_found', 'Você não tem reserva nesta carona.');
    const trip = await this.store.transaction(async (tx) => {
      const t = await this.mustGet<Doc>(tx, 'carpools', tripId, 'Carona');
      if (t.status !== 'open') fail(409, 'invalid_state', 'Esta carona já foi concluída ou cancelada.');
      const passenger = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Passageiro');
      const bookings = [];
      for (const b of mine) bookings.push(await this.mustGet<Doc>(tx, 'carpoolBookings', String(b.id), 'Reserva'));
      let seats = 0;
      for (const b of bookings) {
        if (b.status !== 'paid') continue;
        seats += Number(b.seats);
        tx.update('carpoolBookings', String(b.id), { status: 'refunded', cancelledAt: this.iso() });
        this.credit(tx, passenger, Number(b.amountCents), 'Estorno · reserva de carona cancelada', 'estorno');
      }
      t.availableSeats = Number(t.availableSeats) + seats;
      tx.update('carpools', tripId, { availableSeats: t.availableSeats });
      return t;
    });
    return this.carpoolView(trip, auth.uid, []);
  }

  async finishCarpool(auth: AuthUser, tripId: string, outcome: 'completed' | 'cancelled') {
    await this.settings();
    const tripBookings = await this.store.query<Doc>('carpoolBookings', [['tripId', '==', tripId]], 50);
    const trip = await this.store.transaction(async (tx) => {
      const t = await this.mustGet<Doc>(tx, 'carpools', tripId, 'Carona');
      if (t.driverId !== auth.uid) fail(403, 'forbidden', 'Só o motorista da carona pode fazer isso.');
      if (t.status !== 'open') fail(409, 'invalid_state', 'Esta carona já foi encerrada.');
      const driver = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Motorista');
      const bookings: Doc[] = [];
      for (const b of tripBookings) bookings.push(await this.mustGet<Doc>(tx, 'carpoolBookings', String(b.id), 'Reserva'));
      const paid = bookings.filter((b) => b.status === 'paid');
      const passengers = new Map<string, UserDoc>();
      for (const b of paid) {
        const pid = String(b.passengerId);
        if (!passengers.has(pid)) {
          const p = await tx.get<UserDoc>('users', pid);
          if (p) passengers.set(pid, p);
        }
      }
      tx.update('carpools', tripId, { status: outcome, finishedAt: this.iso() });
      t.status = outcome;
      const route = `${(t.origin as GeoPoint).city} → ${(t.destination as GeoPoint).city}`;
      if (outcome === 'completed') {
        const total = paid.reduce((acc, b) => acc + Number(b.amountCents), 0);
        for (const b of paid) tx.update('carpoolBookings', String(b.id), { status: 'released' });
        if (total > 0) {
          this.creditEarning(tx, driver, this.providerCut(total), `Ganho · carona ${route} (${100 - this.cfg.commissionPercent}% líquido)`);
          this.platformRevenue(tx, 'carona', total, total - this.providerCut(total));
          for (const b of paid) this.awardPoints(tx, passengers.get(String(b.passengerId)) ?? null, Number(b.amountCents));
        }
        driver.completedTrips += 1;
        tx.update('users', driver.uid, { completedTrips: driver.completedTrips });
      } else {
        for (const b of paid) {
          tx.update('carpoolBookings', String(b.id), { status: 'refunded' });
          const p = passengers.get(String(b.passengerId));
          if (p) this.credit(tx, p, Number(b.amountCents), `Estorno · carona ${route} cancelada pelo motorista`, 'estorno');
        }
      }
      return t;
    });
    return this.carpoolView(trip, auth.uid, [], tripBookings);
  }

  // -------------------------------------- 4) caminhões vazios e fretes/mudanças

  private truckView(t: Doc, uid: string): EmptyTruckRoute {
    const { escrowCents: _e, truckerPhone, reservedPhone, ...rest } = t;
    const mine = involvement(uid, t.reservedById, t.truckerId);
    // Telefones só para quem fechou negócio: cliente vê o do caminhoneiro e vice-versa.
    return {
      ...(rest as unknown as EmptyTruckRoute),
      mine,
      truckerPhone: mine === 'owner' ? String(truckerPhone || '') : undefined,
      reservedPhone: mine === 'provider' ? String(reservedPhone || '') : undefined,
    };
  }

  private freightView(f: Doc, uid: string): FreightRequest {
    const { escrowCents: _e, clientPhone, truckerPhone, ...rest } = f;
    const mine = involvement(uid, f.clientId, f.acceptedTruckerId);
    const bids = (Array.isArray(f.bids) ? f.bids : []) as Doc[];
    return {
      ...(rest as unknown as FreightRequest),
      mine,
      bids: (mine === 'owner' ? bids : bids.filter((b) => b.truckerId === uid)) as unknown as FreightRequest['bids'],
      clientPhone: mine === 'provider' ? String(clientPhone || '') : undefined,
      truckerPhone: mine === 'owner' ? String(truckerPhone || '') : undefined,
    };
  }

  async publishEmptyTruck(auth: AuthUser, body: Record<string, unknown>) {
    const trucker = await this.approvedUser(auth, 'trucker');
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const price = round2(num(body.emptyReturnPrice, 50, 100000, 'preço'));
    const standardPrice = Math.max(price, Math.round(distanceKm * 9.5));
    const id = randomUUID();
    const doc: Doc = {
      id,
      truckerId: trucker.uid,
      truckerName: trucker.name,
      truckerRating: round2(trucker.rating),
      verified: true,
      companyName: trucker.companyName || 'Autônomo',
      truckType: trucker.truckType,
      truckPlate: trucker.truckPlate,
      truckerPhone: trucker.phone,
      origin,
      destination,
      distanceKm,
      departureDate: text(body.departureDate, 60) || fail(400, 'invalid_date', 'Informe a data de saída.'),
      departureWindow: text(body.departureWindow, 120) || 'Combinar horário pelo telefone após a reserva',
      direction: ['indo_vazio', 'voltando_vazio', 'espaco_parcial'].includes(String(body.direction)) ? body.direction : 'voltando_vazio',
      availableTons: round2(num(body.availableTons, 0.1, 60, 'toneladas')),
      availableCubicM: round2(num(body.availableCubicM, 1, 150, 'metros cúbicos')),
      standardPrice,
      emptyReturnPrice: price,
      discountPercent: Math.max(0, Math.round(((standardPrice - price) / standardPrice) * 100)),
      acceptsMoving: body.acceptsMoving !== false,
      hasLiftgate: body.hasLiftgate === true,
      status: 'available',
      createdAt: this.iso(),
    };
    await this.store.set('emptyTrucks', id, doc);
    return this.truckView(doc, auth.uid);
  }

  async reserveEmptyTruck(auth: AuthUser, id: string) {
    await this.identityGateFor(auth);
    const route = await this.store.transaction(async (tx) => {
      const t = await this.mustGet<Doc>(tx, 'emptyTrucks', id, 'Caminhão');
      if (t.truckerId === auth.uid) fail(403, 'own_route', 'Esta rota é sua.');
      if (t.status !== 'available') fail(409, 'taken', 'Esta rota já foi reservada.');
      const client = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Cliente');
      const cents = toCents(Number(t.emptyReturnPrice));
      this.debit(tx, client, cents, `Frete retorno vazio ${(t.origin as GeoPoint).city} → ${(t.destination as GeoPoint).city} · retido`, 'frete');
      const patch = { status: 'reserved', reservedById: client.uid, reservedBy: client.name, reservedPhone: client.phone, escrowCents: cents, reservedAt: this.iso() };
      Object.assign(t, patch);
      tx.update('emptyTrucks', id, patch);
      return t;
    });
    return this.truckView(route, auth.uid);
  }

  async finishEmptyTruck(auth: AuthUser, id: string, action: 'complete' | 'cancel') {
    await this.settings();
    const route = await this.store.transaction(async (tx) => {
      const t = await this.mustGet<Doc>(tx, 'emptyTrucks', id, 'Caminhão');
      const isTrucker = t.truckerId === auth.uid;
      const isClient = t.reservedById === auth.uid;
      if (!isTrucker && !isClient) fail(403, 'forbidden', 'Você não participa deste frete.');
      const escrow = Number(t.escrowCents || 0);
      const label = `${(t.origin as GeoPoint).city} → ${(t.destination as GeoPoint).city}`;
      if (action === 'complete') {
        if (!isTrucker) fail(403, 'forbidden', 'Só o caminhoneiro confirma a entrega.');
        if (t.status !== 'reserved') fail(409, 'invalid_state', 'Este frete não está reservado.');
        const trucker = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Caminhoneiro');
        const client = await tx.get<UserDoc>('users', String(t.reservedById));
        tx.update('emptyTrucks', id, { status: 'completed', escrowCents: 0, completedAt: this.iso() });
        t.status = 'completed';
        this.payProvider(tx, trucker, client, escrow, 'froc_pay', `frete ${label}`, 'retorno_vazio');
        return t;
      }
      if (t.status === 'reserved') {
        const client = await this.mustGet<UserDoc>(tx, 'users', String(t.reservedById), 'Cliente');
        // Cliente desistiu: rota volta para a vitrine. Caminhoneiro desistiu: rota sai do ar.
        const patch = isClient
          ? { status: 'available', reservedById: null, reservedBy: null, reservedPhone: null, escrowCents: 0 }
          : { status: 'cancelled', escrowCents: 0 };
        tx.update('emptyTrucks', id, patch);
        Object.assign(t, patch);
        if (escrow > 0) this.credit(tx, client, escrow, `Estorno · frete ${label} cancelado`, 'estorno');
        return t;
      }
      if (t.status === 'available' && isTrucker) {
        tx.update('emptyTrucks', id, { status: 'cancelled' });
        t.status = 'cancelled';
        return t;
      }
      return fail(409, 'invalid_state', 'Não é possível cancelar agora.');
    });
    return this.truckView(route, auth.uid);
  }

  async createFreight(auth: AuthUser, body: Record<string, unknown>) {
    await this.identityGateFor(auth);
    const client = await this.ensureUser(auth);
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const kinds = ['mudanca_residencial', 'carreto_rapido', 'carga_paletizada', 'veiculo_moto'];
    if (Number(body.proposedBudget) < freightFloor(distanceKm))
      fail(400, 'below_floor', `O orçamento mínimo para ${distanceKm} km é ${brl(freightFloor(distanceKm))}.`);
    const id = randomUUID();
    const doc: Doc = {
      id,
      clientId: client.uid,
      clientName: client.name,
      kind: kinds.includes(String(body.kind)) ? body.kind : 'mudanca_residencial',
      title: text(body.title, 120) || `Frete ${origin.city} → ${destination.city}`,
      origin,
      destination,
      distanceKm,
      truckTypeNeeded: TRUCK_TYPES.includes(body.truckTypeNeeded as TruckType) ? body.truckTypeNeeded : '3/4 Baú',
      estimatedWeightKg: Math.round(num(body.estimatedWeightKg, 1, 60000, 'peso')),
      helpersNeeded: Math.round(num(body.helpersNeeded ?? 0, 0, 10, 'ajudantes')),
      hasElevator: body.hasElevator === true,
      needsPacking: body.needsPacking === true,
      estimatedVolumeM3: round2(num(body.estimatedVolumeM3 ?? 1, 0.1, 150, 'volume')),
      minimumPrice: freightFloor(distanceKm),
      proposedBudget: round2(num(body.proposedBudget, 50, 200000, 'orçamento')),
      scheduledDate: text(body.scheduledDate, 60) || fail(400, 'invalid_date', 'Informe a data da coleta.'),
      status: 'open_bids',
      bids: [],
      escrowCents: 0,
      createdAt: this.iso(),
    };
    await this.store.set('freights', id, doc);
    return this.freightView(doc, auth.uid);
  }

  async bidFreight(auth: AuthUser, id: string, body: Record<string, unknown>) {
    const trucker = await this.approvedUser(auth, 'trucker');
    const price = round2(num(body.price, 50, 200000, 'lance'));
    const item = await this.store.transaction(async (tx) => {
      const f = await this.mustGet<Doc>(tx, 'freights', id, 'Frete');
      if (f.clientId === auth.uid) fail(403, 'own_freight', 'Este pedido é seu.');
      if (f.status !== 'open_bids') fail(409, 'closed', 'Este frete não recebe mais lances.');
      if (price < freightFloor(Number(f.distanceKm))) fail(400, 'below_floor', `O lance mínimo é ${brl(freightFloor(Number(f.distanceKm)))}.`);
      const others = ((f.bids as Doc[]) || []).filter((b) => b.truckerId !== auth.uid);
      const bid = {
        id: randomUUID(),
        truckerId: trucker.uid,
        truckerName: trucker.companyName ? `${trucker.name} · ${trucker.companyName}` : trucker.name,
        truckerRating: round2(trucker.rating),
        truckType: trucker.truckType,
        price,
        helpersIncluded: Math.round(num(body.helpersIncluded ?? 0, 0, 10, 'ajudantes')),
        etaText: text(body.etaText, 120) || 'Disponível na data combinada',
        note: text(body.note, 200),
      };
      f.bids = [bid, ...others].slice(0, 30);
      tx.update('freights', id, { bids: f.bids });
      return f;
    });
    return this.freightView(item, auth.uid);
  }

  async acceptFreightBid(auth: AuthUser, id: string, bidId: unknown) {
    const item = await this.store.transaction(async (tx) => {
      const f = await this.mustGet<Doc>(tx, 'freights', id, 'Frete');
      if (f.clientId !== auth.uid) fail(403, 'forbidden', 'Só quem pediu o frete pode contratar.');
      if (f.status !== 'open_bids') fail(409, 'closed', 'Este frete já foi contratado.');
      const bid = ((f.bids as Doc[]) || []).find((b) => b.id === bidId) ?? fail(400, 'invalid_bid', 'Lance inválido.');
      const client = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Cliente');
      const truckerUser = await tx.get<UserDoc>('users', String(bid.truckerId));
      const cents = toCents(Number(bid.price));
      this.debit(tx, client, cents, `Frete · ${bid.truckerName} · valor retido até a entrega`, 'frete');
      const patch = {
        status: 'booked',
        acceptedBidId: bid.id,
        acceptedTruckerId: bid.truckerId,
        escrowCents: cents,
        clientPhone: client.phone,
        truckerPhone: truckerUser?.phone || '',
        bookedAt: this.iso(),
      };
      Object.assign(f, patch);
      tx.update('freights', id, patch);
      return f;
    });
    return this.freightView(item, auth.uid);
  }

  async finishFreight(auth: AuthUser, id: string, action: 'deliver' | 'cancel') {
    await this.settings();
    const item = await this.store.transaction(async (tx) => {
      const f = await this.mustGet<Doc>(tx, 'freights', id, 'Frete');
      const escrow = Number(f.escrowCents || 0);
      if (action === 'deliver') {
        if (f.acceptedTruckerId !== auth.uid) fail(403, 'forbidden', 'Só o caminhoneiro contratado confirma a entrega.');
        if (f.status !== 'booked' && f.status !== 'in_transit') fail(409, 'invalid_state', 'Este frete não está em andamento.');
        const trucker = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Caminhoneiro');
        const client = await tx.get<UserDoc>('users', String(f.clientId));
        tx.update('freights', id, { status: 'delivered', escrowCents: 0, deliveredAt: this.iso() });
        f.status = 'delivered';
        this.payProvider(tx, trucker, client, escrow, 'froc_pay', String(f.title), 'frete');
        return f;
      }
      if (f.clientId !== auth.uid) fail(403, 'forbidden', 'Só quem pediu o frete pode cancelar.');
      if (f.status !== 'open_bids' && f.status !== 'booked') fail(409, 'invalid_state', 'Não é possível cancelar agora.');
      const client = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Cliente');
      tx.update('freights', id, { status: 'cancelled', escrowCents: 0, cancelledAt: this.iso() });
      f.status = 'cancelled';
      if (escrow > 0) this.credit(tx, client, escrow, `Estorno · ${f.title}`, 'estorno');
      return f;
    });
    return this.freightView(item, auth.uid);
  }

  // ------------------------------------------- H3: preço dinâmico e localização

  /** Multiplicador do preço na região: mais pedidos que motoristas por perto = preço sobe. */
  async surgeAt(lat: number, lng: number): Promise<number> {
    const cfg = await this.settings();
    if (!cfg.surgeEnabled) return 1;
    const area = new Set(this.geo.ring(this.geo.cellOf(lat, lng), SURGE_RING));
    const [searching, online] = await Promise.all([
      this.store.query<Doc>('rides', [['status', '==', 'searching']], 300),
      this.store.query<UserDoc>('users', [['driverOnline', '==', true]], 500),
    ]);
    const now = this.now().getTime();
    const demand = searching.filter((r) => area.has(String(r.originCell))).length;
    const supply = online.filter(
      (u) => u.driverCell && area.has(u.driverCell) && now - Date.parse(String(u.locationAt || 0)) < LOCATION_FRESH_MS,
    ).length;
    const ratio = (demand + 1) / (supply + 1);
    const mult = 1 + Math.max(0, ratio - 1) * 0.5;
    return Math.min(cfg.maxSurge, Math.round(mult * 10) / 10);
  }

  // ------------------------------------------- preço (estilo Uber) e ganho da Froc

  private feeLimits() {
    return { feeMin: this.cfg.platformFeeMin, feeMax: Math.max(this.cfg.platformFeeMin, this.cfg.platformFeeMax), feeMaxPct: this.cfg.platformFeeMaxPct };
  }

  async riskZones(): Promise<RiskZoneLike[]> {
    if (Date.now() - this.riskCache.at > 60_000) {
      const zones = (await this.store.query<Doc>('risk_zones', [], 500)).map((z) => z as unknown as RiskZoneLike);
      this.riskCache = { at: Date.now(), zones };
    }
    return this.riskCache.zones;
  }

  /** Preço completo de uma categoria: tarifa, dinâmico (horário × demanda), área de risco e ganho da Froc. */
  async priceFor(categoryId: string, origin: GeoPoint, destination: GeoPoint, demand?: number): Promise<PriceBreakdown & { distanceKm: number; durationMin: number }> {
    const cfg = await this.settings();
    const category = RIDE_CATEGORIES.find((c) => c.id === categoryId) ?? fail(400, 'invalid_category', 'Categoria inválida.');
    const distanceKm = calculateDistanceKm(origin, destination);
    const durationMin = estimateDurationMin(distanceKm, category.id === 'froc_moto' || category.id === 'froc_delivery' ? 'moto' : 'urban');
    const base = category.baseFare + distanceKm * category.perKm + durationMin * category.perMin;
    const risk = riskZoneFor([origin, destination], await this.riskZones(), this.now());
    const p = priceRide({
      base,
      minimum: 7.5,
      date: this.now(),
      demand: demand ?? (await this.surgeAt(origin.lat, origin.lng)),
      maxSurge: cfg.maxSurge,
      timeSurgeEnabled: cfg.timeSurgeEnabled,
      risk,
      distanceKm,
      limits: this.feeLimits(),
    });
    return { ...p, distanceKm, durationMin };
  }

  /** Ganho da Froc numa corrida com preço já definido (negociação e entregas). */
  private async feeForAgreedPrice(price: number, origin: GeoPoint, distanceKm: number) {
    await this.settings();
    const risk = riskZoneFor([origin], await this.riskZones(), this.now());
    const demand = await this.surgeAt(origin.lat, origin.lng);
    return platformFee({ fare: price, band: timeBandAt(this.now()), demand, riskZone: Boolean(risk), distanceKm }, this.feeLimits());
  }

  /** Áreas de risco (agentes de segurança e preços cuidam delas). */
  async saveRiskZone(auth: AuthUser, body: Record<string, unknown>) {
    this.requireAdmin(auth);
    const id = text(body.id, 60) || randomUUID();
    const name = text(body.name, 80);
    if (name.length < 3) fail(400, 'invalid_name', 'Dê um nome para a área (ex.: Comunidade X, zona norte).');
    const zone: RiskZoneLike = {
      id,
      name,
      lat: num(body.lat, -34.5, 5.9, 'latitude'),
      lng: num(body.lng, -74.5, -28.5, 'longitude'),
      radiusKm: round2(num(body.radiusKm ?? 1, 0.2, 10, 'raio')),
      surchargePct: Math.round(num(body.surchargePct ?? 15, 0, 50, 'acréscimo')),
      when: body.when === 'noite' ? 'noite' : 'sempre',
      active: body.active !== false,
    };
    await this.store.set('risk_zones', id, { ...zone, updatedBy: auth.email, updatedAt: this.iso() });
    this.riskCache.at = 0;
    await this.audit(auth, 'area_de_risco_salva', id, zone as unknown as Record<string, unknown>);
    return zone;
  }

  async listRiskZones(auth: AuthUser) {
    this.requireAdmin(auth);
    return { zones: await this.store.query<Doc>('risk_zones', [], 500) };
  }

  async quoteRide(auth: AuthUser, body: Record<string, unknown>) {
    await this.ensureUser(auth);
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const surge = await this.surgeAt(origin.lat, origin.lng);
    const quotes = await Promise.all(RIDE_CATEGORIES.map(async (c) => ({ categoryId: c.id, ...(await this.priceFor(c.id, origin, destination, surge)) })));
    const first = quotes[0];
    return {
      surge: first.multiplier,
      demand: surge,
      band: first.band,
      risk: first.risk,
      distanceKm: first.distanceKm,
      // SIGILO: o passageiro não recebe o ganho da Froc nem o do motorista.
      prices: quotes.map((q) => {
        const breakdown = { ...q } as unknown as Doc;
        hideFee(breakdown, 'cliente');
        return { categoryId: q.categoryId, price: q.total, breakdown };
      }),
    };
  }

  /** Motorista online envia a posição do celular; o passageiro vê o carro andando no mapa. */
  async updateLocation(auth: AuthUser, latValue: unknown, lngValue: unknown) {
    const user = await this.anyProvider(auth);
    const lat = num(latValue, -90, 90, 'latitude');
    const lng = num(lngValue, -180, 180, 'longitude');
    const at = this.iso();
    const cell = this.geo.cellOf(lat, lng);
    // Direção do carro (para girar o ícone no mapa): só muda se andou mais de ~15 m.
    let heading = typeof user.driverHeading === 'number' ? user.driverHeading : null;
    if (typeof user.driverLat === 'number' && typeof user.driverLng === 'number') {
      const prev = { lat: user.driverLat, lng: user.driverLng };
      if (Math.abs(prev.lat - lat) + Math.abs(prev.lng - lng) > 0.00015) heading = bearing(prev, { lat, lng });
    }
    await this.store.update('users', user.uid, { driverLat: lat, driverLng: lng, driverCell: cell, locationAt: at, ...(heading !== null ? { driverHeading: heading } : {}) });
    const location = { lat: round6(lat), lng: round6(lng), at, ...(heading !== null ? { heading } : {}) };
    const [rides, deals] = await Promise.all([
      this.store.query<Doc>('rides', [['driverId', '==', user.uid]], 100),
      this.store.query<Doc>('indrive', [['driverId', '==', user.uid]], 100),
    ]);
    await Promise.all([
      ...rides
        .filter((r) => ['accepted', 'arriving', 'in_progress'].includes(String(r.status)))
        .map((r) => this.store.update('rides', String(r.id), { driverLocation: location })),
      ...deals.filter((r) => r.status === 'matched').map((r) => this.store.update('indrive', String(r.id), { driverLocation: location })),
    ]);
    return { ok: true, cell };
  }

  // ------------------------------------- tarefas com prazo (o que o Cadence faz)

  /**
   * Varredura de prazos: corrida sem motorista e negociação sem resposta não ficam
   * paradas para sempre. Roda sozinha (no máximo 1x por minuto) e também pode ser
   * chamada por um agendador externo em /api/cron/sweep.
   */
  async sweep(force = false) {
    if (!force && Date.now() - this.lastSweep < 60_000) return { skipped: true };
    this.lastSweep = Date.now();
    const cfg = await this.settings();
    const now = this.now().getTime();
    let rides = 0;
    let deals = 0;
    for (const r of await this.store.query<Doc>('rides', [['status', '==', 'searching']], 300)) {
      const limitMin = r.delivery ? Math.max(cfg.rideSearchTimeoutMin, DELIVERY_SEARCH_MIN) : cfg.rideSearchTimeoutMin;
      if (now - Date.parse(String(r.createdAt)) < limitMin * 60_000) continue;
      const done = await this.store.transaction(async (tx) => {
        const ride = await tx.get<Doc>('rides', String(r.id));
        if (!ride || ride.status !== 'searching') return false;
        const passenger = await tx.get<UserDoc>('users', String(ride.passengerId));
        const escrow = Number(ride.escrowCents || 0);
        tx.update('rides', String(r.id), { status: 'cancelled', escrowCents: 0, cancelledAt: this.iso(), cancelledBy: 'timeout' });
        if (passenger && escrow > 0) this.credit(tx, passenger, escrow, 'Estorno · nenhum motorista disponível a tempo', 'estorno');
        return true;
      });
      if (done) {
        rides++;
        if (r.delivery) await this.deliveryEvent({ ...r, status: 'cancelled', cancelledBy: 'timeout' });
      }
    }
    for (const r of await this.store.query<Doc>('indrive', [['status', '==', 'open']], 300)) {
      if (now - Date.parse(String(r.createdAt)) < cfg.indriveOpenTimeoutMin * 60_000) continue;
      await this.store.update('indrive', String(r.id), { status: 'cancelled', cancelledAt: this.iso(), cancelledBy: 'timeout' });
      deals++;
    }
    const webhooks = this.deps.webhooks ? await this.deps.webhooks.retryDue().catch(() => null) : null;
    // Equipe IA no comando: saques dentro das regras e lojas com CNPJ ativo, sem esperar o dono.
    // Só no agendador (força=true): não deixa a tela de ninguém esperando consultas externas.
    const saques = force ? await this.autoProcessWithdrawals().catch((e) => ({ erro: String(e?.message || e) })) : null;
    const lojas = force ? await this.autoReviewMerchants().catch((e) => ({ erro: String(e?.message || e) })) : null;
    return { ridesCancelled: rides, requestsExpired: deals, webhooks, saques, lojas };
  }

  // ------------------------------------------------------------- SOS e pontos

  async createSos(auth: AuthUser, body: Record<string, unknown>) {
    const user = await this.ensureUser(auth);
    const kind = ['ride', 'indrive', 'carpool', 'truck', 'freight', 'general'].includes(String(body.kind)) ? String(body.kind) : 'general';
    const refId = text(body.refId, 80);
    let trip: Doc | null = null;
    if (refId && (kind === 'ride' || kind === 'indrive')) {
      trip = await this.store.get<Doc>(kind === 'ride' ? 'rides' : 'indrive', refId);
      if (!trip || (trip.passengerId !== user.uid && trip.driverId !== user.uid)) fail(403, 'forbidden', 'Você não participa desta viagem.');
    }
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const id = randomUUID();
    const doc: Doc = {
      id,
      uid: user.uid,
      name: user.name,
      phone: user.phone,
      email: user.email,
      kind,
      refId,
      lat: Number.isFinite(lat) ? round6(lat) : null,
      lng: Number.isFinite(lng) ? round6(lng) : null,
      message: text(body.message, 500),
      status: 'open',
      trip: trip
        ? {
            origin: (trip.origin as GeoPoint)?.name,
            destination: (trip.destination as GeoPoint)?.name,
            passengerName: trip.passengerName,
            driverName: trip.driverName ?? null,
            vehiclePlate: trip.vehiclePlate ?? null,
            vehicleModel: trip.vehicleModel ?? null,
          }
        : null,
      createdAt: this.iso(),
    };
    await this.store.set('sos', id, doc);
    return { id };
  }

  async resolveSos(auth: AuthUser, id: unknown, note: unknown) {
    this.requireAdmin(auth);
    const sos = (await this.store.get<Doc>('sos', String(id))) ?? fail(404, 'not_found', 'Alerta não encontrado.');
    if (sos.status !== 'open') fail(409, 'not_open', 'Este alerta já foi resolvido.');
    await this.store.update('sos', String(id), { status: 'resolved', resolvedBy: auth.agent ? `IA (${auth.agent})` : auth.email, note: text(note, 300), resolvedAt: this.iso() });
    await this.audit(auth, 'sos_resolvido', String(id), { note: text(note, 300) });
    return { ok: true };
  }

  async redeemPoints(auth: AuthUser) {
    const cfg = await this.settings();
    await this.ensureUser(auth);
    await this.store.transaction(async (tx) => {
      const user = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Usuário');
      if ((user.points || 0) < cfg.pointsPerRedeem)
        fail(409, 'not_enough_points', `Você precisa de ${cfg.pointsPerRedeem} pontos para trocar por ${brl(REDEEM_VALUE_CENTS / 100)}.`);
      user.points = (user.points || 0) - cfg.pointsPerRedeem;
      tx.update('users', user.uid, { points: user.points });
      this.credit(tx, user, REDEEM_VALUE_CENTS, `Bônus fidelidade (${cfg.pointsPerRedeem} pontos)`, 'bonus');
      this.platformRevenue(tx, 'fidelidade', 0, -REDEEM_VALUE_CENTS);
    });
    return { ok: true };
  }

  // ------------------------------------------------------- admin: usuários e relatórios

  async adminUsers(auth: AuthUser, search: unknown) {
    this.requireAdmin(auth);
    const q = text(search, 120).toLowerCase();
    // Busca por CPF: acha a conta dona daquele CPF.
    const byCpf = isValidCpf(q) ? await this.store.get<Doc>('cpf_index', cpfKey(onlyDigits(q))) : null;
    const users = byCpf?.uid
      ? ([await this.store.get<UserDoc>('users', String(byCpf.uid))].filter(Boolean) as UserDoc[])
      : q.includes('@')
        ? await this.store.query<UserDoc>('users', [['email', '==', q]], 5)
        : byNewest(await this.store.query<UserDoc>('users', [], 300)).slice(0, 100);
    return users
      .filter((u) => !q || byCpf || q.includes('@') || u.name.toLowerCase().includes(q) || String(u.phone).includes(q))
      .map((u) => ({
        uid: u.uid,
        name: u.name,
        email: u.email,
        phone: u.phone,
        createdAt: u.createdAt,
        balance: toReais(u.balanceCents),
        completedTrips: u.completedTrips,
        rating: round2(u.rating),
        passengerRating: round2(u.passengerRating ?? 5),
        driverStatus: u.driverStatus,
        truckerStatus: u.truckerStatus,
        blocked: Boolean(u.blocked),
        blockedReason: u.blockedReason || '',
        qualityAlert: u.qualityAlert || '',
        cpfStatus: u.cpfStatus || 'none',
        cpfMasked: u.cpfMasked || '',
        cpfSource: u.cpfSource || '',
        multiAccountFlag: u.multiAccountFlag || '',
        aiDocCheck: (u.aiDocCheck as never) || null,
        merchantStatus: u.merchantStatus || 'none',
      }));
  }

  async setBlocked(auth: AuthUser, uid: unknown, blocked: unknown, reason: unknown) {
    this.requireAdmin(auth);
    if (uid === auth.uid) fail(400, 'self', 'Você não pode bloquear a própria conta.');
    const user = (await this.store.get<UserDoc>('users', String(uid))) ?? fail(404, 'not_found', 'Usuário não encontrado.');
    const why = text(reason, 200);
    if (blocked === true && why.length < 5) fail(400, 'reason_required', 'Explique o motivo do bloqueio.');
    await this.store.update('users', user.uid, {
      blocked: blocked === true,
      blockedReason: blocked === true ? why : '',
      driverOnline: blocked === true ? false : user.driverOnline,
    });
    // Bloqueio vale para a PESSOA: o CPF também fica bloqueado (não adianta criar conta nova).
    if (user.cpfKey) await this.store.update('cpf_index', user.cpfKey, { blocked: blocked === true }).catch(() => undefined);
    await this.audit(auth, blocked === true ? 'usuario_bloqueado' : 'usuario_desbloqueado', user.uid, { reason: why, email: user.email });
    return { ok: true };
  }

  async adminReports(auth: AuthUser, days: unknown = 30) {
    this.requireAdmin(auth);
    const period = Math.round(num(days ?? 30, 1, 365, 'dias'));
    const since = new Date(this.now().getTime() - period * 864e5).toISOString();
    const entries = (await this.store.query<Doc>('platformLedger', [], 20000)).filter((e) => String(e.createdAt) >= since);
    const byKind: Record<string, { count: number; gross: number; fee: number }> = {};
    for (const e of entries) {
      const k = String(e.kind);
      byKind[k] ??= { count: 0, gross: 0, fee: 0 };
      if (Number(e.grossCents) > 0) byKind[k].count += 1;
      byKind[k].gross += Number(e.grossCents);
      byKind[k].fee += Number(e.feeCents);
    }
    const online = await this.store.query<UserDoc>('users', [['driverOnline', '==', true]], 1000);
    const total = Object.values(byKind).reduce((a, k) => ({ gross: a.gross + k.gross, fee: a.fee + k.fee, count: a.count + k.count }), { gross: 0, fee: 0, count: 0 });
    return {
      days: period,
      completedServices: total.count,
      grossVolume: toReais(total.gross),
      platformRevenue: toReais(total.fee),
      driversOnline: online.length,
      byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { count: v.count, gross: toReais(v.gross), fee: toReais(v.fee) }])),
    };
  }

  // ------------------------------------------- consultas da Equipe IA (somente administração)

  /** Ficha completa de um usuário: dados, carteira e últimos serviços. */
  async adminUserDetail(auth: AuthUser, uid: unknown) {
    this.requireAdmin(auth);
    const user = (await this.store.get<UserDoc>('users', String(uid))) ?? fail(404, 'not_found', 'Usuário não encontrado.');
    const [tx, ridesP, ridesD, sos, withdrawals] = await Promise.all([
      this.transactions(user.uid),
      this.store.query<Doc>('rides', [['passengerId', '==', user.uid]], 100),
      this.store.query<Doc>('rides', [['driverId', '==', user.uid]], 100),
      this.store.query<Doc>('sos', [['uid', '==', user.uid]], 50),
      this.store.query<Doc>('withdrawals', [['uid', '==', user.uid]], 50),
    ]);
    const { driverDocs: _d, truckerDocs: _t, ...safe } = user;
    return {
      user: { ...safe, balance: toReais(user.balanceCents) },
      wallet: tx.slice(0, 30),
      rides: byNewest([...ridesP, ...ridesD]).slice(0, 20).map((r) => ({
        id: r.id,
        status: r.status,
        papel: r.passengerId === user.uid ? 'passageiro' : 'motorista',
        de: (r.origin as GeoPoint | undefined)?.name,
        para: (r.destination as GeoPoint | undefined)?.name,
        preco: r.price,
        criadaEm: r.createdAt,
      })),
      sos: byNewest(sos).slice(0, 10),
      withdrawals: byNewest(withdrawals).slice(0, 10).map((w) => ({ id: w.id, status: w.status, valor: toReais(Number(w.amountCents)), createdAt: w.createdAt })),
    };
  }

  /** Últimos pedidos de cada serviço (para a equipe enxergar o movimento). */
  async adminRecentActivity(auth: AuthUser, limit = 15) {
    this.requireAdmin(auth);
    const pick = async (col: string) =>
      byNewest(await this.store.query<Doc>(col, [], 300))
        .slice(0, limit)
        .map((d) => ({
          id: d.id,
          status: d.status,
          de: (d.origin as GeoPoint | undefined)?.name,
          para: (d.destination as GeoPoint | undefined)?.name,
          valor: d.price ?? d.pricePerSeat ?? d.proposedBudget ?? d.emptyReturnPrice,
          criadoEm: d.createdAt,
        }));
    const [rides, indrive, carpools, emptyTrucks, freights] = await Promise.all(['rides', 'indrive', 'carpools', 'emptyTrucks', 'freights'].map(pick));
    return { corridas: rides, negociacoes: indrive, caronas: carpools, veiculosVazios: emptyTrucks, fretes: freights };
  }

  // ------------------------------------- mapa: carros por perto (estilo Uber)

  /**
   * Motoristas online perto de um ponto. A posição vai levemente deslocada (até ~130 m, fixa
   * por motorista no dia) para ninguém descobrir onde um motorista mora ou para; o id também
   * é anônimo. Uma consulta ao banco a cada 8 s serve todos os passageiros da instância.
   */
  async nearbyDrivers(auth: AuthUser, latValue: unknown, lngValue: unknown): Promise<{ drivers: NearbyDriver[] }> {
    const lat = num(latValue, -34.5, 5.9, 'latitude');
    const lng = num(lngValue, -74.5, -28.5, 'longitude');
    if (Date.now() - this.onlineCache.at > 8000) {
      this.onlineCache = { at: Date.now(), users: await this.store.query<UserDoc>('users', [['driverOnline', '==', true]], 500) };
    }
    const nowMs = this.now().getTime();
    const day = this.iso().slice(0, 10);
    const drivers = this.onlineCache.users
      .filter(
        (u) =>
          u.uid !== auth.uid &&
          !u.blocked &&
          typeof u.driverLat === 'number' &&
          typeof u.driverLng === 'number' &&
          nowMs - Date.parse(String(u.locationAt || 0)) < LOCATION_FRESH_MS &&
          (u.driverStatus === 'approved' || u.truckerStatus === 'approved'),
      )
      .map((u) => ({ u, km: straightKm({ lat, lng }, { lat: u.driverLat!, lng: u.driverLng! }) }))
      .filter((x) => x.km <= 6)
      .sort((a, b) => a.km - b.km)
      .slice(0, 20)
      .map(({ u }) => {
        const h = createHash('sha256').update(`${u.uid}:${day}`).digest();
        return {
          id: h.toString('hex').slice(0, 12),
          lat: round6(u.driverLat! + (h[0] / 255 - 0.5) * 0.0024),
          lng: round6(u.driverLng! + (h[1] / 255 - 0.5) * 0.0024),
          heading: typeof u.driverHeading === 'number' ? u.driverHeading : null,
          kind: (u.driverStatus === 'approved' ? (u.driverVehicleType === 'moto' ? 'moto' : 'carro') : 'carga') as NearbyDriver['kind'],
        };
      });
    return { drivers };
  }

  // ---------------------------------- compartilhar a viagem (link público)

  async shareTrip(auth: AuthUser, kind: unknown, refId: string) {
    if (kind !== 'ride' && kind !== 'indrive') return fail(400, 'invalid_kind', 'Tipo de viagem inválido.');
    const trip = (await this.store.get<Doc>(kind === 'ride' ? 'rides' : 'indrive', refId)) ?? fail(404, 'not_found', 'Viagem não encontrada.');
    if (trip.passengerId !== auth.uid && trip.driverId !== auth.uid) fail(403, 'forbidden', 'Você não participa desta viagem.');
    if (['completed', 'cancelled'].includes(String(trip.status))) fail(409, 'trip_ended', 'Esta viagem já terminou.');
    const nowIso = this.iso();
    const existing = (await this.store.query<Doc>('shares', [['refId', '==', refId]], 30)).find(
      (x) => x.createdBy === auth.uid && String(x.expiresAt) > nowIso,
    );
    if (existing) return { token: String(existing.id), path: `/acompanhar/${existing.id}`, expiresAt: String(existing.expiresAt) };
    return this.newShare(kind, refId, auth.uid);
  }

  private async newShare(kind: 'ride' | 'indrive', refId: string, createdBy: string, token = randomBytes(18).toString('base64url')) {
    const expiresAt = new Date(this.now().getTime() + SHARE_TTL_MS).toISOString();
    await this.store.set('shares', token, { id: token, kind, refId, createdBy, createdAt: this.iso(), expiresAt });
    return { token, path: `/acompanhar/${token}`, expiresAt };
  }

  /** O que aparece para quem abriu o link (sem login): nada de telefone, e-mail ou valores. */
  async trackShare(token: string): Promise<TrackView> {
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) fail(404, 'not_found', 'Link de acompanhamento inválido.');
    const share = await this.store.get<Doc>('shares', token);
    const nowMs = this.now().getTime();
    if (!share || Date.parse(String(share.expiresAt)) < nowMs) fail(410, 'expired', 'Este link de acompanhamento expirou.');
    const kind = share!.kind === 'indrive' ? 'indrive' : 'ride';
    const trip = (await this.store.get<Doc>(kind === 'ride' ? 'rides' : 'indrive', String(share!.refId))) ?? fail(404, 'not_found', 'Viagem não encontrada.');
    const status = String(trip.status);
    const ended = status === 'completed' || status === 'cancelled';
    const endedAt = Date.parse(String(trip.completedAt || trip.cancelledAt || ''));
    if (ended && Number.isFinite(endedAt) && nowMs - endedAt > SHARE_AFTER_END_MS) fail(410, 'expired', 'Esta viagem terminou e o link expirou.');
    const delivery = trip.delivery as Doc | undefined;
    let driver: TrackView['driver'] = null;
    if (kind === 'ride' && trip.driverName)
      driver = { firstName: firstName(trip.driverName), vehicle: String(trip.vehicleModel || ''), plate: String(trip.vehiclePlate || ''), rating: Number(trip.driverRating) || null };
    if (kind === 'indrive' && trip.acceptedOfferId) {
      const offer = ((trip.offers as Doc[]) || []).find((o) => o.id === trip.acceptedOfferId);
      if (offer) driver = { firstName: firstName(offer.driverName), vehicle: String(offer.vehicleModel || ''), plate: String(offer.vehiclePlate || ''), rating: Number(offer.driverRating) || null };
    }
    const RIDE_LABEL: Record<string, string> = {
      searching: 'Procurando motorista',
      accepted: 'Motorista a caminho do embarque',
      arriving: 'Motorista no local de embarque',
      in_progress: 'Em viagem',
      completed: 'Viagem concluída',
      cancelled: 'Viagem cancelada',
      open: 'Aguardando propostas de motoristas',
      matched: 'Motorista confirmado · a caminho ou em viagem',
    };
    const statusLabel = delivery ? DELIVERY_STATUS[status]?.[1] || status : RIDE_LABEL[status] || status;
    const point = (p: unknown) => {
      const g = (p || {}) as Doc;
      return { name: String(g.name || ''), lat: Number(g.lat), lng: Number(g.lng) };
    };
    const loc = trip.driverLocation as TrackView['location'] | undefined;
    return {
      kind: delivery ? 'delivery' : kind,
      status,
      statusLabel,
      active: !ended,
      categoryLabel: String(trip.categoryLabel || (kind === 'indrive' ? 'Corrida negociada' : 'Corrida')),
      origin: point(trip.origin),
      destination: point(trip.destination),
      passengerFirstName: delivery ? firstName(delivery.recipientName) : firstName(trip.passengerName),
      driver,
      location: !ended && loc ? { lat: Number(loc.lat), lng: Number(loc.lng), at: String(loc.at), ...(typeof loc.heading === 'number' ? { heading: loc.heading } : {}) } : null,
      merchantName: delivery ? String(delivery.merchantName || '') : undefined,
      updatedAt: String(loc?.at || trip.updatedAt || trip.createdAt || ''),
      expiresAt: String(share!.expiresAt),
    };
  }

  // ------------------------------- gravação da viagem (aviso para a outra parte)

  async recordingNotice(auth: AuthUser, kind: unknown, id: string, mode: unknown) {
    if (kind !== 'ride' && kind !== 'indrive') return fail(400, 'invalid_kind', 'Tipo de viagem inválido.');
    const col = kind === 'ride' ? 'rides' : 'indrive';
    const value = mode === 'audio' || mode === 'video' ? { mode, at: this.iso() } : null;
    await this.store.transaction(async (tx) => {
      const trip = await this.mustGet<Doc>(tx, col, id, 'Viagem');
      const isDriver = trip.driverId === auth.uid;
      if (trip.passengerId !== auth.uid && !isDriver) fail(403, 'forbidden', 'Você não participa desta viagem.');
      if (value && ['completed', 'cancelled', 'searching', 'open'].includes(String(trip.status))) fail(409, 'invalid_state', 'Só dá para gravar durante a viagem.');
      const who = isDriver ? 'driver' : 'passenger';
      const patch: Doc = { recording: { ...((trip.recording as Doc) || {}), [who]: value } };
      if (kind === 'ride' && value) {
        const messages = Array.isArray(trip.messages) ? (trip.messages as unknown[]) : [];
        const time = this.now().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const textMsg = `🔴 Aviso automático: ${isDriver ? 'o motorista' : 'o passageiro'} começou a gravar ${mode === 'video' ? 'em vídeo' : 'o áudio de'} esta viagem pelo próprio celular, por segurança. O arquivo fica só no aparelho dele.`;
        patch.messages = [...messages, { sender: who, text: textMsg, time }].slice(-200);
      }
      tx.update(col, id, patch);
    });
    return { ok: true };
  }

  // ---------------------------------------------- Froc Entregas (lojas)

  private deliveryPrice(distanceKm: number, surge: number) {
    const cat = RIDE_CATEGORIES.find((c) => c.id === 'froc_delivery')!;
    const durationMin = estimateDurationMin(distanceKm, 'moto');
    return { durationMin, price: round2(Math.max(7.5, round2(cat.baseFare + distanceKm * cat.perKm + durationMin * cat.perMin)) * surge) };
  }

  /** Ponto vindo da API/painel: com coordenadas, ou só endereço (se houver geocodificação). */
  private async deliveryPoint(raw: unknown, label: string): Promise<GeoPoint> {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Doc;
    const address = text(p.address ?? p.name, 160);
    const lat = Number(p.lat ?? p.latitude);
    const lng = Number(p.lng ?? p.longitude);
    if (p.lat !== undefined || p.latitude !== undefined) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) fail(400, 'invalid_coordinates', `Latitude/longitude inválidas no ${label}.`);
      return resolvePoint({ id: text(p.id, 80), name: address || `Ponto ${lat.toFixed(5)}, ${lng.toFixed(5)}`, city: text(p.city, 80), state: text(p.state, 2), lat, lng, kind: 'avenue' }, null);
    }
    if (address.length < 5) fail(400, 'missing_address', `Informe o endereço do ${label}.`);
    if (!this.deps.geocode) fail(400, 'missing_coordinates', `Envie latitude e longitude do ${label} (a busca por endereço não está ativada).`);
    const g = await this.deps.geocode!(address);
    if (!g) fail(400, 'address_not_found', `Não encontrei o endereço do ${label}. Confira rua, número e cidade.`);
    return resolvePoint({ name: g!.name || address, city: g!.city, state: g!.state, lat: g!.lat, lng: g!.lng, kind: 'avenue' }, null);
  }

  private async deliveryRoute(merchant: UserDoc, body: Record<string, unknown>) {
    const pickup = body.pickup ? await this.deliveryPoint(body.pickup, 'endereço de coleta') : (merchant.merchant?.pickup as GeoPoint | undefined) ?? fail(400, 'missing_pickup', 'Cadastre o endereço de coleta da loja.');
    const dropoff = await this.deliveryPoint(body.dropoff, 'endereço de entrega');
    const distanceKm = calculateDistanceKm(pickup, dropoff);
    if (distanceKm > 60) fail(400, 'too_far', 'Entregas de até 60 km. Para distâncias maiores, use Cargas.');
    const surge = await this.surgeAt(pickup.lat, pickup.lng);
    return { pickup, dropoff, distanceKm, surge, ...this.deliveryPrice(distanceKm, surge) };
  }

  async quoteDelivery(uid: string, body: Record<string, unknown>) {
    await this.settings();
    const merchant = await this.approvedMerchant(uid);
    const r = await this.deliveryRoute(merchant, body);
    return { price: r.price, currency: 'BRL', distanceKm: r.distanceKm, durationMin: r.durationMin, surge: r.surge, pickup: r.pickup, dropoff: r.dropoff };
  }

  async createDelivery(uid: string, body: Record<string, unknown>, source: 'painel' | 'api'): Promise<DeliveryView> {
    await this.settings();
    const merchant = await this.approvedMerchant(uid);
    const orderRef = text(body.orderRef, 60);
    // Mesmo pedido enviado duas vezes (rede instável, sistema repetindo) não gera duas entregas.
    if (orderRef) {
      const mine = await this.store.query<Doc>('rides', [['merchantId', '==', uid]], 500);
      const dup = mine.find((r) => (r.delivery as Doc | undefined)?.orderRef === orderRef && r.status !== 'cancelled');
      if (dup) return this.deliveryView(dup);
    }
    const rec = (body.recipient && typeof body.recipient === 'object' ? body.recipient : {}) as Doc;
    const recipientName = text(rec.name, 80);
    const recipientPhone = text(rec.phone, 30);
    if (recipientName.length < 2) fail(400, 'invalid_recipient', 'Informe o nome de quem recebe.');
    if (recipientPhone.replace(/\D/g, '').length < 10) fail(400, 'invalid_recipient_phone', 'Informe o telefone de quem recebe, com DDD.');
    const vehicle = body.vehicle === 'moto' || body.vehicle === 'carro' ? body.vehicle : 'qualquer';
    const route = await this.deliveryRoute(merchant, body);
    const priceCents = toCents(route.price);
    const deliveryFee = await this.feeForAgreedPrice(route.price, route.pickup, route.distanceKm);
    const id = randomUUID();
    const nowIso = this.iso();
    const share = { token: randomBytes(18).toString('base64url') };
    const m = merchant.merchant || {};
    const ride = await this.store.transaction(async (tx) => {
      const payer = await this.mustGet<UserDoc>(tx, 'users', uid, 'Loja');
      this.debit(tx, payer, priceCents, `Froc Entregas · ${recipientName}${orderRef ? ` · pedido ${orderRef}` : ''} · valor retido`, 'entrega');
      const doc: Doc = {
        id,
        passengerId: uid,
        merchantId: uid,
        passengerName: String(m.companyName || merchant.name),
        passengerRating: round2(merchant.passengerRating ?? 5),
        origin: route.pickup,
        destination: route.dropoff,
        stops: [],
        categoryId: 'froc_delivery',
        categoryLabel: 'Froc Entregas',
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
        price: route.price,
        priceCents,
        discountApplied: 0,
        surgeMultiplier: route.surge,
        originCell: this.geo.cellOf(route.pickup.lat, route.pickup.lng),
        paymentMethod: 'froc_pay',
        platformFeeCents: toCents(deliveryFee.fee),
        driverEarning: round2(route.price - deliveryFee.fee),
        pinCode: '',
        deliveryPin: String(randomInt(1000, 10000)),
        trackToken: share.token,
        status: 'searching',
        escrowCents: priceCents,
        createdAt: nowIso,
        updatedAt: nowIso,
        messages: [],
        delivery: {
          merchantName: String(m.companyName || merchant.name),
          recipientName,
          recipientPhone,
          note: text(body.note, 300),
          orderRef,
          items: text(body.items, 300),
          vehicle,
          source,
        },
      };
      tx.set('rides', id, doc);
      return doc;
    });
    await this.newShare('ride', id, uid, share.token);
    await this.deliveryEvent(ride);
    return this.deliveryView(ride);
  }

  deliveryView(r: Doc): DeliveryView {
    const d = (r.delivery || {}) as Doc;
    const [status, statusLabel] = DELIVERY_STATUS[String(r.status)] || ['procurando_entregador', String(r.status)];
    const point = (p: unknown) => {
      const g = (p || {}) as Doc;
      return { name: String(g.name || ''), lat: Number(g.lat), lng: Number(g.lng) };
    };
    const active = ACTIVE_RIDE.includes(String(r.status));
    return {
      id: String(r.id),
      status,
      statusLabel,
      price: Number(r.price),
      distanceKm: Number(r.distanceKm),
      deliveryCode: String(r.deliveryPin || ''),
      trackingPath: r.trackToken ? `/acompanhar/${r.trackToken}` : '',
      orderRef: String(d.orderRef || ''),
      pickup: point(r.origin),
      dropoff: point(r.destination),
      recipient: { name: String(d.recipientName || ''), phone: String(d.recipientPhone || '') },
      note: String(d.note || ''),
      vehicle: (d.vehicle as DeliveryView['vehicle']) || 'qualquer',
      courier: r.driverName
        ? {
            firstName: firstName(r.driverName),
            vehicle: String(r.vehicleModel || ''),
            plate: String(r.vehiclePlate || ''),
            location: active && r.driverLocation ? (r.driverLocation as { lat: number; lng: number; at: string }) : null,
          }
        : null,
      createdAt: String(r.createdAt || ''),
      updatedAt: String(r.completedAt || r.cancelledAt || r.startedAt || r.acceptedAt || r.updatedAt || r.createdAt || ''),
      source: d.source === 'api' ? 'api' : 'painel',
    };
  }

  async listDeliveries(uid: string, status?: unknown) {
    await this.approvedMerchant(uid);
    const all = byNewest(await this.store.query<Doc>('rides', [['merchantId', '==', uid]], 500)).map((r) => this.deliveryView(r));
    return { deliveries: (status ? all.filter((d) => d.status === status) : all).slice(0, 100) };
  }

  async getDelivery(uid: string, id: string) {
    const r = await this.store.get<Doc>('rides', id);
    if (!r || r.merchantId !== uid) fail(404, 'not_found', 'Entrega não encontrada.');
    return this.deliveryView(r!);
  }

  async cancelDelivery(uid: string, id: string) {
    await this.getDelivery(uid, id);
    await this.rideAction({ uid, email: '', emailVerified: true }, id, { action: 'cancel' });
    return this.getDelivery(uid, id);
  }

  /** Avisa o sistema da loja (webhook) quando a entrega muda de situação. */
  private async deliveryEvent(ride: Doc) {
    if (!this.deps.webhooks || !ride.merchantId) return;
    const EVENTS: Record<string, string> = {
      searching: 'delivery.created',
      accepted: 'delivery.courier_assigned',
      arriving: 'delivery.courier_at_pickup',
      in_progress: 'delivery.picked_up',
      completed: 'delivery.delivered',
      cancelled: 'delivery.cancelled',
    };
    const event = EVENTS[String(ride.status)];
    if (!event) return;
    await this.deps.webhooks.emit(String(ride.merchantId), event, this.deliveryView(ride) as unknown as Record<string, unknown>).catch((e) => console.warn('Aviso de entrega falhou:', e));
  }

  // ------------------------------------------------------------ visão geral

  /**
   * Despacho por região (H3): com a localização do motorista em dia, ele vê só os pedidos
   * da região dele (~3,5 km). Sem localização, vê todos (para não ficar sem corridas).
   */
  private nearby(user: UserDoc, rides: Doc[]): Doc[] {
    const fresh = user.driverCell && this.now().getTime() - Date.parse(String(user.locationAt || 0)) < LOCATION_FRESH_MS;
    if (!fresh) return rides;
    const area = new Set(this.geo.ring(user.driverCell!, DISPATCH_RING));
    return rides.filter((r) => !r.originCell || area.has(String(r.originCell)));
  }

  async bootstrap(auth: AuthUser) {
    await this.settings();
    await this.sweep().catch((e) => console.warn('Varredura de prazos falhou:', e));
    const user = await this.ensureUser(auth);
    const uid = auth.uid;
    const isDriver = user.driverStatus === 'approved';
    const isTrucker = user.truckerStatus === 'approved';
    const isMerchant = user.merchantStatus === 'approved';
    const q = (col: string, field: string, value: unknown, limit = 100) => this.store.query<Doc>(col, [[field, '==', value]], limit);

    const [
      myRides,
      drivingRides,
      queueRides,
      myInDrive,
      drivingInDrive,
      openInDrive,
      openCarpools,
      myCarpools,
      myBookings,
      availableTrucks,
      myTrucks,
      reservedTrucks,
      myFreights,
      wonFreights,
      openFreights,
      transactions,
      merchantDeliveries,
    ] = await Promise.all([
      q('rides', 'passengerId', uid),
      isDriver ? q('rides', 'driverId', uid) : [],
      isDriver && user.driverOnline ? q('rides', 'status', 'searching', 30) : [],
      q('indrive', 'passengerId', uid),
      isDriver ? q('indrive', 'driverId', uid) : [],
      isDriver ? q('indrive', 'status', 'open', 30) : [],
      q('carpools', 'status', 'open', 60),
      isDriver ? q('carpools', 'driverId', uid) : [],
      q('carpoolBookings', 'passengerId', uid, 300),
      q('emptyTrucks', 'status', 'available', 60),
      isTrucker ? q('emptyTrucks', 'truckerId', uid) : [],
      q('emptyTrucks', 'reservedById', uid),
      q('freights', 'clientId', uid),
      isTrucker ? q('freights', 'acceptedTruckerId', uid) : [],
      isTrucker ? q('freights', 'status', 'open_bids', 40) : [],
      this.transactions(uid),
      isMerchant ? q('rides', 'merchantId', uid, 200) : [],
    ]);

    const bookedTripIds = new Set(myBookings.filter((b) => b.status === 'paid').map((b) => String(b.tripId)));
    const bookedTrips = (
      await Promise.all([...bookedTripIds].filter((id) => !openCarpools.some((c) => c.id === id)).map((id) => this.store.get<Doc>('carpools', id)))
    ).filter(Boolean) as Doc[];
    const driverTripBookings = new Map<string, Doc[]>();
    await Promise.all(
      (myCarpools as Doc[]).filter((c) => c.status === 'open').map(async (c) =>
        driverTripBookings.set(String(c.id), await q('carpoolBookings', 'tripId', c.id, 50)),
      ),
    );

    const recent = <T extends Doc>(items: T[], keep: (i: T) => boolean) =>
      byNewest(uniqueById(items)).filter(keep).slice(0, 40);
    const notOld = (i: Doc) => !['completed', 'cancelled', 'delivered'].includes(String(i.status)) || String(i.createdAt) > new Date(this.now().getTime() - 30 * 864e5).toISOString();

    return {
      profile: this.profileView(user, auth),
      // Entregas da loja ficam no painel da loja (não aparecem como "minha corrida").
      rides: recent(
        [...myRides.filter((r) => !r.merchantId), ...drivingRides, ...this.nearby(user, queueRides).filter((r) => r.passengerId !== uid && this.vehicleFits(user, r))],
        notOld,
      ).map((r) => this.rideView(r, uid)),
      indriveRequests: recent([...myInDrive, ...drivingInDrive, ...openInDrive.filter((r) => r.passengerId !== uid)], notOld).map((r) => this.indriveView(r, uid)),
      carpools: recent([...openCarpools, ...myCarpools, ...bookedTrips], notOld).map((c) =>
        this.carpoolView(c, uid, myBookings, driverTripBookings.get(String(c.id))),
      ),
      emptyTrucks: recent([...availableTrucks, ...myTrucks, ...reservedTrucks], notOld).map((t) => this.truckView(t, uid)),
      freights: recent([...myFreights, ...wonFreights, ...openFreights.filter((f) => f.clientId !== uid)], notOld).map((f) => this.freightView(f, uid)),
      transactions,
      ...(isMerchant ? { deliveries: byNewest(merchantDeliveries as Doc[]).slice(0, 60).map((r) => this.deliveryView(r)) } : {}),
    };
  }
}
