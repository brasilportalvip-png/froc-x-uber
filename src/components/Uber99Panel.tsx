import React, { useMemo, useState } from 'react';
import {
  Bike,
  Car,
  CheckCircle2,
  CreditCard,
  MessageSquare,
  Package,
  Plus,
  Send,
  ShieldCheck,
  Star,
  Ticket,
} from 'lucide-react';
import { calculateDistanceKm, estimateDurationMin, formatBRL, RIDE_CATEGORIES } from '../data/locations.ts';
import type { GeoPoint, RideCategoryId, RideOrder, UserProfile, UserRole } from '../types/mobility.ts';
import { LocationSelector } from './LocationSelector.tsx';

interface Uber99PanelProps {
  role: UserRole;
  profile: UserProfile;
  origin: GeoPoint;
  destination: GeoPoint;
  rides: RideOrder[];
  mapsEnabled?: boolean;
  liveDistanceKm?: number | null;
  onChangeOrigin: (p: GeoPoint) => void;
  onChangeDestination: (p: GeoPoint) => void;
  onSwapLocations: () => void;
  onCreateRide: (payload: {
    originId: string;
    destinationId: string;
    originPoint: GeoPoint;
    destinationPoint: GeoPoint;
    categoryId: RideCategoryId;
    paymentMethod: 'pix' | 'card' | 'cash' | 'froc_pay';
    stops: string[];
    promoCode: string;
  }) => Promise<void>;
  onRideAction: (rideId: string, action: string, extra?: Record<string, string>) => Promise<void>;
}

const FLEET_IMAGES: Record<RideCategoryId, string> = {
  froc_x: '/src/assets/images/fleet_sedan_urban_1794683389130.jpg',
  froc_99: '/src/assets/images/fleet_sedan_urban_1794683389130.jpg',
  froc_comfort: '/src/assets/images/fleet_sedan_urban_1794683389130.jpg',
  froc_moto: '/src/assets/images/fleet_moto_express_1794683388258.jpg',
  froc_delivery: '/src/assets/images/fleet_moto_express_1794683388258.jpg',
};

