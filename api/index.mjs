// Função da Vercel que atende todas as rotas /api/* do Froc X Uber.
// O arquivo _server.mjs é gerado por "npm run build" (esbuild) a partir de server/.
import app from './_server.mjs';

export const config = { maxDuration: 60 };
export default app;
