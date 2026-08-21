/**
 * The AuthGuard, exercised over real HTTP with real RS256 tokens.
 *
 * This is the outermost security boundary: everything behind it trusts that the
 * subject on the request is who the token says. Until now it had no tests at
 * all — a guard that accepted an unsigned token, or one issued by a different
 * realm, would have passed every suite in this project.
 *
 * Each rejection below is a real attack shape, not a hypothetical:
 *   wrong signature  — a forged token
 *   wrong issuer     — a token from another Keycloak realm or another tenant
 *   wrong audience   — a token minted for a different client entirely
 *   expired          — a replayed token
 *   no subject       — the Keycloak `basic`-scope misconfiguration we hit in dev
 *   unknown subject  — a valid token for someone with no employee record
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
}, 300_000);

afterAll(async () => { await h?.stop(); });

const ROUTE = '/employees/me';

describe('a valid token is accepted', () => {
  it('resolves the token subject to the right employee', async () => {
    const res = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${await h.token(org.report.subject)}`);

    expect(res.status).toBe(200);
    expect(res.body.employeeNo).toBe('E003');
  });

  it('resolves a different subject to a different employee', async () => {
    const res = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${await h.token(org.manager.subject)}`);

    expect(res.status).toBe(200);
    expect(res.body.employeeNo).toBe('E002');
  });
});

describe('missing or malformed credentials are rejected', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(h.url).get(ROUTE);
    expect(res.status).toBe(401);
  });

  it.each([
    ['no scheme', 'abc.def.ghi'],
    ['wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['lowercase bearer', 'bearer abc.def.ghi'],
    ['empty bearer', 'Bearer '],
    ['not a jwt', 'Bearer not-a-token'],
  ])('rejects %s', async (_label, header) => {
    const res = await request(h.url).get(ROUTE).set('Authorization', header);
    expect(res.status).toBe(401);
  });
});

describe('token claims are verified', () => {
  it('rejects a token signed with the wrong key', async () => {
    const forged = await h.token(org.report.subject, { wrongKey: true });
    const res = await request(h.url).get(ROUTE).set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token from another issuer', async () => {
    const other = await h.token(org.report.subject, {
      issuer: 'https://evil.test/auth/realms/hr',
    });
    const res = await request(h.url).get(ROUTE).set('Authorization', `Bearer ${other}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token minted for a different audience', async () => {
    const other = await h.token(org.report.subject, { audience: 'some-other-client' });
    const res = await request(h.url).get(ROUTE).set('Authorization', `Bearer ${other}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    // Beyond OIDC_CLOCK_TOLERANCE (30s), so this is a real expiry rather than
    // a test that happens to pass inside the skew window.
    const stale = await h.token(org.report.subject, { expiresIn: '-5m' });
    const res = await request(h.url).get(ROUTE).set('Authorization', `Bearer ${stale}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token that is not yet valid', async () => {
    const future = await h.token(org.report.subject, { notBefore: '10m' });
    const res = await request(h.url).get(ROUTE).set('Authorization', `Bearer ${future}`);
    expect(res.status).toBe(401);
  });
});

describe('subject resolution', () => {
  it('rejects a token with no subject claim', async () => {
    // Exactly the Keycloak failure we hit in development: overriding
    // defaultClientScopes drops `basic`, which since KC 24 carries `sub`.
    const res = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${await h.token('', { noSubject: true })}`);
    expect(res.status).toBe(401);
  });

  it('rejects a valid token whose subject matches no employee', async () => {
    const res = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${await h.token(randomUUID())}`);
    expect(res.status).toBe(401);
  });

  it('distinguishes "not linked" from "bad token" only for genuine tokens', async () => {
    // These two 401s carry deliberately different messages, and that is correct
    // rather than an enumeration oracle: the distinct message is reachable only
    // with a validly-signed token from the trusted realm. Its recipient is
    // therefore an authenticated directory user learning that their OWN account
    // is not linked — which is actionable ("ask HR to add you"). Probing for
    // somebody else would require the realm's signing key.
    //
    // The property worth locking down is that the informative message never
    // escapes to an unauthenticated caller.
    const unlinked = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${await h.token(randomUUID())}`);
    const forged = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${await h.token(org.report.subject, { wrongKey: true })}`);

    expect(unlinked.status).toBe(401);
    expect(forged.status).toBe(401);
    expect(unlinked.body.message).toMatch(/no employee record/i);

    // An unverifiable token must never reveal anything about linkage.
    expect(forged.body.message).not.toMatch(/employee/i);
  });
});

describe('identity does not leak between requests', () => {
  it('serves concurrent requests from different subjects correctly', async () => {
    // DbService sets identity with SET LOCAL inside a transaction. If it ever
    // regressed to a session-scoped SET, pooled connections would hand one
    // user's identity to the next request — the failure D-003 exists to prevent.
    // Interleaved concurrent requests are the condition that exposes it.
    const people = [org.report, org.manager, org.hrAdmin, org.outsider, org.ceo];
    const tokens = await Promise.all(people.map((p) => h.token(p.subject)));

    for (let round = 0; round < 4; round++) {
      const results = await Promise.all(
        tokens.map((t) => request(h.url).get(ROUTE).set('Authorization', `Bearer ${t}`)),
      );
      results.forEach((res, i) => {
        expect(res.status).toBe(200);
        expect(res.body.employeeNo).toBe(people[i]!.employeeNo);
      });
    }
  });
});

describe('transport concerns', () => {
  it('echoes the request id so a user report can be traced to a log line', async () => {
    const id = randomUUID();
    const res = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${await h.token(org.report.subject)}`)
      .set('x-request-id', id);

    expect(res.headers['x-request-id']).toBe(id);
  });

  it('generates a request id when the client does not supply one', async () => {
    const res = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${await h.token(org.report.subject)}`);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets the security headers helmet is there to provide', async () => {
    const res = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${await h.token(org.report.subject)}`);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves the API under the /api prefix only', async () => {
    const token = await h.token(org.report.subject);
    const prefixed = await request(h.url).get(ROUTE)
      .set('Authorization', `Bearer ${token}`);
    // h.url already ends in /api, so strip it to prove the bare path 404s.
    const bare = await request(h.url.replace(/\/api$/, '')).get(ROUTE)
      .set('Authorization', `Bearer ${token}`);

    expect(prefixed.status).toBe(200);
    expect(bare.status).toBe(404);
  });
});
