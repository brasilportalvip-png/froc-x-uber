import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Car, HandCoins, Map as MapIcon, Moon, Shield, Sun, Truck, Users, Wallet } from 'lucide-react';
import { AdminPanel } from './components/AdminPanel.tsx';
import { AuthScreen } from './components/AuthScreen.tsx';
import { BlaBlaCarPanel } from './components/BlaBlaCarPanel.tsx';
import { GoogleMapsView } from './components/GoogleMapsView.tsx';
import { InDrivePanel } from './components/InDrivePanel.tsx';
import { InteractiveMap } from './components/InteractiveMap.tsx';
import { ProviderOnboarding } from './components/ProviderOnboarding.tsx';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton.tsx';
import { TruckFreightPanel } from './components/TruckFreightPanel.tsx';
import { Uber99Panel } from './components/Uber99Panel.tsx';
import { WalletAccountPanel } from './components/WalletAccountPanel.tsx';
import { BRAZIL_LOCATIONS, formatBRL } from './data/locations.ts';
import { useOnlineStatus } from './hooks/useOnlineStatus.ts';
import { api, fileToBase64, loadPublicConfig, logout, watchUser } from './lib/session.ts';
import type { AppBootstrapState, AppModule, GeoPoint, UserProfile, UserRole } from './types/mobility.ts';

