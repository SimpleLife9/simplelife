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

  await page.goto('/experiments/stt-local/');
  await expect(page.getByRole('heading', { name: 'Transcripción local de voz' })).toBeVisible();
  await expect(page.getByText('No selecciones ninguno de tus audios privados', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar y preparar modelo' })).toBeEnabled();
  await expect(page.getByLabel('Audio sintético de prueba')).toBeDisabled();

  expect(remoteRequests).toEqual([]);
  expect(await page.locator('input[type="file"]').count()).toBe(1);
  expect(await page.locator('input[type="file"]').getAttribute('accept')).toBe('audio/*');
  await expect(page.getByText('La descarga solo comienza al pulsar el botón.', { exact: false })).toBeVisible();
});
