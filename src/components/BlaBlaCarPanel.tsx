import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Music, PawPrint, Plus, ShieldCheck, Star, Users } from 'lucide-react';
import { formatBRL } from '../data/locations.ts';
import { choosePoint, getCurrentCoords, isChoosePoint, isPlaceMissing, startPointFrom } from '../lib/currentLocation.ts';
import { CARPOOL_POLICY, CARPOOL_POLICY_TEXT } from '../data/carpoolPolicy.ts';
import type { CarpoolTrip, GeoPoint, UserRole } from '../types/mobility.ts';
import { PlacePicker } from './PlacePicker.tsx';
import { useCitySearch } from '../lib/citySearch.ts';

interface BlaBlaCarPanelProps {
  role: UserRole;
  carpools: CarpoolTrip[];
  origin: GeoPoint;
  destination: GeoPoint;
  onSelectRouteOnMap: (origin: GeoPoint, destination: GeoPoint) => void;
  onBookCarpool: (tripId: string, seats: number) => Promise<void>;
  /** Ações: cancelar a própria reserva (passageiro) ou concluir/cancelar a carona (motorista). */
  onCarpoolAction: (tripId: string, action: 'cancel-booking' | 'complete' | 'cancel') => Promise<void>;
  canPublish: boolean;
  /** Motorista confirma o embarque com o PIN do passageiro. */
  onBoardCarpool?: (tripId: string, pin: string) => Promise<void>;
  /** Motorista marca que o passageiro não apareceu (com o GPS dele no ponto de encontro). */
  onCarpoolNoShow?: (tripId: string, bookingId: string, lat: number, lng: number) => Promise<void>;
  onPublishCarpool: (payload: {
    originId: string;
    destinationId: string;
    originPoint: GeoPoint;
    destinationPoint: GeoPoint;
    date: string;
    departureTime: string;
    pricePerSeat: number;
    totalSeats: number;
    pickupSpot: string;
    dropoffSpot: string;
    pets: boolean;
    music: boolean;
  }) => Promise<void>;
}

