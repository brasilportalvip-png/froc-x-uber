export type AppModule = 'rides' | 'indrive' | 'carpool' | 'freight' | 'wallet' | 'admin';
export type UserRole = 'passenger' | 'driver' | 'trucker';

export interface GeoPoint {
  id: string;
  name: string;
  city: string;
  state: string;
  zone: 'urban' | 'intercity';
  lat: number;
  lng: number;
  kind: 'avenue' | 'airport' | 'terminal' | 'neighborhood' | 'city' | 'hub';
}

export type RideCategoryId = 'froc_x' | 'froc_99' | 'froc_comfort' | 'froc_moto' | 'froc_delivery';

/** Formas de pagamento aceitas de verdade: carteira Froc (recarregada por Pix/cartão no Mercado Pago) ou dinheiro. */
export type PaymentMethod = 'froc_pay' | 'cash';
export type ApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected';
/** Papel da pessoa logada em cada item: dona do pedido, motorista dele, ou nenhum (vitrine). */
export type Involvement = 'owner' | 'provider' | null;

export interface RideOrder {
  id: string;
  passengerId?: string;
  driverId?: string;
  mine?: Involvement;
  ratedByPassenger?: boolean;
  ratedByDriver?: boolean;
  passengerRating?: number;
  surgeMultiplier?: number;
  driverLocation?: { lat: number; lng: number; at: string; heading?: number };
  /** Quem está gravando a viagem pelo próprio celular (aviso para a outra parte). */
  recording?: TripRecordingState;
  /** Preenchido nas entregas de lojas (Froc Entregas). */
  delivery?: DeliveryInfo;
  /** Código de entrega: só a loja vê; o entregador pede ao cliente para concluir. */
  deliveryPin?: string;
  passengerName: string;
  origin: GeoPoint;
  destination: GeoPoint;
  stops: string[];
  categoryId: RideCategoryId;
  categoryLabel: string;
  distanceKm: number;
  durationMin: number;
  price: number;
  discountApplied: number;
  paymentMethod: PaymentMethod;
  /** Só aparece para o passageiro; o motorista digita o PIN que o passageiro informa. */
  pinCode: string;
  status: 'searching' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled';
  driverName?: string;
  driverRating?: number;
  vehicleModel?: string;
  vehiclePlate?: string;
  etaMin?: number;
  createdAt: string;
  messages: { sender: 'passenger' | 'driver'; text: string; time: string }[];
}

export interface TripRecordingState {
  passenger?: { mode: 'audio' | 'video'; at: string } | null;
  driver?: { mode: 'audio' | 'video'; at: string } | null;
}

export interface DeliveryInfo {
  merchantName: string;
  recipientName: string;
  /** Só aparece para a loja e para o entregador depois do aceite. */
  recipientPhone?: string;
  note?: string;
  orderRef?: string;
  items?: string;
  vehicle: 'moto' | 'carro' | 'qualquer';
  source: 'painel' | 'api';
}

export type DeliveryStatus = 'procurando_entregador' | 'entregador_a_caminho' | 'entregador_na_loja' | 'saiu_para_entrega' | 'entregue' | 'cancelada';

export interface DeliveryView {
  id: string;
  status: DeliveryStatus;
  statusLabel: string;
  price: number;
  distanceKm: number;
  deliveryCode: string;
  trackingPath: string;
  orderRef: string;
  pickup: { name: string; lat: number; lng: number };
  dropoff: { name: string; lat: number; lng: number };
  recipient: { name: string; phone: string };
  note: string;
  vehicle: 'moto' | 'carro' | 'qualquer';
  courier: { firstName: string; vehicle: string; plate: string; location: { lat: number; lng: number; at: string } | null } | null;
  createdAt: string;
  updatedAt: string;
  source: 'painel' | 'api';
}

export interface MerchantProfileView {
  companyName: string;
  cnpj: string;
  phone: string;
  category: string;
  pickup: GeoPoint | null;
  pickupNote: string;
  webhookUrl: string;
  hasWebhookSecret: boolean;
  submittedAt?: string;
}

/** Motorista online perto do passageiro (posição levemente deslocada, por privacidade). */
export interface NearbyDriver {
  id: string;
  lat: number;
  lng: number;
  heading: number | null;
  kind: 'carro' | 'moto' | 'carga';
}

