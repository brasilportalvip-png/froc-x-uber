import { expect, test } from '@playwright/test';

/** Site no ar: servidor, SEO, proteção e (opcional) login real com conta de teste. */
test.describe('Produção', () => {
  test('servidor saudável e configurado', async ({ request }) => {
    const r = await request.get('/api/health');
    expect(r.ok()).toBeTruthy();
    const h = await r.json();
    expect(h.ok).toBe(true);
    expect(h.firebase?.adminInit).toBe('ok');
    expect(h.config?.firebaseWebConfig).toBe(true);
  });

  test('dados protegidos: sem login a API recusa', async ({ request }) => {
    for (const path of ['/api/bootstrap', '/api/admin/overview', '/api/support', '/api/admin/ai/agents']) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(401);
    }
    const fake = await request.get('/api/bootstrap', { headers: { Authorization: 'Bearer token-falso' } });
    expect([401, 503]).toContain(fake.status());
  });

  test('cabeçalhos de segurança', async ({ request }) => {
    const r = await request.get('/');
    const h = r.headers();
    expect(h['strict-transport-security']).toContain('max-age');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBeTruthy();
  });

  test('sitemaps XML válidos e páginas indexáveis', async ({ request }) => {
    const index = await request.get('/sitemap.xml');
    expect(index.ok()).toBeTruthy();
    expect(index.headers()['content-type']).toContain('xml');
    const xml = await index.text();
    expect(xml).toContain('<sitemapindex');
    for (const loc of [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)) {
      const sm = await request.get(loc);
      expect(sm.ok(), loc).toBeTruthy();
      const body = await sm.text();
      expect(body).toMatch(/<urlset[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
      const urls = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname).slice(0, 12);
      for (const u of urls) {
        const page = await request.get(u);
        expect(page.status(), u).toBe(200);
      }
    }
  });

  test('páginas de serviço e blog têm título, descrição, canonical e dados estruturados', async ({ page }) => {
    for (const path of ['/corridas-por-aplicativo', '/caronas-intermunicipais', '/fretes-e-mudancas', '/seja-motorista', '/blog', '/como-funciona', '/regras-e-requisitos', '/perguntas-frequentes', '/desenvolvedores']) {
      await page.goto(path);
      await expect(page.locator('h1')).toHaveCount(1);
      expect((await page.title()).length).toBeGreaterThan(20);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{100,}/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${path}$`));
      expect(await page.locator('script[type="application/ld+json"]').count()).toBeGreaterThan(0);
    }
    const rss = await page.request.get('/rss.xml');
    expect(await rss.text()).toContain('<rss');
  });

  test('regras e leis: EAR, ano do veículo e lojas aparecem para o público', async ({ page }) => {
    await page.goto('/regras-e-requisitos');
    await expect(page.getByText(/EAR/).first()).toBeVisible();
    await expect(page.getByText(/até 8 anos/).first()).toBeVisible();
    await page.goto('/perguntas-frequentes');
    expect(await page.locator('details').count()).toBeGreaterThan(8);
  });

  test('API de lojas e acompanhamento por link: protegidos', async ({ request, page }) => {
    const noKey = await request.post('/api/v1/deliveries', { data: {} });
    expect(noKey.status()).toBe(401);
    expect((await noKey.json()).code).toBe('invalid_api_key');
    const badKey = await request.get('/api/v1/me', { headers: { Authorization: 'Bearer froc_live_chave_inventada_para_teste_123456' } });
    expect(badKey.status()).toBe(401);
    const track = await request.get('/api/track/token-que-nao-existe-123456789');
    expect([404, 410]).toContain(track.status());
    expect(track.headers()['cache-control']).toContain('no-store');
    for (const path of ['/api/drivers/nearby?lat=-23.5&lng=-46.6', '/api/merchant/keys']) expect((await request.get(path)).status(), path).toBe(401);
    await page.goto('/acompanhar/token-que-nao-existe-123456789');
    await expect(page.getByText(/expirou|inválido/i)).toBeVisible({ timeout: 15_000 });
  });

  test('login real com conta de teste e atendimento (opcional)', async ({ page }) => {
    test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Defina E2E_EMAIL e E2E_PASSWORD (conta de teste) no .env');
    await page.addInitScript(() => localStorage.setItem('froc-launch-popup', new Date().toDateString()));
    await page.goto('/');
    await page.getByRole('button', { name: 'Entrar' }).first().click();
    await page.getByPlaceholder('E-mail').fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder(/Senha/).fill(process.env.E2E_PASSWORD!);
    await page.locator('#entrar form button[type="submit"]').click();
    await expect(page.getByText('Corridas').first()).toBeVisible({ timeout: 30_000 });
    // Conta de teste sem CPF: a tela "Confirme quem você é" tem de aparecer e bloquear o uso.
    const gate = page.getByRole('dialog', { name: 'Confirme quem você é' });
    if (await gate.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await expect(gate.getByPlaceholder('000.000.000-00')).toBeVisible();
      await gate.getByPlaceholder('000.000.000-00').fill('11111111111');
      await expect(gate.getByText('CPF inválido')).toBeVisible();
      return;
    }
    await page.getByTestId('support-button').click();
    await expect(page.getByText('Atendimento Froc')).toBeVisible();
  });
});
