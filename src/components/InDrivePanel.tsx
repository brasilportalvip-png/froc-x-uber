import React, { useMemo, useState } from 'react';
import { Check, Clock, HandCoins, Star, TrendingDown } from 'lucide-react';
import { calculateDistanceKm, formatBRL } from '../data/locations.ts';
import type { GeoPoint, InDriveRequest, PaymentMethod, UserProfile, UserRole } from '../types/mobility.ts';
import { LocationSelector } from './LocationSelector.tsx';

interface InDrivePanelProps {
  role: UserRole;
  profile: UserProfile;
  origin: GeoPoint;
  destination: GeoPoint;
  requests: InDriveRequest[];
  mapsEnabled?: boolean;
  liveDistanceKm?: number | null;
  onChangeOrigin: (p: GeoPoint) => void;
  onChangeDestination: (p: GeoPoint) => void;
  onSwapLocations: () => void;
  onCreateRequest: (payload: {
    originId: string;
    destinationId: string;
    originPoint: GeoPoint;
    destinationPoint: GeoPoint;
    passengerOffer: number;
    paymentMethod: PaymentMethod;
    notes: string;
  }) => Promise<void>;
  onSendDriverOffer: (requestId: string, offeredPrice: number, etaMin: number, note: string) => Promise<void>;
  onAcceptOffer: (requestId: string, offerId: string) => Promise<void>;
  onCompleteRequest: (requestId: string) => Promise<void>;
  onCancelRequest: (requestId: string) => Promise<void>;
}

