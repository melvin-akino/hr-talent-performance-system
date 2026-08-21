import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

/**
 * OIDC (authorization code + PKCE) against Keycloak.
 *
 * Tokens are held in sessionStorage, not localStorage: a shared office desktop
 * should not leave a valid session behind for the next person who opens the
 * browser. It clears when the tab closes.
 *
 * This is still a token in JS-reachable storage. If the threat model tightens
 * later, the fix is a BFF holding an httpOnly cookie session -- not a different
 * storage key.
 */
/**
 * Vite inlines these at BUILD time. A container built without them produces a
 * bundle that fails deep inside oidc-client with "No authority configured" --
 * accurate, but useless to whoever is deploying at the time. Fail here with a
 * message that names the missing variable and where to set it.
 */
function required(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${name} was not set when this bundle was built. Set it as a build arg ` +
      `in docker-compose.yml (service: web) and rebuild the image.`,
    );
  }
  return value;
}

const issuer = required('VITE_OIDC_ISSUER', import.meta.env.VITE_OIDC_ISSUER);
const clientId = required('VITE_OIDC_CLIENT_ID', import.meta.env.VITE_OIDC_CLIENT_ID);

export const userManager = new UserManager({
  authority: issuer,
  client_id: clientId,
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code',
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  // Silent renew keeps a long goal-writing session from expiring mid-form.
  automaticSilentRenew: true,
  monitorSession: false,
});

export async function currentUser(): Promise<User | null> {
  const user = await userManager.getUser();
  return user && !user.expired ? user : null;
}

/**
 * Completes the OIDC redirect leg exactly once.
 *
 * An authorization code is single-use. React StrictMode double-invokes effects
 * in development, and any remount would do the same in production, so calling
 * signinRedirectCallback() straight from an effect fails the second time with
 * "Code not valid" — and the user lands on an error page despite having signed
 * in successfully. Memoising the promise makes repeat calls harmless.
 */
let signinCompletion: Promise<User | null> | null = null;

/**
 * Where the user was heading before they were sent to sign in.
 *
 * Without this every sign-in lands on the dashboard, so a link to a specific
 * review or goal — the normal way people arrive from a notification email —
 * silently loses its destination whenever the session has expired. The path is
 * carried through the OIDC round trip in `state`, which the provider returns
 * untouched.
 */
export function signInAndReturnHere(): Promise<void> {
  const returnTo = window.location.pathname + window.location.search;
  return userManager.signinRedirect({
    state: { returnTo: returnTo === '/callback' ? '/' : returnTo },
  });
}

function restoredPath(user: User | null): string {
  const state = user?.state as { returnTo?: unknown } | undefined;
  const returnTo = state?.returnTo;
  // Only ever a same-origin path. An absolute URL arriving here would be an
  // open redirect, and `state` is round-tripped through a query string.
  return typeof returnTo === 'string' && returnTo.startsWith('/')
    && !returnTo.startsWith('//')
    ? returnTo
    : '/';
}

export function completeSigninIfCallback(): Promise<User | null> {
  if (window.location.pathname !== '/callback') return Promise.resolve(null);
  signinCompletion ??= userManager
    .signinRedirectCallback()
    .then((user) => {
      // Drop the code/state from the URL so a refresh cannot replay it, and
      // put the user back where they were going.
      window.history.replaceState({}, '', restoredPath(user));
      return user;
    })
    .catch(async (err) => {
      // A stale or replayed code is recoverable: if a valid session already
      // exists, use it rather than showing an error the user cannot act on.
      const existing = await currentUser();
      if (existing) {
        window.history.replaceState({}, '', '/');
        return existing;
      }
      throw err;
    });
  return signinCompletion;
}

const apiBase = import.meta.env.VITE_API_BASE_URL as string;

/** Server-sent validation detail, surfaced to the form that caused it. */
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
  /** Return raw text instead of JSON (used by the CSV export). */
  raw?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const user = await currentUser();
  if (!user) {
    await signInAndReturnHere();
    throw new ApiError(401, 'Redirecting to sign in');
  }

  const res = await fetch(`${apiBase}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${user.access_token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  if (res.status === 401) {
    // Token rejected despite looking valid locally -- clock skew, a revoked
    // session, or the employee record was unlinked. Re-authenticate rather
    // than showing a confusing empty state.
    await userManager.removeUser();
    await signInAndReturnHere();
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    // The API returns useful detail on 400 (e.g. which employees have weights
    // that do not sum to 100). Dropping it would turn an actionable message
    // into "Bad Request".
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
