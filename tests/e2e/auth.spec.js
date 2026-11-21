import { test, expect } from '@playwright/test';

test('login screen switches to registration and back', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Vuelve a enfocarte.' })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  // Keep the live-smoke selector aligned with the button's accessible name (label + arrow).
  await expect(page.getByRole('button', { name: /^Iniciar sesión/ })).toBeVisible();

  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page.getByRole('heading', { name: 'Empieza con claridad.' })).toBeVisible();
  await expect(page.getByLabel('Cómo te llamas')).toBeVisible();
  await expect(page.locator('input[name="fullName"]')).toHaveAttribute('required', '');
  await expect(page.locator('input[name="password"]')).toHaveAttribute('minlength', '8');

  await page.getByRole('button', { name: 'Inicia sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Vuelve a enfocarte.' })).toBeVisible();
  await expect(page.locator('input[name="fullName"]')).toHaveCount(0);
});

test('authentication layout fits a 390px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Vuelve a enfocarte.' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    formVisible: Boolean(document.querySelector('.auth-form-wrap')?.getBoundingClientRect().width),
  }));

  expect(dimensions.formVisible).toBeTruthy();
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});
