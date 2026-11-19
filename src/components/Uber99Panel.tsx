import React, { useEffect, useMemo, useState } from 'react';
import { SosButton } from './SosButton.tsx';
import { TripSafetyBar } from './TripSafetyBar.tsx';
import { DriverArrivedAlert, DriverWaitPanel, PassengerCancelButton, RidePolicyModal, policyAccepted } from './RideRespect.tsx';
import { VerifiedBadge } from './IdentityGate.tsx';
import { openReceipt } from '../lib/receipt.ts';
import { api } from '../lib/session.ts';
import { canAcceptMore, currentDriving, liveTarget, queuedDriving, MAX_DRIVER_QUEUE } from '../lib/rideFlow.ts';
import { NavButtons, PinGlow, SlideToConfirm } from './RideFlowUI.tsx';
import { ProfilePhoto } from './ProfilePhoto.tsx';
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
import { calculateDistanceKm, formatBRL, RIDE_CATEGORIES } from '../data/locations.ts';
import { priceRide } from '../data/pricing.ts';
import type { PriceFactor, RideCategoryKey } from '../data/pricing.ts';
import type { GeoPoint, PaymentMethod, RideCategoryId, RideOrder, UserProfile, UserRole } from '../types/mobility.ts';
import { LocationSelector } from './LocationSelector.tsx';
import { isOriginPending, isUnsetDestination } from '../lib/currentLocation.ts';
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
    /** A pessoa viu e aceitou as regras de cancelamento e espera. */
    acceptPolicy?: boolean;
  }) => Promise<void>;
  onRideAction: (rideId: string, action: string, extra?: Record<string, string | number>) => Promise<void>;
  onSetOnline: (online: boolean) => Promise<void>;
  /** Leva para a carteira (recarga) quando falta saldo. */
  onNeedTopUp?: () => void;
  /** GPS do próprio motorista (para a distância ao embarque). */
  myPos?: { lat: number; lng: number } | null;
  /** Tempo e km restantes pela rota ao vivo do mapa. */
  liveEta?: { km: number; min: number } | null;
  /** Janela rápida (some em 3 s). */
  onFlash?: (f: { title: string; body?: string; tone?: 'ok' | 'info' | 'warn' }) => void;
}

/** Cotação oficial do servidor: preço por categoria, faixa de horário, área de risco e divisão do valor. */
interface Quote {
  surge: number;
  demand?: number;
  band?: { id: string; label: string; pct: number };
  /** Motivos do preço estar mais alto agora (horário, fim de semana, feriado, chuva, procura). */
  factors?: PriceFactor[];
  risk?: { name: string; pct: number; amount: number } | null;
  prices: { categoryId: string; price: number }[];
}

