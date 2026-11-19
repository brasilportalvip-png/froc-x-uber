import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, MapPin, Search, Star, Users, User } from 'lucide-react';
import { calculateDistanceKm, formatBRL } from '../data/locations.ts';
import { privateTripFloor, suggestedOffer } from '../data/privateTrips.ts';
import type { ShareMode } from '../data/privateTrips.ts';
import { CARPOOL_POLICY_TEXT } from '../data/carpoolPolicy.ts';
import type { GeoPoint, InDriveRequest, UserRole } from '../types/mobility.ts';
import { PlacePicker } from './PlacePicker.tsx';
import { SosButton } from './SosButton.tsx';
import { TripSafetyBar } from './TripSafetyBar.tsx';
import { useCitySearch } from '../lib/citySearch.ts';
import { choosePoint, getCurrentCoords, isChoosePoint, isPlaceMissing, startPointFrom } from '../lib/currentLocation.ts';

/**
 * Viagens agendadas: o passageiro lança um pedido agendado para qualquer lugar do Brasil
 * (individual ou aceitando compartilhar) e diz quanto quer pagar; motoristas do Brasil inteiro
 * filtram por cidade e data, mandam propostas e montam a própria agenda.
 */
interface Props {
  role: UserRole;
  /** Onde a pessoa está agora (GPS): a partida começa daqui. */
  origin: GeoPoint;
  requests: InDriveRequest[];
  onCreateRequest: (payload: Record<string, unknown>) => Promise<void>;
  onSendDriverOffer: (requestId: string, offeredPrice: number, etaMin: number, note: string) => Promise<void>;
  onAcceptOffer: (requestId: string, offerId: string) => Promise<void>;
  onCompleteRequest: (requestId: string) => Promise<void>;
  onCancelRequest: (requestId: string) => Promise<void>;
  onBoard: (requestId: string, pin: string) => Promise<void>;
  onNoShow: (requestId: string, lat: number, lng: number) => Promise<void>;
  onDriverCancel: (requestId: string) => Promise<void>;
  /** Mostra o trajeto no mapa (partida → destino). */
  onPreviewRoute?: (from: GeoPoint, to: GeoPoint) => void;
}

const quando = (r: InDriveRequest) => (r.date && r.time ? `${r.date} às ${r.time}` : 'sem data marcada');
const cidade = (p: GeoPoint) => p.city || p.name.split('·')[0];
const sortByDeparture = (a: InDriveRequest, b: InDriveRequest) => String(a.departureAt || a.createdAt).localeCompare(String(b.departureAt || b.createdAt));
const box = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111013] p-4 space-y-3';
const input = 'w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-sm';
const alertBox = 'rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 text-amber-900 dark:text-amber-100 px-3 py-2 text-xs';

function ModoBadge({ r }: { r: InDriveRequest }) {
  if (!r.shareMode) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold ${r.shareMode === 'individual' ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'}`}>
      {r.shareMode === 'individual' ? <User className="w-3 h-3" /> : <Users className="w-3 h-3" />}
      {r.shareMode === 'individual' ? 'VIP' : 'Compartilhada'} · {r.seats ?? 1} pessoa(s)
    </span>
  );
}