export const BlaBlaCarPanel: React.FC<BlaBlaCarPanelProps> = ({
  role,
  carpools,
  origin,
  onSelectRouteOnMap,
  onBookCarpool,
  onPublishCarpool,
  onCarpoolAction,
  onBoardCarpool,
  onCarpoolNoShow,
  canPublish,
}) => {
  // Cancelar pede confirmação mostrando antes quanto volta / quanto é a multa.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState<Record<string, string>>({});
  const [gpsError, setGpsError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [seatsWanted, setSeatsWanted] = useState(1);
  const [showPublish, setShowPublish] = useState(role === 'driver' && canPublish);

  // Publish carpool form
  // Qualquer cidade do Brasil. A saída começa onde a pessoa está; o destino ela escolhe (nada fixo).
  const [pubOrigin, setPubOrigin] = useState<GeoPoint>(() => startPointFrom(origin, 'Toque para escolher a cidade de saída'));
  const [pubDest, setPubDest] = useState<GeoPoint>(() => choosePoint('Toque para escolher a cidade de destino'));
  const [pubError, setPubError] = useState('');
  // O GPS respondeu depois de abrir o formulário: a saída vira a localização atual.
  useEffect(() => {
    if (!isPlaceMissing(origin)) setPubOrigin((p) => (isChoosePoint(p) ? origin : p));
  }, [origin]);
  const [pubDate, setPubDate] = useState(() => new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  const [pubTime, setPubTime] = useState('08:00');
  const [pubPrice, setPubPrice] = useState('95');
  const [pubSeats, setPubSeats] = useState('3');
  const [pubPets, setPubPets] = useState(true);
  const [pubMusic, setPubMusic] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Perto da pessoa + a cidade digitada, buscada no Brasil inteiro pelo servidor.
  const allCarpools = useCitySearch('carpools', searchText, carpools);
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return allCarpools.filter((c) => {
      if (!q) return true;
      return (
        c.origin.city.toLowerCase().includes(q) ||
        c.destination.city.toLowerCase().includes(q) ||
        c.driverName.toLowerCase().includes(q)
      );
    });
  }, [allCarpools, searchText]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPlaceMissing(pubOrigin) || isPlaceMissing(pubDest)) {
      setPubError('Escolha a cidade de saída e a cidade de destino.');
      return;
    }
    setPubError('');
    setBusyId('publish');
    try {
      await onPublishCarpool({
        originId: pubOrigin.id,
        destinationId: pubDest.id,
        originPoint: { ...pubOrigin, zone: 'intercity' },
        destinationPoint: { ...pubDest, zone: 'intercity' },
        date: pubDate ? pubDate.split('-').reverse().join('/') : '',
        departureTime: pubTime,
        pricePerSeat: Number(pubPrice) || 85,
        totalSeats: Number(pubSeats) || 3,
        pickupSpot: '',
        dropoffSpot: '',
        pets: pubPets,
        music: pubMusic,
      });
      setShowPublish(false);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-slate-600 dark:text-slate-300">
          <strong className="text-slate-900 dark:text-white">Caronas:</strong> divida viagem entre cidades e estados.
        </div>
        {role === 'driver' && canPublish && (
        <button
          type="button"
          onClick={() => setShowPublish((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{showPublish ? 'Ver Caronas' : 'Oferecer Carona'}</span>
        </button>
        )}
      </div>

      {showPublish ? (
        <form
          onSubmit={handlePublish}
          className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-3"
        >
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">Publicar carona intermunicipal</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <PlacePicker label="Cidade de saída" mode="cities" value={pubOrigin} onChange={setPubOrigin} />
            <PlacePicker label="Cidade de destino" mode="cities" value={pubDest} onChange={setPubDest} />
          </div>
          {pubError && (
            <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-3 py-2 text-xs font-semibold">
              {pubError}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Data</label>
              <input
                type="date"
                required
                min={new Date().toISOString().slice(0, 10)}
                value={pubDate}
                onChange={(e) => setPubDate(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-semibold"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Saída</label>
              <input
                type="time"
                value={pubTime}
                onChange={(e) => setPubTime(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-semibold font-mono-num"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Preço/vaga (R$)</label>
              <input
                type="number"
                min={15}
                value={pubPrice}
                onChange={(e) => setPubPrice(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold font-mono-num"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Vagas</label>
              <input
                type="number"
                min={1}
                max={6}
                value={pubSeats}
                onChange={(e) => setPubSeats(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold font-mono-num"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300 pt-1">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={pubMusic} onChange={(e) => setPubMusic(e.target.checked)} />
              <span>Aceita música</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={pubPets} onChange={(e) => setPubPets(e.target.checked)} />
              <span>Aceita pet na viagem</span>
            </label>
          </div>

          <details className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            <summary className="font-bold cursor-pointer">Regras: caução de {CARPOOL_POLICY.driverDepositPct}% por reserva, cancelamento e PIN de embarque</summary>
            <ul className="mt-2 space-y-1 list-disc pl-4">
              {CARPOOL_POLICY_TEXT.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>

          <button
            type="submit"
            disabled={busyId === 'publish'}
            className="w-full min-h-[46px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-sm font-bold hover:opacity-95 transition cursor-pointer"
          >
            {busyId === 'publish' ? 'Publicando...' : 'Publicar carona'}
          </button>
        </form>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar cidade (ex: Rio, Campinas, Curitiba...)"
              className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111013] px-3.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111013] px-3 min-h-[44px]">
              <Users className="w-4 h-4 text-slate-500" />
              <select
                value={seatsWanted}
                onChange={(e) => setSeatsWanted(Number(e.target.value))}
                className="bg-transparent text-xs font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer"
              >
                <option value={1} className="bg-white dark:bg-slate-900">1 vaga</option>
                <option value={2} className="bg-white dark:bg-slate-900">2 vagas</option>
                <option value={3} className="bg-white dark:bg-slate-900">3 vagas</option>
              </select>
            </div>
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-300" data-testid="regra-cancelamento">
            Cancelamento: 100% de volta até 24h antes, 50% até 2h antes e, depois disso, sem reembolso (desistência em até 1h depois de reservar é grátis). Se o motorista cancelar em cima da hora, você recebe 100% + compensação.
          </p>
          <div className="space-y-3">
            {filtered.length === 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500">
                Nenhuma carona publicada ainda{searchText ? ' para essa busca' : ''}.
              </div>
            )}
            {filtered.map((trip) => (
              <div
                key={trip.id}
                onClick={() => onSelectRouteOnMap(trip.origin, trip.destination)}
                className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 hover:border-emerald-500/60 p-4 space-y-3 transition cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <Calendar className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{trip.date}</span>
                      <span>·</span>
                      <span className="font-mono-num font-semibold text-slate-900 dark:text-white">
                        {trip.departureTime} → {trip.arrivalTime}
                      </span>
                      <span>·</span>
                      <span className="font-mono-num">{trip.distanceKm} km</span>
                    </div>
                    <h4 className="text-base font-bold text-slate-900 dark:text-white truncate">
                      {trip.origin.city}/{trip.origin.state} → {trip.destination.city}/{trip.destination.state}
                    </h4>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      Embarque: {trip.pickupSpot}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-bold font-mono-num text-emerald-600 dark:text-emerald-400">
                      {formatBRL(trip.pricePerSeat)}
                    </div>
                    <div className="text-[11px] text-slate-500">por pessoa</div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div aria-hidden className="w-9 h-9 rounded-full  shrink-0 bg-slate-200 flex items-center justify-center font-bold text-white bg-emerald-600">{String(trip.driverName || "?").trim().charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                        <span className="truncate">{trip.driverName}</span>
                        {trip.verified && <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                        <span className="inline-flex items-center gap-0.5 text-amber-500 font-mono-num">
                          <Star className="w-3 h-3 fill-amber-500" />
                          {trip.driverRating}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="truncate">{trip.vehicleModel}</span>
                        {trip.preferences.music && <Music className="w-3 h-3 shrink-0" />}
                        {trip.preferences.pets && <PawPrint className="w-3 h-3 shrink-0" />}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {trip.bookedByUserSeats > 0 && (
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {trip.bookedByUserSeats} reservado(s)
                      </span>
                    )}
                    {trip.mine !== 'provider' && trip.status === 'open' && (
                    <button
                      type="button"
                      disabled={trip.availableSeats < seatsWanted || busyId === trip.id}
                      onClick={async (e) => {
                        e.stopPropagation();
                        setBusyId(trip.id);
                        try {
                          await onBookCarpool(trip.id, seatsWanted);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="px-3.5 min-h-[40px] rounded-xl bg-slate-900 dark:bg-emerald-600 hover:opacity-90 disabled:opacity-40 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
                    >
                      {trip.availableSeats === 0
                        ? 'Lotado'
                        : busyId === trip.id
                          ? 'Reservando...'
                          : `Reservar ${seatsWanted} (${formatBRL(trip.pricePerSeat * seatsWanted)})`}
                    </button>
                    )}
                  </div>
                </div>
                {trip.mine === 'provider' && (
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3 space-y-2 text-xs" onClick={(e) => e.stopPropagation()}>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      Sua carona · {trip.totalSeats - trip.availableSeats} de {trip.totalSeats} vagas reservadas
                    </div>
                    {(trip.passengers || []).map((p, i) => (
                      <div key={p.bookingId ?? i} className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200">
                        <span>
                          {p.name} · {p.seats} vaga(s) ·{' '}
                          <strong>{p.status === 'boarded' ? 'Embarcou ✓' : p.status === 'no_show' ? 'Não apareceu' : 'Aguardando embarque'}</strong>
                        </span>
                        {p.status === 'paid' && trip.departed && p.bookingId && onCarpoolNoShow && (
                          <button
                            type="button"
                            className="px-2 min-h-[32px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                            onClick={async () => {
                              setGpsError('');
                              try {
                                const c = await getCurrentCoords();
                                await onCarpoolNoShow(trip.id, p.bookingId!, c.lat, c.lng);
                              } catch {
                                setGpsError('Ligue a localização do celular: o app confere pelo GPS se você está no ponto de encontro.');
                              }
                            }}
                          >
                            Não apareceu
                          </button>
                        )}
                      </div>
                    ))}
                    {(trip.passengers || []).some((p) => p.status === 'paid') && onBoardCarpool && (
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const pin = (pinInput[trip.id] || '').trim();
                          if (pin.length === 4) void onBoardCarpool(trip.id, pin).then(() => setPinInput((m: Record<string, string>) => ({ ...m, [trip.id]: '' })));
                        }}
                      >
                        <input
                          inputMode="numeric"
                          maxLength={4}
                          aria-label="PIN de embarque do passageiro"
                          placeholder="PIN do passageiro"
                          value={pinInput[trip.id] || ''}
                          onChange={(e) => setPinInput((m: Record<string, string>) => ({ ...m, [trip.id]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                          className="w-36 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 font-mono-num tracking-widest"
                        />
                        <button type="submit" className="flex-1 min-h-[38px] rounded-lg bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-semibold cursor-pointer">
                          Confirmar embarque
                        </button>
                      </form>
                    )}
                    {gpsError && <div role="alert" className="text-amber-700 dark:text-amber-300 font-semibold">{gpsError}</div>}
                    {confirming === trip.id + ':cancel' ? (
                      <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 p-2 space-y-2 text-amber-900 dark:text-amber-100">
                        <div>
                          {trip.cancelPreview?.penalty
                            ? `Cancelar agora custa uma multa de ${trip.cancelPreview.penaltyPct}% (${formatBRL(trip.cancelPreview.penalty)}), que sai da sua caução e vai para os passageiros. Os passageiros recebem 100% de volta.`
                            : 'Cancelar agora não tem multa. Os passageiros recebem 100% de volta e sua caução volta.'}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setConfirming(null); void onCarpoolAction(trip.id, 'cancel'); }} className="flex-1 min-h-[36px] rounded-lg bg-red-600 text-white font-semibold cursor-pointer">
                            Sim, cancelar a carona
                          </button>
                          <button type="button" onClick={() => setConfirming(null)} className="px-3 min-h-[36px] rounded-lg border border-slate-300 font-semibold cursor-pointer">
                            Voltar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={!trip.departed}
                          title={trip.departed ? '' : 'Disponível depois do horário de saída'}
                          onClick={() => onCarpoolAction(trip.id, 'complete')}
                          className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer disabled:opacity-50"
                        >
                          {trip.departed ? 'Viagem realizada · receber' : 'Receber (depois da saída)'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(trip.id + ':cancel')}
                          className="px-3 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                        >
                          Cancelar carona
                        </button>
                      </div>
                    )}
                    <div className="text-[11px] text-slate-500">
                      Recebe quem embarcou com PIN ou faltou (marcado no ponto de encontro). Sem PIN, o valor volta para o passageiro.
                    </div>
                  </div>
                )}
                {trip.mine === 'owner' && trip.status === 'open' && (trip.boardingPins || []).length > 0 && (
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 p-3 text-xs space-y-1" onClick={(e) => e.stopPropagation()}>
                    <div className="font-semibold text-slate-900 dark:text-white">PIN de embarque (mostre ao motorista ao entrar no carro):</div>
                    {(trip.boardingPins || []).map((b: { pin: string; seats: number; status: string }) => (
                      <div key={b.pin} className="flex items-center gap-2">
                        <span className="text-2xl font-extrabold font-mono-num tracking-[0.3em] text-emerald-700 dark:text-emerald-300">{b.pin}</span>
                        <span>{b.seats} vaga(s) · {b.status === 'boarded' ? 'embarque confirmado ✓' : 'aguardando embarque'}</span>
                      </div>
                    ))}
                    <div className="text-[11px] text-slate-500">Não passe o PIN antes de entrar no carro: é ele que libera o pagamento ao motorista.</div>
                  </div>
                )}
                {trip.bookedByUserSeats > 0 && trip.status === 'open' && trip.cancelPreview?.paid !== undefined && (
                  confirming === trip.id + ':booking' ? (
                    <div role="alert" onClick={(e) => e.stopPropagation()} className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 p-2 space-y-2 text-xs text-amber-900 dark:text-amber-100">
                      <div>
                        Se cancelar agora você recebe <strong>{formatBRL(trip.cancelPreview.refund ?? 0)}</strong> de {formatBRL(trip.cancelPreview.paid ?? 0)}.
                        {(trip.cancelPreview.refund ?? 0) < (trip.cancelPreview.paid ?? 0) && ' A diferença vai para o motorista, que reservou o lugar para você.'}
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setConfirming(null); void onCarpoolAction(trip.id, 'cancel-booking'); }} className="flex-1 min-h-[36px] rounded-lg bg-red-600 text-white font-semibold cursor-pointer">
                          Sim, cancelar
                        </button>
                        <button type="button" onClick={() => setConfirming(null)} className="px-3 min-h-[36px] rounded-lg border border-slate-300 font-semibold cursor-pointer">
                          Voltar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirming(trip.id + ':booking');
                      }}
                      className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      Cancelar minha reserva
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
