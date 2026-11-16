import React, { useEffect, useMemo, useState } from 'react';
import { SosButton } from './SosButton.tsx';
import { openReceipt } from '../lib/receipt.ts';
import { api } from '../lib/session.ts';
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
  } from 'lucide-react';
import { calculateDistanceKm, estimateDurationMin, formatBRL, RIDE_CATEGORIES } from '../data/locations.ts';
import type { GeoPoint, PaymentMethod, RideCategoryId, RideOrder, UserProfile, UserRole } from '../types/mobility.ts';
import { LocationSelector } from './LocationSelector.tsx';
import { LOCATING_NAME, isUnsetDestination } from '../lib/currentLocation.ts';
import sedanImg from '../assets/images/fleet_sedan_urban_1794683389130.jpg';
import motoImg from '../assets/images/fleet_moto_express_1794683388258.jpg';

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
    paymentMethod: PaymentMethod;
    stops: string[];
  }) => Promise<void>;
  onRideAction: (rideId: string, action: string, extra?: Record<string, string | number>) => Promise<void>;
  onSetOnline: (online: boolean) => Promise<void>;
}

// Importadas pelo Vite: o caminho /src/... não existe no site publicado.
const FLEET_IMAGES: Record<RideCategoryId, string> = {
  froc_x: sedanImg,
  froc_99: sedanImg,
  froc_comfort: sedanImg,
  froc_moto: motoImg,
  froc_delivery: motoImg,
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
  onSetOnline,
}) => {
  const [selectedCat, setSelectedCat] = useState<RideCategoryId>('froc_x');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('froc_pay');
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [driverChat, setDriverChat] = useState('');
  const [stopInput, setStopInput] = useState('');
  const [stops, setStops] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [quote, setQuote] = useState<{ surge: number; prices: { categoryId: string; price: number }[] } | null>(null);

  // Preço oficial do servidor (inclui o preço dinâmico da região, calculado com H3).
  const needsDestination = isUnsetDestination(destination);
  const locating = origin.name === LOCATING_NAME;
  useEffect(() => {
    if (role !== 'passenger') return;
    if (needsDestination || locating) {
      setQuote(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api<{ surge: number; prices: { categoryId: string; price: number }[] }>('/api/rides/quote', {
        body: { originPoint: origin, destinationPoint: destination, originId: origin.id, destinationId: destination.id },
      })
        .then((q) => alive && setQuote(q))
        .catch(() => alive && setQuote(null));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [role, origin.lat, origin.lng, destination.lat, destination.lng, needsDestination, locating]);

  const distanceKm = useMemo(
    () => (isUnsetDestination(destination) ? 0 : liveDistanceKm && liveDistanceKm > 0 ? liveDistanceKm : calculateDistanceKm(origin, destination)),
    [liveDistanceKm, origin, destination]
  );

  const isActive = (r: RideOrder) => r.status !== 'completed' && r.status !== 'cancelled';
  const activeRide = rides.find((r) => r.mine === 'owner' && isActive(r));
  const toRate = rides.find((r) => r.mine === 'owner' && r.status === 'completed' && !r.ratedByPassenger);
  const myDriving = rides.find((r) => r.mine === 'provider' && isActive(r));
  const driverToRate = rides.find((r) => r.mine === 'provider' && r.status === 'completed' && !r.ratedByDriver);
  const openQueueRides = rides.filter((r) => r.mine === null && r.status === 'searching');

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
            <div aria-hidden className="w-12 h-12 rounded-xl  shrink-0 bg-slate-800 flex items-center justify-center font-bold text-white bg-emerald-600">{String(profile.name || "?").trim().charAt(0).toUpperCase()}</div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{profile.name}</h3>
              <p className="text-xs text-slate-300 truncate">
                {profile.driverVehicle} · <span className="font-mono-num">{profile.driverPlate}</span>
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] text-slate-400">Repasse Uber/99</div>
            <div className="text-sm font-bold text-emerald-400 font-mono-num">{100 - (profile.commissionPercent ?? 12)}% líquido</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSetOnline(!profile.driverOnline)}
          className={`w-full min-h-[48px] rounded-2xl text-sm font-bold transition cursor-pointer ${
            profile.driverOnline ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
          }`}
        >
          {profile.driverOnline ? 'Você está ONLINE · recebendo corridas (toque para ficar offline)' : 'Você está offline · toque para ficar online'}
        </button>

        {driverToRate && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Avalie o passageiro {driverToRate.passengerName}</div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-label={`${n} estrela(s)`} onClick={() => onRideAction(driverToRate.id, 'rate_passenger', { stars: n })} className="p-1 cursor-pointer">
                  <Star className="w-7 h-7 text-amber-500 hover:fill-amber-500" />
                </button>
              ))}
            </div>
          </div>
        )}

        {myDriving && (
          <div className="rounded-2xl bg-white dark:bg-[#111013] border-2 border-emerald-500 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-emerald-600">
                  {myDriving.status === 'accepted' && 'Indo buscar o passageiro'}
                  {myDriving.status === 'arriving' && 'Aguardando o passageiro no embarque'}
                  {myDriving.status === 'in_progress' && 'Em viagem'}
                </div>
                <h5 className="text-sm font-bold text-slate-900 dark:text-white">
                  {myDriving.passengerName} <span className="text-xs text-amber-500">★ {myDriving.passengerRating ?? 5}</span>
                </h5>
                <div className="text-xs text-slate-500">
                  {myDriving.origin.name} → {myDriving.destination.name}
                </div>
                <div className="text-xs text-slate-500">
                  Pagamento: {myDriving.paymentMethod === 'cash' ? 'dinheiro (receba do passageiro)' : 'carteira Froc (cai no seu saldo ao finalizar)'}
                </div>
              </div>
              <div className="text-right shrink-0 text-base font-bold text-emerald-600 font-mono-num">{formatBRL(myDriving.price)}</div>
            </div>
            <div className="max-h-28 overflow-y-auto froc-scroll space-y-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5">
              {myDriving.messages.length === 0 && <div className="text-xs text-slate-400">Sem mensagens.</div>}
              {myDriving.messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`text-xs px-2.5 py-1.5 rounded-lg max-w-[88%] ${
                    m.sender === 'driver' ? 'ml-auto bg-emerald-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {m.text}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={driverChat}
                onChange={(e) => setDriverChat(e.target.value)}
                placeholder="Mensagem para o passageiro"
                className="flex-1 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                aria-label="Enviar mensagem"
                onClick={async () => {
                  if (!driverChat.trim()) return;
                  await onRideAction(myDriving.id, 'message', { message: driverChat });
                  setDriverChat('');
                }}
                className="min-w-[44px] min-h-[42px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white flex items-center justify-center cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <SosButton
              kind="ride"
              refId={myDriving.id}
              shareText={`Passageiro ${myDriving.passengerName}, de ${myDriving.origin.name} para ${myDriving.destination.name}. Meu carro: ${profile.driverVehicle} placa ${profile.driverPlate}.`}
            />
            <div className="flex flex-wrap gap-2">
              {myDriving.status === 'accepted' && (
                <button
                  type="button"
                  onClick={() => onRideAction(myDriving.id, 'arriving')}
                  className="flex-1 min-h-[44px] rounded-xl bg-sky-600 text-white text-xs font-semibold cursor-pointer"
                >
                  Cheguei ao embarque
                </button>
              )}
              {(myDriving.status === 'accepted' || myDriving.status === 'arriving') && (
                <div className="flex w-full gap-2">
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={pinInputs[myDriving.id] || ''}
                    onChange={(e) => setPinInputs((p) => ({ ...p, [myDriving.id]: e.target.value.replace(/\D/g, '') }))}
                    placeholder="PIN do passageiro"
                    className="w-36 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm font-mono-num tracking-widest text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    disabled={(pinInputs[myDriving.id] || '').length !== 4}
                    onClick={() => onRideAction(myDriving.id, 'start', { pin: pinInputs[myDriving.id] || '' })}
                    className="flex-1 min-h-[44px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    Confirmar PIN e iniciar
                  </button>
                </div>
              )}
              {myDriving.status === 'in_progress' && (
                <button
                  type="button"
                  onClick={() => onRideAction(myDriving.id, 'complete')}
                  className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                >
                  Finalizar corrida
                </button>
              )}
              {(myDriving.status === 'accepted' || myDriving.status === 'arriving') && (
                <button
                  type="button"
                  onClick={() => onRideAction(myDriving.id, 'cancel')}
                  className="px-4 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Desistir (volta para a fila)
                </button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            Corridas aguardando motorista ({profile.driverOnline ? openQueueRides.length : 0})
          </h4>
          {!profile.driverOnline ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500">
              Fique online para ver os pedidos de corrida.
            </div>
          ) : openQueueRides.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500">
              Nenhum pedido no momento. A lista atualiza sozinha.
            </div>
          ) : (
            openQueueRides.map((ride) => (
              <div key={ride.id} className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {ride.categoryLabel} · {ride.distanceKm} km · {ride.durationMin} min · {ride.paymentMethod === 'cash' ? 'dinheiro' : 'carteira'}
                    </div>
                    <h5 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {ride.passengerName} <span className="text-xs text-amber-500">★ {ride.passengerRating ?? 5}</span>
                      {(ride.surgeMultiplier ?? 1) > 1 && <span className="ml-1 text-[10px] text-amber-600">alta demanda {ride.surgeMultiplier}x</span>}
                    </h5>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono-num">{formatBRL(ride.price)}</div>
                    <div className="text-[11px] text-slate-500 font-mono-num">Você recebe {formatBRL(ride.price * (1 - (profile.commissionPercent ?? 12) / 100))}</div>
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
                <button
                  type="button"
                  disabled={Boolean(myDriving)}
                  onClick={() => onRideAction(ride.id, 'driver_accept')}
                  className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                >
                  {myDriving ? 'Finalize a corrida atual primeiro' : 'Aceitar corrida'}
                </button>
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
        <div className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {activeRide.status === 'searching' && 'Procurando motorista... (aguarde, a tela atualiza sozinha)'}
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
                <div aria-hidden className="w-11 h-11 rounded-full  shrink-0 bg-slate-200 flex items-center justify-center font-bold text-white bg-emerald-600">{String(activeRide.driverName || "?").trim().charAt(0).toUpperCase()}</div>
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
                  await onRideAction(activeRide.id, 'message', { message: chatInput });
                  setChatInput('');
                }}
                className="min-w-[44px] min-h-[42px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white flex items-center justify-center cursor-pointer"
                aria-label="Enviar mensagem"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          {activeRide.status !== 'searching' && (
            <SosButton
              kind="ride"
              refId={activeRide.id}
              shareText={`Motorista ${activeRide.driverName || ''}, ${activeRide.vehicleModel || ''} placa ${activeRide.vehiclePlate || ''}, de ${activeRide.origin.name} para ${activeRide.destination.name}.`}
            />
          )}
          {activeRide.status !== 'in_progress' && (
            <div className="flex flex-wrap gap-2 pt-1">
              <p className="w-full text-[11px] text-slate-500">
                {activeRide.driverLocation && (
                  <>Motorista a {calculateDistanceKm(activeRide.driverLocation as GeoPoint, activeRide.origin)} km do embarque (ao vivo no mapa). </>
                )}
                Informe o PIN ao motorista só quando entrar no carro.
                {activeRide.paymentMethod === 'froc_pay' ? ' O valor está retido na carteira e só vai para o motorista no fim da viagem.' : ' Pagamento em dinheiro direto ao motorista.'}
              </p>
              <button
                type="button"
                onClick={() => onRideAction(activeRide.id, 'cancel')}
                className="px-4 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition cursor-pointer"
              >
                Cancelar corrida
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {toRate && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Como foi a corrida com {toRate.driverName}?
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} estrela(s)`}
                    onClick={() => onRideAction(toRate.id, 'rate', { stars: n })}
                    className="p-1 cursor-pointer"
                  >
                    <Star className="w-7 h-7 text-amber-500 hover:fill-amber-500" />
                  </button>
                ))}
              </div>
            </div>
          )}
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
              className="flex-1 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111013] px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={() => {
                if (stopInput.trim()) {
                  setStops((s) => [...s, stopInput.trim()]);
                  setStopInput('');
                }
              }}
              className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111013] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
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
            {quote && quote.surge > 1 && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                Alta demanda na sua região: preço {quote.surge.toFixed(1)}x. Ele volta ao normal quando mais motoristas ficam disponíveis.
              </div>
            )}

            <div className="space-y-2">
              {RIDE_CATEGORIES.map((cat) => {
                const dur = estimateDurationMin(distanceKm, cat.id === 'froc_moto' ? 'moto' : 'urban');
                const rawPrice = cat.baseFare + distanceKm * cat.perKm + dur * cat.perMin;
                const finalPrice = quote?.prices.find((p) => p.categoryId === cat.id)?.price ?? Math.max(7.5, rawPrice);
                const isSelected = selectedCat === cat.id;

                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCat(cat.id)}
                    className={`w-full text-left rounded-2xl p-3 border transition flex items-center gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500 shadow-xs'
                        : 'bg-white dark:bg-[#111013] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
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
                        {cat.capacity}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold font-mono-num text-slate-900 dark:text-white">
                        {formatBRL(finalPrice)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pagamento */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111013] px-3 min-h-[44px]">
            <CreditCard className="w-4 h-4 text-slate-500 shrink-0" />
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full bg-transparent text-xs font-semibold text-slate-900 dark:text-white focus:outline-none cursor-pointer"
            >
              <option value="froc_pay" className="bg-white dark:bg-slate-900">
                Carteira Froc ({formatBRL(profile.walletBalance)}) · recarga por Pix ou cartão
              </option>
              <option value="cash" className="bg-white dark:bg-slate-900">Dinheiro direto ao motorista</option>
            </select>
          </div>

          <button
            type="button"
            disabled={submitting || needsDestination || locating}
            onClick={handleBook}
            className="w-full min-h-[48px] rounded-2xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-sm font-bold transition flex items-center justify-center gap-2 shadow-sm disabled:opacity-60 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              {submitting
                ? 'Solicitando...'
                : locating
                  ? 'Localizando você...'
                  : needsDestination
                    ? 'Escolha o destino (B) para pedir'
                    : `Confirmar ${RIDE_CATEGORIES.find((c) => c.id === selectedCat)?.label}`}
            </span>
          </button>
        </>
      )}

      {/* Quick recent history */}
      {rides.some((r) => r.mine === 'owner' && r.status === 'completed') && (
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Últimas corridas</div>
          {rides
            .filter((r) => r.mine === 'owner' && r.status === 'completed')
            .slice(0, 3)
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
                <span className="font-mono-num font-semibold shrink-0 ml-2 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  {formatBRL(r.price)}
                  <button
                    type="button"
                    onClick={() =>
                      openReceipt({
                        title: r.categoryLabel,
                        id: r.id,
                        date: new Date(r.createdAt).toLocaleString('pt-BR'),
                        from: r.origin.name,
                        to: r.destination.name,
                        provider: r.driverName,
                        vehicle: r.vehicleModel ? `${r.vehicleModel} · ${r.vehiclePlate}` : undefined,
                        distanceKm: r.distanceKm,
                        amount: r.price,
                        paymentMethod: r.paymentMethod === 'cash' ? 'Dinheiro' : 'Carteira Froc',
                        customer: profile.name,
                      })
                    }
                    className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 underline cursor-pointer"
                  >
                    Recibo
                  </button>
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
