/**
 * Scored forms, through the real HTTP path.
 *
 * `form-scoring.spec.ts` proves the arithmetic; this proves it is actually
 * WIRED. The two failures are different: a rule that is right but never called
 * looks identical to one that works, and the form templates in this system are
 * written through the API, not by hand in SQL.
 *
 * So these go in over HTTP, as an HR administrator, and assert the refusal
 * reaches the caller as a 400 with a message they can act on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';
import { PEF_PARTS, formatTemplate } from '../src/reviews/client-templates';

let h: Harness;
let org: SeededOrg;
let asHrAdmin: Record<string, string>;

const section = (fields: unknown[]) => ({
  key: 'part1', title: 'Performance', fields,
});

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  asHrAdmin = { Authorization: `Bearer ${await h.token(org.hrAdmin.subject)}` };
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('publishing a scored form', () => {
  it('accepts a template whose columns both total the stated maximum', async () => {
    const res = await request(h.url).post('/form-templates').set(asHrAdmin).send({
      code: 'SCORED',
      name: 'Scored Review',
      schema: {
        scoring: { maxPoints: 100, classifications: ['technical', 'admin'] },
        sections: [section([
          { key: 'mastery', label: 'Mastery', type: 'rating',
            points: { technical: 70, admin: 60 } },
          { key: 'attendance', label: 'Attendance', type: 'rating',
            points: { technical: 30, admin: 40 } },
        ])],
      },
    });

    expect(res.status).toBe(201);
  });

  it('refuses one that does not add up, and says which column is wrong', async () => {
    const res = await request(h.url).post('/form-templates').set(asHrAdmin).send({
      code: 'BROKEN',
      name: 'Does Not Add Up',
      schema: {
        scoring: { maxPoints: 100, classifications: ['technical', 'admin'] },
        sections: [section([
          { key: 'mastery', label: 'Mastery', type: 'rating',
            points: { technical: 70, admin: 60 } },
          { key: 'attendance', label: 'Attendance', type: 'rating',
            points: { technical: 30, admin: 35 } },
        ])],
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/admin totals 95/);
  });

  it('leaves nothing behind when it refuses', async () => {
    // The validation runs inside the transaction, so a rejected template must
    // not exist. A half-created template with no usable version is worse than a
    // clean refusal, because the code is then taken.
    const rows = await h.admin.query(
      `SELECT id FROM form_template WHERE code = 'BROKEN'`);
    expect(rows.rows).toEqual([]);
  });

  it('still accepts an unscored form, which is every form built before this', async () => {
    const res = await request(h.url).post('/form-templates').set(asHrAdmin).send({
      code: 'PLAIN',
      name: 'Commentary Only',
      schema: {
        sections: [section([
          { key: 'comments', label: 'Comments', type: 'textarea', required: true },
        ])],
      },
    });

    expect(res.status).toBe(201);
  });

  it('refuses points on a field whose answer is stored elsewhere', async () => {
    // goal_review writes nothing to form_response, so points on it could never
    // be scored — and would fail silently rather than loudly.
    const res = await request(h.url).post('/form-templates').set(asHrAdmin).send({
      code: 'UNSCOREABLE',
      name: 'Points On Goals',
      schema: {
        scoring: { maxPoints: 100 },
        sections: [section([
          { key: 'goals', label: 'Goals', type: 'goal_review', points: 100 },
        ])],
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot carry points/);
  });
});


/**
 * A submitted review carries its own score, computed once.
 *
 * The claim being tested is not "the arithmetic is right" — the unit suite does
 * that in milliseconds. It is that the number is WRITTEN, and that nothing
 * afterwards moves it. A score that recomputes on read is a score that changes
 * when a rating scale is edited, months after the person was evaluated.
 */
