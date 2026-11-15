import React, { useCallback, useEffect, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Car, HandCoins, Map as MapIcon, Moon, Sun, Truck, Users, Wallet } from 'lucide-react';
import { BlaBlaCarPanel } from './components/BlaBlaCarPanel.tsx';
import { GoogleMapsView } from './components/GoogleMapsView.tsx';
import { InDrivePanel } from './components/InDrivePanel.tsx';
import { InteractiveMap } from './components/InteractiveMap.tsx';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton.tsx';
import { TruckFreightPanel } from './components/TruckFreightPanel.tsx';
import { Uber99Panel } from './components/Uber99Panel.tsx';
import { WalletAccountPanel } from './components/WalletAccountPanel.tsx';
import { BRAZIL_LOCATIONS, formatBRL } from './data/locations.ts';
import { useOnlineStatus } from './hooks/useOnlineStatus.ts';
import type {
  AppBootstrapState,
  AppModule,
  GeoPoint,
  RideCategoryId,
  TruckType,
  UserProfile,
  UserRole,
} from './types/mobility.ts';

export default function App() {
  const [state, setState] = useState<AppBootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mapsApiKey, setMapsApiKey] = useState<string>(
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || ''
  );
  const [liveDistanceKm, setLiveDistanceKm] = useState<number | null>(null);
  const isOnline = useOnlineStatus();

  const [activeModule, setActiveModule] = useState<AppModule>('rides');
  const [role, setRole] = useState<UserRole>('passenger');
  const [isDark, setIsDark] = useState<boolean>(false);
  const [showMobileMap, setShowMobileMap] = useState<boolean>(true);
  const [toast, setToast] = useState<string | null>(null);

  const [origin, setOrigin] = useState<GeoPoint>(BRAZIL_LOCATIONS[0]);
  const [destination, setDestination] = useState<GeoPoint>(BRAZIL_LOCATIONS[4]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [isDark]);

  const loadBootstrap = useCallback(async () => {
    try {
      const [bootRes, mapsRes] = await Promise.all([
        fetch('/api/bootstrap'),
        fetch('/api/maps-config').catch(() => null),
      ]);
      if (!bootRes.ok) throw new Error('Falha ao carregar dados da plataforma.');
      const data = (await bootRes.json()) as AppBootstrapState;
      setState(data);
      if (mapsRes && mapsRes.ok) {
        const cfg = (await mapsRes.json()) as { apiKey?: string };
        if (cfg.apiKey && !mapsApiKey) {
          setMapsApiKey(cfg.apiKey);
        }
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, [mapsApiKey]);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  const handleSelectModule = (mod: AppModule) => {
    setActiveModule(mod);
    if (mod === 'carpool' || mod === 'freight') {
      const sp = BRAZIL_LOCATIONS.find((l) => l.id === 'sp-tiete') || BRAZIL_LOCATIONS[3];
      const rj = BRAZIL_LOCATIONS.find((l) => l.id === 'br-rio') || BRAZIL_LOCATIONS[14];
      if (origin.zone === 'urban' && destination.zone === 'urban') {
        setOrigin(sp);
        setDestination(rj);
      }
      if (mod === 'freight' && role === 'driver') {
        setRole('trucker');
      }
    } else if (mod === 'rides' || mod === 'indrive') {
      const paulista = BRAZIL_LOCATIONS[0];
      const cgh = BRAZIL_LOCATIONS[4];
      if (origin.zone === 'intercity' && destination.zone === 'intercity') {
        setOrigin(paulista);
        setDestination(cgh);
      }
      if (role === 'trucker') {
        setRole('passenger');
      }
    }
  };

  // API Handlers
  const handleCreateRide = async (payload: {
    originId: string;
    destinationId: string;
    originPoint: GeoPoint;
    destinationPoint: GeoPoint;
    categoryId: RideCategoryId;
    paymentMethod: 'pix' | 'card' | 'cash' | 'froc_pay';
    stops: string[];
    promoCode: string;
  }) => {
    const res = await fetch('/api/rides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const ride = await res.json();
    setState((prev) => (prev ? { ...prev, rides: [ride, ...prev.rides] } : prev));
    showToast(`Motorista ${ride.driverName} confirmado (${ride.etaMin} min)!`);
  };

  const handleRideAction = async (rideId: string, action: string, extra?: Record<string, string>) => {
    const res = await fetch(`/api/rides/${rideId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setState((prev) =>
      prev
        ? {
            ...prev,
            rides: prev.rides.map((r) => (r.id === rideId ? data.ride : r)),
            profile: data.profile,
            transactions: data.transactions,
          }
        : prev
    );
    if (action === 'complete') showToast('Viagem concluída e registrada na carteira!');
    if (action === 'driver_accept') showToast('Corrida aceita com sucesso!');
  };

  const handleCreateInDrive = async (payload: {
    originId: string;
    destinationId: string;
    originPoint: GeoPoint;
    destinationPoint: GeoPoint;
    passengerOffer: number;
    paymentMethod: 'pix' | 'cash' | 'card';
    notes: string;
  }) => {
    const res = await fetch('/api/indrive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const created = await res.json();
    setState((prev) => (prev ? { ...prev, indriveRequests: [created, ...prev.indriveRequests] } : prev));
    showToast('Oferta publicada! Motoristas já estão respondendo.');
  };

  const handleSendDriverOffer = async (requestId: string, offeredPrice: number, etaMin: number, note: string) => {
    const res = await fetch(`/api/indrive/${requestId}/offers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offeredPrice, etaMin, note }),
    });
    if (!res.ok) return;
    const updated = await res.json();
    setState((prev) =>
      prev
        ? { ...prev, indriveRequests: prev.indriveRequests.map((r) => (r.id === requestId ? updated : r)) }
        : prev
    );
    showToast('Contraproposta enviada ao passageiro!');
  };

  const handleAcceptInDrive = async (requestId: string, offerId: string) => {
    const res = await fetch(`/api/indrive/${requestId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerId }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setState((prev) =>
      prev
        ? {
            ...prev,
            indriveRequests: prev.indriveRequests.map((r) => (r.id === requestId ? data.request : r)),
            transactions: data.transactions,
          }
        : prev
    );
    showToast('Negociação aceita! Motorista a caminho.');
  };

  const handleBookCarpool = async (tripId: string, seats: number) => {
    const res = await fetch(`/api/carpools/${tripId}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seats }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setState((prev) =>
      prev
        ? {
            ...prev,
            carpools: prev.carpools.map((c) => (c.id === tripId ? data.trip : c)),
            profile: data.profile,
            transactions: data.transactions,
          }
        : prev
    );
    showToast(`${seats} vaga(s) reservada(s) na carona!`);
  };

  const handlePublishCarpool = async (payload: {
    originId: string;
    destinationId: string;
    date: string;
    departureTime: string;
    pricePerSeat: number;
    totalSeats: number;
    pickupSpot: string;
    dropoffSpot: string;
    pets: boolean;
    music: boolean;
  }) => {
    const res = await fetch('/api/carpools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const created = await res.json();
    setState((prev) => (prev ? { ...prev, carpools: [created, ...prev.carpools] } : prev));
    showToast('Carona publicada para passageiros na rota!');
  };

  const handlePublishEmptyTruck = async (payload: {
    originId: string;
    destinationId: string;
    truckType: TruckType;
    direction: 'indo_vazio' | 'voltando_vazio' | 'espaco_parcial';
    availableTons: number;
    availableCubicM: number;
    emptyReturnPrice: number;
    departureDate: string;
    acceptsMoving: boolean;
    hasLiftgate: boolean;
  }) => {
    const res = await fetch('/api/empty-trucks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const created = await res.json();
    setState((prev) => (prev ? { ...prev, emptyTrucks: [created, ...prev.emptyTrucks] } : prev));
    showToast('Rota de retorno vazio publicada na vitrine!');
  };

  const handleReserveEmptyTruck = async (id: string) => {
    const res = await fetch(`/api/empty-trucks/${id}/reserve`, { method: 'POST' });
    if (!res.ok) return;
    const data = await res.json();
    setState((prev) =>
      prev
        ? {
            ...prev,
            emptyTrucks: prev.emptyTrucks.map((t) => (t.id === id ? data.route : t)),
            transactions: data.transactions,
          }
        : prev
    );
    showToast('Caminhão em retorno vazio reservado com desconto!');
  };

  const handleCreateFreight = async (payload: {
    kind: 'mudanca_residencial' | 'carreto_rapido' | 'carga_paletizada' | 'veiculo_moto';
    title: string;
    originId: string;
    destinationId: string;
    truckTypeNeeded: TruckType;
    estimatedWeightKg: number;
    helpersNeeded: number;
    hasElevator: boolean;
    needsPacking: boolean;
    proposedBudget: number;
    scheduledDate: string;
  }) => {
    const res = await fetch('/api/freights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const created = await res.json();
    setState((prev) => (prev ? { ...prev, freights: [created, ...prev.freights] } : prev));
    showToast('Pedido de mudança/frete publicado! Lances disponíveis.');
  };

  const handleSendFreightBid = async (freightId: string, price: number, helpersIncluded: number, note: string) => {
    const res = await fetch(`/api/freights/${freightId}/bids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price, helpersIncluded, note }),
    });
    if (!res.ok) return;
    const updated = await res.json();
    setState((prev) =>
      prev ? { ...prev, freights: prev.freights.map((f) => (f.id === freightId ? updated : f)) } : prev
    );
    showToast('Lance de frete enviado ao cliente!');
  };

  const handleAcceptFreightBid = async (freightId: string, bidId: string) => {
    const res = await fetch(`/api/freights/${freightId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidId }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setState((prev) =>
      prev
        ? {
            ...prev,
            freights: prev.freights.map((f) => (f.id === freightId ? data.freight : f)),
            transactions: data.transactions,
          }
        : prev
    );
    showToast('Caminhoneiro contratado com sucesso!');
  };

  const handleTopUpPix = async (amount: number) => {
    const res = await fetch('/api/wallet/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setState((prev) => (prev ? { ...prev, profile: data.profile, transactions: data.transactions } : prev));
    showToast(`Recarga Pix de ${formatBRL(amount)} creditada!`);
  };

  const handleUpdateProfile = async (patch: Partial<UserProfile>) => {
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return;
    const profile = await res.json();
    setState((prev) => (prev ? { ...prev, profile } : prev));
    showToast('Perfil e veículos atualizados.');
  };

  const handleResetDemo = async () => {
    const res = await fetch('/api/reset-demo', { method: 'POST' });
    if (!res.ok) return;
    const data = await res.json();
    setState(data);
    showToast('Dados iniciais restaurados.');
  };

  const activeRide = state?.rides.find((r) => r.status !== 'completed' && r.status !== 'cancelled');
  const activeStatusLabel = activeRide
    ? activeRide.status === 'in_progress'
      ? 'Em viagem'
      : `Chega em ${activeRide.etaMin || 3} min`
    : undefined;

  const useGoogleMaps = Boolean(mapsApiKey) && isOnline;

  const appShell = (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-14 lg:h-16 px-4 lg:px-6 bg-white/95 dark:bg-[#0B0F17]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-8">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            handleSelectModule('rides');
          }}
          className="font-display text-lg lg:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          Froc X Uber
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {(
            [
              { id: 'rides', label: 'Corridas' },
              { id: 'indrive', label: 'Negociar' },
              { id: 'carpool', label: 'Caronas' },
              { id: 'freight', label: 'Caminhões' },
              { id: 'wallet', label: 'Carteira' },
            ] as { id: AppModule; label: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectModule(item.id)}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeModule === item.id
                  ? 'border-emerald-600 text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center shrink-0">
          <PWAInstallButton />
        </div>
      </header>

      {/* Main Responsive Split Cockpit */}
      <main className="flex-1 flex flex-col lg:grid lg:grid-cols-[470px_1fr] lg:h-[calc(100vh-64px)] lg:overflow-hidden pb-16 lg:pb-0">
        {/* Map Section */}
        <section
          className={`${
            showMobileMap ? 'h-[34vh] min-h-[220px]' : 'hidden'
          } lg:block lg:h-full lg:order-2 relative border-b lg:border-b-0 lg:border-l border-slate-200 dark:border-slate-800`}
        >
          {useGoogleMaps ? (
            <GoogleMapsView
              activeModule={activeModule}
              origin={origin}
              destination={destination}
              isDark={isDark}
              activeTripStatus={activeStatusLabel}
              onRouteTelemetry={(km) => setLiveDistanceKm(km)}
              onSelectLocationFromMap={(point, target) => {
                if (target === 'origin') setOrigin(point);
                else setDestination(point);
                showToast(`${target === 'origin' ? 'Partida' : 'Destino'}: ${point.name}`);
              }}
            />
          ) : (
            <InteractiveMap
              activeModule={activeModule}
              origin={origin}
              destination={destination}
              isDark={isDark}
              activeTripStatus={activeStatusLabel}
              onSelectLocationFromMap={(point, target) => {
                if (target === 'origin') setOrigin(point);
                else setDestination(point);
                showToast(`${target === 'origin' ? 'Partida' : 'Destino'}: ${point.name}`);
              }}
            />
          )}

          {/* Desktop Bottom Metric Strip */}
          {state && (
            <div className="hidden lg:grid grid-cols-4 gap-4 absolute bottom-4 right-4 left-64 z-10 rounded-2xl bg-white/92 dark:bg-[#131924]/92 backdrop-blur-md border border-slate-200 dark:border-slate-800 px-5 py-3 shadow-sm">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Uber / 99</div>
                <div className="text-sm font-bold font-mono-num text-slate-900 dark:text-white">
                  {state.rides.filter((r) => r.status !== 'cancelled').length} corridas
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Leilão inDrive</div>
                <div className="text-sm font-bold font-mono-num text-sky-600 dark:text-sky-400">
                  {state.indriveRequests.filter((r) => r.status === 'open').length} ofertas abertas
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">BlaBlaCar</div>
                <div className="text-sm font-bold font-mono-num text-emerald-600 dark:text-emerald-400">
                  {state.carpools.reduce((acc, c) => acc + c.availableSeats, 0)} assentos livres
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Retorno Vazio</div>
                <div className="text-sm font-bold font-mono-num text-amber-600 dark:text-amber-400">
                  {state.emptyTrucks.filter((t) => t.status === 'available').length} caminhões na rota
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Left Workspace */}
        <section className="lg:order-1 flex flex-col lg:h-full lg:overflow-hidden bg-slate-50 dark:bg-[#0B0F17]">
          <div className="px-4 pt-3 pb-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101622] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 flex-1">
                {(
                  [
                    { id: 'passenger', label: 'Passageiro' },
                    { id: 'driver', label: 'Motorista' },
                    { id: 'trucker', label: 'Caminhoneiro' },
                  ] as { id: UserRole; label: string }[]
                ).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setRole(r.id);
                      if (r.id === 'trucker') setActiveModule('freight');
                    }}
                    className={`flex-1 min-h-[36px] px-2.5 rounded-lg text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
                      role === r.id
                        ? 'bg-white dark:bg-[#1B2436] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                aria-label="Alternar tema claro ou escuro"
                className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setShowMobileMap((v) => !v)}
                aria-label="Alternar mapa no celular"
                className="lg:hidden w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center text-emerald-600 shrink-0 cursor-pointer"
              >
                <MapIcon className="w-4 h-4" />
              </button>
            </div>

            {state && (
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="truncate">
                  {state.profile.name} · Nota{' '}
                  <strong className="font-mono-num text-slate-900 dark:text-white">{state.profile.rating}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setActiveModule('wallet')}
                  className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Saldo {formatBRL(state.profile.walletBalance)}
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto froc-scroll p-4 space-y-4">
            {loading ? (
              <div className="space-y-3 py-6">
                <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
                <div className="h-36 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
                <div className="h-36 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
              </div>
            ) : error || !state ? (
              <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-5 text-center space-y-3">
                <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                  {error || 'Não foi possível carregar os dados.'}
                </p>
                <button
                  type="button"
                  onClick={loadBootstrap}
                  className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
                >
                  Tentar novamente
                </button>
              </div>
            ) : (
              <>
                {activeModule === 'rides' && (
                  <Uber99Panel
                    role={role}
                    profile={state.profile}
                    origin={origin}
                    destination={destination}
                    rides={state.rides}
                    mapsEnabled={useGoogleMaps}
                    liveDistanceKm={liveDistanceKm}
                    onChangeOrigin={setOrigin}
                    onChangeDestination={setDestination}
                    onSwapLocations={() => {
                      const prevO = origin;
                      setOrigin(destination);
                      setDestination(prevO);
                    }}
                    onCreateRide={handleCreateRide}
                    onRideAction={handleRideAction}
                  />
                )}

                {activeModule === 'indrive' && (
                  <InDrivePanel
                    role={role}
                    profile={state.profile}
                    origin={origin}
                    destination={destination}
                    requests={state.indriveRequests}
                    mapsEnabled={useGoogleMaps}
                    liveDistanceKm={liveDistanceKm}
                    onChangeOrigin={setOrigin}
                    onChangeDestination={setDestination}
                    onSwapLocations={() => {
                      const prevO = origin;
                      setOrigin(destination);
                      setDestination(prevO);
                    }}
                    onCreateRequest={handleCreateInDrive}
                    onSendDriverOffer={handleSendDriverOffer}
                    onAcceptOffer={handleAcceptInDrive}
                  />
                )}

                {activeModule === 'carpool' && (
                  <BlaBlaCarPanel
                    role={role}
                    carpools={state.carpools}
                    origin={origin}
                    destination={destination}
                    onSelectRouteOnMap={(o, d) => {
                      setOrigin(o);
                      setDestination(d);
                    }}
                    onBookCarpool={handleBookCarpool}
                    onPublishCarpool={handlePublishCarpool}
                  />
                )}

                {activeModule === 'freight' && (
                  <TruckFreightPanel
                    role={role}
                    profile={state.profile}
                    emptyTrucks={state.emptyTrucks}
                    freights={state.freights}
                    onSelectRouteOnMap={(o, d) => {
                      setOrigin(o);
                      setDestination(d);
                    }}
                    onPublishEmptyTruck={handlePublishEmptyTruck}
                    onReserveEmptyTruck={handleReserveEmptyTruck}
                    onCreateFreight={handleCreateFreight}
                    onSendFreightBid={handleSendFreightBid}
                    onAcceptFreightBid={handleAcceptFreightBid}
                  />
                )}

                {activeModule === 'wallet' && (
                  <WalletAccountPanel
                    profile={state.profile}
                    transactions={state.transactions}
                    onTopUpPix={handleTopUpPix}
                    onUpdateProfile={handleUpdateProfile}
                    onResetDemo={handleResetDemo}
                  />
                )}
              </>
            )}
          </div>
        </section>
      </main>

      {/* Mobile App Fixed Bottom Tab Bar */}
      <nav
        aria-label="Navegação do aplicativo"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 pb-safe bg-white/95 dark:bg-[#101622]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center"
      >
        {(
          [
            { id: 'rides', label: 'Corridas', Icon: Car },
            { id: 'indrive', label: 'inDrive', Icon: HandCoins },
            { id: 'carpool', label: 'Caronas', Icon: Users },
            { id: 'freight', label: 'Cargas', Icon: Truck },
            { id: 'wallet', label: 'Conta', Icon: Wallet },
          ] as { id: AppModule; label: string; Icon: React.ComponentType<{ className?: string }> }[]
        ).map(({ id, label, Icon }) => {
          const active = activeModule === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelectModule(id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">{label}</span>
            </button>
          );
        })}
      </nav>

      {toast && (
        <div
          role="status"
          className="fixed top-18 right-4 z-50 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white px-4 py-2.5 text-xs font-semibold shadow-xl max-w-xs"
        >
          {toast}
        </div>
      )}

      <OfflineIndicator />
    </div>
  );

  if (useGoogleMaps) {
    return (
      <APIProvider apiKey={mapsApiKey} language="pt-BR" region="BR" libraries={['routes', 'places']}>
        {appShell}
      </APIProvider>
    );
  }

  return appShell;
}
