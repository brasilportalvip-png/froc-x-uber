/**
 * Regras de negócio do Froc X Uber (as 4 modalidades + carteira + administração).
 *
 * Princípios:
 * - Cada pessoa só vê e mexe no que é dela; motorista/caminhoneiro só atua depois de aprovado.
 * - Dinheiro em centavos inteiros. Pagamento pela carteira fica RETIDO (custódia) quando o
 *   pedido é confirmado e só vai para o motorista (88%) quando o serviço é concluído.
 *   Cancelamento devolve o valor retido.
 * - Toda mudança de dinheiro acontece dentro de uma transação (lê tudo, depois grava).
 * - Nada é simulado: sem motorista inventado, sem saldo inventado, sem pagamento sem cobrança.
 */
import { randomUUID, randomInt } from 'node:crypto';
import { BRAZIL_LOCATIONS, calculateDistanceKm, estimateDurationMin, RIDE_CATEGORIES } from '../src/data/locations.ts';
import type {
  AdminOverview,
  ApprovalStatus,
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
const TRUCK_TYPES: TruckType[] = ['VUC / Utilitário', '3/4 Baú', 'Toco Aberto', 'Truck Baú', 'Carreta Sider'];
const DOC_TYPES = { driver: ['cnh', 'crlv'], trucker: ['cnh', 'crlv', 'antt'] } as const;
const ALLOWED_DOC_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const MAX_DOC_BYTES = 3 * 1024 * 1024;

export interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

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
}

export interface ServiceDeps {
  now?: () => Date;
  payments?: PaymentsGateway;
  files?: FileStorage;
  adminEmails?: string[];
  /** Índice geográfico (H3 em produção; grade simples nos testes). */
  geo?: GeoIndex;
}

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

function paymentMethod(value: unknown): PaymentMethod {
  if (value === 'froc_pay' || value === 'cash') return value;
  return fail(400, 'invalid_payment', 'Escolha Carteira Froc (Pix/cartão) ou dinheiro.');
}

