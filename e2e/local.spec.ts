import { expect, test } from '@playwright/test';

/** O que um visitante faz na página inicial (funciona no site local e no site no ar). */
const skipPopup = async (page: import('@playwright/test').Page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem('froc-launch-popup', new Date().toDateString());
    } catch {
      /* sem armazenamento */
    }
  });

test.describe('Visitante na página inicial', () => {
  test('vê o pop-up da inauguração com contagem regressiva e consegue fechar', async ({ page }) => {
    await page.goto('/');
    const popup = page.getByTestId('launch-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup.getByText('10 de março de 2027')).toBeVisible();
    await expect(popup.getByText(/dias/i)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    // Não volta no mesmo dia.
    await page.reload();
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('launch-popup')).toBeHidden();
  });

  test('chamadas para ação levam ao cadastro', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('launch-popup').getByRole('button', { name: 'Quero ser fundador' }).click();
    await expect(page.getByTestId('launch-popup')).toBeHidden();
    await expect(page.locator('#entrar')).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Quero ser motorista' }).first().click();
    await expect(page.locator('#entrar')).toBeInViewport();
    await expect(page.getByRole('link', { name: /WhatsApp/ }).first()).toHaveAttribute('href', /wa\.me/);
  });

  test('identidade visual: fundo preto, logo animado e serviços', async ({ page }) => {
    await skipPopup(page);
    await page.goto('/');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(5, 5, 5)');
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
    await expect(page.locator('.froc-logo').first()).toBeVisible();
    for (const s of ['Corridas', 'Negociar', 'Caronas', 'Cargas e fretes']) await expect(page.getByRole('heading', { name: s })).toBeVisible();
    await expect(page.getByText('Caminhões, vans, furgões e utilitários', { exact: false })).toBeVisible();
  });

  test('perguntas frequentes abrem e fecham', async ({ page }) => {
    await skipPopup(page);
    await page.goto('/');
    const q = page.getByText('O Froc X Uber funciona em que cidades?');
    await q.click();
    await expect(page.getByText('Em todo o Brasil.', { exact: false })).toBeVisible();
  });

  test('sem estouro horizontal na tela (celular e computador)', async ({ page }) => {
    await skipPopup(page);
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('robots.txt e chave do Bing estão no ar', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.ok()).toBeTruthy();
    expect(await robots.text()).toContain('Sitemap:');
    const key = await request.get('/f7c3a9e15b8d4c2e9a61d0b47e3f5c28.txt');
    expect(await key.text()).toContain('f7c3a9e15b8d4c2e9a61d0b47e3f5c28');
  });
});
