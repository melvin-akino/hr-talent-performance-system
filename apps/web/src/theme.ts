/**
 * Light and dark, with dark as the default.
 *
 * The client asked for a dark interface, so that is what the system opens as.
 * Light is kept and reachable rather than deleted: it is the palette the design
 * system was drawn in, it is what printing uses, and "we only ship dark now" is
 * the kind of decision that is expensive to reverse once the light values have
 * rotted.
 *
 * The choice is applied to `<html>` as `data-theme`, because CSS custom
 * properties cascade from there and the whole palette swaps on one attribute —
 * no component knows which mode it is in.
 */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'hr.theme';

/** What the system opens as when nobody has chosen. */
export const DEFAULT_THEME: Theme = 'dark';

/**
 * Reads the saved choice.
 *
 * Wrapped because localStorage throws rather than returning null in a few real
 * situations — Safari private browsing, and any browser configured to block
 * site data. A theme preference is not worth a blank screen.
 */
export function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The theme still applies for this session; only the memory of it is lost.
  }
}

/**
 * Called once before the app renders, so the first paint is already correct.
 *
 * Deliberately does NOT consult `prefers-color-scheme`. The client asked for
 * dark, and a machine set to light would otherwise open light — which reads as
 * the request having been ignored. Someone who wants light can choose it, and
 * that choice sticks.
 */
export function initTheme(): Theme {
  const theme = storedTheme() ?? DEFAULT_THEME;
  applyTheme(theme);
  return theme;
}
