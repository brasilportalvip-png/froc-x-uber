import { CARGO_VEHICLE_TYPES } from '../data/cargoVehicles.ts';
import { CubageCalculator } from './CubageCalculator.tsx';
import truckImg from '../assets/images/fleet_truck_cargo_1794683388987.jpg';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Box, CheckCircle2, Home, PackageCheck, Plus, ShieldCheck, Star, Truck } from 'lucide-react';
import { formatBRL } from '../data/locations.ts';
import { choosePoint, isChoosePoint, isPlaceMissing, startPointFrom } from '../lib/currentLocation.ts';
import type { EmptyTruckRoute, FreightRequest, GeoPoint, TruckType, UserProfile, UserRole } from '../types/mobility.ts';
import { PlacePicker } from './PlacePicker.tsx';
import { useCitySearch } from '../lib/citySearch.ts';

interface TruckFreightPanelProps {
  role: UserRole;
  profile: UserProfile;
  emptyTrucks: EmptyTruckRoute[];
  freights: FreightRequest[];
  /** Onde a pessoa está agora (GPS). Os formulários começam daqui. */
  origin?: GeoPoint;
  onSelectRouteOnMap: (origin: GeoPoint, destination: GeoPoint) => void;
  onPublishEmptyTruck: (payload: {
    originId: string;
    destinationId: string;
    originPoint: GeoPoint;
    destinationPoint: GeoPoint;
    truckType: TruckType;
    direction: 'indo_vazio' | 'voltando_vazio' | 'espaco_parcial';
    availableTons: number;
    availableCubicM: number;
    emptyReturnPrice: number;
    departureDate: string;
    acceptsMoving: boolean;
    hasLiftgate: boolean;
  }) => Promise<void>;
  onReserveEmptyTruck: (id: string) => Promise<void>;
  onCreateFreight: (payload: {
    kind: 'mudanca_residencial' | 'carreto_rapido' | 'carga_paletizada' | 'veiculo_moto';
    title: string;
    originId: string;
    destinationId: string;
    originPoint: GeoPoint;
    destinationPoint: GeoPoint;
    truckTypeNeeded: TruckType;
    estimatedWeightKg: number;
    estimatedVolumeM3?: number;
    helpersNeeded: number;
    hasElevator: boolean;
    needsPacking: boolean;
    proposedBudget: number;
    scheduledDate: string;
  }) => Promise<void>;
  onSendFreightBid: (freightId: string, price: number, helpersIncluded: number, note: string) => Promise<void>;
  onAcceptFreightBid: (freightId: string, bidId: string) => Promise<void>;
  onTruckAction: (id: string, action: 'complete' | 'cancel') => Promise<void>;
  onFreightAction: (id: string, action: 'deliver' | 'cancel') => Promise<void>;
  canPublishTruck: boolean;
}

const TRUCK_TYPES: TruckType[] = [...CARGO_VEHICLE_TYPES];

