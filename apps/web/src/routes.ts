/**
 * Where the signed-in application begins.
 *
 * THE SITE ROOT IS THE MARKETING PAGE, NOT THE APP.
 *
 * `/` is served by the web server as the public landing page (landing.html), so
 * the application's own home screen cannot also live there. It lives here, and
 * this is the only place that says where.
 *
 * Everything else about the app's URL space is deliberately unchanged: every
 * other route stays where it was, and so does `/callback`, the OIDC redirect URI
 * registered with Keycloak. Mounting the whole app under a prefix would have
 * moved `/callback` too, which means editing the live identity provider's client
 * configuration for a cosmetic reason.
 *
 * The landing page's "sign in" links point here, and landing.spec.ts fails if
 * they ever stop. Visiting this path signs you in: the app redirects to Keycloak
 * when there is no session, and returns you here afterwards.
 */
export const HOME_PATH = '/home';