/** O que a pessoa que recebeu o link de acompanhamento vê (sem telefones nem valores). */
export interface TrackView {
  kind: 'ride' | 'indrive' | 'delivery';
  status: string;
  statusLabel: string;
  active: boolean;
  categoryLabel: string;
  origin: { name: string; lat: number; lng: number };
  destination: { name: string; lat: number; lng: number };
  passengerFirstName: string;
  driver: { firstName: string; vehicle: string; plate: string; rating: number | null } | null;
  location: { lat: number; lng: number; at: string; heading?: number } | null;
  merchantName?: string;
  updatedAt: string;
  expiresAt: string;
}

export interface InDriveOffer {
  id: string;
  driverId?: string;
  driverName: string;
  driverRating: number;
  tripsCount: number;
  vehicleModel: string;
  vehiclePlate: string;
  offeredPrice: number;
  etaMin: number;
  note: string;
  createdAt: string;
}

export interface InDriveRequest {
  id: string;
  minimumPrice?: number;
  driverLocation?: { lat: number; lng: number; at: string; heading?: number };
  recording?: TripRecordingState;
  passengerId?: string;
  driverId?: string;
  mine?: Involvement;
  passengerName: string;
  origin: GeoPoint;
  destination: GeoPoint;
  distanceKm: number;
  suggestedPrice: number;
  passengerOffer: number;
  paymentMethod: PaymentMethod;
  notes: string;
  status: 'open' | 'matched' | 'completed' | 'cancelled';
  acceptedOfferId?: string;
  offers: InDriveOffer[];
  createdAt: string;
}

export interface CarpoolTrip {
  id: string;
  driverId?: string;
  mine?: Involvement;
  status?: 'open' | 'completed' | 'cancelled';
  /** Para o motorista: quem reservou. */
  passengers?: { name: string; seats: number; phone?: string }[];
  /** Telefone do motorista, visível só para quem reservou. */
  driverPhone?: string;
  driverName: string;
  driverRating: number;
  verified: boolean;
  vehicleModel: string;
  origin: GeoPoint;
  destination: GeoPoint;
  pickupSpot: string;
  dropoffSpot: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  distanceKm: number;
  pricePerSeat: number;
  totalSeats: number;
  availableSeats: number;
  instantBooking: boolean;
  preferences: {
    music: boolean;
    pets: boolean;
    luggage: 'Pequena' | 'Média' | 'Grande';
    smoking: boolean;
    maxTwoBack: boolean;
  };
  bookedByUserSeats: number;
}

import type { CargoVehicleType } from '../data/cargoVehicles.ts';
export type TruckType = CargoVehicleType;

export interface EmptyTruckRoute {
  id: string;
  truckerId?: string;
  reservedById?: string;
  mine?: Involvement;
  truckerPhone?: string;
  reservedPhone?: string;
  truckerName: string;
  truckerRating: number;
  verified: boolean;
  companyName: string;
  truckType: TruckType;
  truckPlate: string;
  origin: GeoPoint;
  destination: GeoPoint;
  distanceKm: number;
  departureDate: string;
  departureWindow: string;
  direction: 'indo_vazio' | 'voltando_vazio' | 'espaco_parcial';
  availableTons: number;
  availableCubicM: number;
  standardPrice: number;
  emptyReturnPrice: number;
  discountPercent: number;
  acceptsMoving: boolean;
  hasLiftgate: boolean;
  status: 'available' | 'reserved' | 'completed' | 'cancelled';
  reservedBy?: string;
}

export interface FreightBid {
  id: string;
  truckerId?: string;
  truckerName: string;
  truckerRating: number;
  truckType: TruckType;
  price: number;
  helpersIncluded: number;
  etaText: string;
  note: string;
}

export interface FreightRequest {
  id: string;
  clientId?: string;
  acceptedTruckerId?: string;
  estimatedVolumeM3?: number;
  minimumPrice?: number;
  mine?: Involvement;
  clientPhone?: string;
  truckerPhone?: string;
  clientName: string;
  kind: 'mudanca_residencial' | 'carreto_rapido' | 'carga_paletizada' | 'veiculo_moto';
  title: string;
  origin: GeoPoint;
  destination: GeoPoint;
  distanceKm: number;
  truckTypeNeeded: TruckType;
  estimatedWeightKg: number;
  helpersNeeded: number;
  hasElevator: boolean;
  needsPacking: boolean;
  proposedBudget: number;
  scheduledDate: string;
  status: 'open_bids' | 'booked' | 'in_transit' | 'delivered' | 'cancelled';
  acceptedBidId?: string;
  bids: FreightBid[];
  createdAt: string;
}

