import { test, expect } from '@playwright/test';

test('isolated STT lab uses whisper.cpp locally and performs no download before explicit preparation', async ({ page }) => {
  const remoteRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5173') {
      remoteRequests.push({ method: request.method(), host: url.hostname });
    }
  });

  await page.goto('/experiments/stt-local/index.html');
  await expect(page.getByRole('heading', { name: 'Transcripción local de voz' })).toBeVisible();
  await expect(page.getByText('No selecciones audios privados', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar y preparar motor' })).toBeEnabled();
  await expect(page.getByLabel('Audio sintético o público de prueba')).toBeDisabled();

  const source = await page.locator('script[type="module"]').getAttribute('src');
  expect(source).toBe('./app.js');
  const appResponse = await page.request.get('/experiments/stt-local/app.js');
  expect(appResponse.ok()).toBe(true);
  const appSource = await appResponse.text();
  expect(appSource).toContain('@timur00kh/whisper.wasm@0.1.1/+esm');
  expect(appSource).toContain('"/__stt-whisper/" + MODEL_PATH');
  expect(appSource).toContain('818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7');
  expect(appSource).toContain('state.session.streaming(samples');
  expect(appSource).not.toContain('@huggingface/transformers');
  expect(appSource).not.toContain('onnx-community/whisper-tiny');

  expect(remoteRequests).toEqual([]);
  expect(await page.locator('input[type="file"]').count()).toBe(1);
  expect(await page.locator('input[type="file"]').getAttribute('accept')).toBe('audio/*');
  await expect(page.getByText('La descarga solo comienza al pulsar el botón.', { exact: false })).toBeVisible();
});
