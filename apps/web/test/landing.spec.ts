/**
 * @vitest-environment jsdom
 *
 * The public landing page (landing.html), served at the site root.
 *
 * It is plain HTML with its own stylesheet, so nothing type-checks it and nothing
 * renders it in the unit suite. These tests hold the promises it makes: it loads
 * nothing from outside the building (its headline claim is "no external cloud
 * dependencies"), every link goes somewhere real, and every sign-in button lands on
 * the application's home — the page that sends a visitor to Keycloak.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_PATH } from '../src/routes';

const root = resolve(__dirname, '..');
const html = readFileSync(resolve(root, 'landing.html'), 'utf8');
const css = readFileSync(resolve(root, 'src/landing.css'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');

const anchors = [...doc.querySelectorAll('a')];

describe('landing page: self-contained', () => {
  it('loads no script and no remote stylesheet or font', () => {
    expect(doc.querySelectorAll('script[src]')).toHaveLength(0);
    const remote = [...doc.querySelectorAll('link[href], img[src], source[src]')]
      .map((e) => e.getAttribute('href') ?? e.getAttribute('src') ?? '')
      .filter((u) => /^(https?:)?\/\//.test(u));
    expect(remote).toEqual([]);
  });

  it('imports no remote CSS', () => {
    // The licence comment names a URL; only @import statements load anything.
    const imports = [...css.matchAll(/@import\s+(?:url\()?['"]?([^'")\s;]+)/g)].map((m) => m[1]!);
    expect(imports.filter((u) => /^(https?:)?\/\//.test(u))).toEqual([]);
  });
});

describe('landing page: links', () => {
  it('points every link at an in-page section or the application home', () => {
    const bad = anchors
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => !(h === '/' || h === HOME_PATH || h.startsWith('#')));
    expect(bad).toEqual([]);
  });

  it('resolves every in-page link to an element that exists', () => {
    const missing = anchors
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.length > 1 && h.startsWith('#'))
      .filter((h) => !doc.getElementById(h.slice(1)));
    expect(missing).toEqual([]);
  });

  it('sends every sign-in button to the application home, never /auth/login', () => {
    expect(html).not.toContain('/auth/login');
    const signIn = anchors.filter((a) => a.getAttribute('href') === HOME_PATH);
    expect(signIn.length).toBeGreaterThanOrEqual(4);
  });
});

describe('landing page: logos', () => {
  const imgs = [...doc.querySelectorAll('img')];

  it('uses the Summit Logic logos, with the sizes the layout needs', () => {
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    for (const img of imgs) {
      expect(img.getAttribute('alt')).toMatch(/Summit Logic/);
      expect(img.getAttribute('width')).toBeTruthy();
      expect(img.getAttribute('height')).toBeTruthy();
    }
  });

  it('ships every image and icon it references', () => {
    const refs = [
      ...imgs.map((i) => i.getAttribute('src') ?? ''),
      ...[...doc.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map(
        (l) => l.getAttribute('href') ?? '',
      ),
    ];
    const missing = refs.filter((r) => !existsSync(resolve(root, 'public', r.replace(/^\//, ''))));
    expect(missing).toEqual([]);
  });
});
