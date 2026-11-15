import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BRAZIL_LOCATIONS, calculateDistanceKm, estimateDurationMin, RIDE_CATEGORIES } from './src/data/locations.ts';
import type {
  AppBootstrapState,
  CarpoolTrip,
  EmptyTruckRoute,
  FreightRequest,
  InDriveRequest,
  RideOrder,
  TruckType,
} from './src/types/mobility.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'froc_db.json');

function byId(id: string) {
  return BRAZIL_LOCATIONS.find((l) => l.id === id) || BRAZIL_LOCATIONS[0];
}

function resolvePoint(pointOrNil: unknown, fallbackId: string) {
  if (
    pointOrNil &&
    typeof pointOrNil === 'object' &&
    'lat' in pointOrNil &&
    'lng' in pointOrNil &&
    'name' in pointOrNil
  ) {
    const p = pointOrNil as {
      id?: string;
      name: string;
      city?: string;
      state?: string;
      zone?: 'urban' | 'intercity';
      lat: number;
      lng: number;
      kind?: 'avenue' | 'airport' | 'terminal' | 'neighborhood' | 'city' | 'hub';
    };
    return {
      id: p.id || `custom-${Date.now()}`,
      name: p.name,
      city: p.city || 'Brasil',
      state: p.state || 'BR',
      zone: p.zone || 'urban',
      lat: Number(p.lat),
      lng: Number(p.lng),
      kind: p.kind || 'avenue',
    };
  }
  return byId(fallbackId);
}