export interface WalletTransaction {
  id: string;
  title: string;
  category: 'corrida' | 'indrive' | 'carona' | 'frete' | 'recarga_pix' | 'ganho_motorista' | 'estorno' | 'saque' | 'taxa' | 'bonus' | 'entrega';
  amount: number;
  type: 'debit' | 'credit';
  date: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
  driverStatus: ApprovalStatus;
  truckerStatus: ApprovalStatus;
  rejectionReason?: string;
  completedTrips: number;
  companyName: string;
  rntrc: string;
  points: number;
  pointsPerRedeem: number;
  /** Comissão atual da plataforma (%), definida pelo Admin. */
  commissionPercent: number;
  /** Conta criada antes da inauguração (10/03/2027): selo de membro fundador. */
  founder?: boolean;
  /** Carro ou moto (motorista de passageiros). */
  driverVehicleType?: 'carro' | 'moto';
  driverVehicleYear?: number;
  driverCity?: string;
  driverState?: string;
  cnhExpiry?: string;
  /** Idade máxima do veículo definida pelo Admin (padrão Froc). */
  maxVehicleAgeYears?: number;
  merchantStatus?: ApprovalStatus;
  merchant?: MerchantProfileView | null;
  /** Documentos já enviados (para não pedir de novo depois de recarregar a página). */
  driverDocsSent: string[];
  truckerDocsSent: string[];
  passengerRating: number;
  name: string;
  phone: string;
  city: string;
  rating: number;
  walletBalance: number;
  driverOnline: boolean;
  driverVehicle: string;
  driverPlate: string;
  truckModel: string;
  truckType: TruckType;
  truckPlate: string;
}

export interface AppBootstrapState {
  profile: UserProfile;
  rides: RideOrder[];
  indriveRequests: InDriveRequest[];
  carpools: CarpoolTrip[];
  emptyTrucks: EmptyTruckRoute[];
  freights: FreightRequest[];
  transactions: WalletTransaction[];
  /** Entregas da loja (só para contas de loja aprovadas). */
  deliveries?: DeliveryView[];
}

export interface DriverApplicationView {
  uid: string;
  name: string;
  email: string;
  phone: string;
  kind: 'driver' | 'trucker' | 'merchant';
  vehicle: string;
  vehicleType?: 'carro' | 'moto';
  vehicleYear?: number;
  /** Ano mínimo aceito na cidade do motorista (para o Admin conferir). */
  minVehicleYear?: number;
  vehicleAgeRule?: string;
  city?: string;
  state?: string;
  cnhExpiry?: string;
  declarations?: Record<string, string>;
  cnpj?: string;
  category?: string;
  pickupAddress?: string;
  plate: string;
  truckType?: TruckType;
  companyName?: string;
  rntrc?: string;
  submittedAt: string;
  documents: { type: string; url: string }[];
}

export interface WithdrawalView {
  id: string;
  uid: string;
  name: string;
  amount: number;
  pixKey: string;
  status: 'pending' | 'paid' | 'rejected';
  createdAt: string;
}

export interface SosAlert {
  id: string;
  name: string;
  phone: string;
  email: string;
  kind: string;
  lat: number | null;
  lng: number | null;
  message: string;
  createdAt: string;
  trip: { origin?: string; destination?: string; passengerName?: string; driverName?: string | null; vehiclePlate?: string | null; vehicleModel?: string | null } | null;
}

export interface PlatformSettingsView {
  commissionPercent: number;
  surgeEnabled: boolean;
  maxSurge: number;
  rideSearchTimeoutMin: number;
  indriveOpenTimeoutMin: number;
  pointsPerReal: number;
  pointsPerRedeem: number;
  maxVehicleAgeYears: number;
}

export interface AdminOverview {
  applications: DriverApplicationView[];
  withdrawals: WithdrawalView[];
  totals: { users: number; pendingApplications: number; pendingWithdrawals: number; openSos: number };
  sos: SosAlert[];
  settings: PlatformSettingsView;
}

export interface AdminUserRow {
  uid: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
  balance: number;
  completedTrips: number;
  rating: number;
  passengerRating: number;
  driverStatus: ApprovalStatus;
  truckerStatus: ApprovalStatus;
  blocked: boolean;
  blockedReason: string;
  /** Controle de qualidade: motorista com nota baixa em revisão. */
  qualityAlert?: string;
  merchantStatus?: ApprovalStatus;
}

export interface AdminReport {
  days: number;
  completedServices: number;
  grossVolume: number;
  platformRevenue: number;
  driversOnline: number;
  byKind: Record<string, { count: number; gross: number; fee: number }>;
}
