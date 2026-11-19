import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Car, HandCoins, Map as MapIcon, Moon, Shield, Sun, Truck, Users, Wallet } from 'lucide-react';
import { AdminPanel } from './components/AdminPanel.tsx';
import { Landing } from './components/Landing.tsx';
import { SupportChat } from './components/SupportChat.tsx';
import { takeIntent } from './lib/launch.ts';
import { currentLocationPoint, isGpsOrigin, isOriginPending, isUnsetDestination, locatingPoint, metersBetween, needLocationPoint, pointAt, unsetDestination, watchCoords } from './lib/currentLocation.ts';
import { BlaBlaCarPanel } from './components/BlaBlaCarPanel.tsx';
import { GoogleMapsView } from './components/GoogleMapsView.tsx';
import { InDrivePanel } from './components/InDrivePanel.tsx';
import { InteractiveMap } from './components/InteractiveMap.tsx';
import { ProviderOnboarding } from './components/ProviderOnboarding.tsx';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton.tsx';
import { TruckFreightPanel } from './components/TruckFreightPanel.tsx';
import { Uber99Panel } from './components/Uber99Panel.tsx';
import { WalletAccountPanel } from './components/WalletAccountPanel.tsx';
import { MerchantPanel } from './components/MerchantPanel.tsx';
import { HelpLinks } from './components/HelpLinks.tsx';
import { RecordingsRecovery } from './components/RecordingsRecovery.tsx';
import { IdentityDocUpload, IdentityGate } from './components/IdentityGate.tsx';
import { alertUser, askNotificationPermission } from './lib/alerts.ts';
import { BRAZIL_LOCATIONS, formatBRL } from './data/locations.ts';
import { useOnlineStatus } from './hooks/useOnlineStatus.ts';
import { api, loadPublicConfig, logout, prepareUpload, watchUser } from './lib/session.ts';
import type { AppBootstrapState, AppModule, GeoPoint, NearbyDriver, UserProfile, UserRole } from './types/mobility.ts';
import { initialRole, loadRole, modeOf, roleForMode, saveRole } from './lib/appMode.ts';

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
  // Modo Passageiro/Motorista fica salvo no aparelho (o motorista não precisa trocar toda vez).
  const [role, setRoleState] = useState<UserRole>(() => loadRole() ?? 'passenger');
  const roleChosen = useRef(loadRole() !== null);
  const setRole = useCallback((r: UserRole) => {
    roleChosen.current = true;
    saveRole(r);
    setRoleState(r);
  }, []);
  // Padrão: tema preto (identidade Froc). A escolha da pessoa fica salva no aparelho.
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('froc-theme') !== 'light';
    } catch {
      return true;
    }
  });
  const [showMobileMap, setShowMobileMap] = useState<boolean>(true);
  const [toast, setToast] = useState<string | null>(null);

  // O ponto A começa como "Localizando você..." e vira o endereço real assim que o GPS responde.
  // O ponto A começa "Localizando você..." e vira o endereço REAL. Nunca um endereço fixo.
  const [origin, setOrigin] = useState<GeoPoint>(() => locatingPoint());
  const gpsPoint = useRef<GeoPoint | null>(null);
  // B começa vazio (Para onde vamos?) até a pessoa escolher o destino.
  const [destination, setDestination] = useState<GeoPoint>(() => unsetDestination(locatingPoint()));
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
    try {
      localStorage.setItem('froc-theme', isDark ? 'dark' : 'light');
    } catch {
      /* navegador sem armazenamento */
    }
  }, [isDark]);

  // Ponto A = onde a pessoa está agora (GPS no celular; no computador, a localização da rede).
  // Roda ao entrar e quando a pessoa toca em "Usar minha localização atual".
  const locateMe = useCallback(
    async (manual: boolean) => {
      if (manual) setOrigin(() => locatingPoint());
      try {
        const point = await currentLocationPoint();
        gpsPoint.current = point;
        // Só troca se a pessoa ainda não escolheu outro ponto de partida enquanto o GPS respondia.
        setOrigin((prev) => (isOriginPending(prev) || isGpsOrigin(prev) ? point : prev));
        // Destino ainda vazio acompanha a partida (o mapa fica em volta da pessoa).
        setDestination((prev) => (isUnsetDestination(prev) ? unsetDestination(point) : prev));
        if (manual) showToast(`Partida: ${point.name}`);
      } catch (e) {
        // Sem localização: A fica pedindo a localização (nunca um endereço inventado).
        setOrigin((prev) => (isOriginPending(prev) ? gpsPoint.current ?? needLocationPoint() : prev));
        showToast(
          (e as Error).message === 'negado'
            ? 'Permita a localização: toque no cadeado ao lado do endereço do site → Localização → Permitir.'
            : 'Não consegui sua localização agora. Ligue a localização do aparelho ou digite onde você está.',
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    if (user) void locateMe(false);
  }, [user, locateMe]);
  // Tempo real: enquanto a partida for o GPS, o ponto A acompanha a pessoa (andou 25 m, atualiza).
  const lastGeocode = useRef(0);
  const busyRef = useRef(false); // em corrida: a partida já foi combinada, não muda mais
  useEffect(() => {
    if (!user) return;
    const stop = watchCoords((c) => {
      if (busyRef.current) return;
      const prev = gpsPoint.current;
      if (prev && metersBetween(prev, c) < 25) return;
      if (Date.now() - lastGeocode.current < 10_000 && prev) return;
      lastGeocode.current = Date.now();
      void pointAt(c.lat, c.lng).then((point) => {
        gpsPoint.current = point;
        setOrigin((o) => (isOriginPending(o) || isGpsOrigin(o) ? point : o));
        setDestination((d) => (isUnsetDestination(d) ? unsetDestination(point) : d));
      });
    });
    // Se a pessoa liberar a localização depois (no cadeado do navegador), já atualiza sozinho.
    let perm: PermissionStatus | null = null;
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        perm = p;
        p.onchange = () => {
          if (p.state === 'granted') void locateMe(true);
        };
      })
      .catch(() => undefined);
    return () => {
      stop();
      if (perm) perm.onchange = null;
    };
  }, [user, locateMe]);
  useEffect(() => {
    const onUse = () => void locateMe(true);
    window.addEventListener('froc:use-my-location', onUse);
    return () => window.removeEventListener('froc:use-my-location', onUse);
  }, [locateMe]);

  // Sem modo salvo no aparelho: motorista aprovado já abre no modo Motorista.
  const approvedDriver = state?.profile.driverStatus;
  const approvedTrucker = state?.profile.truckerStatus;
  useEffect(() => {
    if (roleChosen.current || (!approvedDriver && !approvedTrucker)) return;
    setRoleState(initialRole(null, { driverStatus: approvedDriver, truckerStatus: approvedTrucker }));
  }, [approvedDriver, approvedTrucker]);

  // Quem tocou em "Quero ser motorista" / "Cadastrar meu veículo de carga" na página inicial
  // já entra no app com o perfil certo aberto.
  useEffect(() => {
    if (!user) return;
    const intent = takeIntent();
    if (intent === 'driver') setRole('driver');
    if (intent === 'trucker') {
      setRole('trucker');
      setActiveModule('freight');
    }
  }, [user]);

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

  const failures = useRef(0);
  const loadBootstrap = useCallback(async () => {
    try {
      const data = await api<AppBootstrapState>('/api/bootstrap');
      setState(data);
      setError(null);
      failures.current = 0;
    } catch (err) {
      // Uma falha passageira (rede do celular, servidor acordando) não apaga a tela:
      // os dados atuais continuam e a próxima atualização tenta de novo.
      failures.current += 1;
      setError(err instanceof Error ? err.message : 'Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Aparelho: registra uma vez por sessão (regra "uma pessoa, uma conta").
  useEffect(() => {
    if (!user) return;
    void api('/api/device', { body: {} }).catch(() => undefined);
  }, [user]);

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

  // Motorista/caminhoneiro online: envia a posição do celular a cada ~10 s (despacho por região H3).
  const isOnlineProvider = Boolean(
    state?.profile.driverOnline && (state.profile.driverStatus === 'approved' || state.profile.truckerStatus === 'approved'),
  );
  // Em viagem, manda a cada ~4 s (o passageiro vê o carro andando liso); parado, a cada ~10 s.
  const providerOnTrip = Boolean(
    state?.rides.some((r) => r.mine === 'provider' && ['accepted', 'arriving', 'in_progress'].includes(r.status)) ||
      state?.indriveRequests.some((r) => r.mine === 'provider' && r.status === 'matched'),
  );
  const locationEveryMs = useRef(10_000);
  locationEveryMs.current = providerOnTrip ? 4_000 : 10_000;
  useEffect(() => {
    if (!isOnlineProvider || !navigator.geolocation) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last < locationEveryMs.current) return;
        last = Date.now();
        void api('/api/driver/location', { body: { lat: pos.coords.latitude, lng: pos.coords.longitude } }).catch(() => undefined);
      },
      () => showToast('Ative a localização do celular para receber corridas perto de você.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnlineProvider]);

  const handleSelectModule = (mod: AppModule) => {
    setActiveModule(mod);
    if (mod === 'carpool' || mod === 'freight') {
      // O mapa continua onde a pessoa está (A = localização atual). Nunca um trajeto fixo de exemplo.
      if (mod === 'freight' && role === 'driver') setRole('trucker');
    } else if (mod === 'rides' || mod === 'indrive') {
      if (origin.zone === 'intercity' && destination.zone === 'intercity') {
        setOrigin(gpsPoint.current ?? needLocationPoint());
        setDestination(unsetDestination(gpsPoint.current ?? needLocationPoint()));
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
      ({ driver_accept: 'Corrida aceita! Vá até o passageiro.', start: 'Viagem iniciada.', complete: 'Corrida finalizada!', cancel: 'Corrida cancelada.', rate: 'Obrigado pela avaliação!', arriving: 'Passageiro avisado na tela: a espera começou a contar.', no_show: 'Corrida encerrada: passageiro não apareceu. O valor caiu no seu saldo.' } as Record<string, string>)[action],
    );
  const handleSetOnline = (online: boolean) => {
    // Ao ficar online: libera som e notificação para avisar de novas corridas com o app minimizado.
    if (online) askNotificationPermission();
    return run(() => api('/api/profile', { method: 'PATCH', body: { driverOnline: online } }), online ? 'Você está online.' : 'Você está offline.');
  };

  const handleCreateInDrive = (payload: object) => run(() => post('/api/indrive', payload), 'Oferta publicada para os motoristas!');
  const handleSendDriverOffer = (requestId: string, offeredPrice: number, etaMin: number, note: string) =>
    run(() => post(`/api/indrive/${requestId}/offers`, { offeredPrice, etaMin, note }), 'Proposta enviada ao passageiro!');
  const handleAcceptInDrive = (requestId: string, offerId: string) => run(() => post(`/api/indrive/${requestId}/accept`, { offerId }), 'Negociação fechada!');
  const handleCompleteInDrive = (id: string) => run(() => post(`/api/indrive/${id}/complete`), 'Viagem finalizada!');
  const handleCancelInDrive = (id: string) => run(() => post(`/api/indrive/${id}/cancel`), 'Pedido cancelado.');

  const handleBookCarpool = (tripId: string, seats: number) => run(() => post(`/api/carpools/${tripId}/book`, { seats }), 'Vaga reservada!');
  const handlePublishCarpool = (payload: object) => run(() => post('/api/carpools', payload), 'Carona publicada!');
  const handleCarpoolAction = (tripId: string, action: 'cancel-booking' | 'complete' | 'cancel') =>
    run(
      () => post(`/api/carpools/${tripId}/${action}`),
      action === 'complete'
        ? 'Carona concluída. Ganhos e caução na carteira!'
        : action === 'cancel'
          ? 'Carona cancelada. Os passageiros receberam o valor de volta.'
          : 'Reserva cancelada. Veja no extrato quanto voltou.',
    );
  const handleBoardCarpool = (tripId: string, pin: string) => run(() => post(`/api/carpools/${tripId}/board`, { pin }), 'Embarque confirmado!');
  const handleCarpoolNoShow = (tripId: string, bookingId: string, lat: number, lng: number) =>
    run(() => post(`/api/carpools/${tripId}/no-show`, { bookingId, lat, lng }), 'Registrado: passageiro não apareceu.');

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
  const handleRedeem = () => run(() => post('/api/wallet/redeem'), 'Pontos trocados por R$ 5,00 de crédito!');
  const handleWithdraw = (amount: number, pixKey: string, pixKeyType: string) =>
    run(
      () => post('/api/wallet/withdraw', { amount, pixKey, pixKeyType }),
      'Pedido de Pix recebido! O valor ficou reservado e a equipe Froc envia o Pix. Acompanhe em "Meus pedidos de Pix".',
    );
  const handleUpdateProfile = (patch: Partial<UserProfile>) => run(() => api('/api/profile', { method: 'PATCH', body: patch }), 'Dados salvos.');
  const handleUploadDocument = async (kind: 'driver' | 'trucker', docType: string, file: File) => {
    try {
      const upload = await prepareUpload(file);
      await post('/api/driver/documents', { kind, docType, contentType: upload.contentType, dataBase64: upload.dataBase64 });
      void loadBootstrap();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha no envio.');
      throw err;
    }
  };
  const handleApply = (kind: 'driver' | 'trucker', data: Record<string, unknown>) =>
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
  const matchedDeal = state?.indriveRequests.find((r) => r.mine === 'owner' && r.status === 'matched');
  useEffect(() => {
    busyRef.current = Boolean(activeRide || matchedDeal);
  }, [activeRide, matchedDeal]);
  // Passageiro vê o carro do motorista andando (posição enviada pelo celular do motorista).
  const liveDriverPoint =
    (activeRide?.mine === 'owner' && activeRide.driverLocation) || matchedDeal?.driverLocation || null;
  // Avisos com som/vibração: nova corrida para o motorista, motorista aceitou, nova mensagem.
  const lastSeen = useRef<{ queue: Set<string>; status: Record<string, string>; msgs: Record<string, number> } | null>(null);
  useEffect(() => {
    if (!state) return;
    const queue = new Set(
      [...state.rides.filter((r) => r.mine === null && r.status === 'searching'), ...state.indriveRequests.filter((r) => r.mine === null && r.status === 'open')].map((r) => r.id),
    );
    const status: Record<string, string> = {};
    const msgs: Record<string, number> = {};
    for (const r of state.rides.filter((x) => x.mine)) {
      status[r.id] = r.status;
      msgs[r.id] = r.messages.filter((m) => m.sender !== (r.mine === 'owner' ? 'passenger' : 'driver')).length;
    }
    const prev = lastSeen.current;
    lastSeen.current = { queue, status, msgs };
    if (!prev) return;
    if (state.profile.driverOnline && [...queue].some((id) => !prev.queue.has(id))) alertUser('Nova corrida perto de você', 'Abra a Froc para aceitar.', { beeps: 3 });
    for (const r of state.rides.filter((x) => x.mine === 'owner')) {
      if (prev.status[r.id] === 'searching' && r.status === 'accepted') alertUser('Motorista a caminho!', `${r.driverName || 'Seu motorista'} aceitou a corrida.`);
      if (prev.status[r.id] && prev.status[r.id] !== 'arriving' && r.status === 'arriving') alertUser('Seu motorista chegou', 'O 1º minuto de espera é grátis.', { vibrate: [500, 150, 500, 150, 500], beeps: 3 });
    }
    for (const id of Object.keys(msgs)) if (prev.msgs[id] !== undefined && msgs[id] > prev.msgs[id]) alertUser('Nova mensagem na corrida', 'Abra a Froc para ler.', { beeps: 1, vibrate: [150] });
  }, [state]);

  const liveDriverKind: 'carro' | 'moto' =
    activeRide?.categoryId === 'froc_moto' || (activeRide?.categoryId === 'froc_delivery' && activeRide.delivery?.vehicle === 'moto') ? 'moto' : 'carro';
  const activeStatusLabel = activeRide
    ? activeRide.status === 'in_progress'
      ? 'Em viagem'
      : activeRide.status === 'searching'
        ? 'Procurando motorista'
        : `Chega em ${activeRide.etaMin ?? 3} min`
    : undefined;

  const useGoogleMaps = Boolean(mapsApiKey) && isOnline;

  // Carrinhos por perto (como no Uber): só para quem vai pedir, sem corrida em andamento.
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);
  const wantsNearby =
    Boolean(user) && useGoogleMaps && role === 'passenger' && (activeModule === 'rides' || activeModule === 'indrive') && !activeRide && !matchedDeal && !isOriginPending(origin);
  useEffect(() => {
    if (!wantsNearby) {
      setNearbyDrivers([]);
      return;
    }
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      api<{ drivers: NearbyDriver[] }>(`/api/drivers/nearby?lat=${origin.lat.toFixed(5)}&lng=${origin.lng.toFixed(5)}`)
        .then((r) => {
          if (alive) setNearbyDrivers(r.drivers);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [wantsNearby, origin.lat, origin.lng]);

  const appShell = (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-transparent text-slate-900 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-14 lg:h-16 px-4 lg:px-6 bg-white/95 dark:bg-[#050505]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 lg:gap-8">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            handleSelectModule('rides');
          }}
          className="font-display text-lg lg:text-xl font-extrabold tracking-tight whitespace-nowrap shrink-0 froc-logo"
        >
          Froc X Uber
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {(
            [
              { id: 'rides', label: 'Corridas' },
              { id: 'indrive', label: 'Negociar' },
              { id: 'carpool', label: 'Caronas' },
              { id: 'freight', label: 'Cargas' },
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
                  ? 'border-emerald-600 froc-nav-active text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {user && (
            <div role="group" aria-label="Modo do app" className="flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              {(
                [
                  { id: 'passenger', label: 'Passageiro' },
                  { id: 'driver', label: 'Motorista' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={modeOf(role) === m.id}
                  onClick={() => {
                    const next = roleForMode(m.id, activeModule, role);
                    setRole(next);
                    if (next === 'trucker') setActiveModule('freight');
                  }}
                  className={`min-h-[32px] px-2.5 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap cursor-pointer transition ${
                    modeOf(role) === m.id ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-700 dark:text-white hover:bg-white/60 dark:hover:bg-slate-800'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
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
              driverPoint={liveDriverPoint}
              driverKind={liveDriverKind}
              nearbyDrivers={nearbyDrivers}
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
              driverPoint={liveDriverPoint}
              onSelectLocationFromMap={(point, target) => {
                if (target === 'origin') setOrigin(point);
                else setDestination(point);
                showToast(`${target === 'origin' ? 'Partida' : 'Destino'}: ${point.name}`);
              }}
            />
          )}

          {/* Desktop Bottom Metric Strip */}
          {state && (
            <div className="hidden lg:grid grid-cols-4 gap-4 absolute bottom-4 right-4 left-64 z-10 rounded-2xl bg-white/92 dark:bg-[#111013]/92 backdrop-blur-md border border-slate-200 dark:border-slate-800 px-5 py-3 shadow-sm">
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
        <section className="lg:order-1 flex flex-col lg:h-full lg:overflow-hidden bg-slate-50 dark:bg-[#050505]">
          <div className="px-4 pt-3 pb-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101622] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 flex-1">
                {(
                  [
                    { id: 'passenger', label: 'Passageiro' },
                    { id: 'driver', label: 'Motorista' },
                    { id: 'trucker', label: 'Transportador' },
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
            {state && error && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                Conexão instável: {error} Tentando de novo automaticamente.
              </div>
            )}
            {loading && !state ? (
              <div className="space-y-3 py-6">
                <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
                <div className="h-36 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
                <div className="h-36 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
              </div>
            ) : !state ? (
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
              <div key={activeModule} className="froc-enter space-y-4">
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
                    onNeedTopUp={() => {
                      setActiveModule('wallet');
                      showToast('Recarregue por Pix ou cartão e volte para pedir a corrida.');
                    }}
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
                    onBoardCarpool={handleBoardCarpool}
                    onCarpoolNoShow={handleCarpoolNoShow}
                    canPublish={state.profile.driverStatus === 'approved'}
                  />
                )}

                {(role === 'passenger' || roleApproved) && activeModule === 'freight' && (
                  <TruckFreightPanel
                    role={role}
                    profile={state.profile}
                    emptyTrucks={state.emptyTrucks}
                    freights={state.freights}
                    origin={origin}
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
                  <MerchantPanel
                    profile={state.profile}
                    deliveries={state.deliveries || []}
                    mapsEnabled={useGoogleMaps}
                    onChanged={loadBootstrap}
                    onToast={showToast}
                  />
                )}

                {activeModule === 'wallet' && <IdentityDocUpload profile={state.profile} onDone={loadBootstrap} onToast={showToast} />}

                {activeModule === 'wallet' && <HelpLinks />}

                {activeModule === 'wallet' && (
                  <WalletAccountPanel
                    key={state.profile.uid}
                    profile={state.profile}
                    transactions={state.transactions}
                    withdrawals={state.withdrawals}
                    paymentsEnabled={paymentsEnabled}
                    onTopUp={handleTopUp}
                    onWithdraw={handleWithdraw}
                    onUpdateProfile={handleUpdateProfile}
                    onUploadDocument={handleUploadDocument}
                    onApply={handleApply}
                    onLogout={handleLogout}
                    onRedeem={handleRedeem}
                  />
                )}
              </div>
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

      {state && state.profile.identityRequired && (state.profile.cpfStatus === 'none' || state.profile.cpfStatus === 'rejected' || !state.profile.cpfStatus) && (
        <IdentityGate profile={state.profile} onDone={loadBootstrap} onLogout={() => void handleLogout()} />
      )}
      {state && <SupportChat />}
      {state && <RecordingsRecovery />}
      <OfflineIndicator />
    </div>
  );

  if (user === undefined)
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#050505] text-sm text-slate-500">Carregando Froc X Uber...</div>
    );
  if (user === null) return <Landing configError={configError} />;

  if (useGoogleMaps) {
    return (
      <APIProvider apiKey={mapsApiKey} language="pt-BR" region="BR" libraries={['routes', 'places', 'geocoding']}>
        {appShell}
      </APIProvider>
    );
  }

  return appShell;
}
