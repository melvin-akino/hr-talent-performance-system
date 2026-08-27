import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

/**
 * The three journeys that must never break.
 *
 * Each spans browser → OIDC → API → RLS → Postgres. They assert behaviour that
 * only exists when all of those agree, and deliberately avoid re-testing what
 * the cheaper suites already cover.
 */

/**
 * Navigate and wait for the application shell.
 *
 * `storageState` persists cookies and localStorage but **not sessionStorage**,
 * which is where oidc-client-ts keeps the signed-in user. So every fresh
 * context silently re-authenticates through Keycloak — the SSO cookie makes it
 * invisible, but it is a real redirect, and asserting on page content before it
 * finishes races it. Waiting for the nav is the readiness signal.
 */
async function gotoApp(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

test.describe('navigation reflects the signed-in user', () => {
  test('an HR admin is offered all three groups', async ({ page }) => {
    await gotoApp(page, '/');
    const nav = page.getByRole('navigation', { name: 'Main' });

    // Maria holds hr_admin, so Company is present. That a plain employee sees
    // only Mine is asserted in sidebar.spec.ts — proving it here would cost a
    // second login for little extra signal.
    await expect(nav.getByText('Mine')).toBeVisible();
    await expect(nav.getByText('My team')).toBeVisible();
    await expect(nav.getByText('Company')).toBeVisible();
  });

  test('every destination loads without a client error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    for (const path of ['/', '/reviews', '/competencies', '/development',
      '/feedback', '/notifications', '/team', '/monitoring', '/pips',
      '/hr', '/review-admin', '/analytics', '/kpis', '/setup']) {
      await gotoApp(page, path);
    }

    expect(errors).toEqual([]);
  });
});

/** Every goal this suite creates carries this prefix, so cleanup can find them. */
const E2E_GOAL_PREFIX = 'E2E goal ';

/**
 * Deletes the goals this suite created, whatever happened to the test.
 *
 * Cancelling in the test is not enough on its own. When the test fails between
 * creating and cancelling — which it did, once, without reproducing — the goal
 * survives as a draft and every later run inherits it. That is how this fixture
 * accumulated seven stray goals before anyone noticed.
 *
 * It connects directly rather than driving the UI: cleanup has to run after a
 * failure, when the browser is in an unknown state and the thing that failed may
 * be the very screen the cleanup would need.
 *
 * A cleanup failure warns rather than throws. Failing here would mask the real
 * result of the run, and the warning names the exact query to run by hand.
 */
async function deleteE2EGoals(): Promise<number> {
  const url = process.env.ADMIN_DATABASE_URL
    ?? 'postgresql://postgres:postgres@localhost:15432/hr';
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const like = `${E2E_GOAL_PREFIX}%`;
    // Children first: goal_target and goal_checkin both reference goal.
    await client.query('DELETE FROM goal_target WHERE goal_id IN (SELECT id FROM goal WHERE title LIKE $1)', [like]);
    await client.query('DELETE FROM goal_checkin WHERE goal_id IN (SELECT id FROM goal WHERE title LIKE $1)', [like]);
    const res = await client.query('DELETE FROM goal WHERE title LIKE $1', [like]);
    return res.rowCount ?? 0;
  } finally {
    await client.end();
  }
}