export const ViagensParticularesPanel: React.FC<Props> = ({
  role,
  origin,
  requests,
  onCreateRequest,
  onSendDriverOffer,
  onAcceptOffer,
  onCompleteRequest,
  onCancelRequest,
  onBoard,
  onNoShow,
  onDriverCancel,
  onPreviewRoute,
}) => {
  const isDriver = role !== 'passenger';

  // ---------- passageiro: lançar pedido
  const [from, setFrom] = useState<GeoPoint>(() => startPointFrom(origin, 'Toque para escolher a partida'));
  const [to, setTo] = useState<GeoPoint>(() => choosePoint('Toque para escolher o destino'));
  useEffect(() => {
    if (!isPlaceMissing(origin)) setFrom((p) => (isChoosePoint(p) ? origin : p));
  }, [origin]);
  const [pickupSpot, setPickupSpot] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [seats, setSeats] = useState(1);
  const [shareMode, setShareMode] = useState<ShareMode>('individual');
  const [offer, setOffer] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');

  // O mapa acompanha o pedido: onde a pessoa está → para onde vai.
  useEffect(() => {
    if (!isDriver && onPreviewRoute && !isPlaceMissing(from) && !isPlaceMissing(to)) onPreviewRoute(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  const distanceKm = useMemo(() => (isPlaceMissing(from) || isPlaceMissing(to) ? 0 : calculateDistanceKm(from, to)), [from, to]);
  const floor = distanceKm ? privateTripFloor(distanceKm, shareMode, seats) : 0;
  const suggestion = distanceKm ? suggestedOffer(distanceKm, shareMode, seats) : 0;

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(String(offer).replace(/\./g, '').replace(',', '.'));
    if (isPlaceMissing(from) || isPlaceMissing(to)) return setFormError('Escolha a partida e o destino.');
    if (!date || !time) return setFormError('Escolha o dia e a hora da viagem.');
    if (!Number.isFinite(value) || value < floor) return setFormError(`O valor mínimo para essa viagem é ${formatBRL(floor)} (cobre combustível e tempo do motorista).`);
    setFormError('');
    setBusy('publish');
    try {
      await onCreateRequest({
        originPoint: from,
        destinationPoint: to,
        originId: from.id,
        destinationId: to.id,
        pickupSpot,
        date: date.split('-').reverse().join('/'),
        time,
        seats,
        shareMode,
        passengerOffer: value,
        paymentMethod: 'froc_pay',
        notes,
      });
      setOffer('');
      setNotes('');
    } finally {
      setBusy('');
    }
  };

  // ---------- motorista: procurar
  const [busca, setBusca] = useState('');
  const [dia, setDia] = useState('');
  const [tipo, setTipo] = useState<'todas' | ShareMode>('todas');
  const [proposta, setProposta] = useState<Record<string, string>>({});
  const [recado, setRecado] = useState<Record<string, string>>({});
  const [pins, setPins] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState('');

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Pedidos perto do motorista + a cidade digitada, buscada no Brasil inteiro pelo servidor.
  const comBusca = useCitySearch('indrive', isDriver ? busca : '', requests);
  const vitrine = comBusca
    .filter((r) => r.status === 'open' && r.mine !== 'owner')
    .filter((r) => !busca.trim() || norm(`${r.origin.city} ${r.origin.name} ${r.destination.city} ${r.destination.name} ${r.pickupSpot || ''}`).includes(norm(busca.trim())))
    .filter((r) => !dia || r.date === dia.split('-').reverse().join('/'))
    .filter((r) => tipo === 'todas' || r.shareMode === tipo)
    .sort(sortByDeparture);
  const agenda = requests.filter((r) => r.mine === 'provider' && r.status === 'matched').sort(sortByDeparture);
  const meus = requests.filter((r) => r.mine === 'owner').sort(sortByDeparture);

  const safety = (r: InDriveRequest, chosen?: InDriveRequest['offers'][number]) => (
    <>
      <SosButton
        kind="indrive"
        refId={r.id}
        shareText={`Viagem agendada de ${r.origin.name} para ${r.destination.name} (${quando(r)})${chosen ? `, motorista ${chosen.driverName}, ${chosen.vehicleModel} placa ${chosen.vehiclePlate}` : ''}.`}
      />
      <TripSafetyBar
        kind="indrive"
        tripId={r.id}
        me={isDriver ? 'driver' : 'passenger'}
        recording={r.recording}
        shareText={chosen ? `Motorista ${chosen.driverName.split(' ')[0]}, ${chosen.vehicleModel} placa ${chosen.vehiclePlate}.` : 'Viagem agendada pela Froc.'}
      />
    </>
  );

  const regras = (
    <details className={alertBox}>
      <summary className="font-bold cursor-pointer">Regras: caução, cancelamento e PIN de embarque</summary>
      <ul className="mt-2 space-y-1 list-disc pl-4">
        {CARPOOL_POLICY_TEXT.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </details>
  );

  // =====================================================================================
  if (isDriver) {
    return (
      <div className="space-y-4 text-sm" data-testid="viagens-particulares-motorista">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          <strong className="text-slate-900 dark:text-white">Viagens agendadas:</strong> pedidos agendados do Brasil inteiro. Procure pelas cidades por onde você vai passar, mande sua proposta e monte a sua agenda.
        </p>

        <section className={box}>
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarClock className="w-4 h-4" /> Minha agenda ({agenda.length})
          </h3>
          {agenda.length === 0 && <p className="text-xs text-slate-600 dark:text-slate-300">Nenhuma viagem combinada ainda.</p>}
          {agenda.map((r) => (
            <div key={r.id} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-slate-900 dark:text-white">
                  {quando(r)} · {cidade(r.origin)} → {cidade(r.destination)}
                </div>
                <ModoBadge r={r} />
              </div>
              <div>
                Passageiro: <strong>{r.passengerName}</strong>
                {r.pickupSpot ? ` · Encontro: ${r.pickupSpot}` : ''} · {r.distanceKm} km
              </div>
              {typeof r.driverEarning === 'number' && (
                <div>
                  Você recebe: <strong className="text-emerald-700 dark:text-emerald-300">{formatBRL(r.driverEarning)}</strong>
                </div>
              )}
              <div>
                Embarque: <strong>{r.boardingStatus === 'boarded' ? 'confirmado ✓' : r.boardingStatus === 'no_show' ? 'passageiro não apareceu' : 'aguardando'}</strong>
              </div>
              {r.boardingStatus === 'waiting' && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const pin = (pins[r.id] || '').trim();
                    if (pin.length === 4) void onBoard(r.id, pin).then(() => setPins((m: Record<string, string>) => ({ ...m, [r.id]: '' })));
                  }}
                >
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    aria-label="PIN de embarque do passageiro"
                    placeholder="PIN do passageiro"
                    value={pins[r.id] || ''}
                    onChange={(e) => setPins((m: Record<string, string>) => ({ ...m, [r.id]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    className="w-36 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 tracking-widest"
                  />
                  <button type="submit" className="flex-1 min-h-[38px] rounded-lg bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-semibold cursor-pointer">
                    Confirmar embarque
                  </button>
                </form>
              )}
              {r.boardingStatus === 'waiting' && r.departed && (
                <button
                  type="button"
                  className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                  onClick={async () => {
                    setGpsError('');
                    try {
                      const c = await getCurrentCoords();
                      await onNoShow(r.id, c.lat, c.lng);
                    } catch {
                      setGpsError('Ligue a localização do celular: o app confere pelo GPS se você está no ponto de partida.');
                    }
                  }}
                >
                  Passageiro não apareceu
                </button>
              )}
              {gpsError && <div role="alert" className="text-amber-700 dark:text-amber-300 font-semibold">{gpsError}</div>}
              {safety(r)}
              {confirming === r.id ? (
                <div role="alert" className={alertBox + ' space-y-2'}>
                  <div>
                    {r.cancelPreview?.penalty
                      ? `Desistir agora custa uma multa de ${r.cancelPreview.penaltyPct}% (${formatBRL(r.cancelPreview.penalty)}), que sai da sua caução e vai para o passageiro. Ele recebe 100% de volta.`
                      : 'Desistir agora não tem multa. O passageiro recebe 100% de volta e sua caução volta.'}{' '}
                    O pedido volta para outros motoristas.
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setConfirming(null); void onDriverCancel(r.id); }} className="flex-1 min-h-[36px] rounded-lg bg-red-600 text-white font-semibold cursor-pointer">
                      Sim, desistir
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
                    disabled={Boolean(r.departureAt) && !r.departed}
                    onClick={() => onCompleteRequest(r.id)}
                    className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {r.departureAt && !r.departed ? 'Receber (depois do horário)' : 'Viagem realizada · receber'}
                  </button>
                  {r.departureAt && r.boardingStatus !== 'boarded' && (
                    <button type="button" onClick={() => setConfirming(r.id)} className="px-3 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer">
                      Desistir
                    </button>
                  )}
                </div>
              )}
              <div className="text-[11px] text-slate-600 dark:text-slate-300">Recebe com o PIN do passageiro ou se ele não aparecer (marcado no ponto de partida). Sem isso, o valor volta para ele.</div>
            </div>
          ))}
        </section>

        <section className={box}>
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Search className="w-4 h-4" /> Procurar viagens ({vitrine.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input aria-label="Cidade" placeholder="Cidade (ex.: Campinas, Rio)" value={busca} onChange={(e) => setBusca(e.target.value)} className={input} />
            <input aria-label="Dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} className={input} />
            <select aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as 'todas' | ShareMode)} className={input}>
              <option value="todas">Todas</option>
              <option value="individual">Só VIP</option>
              <option value="compartilhada">Só compartilhada</option>
            </select>
          </div>
          {vitrine.length === 0 && <p className="text-xs text-slate-600 dark:text-slate-300">Nenhum pedido com esses filtros. Tente outra cidade ou outro dia.</p>}
          {vitrine.map((r) => {
            const minha = r.offers.find(Boolean);
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => onPreviewRoute?.(r.origin, r.destination)} className="font-bold text-slate-900 dark:text-white text-sm underline-offset-2 hover:underline cursor-pointer" title="Ver no mapa">
                    {cidade(r.origin)} → {cidade(r.destination)}
                  </button>
                  <ModoBadge r={r} />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span><CalendarClock className="inline w-3 h-3" /> {quando(r)}</span>
                  <span><MapPin className="inline w-3 h-3" /> {r.pickupSpot || r.origin.name}</span>
                  <span>{r.distanceKm} km</span>
                </div>
                <div>
                  {r.passengerName.split(' ')[0]} oferece <strong className="text-base text-slate-900 dark:text-white">{formatBRL(r.passengerOffer)}</strong>
                  {r.notes ? ` · "${r.notes}"` : ''}
                </div>
                {minha && <div className="font-semibold text-emerald-700 dark:text-emerald-300">Sua proposta: {formatBRL(minha.offeredPrice)} (pode mudar)</div>}
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = Number(String(proposta[r.id] || r.passengerOffer).replace(',', '.'));
                    void onSendDriverOffer(r.id, v, 5, recado[r.id] || '');
                  }}
                >
                  <input
                    inputMode="decimal"
                    aria-label="Sua proposta"
                    placeholder={`Sua proposta (ex.: ${Math.round(r.passengerOffer)})`}
                    value={proposta[r.id] || ''}
                    onChange={(e) => setProposta((m: Record<string, string>) => ({ ...m, [r.id]: e.target.value }))}
                    className="w-40 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2"
                  />
                  <input
                    aria-label="Recado ao passageiro"
                    placeholder="Recado (ex.: carro com ar, levo malas)"
                    value={recado[r.id] || ''}
                    onChange={(e) => setRecado((m: Record<string, string>) => ({ ...m, [r.id]: e.target.value }))}
                    className="flex-1 min-w-[160px] min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2"
                  />
                  <button type="submit" className="min-h-[38px] px-4 rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer">
                    {minha ? 'Atualizar proposta' : 'Mandar proposta'}
                  </button>
                </form>
              </div>
            );
          })}
        </section>
        {regras}
      </div>
    );
  }

  // =====================================================================================
  return (
    <div className="space-y-4 text-sm" data-testid="viagens-particulares-passageiro">
      <p className="text-xs text-slate-600 dark:text-slate-300">
        <strong className="text-slate-900 dark:text-white">Viagens agendadas:</strong> agende uma viagem para qualquer lugar do Brasil, só para você ou dividindo o carro, e combine o valor com motoristas que vão passar por lá.
      </p>

      <form onSubmit={publish} className={box} noValidate>
        <h3 className="font-bold text-slate-900 dark:text-white">Lançar meu pedido</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <PlacePicker label="Partida" mode="address" value={from} onChange={setFrom} />
          <PlacePicker label="Destino" mode="address" value={to} onChange={setTo} />
        </div>
        <input aria-label="Ponto de encontro" placeholder="Ponto de encontro (ex.: Aeroporto de Viracopos, desembarque)" value={pickupSpot} onChange={(e) => setPickupSpot(e.target.value)} className={input} />
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs space-y-1">
            <span>Dia</span>
            <input type="date" min={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </label>
          <label className="text-xs space-y-1">
            <span>Hora</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} />
          </label>
          <label className="text-xs space-y-1">
            <span>Pessoas</span>
            <select value={seats} onChange={(e) => setSeats(Number(e.target.value))} className={input}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div role="radiogroup" aria-label="Tipo de viagem" className="grid grid-cols-2 gap-2">
          {(
            [
              { id: 'individual', title: 'VIP', text: 'O carro só para você. Mais conforto e privacidade.', Icon: User },
              { id: 'compartilhada', title: 'Compartilhada', text: 'Divide o carro com outras pessoas e paga menos.', Icon: Users },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={shareMode === o.id}
              onClick={() => setShareMode(o.id)}
              className={`text-left rounded-xl border p-3 cursor-pointer ${shareMode === o.id ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40' : 'border-slate-200 dark:border-slate-700'}`}
            >
              <div className="font-bold flex items-center gap-1.5 text-slate-900 dark:text-white">
                <o.Icon className="w-4 h-4" /> {o.title}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300">{o.text}</div>
            </button>
          ))}
        </div>
        <label className="text-xs space-y-1 block">
          <span>Quanto você quer pagar {distanceKm ? `(${distanceKm} km · mínimo ${formatBRL(floor)})` : ''}</span>
          <input inputMode="decimal" placeholder={suggestion ? `Sugestão: ${formatBRL(suggestion)}` : 'Valor (R$)'} value={offer} onChange={(e) => setOffer(e.target.value)} className={input} />
        </label>
        <input aria-label="Observações" placeholder="Observações (malas, criança, animal...)" value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
        {formError && (
          <div role="alert" className={alertBox + ' font-semibold'}>
            {formError}
          </div>
        )}
        <button type="submit" disabled={busy === 'publish'} className="w-full min-h-[44px] rounded-xl bg-emerald-600 text-white font-bold cursor-pointer disabled:opacity-60">
          {busy === 'publish' ? 'Lançando...' : 'Lançar pedido para os motoristas'}
        </button>
        <p className="text-[11px] text-slate-600 dark:text-slate-300">O valor só sai da sua carteira quando você aceitar uma proposta. O pedido fica aberto até o horário marcado.</p>
      </form>

      <section className={box}>
        <h3 className="font-bold text-slate-900 dark:text-white">Meus pedidos</h3>
        {meus.length === 0 && <p className="text-xs text-slate-600 dark:text-slate-300">Você ainda não lançou nenhuma viagem agendada.</p>}
        {meus.map((r) => {
          const chosen = r.offers.find((o) => o.id === r.acceptedOfferId);
          return (
            <div key={r.id} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-slate-900 dark:text-white">
                  {quando(r)} · {cidade(r.origin)} → {cidade(r.destination)}
                </div>
                <ModoBadge r={r} />
              </div>
              <div>
                {r.status === 'open' && `Aguardando propostas · você ofereceu ${formatBRL(r.passengerOffer)}`}
                {r.status === 'matched' && chosen && `Combinado com ${chosen.driverName} (${chosen.vehicleModel} · ${chosen.vehiclePlate}) por ${formatBRL(chosen.offeredPrice)}`}
                {r.status === 'completed' && 'Viagem concluída'}
                {r.status === 'cancelled' && 'Cancelada'}
              </div>
              {r.status === 'open' && r.lastDriverCancel && <div className={alertBox}>O motorista anterior desistiu. Você recebeu o valor de volta e o pedido voltou para os outros motoristas.</div>}
              {r.status === 'open' &&
                [...r.offers]
                  .sort((a, b) => a.offeredPrice - b.offeredPrice)
                  .map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {o.driverName} · <Star className="inline w-3 h-3" /> {o.driverRating} · {o.tripsCount} viagens
                        </div>
                        <div>
                          {o.vehicleModel}
                          {o.note ? ` · "${o.note}"` : ''}
                        </div>
                      </div>
                      <button type="button" onClick={() => onAcceptOffer(r.id, o.id)} className="shrink-0 min-h-[36px] px-3 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer">
                        <Check className="inline w-3 h-3" /> {formatBRL(o.offeredPrice)}
                      </button>
                    </div>
                  ))}
              {r.status === 'matched' && r.boardingPin && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 p-2">
                  <div className="font-semibold">PIN de embarque (mostre ao motorista ao entrar no carro):</div>
                  <div className="text-2xl font-extrabold tracking-[0.3em] text-emerald-700 dark:text-emerald-300">{r.boardingPin}</div>
                </div>
              )}
              {r.status === 'matched' && safety(r, chosen)}
              {(r.status === 'open' || (r.status === 'matched' && r.boardingStatus !== 'boarded')) &&
                (confirming === r.id ? (
                  <div role="alert" className={alertBox + ' space-y-2'}>
                    <div>
                      {r.status === 'open'
                        ? 'Cancelar o pedido não custa nada (ainda não há acordo).'
                        : r.cancelPreview
                          ? `Se cancelar agora você recebe ${formatBRL(r.cancelPreview.refund ?? 0)} de ${formatBRL(r.cancelPreview.paid ?? 0)}.${(r.cancelPreview.refund ?? 0) < (r.cancelPreview.paid ?? 0) ? ' A diferença vai para o motorista, que reservou o horário para você.' : ''}`
                          : 'Cancelar esta viagem.'}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setConfirming(null); void onCancelRequest(r.id); }} className="flex-1 min-h-[36px] rounded-lg bg-red-600 text-white font-semibold cursor-pointer">
                        Sim, cancelar
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="px-3 min-h-[36px] rounded-lg border border-slate-300 font-semibold cursor-pointer">
                        Voltar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirming(r.id)} className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer">
                    Cancelar
                  </button>
                ))}
            </div>
          );
        })}
      </section>
      {regras}
    </div>
  );
};
