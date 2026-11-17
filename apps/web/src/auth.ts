import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { HOME_PATH } from './routes';

const rawIssuer = import.meta.env.VITE_OIDC_ISSUER as string | undefined;
const rawClientId = import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined;

export const oidcEnabled = Boolean(rawIssuer && rawClientId && rawIssuer.trim() !== '');

export const userManager: UserManager | null = oidcEnabled
  ? new UserManager({
      authority: rawIssuer!,
      client_id: rawClientId!,
      redirect_uri: `${window.location.origin}/callback`,
      post_logout_redirect_uri: window.location.origin,
      response_type: 'code',
      scope: 'openid profile email',
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: true,
      monitorSession: false,
    })
  : null;

/* ── SaaS and Superadmin Session Storage ───────────────────────────────── */

const SAAS_TOKEN_KEY = 'hr_saas_token';
const SAAS_USER_KEY = 'hr_saas_user';
const SUPERADMIN_TOKEN_KEY = 'hr_superadmin_token';
const SUPERADMIN_USER_KEY = 'hr_superadmin_user';

export function getSaasToken(): string | null {
  return window.sessionStorage.getItem(SAAS_TOKEN_KEY);
}

export function setSaasSession(token: string, user: unknown) {
  window.sessionStorage.setItem(SAAS_TOKEN_KEY, token);
  window.sessionStorage.setItem(SAAS_USER_KEY, JSON.stringify(user));
}

export function clearSaasSession() {
  window.sessionStorage.removeItem(SAAS_TOKEN_KEY);
  window.sessionStorage.removeItem(SAAS_USER_KEY);
}

export function getSaasUser<T = any>(): T | null {
  const raw = window.sessionStorage.getItem(SAAS_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getSuperadminToken(): string | null {
  return window.sessionStorage.getItem(SUPERADMIN_TOKEN_KEY);
}

export function setSuperadminSession(token: string, user: unknown) {
  window.sessionStorage.setItem(SUPERADMIN_TOKEN_KEY, token);
  window.sessionStorage.setItem(SUPERADMIN_USER_KEY, JSON.stringify(user));
}

export function clearSuperadminSession() {
  window.sessionStorage.removeItem(SUPERADMIN_TOKEN_KEY);
  window.sessionStorage.removeItem(SUPERADMIN_USER_KEY);
}

export function getSuperadminUser<T = any>(): T | null {
  const raw = window.sessionStorage.getItem(SUPERADMIN_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/* ── Common Auth State Resolution ─────────────────────────────────────── */

export interface AppUserSession {
  access_token: string;
  expired?: boolean;
  profile?: any;
}

export async function currentUser(): Promise<AppUserSession | null> {
  const saasToken = getSaasToken();
  if (saasToken) {
    const user = getSaasUser();
    return {
      access_token: saasToken,
      expired: false,
      profile: user,
    };
  }

  if (userManager) {
    const user = await userManager.getUser();
    return user && !user.expired ? user : null;
  }

  return null;
}

let signinCompletion: Promise<User | null> | null = null;

export function signInAndReturnHere(): void {
  const returnTo = window.location.pathname + window.location.search;
  const target = returnTo === '/callback' ? HOME_PATH : returnTo;
  window.location.href = `/login?returnTo=${encodeURIComponent(target)}`;
}

export async function logout(): Promise<void> {
  clearSaasSession();
  if (userManager) {
    try {
      await userManager.removeUser();
    } catch {
      /* ignore */
    }
  }
  window.location.href = '/login';
}

function restoredPath(user: User | null): string {
  const state = user?.state as { returnTo?: unknown } | undefined;
  const returnTo = state?.returnTo;
  if (typeof returnTo === 'string' && returnTo.startsWith('/')
      && !returnTo.startsWith('//') && returnTo !== '/') {
    return returnTo;
  }
  return HOME_PATH;
}

export function completeSigninIfCallback(): Promise<User | null> {
  if (!userManager || window.location.pathname !== '/callback') return Promise.resolve(null);
  signinCompletion ??= userManager
    .signinRedirectCallback()
    .then((user) => {
      window.history.replaceState({}, '', restoredPath(user));
      return user;
    })
    .catch(async (err) => {
      const existing = await currentUser();
      if (existing) {
        window.history.replaceState({}, '', HOME_PATH);
        return existing as unknown as User;
      }
      throw err;
    });
  return signinCompletion;
}

export function resolveApiPath(path: string): string {
  const envBase = (import.meta.env.VITE_API_BASE_URL as string)?.trim();
  const base = envBase ? envBase.replace(/\/$/, '') : '/api';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (base.endsWith('/api') && path.startsWith('/api/')) {
    return `${base.slice(0, -4)}${path}`;
  }
  if (base.endsWith('/api') && path === '/api') {
    return base;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  raw?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const user = await currentUser();
  if (!user) {
    signInAndReturnHere();
    throw new ApiError(401, 'Redirecting to sign in');
  }

  const res = await fetch(resolveApiPath(path), {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${user.access_token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  if (res.status === 401) {
    clearSaasSession();
    if (userManager) {
      await userManager.removeUser().catch(() => {});
    }
    signInAndReturnHere();
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    let detail: unknown;
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body;
      if (typeof body?.message === 'string') message = body.message;
      else if (Array.isArray(body?.message)) message = body.message.join(', ');
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, detail);
  }

  if (opts.raw) return (await res.text()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ── Platform Superadmin API Client ────────────────────────────────────── */

export async function superadminApi<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = getSuperadminToken();
  if (!token) {
    window.location.href = '/superadmin/login';
    throw new ApiError(401, 'Superadmin not authenticated');
  }

  const res = await fetch(resolveApiPath(path), {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  if (res.status === 401) {
    clearSuperadminSession();
    window.location.href = '/superadmin/login';
    throw new ApiError(401, 'Superadmin session expired');
  }

  if (!res.ok) {
    let detail: unknown;
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body;
      if (typeof body?.message === 'string') message = body.message;
      else if (Array.isArray(body?.message)) message = body.message.join(', ');
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, detail);
  }

  if (opts.raw) return (await res.text()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
