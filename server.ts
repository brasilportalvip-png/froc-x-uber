import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './server/app.ts';
import { initFirebase, readWebConfig } from './server/firebase.ts';
import { FirestoreStore } from './server/firestoreStore.ts';
import { createMercadoPago } from './server/mercadoPago.ts';
import { FrocService } from './server/services.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Endereço público do site (usado nos links de volta do Mercado Pago). */
const publicUrl = (process.env.PUBLIC_SITE_URL || process.env.APP_URL || '').replace(/\/+$/, '');

let servicePromise: Promise<FrocService> | null = null;
const service = () => {
  servicePromise ??= initFirebase().then(
    (fb) =>
      new FrocService(new FirestoreStore(fb.db), {
        files: fb.files,
        adminEmails: (process.env.ADMIN_EMAILS || '').split(','),
        payments: createMercadoPago({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN, publicUrl }),
      }),
  );
  servicePromise.catch(() => {
    servicePromise = null;
  });
  return servicePromise;
};

async function startServer() {
  const app = express();
  app.use(
    createApp({
      service,
      verifyToken: async (token) => (await initFirebase()).verifyToken(token),
      webhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
      publicConfig: () => ({
        firebase: readWebConfig(),
        mapsApiKey: process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
        paymentsEnabled: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN && publicUrl),
      }),
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  const missing = ['FIREBASE_SERVICE_ACCOUNT_KEY', 'FIREBASE_WEB_CONFIG', 'ADMIN_EMAILS'].filter((k) => !process.env[k]);
  if (missing.length) console.warn('⚠️  Configure as variáveis: ' + missing.join(', ') + ' (veja CONFIGURACAO.md).');
  if (!process.env.MERCADO_PAGO_ACCESS_TOKEN || !publicUrl)
    console.warn('⚠️  Recargas desativadas até configurar MERCADO_PAGO_ACCESS_TOKEN e PUBLIC_SITE_URL.');

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Froc X Uber rodando em http://0.0.0.0:${port}`));
}

startServer();