export const Uber99Panel: React.FC<Uber99PanelProps> = ({
  role,
  profile,
  origin,
  destination,
  rides,
  mapsEnabled = false,
  liveDistanceKm = null,
  onChangeOrigin,
  onChangeDestination,
  onSwapLocations,
  onCreateRide,
  onRideAction,
}) => {
  const [selectedCat, setSelectedCat] = useState<RideCategoryId>('froc_x');
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'card' | 'cash' | 'froc_pay'>('pix');
  const [promoCode, setPromoCode] = useState('');
  const [stopInput, setStopInput] = useState('');
  const [stops, setStops] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const distanceKm = useMemo(
    () => (liveDistanceKm && liveDistanceKm > 0 ? liveDistanceKm : calculateDistanceKm(origin, destination)),
    [liveDistanceKm, origin, destination]
  );

  const activeRide = rides.find((r) => r.status !== 'completed' && r.status !== 'cancelled');
  const openQueueRides = rides.filter((r) => r.status === 'searching' || r.status === 'accepted' || r.status === 'in_progress');

  const handleBook = async () => {
    setSubmitting(true);
    try {
      await onCreateRide({
        originId: origin.id,
        destinationId: destination.id,
        originPoint: origin,
        destinationPoint: destination,
        categoryId: selectedCat,
        paymentMethod,
        stops,
        promoCode,
      });
      setStops([]);
    } finally {
      setSubmitting(false);
    }
  };

  // Driver Perspective View
  if (role === 'driver') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-slate-900 text-white p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/src/assets/images/driver_avatar_pro_1794683389294.jpg"
              alt="Foto do motorista parceiro"
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-xl object-cover shrink-0 bg-slate-800"
            />
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{profile.name}</h3>
              <p className="text-xs text-slate-300 truncate">
                {profile.driverVehicle} · <span className="font-mono-num">{profile.driverPlate}</span>
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] text-slate-400">Repasse Uber/99</div>
            <div className="text-sm font-bold text-emerald-400 font-mono-num">88% líquido</div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            Fila de corridas próximas ({openQueueRides.length})
          </h4>
          {openQueueRides.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500">
              Nenhuma corrida aberta no momento. Solicite uma corrida no modo Passageiro para testar o aceite ao vivo.
            </div>
          ) : (
            openQueueRides.map((ride) => (
              <div
                key={ride.id}
                className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {ride.categoryLabel} · {ride.distanceKm} km · {ride.durationMin} min
                    </div>
                    <h5 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {ride.passengerName}
                    </h5>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono-num">
                      {formatBRL(ride.price)}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono-num">
                      Você ganha {formatBRL(ride.price * 0.88)}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <div>
                    <strong className="text-emerald-600">Partida:</strong> {ride.origin.name}
                  </div>
                  <div>
                    <strong className="text-slate-900 dark:text-sky-400">Destino:</strong> {ride.destination.name}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {ride.status === 'searching' && (
                    <button
                      type="button"
                      onClick={() => onRideAction(ride.id, 'driver_accept')}
                      className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer"
                    >
                      Aceitar Corrida
                    </button>
                  )}
                  {(ride.status === 'accepted' || ride.status === 'arriving') && (
                    <button
                      type="button"
                      onClick={() => onRideAction(ride.id, 'start')}
                      className="flex-1 min-h-[44px] rounded-xl bg-slate-900 dark:bg-sky-600 text-white text-xs font-semibold transition cursor-pointer"
                    >
                      Confirmar PIN ({ride.pinCode}) e Iniciar
                    </button>
                  )}
                  {ride.status === 'in_progress' && (
                    <button
                      type="button"
                      onClick={() => onRideAction(ride.id, 'complete')}
                      className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer"
                    >
                      Finalizar e Receber {formatBRL(ride.price * 0.88)}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Passenger Perspective View
  return (
    <div className="space-y-4">
      {activeRide ? (
        <div className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {activeRide.status === 'searching' && 'Buscando motorista próximo...'}
                {activeRide.status === 'accepted' && `Motorista a caminho · ${activeRide.etaMin || 3} min`}
                {activeRide.status === 'arriving' && 'Motorista chegou ao embarque'}
                {activeRide.status === 'in_progress' && `Em viagem · ${activeRide.durationMin} min restantes`}
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                {activeRide.categoryLabel} · {formatBRL(activeRide.price)}
              </h3>
            </div>
            <div className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-center">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">PIN de segurança</div>
              <div className="text-base font-bold font-mono-num text-slate-900 dark:text-white tracking-wider">
                {activeRide.pinCode}
              </div>
            </div>
          </div>

          {activeRide.driverName && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 p-3 border border-slate-200/70 dark:border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src="/src/assets/images/driver_avatar_pro_1794683389294.jpg"
                  alt={activeRide.driverName}
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-full object-cover shrink-0 bg-slate-200"
                />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {activeRide.driverName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    <span className="font-mono-num">{activeRide.driverRating}</span>
                    <span>·</span>
                    <span className="truncate">{activeRide.vehicleModel}</span>
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="inline-block rounded-lg bg-slate-900 dark:bg-slate-800 text-white px-2.5 py-1 text-xs font-mono-num font-semibold">
                  {activeRide.vehiclePlate}
                </span>
              </div>
            </div>
          )}

          {/* Live Ride Chat */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat direto com o motorista</span>
            </div>
            <div className="max-h-28 overflow-y-auto froc-scroll space-y-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5">
              {activeRide.messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`text-xs px-2.5 py-1.5 rounded-lg max-w-[88%] ${
                    m.sender === 'passenger'
                      ? 'ml-auto bg-emerald-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {m.text}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ex: Estou de camisa azul..."
                className="flex-1 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!chatInput.trim()) return;
                  await onRideAction(activeRide.id, 'message', { message: chatInput, sender: 'passenger' });
                  setChatInput('');
                }}
                className="min-w-[44px] min-h-[42px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white flex items-center justify-center cursor-pointer"
                aria-label="Enviar mensagem"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {activeRide.status === 'accepted' && (
              <button
                type="button"
                onClick={() => onRideAction(activeRide.id, 'start')}
                className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer"
              >
                Iniciar Viagem (Simular Embarque)
              </button>
            )}
            {activeRide.status === 'in_progress' && (
              <button
                type="button"
                onClick={() => onRideAction(activeRide.id, 'complete')}
                className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer"
              >
                Concluir Viagem
              </button>
            )}
            <button
              type="button"
              onClick={() => onRideAction(activeRide.id, 'cancel')}
              className="px-4 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <LocationSelector
            origin={origin}
            destination={destination}
            mapsEnabled={mapsEnabled}
            onChangeOrigin={onChangeOrigin}
            onChangeDestination={onChangeDestination}
            onSwap={onSwapLocations}
          />

          {/* Optional Extra Stop */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={stopInput}
              onChange={(e) => setStopInput(e.target.value)}
              placeholder="Adicionar parada extra (opcional)..."
              className="flex-1 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={() => {
                if (stopInput.trim()) {
                  setStops((s) => [...s, stopInput.trim()]);
                  setStopInput('');
                }
              }}
              className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Parada</span>
            </button>
          </div>
          {stops.length > 0 && (
            <div className="text-xs text-slate-600 dark:text-slate-400">
              Paradas: {stops.join(' → ')}
            </div>
          )}

          {/* Uber & 99 Categories */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-white">Escolha sua categoria</span>
              <span className="font-mono-num">{distanceKm} km estimados</span>
            </div>

            <div className="space-y-2">
              {RIDE_CATEGORIES.map((cat) => {
                const dur = estimateDurationMin(distanceKm, cat.id === 'froc_moto' ? 'moto' : 'urban');
                const rawPrice = cat.baseFare + distanceKm * cat.perKm + dur * cat.perMin;
                const hasPromo = promoCode.trim().toUpperCase() === 'FROC10';
                const finalPrice = hasPromo ? Math.max(7.5, rawPrice - Math.min(10, rawPrice * 0.15)) : rawPrice;
                const isSelected = selectedCat === cat.id;

                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCat(cat.id)}
                    className={`w-full text-left rounded-2xl p-3 border transition flex items-center gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500 shadow-xs'
                        : 'bg-white dark:bg-[#131924] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="w-16 h-12 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 relative">
                      <img
                        src={FLEET_IMAGES[cat.id]}
                        alt={cat.label}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{cat.label}</span>
                        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {cat.tag}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {cat.etaOffsetMin} min para embarque · {cat.capacity}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold font-mono-num text-slate-900 dark:text-white">
                        {formatBRL(finalPrice)}
                      </div>
                      {hasPromo && (
                        <div className="text-[10px] line-through text-slate-400 font-mono-num">
                          {formatBRL(rawPrice)}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Payment & Coupon */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] px-3 min-h-[44px]">
              <CreditCard className="w-4 h-4 text-slate-500 shrink-0" />
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'pix' | 'card' | 'cash' | 'froc_pay')}
                className="w-full bg-transparent text-xs font-semibold text-slate-900 dark:text-white focus:outline-none cursor-pointer"
              >
                <option value="pix" className="bg-white dark:bg-slate-900">Pix Instantâneo</option>
                <option value="froc_pay" className="bg-white dark:bg-slate-900">Carteira Froc Pay</option>
                <option value="card" className="bg-white dark:bg-slate-900">Cartão de Crédito</option>
                <option value="cash" className="bg-white dark:bg-slate-900">Dinheiro ao Motorista</option>
              </select>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] px-3 min-h-[44px]">
              <Ticket className="w-4 h-4 text-emerald-600 shrink-0" />
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="Cupom: FROC10"
                className="w-full bg-transparent text-xs font-semibold text-slate-900 dark:text-white focus:outline-none uppercase"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={handleBook}
            className="w-full min-h-[48px] rounded-2xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-sm font-bold transition flex items-center justify-center gap-2 shadow-sm disabled:opacity-60 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{submitting ? 'Solicitando...' : `Confirmar ${RIDE_CATEGORIES.find((c) => c.id === selectedCat)?.label}`}</span>
          </button>
        </>
      )}

      {/* Quick recent history */}
      {rides.some((r) => r.status === 'completed') && (
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Últimas corridas</div>
          {rides
            .filter((r) => r.status === 'completed')
            .slice(0, 2)
            .map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between py-2 text-xs text-slate-700 dark:text-slate-300"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {r.categoryId === 'froc_moto' ? (
                    <Bike className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  ) : r.categoryId === 'froc_delivery' ? (
                    <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  ) : (
                    <Car className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span className="truncate">
                    {r.origin.name.split('·')[0]} → {r.destination.name.split('·')[0]}
                  </span>
                </div>
                <span className="font-mono-num font-semibold shrink-0 ml-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  {formatBRL(r.price)}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