export default function App() {
  const [state, setState] = useState<AppBootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [configError, setConfigError] = useState<string | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);

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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  };

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [isDark]);

  // 1) Configuração pública + acompanhamento do login
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    loadPublicConfig()
      .then((cfg) => {
        if (cfg.mapsApiKey && !mapsApiKey) setMapsApiKey(cfg.mapsApiKey);
        setPaymentsEnabled(cfg.paymentsEnabled);
        if (!cfg.firebase) {
          setConfigError('O app ainda está sendo configurado (login indisponível). Volte em instantes.');
          setUser(null);
          return;
        }
        unsubscribe = watchUser((u) => {
          setUser(u);
          if (!u) {
            setState(null);
            setLoading(false);
          }
        });
      })
      .catch(() => {
        setConfigError('Não foi possível conectar ao servidor. Verifique sua internet.');
        setUser(null);
      });
    return () => unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await api<AppBootstrapState>('/api/bootstrap');
      setState(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  // 2) Dados da pessoa logada + atualização automática (motoristas, propostas, lances)
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    void loadBootstrap();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void loadBootstrap();
    }, 6000);
    return () => clearInterval(timer);
  }, [user, loadBootstrap]);

  // 3) Volta do Mercado Pago (?recarga=ID): confere e credita assim que aprovado
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const topupId = params.get('recarga');
    if (!topupId) return;
    window.history.replaceState({}, '', window.location.pathname);
    setActiveModule('wallet');
    let tries = 0;
    const check = async () => {
      try {
        const r = await api<{ status: string }>(`/api/wallet/topups/${encodeURIComponent(topupId)}/confirm`, { body: {} });
        if (r.status === 'approved') {
          showToast('Recarga aprovada e creditada na carteira!');
          void loadBootstrap();
          return;
        }
      } catch {
        /* tenta de novo */
      }
      if (++tries < 20) setTimeout(check, 5000);
      else showToast('Pagamento ainda não confirmado. Assim que o Mercado Pago aprovar, o saldo aparece.');
    };
    showToast('Conferindo seu pagamento no Mercado Pago...');
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSelectModule = (mod: AppModule) => {
    setActiveModule(mod);
    if (mod === 'carpool' || mod === 'freight') {
      const sp = BRAZIL_LOCATIONS.find((l) => l.id === 'sp-tiete') || BRAZIL_LOCATIONS[3];
      const rj = BRAZIL_LOCATIONS.find((l) => l.id === 'br-rio') || BRAZIL_LOCATIONS[14];
      if (origin.zone === 'urban' && destination.zone === 'urban') {
        setOrigin(sp);
        setDestination(rj);
      }
      if (mod === 'freight' && role === 'driver') setRole('trucker');
    } else if (mod === 'rides' || mod === 'indrive') {
      if (origin.zone === 'intercity' && destination.zone === 'intercity') {
        setOrigin(BRAZIL_LOCATIONS[0]);
        setDestination(BRAZIL_LOCATIONS[4]);
      }
      if (role === 'trucker') setRole('passenger');
    }
  };

  /** Executa uma ação no servidor, mostra o resultado e atualiza a tela. */
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) showToast(success);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível concluir.');
    } finally {
      await loadBootstrap();
    }
  };

  const post = (path: string, body: unknown = {}) => api(path, { body });

  const handleCreateRide = (payload: object) => run(() => post('/api/rides', payload), 'Corrida solicitada! Procurando motorista...');
  const handleRideAction = (rideId: string, action: string, extra?: Record<string, string | number>) =>
    run(
      () => api(`/api/rides/${rideId}`, { method: 'PATCH', body: { action, ...extra } }),
      ({ driver_accept: 'Corrida aceita! Vá até o passageiro.', start: 'Viagem iniciada.', complete: 'Corrida finalizada!', cancel: 'Corrida cancelada.', rate: 'Obrigado pela avaliação!' } as Record<string, string>)[action],
    );
  const handleSetOnline = (online: boolean) =>
    run(() => api('/api/profile', { method: 'PATCH', body: { driverOnline: online } }), online ? 'Você está online.' : 'Você está offline.');

  const handleCreateInDrive = (payload: object) => run(() => post('/api/indrive', payload), 'Oferta publicada para os motoristas!');
  const handleSendDriverOffer = (requestId: string, offeredPrice: number, etaMin: number, note: string) =>
    run(() => post(`/api/indrive/${requestId}/offers`, { offeredPrice, etaMin, note }), 'Proposta enviada ao passageiro!');
  const handleAcceptInDrive = (requestId: string, offerId: string) => run(() => post(`/api/indrive/${requestId}/accept`, { offerId }), 'Negociação fechada!');
  const handleCompleteInDrive = (id: string) => run(() => post(`/api/indrive/${id}/complete`), 'Viagem finalizada!');
  const handleCancelInDrive = (id: string) => run(() => post(`/api/indrive/${id}/cancel`), 'Pedido cancelado.');

  const handleBookCarpool = (tripId: string, seats: number) => run(() => post(`/api/carpools/${tripId}/book`, { seats }), 'Vaga reservada!');
  const handlePublishCarpool = (payload: object) => run(() => post('/api/carpools', payload), 'Carona publicada!');
  const handleCarpoolAction = (tripId: string, action: 'cancel-booking' | 'complete' | 'cancel') =>
    run(() => post(`/api/carpools/${tripId}/${action}`), action === 'complete' ? 'Carona concluída. Ganhos na carteira!' : 'Cancelado. Valores devolvidos.');

  const handlePublishEmptyTruck = (payload: object) => run(() => post('/api/empty-trucks', payload), 'Rota publicada na vitrine!');
  const handleReserveEmptyTruck = (id: string) => run(() => post(`/api/empty-trucks/${id}/reserve`), 'Caminhão reservado!');
  const handleTruckAction = (id: string, action: 'complete' | 'cancel') =>
    run(() => post(`/api/empty-trucks/${id}/${action}`), action === 'complete' ? 'Entrega confirmada. Ganhos na carteira!' : 'Cancelado.');
  const handleCreateFreight = (payload: object) => run(() => post('/api/freights', payload), 'Pedido de frete publicado!');
  const handleSendFreightBid = (freightId: string, price: number, helpersIncluded: number, note: string) =>
    run(() => post(`/api/freights/${freightId}/bids`, { price, helpersIncluded, note }), 'Lance enviado ao cliente!');
  const handleAcceptFreightBid = (freightId: string, bidId: string) => run(() => post(`/api/freights/${freightId}/accept`, { bidId }), 'Caminhoneiro contratado!');
  const handleFreightAction = (id: string, action: 'deliver' | 'cancel') =>
    run(() => post(`/api/freights/${id}/${action}`), action === 'deliver' ? 'Entrega confirmada. Ganhos na carteira!' : 'Frete cancelado.');

  const handleTopUp = async (amount: number) => {
    try {
      const r = await post('/api/wallet/topup', { amount }) as { checkoutUrl: string };
      window.location.href = r.checkoutUrl;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível iniciar a recarga.');
    }
  };
  const handleWithdraw = (amount: number, pixKey: string) => run(() => post('/api/wallet/withdraw', { amount, pixKey }), 'Saque solicitado!');
  const handleUpdateProfile = (patch: Partial<UserProfile>) => run(() => api('/api/profile', { method: 'PATCH', body: patch }), 'Dados salvos.');
  const handleUploadDocument = async (kind: 'driver' | 'trucker', docType: string, file: File) => {
    if (file.size > 3 * 1024 * 1024) {
      showToast('O arquivo deve ter até 3 MB.');
      throw new Error('arquivo grande');
    }
    try {
      await post('/api/driver/documents', { kind, docType, contentType: file.type, dataBase64: await fileToBase64(file) });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha no envio.');
      throw err;
    }
  };
  const handleApply = (kind: 'driver' | 'trucker', data: Record<string, string>) =>
    run(() => post('/api/driver/apply', { kind, ...data }), 'Cadastro enviado para análise!');
  const handleLogout = async () => {
    await logout();
    setState(null);
  };

  const profile = state?.profile;
  const roleApproved = !profile
    ? false
    : role === 'driver'
      ? profile.driverStatus === 'approved'
      : role === 'trucker'
        ? profile.truckerStatus === 'approved'
        : true;

  const activeRide = state?.rides.find((r) => r.mine && r.status !== 'completed' && r.status !== 'cancelled');
  const activeStatusLabel = activeRide
    ? activeRide.status === 'in_progress'
      ? 'Em viagem'
      : activeRide.status === 'searching'
        ? 'Procurando motorista'
        : `Chega em ${activeRide.etaMin ?? 3} min`
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
              { id: 'wallet', label: 'Conta' },
              ...(profile?.isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
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
                {role !== 'passenger' && !roleApproved && ['rides', 'indrive', 'carpool', 'freight'].includes(activeModule) && (
                  <ProviderOnboarding
                    kind={role === 'trucker' ? 'trucker' : 'driver'}
                    profile={state.profile}
                    onUpload={handleUploadDocument}
                    onApply={handleApply}
                  />
                )}

                {activeModule === 'admin' && state.profile.isAdmin && <AdminPanel onToast={showToast} />}

                {(role === 'passenger' || roleApproved) && activeModule === 'rides' && (
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
                    onSetOnline={handleSetOnline}
                  />
                )}

                {(role === 'passenger' || roleApproved) && activeModule === 'indrive' && (
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
                    onCompleteRequest={handleCompleteInDrive}
                    onCancelRequest={handleCancelInDrive}
                  />
                )}

                {(role === 'passenger' || roleApproved) && activeModule === 'carpool' && (
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
                    onCarpoolAction={handleCarpoolAction}
                    canPublish={state.profile.driverStatus === 'approved'}
                  />
                )}

                {(role === 'passenger' || roleApproved) && activeModule === 'freight' && (
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
                    onTruckAction={handleTruckAction}
                    onFreightAction={handleFreightAction}
                    canPublishTruck={state.profile.truckerStatus === 'approved'}
                  />
                )}

                {activeModule === 'wallet' && (
                  <WalletAccountPanel
                    key={state.profile.uid}
                    profile={state.profile}
                    transactions={state.transactions}
                    paymentsEnabled={paymentsEnabled}
                    onTopUp={handleTopUp}
                    onWithdraw={handleWithdraw}
                    onUpdateProfile={handleUpdateProfile}
                    onUploadDocument={handleUploadDocument}
                    onApply={handleApply}
                    onLogout={handleLogout}
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
        className={`md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 pb-safe bg-white/95 dark:bg-[#101622]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid ${profile?.isAdmin ? 'grid-cols-6' : 'grid-cols-5'} items-center`}
      >
        {(
          [
            { id: 'rides', label: 'Corridas', Icon: Car },
            { id: 'indrive', label: 'inDrive', Icon: HandCoins },
            { id: 'carpool', label: 'Caronas', Icon: Users },
            { id: 'freight', label: 'Cargas', Icon: Truck },
            { id: 'wallet', label: 'Conta', Icon: Wallet },
            ...(profile?.isAdmin ? [{ id: 'admin', label: 'Admin', Icon: Shield }] : []),
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

  if (user === undefined)
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] text-sm text-slate-500">Carregando Froc X Uber...</div>
    );
  if (user === null) return <AuthScreen configError={configError} />;

  if (useGoogleMaps) {
    return (
      <APIProvider apiKey={mapsApiKey} language="pt-BR" region="BR" libraries={['routes', 'places']}>
        {appShell}
      </APIProvider>
    );
  }

  return appShell;
}
