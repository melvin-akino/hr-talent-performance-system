import { test as setup, expect } from '@playwright/test';

/**
 * Signs in once and saves the browser state for the other specs to reuse.
 *
 * The credentials are the demo fixtures printed by `hr seed-demo` and defined in
 * ops/keycloak/realm-hr.json — throwaway accounts on a local container. Nothing
 * here belongs anywhere near a real deployment, which is why the realm file
 * carries the same warning.
 *
 * Driving the real Keycloak login form rather than injecting a token is
 * deliberate: the redirect leg is where this application has broken before
 * (the missing /callback route, the dropped `basic` scope, the issuer without
 * its path), and a test that skips it would have caught none of them.
 */
const USER = process.env.E2E_USER ?? 'maria';
const PASSWORD = process.env.E2E_PASSWORD ?? 'test1234';

setup('authenticate as an HR admin', async ({ page }) => {
  await page.goto('/');

  // Keycloak's own login page, on its own origin.
  await page.getByLabel(/username or email/i).fill(USER);
  // Keycloak renders a show/hide toggle that also matches /password/, so target
  // the textbox explicitly rather than by label alone.
  await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Back on the app, with an employee record resolved from the token subject.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByText('Maria Reyes')).toBeVisible();

  await page.context().storageState({ path: '.auth/maria.json' });
});
