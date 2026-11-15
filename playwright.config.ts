import { defineConfig, devices } from '@playwright/test';

/**
 * Teste de "pessoa real": um navegador de verdade abre o site no computador e num celular
 * (tela, toque e tamanho de um Pixel 7) e usa como uma pessoa usaria.
 * Local: compila e abre a versão nova em http://localhost:4173 (sem servidor de dados).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /local\.spec\.ts/,
  timeout: 45_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  projects: [
    { name: 'computador', use: { ...devices['Desktop Chrome'] } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
});
