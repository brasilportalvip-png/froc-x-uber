/**
 * Monta o app do servidor a partir das variáveis de ambiente. Usado tanto pelo servidor
 * Node (server.ts: local, Render, Cloud Run) quanto pela função da Vercel (api/index.mjs).
 */
import { createApp } from './app.ts';
import { explainTokenError, firebaseDiagnostics, initFirebase, readWebConfig } from './firebase.ts';
import { FirestoreStore } from './firestoreStore.ts';
import { createMercadoPago } from './mercadoPago.ts';
import { FrocService, parseAdminEmails } from './services.ts';
import { createGridGeo, createH3Geo } from './geo.ts';
import { SupportDesk } from './support.ts';
import { BlogService, createIndexNow } from './blog.ts';
import { createGemini } from './ai/gemini.ts';
import { AiTeam } from './ai/team.ts';
import type { Store } from './store.ts';

/** Endereço público do site (links de volta do Mercado Pago). Na Vercel, usa o domínio de produção. */
export function publicSiteUrl() {
  const explicit = process.env.PUBLIC_SITE_URL || process.env.APP_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return (explicit || (vercel ? `https://${vercel}` : '')).replace(/\/+$/, '');
}

/**
 * Prefixo das coleções no Firestore. Permite usar um projeto Firebase que já tem outro app
 * sem misturar os dados (padrão: "froc_" → froc_users, froc_rides...).
 */
export const COLLECTION_PREFIX = process.env.FIRESTORE_COLLECTION_PREFIX ?? 'froc_';

export interface Platform {
  store: Store;
  service: FrocService;
  support: SupportDesk;
  blog: BlogService;
  team: AiTeam;
}

let servicePromise: Promise<FrocService> | null = null;
let platformPromise: Promise<Platform> | null = null;
let sharedStore: Store | null = null;

/** Serviços extras (atendimento, blog, Equipe IA) usando o mesmo banco do app. */
export function getPlatform() {
  platformPromise ??= getService().then((service) => {
    const store = sharedStore!;
    const llm = createGemini({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL });
    const support = new SupportDesk(store);
    const blog = new BlogService(store, { llm, siteUrl: publicSiteUrl, indexNow: createIndexNow(publicSiteUrl) });
    const team = new AiTeam({ store, service, support, blog, llm, configStatus });
    return { store, service, support, blog, team };
  });
  platformPromise.catch(() => {
    platformPromise = null;
  });
  return platformPromise;
}

export function getService() {
  const publicUrl = publicSiteUrl();
  servicePromise ??= Promise.all([
    initFirebase(),
    createH3Geo().catch((e) => {
      console.warn('H3 indisponível, usando grade simples:', e);
      return createGridGeo();
    }),
  ]).then(
    ([fb, geo]) => {
      sharedStore = new FirestoreStore(fb.db, COLLECTION_PREFIX);
      return new FrocService(sharedStore, {
        geo,
        files: fb.files,
        adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
        payments: createMercadoPago({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN, publicUrl }),
      });
    },
  );
  servicePromise.catch(() => {
    servicePromise = null;
  });
  return servicePromise;
}

export function buildApp() {
  return createApp({
    service: getService,
    platform: getPlatform,
    siteUrl: () => publicSiteUrl() || 'https://froc-x-uber.vercel.app',
    verifyToken: async (token) => (await initFirebase()).verifyToken(token),
    webhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    cronSecret: process.env.CRON_SECRET,
    configStatus,
    diagnostics: firebaseDiagnostics,
    explainTokenError,
    publicConfig: () => ({
      firebase: readWebConfig(),
      mapsApiKey: process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
      paymentsEnabled: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN && publicSiteUrl()),
    }),
  });
}

/** Diagnóstico sem segredos: mostra o que falta configurar (rota /api/health). */
export function configStatus() {
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
    ai: Boolean(process.env.GEMINI_API_KEY),
    aiModel: process.env.GEMINI_MODEL || 'automático',
    firestoreDatabase: process.env.FIRESTORE_DATABASE_ID || '(default)',
    collectionPrefix: COLLECTION_PREFIX,
  };
}
