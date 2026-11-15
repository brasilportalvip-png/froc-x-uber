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

export type TruckType = 'VUC / Utilitário' | '3/4 Baú' | 'Toco Aberto' | 'Truck Baú' | 'Carreta Sider';

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
  category: 'corrida' | 'indrive' | 'carona' | 'frete' | 'recarga_pix' | 'ganho_motorista' | 'estorno' | 'saque' | 'taxa';
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
}

export interface DriverApplicationView {
  uid: string;
  name: string;
  email: string;
  phone: string;
  kind: 'driver' | 'trucker';
  vehicle: string;
  plate: string;
  truckType?: TruckType;
  companyName?: string;
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

export interface AdminOverview {
  applications: DriverApplicationView[];
  withdrawals: WithdrawalView[];
  totals: { users: number; pendingApplications: number; pendingWithdrawals: number };
}
