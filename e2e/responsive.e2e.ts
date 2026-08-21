import { test, expect, type Page } from '@playwright/test';

/**
 * Responsive behaviour at the widths the brief names.
 *
 * The rule that matters is not "it looks fine" — it is that **wide content
 * scrolls inside its own container and the page body never scrolls
 * horizontally**. A body that scrolls sideways makes every screen feel broken,
 * and it is the specific failure the old dense tables caused on a phone.
 *
 * 1366×768 is in here because the brief says some staff are on old office
 * monitors at exactly that size.
 */

/**
 * Every navigable route, not a sample of five.
 *
 * The original list covered the densest screens, on the theory that those are
 * where overflow happens. That reasoning was wrong in a specific way: the tables
 * on the "safe" screens were converted later and grew columns (an assessor and
 * notes column on Competencies, attribution on Development), and a heading with
 * a button beside it was added to all eighteen. Overflow now has more places to
 * appear than the dense screens.
 *
 * Detail routes (/goals/:id, /reviews/:id, /employees/:id/goals) need seeded ids
 * and are exercised by the golden-path journeys instead.
 */
const SCREENS = [
  '/', '/team', '/reviews', '/competencies', '/development', '/feedback',
  '/notifications', '/monitoring', '/pips', '/hr', '/review-admin', '/analytics',
  '/kpis', '/setup',
];

async function gotoApp(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** How far the document overflows its own viewport, in pixels. */
const overflow = (page: Page) => page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('phone — 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the sidebar becomes a horizontal strip rather than disappearing', async ({ page }) => {
    await gotoApp(page, '/');
    // Infrequent users need to see where they can go; hiding navigation behind
    // a hamburger costs more than the space it saves.
    const direction = await page.locator('.hr-sidebar')
      .evaluate((el) => getComputedStyle(el).flexDirection);
    expect(direction).toBe('row');
    await expect(page.getByRole('link', { name: 'My goals' })).toBeVisible();
  });

  test('no screen scrolls the page body sideways', async ({ page }) => {
    for (const path of SCREENS) {
      await gotoApp(page, path);
      // A pixel or two of rounding is tolerable; a scrollable body is not.
      expect(await overflow(page), `${path} overflows at 375px`).toBeLessThanOrEqual(2);
    }
  });

  test('no table clips content it cannot scroll to', async ({ page }) => {
    /*
     * The previous version of this test checked that the FIRST table on ONE page
     * had a scrolling ancestor. That passed while the calibration-movement table
     * on /analytics was 377px wide inside a 361px box with `overflow: visible` —
     * sixteen pixels of the Change column were unreachable. The page body did not
     * scroll either, so the content was not hidden behind a scrollbar; it was
     * gone.
     *
     * So the assertion is the property that actually matters, checked on every
     * table on every screen: if a table is wider than its container, that
     * container must scroll.
     */
    const unreachable: string[] = [];

    for (const path of SCREENS) {
      await gotoApp(page, path);
      const found = await page.evaluate(() => {
        const out: string[] = [];
        for (const table of document.querySelectorAll('table')) {
          const host = table.parentElement;
          if (!host) continue;
          const clipped = table.scrollWidth > host.clientWidth + 1;
          const overflowX = getComputedStyle(host).overflowX;
          if (clipped && overflowX !== 'auto' && overflowX !== 'scroll') {
            const first = table.querySelector('th')?.textContent?.trim() ?? '(no header)';
            out.push(`${first}: ${table.scrollWidth}px in ${host.clientWidth}px (${overflowX})`);
          }
        }
        return out;
      });
      unreachable.push(...found.map((f) => `${path} — ${f}`));
    }

    expect(unreachable).toEqual([]);
  });

  test('every screen shows its heading, and the action beside it', async ({ page }) => {
    // The heading is the only thing naming the current screen once the sidebar
    // has collapsed to a strip of icons. If it wraps under its action button
    // that is fine; if it is missing or pushed off-screen it is not.
    for (const path of SCREENS) {
      await gotoApp(page, path);
      const heading = page.getByRole('heading', { level: 2 }).first();
      await expect(heading, `${path} has no page heading at 375px`).toBeVisible();

      const box = await heading.boundingBox();
      expect(box, `${path} heading has no box`).not.toBeNull();
      expect(box!.x, `${path} heading starts off-screen`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${path} heading runs past the viewport`)
        .toBeLessThanOrEqual(375 + 2);
    }
  });

  test('the help drawer takes the full width', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Open help' }).click();
    const panel = page.getByRole('dialog', { name: 'Help' });
    await expect(panel).toBeVisible();
    const width = await panel.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(340);
  });
});

test.describe('old office monitor — 1366×768', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('the sidebar is a column and nothing overflows', async ({ page }) => {
    await gotoApp(page, '/');
    const direction = await page.locator('.hr-sidebar')
      .evaluate((el) => getComputedStyle(el).flexDirection);
    expect(direction).toBe('column');

    for (const path of SCREENS) {
      await gotoApp(page, path);
      expect(await overflow(page), `${path} overflows at 1366px`).toBeLessThanOrEqual(2);
    }
  });
});

test.describe('tablet — 768px', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('no screen scrolls the page body sideways', async ({ page }) => {
    for (const path of SCREENS) {
      await gotoApp(page, path);
      expect(await overflow(page), `${path} overflows at 768px`).toBeLessThanOrEqual(2);
    }
  });
});
