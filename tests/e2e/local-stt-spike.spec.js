import { test, expect } from '@playwright/test';

test('local STT experiment is isolated and makes no remote request before explicit model loading', async ({ page }) => {
  const remoteRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5173') remoteRequests.push({
      method: request.method(),
      host: url.hostname,
    });
  });

  await page.goto('/experiments/stt-local/index.html');
  await expect(page.getByRole('heading', { name: 'Transcripción local de voz' })).toBeVisible();
  await expect(page.getByText('No selecciones ninguno de tus audios privados', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar y preparar modelo' })).toBeEnabled();
  await expect(page.getByLabel('Audio sintético de prueba')).toBeDisabled();

  const source = await page.locator('script[type="module"]').getAttribute('src');
  expect(source).toBe('./app.js');
  const appResponse = await page.request.get('/experiments/stt-local/app.js');
  expect(appResponse.ok()).toBe(true);
  const appSource = await appResponse.text();
  expect(appSource).toContain('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2"');
  expect(appSource).not.toContain('@huggingface/transformers@4.3.2/+esm');
  expect(appSource).toContain('"/__stt-model/"');
  expect(appSource).toContain('env.remoteHost = new URL("/__stt-model/", location.origin).href;');
  expect(appSource).toContain('pinModelRevisionUrl(originalUrl)');

  expect(remoteRequests).toEqual([]);
  expect(await page.locator('input[type="file"]').count()).toBe(1);
  expect(await page.locator('input[type="file"]').getAttribute('accept')).toBe('audio/*');
  await expect(page.getByText('La descarga solo comienza al pulsar el botón.', { exact: false })).toBeVisible();
});
