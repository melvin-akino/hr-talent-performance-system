/**
 * HR-authored help content.
 *
 * Two properties are the point of this table, and both are enforced by the
 * database rather than by the service:
 *
 *   only HR can write it, while everyone in the tenant can read it;
 *   no tenant can see or touch another tenant's articles.
 *
 * The second is required by [D-008](docs/decisions.md) for any table carrying
 * `org_id`, and is also covered in tenancy.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
const tokens: Record<string, string> = {};

const article = (over: Record<string, unknown> = {}) => ({
  slug: `policy-${randomUUID().slice(0, 8)}`,
  title: 'Our review timetable',
  summary: 'When the cycle opens and closes at this company.',
  section: 'reviews',
  audience: ['everyone'],
  routes: ['/reviews'],
  keywords: ['timetable', 'deadline'],
  body: 'Self-reviews are due by **30 November**.',
  ...over,
});

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  for (const [name, person] of Object.entries({
    report: org.report, manager: org.manager, hrAdmin: org.hrAdmin,
  })) {
    tokens[name] = await h.token(person.subject);
  }
}, 300_000);

afterAll(async () => { await h?.stop(); });

const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

describe('who may author help', () => {
  it('lets an HR admin create an article', async () => {
    const res = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ title: 'Our review timetable' }));
    expect(res.status).toBeLessThan(300);
    expect(res.body.title).toBe('Our review timetable');
    // Created as a draft unless publishing is asked for.
    expect(res.body.publishedAt).toBeNull();
  });

  it('refuses a plain employee', async () => {
    const res = await request(h.url).post('/help-articles').set(as('report'))
      .send(article());
    expect([401, 403, 404]).toContain(res.status);
  });

  it('refuses a manager', async () => {
    // Managing a team does not include writing company policy.
    const res = await request(h.url).post('/help-articles').set(as('manager'))
      .send(article());
    expect([401, 403, 404]).toContain(res.status);
  });
});

describe('what everyone can read', () => {
  let id: string;

  beforeAll(async () => {
    const created = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ title: 'Published policy', published: true }));
    id = created.body.id;
  });

  it('shows a published article to a plain employee', async () => {
    const res = await request(h.url).get('/help-articles').set(as('report'));
    expect(res.status).toBe(200);
    expect(res.body.map((a: { title: string }) => a.title)).toContain('Published policy');
  });

  it('hides drafts from the drawer feed', async () => {
    await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ title: 'Half-written thought' }));

    const res = await request(h.url).get('/help-articles').set(as('report'));
    // HR writes policy over several sittings; an unfinished sentence must not be
    // published to the company in the meantime.
    expect(res.body.map((a: { title: string }) => a.title))
      .not.toContain('Half-written thought');
  });

  it('publishing is explicit, and omitting the flag does not publish', async () => {
    const draft = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ title: 'Stays a draft' }));

    await request(h.url).patch(`/help-articles/${draft.body.id}`).set(as('hrAdmin'))
      .send({ body: 'Edited while still a draft.' });

    const after = await request(h.url).get('/help-articles/all').set(as('hrAdmin'));
    const row = after.body.find((a: { id: string }) => a.id === draft.body.id);
    expect(row.publishedAt).toBeNull();
  });

  it('can be unpublished again', async () => {
    await request(h.url).patch(`/help-articles/${id}`).set(as('hrAdmin'))
      .send({ published: false });

    const res = await request(h.url).get('/help-articles').set(as('report'));
    expect(res.body.map((a: { id: string }) => a.id)).not.toContain(id);

    // Put it back for the tests below.
    await request(h.url).patch(`/help-articles/${id}`).set(as('hrAdmin'))
      .send({ published: true });
  });

  it('does not let an employee edit or delete one', async () => {
    const patch = await request(h.url).patch(`/help-articles/${id}`).set(as('report'))
      .send({ title: 'Rewritten by an employee' });
    expect([401, 403, 404]).toContain(patch.status);

    const del = await request(h.url).delete(`/help-articles/${id}`).set(as('report'));
    expect([401, 403, 404]).toContain(del.status);

    const still = await request(h.url).get('/help-articles').set(as('report'));
    expect(still.body.map((a: { id: string }) => a.title)).toContain('Published policy');
  });
});

describe('validation', () => {
  it('rejects a slug that is not url-safe', async () => {
    const res = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ slug: 'Not A Slug' }));
    expect(res.status).toBe(400);
  });

  it('rejects an unknown section', async () => {
    const res = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ section: 'miscellaneous' }));
    expect(res.status).toBe(400);
  });

  it('rejects an unknown audience', async () => {
    const res = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ audience: ['wizard'] }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty audience, which would address nobody', async () => {
    const res = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ audience: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects a route that does not start with a slash', async () => {
    // Routes are matched as prefixes; anything else silently never matches.
    const res = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ routes: ['reviews'] }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty body', async () => {
    const res = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ body: '   ' }));
    expect(res.status).toBe(400);
  });

  it('refuses two articles with the same slug in one organisation', async () => {
    const slug = `dup-${randomUUID().slice(0, 8)}`;
    const first = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ slug }));
    expect(first.status).toBeLessThan(300);

    const second = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ slug }));
    expect(second.status).toBeGreaterThanOrEqual(400);
  });
});

describe('markup in the body is never executed', () => {
  it('stores HTML as text, because the renderer cannot emit it', async () => {
    // The frontend renderer returns React elements, so anything HTML-shaped in
    // an article is displayed literally. This test records that the API does not
    // need to sanitise, and why.
    const res = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ body: '<img src=x onerror=alert(1)>', published: true }));
    expect(res.status).toBeLessThan(300);
    expect(res.body.body).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('tenant isolation', () => {
  it('does not show another organisation its neighbour’s articles', async () => {
    const other = await seedOrg(h.admin, 'OTHERCO');
    const otherToken = await h.token(other.hrAdmin.subject);

    await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ title: 'Acme only', published: true }));

    const res = await request(h.url).get('/help-articles')
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(res.status).toBe(200);
    expect(res.body.map((a: { title: string }) => a.title)).not.toContain('Acme only');
  });

  it('does not let one tenant edit another’s article', async () => {
    const created = await request(h.url).post('/help-articles').set(as('hrAdmin'))
      .send(article({ title: 'Acme private', published: true }));

    const other = await seedOrg(h.admin, 'THIRDCO');
    const otherToken = await h.token(other.hrAdmin.subject);

    const res = await request(h.url).patch(`/help-articles/${created.body.id}`)
      .set({ Authorization: `Bearer ${otherToken}` })
      .send({ title: 'Hijacked' });
    expect([401, 403, 404]).toContain(res.status);

    const check = await request(h.url).get('/help-articles').set(as('hrAdmin'));
    expect(check.body.map((a: { title: string }) => a.title)).toContain('Acme private');
  });
});
