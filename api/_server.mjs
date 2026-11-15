// server/app.ts
import express from "express";

// server/services.ts
import { randomUUID, randomInt } from "node:crypto";

// src/data/locations.ts
var BRAZIL_LOCATIONS = [
  // Urban São Paulo Metropolitan Hubs
  {
    id: "sp-paulista",
    name: "Av. Paulista, 1578 (MASP)",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.5614,
    lng: -46.6559,
    kind: "avenue"
  },
  {
    id: "sp-pinheiros",
    name: "Largo da Batata \xB7 Pinheiros",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.5672,
    lng: -46.6939,
    kind: "neighborhood"
  },
  {
    id: "sp-faria-lima",
    name: "Av. Brig. Faria Lima, 3477",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.5868,
    lng: -46.6821,
    kind: "avenue"
  },
  {
    id: "sp-tiete",
    name: "Terminal Rodovi\xE1rio Tiet\xEA",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.5162,
    lng: -46.6254,
    kind: "terminal"
  },
  {
    id: "sp-cgh",
    name: "Aeroporto de Congonhas (CGH)",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.6261,
    lng: -46.6564,
    kind: "airport"
  },
  {
    id: "sp-gru",
    name: "Aeroporto de Guarulhos (GRU)",
    city: "Guarulhos",
    state: "SP",
    zone: "urban",
    lat: -23.4356,
    lng: -46.4731,
    kind: "airport"
  },
  {
    id: "sp-centro",
    name: "Pra\xE7a da S\xE9 \xB7 Centro Hist\xF3rico",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.5503,
    lng: -46.6342,
    kind: "neighborhood"
  },
  {
    id: "sp-barra-funda",
    name: "Terminal Barra Funda",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.5255,
    lng: -46.6673,
    kind: "terminal"
  },
  {
    id: "sp-morumbi",
    name: "Shopping Morumbi \xB7 Marginal Pinheiros",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.6231,
    lng: -46.6989,
    kind: "neighborhood"
  },
  {
    id: "sp-itaquera",
    name: "Arena Itaquera \xB7 Zona Leste",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.5453,
    lng: -46.4743,
    kind: "neighborhood"
  },
  {
    id: "sp-santana",
    name: "Santana \xB7 Zona Norte",
    city: "S\xE3o Paulo",
    state: "SP",
    zone: "urban",
    lat: -23.5023,
    lng: -46.6248,
    kind: "neighborhood"
  },
  {
    id: "sp-santo-andre",
    name: "Centro \xB7 Santo Andr\xE9 (ABC)",
    city: "Santo Andr\xE9",
    state: "SP",
    zone: "urban",
    lat: -23.6572,
    lng: -46.5333,
    kind: "city"
  },
  // Intercity & Interstate Hubs (BlaBlaCar & Caminhões)
  {
    id: "br-campinas",
    name: "Campinas \xB7 Terminal Ramos de Azevedo",
    city: "Campinas",
    state: "SP",
    zone: "intercity",
    lat: -22.9056,
    lng: -47.0608,
    kind: "city"
  },
  {
    id: "br-santos",
    name: "Santos \xB7 Porto e Ponta da Praia",
    city: "Santos",
    state: "SP",
    zone: "intercity",
    lat: -23.9608,
    lng: -46.3336,
    kind: "hub"
  },
  {
    id: "br-rio",
    name: "Rio de Janeiro \xB7 Novo Rio / Centro",
    city: "Rio de Janeiro",
    state: "RJ",
    zone: "intercity",
    lat: -22.8999,
    lng: -43.2094,
    kind: "city"
  },
  {
    id: "br-curitiba",
    name: "Curitiba \xB7 Rodoferrovi\xE1ria / CIC",
    city: "Curitiba",
    state: "PR",
    zone: "intercity",
    lat: -25.4372,
    lng: -49.26,
    kind: "city"
  },
  {
    id: "br-bh",
    name: "Belo Horizonte \xB7 Rodovi\xE1ria / Contagem",
    city: "Belo Horizonte",
    state: "MG",
    zone: "intercity",
    lat: -19.9167,
    lng: -43.9345,
    kind: "city"
  },
  {
    id: "br-florianopolis",
    name: "Florian\xF3polis \xB7 Centro / Continente",
    city: "Florian\xF3polis",
    state: "SC",
    zone: "intercity",
    lat: -27.5954,
    lng: -48.548,
    kind: "city"
  },
  {
    id: "br-ribeirao",
    name: "Ribeir\xE3o Preto \xB7 Polo Log\xEDstico Anhanguera",
    city: "Ribeir\xE3o Preto",
    state: "SP",
    zone: "intercity",
    lat: -21.1704,
    lng: -47.8103,
    kind: "hub"
  },
  {
    id: "br-goiania",
    name: "Goi\xE2nia \xB7 Polo Atacadista BR-153",
    city: "Goi\xE2nia",
    state: "GO",
    zone: "intercity",
    lat: -16.6869,
    lng: -49.2648,
    kind: "city"
  },
  {
    id: "br-brasilia",
    name: "Bras\xEDlia \xB7 Eixo Rodovi\xE1rio DF",
    city: "Bras\xEDlia",
    state: "DF",
    zone: "intercity",
    lat: -15.7975,
    lng: -47.8919,
    kind: "city"
  },
  {
    id: "br-poa",
    name: "Porto Alegre \xB7 Zona Industrial / Centro",
    city: "Porto Alegre",
    state: "RS",
    zone: "intercity",
    lat: -30.0346,
    lng: -51.2177,
    kind: "city"
  },
  {
    id: "br-sjc",
    name: "S\xE3o Jos\xE9 dos Campos \xB7 Via Dutra",
    city: "S\xE3o Jos\xE9 dos Campos",
    state: "SP",
    zone: "intercity",
    lat: -23.1896,
    lng: -45.8841,
    kind: "hub"
  }
];
var RIDE_CATEGORIES = [
  {
    id: "froc_x",
    label: "Froc X",
    tag: "Estilo Uber X",
    description: "Carros compactos econ\xF4micos para o dia a dia",
    baseFare: 5.5,
    perKm: 2.15,
    perMin: 0.35,
    etaOffsetMin: 3,
    capacity: "4 passageiros"
  },
  {
    id: "froc_99",
    label: "Froc 99 Pop",
    tag: "Mais barato \xB7 99",
    description: "Tarifa promocional e t\xE1xis parceiros com desconto",
    baseFare: 4.8,
    perKm: 1.95,
    perMin: 0.3,
    etaOffsetMin: 4,
    capacity: "4 passageiros"
  },
  {
    id: "froc_comfort",
    label: "Froc Black",
    tag: "Executivo",
    description: "Sedans espa\xE7osos, ar-condicionado e nota 4.9+",
    baseFare: 8.9,
    perKm: 2.95,
    perMin: 0.48,
    etaOffsetMin: 5,
    capacity: "4 passageiros"
  },
  {
    id: "froc_moto",
    label: "Froc Moto",
    tag: "Ultra r\xE1pido",
    description: "Evite o tr\xE2nsito com capacete higienizado incluso",
    baseFare: 3.5,
    perKm: 1.25,
    perMin: 0.18,
    etaOffsetMin: 2,
    capacity: "1 passageiro"
  },
  {
    id: "froc_delivery",
    label: "Froc Flash",
    tag: "Envio de pacotes",
    description: "Entrega expressa de chaves, documentos e caixas",
    baseFare: 4.5,
    perKm: 1.45,
    perMin: 0.2,
    etaOffsetMin: 3,
    capacity: "At\xE9 20 kg"
  }
];
function calculateDistanceKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const straight = 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.max(1.2, Math.round(straight * 1.26 * 10) / 10);
}
function estimateDurationMin(distanceKm, mode) {
  const avgSpeedKmh = mode === "moto" ? 38 : mode === "highway" ? 76 : 26;
  return Math.max(4, Math.round(distanceKm / avgSpeedKmh * 60 + 2));
}

// server/settings.ts
var DEFAULT_SETTINGS = {
  commissionPercent: 12,
  surgeEnabled: true,
  maxSurge: 2,
  rideSearchTimeoutMin: 10,
  indriveOpenTimeoutMin: 30,
  pointsPerReal: 1,
  pointsPerRedeem: 100
};
var SETTINGS_LIMITS = {
  commissionPercent: [0, 40],
  surgeEnabled: "boolean",
  maxSurge: [1, 3],
  rideSearchTimeoutMin: [3, 60],
  indriveOpenTimeoutMin: [5, 240],
  pointsPerReal: [0, 10],
  pointsPerRedeem: [20, 1e4]
};
var REDEEM_VALUE_CENTS = 500;

// server/geo.ts
var H3_RESOLUTION = 8;
var DISPATCH_RING = 6;
var SURGE_RING = 3;
async function createH3Geo() {
  const h3 = await import("h3-js");
  return {
    cellOf: (lat, lng) => h3.latLngToCell(lat, lng, H3_RESOLUTION),
    ring: (cell, k) => h3.gridDisk(cell, k)
  };
}
function createGridGeo(step = 6e-3) {
  return {
    cellOf: (lat, lng) => `g:${Math.floor(lat / step)}:${Math.floor(lng / step)}`,
    ring: (cell, k) => {
      const [, a, b] = cell.split(":");
      const out = [];
      for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) out.push(`g:${Number(a) + i}:${Number(b) + j}`);
      return out;
    }
  };
}