export const TruckFreightPanel: React.FC<TruckFreightPanelProps> = ({
  role,
  profile,
  origin,
  emptyTrucks,
  freights,
  onSelectRouteOnMap,
  onPublishEmptyTruck,
  onReserveEmptyTruck,
  onCreateFreight,
  onSendFreightBid,
  onAcceptFreightBid,
  onTruckAction,
  onFreightAction,
  canPublishTruck,
}) => {
  const [subTab, setSubTab] = useState<'empty_return' | 'moving_freight'>('empty_return');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchCity, setSearchCity] = useState('');


  // Empty truck publish state (Trucker)
  // Qualquer cidade do Brasil (busca do Google).
  // Sem cidades fixas de exemplo: a origem começa onde a pessoa está e o destino ela escolhe.
  const [etOrigin, setEtOrigin] = useState<GeoPoint>(() => startPointFrom(origin, 'Toque para escolher a cidade de origem'));
  const [etDest, setEtDest] = useState<GeoPoint>(() => choosePoint('Toque para escolher a cidade de destino'));
  const [formError, setFormError] = useState('');
  // O tipo de caminhão é o do cadastro aprovado (não muda por anúncio).
  const etType: TruckType = profile.truckType;
  const [etDir, setEtDir] = useState<'indo_vazio' | 'voltando_vazio' | 'espaco_parcial'>('voltando_vazio');
  const [etTons, setEtTons] = useState('18');
  const [etCubic, setEtCubic] = useState('60');
  const [etPrice, setEtPrice] = useState('1650');
  const [etDate, setEtDate] = useState('');
  const [etMoving, setEtMoving] = useState(true);
  const [etLiftgate, setEtLiftgate] = useState(true);

  // Moving / Freight request state (Client)
  const [frKind, setFrKind] = useState<'mudanca_residencial' | 'carreto_rapido' | 'carga_paletizada' | 'veiculo_moto'>(
    'mudanca_residencial'
  );
  const [frTitle, setFrTitle] = useState('Mudança Residencial Completa');
  // Endereço de coleta e de entrega em qualquer lugar do Brasil.
  const [frOrigin, setFrOrigin] = useState<GeoPoint>(() => startPointFrom(origin, 'Toque para escolher o endereço de coleta'));
  const [frDest, setFrDest] = useState<GeoPoint>(() => choosePoint('Toque para escolher o endereço de entrega'));
  // O GPS respondeu depois: a origem dos formulários vira a localização atual.
  useEffect(() => {
    if (!origin || isPlaceMissing(origin)) return;
    setEtOrigin((p) => (isChoosePoint(p) ? origin : p));
    setFrOrigin((p) => (isChoosePoint(p) ? origin : p));
  }, [origin]);
  const [frTruck, setFrTruck] = useState<TruckType>('3/4 Baú');
  const [frWeight, setFrWeight] = useState('1500');
  const [frVolume, setFrVolume] = useState('12');
  const [frHelpers, setFrHelpers] = useState('2');
  const [frBudget, setFrBudget] = useState('980');
  const [frDate, setFrDate] = useState('');
  const [frElevator, setFrElevator] = useState(true);
  const [frPacking, setFrPacking] = useState(true);

  // Trucker bid inputs
  const [bidPrices, setBidPrices] = useState<Record<string, string>>({});
  const [bidNotes, setBidNotes] = useState<Record<string, string>>({});

  const allTrucks = useCitySearch('emptyTrucks', searchCity, emptyTrucks);
  const filteredTrucks = useMemo(() => {
    const q = searchCity.trim().toLowerCase();
    return allTrucks.filter((t) => {
      if (!q) return true;
      return (
        t.origin.city.toLowerCase().includes(q) ||
        t.destination.city.toLowerCase().includes(q) ||
        t.truckType.toLowerCase().includes(q)
      );
    });
  }, [allTrucks, searchCity]);

  const handlePublishEmpty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPlaceMissing(etOrigin) || isPlaceMissing(etDest)) {
      setFormError('Escolha a cidade de origem e a cidade de destino.');
      return;
    }
    setFormError('');
    setBusyId('pub-empty');
    try {
      await onPublishEmptyTruck({
        originId: etOrigin.id,
        destinationId: etDest.id,
        originPoint: { ...etOrigin, zone: 'intercity' },
        destinationPoint: { ...etDest, zone: 'intercity' },
        truckType: etType,
        direction: etDir,
        availableTons: Number(etTons) || 12,
        availableCubicM: Number(etCubic) || 40,
        emptyReturnPrice: Number(etPrice) || 1200,
        departureDate: etDate,
        acceptsMoving: etMoving,
        hasLiftgate: etLiftgate,
      });
      setShowCreateForm(false);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateFreight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPlaceMissing(frOrigin) || isPlaceMissing(frDest)) {
      setFormError('Escolha o endereço de coleta e o endereço de entrega.');
      return;
    }
    setFormError('');
    setBusyId('pub-freight');
    try {
      await onCreateFreight({
        kind: frKind,
        title: frTitle,
        originId: frOrigin.id,
        destinationId: frDest.id,
        originPoint: frOrigin,
        destinationPoint: frDest,
        truckTypeNeeded: frTruck,
        estimatedWeightKg: Number(frWeight) || 1200,
        estimatedVolumeM3: Number(frVolume) || 1,
        helpersNeeded: Number(frHelpers) || 2,
        hasElevator: frElevator,
        needsPacking: frPacking,
        proposedBudget: Number(frBudget) || 950,
        scheduledDate: frDate,
      });
      setShowCreateForm(false);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Truck Hero Showcase Banner */}
      <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 h-28 bg-slate-900">
        <img
          src={truckImg}
          alt="Caminhão baú Froc em rodovia brasileira"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-75"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-transparent p-4 flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-semibold text-amber-400">Froc Carga · Retorno Vazio & Mudanças</div>
            <h3 className="text-base font-bold text-white leading-tight mt-0.5">
              Caminhões indo ou vindo vazios com até 60% de desconto
            </h3>
          </div>
          <div className="text-[11px] text-slate-300">
            Aproveite baús vazios na rodovia ou receba lances para sua mudança completa.
          </div>
        </div>
      </div>

      {/* Sub-navigation Segmented Control */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => {
            setSubTab('empty_return');
            setShowCreateForm(false);
          }}
          className={`flex-1 min-h-[40px] px-3 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            subTab === 'empty_return'
              ? 'bg-white dark:bg-[#1A2232] text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Retorno Vazio ({emptyTrucks.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setSubTab('moving_freight');
            setShowCreateForm(false);
          }}
          className={`flex-1 min-h-[40px] px-3 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            subTab === 'moving_freight'
              ? 'bg-white dark:bg-[#1A2232] text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Mudanças & Fretes ({freights.length})
        </button>
      </div>

      {subTab === 'empty_return' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchCity}
              onChange={(e) => setSearchCity(e.target.value)}
              placeholder="Filtrar rota ou veículo (ex: Curitiba, Van, Sider)..."
              className="flex-1 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111013] px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
            />
            {role === 'trucker' && canPublishTruck && (
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="px-3 min-h-[42px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showCreateForm ? 'Ver Rotas' : 'Estou Indo/Vindo Vazio'}</span>
            </button>
            )}
          </div>

          {showCreateForm ? (
            <form
              onSubmit={handlePublishEmpty}
              className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-3"
            >
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Cadastrar veículo de carga em deslocamento vazio
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <PlacePicker label="Origem da viagem" mode="cities" value={etOrigin} onChange={setEtOrigin} />
                <PlacePicker label="Destino da viagem" mode="cities" value={etDest} onChange={setEtDest} />
              </div>
              {formError && (
                <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-3 py-2 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Veículo</label>
                  <div className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 text-xs font-semibold flex items-center">
                    {etType} · {profile.truckPlate}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Situação da carroceria</label>
                  <select
                    value={etDir}
                    onChange={(e) => setEtDir(e.target.value as 'indo_vazio' | 'voltando_vazio' | 'espaco_parcial')}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 text-xs font-semibold"
                  >
                    <option value="voltando_vazio">Voltando 100% vazio</option>
                    <option value="indo_vazio">Indo buscar carga (vazio)</option>
                    <option value="espaco_parcial">Espaço parcial livre</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Toneladas livres</label>
                  <input
                    type="number"
                    value={etTons}
                    onChange={(e) => setEtTons(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Volume (m³)</label>
                  <input
                    type="number"
                    value={etCubic}
                    onChange={(e) => setEtCubic(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Valor retorno (R$)</label>
                  <input
                    type="number"
                    value={etPrice}
                    onChange={(e) => setEtPrice(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Saída</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex.: 20/12 às 22h"
                    value={etDate}
                    onChange={(e) => setEtDate(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={etMoving} onChange={(e) => setEtMoving(e.target.checked)} />
                  <span>Aceito mudanças residenciais</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={etLiftgate} onChange={(e) => setEtLiftgate(e.target.checked)} />
                  <span>Possui plataforma elevatória</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={busyId === 'pub-empty'}
                className="w-full min-h-[46px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold cursor-pointer"
              >
                {busyId === 'pub-empty' ? 'Publicando...' : 'Publicar Rota de Retorno Vazio'}
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              {filteredTrucks.map((t) => (
                <div
                  key={t.id}
                  onClick={() => onSelectRouteOnMap(t.origin, t.destination)}
                  className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 hover:border-amber-500/70 p-4 space-y-3 transition cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                        {t.direction === 'voltando_vazio'
                          ? 'Voltando Vazio'
                          : t.direction === 'indo_vazio'
                            ? 'Indo Vazio'
                            : 'Espaço Parcial'}{' '}
                        · {t.discountPercent}% abaixo da tabela · {t.truckType}
                      </div>
                      <h4 className="text-base font-bold text-slate-900 dark:text-white mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>
                          {t.origin.city}/{t.origin.state}
                        </span>
                        <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>
                          {t.destination.city}/{t.destination.state}
                        </span>
                      </h4>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {t.departureDate} · {t.distanceKm} km · {t.availableTons}t / {t.availableCubicM}m³ livres
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[11px] line-through text-slate-400 font-mono-num">
                        {formatBRL(t.standardPrice)}
                      </div>
                      <div className="text-lg font-bold font-mono-num text-emerald-600 dark:text-emerald-400">
                        {formatBRL(t.emptyReturnPrice)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="min-w-0 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                        <Truck className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="truncate">{t.truckerName}</span>
                        {t.verified && <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                        <span className="inline-flex items-center gap-0.5 text-amber-500 font-mono-num">
                          <Star className="w-3 h-3 fill-amber-500" />
                          {t.truckerRating}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {t.companyName} · Placa <span className="font-mono-num">{t.truckPlate}</span>
                        {t.acceptsMoving ? ' · Faz mudanças' : ''}
                        {t.hasLiftgate ? ' · Plataforma' : ''}
                      </div>
                    </div>

                    {t.mine === null && t.status === 'available' && (
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={async (e) => {
                        e.stopPropagation();
                        setBusyId(t.id);
                        try {
                          await onReserveEmptyTruck(t.id);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="px-3.5 min-h-[40px] rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer bg-slate-900 dark:bg-amber-600 hover:opacity-90 text-white"
                    >
                      {busyId === t.id ? 'Reservando...' : 'Reservar (pago pela carteira)'}
                    </button>
                    )}
                  </div>
                  {t.mine === 'owner' && (
                    <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs space-y-2" onClick={(e) => e.stopPropagation()}>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {t.status === 'completed' ? 'Frete concluído.' : 'Você reservou este veículo. Valor retido até a entrega.'}
                      </div>
                      {t.truckerPhone && <div>Combine com o caminhoneiro: <strong className="font-mono-num">{t.truckerPhone}</strong></div>}
                      {t.status === 'reserved' && (
                        <button type="button" onClick={() => onTruckAction(t.id, 'cancel')} className="px-3 min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer">
                          Cancelar reserva (estorno)
                        </button>
                      )}
                    </div>
                  )}
                  {t.mine === 'provider' && (
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-2" onClick={(e) => e.stopPropagation()}>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {t.status === 'available' && 'Sua rota está na vitrine aguardando cliente.'}
                        {t.status === 'reserved' && `Reservado por ${t.reservedBy}.`}
                        {t.status === 'completed' && 'Frete concluído e pago.'}
                        {t.status === 'cancelled' && 'Rota cancelada.'}
                      </div>
                      {t.status === 'reserved' && t.reservedPhone && <div>Telefone do cliente: <strong className="font-mono-num">{t.reservedPhone}</strong></div>}
                      <div className="flex gap-2">
                        {t.status === 'reserved' && (
                          <button type="button" onClick={() => onTruckAction(t.id, 'complete')} className="flex-1 min-h-[36px] rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer">
                            Entrega feita · receber
                          </button>
                        )}
                        {(t.status === 'available' || t.status === 'reserved') && (
                          <button type="button" onClick={() => onTruckAction(t.id, 'cancel')} className="px-3 min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer">
                            {t.status === 'available' ? 'Retirar rota' : 'Cancelar (cliente é reembolsado)'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-600 dark:text-slate-300">
              Solicite mudanças, carretos ou cargas e compare lances de caminhoneiros.
            </span>
            {role !== 'trucker' && (
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="px-3 min-h-[40px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showCreateForm ? 'Ver Pedidos' : 'Pedir Mudança / Frete'}</span>
            </button>
            )}
          </div>

          {showCreateForm ? (
            <form
              onSubmit={handleCreateFreight}
              className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-3"
            >
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Novo pedido de mudança ou frete</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Tipo de serviço</label>
                  <select
                    value={frKind}
                    onChange={(e) =>
                      setFrKind(
                        e.target.value as 'mudanca_residencial' | 'carreto_rapido' | 'carga_paletizada' | 'veiculo_moto'
                      )
                    }
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 text-xs font-semibold"
                  >
                    <option value="mudanca_residencial">Mudança Residencial / Comercial</option>
                    <option value="carreto_rapido">Pequeno Carreto / Eletrodomésticos</option>
                    <option value="carga_paletizada">Carga Paletizada / Comercial</option>
                    <option value="veiculo_moto">Transporte de Moto / Veículo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Veículo desejado</label>
                  <select
                    value={frTruck}
                    onChange={(e) => setFrTruck(e.target.value as TruckType)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 text-xs font-semibold"
                  >
                    {TRUCK_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <input
                type="text"
                value={frTitle}
                onChange={(e) => setFrTitle(e.target.value)}
                placeholder="Título da mudança ou carga..."
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-xs font-semibold"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <PlacePicker label="Endereço de coleta" mode="address" value={frOrigin} onChange={setFrOrigin} />
                <PlacePicker label="Endereço de entrega" mode="address" value={frDest} onChange={setFrDest} />
              </div>
              {formError && (
                <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-3 py-2 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <CubageCalculator
                onApply={({ volumeM3, weightKg, truck }) => {
                  setFrVolume(String(volumeM3));
                  setFrWeight(String(weightKg));
                  setFrTruck(truck);
                }}
              />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Volume (m³)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0.1}
                    value={frVolume}
                    onChange={(e) => setFrVolume(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Peso est. (kg)</label>
                  <input
                    type="number"
                    value={frWeight}
                    onChange={(e) => setFrWeight(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Ajudantes</label>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={frHelpers}
                    onChange={(e) => setFrHelpers(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Data e horário da coleta</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex.: 20/12 às 8h"
                    value={frDate}
                    onChange={(e) => setFrDate(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Orçamento (R$)</label>
                  <input
                    type="number"
                    value={frBudget}
                    onChange={(e) => setFrBudget(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold font-mono-num"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={frElevator} onChange={(e) => setFrElevator(e.target.checked)} />
                  <span>Prédio com elevador</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={frPacking} onChange={(e) => setFrPacking(e.target.checked)} />
                  <span>Precisa de embalagem / mantas</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={busyId === 'pub-freight'}
                className="w-full min-h-[46px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-sm font-bold cursor-pointer"
              >
                {busyId === 'pub-freight' ? 'Publicando...' : 'Publicar Pedido e Receber Lances'}
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              {freights.map((f) => (
                <div
                  key={f.id}
                  onClick={() => onSelectRouteOnMap(f.origin, f.destination)}
                  className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-3 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        {f.kind === 'mudanca_residencial' ? (
                          <Home className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Box className="w-3.5 h-3.5 text-amber-500" />
                        )}
                        <span>{f.truckTypeNeeded}</span>
                        <span>·</span>
                        <span className="font-mono-num">{f.estimatedWeightKg} kg</span>
                        {f.estimatedVolumeM3 ? (
                          <>
                            <span>·</span>
                            <span className="font-mono-num">{f.estimatedVolumeM3} m³</span>
                          </>
                        ) : null}
                        <span>·</span>
                        <span>{f.helpersNeeded} ajudantes</span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">{f.title}</h4>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {f.origin.city}/{f.origin.state} → {f.destination.city}/{f.destination.state} ({f.distanceKm} km) ·{' '}
                        {f.scheduledDate}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-slate-500">Orçamento</div>
                      <div className="text-base font-bold font-mono-num text-slate-900 dark:text-white">
                        {formatBRL(f.proposedBudget)}
                      </div>
                    </div>
                  </div>

                  {role === 'trucker' && f.status === 'open_bids' && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900 p-3 space-y-2"
                    >
                      <div className="text-xs font-bold text-amber-900 dark:text-amber-300">
                        Enviar lance como {profile.name} ({profile.truckType})
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={bidPrices[f.id] ?? String(f.proposedBudget)}
                          onChange={(e) => setBidPrices((p) => ({ ...p, [f.id]: e.target.value }))}
                          className="w-28 min-h-[40px] rounded-xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-950 px-2.5 text-xs font-bold font-mono-num"
                        />
                        <input
                          type="text"
                          placeholder="Ex: Estou indo vazio nessa rota..."
                          value={bidNotes[f.id] ?? ''}
                          onChange={(e) => setBidNotes((p) => ({ ...p, [f.id]: e.target.value }))}
                          className="flex-1 min-h-[40px] rounded-xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-950 px-2.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onSendFreightBid(
                              f.id,
                              Number(bidPrices[f.id] ?? f.proposedBudget),
                              f.helpersNeeded,
                              bidNotes[f.id] || 'Caminhão disponível com rastreador e cintas.'
                            )
                          }
                          className="px-3 min-h-[40px] rounded-xl bg-amber-600 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
                        >
                          Enviar Lance
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Freight Bids */}
                  <div className="space-y-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    {f.bids.map((b) => {
                      const isAccepted = f.status === 'booked' && f.acceptedBidId === b.id;
                      return (
                        <div
                          key={b.id}
                          className={`rounded-xl p-3 border flex items-center justify-between gap-3 ${
                            isAccepted
                              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400'
                              : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <div className="min-w-0 text-xs">
                            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span className="truncate">{b.truckerName}</span>
                              <span className="inline-flex items-center gap-0.5 text-amber-500 font-mono-num shrink-0">
                                <Star className="w-3 h-3 fill-amber-500" />
                                {b.truckerRating}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {b.truckType} · {b.helpersIncluded} ajudante(s) · {b.etaText}
                            </div>
                            <div className="text-slate-600 dark:text-slate-300 mt-1">{b.note}</div>
                          </div>
                          <div className="text-right shrink-0 space-y-1">
                            <div className="text-sm font-bold font-mono-num text-emerald-600 dark:text-emerald-400">
                              {formatBRL(b.price)}
                            </div>
                            {f.status === 'open_bids' && f.mine === 'owner' ? (
                              <button
                                type="button"
                                onClick={() => onAcceptFreightBid(f.id, b.id)}
                                className="px-3 min-h-[36px] rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                              >
                                Contratar
                              </button>
                            ) : isAccepted ? (
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Fechado
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {f.mine === 'owner' && f.bids.length === 0 && f.status === 'open_bids' && (
                    <div className="text-xs text-slate-500">Aguardando lances dos caminhoneiros (a tela atualiza sozinha).</div>
                  )}
                  {f.status === 'booked' && (
                    <div className="space-y-2 text-xs" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                        <PackageCheck className="w-4 h-4" />
                        <span>Frete contratado: o valor fica retido até a entrega ser confirmada.</span>
                      </div>
                      {f.mine === 'owner' && f.truckerPhone && <div>Telefone do caminhoneiro: <strong className="font-mono-num">{f.truckerPhone}</strong></div>}
                      {f.mine === 'provider' && f.clientPhone && <div>Telefone do cliente: <strong className="font-mono-num">{f.clientPhone}</strong></div>}
                      {f.mine === 'provider' && (
                        <button type="button" onClick={() => onFreightAction(f.id, 'deliver')} className="px-3 min-h-[36px] rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer">
                          Entrega feita · receber
                        </button>
                      )}
                    </div>
                  )}
                  {f.mine === 'owner' && (f.status === 'open_bids' || f.status === 'booked') && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onFreightAction(f.id, 'cancel');
                      }}
                      className="px-3 min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      {f.status === 'booked' ? 'Cancelar frete (valor volta para a carteira)' : 'Cancelar pedido'}
                    </button>
                  )}
                  {f.status === 'delivered' && <div className="text-xs font-semibold text-emerald-600">Entregue.</div>}
                  {f.status === 'cancelled' && <div className="text-xs font-semibold text-slate-500">Cancelado.</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