/** Aceita um ponto do mapa (lat/lng reais do Google) ou um local da lista. */
export function resolvePoint(point: unknown, fallbackId: unknown): GeoPoint {
  if (point && typeof point === 'object') {
    const p = point as Record<string, unknown>;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && typeof p.name === 'string') {
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

export class FrocService {
  store: Store;
  deps: ServiceDeps;
  geo: GeoIndex;
  private cfg: PlatformSettings = { ...DEFAULT_SETTINGS };
  private cfgLoadedAt = 0;
  private lastSweep = 0;

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
    const list = (this.deps.adminEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
    return auth.emailVerified && list.includes(auth.email.toLowerCase());
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
    };
  }

  async updateProfile(auth: AuthUser, patch: Record<string, unknown>) {
    const user = await this.ensureUser(auth);
    const next: Partial<UserDoc> = {};
    if ('name' in patch) next.name = text(patch.name, 80) || user.name;
    if ('phone' in patch) next.phone = text(patch.phone, 30);
    if ('city' in patch) next.city = text(patch.city, 80);
    if ('driverOnline' in patch) {
      if (patch.driverOnline === true && user.driverStatus !== 'approved' && user.truckerStatus !== 'approved')
        fail(403, 'not_approved', 'Seu cadastro de motorista ainda não foi aprovado.');
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

  /** Paga o prestador (100% menos a comissão) e registra o serviço concluído para os dois lados. */
  private payProvider(tx: Tx, provider: UserDoc, client: UserDoc | null, escrowCents: number, method: PaymentMethod, title: string, kind = 'corrida') {
    const pct = this.cfg.commissionPercent;
    if (method === 'froc_pay' && escrowCents > 0) {
      this.credit(tx, provider, this.providerCut(escrowCents), `Ganho · ${title} (${100 - pct}% líquido)`, 'ganho_motorista');
    } else if (method === 'cash' && escrowCents > 0 && pct > 0) {
      // Recebeu em dinheiro: a comissão da plataforma é descontada da carteira.
      this.debit(tx, provider, escrowCents - this.providerCut(escrowCents), `Taxa Froc ${pct}% · ${title} (pago em dinheiro)`, 'taxa', true);
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
      title: String(t.title),
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
    const checkout = await payments!.createCheckout({
      reference: id,
      amountCents,
      title: 'Recarga Carteira Froc X Uber',
      payerEmail: user.email,
    });
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

  async requestWithdrawal(auth: AuthUser, amountReais: unknown, pixKey: unknown) {
    await this.anyProvider(auth);
    const amountCents = toCents(num(amountReais, MIN_WITHDRAWAL_CENTS / 100, 50000, 'saque'));
    const key = text(pixKey, 120);
    if (key.length < 5) fail(400, 'invalid_pix_key', 'Informe a chave Pix para receber o saque.');
    const id = randomUUID();
    await this.store.transaction(async (tx) => {
      const user = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Usuário');
      this.debit(tx, user, amountCents, `Saque solicitado · Pix ${key}`, 'saque');
      tx.set('withdrawals', id, { id, uid: user.uid, name: user.name, amountCents, pixKey: key, status: 'pending', createdAt: this.iso() });
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
    const path = `documentos/${user.uid}/${kind}-${docType}-${this.now().getTime()}.${ext}`;
    await this.deps.files!.save(path, String(contentType), new Uint8Array(bytes));
    const field = kind === 'driver' ? 'driverDocs' : 'truckerDocs';
    await this.store.update('users', user.uid, { [field]: { ...(user[field] as Record<string, string>), [String(docType)]: path } });
    return { ok: true };
  }

  async applyAsProvider(auth: AuthUser, kind: unknown, body: Record<string, unknown>) {
    if (kind !== 'driver' && kind !== 'trucker') return fail(400, 'invalid_kind', 'Tipo de cadastro inválido.');
    const user = await this.ensureUser(auth);
    const status = kind === 'driver' ? user.driverStatus : user.truckerStatus;
    if (status === 'approved') fail(409, 'already_approved', 'Cadastro já aprovado.');
    const docs = (kind === 'driver' ? user.driverDocs : user.truckerDocs) || {};
    const missing = DOC_TYPES[kind].filter((d) => !docs[d]);
    if (missing.length) fail(400, 'missing_documents', 'Envie todos os documentos: ' + missing.join(', ').toUpperCase() + '.');
    const phone = text(body.phone, 30) || user.phone;
    if (phone.replace(/\D/g, '').length < 10) fail(400, 'invalid_phone', 'Informe um telefone com DDD.');
    const vehicle = text(body.vehicle, 80);
    const plate = text(body.plate, 10).toUpperCase();
    if (vehicle.length < 3) fail(400, 'invalid_vehicle', 'Informe o modelo e a cor do veículo.');
    if (!/^[A-Z]{3}-?[0-9][A-Z0-9][0-9]{2}$/.test(plate)) fail(400, 'invalid_plate', 'Placa inválida (ex.: ABC1D23).');
    const next: Partial<UserDoc> = { phone, rejectionReason: '' };
    if (kind === 'driver') Object.assign(next, { driverVehicle: vehicle, driverPlate: plate, driverStatus: 'pending', driverSubmittedAt: this.iso() });
    else {
      const truckType = TRUCK_TYPES.includes(body.truckType as TruckType) ? (body.truckType as TruckType) : fail(400, 'invalid_truck', 'Tipo de caminhão inválido.');
      Object.assign(next, {
        truckModel: vehicle,
        truckPlate: plate,
        truckType,
        companyName: text(body.companyName, 80),
        truckerStatus: 'pending',
        truckerSubmittedAt: this.iso(),
      });
    }
    await this.store.update('users', user.uid, next);
    return this.profileView({ ...user, ...next } as UserDoc, auth);
  }

  // ---------------------------------------------------------------- admin

  private requireAdmin(auth: AuthUser) {
    if (!this.isAdmin(auth)) fail(403, 'forbidden', 'Acesso restrito à administração.');
  }

  async adminOverview(auth: AuthUser): Promise<AdminOverview> {
    this.requireAdmin(auth);
    const [drivers, truckers, withdrawals, users, sos, settings] = await Promise.all([
      this.store.query<UserDoc>('users', [['driverStatus', '==', 'pending']], 100),
      this.store.query<UserDoc>('users', [['truckerStatus', '==', 'pending']], 100),
      this.store.query<Doc>('withdrawals', [['status', '==', 'pending']], 100),
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
        return {
          uid: u.uid,
          name: u.name,
          email: u.email,
          phone: u.phone,
          kind,
          vehicle: kind === 'driver' ? u.driverVehicle : u.truckModel,
          plate: kind === 'driver' ? u.driverPlate : u.truckPlate,
          truckType: kind === 'trucker' ? u.truckType : undefined,
          companyName: kind === 'trucker' ? u.companyName : undefined,
          submittedAt: String((kind === 'driver' ? u.driverSubmittedAt : u.truckerSubmittedAt) ?? ''),
          documents: await Promise.all(Object.entries(docs).map(async ([type, path]) => ({ type, url: await signed(path) }))),
        };
      }),
    );
    return {
      applications,
      withdrawals: byNewest(withdrawals).map((w) => ({
        id: String(w.id),
        uid: String(w.uid),
        name: String(w.name),
        amount: toReais(Number(w.amountCents)),
        pixKey: String(w.pixKey),
        status: w.status as 'pending',
        createdAt: String(w.createdAt),
      })),
      totals: { users, pendingApplications: applications.length, pendingWithdrawals: withdrawals.length, openSos: sos.length },
      sos: byNewest(sos) as unknown as AdminOverview['sos'],
      settings,
    };
  }

  async reviewApplication(auth: AuthUser, uid: unknown, kind: unknown, decision: unknown, reason: unknown) {
    this.requireAdmin(auth);
    if (kind !== 'driver' && kind !== 'trucker') return fail(400, 'invalid_kind', 'Tipo de cadastro inválido.');
    if (decision !== 'approved' && decision !== 'rejected') return fail(400, 'invalid_decision', 'Decisão inválida.');
    const user = (await this.store.get<UserDoc>('users', String(uid))) ?? fail(404, 'not_found', 'Usuário não encontrado.');
    const field = kind === 'driver' ? 'driverStatus' : 'truckerStatus';
    if (user[field] !== 'pending') fail(409, 'not_pending', 'Este cadastro não está aguardando análise.');
    const why = text(reason, 300);
    if (decision === 'rejected' && why.length < 5) fail(400, 'reason_required', 'Explique o motivo da recusa.');
    await this.store.update('users', user.uid, {
      [field]: decision,
      rejectionReason: decision === 'rejected' ? why : '',
      reviewedBy: auth.email,
      reviewedAt: this.iso(),
    });
    return { ok: true };
  }

  async resolveWithdrawal(auth: AuthUser, id: unknown, decision: unknown) {
    this.requireAdmin(auth);
    if (decision !== 'paid' && decision !== 'rejected') return fail(400, 'invalid_decision', 'Decisão inválida.');
    await this.store.transaction(async (tx) => {
      const w = await this.mustGet<Doc>(tx, 'withdrawals', String(id), 'Saque');
      if (w.status !== 'pending') fail(409, 'not_pending', 'Este saque já foi resolvido.');
      const user = await this.mustGet<UserDoc>(tx, 'users', String(w.uid), 'Usuário');
      tx.update('withdrawals', String(id), { status: decision, resolvedBy: auth.email, resolvedAt: this.iso() });
      if (decision === 'rejected') this.credit(tx, user, Number(w.amountCents), 'Saque recusado · valor devolvido', 'estorno');
    });
    return { ok: true };
  }

  // ------------------------------------------------------- 1) corrida Uber/99

  private rideView(r: Doc, uid: string): RideOrder {
    const mine = involvement(uid, r.passengerId, r.driverId);
    const { escrowCents: _e, priceCents: _p, ...rest } = r;
    return {
      ...(rest as unknown as RideOrder),
      mine,
      pinCode: mine === 'owner' ? String(r.pinCode) : '',
    };
  }

  async createRide(auth: AuthUser, body: Record<string, unknown>) {
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const category = RIDE_CATEGORIES.find((c) => c.id === body.categoryId) ?? fail(400, 'invalid_category', 'Categoria inválida.');
    const method = paymentMethod(body.paymentMethod);
    const distanceKm = calculateDistanceKm(origin, destination);
    if (distanceKm > 300) fail(400, 'too_far', 'Para viagens longas, use Caronas.');
    const durationMin = estimateDurationMin(distanceKm, category.id === 'froc_moto' ? 'moto' : 'urban');
    const surge = await this.surgeAt(origin.lat, origin.lng);
    const basePrice = Math.max(7.5, round2(category.baseFare + distanceKm * category.perKm + durationMin * category.perMin));
    const price = round2(basePrice * surge);
    const priceCents = toCents(price);
    const active = await this.store.query<Doc>('rides', [['passengerId', '==', auth.uid]], 200);
    if (active.some((r) => ['searching', 'accepted', 'arriving', 'in_progress'].includes(String(r.status))))
      fail(409, 'ride_in_progress', 'Você já tem uma corrida em andamento.');
    const id = randomUUID();
    const ride = await this.store.transaction(async (tx) => {
      const user = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Usuário');
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
        originCell: this.geo.cellOf(origin.lat, origin.lng),
        paymentMethod: method,
        pinCode: String(randomInt(1000, 10000)),
        status: 'searching',
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
    const result = await this.store.transaction(async (tx) => {
      const ride = await this.mustGet<Doc>(tx, 'rides', rideId, 'Corrida');
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
          set({ status: 'arriving', etaMin: 0 });
          return { ride };
        }
        case 'start': {
          if (!isDriver) fail(403, 'forbidden', 'Só o motorista da corrida pode iniciar.');
          if (status !== 'accepted' && status !== 'arriving') fail(409, 'invalid_state', 'A corrida não pode ser iniciada agora.');
          if (String(body.pin || '') !== String(ride.pinCode)) fail(400, 'wrong_pin', 'PIN incorreto. Peça o PIN de 4 dígitos ao passageiro.');
          set({ status: 'in_progress', etaMin: ride.durationMin, startedAt: this.iso() });
          return { ride };
        }
        case 'complete': {
          if (!isDriver) fail(403, 'forbidden', 'Só o motorista pode finalizar a corrida.');
          if (status !== 'in_progress') fail(409, 'invalid_state', 'A corrida ainda não foi iniciada.');
          const driver = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Motorista');
          const passenger = await tx.get<UserDoc>('users', String(ride.passengerId));
          const amount = ride.paymentMethod === 'froc_pay' ? Number(ride.escrowCents) : Number(ride.priceCents);
          set({ status: 'completed', etaMin: 0, completedAt: this.iso(), escrowCents: 0 });
          this.payProvider(tx, driver, passenger, amount, ride.paymentMethod as PaymentMethod, String(ride.categoryLabel), 'corrida');
          return { ride };
        }
        case 'cancel': {
          if (isPassenger) {
            if (!['searching', 'accepted', 'arriving'].includes(status)) fail(409, 'invalid_state', 'Não é possível cancelar agora.');
            const passenger = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Passageiro');
            const escrow = Number(ride.escrowCents || 0);
            set({ status: 'cancelled', escrowCents: 0, cancelledAt: this.iso(), cancelledBy: 'passenger' });
            if (escrow > 0) this.credit(tx, passenger, escrow, `Estorno · ${ride.categoryLabel} cancelada`, 'estorno');
            return { ride };
          }
          if (isDriver) {
            if (!['accepted', 'arriving'].includes(status)) fail(409, 'invalid_state', 'Não é possível desistir agora.');
            // Motorista desistiu: a corrida volta para a fila dos outros motoristas.
            set({
              status: 'searching',
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
          tx.update('users', driver.uid, { rating, ratingCount: count + 1 });
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
    return this.rideView(result.ride, auth.uid);
  }

  // ------------------------------------------------- 2) negociação inDrive

  private indriveView(r: Doc, uid: string): InDriveRequest {
    const { escrowCents: _e, ...rest } = r;
    const mine = involvement(uid, r.passengerId, r.driverId);
    const offers = (Array.isArray(r.offers) ? r.offers : []) as Doc[];
    return {
      ...(rest as unknown as InDriveRequest),
      mine,
      // Motorista só vê a própria proposta; o passageiro vê todas.
      offers: (mine === 'owner' ? offers : offers.filter((o) => o.driverId === uid)) as unknown as InDriveRequest['offers'],
    };
  }

  async createInDrive(auth: AuthUser, body: Record<string, unknown>) {
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
      fail(402, 'insufficient_balance', 'Saldo insuficiente para essa oferta. Recarregue a carteira ou escolha dinheiro.');
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
    const req = await this.store.transaction(async (tx) => {
      const r = await this.mustGet<Doc>(tx, 'indrive', id, 'Pedido');
      if (r.passengerId !== auth.uid) fail(403, 'forbidden', 'Só quem fez o pedido pode aceitar.');
      if (r.status !== 'open') fail(409, 'closed', 'Este pedido não está mais aberto.');
      const offer = ((r.offers as Doc[]) || []).find((o) => o.id === offerId) ?? fail(400, 'invalid_offer', 'Proposta inválida.');
      const passenger = await this.mustGet<UserDoc>(tx, 'users', auth.uid, 'Passageiro');
      const cents = toCents(Number(offer.offeredPrice));
      const patch: Doc = {
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
      this.payProvider(tx, driver, passenger, amount, r.paymentMethod as PaymentMethod, 'Corrida negociada', 'indrive');
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
      const patch = { status: 'cancelled', escrowCents: 0, cancelledAt: this.iso() };
      Object.assign(r, patch);
      tx.update('indrive', id, patch);
      if (escrow > 0) this.credit(tx, passenger, escrow, 'Estorno · negociação cancelada', 'estorno');
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
          this.credit(tx, driver, this.providerCut(total), `Ganho · carona ${route} (${100 - this.cfg.commissionPercent}% líquido)`, 'ganho_motorista');
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

  async quoteRide(auth: AuthUser, body: Record<string, unknown>) {
    await this.ensureUser(auth);
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const surge = await this.surgeAt(origin.lat, origin.lng);
    return {
      surge,
      distanceKm,
      prices: RIDE_CATEGORIES.map((c) => {
        const durationMin = estimateDurationMin(distanceKm, c.id === 'froc_moto' ? 'moto' : 'urban');
        return { categoryId: c.id, price: round2(Math.max(7.5, round2(c.baseFare + distanceKm * c.perKm + durationMin * c.perMin)) * surge) };
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
    await this.store.update('users', user.uid, { driverLat: lat, driverLng: lng, driverCell: cell, locationAt: at });
    const location = { lat: round6(lat), lng: round6(lng), at };
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
      if (now - Date.parse(String(r.createdAt)) < cfg.rideSearchTimeoutMin * 60_000) continue;
      const done = await this.store.transaction(async (tx) => {
        const ride = await tx.get<Doc>('rides', String(r.id));
        if (!ride || ride.status !== 'searching') return false;
        const passenger = await tx.get<UserDoc>('users', String(ride.passengerId));
        const escrow = Number(ride.escrowCents || 0);
        tx.update('rides', String(r.id), { status: 'cancelled', escrowCents: 0, cancelledAt: this.iso(), cancelledBy: 'timeout' });
        if (passenger && escrow > 0) this.credit(tx, passenger, escrow, 'Estorno · nenhum motorista disponível a tempo', 'estorno');
        return true;
      });
      if (done) rides++;
    }
    for (const r of await this.store.query<Doc>('indrive', [['status', '==', 'open']], 300)) {
      if (now - Date.parse(String(r.createdAt)) < cfg.indriveOpenTimeoutMin * 60_000) continue;
      await this.store.update('indrive', String(r.id), { status: 'cancelled', cancelledAt: this.iso(), cancelledBy: 'timeout' });
      deals++;
    }
    return { ridesCancelled: rides, requestsExpired: deals };
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
    await this.store.update('sos', String(id), { status: 'resolved', resolvedBy: auth.email, note: text(note, 300), resolvedAt: this.iso() });
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
    const users = q.includes('@')
      ? await this.store.query<UserDoc>('users', [['email', '==', q]], 5)
      : byNewest(await this.store.query<UserDoc>('users', [], 300)).slice(0, 100);
    return users
      .filter((u) => !q || q.includes('@') || u.name.toLowerCase().includes(q) || String(u.phone).includes(q))
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
      rides: recent([...myRides, ...drivingRides, ...this.nearby(user, queueRides).filter((r) => r.passengerId !== uid)], notOld).map((r) => this.rideView(r, uid)),
      indriveRequests: recent([...myInDrive, ...drivingInDrive, ...openInDrive.filter((r) => r.passengerId !== uid)], notOld).map((r) => this.indriveView(r, uid)),
      carpools: recent([...openCarpools, ...myCarpools, ...bookedTrips], notOld).map((c) =>
        this.carpoolView(c, uid, myBookings, driverTripBookings.get(String(c.id))),
      ),
      emptyTrucks: recent([...availableTrucks, ...myTrucks, ...reservedTrucks], notOld).map((t) => this.truckView(t, uid)),
      freights: recent([...myFreights, ...wonFreights, ...openFreights.filter((f) => f.clientId !== uid)], notOld).map((f) => this.freightView(f, uid)),
      transactions,
    };
  }
}