// server/services.ts
var AppError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
var fail = (status, code, message) => {
  throw new AppError(status, code, message);
};
var MIN_WITHDRAWAL_CENTS = 2e3;
var TRUCK_TYPES = ["VUC / Utilit\xE1rio", "3/4 Ba\xFA", "Toco Aberto", "Truck Ba\xFA", "Carreta Sider"];
var DOC_TYPES = { driver: ["cnh", "crlv"], trucker: ["cnh", "crlv", "antt"] };
var ALLOWED_DOC_TYPES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
var MAX_DOC_BYTES = 3 * 1024 * 1024;
var LOCATION_FRESH_MS = 3 * 60 * 1e3;
var round2 = (n) => Math.round(n * 100) / 100;
var toCents = (reais) => Math.round(reais * 100);
var toReais = (cents) => round2(cents / 100);
var round6 = (n) => Math.round(n * 1e6) / 1e6;
var brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function negotiationFloor(distanceKm) {
  const km = Math.max(0.1, distanceKm);
  const minutes = Math.max(1, Math.round(km * 2));
  return round2(Math.max(8.5, km * 1.65 + minutes * 0.2));
}
function freightFloor(distanceKm) {
  return round2(Math.max(150, Math.max(1, distanceKm) * 2.2));
}
function parseAdminEmails(raw) {
  const joined = Array.isArray(raw) ? raw.join(",") : raw || "";
  return joined.split(/[\s,;]+/).map((e) => e.replace(/^["'<]+|["'>]+$/g, "").trim().toLowerCase()).filter((e) => e.includes("@"));
}
function text(value, max, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}
function num(value, min, max, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    fail(400, "invalid_" + field, `Valor inv\xE1lido para ${field} (entre ${min} e ${max}).`);
  return n;
}
function paymentMethod(value) {
  if (value === "froc_pay" || value === "cash") return value;
  return fail(400, "invalid_payment", "Escolha Carteira Froc (Pix/cart\xE3o) ou dinheiro.");
}
function resolvePoint(point, fallbackId) {
  if (point && typeof point === "object") {
    const p = point;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && typeof p.name === "string") {
      return {
        id: text(p.id, 80) || `ponto-${lat.toFixed(5)}-${lng.toFixed(5)}`,
        name: text(p.name, 160),
        city: text(p.city, 80) || "Brasil",
        state: text(p.state, 4) || "BR",
        zone: p.zone === "intercity" ? "intercity" : "urban",
        lat,
        lng,
        kind: ["avenue", "airport", "terminal", "neighborhood", "city", "hub"].includes(p.kind) ? p.kind : "avenue"
      };
    }
  }
  const found = BRAZIL_LOCATIONS.find((l) => l.id === fallbackId);
  return found ?? fail(400, "invalid_location", "Escolha um local v\xE1lido de partida e destino.");
}
function involvement(uid, ownerId, providerId) {
  if (ownerId === uid) return "owner";
  if (providerId === uid) return "provider";
  return null;
}
var byNewest = (items) => items.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
function uniqueById(items) {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((i) => seen.has(i.id) ? false : (seen.add(i.id), true));
}
var FrocService = class {
  constructor(store, deps = {}) {
    this.cfg = { ...DEFAULT_SETTINGS };
    this.cfgLoadedAt = 0;
    this.lastSweep = 0;
    this.store = store;
    this.deps = deps;
    this.geo = deps.geo ?? createGridGeo();
  }
  // ------------------------------------------------------------ configurações
  async settings() {
    if (Date.now() - this.cfgLoadedAt > 3e4) {
      const stored = await this.store.get("settings", "platform");
      this.cfg = { ...DEFAULT_SETTINGS, ...stored };
      this.cfgLoadedAt = Date.now();
    }
    return this.cfg;
  }
  /** Parte do prestador, em centavos, conforme a comissão configurada. */
  providerCut(cents) {
    return Math.round(cents * (1 - this.cfg.commissionPercent / 100));
  }
  async updateSettings(auth, patch) {
    this.requireAdmin(auth);
    const current = await this.settings();
    const next = { ...current };
    for (const [key, limits] of Object.entries(SETTINGS_LIMITS)) {
      if (!(key in patch)) continue;
      if (limits === "boolean") next[key] = patch[key] === true;
      else next[key] = round2(num(patch[key], limits[0], limits[1], key));
    }
    await this.store.set("settings", "platform", { ...next, updatedBy: auth.email, updatedAt: this.iso() });
    this.cfg = next;
    this.cfgLoadedAt = Date.now();
    return next;
  }
  /** Conta bloqueada pela administração não usa o app (conferido em toda requisição). */
  async checkAccess(auth) {
    const user = await this.store.get("users", auth.uid);
    if (user?.blocked && !this.isAdmin(auth))
      fail(403, "blocked", "Sua conta est\xE1 bloqueada" + (user.blockedReason ? `: ${user.blockedReason}` : ".") + " Fale com o suporte.");
  }
  now() {
    return (this.deps.now ?? (() => /* @__PURE__ */ new Date()))();
  }
  iso() {
    return this.now().toISOString();
  }
  isAdmin(auth) {
    return auth.emailVerified && parseAdminEmails(this.deps.adminEmails).includes(auth.email.trim().toLowerCase());
  }
  // ---------------------------------------------------------------- usuários
  async ensureUser(auth) {
    const existing = await this.store.get("users", auth.uid);
    if (existing) return existing;
    const user = {
      uid: auth.uid,
      email: auth.email,
      name: text(auth.name, 80) || auth.email.split("@")[0],
      phone: "",
      city: "",
      rating: 5,
      ratingCount: 0,
      balanceCents: 0,
      completedTrips: 0,
      driverOnline: false,
      driverVehicle: "",
      driverPlate: "",
      truckModel: "",
      truckType: "3/4 Ba\xFA",
      truckPlate: "",
      companyName: "",
      driverStatus: "none",
      truckerStatus: "none",
      driverDocs: {},
      truckerDocs: {},
      createdAt: this.iso()
    };
    await this.store.set("users", auth.uid, user);
    return user;
  }
  profileView(user, auth) {
    return {
      uid: user.uid,
      email: user.email,
      emailVerified: auth.emailVerified,
      isAdmin: this.isAdmin(auth),
      driverStatus: user.driverStatus,
      truckerStatus: user.truckerStatus,
      rejectionReason: user.rejectionReason,
      completedTrips: user.completedTrips,
      companyName: user.companyName,
      name: user.name,
      phone: user.phone,
      city: user.city,
      rating: round2(user.rating),
      walletBalance: toReais(user.balanceCents),
      driverOnline: user.driverOnline,
      driverVehicle: user.driverVehicle,
      driverPlate: user.driverPlate,
      truckModel: user.truckModel,
      truckType: user.truckType,
      truckPlate: user.truckPlate,
      points: user.points || 0,
      passengerRating: round2(user.passengerRating ?? 5),
      pointsPerRedeem: this.cfg.pointsPerRedeem,
      commissionPercent: this.cfg.commissionPercent,
      driverDocsSent: Object.keys(user.driverDocs || {}),
      truckerDocsSent: Object.keys(user.truckerDocs || {})
    };
  }
  async updateProfile(auth, patch) {
    const user = await this.ensureUser(auth);
    const next = {};
    if ("name" in patch) next.name = text(patch.name, 80) || user.name;
    if ("phone" in patch) next.phone = text(patch.phone, 30);
    if ("city" in patch) next.city = text(patch.city, 80);
    if ("driverOnline" in patch) {
      if (patch.driverOnline === true && user.driverStatus !== "approved" && user.truckerStatus !== "approved")
        fail(403, "not_approved", "Seu cadastro de motorista ainda n\xE3o foi aprovado.");
      next.driverOnline = patch.driverOnline === true;
    }
    if (user.driverStatus !== "approved") {
      if ("driverVehicle" in patch) next.driverVehicle = text(patch.driverVehicle, 80);
      if ("driverPlate" in patch) next.driverPlate = text(patch.driverPlate, 10).toUpperCase();
    }
    if (user.truckerStatus !== "approved") {
      if ("truckModel" in patch) next.truckModel = text(patch.truckModel, 80);
      if ("truckPlate" in patch) next.truckPlate = text(patch.truckPlate, 10).toUpperCase();
      if ("truckType" in patch && TRUCK_TYPES.includes(patch.truckType)) next.truckType = patch.truckType;
      if ("companyName" in patch) next.companyName = text(patch.companyName, 80);
    }
    await this.store.update("users", auth.uid, next);
    return this.profileView({ ...user, ...next }, auth);
  }
  async approvedUser(auth, kind) {
    const user = await this.ensureUser(auth);
    const status = kind === "driver" ? user.driverStatus : user.truckerStatus;
    if (status !== "approved")
      fail(
        403,
        "not_approved",
        kind === "driver" ? "Para atuar como motorista, envie seus documentos na aba Conta e aguarde a aprova\xE7\xE3o." : "Para atuar como caminhoneiro, envie seus documentos na aba Conta e aguarde a aprova\xE7\xE3o."
      );
    return user;
  }
  async anyProvider(auth) {
    const user = await this.ensureUser(auth);
    if (user.driverStatus !== "approved" && user.truckerStatus !== "approved")
      fail(403, "not_approved", "Seu cadastro de motorista ainda n\xE3o foi aprovado.");
    return user;
  }
  // ------------------------------------------------------------- carteira
  ledger(tx, uid, title, category, cents, type) {
    const id = randomUUID();
    tx.set("transactions", id, { id, uid, title, category, amountCents: cents, type, createdAt: this.iso() });
  }
  moveMoney(tx, user, delta) {
    user.balanceCents += delta;
    tx.update("users", user.uid, { balanceCents: user.balanceCents });
  }
  debit(tx, user, cents, title, category, allowNegative = false) {
    if (!allowNegative && user.balanceCents < cents)
      fail(402, "insufficient_balance", "Saldo insuficiente na carteira. Fa\xE7a uma recarga por Pix ou cart\xE3o.");
    this.moveMoney(tx, user, -cents);
    this.ledger(tx, user.uid, title, category, cents, "debit");
  }
  credit(tx, user, cents, title, category) {
    this.moveMoney(tx, user, cents);
    this.ledger(tx, user.uid, title, category, cents, "credit");
  }
  async mustGet(tx, col, id, label) {
    const doc = await tx.get(col, id);
    return doc ?? fail(404, "not_found", `${label} n\xE3o encontrado(a).`);
  }
  /** Registra a comissão da plataforma (usado nos relatórios do Admin). */
  platformRevenue(tx, kind, grossCents, feeCents) {
    const id = randomUUID();
    tx.set("platformLedger", id, { id, kind, grossCents, feeCents, createdAt: this.iso() });
  }
  /** Pontos de fidelidade para quem contratou o serviço. */
  awardPoints(tx, client, cents) {
    if (!client || cents <= 0 || this.cfg.pointsPerReal <= 0) return;
    const pts = Math.floor(cents / 100 * this.cfg.pointsPerReal);
    if (pts <= 0) return;
    client.points = (client.points || 0) + pts;
    tx.update("users", client.uid, { points: client.points });
  }
  /** Paga o prestador (100% menos a comissão) e registra o serviço concluído para os dois lados. */
  payProvider(tx, provider, client, escrowCents, method, title, kind = "corrida") {
    const pct = this.cfg.commissionPercent;
    if (method === "froc_pay" && escrowCents > 0) {
      this.credit(tx, provider, this.providerCut(escrowCents), `Ganho \xB7 ${title} (${100 - pct}% l\xEDquido)`, "ganho_motorista");
    } else if (method === "cash" && escrowCents > 0 && pct > 0) {
      this.debit(tx, provider, escrowCents - this.providerCut(escrowCents), `Taxa Froc ${pct}% \xB7 ${title} (pago em dinheiro)`, "taxa", true);
    }
    if (escrowCents > 0) this.platformRevenue(tx, kind, escrowCents, escrowCents - this.providerCut(escrowCents));
    provider.completedTrips += 1;
    tx.update("users", provider.uid, { completedTrips: provider.completedTrips });
    if (client && client.uid !== provider.uid) {
      client.completedTrips += 1;
      tx.update("users", client.uid, { completedTrips: client.completedTrips });
      this.awardPoints(tx, client, escrowCents);
    }
  }
  async transactions(uid) {
    const items = byNewest(await this.store.query("transactions", [["uid", "==", uid]], 300)).slice(0, 60);
    return items.map((t) => ({
      id: String(t.id),
      title: String(t.title),
      category: t.category,
      amount: toReais(Number(t.amountCents)),
      type: t.type,
      date: new Date(String(t.createdAt)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })
    }));
  }
  async createTopup(auth, amountReais) {
    const payments = this.deps.payments;
    if (!payments?.configured)
      fail(503, "payments_not_configured", "Recargas ainda n\xE3o est\xE3o dispon\xEDveis: o Mercado Pago n\xE3o foi configurado na plataforma.");
    const user = await this.ensureUser(auth);
    const amountCents = toCents(num(amountReais, 10, 5e3, "recarga"));
    const id = randomUUID();
    await this.store.set("topups", id, { id, uid: user.uid, amountCents, status: "pending", createdAt: this.iso() });
    let checkout;
    try {
      checkout = await payments.createCheckout({
        reference: id,
        amountCents,
        title: "Recarga Carteira Froc X Uber",
        payerEmail: user.email
      });
    } catch (error) {
      console.error("Mercado Pago recusou a cria\xE7\xE3o do pagamento:", error);
      await this.store.update("topups", id, { status: "failed", error: String(error?.message || error).slice(0, 200) });
      return fail(
        502,
        "payment_provider",
        "O Mercado Pago n\xE3o abriu o pagamento agora. Tente de novo em instantes; se continuar, o administrador deve conferir o token do Mercado Pago."
      );
    }
    await this.store.update("topups", id, { preferenceId: checkout.preferenceId });
    return { topupId: id, checkoutUrl: checkout.checkoutUrl };
  }
  /** Confere no Mercado Pago e credita UMA vez se o pagamento foi aprovado. */
  async confirmTopup(topupId, uid) {
    const topup = await this.store.get("topups", topupId);
    if (!topup || uid && topup.uid !== uid) return fail(404, "not_found", "Recarga n\xE3o encontrada.");
    if (topup.status === "approved") return { status: "approved" };
    const payment = await this.deps.payments?.findApproved(topupId);
    if (!payment) return { status: "pending" };
    if (payment.amountCents !== Number(topup.amountCents))
      fail(409, "amount_mismatch", "O valor pago n\xE3o corresponde \xE0 recarga.");
    await this.store.transaction(async (tx) => {
      const current = await this.mustGet(tx, "topups", topupId, "Recarga");
      if (current.status === "approved") return;
      const user = await this.mustGet(tx, "users", String(current.uid), "Usu\xE1rio");
      tx.update("topups", topupId, { status: "approved", paymentId: payment.paymentId, approvedAt: this.iso() });
      this.credit(tx, user, Number(current.amountCents), "Recarga via Mercado Pago (Pix/cart\xE3o)", "recarga_pix");
    });
    return { status: "approved" };
  }
  /** Aviso automático do Mercado Pago (assinatura já conferida na rota). */
  async handlePaymentNotification(paymentId) {
    const payment = await this.deps.payments?.getPayment(paymentId);
    if (!payment?.reference) return { handled: false };
    const topup = await this.store.get("topups", payment.reference);
    if (!topup) return { handled: false };
    await this.confirmTopup(payment.reference);
    return { handled: true };
  }
  async requestWithdrawal(auth, amountReais, pixKey) {
    await this.anyProvider(auth);
    const amountCents = toCents(num(amountReais, MIN_WITHDRAWAL_CENTS / 100, 5e4, "saque"));
    const key = text(pixKey, 120);
    if (key.length < 5) fail(400, "invalid_pix_key", "Informe a chave Pix para receber o saque.");
    const id = randomUUID();
    await this.store.transaction(async (tx) => {
      const user = await this.mustGet(tx, "users", auth.uid, "Usu\xE1rio");
      this.debit(tx, user, amountCents, `Saque solicitado \xB7 Pix ${key}`, "saque");
      tx.set("withdrawals", id, { id, uid: user.uid, name: user.name, amountCents, pixKey: key, status: "pending", createdAt: this.iso() });
    });
    return { id };
  }
  // ------------------------------------------- cadastro de motorista/caminhoneiro
  async uploadDocument(auth, kind, docType, contentType, base64) {
    if (kind !== "driver" && kind !== "trucker") return fail(400, "invalid_kind", "Tipo de cadastro inv\xE1lido.");
    if (!DOC_TYPES[kind].includes(String(docType))) fail(400, "invalid_doc", "Documento inv\xE1lido.");
    if (!ALLOWED_DOC_TYPES.has(String(contentType))) fail(400, "invalid_file", "Envie foto (JPG, PNG, WEBP) ou PDF.");
    if (!this.deps.files) fail(503, "storage_not_configured", "Envio de documentos indispon\xEDvel: armazenamento n\xE3o configurado.");
    const bytes = Buffer.from(String(base64 || "").replace(/^data:[^,]*,/, ""), "base64");
    if (!bytes.length || bytes.length > MAX_DOC_BYTES) fail(400, "file_size", "O arquivo deve ter at\xE9 3 MB.");
    const user = await this.ensureUser(auth);
    const status = kind === "driver" ? user.driverStatus : user.truckerStatus;
    if (status === "approved" || status === "pending") fail(409, "already_submitted", "Seu cadastro j\xE1 foi enviado.");
    const ext = String(contentType) === "application/pdf" ? "pdf" : String(contentType).split("/")[1];
    const path = `froc-x-uber/documentos/${user.uid}/${kind}-${docType}-${this.now().getTime()}.${ext}`;
    await this.deps.files.save(path, String(contentType), new Uint8Array(bytes));
    const field = kind === "driver" ? "driverDocs" : "truckerDocs";
    await this.store.update("users", user.uid, { [field]: { ...user[field], [String(docType)]: path } });
    return { ok: true };
  }
  async applyAsProvider(auth, kind, body) {
    if (kind !== "driver" && kind !== "trucker") return fail(400, "invalid_kind", "Tipo de cadastro inv\xE1lido.");
    const user = await this.ensureUser(auth);
    const status = kind === "driver" ? user.driverStatus : user.truckerStatus;
    if (status === "approved") fail(409, "already_approved", "Cadastro j\xE1 aprovado.");
    const docs = (kind === "driver" ? user.driverDocs : user.truckerDocs) || {};
    const missing = DOC_TYPES[kind].filter((d) => !docs[d]);
    if (missing.length) fail(400, "missing_documents", "Envie todos os documentos: " + missing.join(", ").toUpperCase() + ".");
    const phone = text(body.phone, 30) || user.phone;
    if (phone.replace(/\D/g, "").length < 10) fail(400, "invalid_phone", "Informe um telefone com DDD.");
    const vehicle = text(body.vehicle, 80);
    const plate = text(body.plate, 10).toUpperCase();
    if (vehicle.length < 3) fail(400, "invalid_vehicle", "Informe o modelo e a cor do ve\xEDculo.");
    if (!/^[A-Z]{3}-?[0-9][A-Z0-9][0-9]{2}$/.test(plate)) fail(400, "invalid_plate", "Placa inv\xE1lida (ex.: ABC1D23).");
    const next = { phone, rejectionReason: "" };
    if (kind === "driver") Object.assign(next, { driverVehicle: vehicle, driverPlate: plate, driverStatus: "pending", driverSubmittedAt: this.iso() });
    else {
      const truckType = TRUCK_TYPES.includes(body.truckType) ? body.truckType : fail(400, "invalid_truck", "Tipo de caminh\xE3o inv\xE1lido.");
      Object.assign(next, {
        truckModel: vehicle,
        truckPlate: plate,
        truckType,
        companyName: text(body.companyName, 80),
        truckerStatus: "pending",
        truckerSubmittedAt: this.iso()
      });
    }
    await this.store.update("users", user.uid, next);
    return this.profileView({ ...user, ...next }, auth);
  }
  // ---------------------------------------------------------------- admin
  requireAdmin(auth) {
    if (!this.isAdmin(auth)) fail(403, "forbidden", "Acesso restrito \xE0 administra\xE7\xE3o.");
  }
  async adminOverview(auth) {
    this.requireAdmin(auth);
    const [drivers, truckers, withdrawals, users, sos, settings] = await Promise.all([
      this.store.query("users", [["driverStatus", "==", "pending"]], 100),
      this.store.query("users", [["truckerStatus", "==", "pending"]], 100),
      this.store.query("withdrawals", [["status", "==", "pending"]], 100),
      this.store.count("users", []),
      this.store.query("sos", [["status", "==", "open"]], 100),
      this.settings()
    ]);
    const signed = async (path) => this.deps.files ? this.deps.files.signedUrl(path) : "";
    const applications = await Promise.all(
      [
        ...drivers.map((u) => ({ u, kind: "driver" })),
        ...truckers.map((u) => ({ u, kind: "trucker" }))
      ].map(async ({ u, kind }) => {
        const docs = (kind === "driver" ? u.driverDocs : u.truckerDocs) || {};
        return {
          uid: u.uid,
          name: u.name,
          email: u.email,
          phone: u.phone,
          kind,
          vehicle: kind === "driver" ? u.driverVehicle : u.truckModel,
          plate: kind === "driver" ? u.driverPlate : u.truckPlate,
          truckType: kind === "trucker" ? u.truckType : void 0,
          companyName: kind === "trucker" ? u.companyName : void 0,
          submittedAt: String((kind === "driver" ? u.driverSubmittedAt : u.truckerSubmittedAt) ?? ""),
          documents: await Promise.all(Object.entries(docs).map(async ([type, path]) => ({ type, url: await signed(path) })))
        };
      })
    );
    return {
      applications,
      withdrawals: byNewest(withdrawals).map((w) => ({
        id: String(w.id),
        uid: String(w.uid),
        name: String(w.name),
        amount: toReais(Number(w.amountCents)),
        pixKey: String(w.pixKey),
        status: w.status,
        createdAt: String(w.createdAt)
      })),
      totals: { users, pendingApplications: applications.length, pendingWithdrawals: withdrawals.length, openSos: sos.length },
      sos: byNewest(sos),
      settings
    };
  }
  async reviewApplication(auth, uid, kind, decision, reason) {
    this.requireAdmin(auth);
    if (kind !== "driver" && kind !== "trucker") return fail(400, "invalid_kind", "Tipo de cadastro inv\xE1lido.");
    if (decision !== "approved" && decision !== "rejected") return fail(400, "invalid_decision", "Decis\xE3o inv\xE1lida.");
    const user = await this.store.get("users", String(uid)) ?? fail(404, "not_found", "Usu\xE1rio n\xE3o encontrado.");
    const field = kind === "driver" ? "driverStatus" : "truckerStatus";
    if (user[field] !== "pending") fail(409, "not_pending", "Este cadastro n\xE3o est\xE1 aguardando an\xE1lise.");
    const why = text(reason, 300);
    if (decision === "rejected" && why.length < 5) fail(400, "reason_required", "Explique o motivo da recusa.");
    await this.store.update("users", user.uid, {
      [field]: decision,
      rejectionReason: decision === "rejected" ? why : "",
      reviewedBy: auth.email,
      reviewedAt: this.iso()
    });
    return { ok: true };
  }
  async resolveWithdrawal(auth, id, decision) {
    this.requireAdmin(auth);
    if (decision !== "paid" && decision !== "rejected") return fail(400, "invalid_decision", "Decis\xE3o inv\xE1lida.");
    await this.store.transaction(async (tx) => {
      const w = await this.mustGet(tx, "withdrawals", String(id), "Saque");
      if (w.status !== "pending") fail(409, "not_pending", "Este saque j\xE1 foi resolvido.");
      const user = await this.mustGet(tx, "users", String(w.uid), "Usu\xE1rio");
      tx.update("withdrawals", String(id), { status: decision, resolvedBy: auth.email, resolvedAt: this.iso() });
      if (decision === "rejected") this.credit(tx, user, Number(w.amountCents), "Saque recusado \xB7 valor devolvido", "estorno");
    });
    return { ok: true };
  }
  // ------------------------------------------------------- 1) corrida Uber/99
  rideView(r, uid) {
    const mine = involvement(uid, r.passengerId, r.driverId);
    const { escrowCents: _e, priceCents: _p, ...rest } = r;
    return {
      ...rest,
      mine,
      pinCode: mine === "owner" ? String(r.pinCode) : ""
    };
  }
  async createRide(auth, body) {
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const category = RIDE_CATEGORIES.find((c) => c.id === body.categoryId) ?? fail(400, "invalid_category", "Categoria inv\xE1lida.");
    const method = paymentMethod(body.paymentMethod);
    const distanceKm = calculateDistanceKm(origin, destination);
    if (distanceKm > 300) fail(400, "too_far", "Para viagens longas, use Caronas.");
    const durationMin = estimateDurationMin(distanceKm, category.id === "froc_moto" ? "moto" : "urban");
    const surge = await this.surgeAt(origin.lat, origin.lng);
    const basePrice = Math.max(7.5, round2(category.baseFare + distanceKm * category.perKm + durationMin * category.perMin));
    const price = round2(basePrice * surge);
    const priceCents = toCents(price);
    const active = await this.store.query("rides", [["passengerId", "==", auth.uid]], 200);
    if (active.some((r) => ["searching", "accepted", "arriving", "in_progress"].includes(String(r.status))))
      fail(409, "ride_in_progress", "Voc\xEA j\xE1 tem uma corrida em andamento.");
    const id = randomUUID();
    const ride = await this.store.transaction(async (tx) => {
      const user = await this.mustGet(tx, "users", auth.uid, "Usu\xE1rio");
      const doc = {
        id,
        passengerId: user.uid,
        passengerName: user.name,
        passengerRating: round2(user.passengerRating ?? 5),
        origin,
        destination,
        stops: Array.isArray(body.stops) ? body.stops.map((s) => text(s, 120)).filter(Boolean).slice(0, 3) : [],
        categoryId: category.id,
        categoryLabel: category.label,
        distanceKm,
        durationMin,
        price,
        priceCents,
        discountApplied: 0,
        surgeMultiplier: surge,
        originCell: this.geo.cellOf(origin.lat, origin.lng),
        paymentMethod: method,
        pinCode: String(randomInt(1e3, 1e4)),
        status: "searching",
        escrowCents: 0,
        createdAt: this.iso(),
        messages: []
      };
      if (method === "froc_pay") {
        this.debit(tx, user, priceCents, `${category.label} \xB7 valor retido at\xE9 o fim da corrida`, "corrida");
        doc.escrowCents = priceCents;
      }
      tx.set("rides", id, doc);
      return doc;
    });
    return this.rideView(ride, auth.uid);
  }
  async rideAction(auth, rideId, body) {
    await this.settings();
    const action = String(body.action || "");
    if (action === "driver_accept") {
      await this.approvedUser(auth, "driver");
      const driving = await this.store.query("rides", [["driverId", "==", auth.uid]], 200);
      if (driving.some((r) => ["accepted", "arriving", "in_progress"].includes(String(r.status))))
        fail(409, "driver_busy", "Finalize a corrida atual antes de aceitar outra.");
    }
    const result = await this.store.transaction(async (tx) => {
      const ride = await this.mustGet(tx, "rides", rideId, "Corrida");
      const isPassenger = ride.passengerId === auth.uid;
      const isDriver = ride.driverId === auth.uid;
      const status = String(ride.status);
      const set = (patch) => {
        Object.assign(ride, patch);
        tx.update("rides", rideId, patch);
      };
      switch (action) {
        case "driver_accept": {
          if (isPassenger) fail(403, "own_ride", "Voc\xEA n\xE3o pode aceitar a pr\xF3pria corrida.");
          if (status !== "searching") fail(409, "taken", "Esta corrida j\xE1 foi aceita por outro motorista.");
          const driver = await this.mustGet(tx, "users", auth.uid, "Motorista");
          if (!driver.driverOnline) fail(409, "offline", "Fique online para aceitar corridas.");
          const category = RIDE_CATEGORIES.find((c) => c.id === ride.categoryId);
          set({
            status: "accepted",
            driverId: driver.uid,
            driverName: driver.name,
            driverRating: round2(driver.rating),
            vehicleModel: driver.driverVehicle,
            vehiclePlate: driver.driverPlate,
            etaMin: category?.etaOffsetMin ?? 5,
            acceptedAt: this.iso()
          });
          return { ride };
        }
        case "arriving": {
          if (!isDriver) fail(403, "forbidden", "S\xF3 o motorista da corrida pode fazer isso.");
          if (status !== "accepted") fail(409, "invalid_state", "A corrida n\xE3o est\xE1 aguardando chegada.");
          set({ status: "arriving", etaMin: 0 });
          return { ride };
        }
        case "start": {
          if (!isDriver) fail(403, "forbidden", "S\xF3 o motorista da corrida pode iniciar.");
          if (status !== "accepted" && status !== "arriving") fail(409, "invalid_state", "A corrida n\xE3o pode ser iniciada agora.");
          if (String(body.pin || "") !== String(ride.pinCode)) fail(400, "wrong_pin", "PIN incorreto. Pe\xE7a o PIN de 4 d\xEDgitos ao passageiro.");
          set({ status: "in_progress", etaMin: ride.durationMin, startedAt: this.iso() });
          return { ride };
        }
        case "complete": {
          if (!isDriver) fail(403, "forbidden", "S\xF3 o motorista pode finalizar a corrida.");
          if (status !== "in_progress") fail(409, "invalid_state", "A corrida ainda n\xE3o foi iniciada.");
          const driver = await this.mustGet(tx, "users", auth.uid, "Motorista");
          const passenger = await tx.get("users", String(ride.passengerId));
          const amount = ride.paymentMethod === "froc_pay" ? Number(ride.escrowCents) : Number(ride.priceCents);
          set({ status: "completed", etaMin: 0, completedAt: this.iso(), escrowCents: 0 });
          this.payProvider(tx, driver, passenger, amount, ride.paymentMethod, String(ride.categoryLabel), "corrida");
          return { ride };
        }
        case "cancel": {
          if (isPassenger) {
            if (!["searching", "accepted", "arriving"].includes(status)) fail(409, "invalid_state", "N\xE3o \xE9 poss\xEDvel cancelar agora.");
            const passenger = await this.mustGet(tx, "users", auth.uid, "Passageiro");
            const escrow = Number(ride.escrowCents || 0);
            set({ status: "cancelled", escrowCents: 0, cancelledAt: this.iso(), cancelledBy: "passenger" });
            if (escrow > 0) this.credit(tx, passenger, escrow, `Estorno \xB7 ${ride.categoryLabel} cancelada`, "estorno");
            return { ride };
          }
          if (isDriver) {
            if (!["accepted", "arriving"].includes(status)) fail(409, "invalid_state", "N\xE3o \xE9 poss\xEDvel desistir agora.");
            set({
              status: "searching",
              driverId: null,
              driverName: null,
              driverRating: null,
              vehicleModel: null,
              vehiclePlate: null,
              etaMin: null
            });
            return { ride };
          }
          return fail(403, "forbidden", "Voc\xEA n\xE3o participa desta corrida.");
        }
        case "message": {
          if (!isPassenger && !isDriver) fail(403, "forbidden", "Voc\xEA n\xE3o participa desta corrida.");
          const msg = text(body.message, 500);
          if (!msg) fail(400, "empty_message", "Mensagem vazia.");
          const messages = Array.isArray(ride.messages) ? ride.messages : [];
          const time = this.now().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
          set({ messages: [...messages, { sender: isDriver ? "driver" : "passenger", text: msg, time }].slice(-200) });
          return { ride };
        }
        case "rate": {
          if (!isPassenger) fail(403, "forbidden", "S\xF3 o passageiro avalia a corrida.");
          if (status !== "completed" || ride.ratedByPassenger) fail(409, "invalid_state", "Esta corrida n\xE3o pode ser avaliada.");
          const stars = Math.round(num(body.stars, 1, 5, "nota"));
          const driver = await this.mustGet(tx, "users", String(ride.driverId), "Motorista");
          const count = Number(driver.ratingCount || 0);
          const rating = round2((driver.rating * count + stars) / (count + 1));
          tx.update("users", driver.uid, { rating, ratingCount: count + 1 });
          set({ ratedByPassenger: true, passengerStars: stars });
          return { ride };
        }
        case "rate_passenger": {
          if (!isDriver) fail(403, "forbidden", "S\xF3 o motorista avalia o passageiro.");
          if (status !== "completed" || ride.ratedByDriver) fail(409, "invalid_state", "Esta corrida n\xE3o pode ser avaliada.");
          const stars = Math.round(num(body.stars, 1, 5, "nota"));
          const passenger = await this.mustGet(tx, "users", String(ride.passengerId), "Passageiro");
          const count = Number(passenger.passengerRatingCount || 0);
          const rating = round2(((passenger.passengerRating ?? 5) * count + stars) / (count + 1));
          tx.update("users", passenger.uid, { passengerRating: rating, passengerRatingCount: count + 1 });
          set({ ratedByDriver: true, driverStars: stars });
          return { ride };
        }
        default:
          return fail(400, "invalid_action", "A\xE7\xE3o inv\xE1lida.");
      }
    });
    return this.rideView(result.ride, auth.uid);
  }
  // ------------------------------------------------- 2) negociação inDrive
  indriveView(r, uid) {
    const { escrowCents: _e, ...rest } = r;
    const mine = involvement(uid, r.passengerId, r.driverId);
    const offers = Array.isArray(r.offers) ? r.offers : [];
    return {
      ...rest,
      mine,
      // Motorista só vê a própria proposta; o passageiro vê todas.
      offers: mine === "owner" ? offers : offers.filter((o) => o.driverId === uid)
    };
  }
  async createInDrive(auth, body) {
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const method = paymentMethod(body.paymentMethod);
    const distanceKm = calculateDistanceKm(origin, destination);
    const suggestedPrice = round2(5.5 + distanceKm * 2.15 + 4);
    const minimum = negotiationFloor(distanceKm);
    const offer = round2(num(body.passengerOffer, 8, 5e3, "oferta"));
    if (offer < minimum)
      fail(400, "below_floor", `A oferta m\xEDnima para ${distanceKm} km \xE9 ${brl(minimum)} (cobre combust\xEDvel e tempo do motorista).`);
    const user = await this.ensureUser(auth);
    if (method === "froc_pay" && user.balanceCents < toCents(offer))
      fail(402, "insufficient_balance", "Saldo insuficiente para essa oferta. Recarregue a carteira ou escolha dinheiro.");
    const open = await this.store.query("indrive", [["passengerId", "==", auth.uid]], 200);
    if (open.some((r) => r.status === "open" || r.status === "matched"))
      fail(409, "request_in_progress", "Voc\xEA j\xE1 tem um pedido de negocia\xE7\xE3o em andamento.");
    const id = randomUUID();
    const doc = {
      id,
      passengerId: user.uid,
      passengerName: user.name,
      origin,
      destination,
      distanceKm,
      suggestedPrice,
      minimumPrice: minimum,
      passengerOffer: offer,
      paymentMethod: method,
      notes: text(body.notes, 200),
      status: "open",
      offers: [],
      escrowCents: 0,
      createdAt: this.iso()
    };
    await this.store.set("indrive", id, doc);
    return this.indriveView(doc, auth.uid);
  }
  async sendInDriveOffer(auth, id, body) {
    const driver = await this.approvedUser(auth, "driver");
    const offeredPrice = round2(num(body.offeredPrice, 8, 5e3, "proposta"));
    const reqDoc = await this.store.get("indrive", id);
    if (reqDoc && offeredPrice < negotiationFloor(Number(reqDoc.distanceKm)))
      fail(400, "below_floor", `A proposta m\xEDnima \xE9 ${brl(negotiationFloor(Number(reqDoc.distanceKm)))}.`);
    const etaMin = Math.round(num(body.etaMin ?? 5, 1, 60, "tempo"));
    const req = await this.store.transaction(async (tx) => {
      const r = await this.mustGet(tx, "indrive", id, "Pedido");
      if (r.passengerId === auth.uid) fail(403, "own_request", "Voc\xEA n\xE3o pode responder ao pr\xF3prio pedido.");
      if (r.status !== "open") fail(409, "closed", "Este pedido n\xE3o est\xE1 mais aberto.");
      const others = (r.offers || []).filter((o) => o.driverId !== auth.uid);
      const offer = {
        id: randomUUID(),
        driverId: driver.uid,
        driverName: driver.name,
        driverRating: round2(driver.rating),
        tripsCount: driver.completedTrips,
        vehicleModel: driver.driverVehicle,
        vehiclePlate: driver.driverPlate,
        offeredPrice,
        etaMin,
        note: text(body.note, 200),
        createdAt: this.iso()
      };
      r.offers = [offer, ...others].slice(0, 30);
      tx.update("indrive", id, { offers: r.offers });
      return r;
    });
    return this.indriveView(req, auth.uid);
  }
  async acceptInDriveOffer(auth, id, offerId) {
    const req = await this.store.transaction(async (tx) => {
      const r = await this.mustGet(tx, "indrive", id, "Pedido");
      if (r.passengerId !== auth.uid) fail(403, "forbidden", "S\xF3 quem fez o pedido pode aceitar.");
      if (r.status !== "open") fail(409, "closed", "Este pedido n\xE3o est\xE1 mais aberto.");
      const offer = (r.offers || []).find((o) => o.id === offerId) ?? fail(400, "invalid_offer", "Proposta inv\xE1lida.");
      const passenger = await this.mustGet(tx, "users", auth.uid, "Passageiro");
      const cents = toCents(Number(offer.offeredPrice));
      const patch = {
        status: "matched",
        acceptedOfferId: offer.id,
        driverId: offer.driverId,
        agreedPriceCents: cents,
        matchedAt: this.iso()
      };
      if (r.paymentMethod === "froc_pay") {
        this.debit(tx, passenger, cents, `Negocia\xE7\xE3o \xB7 ${offer.driverName} \xB7 valor retido`, "indrive");
        patch.escrowCents = cents;
      }
      Object.assign(r, patch);
      tx.update("indrive", id, patch);
      return r;
    });
    return this.indriveView(req, auth.uid);
  }
  async completeInDrive(auth, id) {
    await this.settings();
    const req = await this.store.transaction(async (tx) => {
      const r = await this.mustGet(tx, "indrive", id, "Pedido");
      if (r.driverId !== auth.uid) fail(403, "forbidden", "S\xF3 o motorista escolhido pode finalizar.");
      if (r.status !== "matched") fail(409, "invalid_state", "Esta viagem n\xE3o est\xE1 em andamento.");
      const driver = await this.mustGet(tx, "users", auth.uid, "Motorista");
      const passenger = await tx.get("users", String(r.passengerId));
      const amount = r.paymentMethod === "froc_pay" ? Number(r.escrowCents) : Number(r.agreedPriceCents);
      const patch = { status: "completed", escrowCents: 0, completedAt: this.iso() };
      Object.assign(r, patch);
      tx.update("indrive", id, patch);
      this.payProvider(tx, driver, passenger, amount, r.paymentMethod, "Corrida negociada", "indrive");
      return r;
    });
    return this.indriveView(req, auth.uid);
  }
  async cancelInDrive(auth, id) {
    const req = await this.store.transaction(async (tx) => {
      const r = await this.mustGet(tx, "indrive", id, "Pedido");
      if (r.passengerId !== auth.uid) fail(403, "forbidden", "S\xF3 quem fez o pedido pode cancelar.");
      if (r.status !== "open" && r.status !== "matched") fail(409, "invalid_state", "N\xE3o \xE9 poss\xEDvel cancelar agora.");
      const passenger = await this.mustGet(tx, "users", auth.uid, "Passageiro");
      const escrow = Number(r.escrowCents || 0);
      const patch = { status: "cancelled", escrowCents: 0, cancelledAt: this.iso() };
      Object.assign(r, patch);
      tx.update("indrive", id, patch);
      if (escrow > 0) this.credit(tx, passenger, escrow, "Estorno \xB7 negocia\xE7\xE3o cancelada", "estorno");
      return r;
    });
    return this.indriveView(req, auth.uid);
  }
  // ------------------------------------------------- 3) caronas BlaBlaCar
  carpoolView(t, uid, myBookings, tripBookings) {
    const mine = t.driverId === uid ? "provider" : null;
    const booked = myBookings.filter((b) => b.tripId === t.id && b.status === "paid").reduce((acc, b) => acc + Number(b.seats), 0);
    const { driverPhone, ...rest } = t;
    return {
      ...rest,
      mine: mine ?? (booked > 0 ? "owner" : null),
      bookedByUserSeats: booked,
      driverPhone: booked > 0 ? String(driverPhone || "") : void 0,
      passengers: mine && tripBookings ? tripBookings.filter((b) => b.status === "paid").map((b) => ({ name: String(b.passengerName), seats: Number(b.seats), phone: String(b.passengerPhone || "") })) : void 0
    };
  }
  async publishCarpool(auth, body) {
    const driver = await this.approvedUser(auth, "driver");
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const departureTime = /^\d{2}:\d{2}$/.test(String(body.departureTime)) ? String(body.departureTime) : fail(400, "invalid_time", "Hor\xE1rio inv\xE1lido.");
    const [hh, mm] = departureTime.split(":").map(Number);
    const arr = (hh * 60 + mm + estimateDurationMin(distanceKm, "highway")) % 1440;
    const seats = Math.round(num(body.totalSeats, 1, 6, "vagas"));
    const id = randomUUID();
    const doc = {
      id,
      driverId: driver.uid,
      driverName: driver.name,
      driverRating: round2(driver.rating),
      driverPhone: driver.phone,
      verified: true,
      vehicleModel: driver.driverVehicle,
      origin,
      destination,
      pickupSpot: text(body.pickupSpot, 120) || `${origin.city} \xB7 ponto combinado`,
      dropoffSpot: text(body.dropoffSpot, 120) || `${destination.city} \xB7 ponto combinado`,
      date: text(body.date, 40) || fail(400, "invalid_date", "Informe a data da viagem."),
      departureTime,
      arrivalTime: `${String(Math.floor(arr / 60)).padStart(2, "0")}:${String(arr % 60).padStart(2, "0")}`,
      distanceKm,
      pricePerSeat: round2(num(body.pricePerSeat, 5, 2e3, "pre\xE7o por vaga")),
      totalSeats: seats,
      availableSeats: seats,
      instantBooking: true,
      preferences: { music: body.music !== false, pets: body.pets === true, luggage: "M\xE9dia", smoking: false, maxTwoBack: true },
      bookedByUserSeats: 0,
      status: "open",
      createdAt: this.iso()
    };
    await this.store.set("carpools", id, doc);
    return this.carpoolView(doc, auth.uid, [], []);
  }
  async bookCarpool(auth, tripId, seatsWanted) {
    const seats = Math.round(num(seatsWanted, 1, 6, "vagas"));
    const bookingId = randomUUID();
    const trip = await this.store.transaction(async (tx) => {
      const t = await this.mustGet(tx, "carpools", tripId, "Carona");
      if (t.driverId === auth.uid) fail(403, "own_trip", "Voc\xEA \xE9 o motorista desta carona.");
      if (t.status !== "open") fail(409, "closed", "Esta carona n\xE3o aceita mais reservas.");
      if (Number(t.availableSeats) < seats) fail(409, "no_seats", "N\xE3o h\xE1 vagas suficientes.");
      const passenger = await this.mustGet(tx, "users", auth.uid, "Passageiro");
      const cents = toCents(Number(t.pricePerSeat)) * seats;
      this.debit(tx, passenger, cents, `Carona ${t.origin.city} \u2192 ${t.destination.city} (${seats} vaga(s)) \xB7 retido`, "carona");
      t.availableSeats = Number(t.availableSeats) - seats;
      tx.update("carpools", tripId, { availableSeats: t.availableSeats });
      tx.set("carpoolBookings", bookingId, {
        id: bookingId,
        tripId,
        passengerId: passenger.uid,
        passengerName: passenger.name,
        passengerPhone: passenger.phone,
        seats,
        amountCents: cents,
        status: "paid",
        createdAt: this.iso()
      });
      return t;
    });
    const mine = await this.store.query("carpoolBookings", [["passengerId", "==", auth.uid]], 300);
    return this.carpoolView(trip, auth.uid, mine);
  }
  async cancelCarpoolBooking(auth, tripId) {
    const mine = (await this.store.query("carpoolBookings", [["passengerId", "==", auth.uid]], 300)).filter(
      (b) => b.tripId === tripId && b.status === "paid"
    );
    if (!mine.length) fail(404, "not_found", "Voc\xEA n\xE3o tem reserva nesta carona.");
    const trip = await this.store.transaction(async (tx) => {
      const t = await this.mustGet(tx, "carpools", tripId, "Carona");
      if (t.status !== "open") fail(409, "invalid_state", "Esta carona j\xE1 foi conclu\xEDda ou cancelada.");
      const passenger = await this.mustGet(tx, "users", auth.uid, "Passageiro");
      const bookings = [];
      for (const b of mine) bookings.push(await this.mustGet(tx, "carpoolBookings", String(b.id), "Reserva"));
      let seats = 0;
      for (const b of bookings) {
        if (b.status !== "paid") continue;
        seats += Number(b.seats);
        tx.update("carpoolBookings", String(b.id), { status: "refunded", cancelledAt: this.iso() });
        this.credit(tx, passenger, Number(b.amountCents), "Estorno \xB7 reserva de carona cancelada", "estorno");
      }
      t.availableSeats = Number(t.availableSeats) + seats;
      tx.update("carpools", tripId, { availableSeats: t.availableSeats });
      return t;
    });
    return this.carpoolView(trip, auth.uid, []);
  }
  async finishCarpool(auth, tripId, outcome) {
    await this.settings();
    const tripBookings = await this.store.query("carpoolBookings", [["tripId", "==", tripId]], 50);
    const trip = await this.store.transaction(async (tx) => {
      const t = await this.mustGet(tx, "carpools", tripId, "Carona");
      if (t.driverId !== auth.uid) fail(403, "forbidden", "S\xF3 o motorista da carona pode fazer isso.");
      if (t.status !== "open") fail(409, "invalid_state", "Esta carona j\xE1 foi encerrada.");
      const driver = await this.mustGet(tx, "users", auth.uid, "Motorista");
      const bookings = [];
      for (const b of tripBookings) bookings.push(await this.mustGet(tx, "carpoolBookings", String(b.id), "Reserva"));
      const paid = bookings.filter((b) => b.status === "paid");
      const passengers = /* @__PURE__ */ new Map();
      for (const b of paid) {
        const pid = String(b.passengerId);
        if (!passengers.has(pid)) {
          const p = await tx.get("users", pid);
          if (p) passengers.set(pid, p);
        }
      }
      tx.update("carpools", tripId, { status: outcome, finishedAt: this.iso() });
      t.status = outcome;
      const route = `${t.origin.city} \u2192 ${t.destination.city}`;
      if (outcome === "completed") {
        const total = paid.reduce((acc, b) => acc + Number(b.amountCents), 0);
        for (const b of paid) tx.update("carpoolBookings", String(b.id), { status: "released" });
        if (total > 0) {
          this.credit(tx, driver, this.providerCut(total), `Ganho \xB7 carona ${route} (${100 - this.cfg.commissionPercent}% l\xEDquido)`, "ganho_motorista");
          this.platformRevenue(tx, "carona", total, total - this.providerCut(total));
          for (const b of paid) this.awardPoints(tx, passengers.get(String(b.passengerId)) ?? null, Number(b.amountCents));
        }
        driver.completedTrips += 1;
        tx.update("users", driver.uid, { completedTrips: driver.completedTrips });
      } else {
        for (const b of paid) {
          tx.update("carpoolBookings", String(b.id), { status: "refunded" });
          const p = passengers.get(String(b.passengerId));
          if (p) this.credit(tx, p, Number(b.amountCents), `Estorno \xB7 carona ${route} cancelada pelo motorista`, "estorno");
        }
      }
      return t;
    });
    return this.carpoolView(trip, auth.uid, [], tripBookings);
  }
  // -------------------------------------- 4) caminhões vazios e fretes/mudanças
  truckView(t, uid) {
    const { escrowCents: _e, truckerPhone, reservedPhone, ...rest } = t;
    const mine = involvement(uid, t.reservedById, t.truckerId);
    return {
      ...rest,
      mine,
      truckerPhone: mine === "owner" ? String(truckerPhone || "") : void 0,
      reservedPhone: mine === "provider" ? String(reservedPhone || "") : void 0
    };
  }
  freightView(f, uid) {
    const { escrowCents: _e, clientPhone, truckerPhone, ...rest } = f;
    const mine = involvement(uid, f.clientId, f.acceptedTruckerId);
    const bids = Array.isArray(f.bids) ? f.bids : [];
    return {
      ...rest,
      mine,
      bids: mine === "owner" ? bids : bids.filter((b) => b.truckerId === uid),
      clientPhone: mine === "provider" ? String(clientPhone || "") : void 0,
      truckerPhone: mine === "owner" ? String(truckerPhone || "") : void 0
    };
  }
  async publishEmptyTruck(auth, body) {
    const trucker = await this.approvedUser(auth, "trucker");
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const price = round2(num(body.emptyReturnPrice, 50, 1e5, "pre\xE7o"));
    const standardPrice = Math.max(price, Math.round(distanceKm * 9.5));
    const id = randomUUID();
    const doc = {
      id,
      truckerId: trucker.uid,
      truckerName: trucker.name,
      truckerRating: round2(trucker.rating),
      verified: true,
      companyName: trucker.companyName || "Aut\xF4nomo",
      truckType: trucker.truckType,
      truckPlate: trucker.truckPlate,
      truckerPhone: trucker.phone,
      origin,
      destination,
      distanceKm,
      departureDate: text(body.departureDate, 60) || fail(400, "invalid_date", "Informe a data de sa\xEDda."),
      departureWindow: text(body.departureWindow, 120) || "Combinar hor\xE1rio pelo telefone ap\xF3s a reserva",
      direction: ["indo_vazio", "voltando_vazio", "espaco_parcial"].includes(String(body.direction)) ? body.direction : "voltando_vazio",
      availableTons: round2(num(body.availableTons, 0.1, 60, "toneladas")),
      availableCubicM: round2(num(body.availableCubicM, 1, 150, "metros c\xFAbicos")),
      standardPrice,
      emptyReturnPrice: price,
      discountPercent: Math.max(0, Math.round((standardPrice - price) / standardPrice * 100)),
      acceptsMoving: body.acceptsMoving !== false,
      hasLiftgate: body.hasLiftgate === true,
      status: "available",
      createdAt: this.iso()
    };
    await this.store.set("emptyTrucks", id, doc);
    return this.truckView(doc, auth.uid);
  }
  async reserveEmptyTruck(auth, id) {
    const route = await this.store.transaction(async (tx) => {
      const t = await this.mustGet(tx, "emptyTrucks", id, "Caminh\xE3o");
      if (t.truckerId === auth.uid) fail(403, "own_route", "Esta rota \xE9 sua.");
      if (t.status !== "available") fail(409, "taken", "Esta rota j\xE1 foi reservada.");
      const client = await this.mustGet(tx, "users", auth.uid, "Cliente");
      const cents = toCents(Number(t.emptyReturnPrice));
      this.debit(tx, client, cents, `Frete retorno vazio ${t.origin.city} \u2192 ${t.destination.city} \xB7 retido`, "frete");
      const patch = { status: "reserved", reservedById: client.uid, reservedBy: client.name, reservedPhone: client.phone, escrowCents: cents, reservedAt: this.iso() };
      Object.assign(t, patch);
      tx.update("emptyTrucks", id, patch);
      return t;
    });
    return this.truckView(route, auth.uid);
  }
  async finishEmptyTruck(auth, id, action) {
    await this.settings();
    const route = await this.store.transaction(async (tx) => {
      const t = await this.mustGet(tx, "emptyTrucks", id, "Caminh\xE3o");
      const isTrucker = t.truckerId === auth.uid;
      const isClient = t.reservedById === auth.uid;
      if (!isTrucker && !isClient) fail(403, "forbidden", "Voc\xEA n\xE3o participa deste frete.");
      const escrow = Number(t.escrowCents || 0);
      const label = `${t.origin.city} \u2192 ${t.destination.city}`;
      if (action === "complete") {
        if (!isTrucker) fail(403, "forbidden", "S\xF3 o caminhoneiro confirma a entrega.");
        if (t.status !== "reserved") fail(409, "invalid_state", "Este frete n\xE3o est\xE1 reservado.");
        const trucker = await this.mustGet(tx, "users", auth.uid, "Caminhoneiro");
        const client = await tx.get("users", String(t.reservedById));
        tx.update("emptyTrucks", id, { status: "completed", escrowCents: 0, completedAt: this.iso() });
        t.status = "completed";
        this.payProvider(tx, trucker, client, escrow, "froc_pay", `frete ${label}`, "retorno_vazio");
        return t;
      }
      if (t.status === "reserved") {
        const client = await this.mustGet(tx, "users", String(t.reservedById), "Cliente");
        const patch = isClient ? { status: "available", reservedById: null, reservedBy: null, reservedPhone: null, escrowCents: 0 } : { status: "cancelled", escrowCents: 0 };
        tx.update("emptyTrucks", id, patch);
        Object.assign(t, patch);
        if (escrow > 0) this.credit(tx, client, escrow, `Estorno \xB7 frete ${label} cancelado`, "estorno");
        return t;
      }
      if (t.status === "available" && isTrucker) {
        tx.update("emptyTrucks", id, { status: "cancelled" });
        t.status = "cancelled";
        return t;
      }
      return fail(409, "invalid_state", "N\xE3o \xE9 poss\xEDvel cancelar agora.");
    });
    return this.truckView(route, auth.uid);
  }
  async createFreight(auth, body) {
    const client = await this.ensureUser(auth);
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const kinds = ["mudanca_residencial", "carreto_rapido", "carga_paletizada", "veiculo_moto"];
    if (Number(body.proposedBudget) < freightFloor(distanceKm))
      fail(400, "below_floor", `O or\xE7amento m\xEDnimo para ${distanceKm} km \xE9 ${brl(freightFloor(distanceKm))}.`);
    const id = randomUUID();
    const doc = {
      id,
      clientId: client.uid,
      clientName: client.name,
      kind: kinds.includes(String(body.kind)) ? body.kind : "mudanca_residencial",
      title: text(body.title, 120) || `Frete ${origin.city} \u2192 ${destination.city}`,
      origin,
      destination,
      distanceKm,
      truckTypeNeeded: TRUCK_TYPES.includes(body.truckTypeNeeded) ? body.truckTypeNeeded : "3/4 Ba\xFA",
      estimatedWeightKg: Math.round(num(body.estimatedWeightKg, 1, 6e4, "peso")),
      helpersNeeded: Math.round(num(body.helpersNeeded ?? 0, 0, 10, "ajudantes")),
      hasElevator: body.hasElevator === true,
      needsPacking: body.needsPacking === true,
      estimatedVolumeM3: round2(num(body.estimatedVolumeM3 ?? 1, 0.1, 150, "volume")),
      minimumPrice: freightFloor(distanceKm),
      proposedBudget: round2(num(body.proposedBudget, 50, 2e5, "or\xE7amento")),
      scheduledDate: text(body.scheduledDate, 60) || fail(400, "invalid_date", "Informe a data da coleta."),
      status: "open_bids",
      bids: [],
      escrowCents: 0,
      createdAt: this.iso()
    };
    await this.store.set("freights", id, doc);
    return this.freightView(doc, auth.uid);
  }
  async bidFreight(auth, id, body) {
    const trucker = await this.approvedUser(auth, "trucker");
    const price = round2(num(body.price, 50, 2e5, "lance"));
    const item = await this.store.transaction(async (tx) => {
      const f = await this.mustGet(tx, "freights", id, "Frete");
      if (f.clientId === auth.uid) fail(403, "own_freight", "Este pedido \xE9 seu.");
      if (f.status !== "open_bids") fail(409, "closed", "Este frete n\xE3o recebe mais lances.");
      if (price < freightFloor(Number(f.distanceKm))) fail(400, "below_floor", `O lance m\xEDnimo \xE9 ${brl(freightFloor(Number(f.distanceKm)))}.`);
      const others = (f.bids || []).filter((b) => b.truckerId !== auth.uid);
      const bid = {
        id: randomUUID(),
        truckerId: trucker.uid,
        truckerName: trucker.companyName ? `${trucker.name} \xB7 ${trucker.companyName}` : trucker.name,
        truckerRating: round2(trucker.rating),
        truckType: trucker.truckType,
        price,
        helpersIncluded: Math.round(num(body.helpersIncluded ?? 0, 0, 10, "ajudantes")),
        etaText: text(body.etaText, 120) || "Dispon\xEDvel na data combinada",
        note: text(body.note, 200)
      };
      f.bids = [bid, ...others].slice(0, 30);
      tx.update("freights", id, { bids: f.bids });
      return f;
    });
    return this.freightView(item, auth.uid);
  }
  async acceptFreightBid(auth, id, bidId) {
    const item = await this.store.transaction(async (tx) => {
      const f = await this.mustGet(tx, "freights", id, "Frete");
      if (f.clientId !== auth.uid) fail(403, "forbidden", "S\xF3 quem pediu o frete pode contratar.");
      if (f.status !== "open_bids") fail(409, "closed", "Este frete j\xE1 foi contratado.");
      const bid = (f.bids || []).find((b) => b.id === bidId) ?? fail(400, "invalid_bid", "Lance inv\xE1lido.");
      const client = await this.mustGet(tx, "users", auth.uid, "Cliente");
      const truckerUser = await tx.get("users", String(bid.truckerId));
      const cents = toCents(Number(bid.price));
      this.debit(tx, client, cents, `Frete \xB7 ${bid.truckerName} \xB7 valor retido at\xE9 a entrega`, "frete");
      const patch = {
        status: "booked",
        acceptedBidId: bid.id,
        acceptedTruckerId: bid.truckerId,
        escrowCents: cents,
        clientPhone: client.phone,
        truckerPhone: truckerUser?.phone || "",
        bookedAt: this.iso()
      };
      Object.assign(f, patch);
      tx.update("freights", id, patch);
      return f;
    });
    return this.freightView(item, auth.uid);
  }
  async finishFreight(auth, id, action) {
    await this.settings();
    const item = await this.store.transaction(async (tx) => {
      const f = await this.mustGet(tx, "freights", id, "Frete");
      const escrow = Number(f.escrowCents || 0);
      if (action === "deliver") {
        if (f.acceptedTruckerId !== auth.uid) fail(403, "forbidden", "S\xF3 o caminhoneiro contratado confirma a entrega.");
        if (f.status !== "booked" && f.status !== "in_transit") fail(409, "invalid_state", "Este frete n\xE3o est\xE1 em andamento.");
        const trucker = await this.mustGet(tx, "users", auth.uid, "Caminhoneiro");
        const client2 = await tx.get("users", String(f.clientId));
        tx.update("freights", id, { status: "delivered", escrowCents: 0, deliveredAt: this.iso() });
        f.status = "delivered";
        this.payProvider(tx, trucker, client2, escrow, "froc_pay", String(f.title), "frete");
        return f;
      }
      if (f.clientId !== auth.uid) fail(403, "forbidden", "S\xF3 quem pediu o frete pode cancelar.");
      if (f.status !== "open_bids" && f.status !== "booked") fail(409, "invalid_state", "N\xE3o \xE9 poss\xEDvel cancelar agora.");
      const client = await this.mustGet(tx, "users", auth.uid, "Cliente");
      tx.update("freights", id, { status: "cancelled", escrowCents: 0, cancelledAt: this.iso() });
      f.status = "cancelled";
      if (escrow > 0) this.credit(tx, client, escrow, `Estorno \xB7 ${f.title}`, "estorno");
      return f;
    });
    return this.freightView(item, auth.uid);
  }
  // ------------------------------------------- H3: preço dinâmico e localização
  /** Multiplicador do preço na região: mais pedidos que motoristas por perto = preço sobe. */
  async surgeAt(lat, lng) {
    const cfg = await this.settings();
    if (!cfg.surgeEnabled) return 1;
    const area = new Set(this.geo.ring(this.geo.cellOf(lat, lng), SURGE_RING));
    const [searching, online] = await Promise.all([
      this.store.query("rides", [["status", "==", "searching"]], 300),
      this.store.query("users", [["driverOnline", "==", true]], 500)
    ]);
    const now = this.now().getTime();
    const demand = searching.filter((r) => area.has(String(r.originCell))).length;
    const supply = online.filter(
      (u) => u.driverCell && area.has(u.driverCell) && now - Date.parse(String(u.locationAt || 0)) < LOCATION_FRESH_MS
    ).length;
    const ratio = (demand + 1) / (supply + 1);
    const mult = 1 + Math.max(0, ratio - 1) * 0.5;
    return Math.min(cfg.maxSurge, Math.round(mult * 10) / 10);
  }
  async quoteRide(auth, body) {
    await this.ensureUser(auth);
    const origin = resolvePoint(body.originPoint, body.originId);
    const destination = resolvePoint(body.destinationPoint, body.destinationId);
    const distanceKm = calculateDistanceKm(origin, destination);
    const surge = await this.surgeAt(origin.lat, origin.lng);
    return {
      surge,
      distanceKm,
      prices: RIDE_CATEGORIES.map((c) => {
        const durationMin = estimateDurationMin(distanceKm, c.id === "froc_moto" ? "moto" : "urban");
        return { categoryId: c.id, price: round2(Math.max(7.5, round2(c.baseFare + distanceKm * c.perKm + durationMin * c.perMin)) * surge) };
      })
    };
  }
  /** Motorista online envia a posição do celular; o passageiro vê o carro andando no mapa. */
  async updateLocation(auth, latValue, lngValue) {
    const user = await this.anyProvider(auth);
    const lat = num(latValue, -90, 90, "latitude");
    const lng = num(lngValue, -180, 180, "longitude");
    const at = this.iso();
    const cell = this.geo.cellOf(lat, lng);
    await this.store.update("users", user.uid, { driverLat: lat, driverLng: lng, driverCell: cell, locationAt: at });
    const location = { lat: round6(lat), lng: round6(lng), at };
    const [rides, deals] = await Promise.all([
      this.store.query("rides", [["driverId", "==", user.uid]], 100),
      this.store.query("indrive", [["driverId", "==", user.uid]], 100)
    ]);
    await Promise.all([
      ...rides.filter((r) => ["accepted", "arriving", "in_progress"].includes(String(r.status))).map((r) => this.store.update("rides", String(r.id), { driverLocation: location })),
      ...deals.filter((r) => r.status === "matched").map((r) => this.store.update("indrive", String(r.id), { driverLocation: location }))
    ]);
    return { ok: true, cell };
  }
  // ------------------------------------- tarefas com prazo (o que o Cadence faz)
  /**
   * Varredura de prazos: corrida sem motorista e negociação sem resposta não ficam
   * paradas para sempre. Roda sozinha (no máximo 1x por minuto) e também pode ser
   * chamada por um agendador externo em /api/cron/sweep.
   */
  async sweep(force = false) {
    if (!force && Date.now() - this.lastSweep < 6e4) return { skipped: true };
    this.lastSweep = Date.now();
    const cfg = await this.settings();
    const now = this.now().getTime();
    let rides = 0;
    let deals = 0;
    for (const r of await this.store.query("rides", [["status", "==", "searching"]], 300)) {
      if (now - Date.parse(String(r.createdAt)) < cfg.rideSearchTimeoutMin * 6e4) continue;
      const done = await this.store.transaction(async (tx) => {
        const ride = await tx.get("rides", String(r.id));
        if (!ride || ride.status !== "searching") return false;
        const passenger = await tx.get("users", String(ride.passengerId));
        const escrow = Number(ride.escrowCents || 0);
        tx.update("rides", String(r.id), { status: "cancelled", escrowCents: 0, cancelledAt: this.iso(), cancelledBy: "timeout" });
        if (passenger && escrow > 0) this.credit(tx, passenger, escrow, "Estorno \xB7 nenhum motorista dispon\xEDvel a tempo", "estorno");
        return true;
      });
      if (done) rides++;
    }
    for (const r of await this.store.query("indrive", [["status", "==", "open"]], 300)) {
      if (now - Date.parse(String(r.createdAt)) < cfg.indriveOpenTimeoutMin * 6e4) continue;
      await this.store.update("indrive", String(r.id), { status: "cancelled", cancelledAt: this.iso(), cancelledBy: "timeout" });
      deals++;
    }
    return { ridesCancelled: rides, requestsExpired: deals };
  }
  // ------------------------------------------------------------- SOS e pontos
  async createSos(auth, body) {
    const user = await this.ensureUser(auth);
    const kind = ["ride", "indrive", "carpool", "truck", "freight", "general"].includes(String(body.kind)) ? String(body.kind) : "general";
    const refId = text(body.refId, 80);
    let trip = null;
    if (refId && (kind === "ride" || kind === "indrive")) {
      trip = await this.store.get(kind === "ride" ? "rides" : "indrive", refId);
      if (!trip || trip.passengerId !== user.uid && trip.driverId !== user.uid) fail(403, "forbidden", "Voc\xEA n\xE3o participa desta viagem.");
    }
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const id = randomUUID();
    const doc = {
      id,
      uid: user.uid,
      name: user.name,
      phone: user.phone,
      email: user.email,
      kind,
      refId,
      lat: Number.isFinite(lat) ? round6(lat) : null,
      lng: Number.isFinite(lng) ? round6(lng) : null,
      message: text(body.message, 500),
      status: "open",
      trip: trip ? {
        origin: trip.origin?.name,
        destination: trip.destination?.name,
        passengerName: trip.passengerName,
        driverName: trip.driverName ?? null,
        vehiclePlate: trip.vehiclePlate ?? null,
        vehicleModel: trip.vehicleModel ?? null
      } : null,
      createdAt: this.iso()
    };
    await this.store.set("sos", id, doc);
    return { id };
  }
  async resolveSos(auth, id, note) {
    this.requireAdmin(auth);
    const sos = await this.store.get("sos", String(id)) ?? fail(404, "not_found", "Alerta n\xE3o encontrado.");
    if (sos.status !== "open") fail(409, "not_open", "Este alerta j\xE1 foi resolvido.");
    await this.store.update("sos", String(id), { status: "resolved", resolvedBy: auth.email, note: text(note, 300), resolvedAt: this.iso() });
    return { ok: true };
  }
  async redeemPoints(auth) {
    const cfg = await this.settings();
    await this.ensureUser(auth);
    await this.store.transaction(async (tx) => {
      const user = await this.mustGet(tx, "users", auth.uid, "Usu\xE1rio");
      if ((user.points || 0) < cfg.pointsPerRedeem)
        fail(409, "not_enough_points", `Voc\xEA precisa de ${cfg.pointsPerRedeem} pontos para trocar por ${brl(REDEEM_VALUE_CENTS / 100)}.`);
      user.points = (user.points || 0) - cfg.pointsPerRedeem;
      tx.update("users", user.uid, { points: user.points });
      this.credit(tx, user, REDEEM_VALUE_CENTS, `B\xF4nus fidelidade (${cfg.pointsPerRedeem} pontos)`, "bonus");
      this.platformRevenue(tx, "fidelidade", 0, -REDEEM_VALUE_CENTS);
    });
    return { ok: true };
  }
  // ------------------------------------------------------- admin: usuários e relatórios
  async adminUsers(auth, search) {
    this.requireAdmin(auth);
    const q = text(search, 120).toLowerCase();
    const users = q.includes("@") ? await this.store.query("users", [["email", "==", q]], 5) : byNewest(await this.store.query("users", [], 300)).slice(0, 100);
    return users.filter((u) => !q || q.includes("@") || u.name.toLowerCase().includes(q) || String(u.phone).includes(q)).map((u) => ({
      uid: u.uid,
      name: u.name,
      email: u.email,
      phone: u.phone,
      createdAt: u.createdAt,
      balance: toReais(u.balanceCents),
      completedTrips: u.completedTrips,
      rating: round2(u.rating),
      passengerRating: round2(u.passengerRating ?? 5),
      driverStatus: u.driverStatus,
      truckerStatus: u.truckerStatus,
      blocked: Boolean(u.blocked),
      blockedReason: u.blockedReason || ""
    }));
  }
  async setBlocked(auth, uid, blocked, reason) {
    this.requireAdmin(auth);
    if (uid === auth.uid) fail(400, "self", "Voc\xEA n\xE3o pode bloquear a pr\xF3pria conta.");
    const user = await this.store.get("users", String(uid)) ?? fail(404, "not_found", "Usu\xE1rio n\xE3o encontrado.");
    const why = text(reason, 200);
    if (blocked === true && why.length < 5) fail(400, "reason_required", "Explique o motivo do bloqueio.");
    await this.store.update("users", user.uid, {
      blocked: blocked === true,
      blockedReason: blocked === true ? why : "",
      driverOnline: blocked === true ? false : user.driverOnline
    });
    return { ok: true };
  }
  async adminReports(auth, days = 30) {
    this.requireAdmin(auth);
    const period = Math.round(num(days ?? 30, 1, 365, "dias"));
    const since = new Date(this.now().getTime() - period * 864e5).toISOString();
    const entries = (await this.store.query("platformLedger", [], 2e4)).filter((e) => String(e.createdAt) >= since);
    const byKind = {};
    for (const e of entries) {
      const k = String(e.kind);
      byKind[k] ??= { count: 0, gross: 0, fee: 0 };
      if (Number(e.grossCents) > 0) byKind[k].count += 1;
      byKind[k].gross += Number(e.grossCents);
      byKind[k].fee += Number(e.feeCents);
    }
    const online = await this.store.query("users", [["driverOnline", "==", true]], 1e3);
    const total = Object.values(byKind).reduce((a, k) => ({ gross: a.gross + k.gross, fee: a.fee + k.fee, count: a.count + k.count }), { gross: 0, fee: 0, count: 0 });
    return {
      days: period,
      completedServices: total.count,
      grossVolume: toReais(total.gross),
      platformRevenue: toReais(total.fee),
      driversOnline: online.length,
      byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { count: v.count, gross: toReais(v.gross), fee: toReais(v.fee) }]))
    };
  }
  // ------------------------------------------------------------ visão geral
  /**
   * Despacho por região (H3): com a localização do motorista em dia, ele vê só os pedidos
   * da região dele (~3,5 km). Sem localização, vê todos (para não ficar sem corridas).
   */
  nearby(user, rides) {
    const fresh = user.driverCell && this.now().getTime() - Date.parse(String(user.locationAt || 0)) < LOCATION_FRESH_MS;
    if (!fresh) return rides;
    const area = new Set(this.geo.ring(user.driverCell, DISPATCH_RING));
    return rides.filter((r) => !r.originCell || area.has(String(r.originCell)));
  }
  async bootstrap(auth) {
    await this.settings();
    await this.sweep().catch((e) => console.warn("Varredura de prazos falhou:", e));
    const user = await this.ensureUser(auth);
    const uid = auth.uid;
    const isDriver = user.driverStatus === "approved";
    const isTrucker = user.truckerStatus === "approved";
    const q = (col, field, value, limit = 100) => this.store.query(col, [[field, "==", value]], limit);
    const [
      myRides,
      drivingRides,
      queueRides,
      myInDrive,
      drivingInDrive,
      openInDrive,
      openCarpools,
      myCarpools,
      myBookings,
      availableTrucks,
      myTrucks,
      reservedTrucks,
      myFreights,
      wonFreights,
      openFreights,
      transactions
    ] = await Promise.all([
      q("rides", "passengerId", uid),
      isDriver ? q("rides", "driverId", uid) : [],
      isDriver && user.driverOnline ? q("rides", "status", "searching", 30) : [],
      q("indrive", "passengerId", uid),
      isDriver ? q("indrive", "driverId", uid) : [],
      isDriver ? q("indrive", "status", "open", 30) : [],
      q("carpools", "status", "open", 60),
      isDriver ? q("carpools", "driverId", uid) : [],
      q("carpoolBookings", "passengerId", uid, 300),
      q("emptyTrucks", "status", "available", 60),
      isTrucker ? q("emptyTrucks", "truckerId", uid) : [],
      q("emptyTrucks", "reservedById", uid),
      q("freights", "clientId", uid),
      isTrucker ? q("freights", "acceptedTruckerId", uid) : [],
      isTrucker ? q("freights", "status", "open_bids", 40) : [],
      this.transactions(uid)
    ]);
    const bookedTripIds = new Set(myBookings.filter((b) => b.status === "paid").map((b) => String(b.tripId)));
    const bookedTrips = (await Promise.all([...bookedTripIds].filter((id) => !openCarpools.some((c) => c.id === id)).map((id) => this.store.get("carpools", id)))).filter(Boolean);
    const driverTripBookings = /* @__PURE__ */ new Map();
    await Promise.all(
      myCarpools.filter((c) => c.status === "open").map(
        async (c) => driverTripBookings.set(String(c.id), await q("carpoolBookings", "tripId", c.id, 50))
      )
    );
    const recent = (items, keep) => byNewest(uniqueById(items)).filter(keep).slice(0, 40);
    const notOld = (i) => !["completed", "cancelled", "delivered"].includes(String(i.status)) || String(i.createdAt) > new Date(this.now().getTime() - 30 * 864e5).toISOString();
    return {
      profile: this.profileView(user, auth),
      rides: recent([...myRides, ...drivingRides, ...this.nearby(user, queueRides).filter((r) => r.passengerId !== uid)], notOld).map((r) => this.rideView(r, uid)),
      indriveRequests: recent([...myInDrive, ...drivingInDrive, ...openInDrive.filter((r) => r.passengerId !== uid)], notOld).map((r) => this.indriveView(r, uid)),
      carpools: recent([...openCarpools, ...myCarpools, ...bookedTrips], notOld).map(
        (c) => this.carpoolView(c, uid, myBookings, driverTripBookings.get(String(c.id)))
      ),
      emptyTrucks: recent([...availableTrucks, ...myTrucks, ...reservedTrucks], notOld).map((t) => this.truckView(t, uid)),
      freights: recent([...myFreights, ...wonFreights, ...openFreights.filter((f) => f.clientId !== uid)], notOld).map((f) => this.freightView(f, uid)),
      transactions
    };
  }
};