describe('a submitted review keeps the score it was given', () => {
  let cycle: string;
  let instance: string;
  let scaleId: string;

  beforeAll(async () => {
    // A single-column scored form: no classification to resolve, which is still
    // an open question (R6), so this exercises the path that does not need one.
    const scale = await h.admin.query<{ id: string }>(
      `INSERT INTO rating_scale (org_id, code, version, name, published_at, is_active)
       VALUES ($1,'B2SCALE',1,'Five point',now(),TRUE) RETURNING id`, [org.orgId]);
    scaleId = scale.rows[0]!.id;
    for (const v of [1, 2, 3, 4, 5]) {
      await h.admin.query(
        `INSERT INTO rating_scale_point (rating_scale_id, sequence, value, label)
         VALUES ($1,$2,$3,$4)`, [scaleId, v, v, `Level ${v}`]);
    }

    const template = await h.admin.query<{ id: string }>(
      `INSERT INTO form_template (org_id, code, name) VALUES ($1,'B2','Scored')
       RETURNING id`, [org.orgId]);
    const schema = {
      scoring: { maxPoints: 100 },
      sections: [{
        key: 'part1',
        title: 'Performance',
        fields: [
          { key: 'mastery', label: 'Mastery', type: 'rating', required: false, points: 40 },
          { key: 'efficiency', label: 'Efficiency', type: 'rating', required: false, points: 60 },
        ],
      }],
    };
    const version = await h.admin.query<{ id: string }>(
      `INSERT INTO form_version (form_template_id, version, schema_json, rating_scale_id,
                                 published_at, is_active)
       VALUES ($1,1,$2::jsonb,$3,now(),TRUE) RETURNING id`,
      [template.rows[0]!.id, JSON.stringify(schema), scaleId]);

    const c = await h.admin.query<{ id: string }>(
      `INSERT INTO review_cycle (org_id, name, opens_on, closes_on, state)
       VALUES ($1,'B2 Cycle',CURRENT_DATE,CURRENT_DATE + 30,'open') RETURNING id`,
      [org.orgId]);
    cycle = c.rows[0]!.id;

    const ri = await h.admin.query<{ id: string }>(
      `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                    reviewer_employee_id, reviewer_role, form_version_id)
       VALUES ($1,$2,$2,'self',$3) RETURNING id`,
      [cycle, org.report.id, version.rows[0]!.id]);
    instance = ri.rows[0]!.id;
  }, 120_000);

  it('computes and stores the score when the review is submitted', async () => {
    const asReport = { Authorization: `Bearer ${await h.token(org.report.subject)}` };

    // 4/5 of 40 is 32; 5/5 of 60 is 60.
    const saved = await request(h.url).patch(`/reviews/${instance}`).set(asReport)
      .send({ responses: { mastery: 4, efficiency: 5 } });
    expect(saved.status).toBeLessThan(300);

    const res = await request(h.url).post(`/reviews/${instance}/submit`).set(asReport);
    expect(res.status).toBeLessThan(300);

    const row = await h.admin.query<{
      computed_score: string; computed_available: string; scored_scale_max: string;
      scored_at: string | null;
    }>(`SELECT computed_score, computed_available, scored_scale_max, scored_at
          FROM review_instance WHERE id = $1`, [instance]);

    expect(Number(row.rows[0]!.computed_score)).toBe(92);
    expect(Number(row.rows[0]!.computed_available)).toBe(100);
    // The scale is stored too, because it is what the ratings were read against.
    expect(Number(row.rows[0]!.scored_scale_max)).toBe(5);
    expect(row.rows[0]!.scored_at).not.toBeNull();
  });

  it('does not move when the rating scale is later changed', async () => {
    // The failure this design prevents. Extending the scale to 1-6 would make
    // every historical 4 worth less, silently, if the score were recomputed.
    await h.admin.query(
      `INSERT INTO rating_scale_point (rating_scale_id, sequence, value, label)
       VALUES ($1,6,6,'Level 6')`, [scaleId]);

    const row = await h.admin.query<{ computed_score: string; scored_scale_max: string }>(
      `SELECT computed_score, scored_scale_max FROM review_instance WHERE id = $1`,
      [instance]);

    expect(Number(row.rows[0]!.computed_score)).toBe(92);
    expect(Number(row.rows[0]!.scored_scale_max)).toBe(5);
  });

  it('refuses a score that exceeds what was available', async () => {
    // Defence in depth: the arithmetic cannot produce this, so the constraint is
    // there for whatever writes to the column next.
    await expect(
      h.admin.query(
        `UPDATE review_instance SET computed_score = 120 WHERE id = $1`, [instance]),
    ).rejects.toThrow(/review_instance_score_within_available/);
  });

  it('refuses a score with no record of what produced it', async () => {
    await expect(
      h.admin.query(
        `UPDATE review_instance
            SET computed_score = 50, computed_available = NULL,
                scored_scale_max = NULL, scored_at = NULL
          WHERE id = $1`, [instance]),
    ).rejects.toThrow(/review_instance_score_complete/);
  });
});