// Importadas pelo Vite: o caminho /src/... não existe no site publicado.
const FLEET_IMAGES: Record<RideCategoryId, string> = {
  froc_x: sedanImg,
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
  onNeedTopUp,
  liveEta,
  onFlash,
}) => {
  const [selectedCat, setSelectedCat] = useState<RideCategoryId>('froc_x');
  const paymentMethod: PaymentMethod = 'froc_pay';
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [driverChat, setDriverChat] = useState('');
  const [stopInput, setStopInput] = useState('');
  const [stops, setStops] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);

  // Preço oficial do servidor (inclui o preço dinâmico da região, calculado com H3).
  const needsDestination = isUnsetDestination(destination);
  const locating = isOriginPending(origin);
  useEffect(() => {
    if (role !== 'passenger') return;
    if (needsDestination || locating) {
      setQuote(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api<Quote>('/api/rides/quote', {
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

  // Preço da categoria escolhida (o mesmo mostrado na lista) para conferir o saldo antes de pedir.
  const selectedPrice = (() => {
    const cat = RIDE_CATEGORIES.find((c) => c.id === selectedCat)!;
    return (
      quote?.prices.find((p) => p.categoryId === cat.id)?.price ??
      priceRide({ categoryId: cat.id as RideCategoryKey, distanceKm, date: new Date(), demand: 1, maxSurge: 2, timeSurgeEnabled: true, risk: null }).total
    );
  })();
  const lowBalance = !needsDestination && !locating && profile.walletBalance < selectedPrice;

  const isActive = (r: RideOrder) => r.status !== 'completed' && r.status !== 'cancelled';
  const activeRide = rides.find((r) => r.mine === 'owner' && isActive(r));
  const toRate = rides.find((r) => r.mine === 'owner' && r.status === 'completed' && !r.ratedByPassenger);
  const myDriving = currentDriving(rides);
  const myQueue = queuedDriving(rides);
  const canMore = canAcceptMore(rides);
  const driveTo = liveTarget(myDriving);
  const driverToRate = rides.find((r) => r.mine === 'provider' && r.status === 'completed' && !r.ratedByDriver);
  const openQueueRides = rides.filter((r) => r.mine === null && r.status === 'searching');

  const [showPolicy, setShowPolicy] = useState(false);
  const handleBook = async () => {
    // Primeiro pedido: mostra as regras de respeito (cancelamento e espera) antes de pedir.
    if (!policyAccepted()) {
      setShowPolicy(true);
      return;
    }
    setSubmitting(true);
    try {
      await onCreateRide({
        acceptPolicy: true,
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
            <div className="text-[11px] text-slate-400">Seu ganho</div>
            <div className="text-sm font-bold text-emerald-400">Aparece antes de aceitar</div>
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
                  {myDriving.delivery ? (
                    <>
                      {myDriving.status === 'accepted' && 'Entrega · indo até a loja'}
                      {myDriving.status === 'arriving' && 'Entrega · na loja, retire o pedido'}
                      {myDriving.status === 'in_progress' && 'Entrega · levando ao cliente'}
                    </>
                  ) : (
                    <>
                      {myDriving.status === 'accepted' && 'Indo buscar o passageiro'}
                      {myDriving.status === 'arriving' && 'Aguardando o passageiro no embarque'}
                      {myDriving.status === 'in_progress' && 'Em viagem'}
                    </>
                  )}
                </div>
                <h5 className="text-sm font-bold text-slate-900 dark:text-white">
                  {myDriving.passengerName} <span className="text-xs text-amber-500">★ {myDriving.passengerRating ?? 5}</span>
                </h5>
                <VerifiedBadge level={myDriving.passengerVerified} />
                <div className="text-xs text-slate-500">
                  {myDriving.origin.name} → {myDriving.destination.name}
                </div>
                {liveEta && driveTo && (
                  <div className="text-sm font-bold text-sky-600 dark:text-sky-400">
                    {myDriving.status === 'in_progress' ? 'Até o destino' : 'Até o passageiro'}: {liveEta.min} min · {liveEta.km.toString().replace('.', ',')} km
                  </div>
                )}
                <div className="text-xs text-slate-500">
                  {myDriving.paymentMethod === 'cash'
                    ? 'Corrida antiga em dinheiro: receba do passageiro.'
                    : 'Já pago pelo passageiro pela carteira Froc: cai sozinho no seu saldo ao finalizar.'}
                </div>
                {myDriving.delivery && (
                  <div className="mt-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2 text-xs text-slate-700 dark:text-slate-200 space-y-0.5">
                    <div>
                      <strong>Coleta:</strong> {myDriving.delivery.merchantName} · {myDriving.origin.name}
                    </div>
                    <div>
                      <strong>Entregar para:</strong> {myDriving.delivery.recipientName}
                      {myDriving.delivery.recipientPhone && (
                        <>
                          {' · '}
                          <a href={`tel:${myDriving.delivery.recipientPhone.replace(/[^\d+]/g, '')}`} className="underline font-semibold">
                            {myDriving.delivery.recipientPhone}
                          </a>
                        </>
                      )}
                    </div>
                    {myDriving.delivery.items && <div>Itens: {myDriving.delivery.items}</div>}
                    {myDriving.delivery.note && <div>Obs.: {myDriving.delivery.note}</div>}
                    {myDriving.delivery.orderRef && <div>Pedido: {myDriving.delivery.orderRef}</div>}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0 text-base font-bold text-emerald-600 font-mono-num">{formatBRL(myDriving.price)}</div>
            </div>
            {driveTo && <NavButtons to={driveTo} label={myDriving.status === 'in_progress' ? 'Navegar ao destino' : 'Navegar ao passageiro'} />}
            <div className="max-h-28 overflow-y-auto froc-scroll space-y-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5">
              {myDriving.messages.length === 0 && <div className="text-xs text-slate-400">Sem mensagens.</div>}
              {myDriving.messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`text-xs px-2.5 py-1.5 rounded-lg max-w-[88%] ${
                    m.sender === 'froc'
                      ? 'mx-auto max-w-full bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900'
                      : m.sender === 'driver'
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
            <TripSafetyBar
              kind="ride"
              tripId={myDriving.id}
              me="driver"
              recording={myDriving.recording}
              shareText={`Estou dirigindo pela Froc: ${profile.driverVehicle} placa ${profile.driverPlate}, de ${myDriving.origin.name.split('·')[0]} para ${myDriving.destination.name.split('·')[0]}.`}
            />
            <div className="flex flex-wrap gap-2">
              {myDriving.status === 'arriving' && !myDriving.delivery && myDriving.arrivedAt && (
                <DriverWaitPanel ride={myDriving} onNoShow={() => void onRideAction(myDriving.id, 'no_show')} />
              )}
              {myDriving.status === 'accepted' && (
                <div className="w-full space-y-1">
                  <p className="text-[11px] text-slate-500 dark:text-slate-300">
                    Ao chegar perto do embarque, o app avisa o passageiro sozinho e pede o PIN. Se o GPS falhar, toque abaixo.
                  </p>
                  <button
                    type="button"
                    onClick={() => onRideAction(myDriving.id, 'arriving')}
                    className="w-full min-h-[44px] rounded-xl bg-sky-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    Cheguei ao embarque
                  </button>
                </div>
              )}
              {myDriving.delivery && (myDriving.status === 'accepted' || myDriving.status === 'arriving') && (
                <button
                  type="button"
                  onClick={() => onRideAction(myDriving.id, 'start')}
                  className="flex-1 min-h-[44px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                >
                  Retirei o pedido na loja
                </button>
              )}
              {myDriving.delivery && myDriving.status === 'in_progress' && (
                <div className="flex w-full gap-2">
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={pinInputs[myDriving.id] || ''}
                    onChange={(e) => setPinInputs((p) => ({ ...p, [myDriving.id]: e.target.value.replace(/\D/g, '') }))}
                    placeholder="Código do cliente"
                    className="w-36 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm font-mono-num tracking-widest text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    disabled={(pinInputs[myDriving.id] || '').length !== 4}
                    onClick={() => onRideAction(myDriving.id, 'complete', { pin: pinInputs[myDriving.id] || '' })}
                    className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    Confirmar entrega
                  </button>
                </div>
              )}
              {!myDriving.delivery && (myDriving.status === 'accepted' || myDriving.status === 'arriving') && (
                <div className="w-full space-y-2">
                  {myDriving.status === 'arriving' ? (
                    <PinGlow value={pinInputs[myDriving.id] || ''} onChange={(v) => setPinInputs((p) => ({ ...p, [myDriving.id]: v }))} />
                  ) : (
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      value={pinInputs[myDriving.id] || ''}
                      onChange={(e) => setPinInputs((p) => ({ ...p, [myDriving.id]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                      placeholder="PIN do passageiro"
                      aria-label="PIN do passageiro"
                      className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-center text-lg font-mono-num tracking-[0.4em] text-slate-900 dark:text-white"
                    />
                  )}
                  <SlideToConfirm
                    label={(pinInputs[myDriving.id] || '').length === 4 ? 'Deslize para iniciar a viagem' : 'Digite o PIN para liberar'}
                    disabled={(pinInputs[myDriving.id] || '').length !== 4}
                    onConfirm={() => {
                      void onRideAction(myDriving.id, 'start', { pin: pinInputs[myDriving.id] || '' }).then(() =>
                        onFlash?.({ title: 'Viagem iniciada', body: 'Siga a rota azul no mapa ou toque em Navegar.', tone: 'ok' }),
                      );
                    }}
                  />
                </div>
              )}
              {!myDriving.delivery && myDriving.status === 'in_progress' && (
                <div className="w-full">
                  <SlideToConfirm
                    label="Deslize para finalizar a corrida"
                    onConfirm={() => {
                      void onRideAction(myDriving.id, 'complete').then(() =>
                        onFlash?.({
                          title: 'Corrida finalizada!',
                          body: myQueue.length ? 'A próxima corrida da sua fila já começou.' : 'O valor caiu no seu saldo.',
                          tone: 'ok',
                        }),
                      );
                    }}
                  />
                </div>
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

        {myQueue.length > 0 && (
          <div className="rounded-2xl border-2 border-dashed border-emerald-400 p-3 space-y-2">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Sua fila ({myQueue.length})</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-300">A próxima começa sozinha quando você finalizar a corrida atual.</p>
            {myQueue.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {r.queuePosition}º · {r.passengerName}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-300 truncate">
                    {r.origin.name.split('·')[0]} → {r.destination.name.split('·')[0]}
                  </div>
                </div>
                <div className="text-sm font-bold text-emerald-600 font-mono-num shrink-0">{formatBRL(r.price)}</div>
                <button
                  type="button"
                  onClick={() => onRideAction(r.id, 'cancel')}
                  className="px-2.5 min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Soltar
                </button>
              </div>
            ))}
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
                      {ride.categoryLabel} · {ride.distanceKm} km · {ride.durationMin} min · pago pela carteira
                    </div>
                    <h5 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {ride.passengerName} <span className="text-xs text-amber-500">★ {ride.passengerRating ?? 5}</span>
                      {(ride.surgeMultiplier ?? 1) > 1 && <span className="ml-1 text-[10px] text-amber-600">alta demanda {ride.surgeMultiplier}x</span>}
                    </h5>
                    <VerifiedBadge level={ride.passengerVerified} />
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-slate-500">Você recebe</div>
                    <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono-num">{formatBRL(ride.driverEarning ?? ride.price)}</div>
                    {ride.pricing?.risk && <div className="text-[11px] font-semibold text-amber-600">Área de risco: +{formatBRL(ride.pricing.risk.amount)} para você</div>}
                  </div>
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <div>
                    <strong className="text-emerald-600">Partida:</strong> {ride.origin.name}
                  </div>
                  <div>
                    <strong className="text-slate-900 dark:text-sky-400">Destino:</strong> {ride.destination.name}
                  </div>
                  {ride.delivery && (
                    <div className="text-amber-700 dark:text-amber-300 font-semibold">
                      Entrega de loja: retire em {ride.delivery.merchantName} e entregue para {ride.delivery.recipientName} (o cliente informa o código).
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!canMore}
                  onClick={() => onRideAction(ride.id, 'driver_accept')}
                  className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                >
                  {!canMore ? `Fila cheia (${MAX_DRIVER_QUEUE} corridas)` : myDriving ? 'Aceitar para a fila' : 'Aceitar corrida'}
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
      {showPolicy && (
        <RidePolicyModal
          onClose={() => setShowPolicy(false)}
          onAccept={() => {
            setShowPolicy(false);
            if (!needsDestination && !locating && !lowBalance) void handleBook();
          }}
        />
      )}
      {activeRide ? (
        <div className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {activeRide.status === 'searching' && 'Procurando motorista... (aguarde, a tela atualiza sozinha)'}
                {activeRide.status === 'accepted' &&
                  (activeRide.queued
                    ? `Seu motorista termina outra corrida antes · chega em ~${activeRide.etaMin || 5} min`
                    : `Motorista a caminho · ${liveEta?.min ?? activeRide.etaMin ?? 3} min${liveEta ? ` · ${liveEta.km.toString().replace('.', ',')} km` : ''}`)}
                {activeRide.status === 'arriving' && 'Motorista chegou ao embarque'}
                {activeRide.status === 'in_progress' && `Em viagem · ${liveEta?.min ?? activeRide.durationMin} min restantes`}
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
                <ProfilePhoto uid={activeRide.driverId} size={60} alt={`Foto de ${activeRide.driverName}`} />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {activeRide.driverName}
                  </div>
                  <VerifiedBadge level="verificado" who="Motorista (documentos conferidos)" />
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    <span className="font-mono-num">{activeRide.driverRating}</span>
                    <span>·</span>
                    <span className="truncate">{activeRide.vehicleModel}</span>
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="inline-block rounded-lg bg-slate-900 dark:bg-slate-800 text-white px-3 py-1.5 text-lg font-mono-num font-black tracking-wider">
                  {activeRide.vehiclePlate}
                </span>
                <div className="text-sm font-bold text-emerald-600 font-mono-num mt-1">{formatBRL(activeRide.price)}</div>
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
                    m.sender === 'froc'
                      ? 'mx-auto max-w-full bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900'
                      : m.sender === 'passenger'
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
          {activeRide.status === 'arriving' && activeRide.arrivedAt && (
            <DriverArrivedAlert ride={activeRide} onOnMyWay={() => void onRideAction(activeRide.id, 'message', { message: 'Estou indo! 🏃' })} />
          )}
          {activeRide.status !== 'searching' && (
            <TripSafetyBar
              kind="ride"
              tripId={activeRide.id}
              me="passenger"
              recording={activeRide.recording}
              shareText={`Motorista ${(activeRide.driverName || '').split(' ')[0]}, ${activeRide.vehicleModel || ''} placa ${activeRide.vehiclePlate || ''}.`}
            />
          )}
          {activeRide.status !== 'in_progress' && (
            <div className="flex flex-wrap gap-2 pt-1">
              <p className="w-full text-[11px] text-slate-500">
                {activeRide.driverLocation && (
                  <>Motorista a {calculateDistanceKm(activeRide.driverLocation, activeRide.origin)} km do embarque (ao vivo no mapa). </>
                )}
                Informe o PIN ao motorista só quando entrar no carro.
                {' O valor já saiu da sua carteira e fica guardado pela Froc; vai para o motorista no fim da viagem.'}
              </p>
              <PassengerCancelButton ride={activeRide} onCancel={() => void onRideAction(activeRide.id, 'cancel')} />
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
            {quote && ((quote.factors?.length ?? 0) > 0 || quote.risk) && (
              <div data-testid="motivos-preco" className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
                <div className="font-bold">Por que o preço está assim agora:</div>
                {(quote.factors ?? []).map((f: PriceFactor) => (
                  <div key={f.id}>
                    • {f.label}: +{f.pct}%
                  </div>
                ))}
                {quote.risk && <div>• Área com acréscimo de segurança: +{quote.risk.pct}%, que vai inteiro para o motorista.</div>}
                <div className="opacity-80">O preço volta ao normal quando esses fatores passam.</div>
              </div>
            )}

            <div className="space-y-2">
              {RIDE_CATEGORIES.map((cat) => {
                // Enquanto o servidor não responde: estimativa com o mesmo leilão (sem procura e chuva).
                const estimate = priceRide({ categoryId: cat.id as RideCategoryKey, distanceKm, date: new Date(), demand: 1, maxSurge: 2, timeSurgeEnabled: true, risk: null }).total;
                const finalPrice = quote?.prices.find((p) => p.categoryId === cat.id)?.price ?? estimate;
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

          {/* Pagamento: só pela carteira Froc */}
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 min-h-[44px] text-xs ${
              lowBalance ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111013]'
            }`}
          >
            <CreditCard className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="flex-1 font-semibold text-slate-900 dark:text-white">
              Carteira Froc · saldo {formatBRL(profile.walletBalance)}
              {lowBalance && <span className="block font-normal text-amber-700 dark:text-amber-300">Falta {formatBRL(selectedPrice - profile.walletBalance)} para esta corrida.</span>}
            </span>
            {lowBalance && onNeedTopUp && (
              <button type="button" onClick={onNeedTopUp} className="px-3 min-h-[34px] rounded-lg bg-emerald-600 text-white font-bold whitespace-nowrap cursor-pointer">
                Recarregar
              </button>
            )}
          </div>

          <p className="text-[11px] text-slate-500 text-center">
            Cancelar é grátis até 1 min depois do aceite · motorista no embarque: 1º minuto de espera grátis, depois +10%, +30% e +50%.{' '}
            <button type="button" onClick={() => setShowPolicy(true)} className="underline font-semibold cursor-pointer">
              Ver regras
            </button>
          </p>
          <button
            type="button"
            disabled={submitting || needsDestination || locating || lowBalance}
            onClick={handleBook}
            className="w-full min-h-[48px] rounded-2xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-sm font-bold transition flex items-center justify-center gap-2 shadow-sm disabled:opacity-60 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              {submitting
                ? 'Solicitando...'
                : locating
                  ? origin.name === 'Localizando você...' ? 'Localizando você...' : 'Informe onde você está (A)'
                  : needsDestination
                    ? 'Escolha o destino (B) para pedir'
                    : lowBalance
                      ? 'Recarregue a carteira para pedir'
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
                        paymentMethod: r.paymentMethod === 'cash' ? 'Dinheiro (corrida antiga)' : 'Carteira Froc',
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