export const InDrivePanel: React.FC<InDrivePanelProps> = ({
  role,
  profile,
  origin,
  destination,
  requests,
  mapsEnabled = false,
  liveDistanceKm = null,
  onChangeOrigin,
  onChangeDestination,
  onSwapLocations,
  onCreateRequest,
  onSendDriverOffer,
  onAcceptOffer,
  onCompleteRequest,
  onCancelRequest,
}) => {
  const distanceKm = useMemo(
    () => (liveDistanceKm && liveDistanceKm > 0 ? liveDistanceKm : calculateDistanceKm(origin, destination)),
    [liveDistanceKm, origin, destination]
  );
  const suggested = useMemo(() => Math.round((5.5 + distanceKm * 2.15 + 4) * 100) / 100, [distanceKm]);

  const [offerPrice, setOfferPrice] = useState<string>(String(Math.round(suggested * 0.85)));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('froc_pay');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Driver counter-offer local inputs per request
  const [counterPrices, setCounterPrices] = useState<Record<string, string>>({});
  const [counterNotes, setCounterNotes] = useState<Record<string, string>>({});

  // Passageiro vê os próprios pedidos; motorista vê os pedidos abertos dos outros.
  const openRequests = requests.filter((r) => r.status === 'open' && (role === 'driver' ? r.mine !== 'owner' : r.mine === 'owner'));
  const matchedRequests = requests.filter((r) => r.status === 'matched' && (role === 'driver' ? r.mine === 'provider' : r.mine === 'owner'));
  const hasActiveOwn = requests.some((r) => r.mine === 'owner' && (r.status === 'open' || r.status === 'matched'));

  const handlePublish = async () => {
    setSubmitting(true);
    try {
      await onCreateRequest({
        originId: origin.id,
        destinationId: destination.id,
        originPoint: origin,
        destinationPoint: destination,
        passengerOffer: Number(offerPrice) || Math.round(suggested * 0.85),
        paymentMethod,
        notes,
      });
      setNotes('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 p-3.5 text-xs text-sky-900 dark:text-sky-200">
        <strong>Modo Froc inDrive:</strong> você propõe o quanto quer pagar e negocia direto com os motoristas em tempo real, sem tarifa dinâmica surpresa.
      </div>

      {role === 'passenger' && !hasActiveOwn && (
        <div className="space-y-3">
          <LocationSelector
            origin={origin}
            destination={destination}
            mapsEnabled={mapsEnabled}
            onChangeOrigin={onChangeOrigin}
            onChangeDestination={onChangeDestination}
            onSwap={onSwapLocations}
          />

          <div className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Sua oferta de preço</span>
              <span className="text-slate-500 font-mono-num">
                Média de mercado: {formatBRL(suggested)} ({distanceKm} km)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-500">R$</span>
              <input
                type="number"
                min={8}
                step={1}
                value={offerPrice}
                onChange={(e) => setOfferPrice(e.target.value)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 text-lg font-bold font-mono-num text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => setOfferPrice(String(Math.max(8, Math.round((Number(offerPrice) || suggested) - 2))))}
                className="min-w-[44px] min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                -2
              </button>
              <button
                type="button"
                onClick={() => setOfferPrice(String(Math.round((Number(offerPrice) || suggested) + 2)))}
                className="min-w-[44px] min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                +2
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-xs font-semibold text-slate-900 dark:text-white cursor-pointer"
              >
                <option value="froc_pay" className="bg-white dark:bg-slate-900">
                  Carteira Froc ({formatBRL(profile.walletBalance)})
                </option>
                <option value="cash" className="bg-white dark:bg-slate-900">Dinheiro em mãos</option>
              </select>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Obs: 2 malas, ar-condicionado..."
                className="min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handlePublish}
              className="w-full min-h-[48px] rounded-2xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <HandCoins className="w-4 h-4" />
              <span>{submitting ? 'Enviando oferta...' : 'Publicar Minha Oferta aos Motoristas'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Live Bids List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            {role === 'driver' ? `Pedidos para contraproposta (${openRequests.length})` : `Seu pedido aguardando propostas (${openRequests.length})`}
          </h4>
        </div>

        {openRequests.map((req) => (
          <div
            key={req.id}
            className="rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {req.passengerName} · {req.distanceKm} km · {req.paymentMethod === 'cash' ? 'dinheiro' : 'carteira Froc'}
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  {req.origin.name.split('·')[0]} → {req.destination.name.split('·')[0]}
                </div>
                {req.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{req.notes}</p>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] text-slate-500">Oferta</div>
                <div className="text-base font-bold font-mono-num text-sky-600 dark:text-sky-400">
                  {formatBRL(req.passengerOffer)}
                </div>
              </div>
            </div>

            {/* Driver Send Counter-Offer Form */}
            {role === 'driver' && (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 p-3 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Enviar sua contraproposta como {profile.name}
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder={String(req.passengerOffer)}
                    value={counterPrices[req.id] ?? String(req.passengerOffer)}
                    onChange={(e) => setCounterPrices((p) => ({ ...p, [req.id]: e.target.value }))}
                    className="w-28 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm font-bold font-mono-num text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    placeholder="Mensagem curta..."
                    value={counterNotes[req.id] ?? ''}
                    onChange={(e) => setCounterNotes((p) => ({ ...p, [req.id]: e.target.value }))}
                    className="flex-1 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const val = Number(counterPrices[req.id] ?? req.passengerOffer);
                      await onSendDriverOffer(req.id, val, 5, counterNotes[req.id] || '');
                    }}
                    className="px-3.5 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
                  >
                    {req.offers.length ? 'Atualizar lance' : 'Enviar lance'}
                  </button>
                </div>
              </div>
            )}

            {/* Incoming Driver Offers */}
            <div className="space-y-2 pt-1">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {role === 'driver'
                  ? req.offers.length
                    ? 'Sua proposta enviada:'
                    : 'Você ainda não enviou proposta.'
                  : req.offers.length
                    ? `${req.offers.length} ${req.offers.length === 1 ? 'proposta recebida' : 'propostas recebidas'}`
                    : 'Aguardando propostas dos motoristas (a tela atualiza sozinha)...'}
              </div>
              {req.offers.map((offer) => (
                <div
                  key={offer.id}
                  className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                      <span className="truncate">{offer.driverName}</span>
                      <span className="inline-flex items-center gap-0.5 text-amber-500 font-mono-num shrink-0">
                        <Star className="w-3 h-3 fill-amber-500" />
                        {offer.driverRating}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {offer.vehicleModel} · <Clock className="w-3 h-3 inline mr-0.5" />
                      {offer.etaMin} min
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{offer.note}</div>
                  </div>
                  <div className="text-right shrink-0 space-y-1.5">
                    <div className="text-sm font-bold font-mono-num text-emerald-600 dark:text-emerald-400">
                      {formatBRL(offer.offeredPrice)}
                    </div>
                    {role === 'passenger' && (
                      <button
                        type="button"
                        onClick={() => onAcceptOffer(req.id, offer.id)}
                        className="px-3 min-h-[36px] rounded-lg bg-slate-900 dark:bg-emerald-600 hover:opacity-90 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Aceitar</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {role === 'passenger' && (
              <button
                type="button"
                onClick={() => onCancelRequest(req.id)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Cancelar pedido
              </button>
            )}
          </div>
        ))}

        {matchedRequests.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="text-xs font-semibold text-slate-500">Viagens negociadas em andamento</div>
            {matchedRequests.map((m) => {
              const chosen = m.offers.find((o) => o.id === m.acceptedOfferId);
              return (
                <div
                  key={m.id}
                  className="rounded-xl bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-900 p-3 flex items-center justify-between text-xs"
                >
                  <div className="space-y-1.5">
                    <div className="font-bold text-slate-900 dark:text-white">
                      {role === 'driver' ? `Passageiro: ${m.passengerName}` : `Fechado com ${chosen?.driverName} (${chosen?.vehicleModel} · ${chosen?.vehiclePlate})`}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      {m.origin.name.split('·')[0]} → {m.destination.name.split('·')[0]} · {m.paymentMethod === 'cash' ? 'dinheiro' : 'carteira Froc'}
                    </div>
                    {role === 'driver' ? (
                      <button
                        type="button"
                        onClick={() => onCompleteRequest(m.id)}
                        className="px-3 min-h-[36px] rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                      >
                        Finalizar viagem
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onCancelRequest(m.id)}
                        className="px-3 min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                      >
                        Cancelar (valor volta para a carteira)
                      </button>
                    )}
                  </div>
                  <div className="font-bold font-mono-num text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5" />
                    {formatBRL(chosen?.offeredPrice || m.passengerOffer)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