/**
 * The client's Performance Evaluation Form (Dec 2025), through the real path.
 *
 * Provisioning writes the form straight into the database, which bypasses the
 * validation every HR-authored form goes through. These publish it the way HR
 * would — over HTTP — so a template that provisioning would happily seed but the
 * API would refuse cannot go unnoticed. Then a real submission, to prove the
 * per-part results and the descriptors actually reach the people using them.
 */
describe('the Performance Evaluation Form, end to end', () => {
  let versionId: string;
  let instance: string;
  let asReport: Record<string, string>;

  const answerAll = (rating: number) => Object.fromEntries(
    PEF_PARTS.flatMap((p) => p.indicators).map((i) => [i.key, rating]));

  beforeAll(async () => {
    asReport = { Authorization: `Bearer ${await h.token(org.report.subject)}` };

    const scale = await h.admin.query<{ id: string }>(
      `INSERT INTO rating_scale (org_id, code, version, name, published_at, is_active)
       VALUES ($1,'PEFSCALE',1,'Five point',now(),TRUE) RETURNING id`, [org.orgId]);
    for (const v of [1, 2, 3, 4, 5]) {
      await h.admin.query(
        `INSERT INTO rating_scale_point (rating_scale_id, sequence, value, label)
         VALUES ($1,$2,$3,$4)`, [scale.rows[0]!.id, v, v, `Level ${v}`]);
    }

    const published = await request(h.url).post('/form-templates').set(asHrAdmin).send({
      code: 'PEF-SALES-E2E',
      name: 'Performance Evaluation — Sales',
      schema: formatTemplate('sales'),
      ratingScaleId: scale.rows[0]!.id,
    });
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    versionId = published.body.versionId;

    const cycle = await h.admin.query<{ id: string }>(
      `INSERT INTO review_cycle (org_id, name, opens_on, closes_on, state)
       VALUES ($1,'PEF cycle',CURRENT_DATE,CURRENT_DATE + 30,'open') RETURNING id`, [org.orgId]);
    const ri = await h.admin.query<{ id: string }>(
      `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                    reviewer_employee_id, reviewer_role, form_version_id)
       VALUES ($1,$2,$2,'self',$3) RETURNING id`,
      [cycle.rows[0]!.id, org.report.id, versionId]);
    instance = ri.rows[0]!.id;
  }, 120_000);

  it('is accepted by the API as published, unmodified', () => {
    // Asserted in beforeAll; named here so a failure reads as what it is.
    expect(versionId).toBeTruthy();
  });

  it('reaches the evaluator with every rating’s descriptor intact', async () => {
    const res = await request(h.url).get(`/reviews/${instance}`).set(asReport);
    expect(res.status).toBe(200);

    const fields = res.body.schema.sections.flatMap(
      (s: { fields: { key: string; anchors?: Record<string, string> }[] }) => s.fields);
    const output = fields.find((f: { key: string }) => f.key === 'output_performance');
    expect(output.anchors['5']).toBe('Always exceeds target');
    expect(output.anchors['1']).toBe('Does not meet target');
    expect(Object.keys(output.anchors)).toHaveLength(5);
  });

  it('refuses to submit with an indicator unrated', async () => {
    const res = await request(h.url).post(`/reviews/${instance}/submit`).set(asReport);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Output \/ Performance/);
  });

  it('scores each part and judges it against its own floor', async () => {
    // Part 1 rated all 2s (weak), Part 2 rated all 5s (perfect). The TOTAL is
    // 58 out of 100, which on its own says nothing about which part failed.
    const answers = answerAll(5);
    for (const i of PEF_PARTS[0]!.indicators) answers[i.key] = 2;

    await request(h.url).patch(`/reviews/${instance}`).set(asReport)
      .send({ responses: answers });
    const res = await request(h.url).post(`/reviews/${instance}/submit`).set(asReport);
    expect(res.status).toBeLessThan(300);

    expect(res.body.score).toBe(58);
    expect(res.body.available).toBe(100);
    expect(res.body.sections).toEqual([
      { key: 'part_1', earned: 28, available: 70, floor: 42, meetsFloor: false },
      { key: 'part_2', earned: 30, available: 30, floor: 18, meetsFloor: true },
    ]);

    const stored = await h.admin.query<{ computed_score: string }>(
      `SELECT computed_score FROM review_instance WHERE id = $1`, [instance]);
    expect(Number(stored.rows[0]!.computed_score)).toBe(58);
  });
});
