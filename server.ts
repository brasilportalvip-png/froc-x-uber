import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildApp, configStatus } from './server/runtime.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  app.use(buildApp());

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
  if (!configStatus().mercadoPago || !configStatus().publicSiteUrl)
    console.warn('⚠️  Recargas desativadas até configurar MERCADO_PAGO_ACCESS_TOKEN e PUBLIC_SITE_URL.');

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Froc X Uber rodando em http://0.0.0.0:${port}`));
}

startServer();
