import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Teste no site que está NO AR (produção), no computador e no celular.
 * Endereço: E2E_BASE_URL (padrão https://froc-x-uber.vercel.app).
 * Login real (opcional): E2E_EMAIL e E2E_PASSWORD de uma conta de TESTE no arquivo .env.
 */
const baseURL = process.env.E2E_BASE_URL || 'https://froc-x-uber.vercel.app';

export default defineConfig({
  testDir: './e2e',
  testMatch: /(local|producao)\.spec\.ts/,
  timeout: 90_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-producao' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  projects: [
    { name: 'producao-computador', use: { ...devices['Desktop Chrome'] } },
    { name: 'producao-celular', use: { ...devices['Pixel 7'] } },
  ],
});