function buildInitialState(): AppBootstrapState {
  const paulista = byId('sp-paulista');
  const pinheiros = byId('sp-pinheiros');
  const gru = byId('sp-gru');
  const fariaLima = byId('sp-faria-lima');
  const tiete = byId('sp-tiete');
  const campinas = byId('br-campinas');
  const rio = byId('br-rio');
  const curitiba = byId('br-curitiba');
  const bh = byId('br-bh');
  const floripa = byId('br-florianopolis');
  const ribeirao = byId('br-ribeirao');
  const santos = byId('br-santos');

  return {
    profile: {
      name: 'Rafael Mendes',
      phone: '+55 (11) 99482-1940',
      city: 'São Paulo, SP',
      rating: 4.96,
      walletBalance: 480.0,
      driverOnline: false,
      driverVehicle: 'Hyundai HB20S Platinum · Cinza',
      driverPlate: 'FRO-4X99',
      truckModel: 'Volvo FH 460 Globetrotter · Baú',
      truckType: 'Carreta Sider',
      truckPlate: 'TRK-8F21',
    },
    rides: [
      {
        id: 'ride-demo-1',
        passengerName: 'Marina Costa',
        origin: fariaLima,
        destination: gru,
        stops: [],
        categoryId: 'froc_x',
        categoryLabel: 'Froc X',
        distanceKm: calculateDistanceKm(fariaLima, gru),
        durationMin: estimateDurationMin(calculateDistanceKm(fariaLima, gru), 'urban'),
        price: 78.4,
        discountApplied: 6.0,
        paymentMethod: 'pix',
        pinCode: '4829',
        status: 'searching',
        createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
        messages: [
          { sender: 'passenger', text: 'Estou na portaria principal com duas malas.', time: 'Agora' },
        ],
      },
      {
        id: 'ride-demo-hist',
        passengerName: 'Rafael Mendes',
        origin: paulista,
        destination: pinheiros,
        stops: [],
        categoryId: 'froc_99',
        categoryLabel: 'Froc 99 Pop',
        distanceKm: 4.9,
        durationMin: 14,
        price: 16.9,
        discountApplied: 3.0,
        paymentMethod: 'froc_pay',
        pinCode: '7712',
        status: 'completed',
        driverName: 'Carlos Eduardo',
        driverRating: 4.94,
        vehicleModel: 'Chevrolet Onix Plus · Prata',
        vehiclePlate: 'GHT-9E41',
        etaMin: 0,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
        messages: [],
      },
    ],
    indriveRequests: [
      {
        id: 'indrive-1',
        passengerName: 'Rafael Mendes',
        origin: paulista,
        destination: tiete,
        distanceKm: calculateDistanceKm(paulista, tiete),
        suggestedPrice: 28.0,
        passengerOffer: 22.0,
        paymentMethod: 'pix',
        notes: 'Sem bagagem pesada, embarque rápido em frente ao MASP',
        status: 'open',
        offers: [
          {
            id: 'offer-101',
            driverName: 'Marcelo Tavares',
            driverRating: 4.93,
            tripsCount: 1840,
            vehicleModel: 'Renault Logan · Branco',
            vehiclePlate: 'EJK-2C18',
            offeredPrice: 24.0,
            etaMin: 3,
            note: 'Estou a 400m na Bela Vista, ar ligado!',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'offer-102',
            driverName: 'Juliana Prado',
            driverRating: 4.98,
            tripsCount: 920,
            vehicleModel: 'Toyota Yaris · Prata',
            vehiclePlate: 'FQC-7B04',
            offeredPrice: 22.0,
            etaMin: 6,
            note: 'Aceito sua oferta de R$ 22,00 via Pix.',
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
      },
      {
        id: 'indrive-2',
        passengerName: 'Lucas Ferreira',
        origin: pinheiros,
        destination: byId('sp-cgh'),
        distanceKm: calculateDistanceKm(pinheiros, byId('sp-cgh')),
        suggestedPrice: 36.0,
        passengerOffer: 30.0,
        paymentMethod: 'cash',
        notes: 'Voo às 17h, preciso sair logo',
        status: 'open',
        offers: [],
        createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
      },
    ],
    carpools: [
      {
        id: 'carpool-1',
        driverName: 'Thiago Nogueira',
        driverRating: 4.95,
        verified: true,
        vehicleModel: 'Volkswagen T-Cross Comfortline',
        origin: tiete,
        destination: rio,
        pickupSpot: 'Metrô Tietê · Baia Turística',
        dropoffSpot: 'Rodoviária Novo Rio / Metrô Cidade Nova',
        date: 'Amanhã',
        departureTime: '07:30',
        arrivalTime: '13:15',
        distanceKm: calculateDistanceKm(tiete, rio),
        pricePerSeat: 109.0,
        totalSeats: 3,
        availableSeats: 2,
        instantBooking: true,
        preferences: {
          music: true,
          pets: false,
          luggage: 'Média',
          smoking: false,
          maxTwoBack: true,
        },
        bookedByUserSeats: 0,
      },
      {
        id: 'carpool-2',
        driverName: 'Camila Duarte',
        driverRating: 4.99,
        verified: true,
        vehicleModel: 'Honda Civic Touring',
        origin: byId('sp-barra-funda'),
        destination: campinas,
        pickupSpot: 'Terminal Barra Funda · Portão 4',
        dropoffSpot: 'Campinas · Shopping Iguatemi / Centro',
        date: 'Hoje',
        departureTime: '18:00',
        arrivalTime: '19:25',
        distanceKm: calculateDistanceKm(byId('sp-barra-funda'), campinas),
        pricePerSeat: 34.0,
        totalSeats: 3,
        availableSeats: 3,
        instantBooking: true,
        preferences: {
          music: true,
          pets: true,
          luggage: 'Pequena',
          smoking: false,
          maxTwoBack: true,
        },
        bookedByUserSeats: 0,
      },
      {
        id: 'carpool-3',
        driverName: 'Gustavo Silveira',
        driverRating: 4.89,
        verified: true,
        vehicleModel: 'Jeep Compass Longitude',
        origin: curitiba,
        destination: floripa,
        pickupSpot: 'Curitiba · Rodoferroviária',
        dropoffSpot: 'Florianópolis · Ponte Hercílio Luz',
        date: 'Sexta-feira',
        departureTime: '14:00',
        arrivalTime: '18:10',
        distanceKm: calculateDistanceKm(curitiba, floripa),
        pricePerSeat: 79.0,
        totalSeats: 4,
        availableSeats: 2,
        instantBooking: false,
        preferences: {
          music: true,
          pets: false,
          luggage: 'Grande',
          smoking: false,
          maxTwoBack: false,
        },
        bookedByUserSeats: 0,
      },
    ],
    emptyTrucks: [
      {
        id: 'empty-1',
        truckerName: 'Antônio "Tonhão" Ribeiro',
        truckerRating: 4.97,
        verified: true,
        companyName: 'Ribeiro Logística & Retorno',
        truckType: 'Carreta Sider',
        truckPlate: 'BRC-9A42',
        origin: curitiba,
        destination: paulista,
        distanceKm: calculateDistanceKm(curitiba, paulista),
        departureDate: 'Hoje · 21:00',
        departureWindow: 'Chegada SP amanhã 05:30',
        direction: 'voltando_vazio',
        availableTons: 24.5,
        availableCubicM: 82,
        standardPrice: 4200,
        emptyReturnPrice: 1750,
        discountPercent: 58,
        acceptsMoving: true,
        hasLiftgate: true,
        status: 'available',
      },
      {
        id: 'empty-2',
        truckerName: 'Valdir Pereira',
        truckerRating: 4.91,
        verified: true,
        companyName: 'Expresso Dutra Cargas',
        truckType: 'Truck Baú',
        truckPlate: 'DTR-3H19',
        origin: rio,
        destination: paulista,
        distanceKm: calculateDistanceKm(rio, paulista),
        departureDate: 'Amanhã · 06:00',
        departureWindow: 'Entrega no mesmo dia até 15h',
        direction: 'voltando_vazio',
        availableTons: 12.0,
        availableCubicM: 48,
        standardPrice: 3600,
        emptyReturnPrice: 1590,
        discountPercent: 56,
        acceptsMoving: true,
        hasLiftgate: false,
        status: 'available',
      },
      {
        id: 'empty-3',
        truckerName: 'Kleber Santana',
        truckerRating: 4.94,
        verified: true,
        companyName: 'KS Mudanças & Fretes',
        truckType: '3/4 Baú',
        truckPlate: 'KSM-5D80',
        origin: bh,
        destination: ribeirao,
        distanceKm: calculateDistanceKm(bh, ribeirao),
        departureDate: 'Amanhã · 09:00',
        departureWindow: 'Indo descarregar vazio até Ribeirão',
        direction: 'indo_vazio',
        availableTons: 4.2,
        availableCubicM: 22,
        standardPrice: 2300,
        emptyReturnPrice: 980,
        discountPercent: 57,
        acceptsMoving: true,
        hasLiftgate: true,
        status: 'available',
      },
      {
        id: 'empty-4',
        truckerName: 'Rodrigo Alencar',
        truckerRating: 4.88,
        verified: true,
        companyName: 'Porto & Serra Transportes',
        truckType: 'VUC / Utilitário',
        truckPlate: 'PST-1F30',
        origin: santos,
        destination: paulista,
        distanceKm: calculateDistanceKm(santos, paulista),
        departureDate: 'Hoje · 16:30',
        departureWindow: 'Subindo a Anchieta vazio',
        direction: 'voltando_vazio',
        availableTons: 2.8,
        availableCubicM: 14,
        standardPrice: 780,
        emptyReturnPrice: 340,
        discountPercent: 56,
        acceptsMoving: true,
        hasLiftgate: false,
        status: 'available',
      },
    ],
    freights: [
      {
        id: 'freight-1',
        clientName: 'Rafael Mendes',
        kind: 'mudanca_residencial',
        title: 'Mudança Apartamento 2 Quartos (Pinheiros → Campinas)',
        origin: pinheiros,
        destination: campinas,
        distanceKm: calculateDistanceKm(pinheiros, campinas),
        truckTypeNeeded: '3/4 Baú',
        estimatedWeightKg: 1850,
        helpersNeeded: 2,
        hasElevator: true,
        needsPacking: true,
        proposedBudget: 1350,
        scheduledDate: 'Sábado · 08:30',
        status: 'open_bids',
        bids: [
          {
            id: 'fbid-1',
            truckerName: 'Marcos Viana · Mudanças Express',
            truckerRating: 4.96,
            truckType: '3/4 Baú',
            price: 1290,
            helpersIncluded: 2,
            etaText: 'Disponível sábado 08h com mantas e cintas',
            note: 'Já estou com rota próxima a Pinheiros, faço com 2 ajudantes e embalagem.',
          },
          {
            id: 'fbid-2',
            truckerName: 'Sérgio Braga Transportes',
            truckerRating: 4.87,
            truckType: 'Truck Baú',
            price: 1480,
            helpersIncluded: 3,
            etaText: 'Baú de 7m + 3 carregadores',
            note: 'Inclui seguro de carga total de até R$ 80 mil.',
          },
        ],
        createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
      },
    ],
    transactions: [
      {
        id: 'tx-1',
        title: 'Recarga instantânea via Pix',
        category: 'recarga_pix',
        amount: 500.0,
        type: 'credit',
        date: 'Ontem · 14:20',
      },
      {
        id: 'tx-2',
        title: 'Froc 99 Pop · Paulista → Pinheiros',
        category: 'corrida',
        amount: 16.9,
        type: 'debit',
        date: 'Ontem · 19:05',
      },
      {
        id: 'tx-3',
        title: 'Cashback Froc Club 5%',
        category: 'ganho_motorista',
        amount: 3.1,
        type: 'credit',
        date: 'Ontem · 19:06',
      },
    ],
  };
}

function loadDb(): AppBootstrapState {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = buildInitialState();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw) as AppBootstrapState;
  } catch {
    const initial = buildInitialState();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
}

function saveDb(state: AppBootstrapState) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

let db: AppBootstrapState = loadDb();

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'froc-x-uber' });
  });

  app.get('/api/maps-config', (_req, res) => {
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
    res.json({ apiKey });
  });

  app.get('/api/bootstrap', (_req, res) => {
    res.json(db);
  });

  app.post('/api/reset-demo', (_req, res) => {
    db = buildInitialState();
    saveDb(db);
    res.json(db);
  });

  // Update Profile / Driver Toggle
  app.patch('/api/profile', (req, res) => {
    const patch = req.body || {};
    db.profile = { ...db.profile, ...patch };
    saveDb(db);
    res.json(db.profile);
  });

  // Wallet Pix Top-up
  app.post('/api/wallet/topup', (req, res) => {
    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 20000) {
      return res.status(400).json({ error: 'Valor inválido para recarga Pix.' });
    }
    db.profile.walletBalance = Math.round((db.profile.walletBalance + amount) * 100) / 100;
    db.transactions.unshift({
      id: `tx-${Date.now()}`,
      title: 'Recarga instantânea via Pix',
      category: 'recarga_pix',
      amount,
      type: 'credit',
      date: 'Agora mesmo',
    });
    saveDb(db);
    return res.json({ profile: db.profile, transactions: db.transactions });
  });

  // Mode 1: Uber / 99 Instant Ride
  app.post('/api/rides', (req, res) => {
    const { originId, destinationId, originPoint, destinationPoint, categoryId, paymentMethod, stops = [], promoCode = '' } =
      req.body || {};
    const origin = resolvePoint(originPoint, originId);
    const destination = resolvePoint(destinationPoint, destinationId);
    const category = RIDE_CATEGORIES.find((c) => c.id === categoryId) || RIDE_CATEGORIES[0];
    const distanceKm = calculateDistanceKm(origin, destination);
    const durationMin = estimateDurationMin(distanceKm, category.id === 'froc_moto' ? 'moto' : 'urban');
    const rawPrice = category.baseFare + distanceKm * category.perKm + durationMin * category.perMin;
    const discountApplied = promoCode.trim().toUpperCase() === 'FROC10' ? Math.min(10, Math.round(rawPrice * 0.15 * 100) / 100) : 0;
    const price = Math.max(7.5, Math.round((rawPrice - discountApplied) * 100) / 100);

    const newRide: RideOrder = {
      id: `ride-${Date.now()}`,
      passengerName: db.profile.name,
      origin,
      destination,
      stops: Array.isArray(stops) ? stops.filter(Boolean) : [],
      categoryId: category.id,
      categoryLabel: category.label,
      distanceKm,
      durationMin,
      price,
      discountApplied,
      paymentMethod: paymentMethod || 'pix',
      pinCode: String(Math.floor(1000 + Math.random() * 9000)),
      status: 'accepted',
      driverName: 'Eduardo Vasconcelos',
      driverRating: 4.95,
      vehicleModel: category.id === 'froc_moto' ? 'Honda CB 300F · Preta' : 'Hyundai HB20S · Grafite',
      vehiclePlate: 'FRC-9X21',
      etaMin: category.etaOffsetMin,
      createdAt: new Date().toISOString(),
      messages: [
        {
          sender: 'driver',
          text: `Olá ${db.profile.name.split(' ')[0]}! Já estou a caminho do embarque (${category.etaOffsetMin} min).`,
          time: 'Agora',
        },
      ],
    };

    db.rides.unshift(newRide);
    saveDb(db);
    res.status(201).json(newRide);
  });

  app.patch('/api/rides/:id', (req, res) => {
    const ride = db.rides.find((r) => r.id === req.params.id);
    if (!ride) return res.status(404).json({ error: 'Corrida não encontrada.' });
    const { action, message, driverName } = req.body || {};

    if (action === 'driver_accept') {
      ride.status = 'accepted';
      ride.driverName = driverName || db.profile.name;
      ride.driverRating = db.profile.rating;
      ride.vehicleModel = db.profile.driverVehicle;
      ride.vehiclePlate = db.profile.driverPlate;
      ride.etaMin = 3;
      ride.messages.push({ sender: 'driver', text: 'Corrida aceita! Indo até o local de partida.', time: 'Agora' });
    } else if (action === 'arriving') {
      ride.status = 'arriving';
      ride.etaMin = 1;
    } else if (action === 'start') {
      ride.status = 'in_progress';
      ride.etaMin = ride.durationMin;
    } else if (action === 'complete') {
      if (ride.status !== 'completed') {
        ride.status = 'completed';
        ride.etaMin = 0;
        if (ride.passengerName === db.profile.name && ride.paymentMethod === 'froc_pay') {
          db.profile.walletBalance = Math.max(0, Math.round((db.profile.walletBalance - ride.price) * 100) / 100);
          db.transactions.unshift({
            id: `tx-${Date.now()}`,
            title: `${ride.categoryLabel} · ${ride.origin.name.split(' ')[0]} → ${ride.destination.name.split(' ')[0]}`,
            category: 'corrida',
            amount: ride.price,
            type: 'debit',
            date: 'Agora',
          });
        } else if (ride.driverName === db.profile.name) {
          const driverNet = Math.round(ride.price * 0.88 * 100) / 100;
          db.profile.walletBalance = Math.round((db.profile.walletBalance + driverNet) * 100) / 100;
          db.transactions.unshift({
            id: `tx-${Date.now()}`,
            title: `Ganho corrida ${ride.categoryLabel} (88% líquido)`,
            category: 'ganho_motorista',
            amount: driverNet,
            type: 'credit',
            date: 'Agora',
          });
        }
      }
    } else if (action === 'cancel') {
      ride.status = 'cancelled';
    } else if (action === 'message' && typeof message === 'string' && message.trim()) {
      ride.messages.push({
        sender: req.body?.sender === 'driver' ? 'driver' : 'passenger',
        text: message.trim(),
        time: 'Agora',
      });
    }

    saveDb(db);
    return res.json({ ride, profile: db.profile, transactions: db.transactions });
  });

  // Mode 2: inDrive Price Negotiation
  app.post('/api/indrive', (req, res) => {
    const { originId, destinationId, originPoint, destinationPoint, passengerOffer, paymentMethod, notes } = req.body || {};
    const origin = resolvePoint(originPoint, originId);
    const destination = resolvePoint(destinationPoint, destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const suggestedPrice = Math.round((5.5 + distanceKm * 2.15 + 4) * 100) / 100;
    const offerValue = Math.max(8, Number(passengerOffer) || Math.round(suggestedPrice * 0.85));

    const newReq: InDriveRequest = {
      id: `indrive-${Date.now()}`,
      passengerName: db.profile.name,
      origin,
      destination,
      distanceKm,
      suggestedPrice,
      passengerOffer: offerValue,
      paymentMethod: paymentMethod || 'pix',
      notes: notes || '',
      status: 'open',
      offers: [
        {
          id: `offer-${Date.now()}-a`,
          driverName: 'Fernanda Lima',
          driverRating: 4.96,
          tripsCount: 1420,
          vehicleModel: 'VW Polo Highline · Branco',
          vehiclePlate: 'IND-4B88',
          offeredPrice: Math.round((offerValue + 3) * 100) / 100,
          etaMin: 4,
          note: 'Faço com ar-condicionado e chego em 4 min.',
          createdAt: new Date().toISOString(),
        },
        {
          id: `offer-${Date.now()}-b`,
          driverName: 'André Souza',
          driverRating: 4.91,
          tripsCount: 2150,
          vehicleModel: 'Fiat Cronos · Prata',
          vehiclePlate: 'IND-7M10',
          offeredPrice: offerValue,
          etaMin: 7,
          note: 'Aceito exatamente o seu valor!',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
    };

    db.indriveRequests.unshift(newReq);
    saveDb(db);
    res.status(201).json(newReq);
  });

  app.post('/api/indrive/:id/offers', (req, res) => {
    const item = db.indriveRequests.find((r) => r.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Pedido inDrive não encontrado.' });
    const offeredPrice = Math.max(8, Number(req.body?.offeredPrice) || item.passengerOffer);
    const offer = {
      id: `offer-${Date.now()}`,
      driverName: req.body?.driverName || db.profile.name,
      driverRating: db.profile.rating,
      tripsCount: 642,
      vehicleModel: db.profile.driverVehicle,
      vehiclePlate: db.profile.driverPlate,
      offeredPrice,
      etaMin: Number(req.body?.etaMin) || 4,
      note: req.body?.note || 'Proposta enviada pelo motorista parceiro.',
      createdAt: new Date().toISOString(),
    };
    item.offers.unshift(offer);
    saveDb(db);
    res.status(201).json(item);
  });

  app.post('/api/indrive/:id/accept', (req, res) => {
    const item = db.indriveRequests.find((r) => r.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Pedido inDrive não encontrado.' });
    const { offerId } = req.body || {};
    const accepted = item.offers.find((o) => o.id === offerId);
    if (!accepted) return res.status(400).json({ error: 'Oferta inválida.' });

    item.status = 'matched';
    item.acceptedOfferId = offerId;
    db.transactions.unshift({
      id: `tx-${Date.now()}`,
      title: `Froc inDrive · ${accepted.driverName} (${accepted.vehiclePlate})`,
      category: 'indrive',
      amount: accepted.offeredPrice,
      type: 'debit',
      date: 'Agora',
    });
    saveDb(db);
    res.json({ request: item, transactions: db.transactions });
  });

  // Mode 3: BlaBlaCar Intercity Carpools
  app.post('/api/carpools', (req, res) => {
    const { originId, destinationId, date, departureTime, pricePerSeat, totalSeats, pickupSpot, dropoffSpot, pets, music } =
      req.body || {};
    const origin = byId(originId);
    const destination = byId(destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const durMin = estimateDurationMin(distanceKm, 'highway');
    const [hh, mm] = (departureTime || '08:00').split(':').map(Number);
    const arrTotal = ((hh || 8) * 60 + (mm || 0) + durMin) % (24 * 60);
    const arrH = String(Math.floor(arrTotal / 60)).padStart(2, '0');
    const arrM = String(arrTotal % 60).padStart(2, '0');

    const seats = Math.min(6, Math.max(1, Number(totalSeats) || 3));
    const trip: CarpoolTrip = {
      id: `carpool-${Date.now()}`,
      driverName: db.profile.name,
      driverRating: db.profile.rating,
      verified: true,
      vehicleModel: db.profile.driverVehicle,
      origin,
      destination,
      pickupSpot: pickupSpot || `${origin.city} · Ponto Central`,
      dropoffSpot: dropoffSpot || `${destination.city} · Terminal Central`,
      date: date || 'Amanhã',
      departureTime: departureTime || '08:00',
      arrivalTime: `${arrH}:${arrM}`,
      distanceKm,
      pricePerSeat: Math.max(15, Number(pricePerSeat) || Math.round(distanceKm * 0.28)),
      totalSeats: seats,
      availableSeats: seats,
      instantBooking: true,
      preferences: {
        music: music !== false,
        pets: Boolean(pets),
        luggage: 'Média',
        smoking: false,
        maxTwoBack: true,
      },
      bookedByUserSeats: 0,
    };

    db.carpools.unshift(trip);
    saveDb(db);
    res.status(201).json(trip);
  });

  app.post('/api/carpools/:id/book', (req, res) => {
    const trip = db.carpools.find((c) => c.id === req.params.id);
    if (!trip) return res.status(404).json({ error: 'Carona não encontrada.' });
    const seats = Math.max(1, Number(req.body?.seats) || 1);
    if (trip.availableSeats < seats) {
      return res.status(400).json({ error: 'Assentos insuficientes disponíveis.' });
    }
    trip.availableSeats -= seats;
    trip.bookedByUserSeats += seats;
    const total = Math.round(seats * trip.pricePerSeat * 100) / 100;
    db.profile.walletBalance = Math.max(0, Math.round((db.profile.walletBalance - total) * 100) / 100);
    db.transactions.unshift({
      id: `tx-${Date.now()}`,
      title: `Carona BlaBlaCar · ${trip.origin.city} → ${trip.destination.city} (${seats}x)`,
      category: 'carona',
      amount: total,
      type: 'debit',
      date: 'Agora',
    });
    saveDb(db);
    res.json({ trip, profile: db.profile, transactions: db.transactions });
  });

  // Mode 4A: Empty-Return Trucks ("Indo ou Vindo Vazio")
  app.post('/api/empty-trucks', (req, res) => {
    const {
      originId,
      destinationId,
      truckType,
      direction,
      availableTons,
      availableCubicM,
      emptyReturnPrice,
      departureDate,
      acceptsMoving,
      hasLiftgate,
    } = req.body || {};

    const origin = byId(originId);
    const destination = byId(destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const finalPrice = Math.max(250, Number(emptyReturnPrice) || Math.round(distanceKm * 4.2));
    const standardPrice = Math.round(finalPrice * 2.25);
    const discountPercent = Math.round(((standardPrice - finalPrice) / standardPrice) * 100);

    const newRoute: EmptyTruckRoute = {
      id: `empty-${Date.now()}`,
      truckerName: db.profile.name,
      truckerRating: db.profile.rating,
      verified: true,
      companyName: 'Froc Frota Parceira',
      truckType: (truckType as TruckType) || db.profile.truckType,
      truckPlate: db.profile.truckPlate,
      origin,
      destination,
      distanceKm,
      departureDate: departureDate || 'Amanhã · 07:00',
      departureWindow: 'Rota cadastrada pelo caminhoneiro',
      direction: direction || 'voltando_vazio',
      availableTons: Number(availableTons) || 14,
      availableCubicM: Number(availableCubicM) || 45,
      standardPrice,
      emptyReturnPrice: finalPrice,
      discountPercent,
      acceptsMoving: acceptsMoving !== false,
      hasLiftgate: Boolean(hasLiftgate),
      status: 'available',
    };

    db.emptyTrucks.unshift(newRoute);
    saveDb(db);
    res.status(201).json(newRoute);
  });

  app.post('/api/empty-trucks/:id/reserve', (req, res) => {
    const route = db.emptyTrucks.find((t) => t.id === req.params.id);
    if (!route) return res.status(404).json({ error: 'Caminhão não encontrado.' });
    if (route.status === 'reserved') return res.status(400).json({ error: 'Rota já reservada.' });

    route.status = 'reserved';
    route.reservedBy = db.profile.name;
    db.transactions.unshift({
      id: `tx-${Date.now()}`,
      title: `Frete Retorno Vazio · ${route.origin.city} → ${route.destination.city}`,
      category: 'frete',
      amount: route.emptyReturnPrice,
      type: 'debit',
      date: 'Agora',
    });
    saveDb(db);
    res.json({ route, transactions: db.transactions });
  });

  // Mode 4B: Moving & Freight Requests + Trucker Bids
  app.post('/api/freights', (req, res) => {
    const {
      kind,
      title,
      originId,
      destinationId,
      truckTypeNeeded,
      estimatedWeightKg,
      helpersNeeded,
      hasElevator,
      needsPacking,
      proposedBudget,
      scheduledDate,
    } = req.body || {};

    const origin = byId(originId);
    const destination = byId(destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const budget = Math.max(180, Number(proposedBudget) || Math.round(distanceKm * 6.5 + 280));

    const item: FreightRequest = {
      id: `freight-${Date.now()}`,
      clientName: db.profile.name,
      kind: kind || 'mudanca_residencial',
      title: title || `Frete ${origin.city} → ${destination.city}`,
      origin,
      destination,
      distanceKm,
      truckTypeNeeded: (truckTypeNeeded as TruckType) || '3/4 Baú',
      estimatedWeightKg: Number(estimatedWeightKg) || 1200,
      helpersNeeded: Number(helpersNeeded) || 2,
      hasElevator: Boolean(hasElevator),
      needsPacking: Boolean(needsPacking),
      proposedBudget: budget,
      scheduledDate: scheduledDate || 'Esta semana · Manhã',
      status: 'open_bids',
      bids: [
        {
          id: `fbid-${Date.now()}`,
          truckerName: 'Cleiton Machado · Retorno Express',
          truckerRating: 4.94,
          truckType: (truckTypeNeeded as TruckType) || '3/4 Baú',
          price: Math.round(budget * 0.92),
          helpersIncluded: Number(helpersNeeded) || 2,
          etaText: 'Estou voltando vazio por essa rodovia!',
          note: 'Aproveito meu retorno vazio para fazer por esse valor reduzido.',
        },
      ],
      createdAt: new Date().toISOString(),
    };

    db.freights.unshift(item);
    saveDb(db);
    res.status(201).json(item);
  });

  app.post('/api/freights/:id/bids', (req, res) => {
    const item = db.freights.find((f) => f.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Frete não encontrado.' });

    const bid = {
      id: `fbid-${Date.now()}`,
      truckerName: req.body?.truckerName || db.profile.name,
      truckerRating: db.profile.rating,
      truckType: (req.body?.truckType as TruckType) || db.profile.truckType,
      price: Math.max(150, Number(req.body?.price) || item.proposedBudget),
      helpersIncluded: Number(req.body?.helpersIncluded) ?? item.helpersNeeded,
      etaText: req.body?.etaText || 'Disponível imediato para coleta',
      note: req.body?.note || 'Proposta com rastreamento e seguro de carga.',
    };
    item.bids.unshift(bid);
    saveDb(db);
    res.status(201).json(item);
  });

  app.post('/api/freights/:id/accept', (req, res) => {
    const item = db.freights.find((f) => f.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Frete não encontrado.' });
    const bid = item.bids.find((b) => b.id === req.body?.bidId);
    if (!bid) return res.status(400).json({ error: 'Lance inválido.' });

    item.status = 'booked';
    item.acceptedBidId = bid.id;
    db.transactions.unshift({
      id: `tx-${Date.now()}`,
      title: `Mudança/Frete · ${bid.truckerName}`,
      category: 'frete',
      amount: bid.price,
      type: 'debit',
      date: 'Agora',
    });
    saveDb(db);
    res.json({ freight: item, transactions: db.transactions });
  });

  // Vite dev middleware or production static
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Froc X Uber server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
