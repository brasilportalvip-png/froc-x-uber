/** Função da Vercel: o mesmo servidor Express, empacotado em api/_server.mjs no build. */
import { buildApp } from './runtime.ts';

export default buildApp();