test.describe('goal lifecycle', () => {
  test.afterAll(async () => {
    try {
      const removed = await deleteE2EGoals();
      if (removed > 0) console.log(`  cleaned up ${removed} goal(s) created by this suite`);
    } catch (err) {
      console.warn(
        `  WARNING: could not clean up goals created by this suite: ${String(err)}\n` +
        `  Remove them by hand or the fixture will drift:\n` +
        `    DELETE FROM goal WHERE title LIKE '${E2E_GOAL_PREFIX}%';`);
    }
  });

  /**
   * Creates a goal and cleans it up again.
   *
   * The cleanup is not politeness. These run against the shared demo database,
   * and an earlier version of this test left a goal behind on every run — after
   * two runs the fixture had 200% of weight assigned, which is exactly the
   * broken state the HR console exists to flag. A test that degrades the data it
   * depends on eventually fails for reasons that have nothing to do with the
   * code.
   *
   * Cancelling in the test is still worth doing: it exercises the cancel path,
   * and it keeps the fixture correct during the run rather than only after it.
   * `afterAll` above is the backstop for when this test does not reach the end.
   *
   * The weight is a normal one: `goal_weight_valid` requires `> 0`, and the
   * weight gate counts neither draft nor cancelled goals, so a goal that is
   * created as a draft and cancelled at the end never touches the totals.
   */
  test('a goal can be created, opens, and keeps its measure', async ({ page }) => {
    // Built from the same constant the cleanup matches on, so the two cannot
    // drift apart and leave orphans the cleanup silently misses.
    const title = `${E2E_GOAL_PREFIX}${Date.now()}`;

    await gotoApp(page, '/goals/new');
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Weight (%)').fill('10');
    await page.getByLabel('Measure name').fill('E2E measure');
    await page.getByLabel('Target', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Create goal' }).click();

    // Creating navigates straight to the new goal, so assert there rather than
    // on a shared list whose contents depend on every other test.
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    // The measure survived the round trip, with its direction stated inline —
    // several measures on one goal may disagree, so this is never assumed.
    await expect(page.getByText(/higher is better|lower is better/)).toBeVisible();

    // Cancel it, restoring the fixture. window.prompt supplies the reason.
    page.once('dialog', (d) => void d.accept('created by an automated test'));
    await page.getByRole('button', { name: 'Cancel goal' }).click();
    await expect(page.getByText('Cancelled')).toBeVisible();
  });
});

test.describe('review calibration and sign-off', () => {
  test('sign-off is blocked until every review is submitted', async ({ page }) => {
    await gotoApp(page, '/review-admin');
    await expect(page.getByRole('heading', { name: 'Review cycles' })).toBeVisible();

    // The demo cycle has self-reviews outstanding, so rows read "1/2 submitted"
    // and their Sign off is disabled. This gate protects an irreversible action,
    // so it is worth asserting end to end and not only as a unit test.
    const incomplete = page.locator('tbody tr').filter({ hasText: '1/2 submitted' }).first();
    await expect(incomplete).toBeVisible();
    await expect(incomplete.getByRole('button', { name: 'Sign off' })).toBeDisabled();
  });

  test('a calibrated rating that differs from the overall shows movement', async ({ page }) => {
    await gotoApp(page, '/review-admin');

    // Seeded at overall 5.0, calibrated 4.0. The arrow is how movement is
    // communicated without spending a column on it.
    const row = page.locator('tbody tr').filter({ hasText: 'Liza Ocampo' });
    await expect(row).toBeVisible();
    await expect(row.locator('svg').first()).toBeVisible();
  });

  test('signing off asks for confirmation before it writes', async ({ page }) => {
    await gotoApp(page, '/review-admin');

    const ready = page.locator('tbody tr')
      .filter({ has: page.getByRole('button', { name: 'Sign off', disabled: false }) })
      .first();

    // The confirmation is only reachable when something is fully submitted;
    // skip rather than assert a false negative against the demo data.
    if (await ready.count() === 0) {
      test.skip(true, 'no fully-submitted review in the demo data');
      return;
    }

    await ready.getByRole('button', { name: 'Sign off' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/cannot be undone/i);

    // Dismissing must leave the row untouched — the entire point of asking.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(ready.getByRole('button', { name: 'Sign off' })).toBeVisible();
  });
});

test.describe('analytics never quietly drops people', () => {
  test('the nine-box reports who is not on the grid', async ({ page }) => {
    await gotoApp(page, '/analytics');

    // A grid that silently shrinks is how a nine-box misleads, so the count of
    // people without a rating or a potential is part of the reading.
    await expect(page.getByText('Nine-box')).toBeVisible();
    await expect(page.getByText(/not shown on the grid/i)).toBeVisible();
  });
});
