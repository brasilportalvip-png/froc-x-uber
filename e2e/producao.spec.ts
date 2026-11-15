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
    for (const path of ['/corridas-por-aplicativo', '/caronas-intermunicipais', '/fretes-e-mudancas', '/seja-motorista', '/blog']) {
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

  test('login real com conta de teste e atendimento (opcional)', async ({ page }) => {
    test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Defina E2E_EMAIL e E2E_PASSWORD (conta de teste) no .env');
    await page.addInitScript(() => localStorage.setItem('froc-launch-popup', new Date().toDateString()));
    await page.goto('/');
    await page.getByRole('button', { name: 'Entrar' }).first().click();
    await page.getByPlaceholder('E-mail').fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder(/Senha/).fill(process.env.E2E_PASSWORD!);
    await page.locator('#entrar form button[type="submit"]').click();
    await expect(page.getByText('Corridas').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('support-button').click();
    await expect(page.getByText('Atendimento Froc')).toBeVisible();
  });
});
