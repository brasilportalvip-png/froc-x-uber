export type AppModule = 'rides' | 'indrive' | 'carpool' | 'freight' | 'wallet';
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

export interface RideOrder {
  id: string;
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
  paymentMethod: 'pix' | 'card' | 'cash' | 'froc_pay';
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
  passengerName: string;
  origin: GeoPoint;
  destination: GeoPoint;
  distanceKm: number;
  suggestedPrice: number;
  passengerOffer: number;
  paymentMethod: 'pix' | 'cash' | 'card';
  notes: string;
  status: 'open' | 'matched' | 'completed' | 'cancelled';
  acceptedOfferId?: string;
  offers: InDriveOffer[];
  createdAt: string;
}

export interface CarpoolTrip {
  id: string;
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
  status: 'available' | 'reserved';
  reservedBy?: string;
}

export interface FreightBid {
  id: string;
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
  status: 'open_bids' | 'booked' | 'in_transit' | 'delivered';
  acceptedBidId?: string;
  bids: FreightBid[];
  createdAt: string;
}

export interface WalletTransaction {
  id: string;
  title: string;
  category: 'corrida' | 'indrive' | 'carona' | 'frete' | 'recarga_pix' | 'ganho_motorista';
  amount: number;
  type: 'debit' | 'credit';
  date: string;
}

export interface UserProfile {
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