// server/mercadoPago.ts
import { createHmac, timingSafeEqual } from "node:crypto";
function createMercadoPago(options) {
  const token = options.accessToken?.trim();
  const http = options.fetchImpl ?? fetch;
  const base = (options.publicUrl || "").replace(/\/+$/, "");
  const call = async (path, init = {}) => {
    const res = await http("https://api.mercadopago.com" + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers || {} },
      signal: AbortSignal.timeout(15e3)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`mercadopago_${res.status}: ${String(body.message || "").slice(0, 160)}`);
    return body;
  };
  return {
    configured: Boolean(token && base),
    // O e-mail do pagador não é preenchido: se for o mesmo da conta vendedora (ex.: o dono
    // testando), o Mercado Pago recusa o pagamento. A pessoa informa os dados no checkout.
    async createCheckout({ reference, amountCents, title }) {
      const pref = await call("/checkout/preferences", {
        method: "POST",
        headers: { "X-Idempotency-Key": reference },
        body: JSON.stringify({
          items: [{ id: reference, title, quantity: 1, currency_id: "BRL", unit_price: amountCents / 100 }],
          external_reference: reference,
          back_urls: {
            success: `${base}/?recarga=${reference}`,
            pending: `${base}/?recarga=${reference}`,
            failure: `${base}/?recarga=${reference}`
          },
          auto_return: "approved",
          notification_url: `${base}/api/webhooks/mercadopago`,
          statement_descriptor: "FROC X UBER"
        })
      });
      const url = String(pref.init_point || "");
      if (!url.startsWith("https://")) throw new Error("mercadopago_checkout_url");
      return { checkoutUrl: url, preferenceId: String(pref.id) };
    },
    async findApproved(reference) {
      const found = await call(`/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc`);
      const paid = (found.results || []).find((p) => p.status === "approved" && p.currency_id === "BRL");
      return paid ? { paymentId: String(paid.id), amountCents: Math.round(Number(paid.transaction_amount) * 100) } : null;
    },
    async getPayment(paymentId) {
      if (!/^\d+$/.test(paymentId)) return null;
      const p = await call(`/v1/payments/${paymentId}`);
      return { reference: String(p.external_reference || ""), status: String(p.status), amountCents: Math.round(Number(p.transaction_amount) * 100) };
    }
  };
}
function verifyMercadoPagoSignature(input) {
  const secret = input.secret?.trim();
  if (!secret || !input.signatureHeader || !input.dataId) return false;
  const parts = Object.fromEntries(
    input.signatureHeader.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    })
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !/^[a-f0-9]{64}$/i.test(v1)) return false;
  const tsMs = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1e3;
  if (!Number.isFinite(tsMs) || Math.abs((input.nowMs ?? Date.now()) - tsMs) > 10 * 60 * 1e3) return false;
  const manifest = `id:${String(input.dataId).toLowerCase()};${input.requestId ? `request-id:${input.requestId};` : ""}ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1.toLowerCase(), "hex"));
}

// server/app.ts
function rateLimit(max, windowMs) {
  const hits = /* @__PURE__ */ new Map();
  return (req, res, next) => {
    const key = (req.ip || "ip") + req.path;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 5e3) {
        for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      }
      return next();
    }
    if (++entry.count > max) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
    return next();
  };
}
function createApp(options) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });
  app.use("/api/driver/documents", express.json({ limit: "5mb" }));
  app.use(express.json({ limit: "200kb" }));
  const service = async () => typeof options.service === "function" ? options.service() : options.service;
  const wrap = (fn) => async (req, res) => {
    try {
      const result = await fn(req, res);
      if (!res.headersSent) res.json(result);
    } catch (error) {
      if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
      console.error("Erro no servidor:", error);
      return res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  };
  const requireAuth = async (req, res, next) => {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Fa\xE7a login para continuar.", code: "unauthenticated" });
    try {
      req.auth = await options.verifyToken(token);
      if (!req.auth.email) return res.status(401).json({ error: "Conta sem e-mail.", code: "unauthenticated" });
    } catch (error) {
      const why = options.explainTokenError?.(error) ?? { status: 401, message: "Sess\xE3o expirada. Entre novamente.", reason: "unknown" };
      console.error("Login recusado pelo servidor:", why.reason, String(error?.message || error).slice(0, 300));
      return res.status(why.status).json({ error: why.message, code: why.status === 401 ? "unauthenticated" : "server_config", reason: why.reason });
    }
    try {
      await (await service()).checkAccess(req.auth);
      return next();
    } catch (error) {
      if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
      console.error("Falha ao conferir acesso:", error);
      return res.status(503).json({ error: "Servi\xE7o indispon\xEDvel. Tente em instantes." });
    }
  };
  const a = (req) => req.auth;
  const id = (req) => String(req.params.id || "").slice(0, 80);
  app.get("/api/health", async (_req, res) => {
    const firebase = options.diagnostics ? await options.diagnostics().catch((e) => ({ error: String(e?.message || e) })) : void 0;
    res.json({ ok: true, service: "froc-x-uber", config: options.configStatus?.(), firebase });
  });
  app.get("/api/public-config", (_req, res) => res.json(options.publicConfig()));
  app.get("/api/maps-config", (_req, res) => res.json({ apiKey: options.publicConfig().mapsApiKey || "" }));
  app.post(
    "/api/webhooks/mercadopago",
    wrap(async (req) => {
      const dataId = String(req.query["data.id"] || req.body?.data?.id || "");
      const ok = verifyMercadoPagoSignature({
        secret: options.webhookSecret,
        signatureHeader: String(req.headers["x-signature"] || ""),
        requestId: String(req.headers["x-request-id"] || ""),
        dataId
      });
      if (!ok) throw new AppError(401, "invalid_signature", "Assinatura inv\xE1lida.");
      const type = String(req.query.type || req.body?.type || "");
      if (type && type !== "payment") return { ignored: true };
      return (await service()).handlePaymentNotification(dataId);
    })
  );
  app.post(
    "/api/cron/sweep",
    wrap(async (req) => {
      const key = String(req.headers["x-cron-key"] || "");
      if (!options.cronSecret || key !== options.cronSecret) throw new AppError(401, "unauthorized", "Chave inv\xE1lida.");
      return (await service()).sweep(true);
    })
  );
  const api = express.Router();
  api.use(requireAuth);
  const limited = rateLimit(20, 6e4);
  api.get("/bootstrap", wrap(async (req) => (await service()).bootstrap(a(req))));
  api.patch("/profile", wrap(async (req) => (await service()).updateProfile(a(req), req.body || {})));
  api.post("/rides/quote", wrap(async (req) => (await service()).quoteRide(a(req), req.body || {})));
  api.post("/driver/location", rateLimit(30, 6e4), wrap(async (req) => (await service()).updateLocation(a(req), req.body?.lat, req.body?.lng)));
  api.post("/sos", rateLimit(5, 6e4), wrap(async (req) => (await service()).createSos(a(req), req.body || {})));
  api.post("/wallet/redeem", limited, wrap(async (req) => (await service()).redeemPoints(a(req))));
  api.post("/rides", limited, wrap(async (req) => (await service()).createRide(a(req), req.body || {})));
  api.patch("/rides/:id", wrap(async (req) => ({ ride: await (await service()).rideAction(a(req), id(req), req.body || {}) })));
  api.post("/indrive", limited, wrap(async (req) => (await service()).createInDrive(a(req), req.body || {})));
  api.post("/indrive/:id/offers", wrap(async (req) => (await service()).sendInDriveOffer(a(req), id(req), req.body || {})));
  api.post("/indrive/:id/accept", wrap(async (req) => ({ request: await (await service()).acceptInDriveOffer(a(req), id(req), req.body?.offerId) })));
  api.post("/indrive/:id/complete", wrap(async (req) => ({ request: await (await service()).completeInDrive(a(req), id(req)) })));
  api.post("/indrive/:id/cancel", wrap(async (req) => ({ request: await (await service()).cancelInDrive(a(req), id(req)) })));
  api.post("/carpools", limited, wrap(async (req) => (await service()).publishCarpool(a(req), req.body || {})));
  api.post("/carpools/:id/book", wrap(async (req) => ({ trip: await (await service()).bookCarpool(a(req), id(req), req.body?.seats) })));
  api.post("/carpools/:id/cancel-booking", wrap(async (req) => ({ trip: await (await service()).cancelCarpoolBooking(a(req), id(req)) })));
  api.post("/carpools/:id/complete", wrap(async (req) => ({ trip: await (await service()).finishCarpool(a(req), id(req), "completed") })));
  api.post("/carpools/:id/cancel", wrap(async (req) => ({ trip: await (await service()).finishCarpool(a(req), id(req), "cancelled") })));
  api.post("/empty-trucks", limited, wrap(async (req) => (await service()).publishEmptyTruck(a(req), req.body || {})));
  api.post("/empty-trucks/:id/reserve", wrap(async (req) => ({ route: await (await service()).reserveEmptyTruck(a(req), id(req)) })));
  api.post("/empty-trucks/:id/complete", wrap(async (req) => ({ route: await (await service()).finishEmptyTruck(a(req), id(req), "complete") })));
  api.post("/empty-trucks/:id/cancel", wrap(async (req) => ({ route: await (await service()).finishEmptyTruck(a(req), id(req), "cancel") })));
  api.post("/freights", limited, wrap(async (req) => (await service()).createFreight(a(req), req.body || {})));
  api.post("/freights/:id/bids", wrap(async (req) => (await service()).bidFreight(a(req), id(req), req.body || {})));
  api.post("/freights/:id/accept", wrap(async (req) => ({ freight: await (await service()).acceptFreightBid(a(req), id(req), req.body?.bidId) })));
  api.post("/freights/:id/deliver", wrap(async (req) => ({ freight: await (await service()).finishFreight(a(req), id(req), "deliver") })));
  api.post("/freights/:id/cancel", wrap(async (req) => ({ freight: await (await service()).finishFreight(a(req), id(req), "cancel") })));
  api.post("/wallet/topup", limited, wrap(async (req) => (await service()).createTopup(a(req), req.body?.amount)));
  api.post("/wallet/topups/:id/confirm", wrap(async (req) => (await service()).confirmTopup(id(req), a(req).uid)));
  api.post("/wallet/withdraw", limited, wrap(async (req) => (await service()).requestWithdrawal(a(req), req.body?.amount, req.body?.pixKey)));
  api.post(
    "/driver/documents",
    rateLimit(15, 6e4),
    wrap(async (req) => (await service()).uploadDocument(a(req), req.body?.kind, req.body?.docType, req.body?.contentType, req.body?.dataBase64))
  );
  api.post("/driver/apply", limited, wrap(async (req) => (await service()).applyAsProvider(a(req), req.body?.kind, req.body || {})));
  api.get("/admin/overview", wrap(async (req) => (await service()).adminOverview(a(req))));
  api.post(
    "/admin/applications/:id",
    wrap(async (req) => (await service()).reviewApplication(a(req), id(req), req.body?.kind, req.body?.decision, req.body?.reason))
  );
  api.get("/admin/users", wrap(async (req) => (await service()).adminUsers(a(req), req.query.q)));
  api.post("/admin/users/:id/block", wrap(async (req) => (await service()).setBlocked(a(req), id(req), req.body?.blocked, req.body?.reason)));
  api.get("/admin/reports", wrap(async (req) => (await service()).adminReports(a(req), req.query.days)));
  api.patch("/admin/settings", wrap(async (req) => (await service()).updateSettings(a(req), req.body || {})));
  api.post("/admin/sos/:id/resolve", wrap(async (req) => (await service()).resolveSos(a(req), id(req), req.body?.note)));
  api.post("/admin/withdrawals/:id", wrap(async (req) => (await service()).resolveWithdrawal(a(req), id(req), req.body?.decision)));
  app.use("/api", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Rota n\xE3o encontrada." }));
  return app;
}

// server/firebase.ts
function readWebConfig() {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.apiKey === "string" && typeof parsed.projectId === "string" ? parsed : null;
  } catch {
    return null;
  }
}
async function firebaseDiagnostics() {
  let serviceAccountProject = null;
  let keyKind = null;
  let keyProblem = null;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) keyProblem = "FIREBASE_SERVICE_ACCOUNT_KEY vazia";
  else {
    try {
      const parsed = JSON.parse(raw);
      serviceAccountProject = typeof parsed.project_id === "string" ? parsed.project_id : null;
      const email = String(parsed.client_email || "");
      keyKind = email.startsWith("firebase-adminsdk") ? "firebase-adminsdk (correta)" : email ? "outra conta de servi\xE7o (pode n\xE3o ter permiss\xE3o de login)" : "sem client_email";
      if (parsed.type !== "service_account") keyProblem = "o JSON n\xE3o \xE9 uma chave de conta de servi\xE7o (type deveria ser service_account)";
      else if (!String(parsed.private_key || "").includes("PRIVATE KEY")) keyProblem = "private_key ausente ou cortada";
    } catch {
      keyProblem = "n\xE3o \xE9 um JSON v\xE1lido (copie o arquivo .json inteiro, de { at\xE9 })";
    }
  }
  const webProject = readWebConfig()?.projectId ?? null;
  let adminInit = "ok";
  try {
    await initFirebase();
  } catch (e) {
    adminInit = String(e?.message || e).slice(0, 200);
  }
  return {
    serviceAccountProject,
    webProject,
    sameProject: Boolean(serviceAccountProject && webProject && serviceAccountProject === webProject),
    keyKind,
    keyProblem,
    adminInit
  };
}
function explainTokenError(error) {
  const code = String(error?.code || "");
  const msg = String(error?.message || error);
  if (code === "auth/id-token-expired") return { status: 401, message: "Sess\xE3o expirada. Entre novamente.", reason: "expired" };
  if (/aud|audience|iss|issuer/i.test(msg))
    return {
      status: 503,
      message: "Configura\xE7\xE3o do servidor: a chave FIREBASE_SERVICE_ACCOUNT_KEY \xE9 de um projeto Firebase diferente do FIREBASE_WEB_CONFIG. Abra /api/health para ver os dois projetos.",
      reason: "project_mismatch"
    };
  if (/FIREBASE_SERVICE_ACCOUNT_KEY|private key|PEM|credential|invalid_grant|DECODER/i.test(msg))
    return {
      status: 503,
      message: "Configura\xE7\xE3o do servidor: a chave FIREBASE_SERVICE_ACCOUNT_KEY n\xE3o abriu. Abra /api/health para ver o motivo.",
      reason: "bad_key"
    };
  if (code === "auth/id-token-revoked" || code === "auth/user-disabled" || code === "auth/user-not-found")
    return { status: 401, message: "Sess\xE3o encerrada. Entre novamente.", reason: code };
  return { status: 401, message: "N\xE3o foi poss\xEDvel confirmar seu login. Saia e entre novamente.", reason: code || "unknown" };
}
var cached = null;
function initFirebase() {
  cached ??= (async () => {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY n\xE3o configurada.");
    let credentials;
    try {
      credentials = JSON.parse(raw);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY n\xE3o \xE9 um JSON v\xE1lido.");
    }
    if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    const { initializeApp, cert, getApps } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const { getFirestore } = await import("firebase-admin/firestore");
    const { getStorage } = await import("firebase-admin/storage");
    const web = readWebConfig();
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || web?.storageBucket;
    const app = getApps()[0] ?? initializeApp({ credential: cert(credentials), projectId: credentials.project_id, ...bucketName ? { storageBucket: bucketName } : {} });
    const auth = getAuth(app);
    const databaseId = process.env.FIRESTORE_DATABASE_ID;
    const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
    const files = bucketName ? {
      async save(path, contentType, bytes) {
        await getStorage(app).bucket().file(path).save(Buffer.from(bytes), { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
      },
      async signedUrl(path) {
        const [url] = await getStorage(app).bucket().file(path).getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1e3 });
        return url;
      }
    } : void 0;
    return {
      db,
      files,
      async verifyToken(token) {
        const decoded = await auth.verifyIdToken(token);
        return {
          uid: decoded.uid,
          email: String(decoded.email || ""),
          emailVerified: decoded.email_verified === true,
          name: typeof decoded.name === "string" ? decoded.name : void 0
        };
      }
    };
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

// server/firestoreStore.ts
var strip = (data) => JSON.parse(JSON.stringify(data));
var FirestoreStore = class {
  /** prefix: separa as coleções do Froc de outros apps no mesmo projeto (ex.: "froc_"). */
  constructor(db, prefix = "") {
    this.db = db;
    this.prefix = prefix;
  }
  col(name) {
    return this.db.collection(this.prefix + name);
  }
  async get(collection, id) {
    const snap = await this.col(collection).doc(id).get();
    return snap.exists ? snap.data() : null;
  }
  async set(collection, id, data) {
    await this.col(collection).doc(id).set(strip(data));
  }
  async update(collection, id, data) {
    await this.col(collection).doc(id).update(strip(data));
  }
  async query(collection, filters, limit = 200) {
    let q = this.col(collection);
    for (const [field, op, value] of filters) q = q.where(field, op, value);
    const snap = await q.limit(limit).get();
    return snap.docs.map((d) => d.data());
  }
  async count(collection, filters) {
    let q = this.col(collection);
    for (const [field, op, value] of filters) q = q.where(field, op, value);
    const snap = await q.count().get();
    return Number(snap.data().count || 0);
  }
  async transaction(fn) {
    return this.db.runTransaction(async (t) => {
      const tx = {
        get: async (c, id) => {
          const snap = await t.get(this.col(c).doc(id));
          return snap.exists ? snap.data() : null;
        },
        set: (c, id, d) => {
          t.set(this.col(c).doc(id), strip(d));
        },
        update: (c, id, d) => {
          t.update(this.col(c).doc(id), strip(d));
        }
      };
      return fn(tx);
    });
  }
};

// server/runtime.ts
function publicSiteUrl() {
  const explicit = process.env.PUBLIC_SITE_URL || process.env.APP_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return (explicit || (vercel ? `https://${vercel}` : "")).replace(/\/+$/, "");
}
var COLLECTION_PREFIX = process.env.FIRESTORE_COLLECTION_PREFIX ?? "froc_";
var servicePromise = null;
function getService() {
  const publicUrl = publicSiteUrl();
  servicePromise ??= Promise.all([
    initFirebase(),
    createH3Geo().catch((e) => {
      console.warn("H3 indispon\xEDvel, usando grade simples:", e);
      return createGridGeo();
    })
  ]).then(
    ([fb, geo]) => new FrocService(new FirestoreStore(fb.db, COLLECTION_PREFIX), {
      geo,
      files: fb.files,
      adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
      payments: createMercadoPago({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN, publicUrl })
    })
  );
  servicePromise.catch(() => {
    servicePromise = null;
  });
  return servicePromise;
}
function buildApp() {
  return createApp({
    service: getService,
    verifyToken: async (token) => (await initFirebase()).verifyToken(token),
    webhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    cronSecret: process.env.CRON_SECRET,
    configStatus,
    diagnostics: firebaseDiagnostics,
    explainTokenError,
    publicConfig: () => ({
      firebase: readWebConfig(),
      mapsApiKey: process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "",
      paymentsEnabled: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN && publicSiteUrl())
    })
  });
}
function configStatus() {
  return {
    firebaseServiceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY),
    firebaseWebConfig: Boolean(readWebConfig()),
    adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS).length > 0,
    adminEmailsCount: parseAdminEmails(process.env.ADMIN_EMAILS).length,
    mercadoPago: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN),
    mercadoPagoWebhook: Boolean(process.env.MERCADO_PAGO_WEBHOOK_SECRET),
    publicSiteUrl: publicSiteUrl() || null,
    googleMaps: Boolean(process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY),
    cron: Boolean(process.env.CRON_SECRET),
    firestoreDatabase: process.env.FIRESTORE_DATABASE_ID || "(default)",
    collectionPrefix: COLLECTION_PREFIX
  };
}

// server/vercel-entry.ts
var vercel_entry_default = buildApp();
export {
  vercel_entry_default as default
};
