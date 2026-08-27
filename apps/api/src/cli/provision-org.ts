/**
 * Stands up a new tenant.
 *
 *   pnpm hr provision-org --org DEVCORE --name "Devcore Solutions Inc."
 *
 * This exists because each phase migration backfills its role grants and
 * notification templates into orgs that existed *at migration time* only. An
 * organisation created afterwards gets none of them and fails in ways that look
 * like bugs: reviewers cannot open competencies, notifications never render.
 * Provisioning is therefore a single place that calls every seeder, and every
 * future phase must add its seeder to SEEDERS below.
 *
 * Idempotent — safe to re-run after adding a phase.
 *
 * Departments are deliberately NOT created here: the employee importer derives
 * them from the staff file, and inventing codes up front guarantees a mismatch.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

/** Every per-org seeder, in dependency order. Add new phases to the end. */
const SEEDERS = [
  'app.seed_baseline_roles',
  'app.seed_phase1_grants',
  'app.seed_phase2_grants',
  'app.seed_phase3_grants',
  'app.seed_phase4_grants',
  'app.seed_reference_admin_grants',
  'app.seed_phase5_feedback_grants',
  'app.seed_phase5_notification_grants',
  'app.seed_phase6_grants',
  'app.seed_help_grants',
  // The line roles the client's access matrix names. Seeded unassigned:
  // defining a role must not confer it.
  'app.seed_line_role_grants',
  'app.seed_notification_templates',
] as const;

const EMPLOYMENT_TYPES: [string, string, boolean][] = [
  ['REG', 'Regular', true],
  ['PROB', 'Probationary', true],
  ['CONS', 'Consultant', false],
];

const SCALE_POINTS: [number, string][] = [
  [1, 'Does not meet'], [2, 'Partially meets'], [3, 'Meets'],
  [4, 'Exceeds'], [5, 'Outstanding'],
];

/**
 * A minimal but complete review form. HR can replace it in the form builder;
 * its purpose is that a freshly provisioned org can run a cycle on day one
 * rather than dead-ending at "no form assigned".
 */
const STARTER_FORM = {
  sections: [
    {
      key: 'goals',
      title: 'Goal performance',
      description: 'Goal results for the period are shown above this form.',
      fields: [
        {
          key: 'goal_commentary', label: 'Commentary on goal results',
          type: 'textarea', required: true,
          helpText: 'What drove the results, in one paragraph.',
        },
      ],
    },
    {
      key: 'overall',
      title: 'Overall assessment',
      fields: [
        { key: 'overall', label: 'Overall rating', type: 'rating', required: true },
        { key: 'strengths', label: 'Strengths', type: 'textarea', required: true },
        {
          key: 'development', label: 'Development areas',
          type: 'textarea', required: false,
        },
        {
          key: 'promotion_ready', label: 'Ready for promotion within 12 months',
          type: 'boolean', required: false,
        },
      ],
    },
  ],
};

export async function provisionOrg(
  code: string, name: string, timezone: string,
): Promise<void> {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL must be set');

  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);

  try {
    const existing = await c.query(`SELECT 1 FROM organization WHERE code = $1`, [code]);
    const isNew = existing.rowCount === 0;

    const org = (await c.query<{ id: string }>(
      `INSERT INTO organization (code, name, timezone) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name,
                                        timezone = EXCLUDED.timezone
         RETURNING id`, [code, name, timezone])).rows[0]!.id;
    console.log(`${isNew ? 'Created' : 'Updated'} organisation ${code} — ${name}`);

    // Seeders are all idempotent, so re-running picks up phases added since the
    // org was first provisioned.
    for (const fn of SEEDERS) {
      await c.query(`SELECT ${fn}($1)`, [org]);
    }
    console.log(`  roles, grants and notification templates: ${SEEDERS.length} seeders applied`);

    for (const [tc, tn, eligible] of EMPLOYMENT_TYPES) {
      await c.query(
        `INSERT INTO employment_type (org_id, code, name, is_eligible_for_review)
              VALUES ($1,$2,$3,$4)
         ON CONFLICT (org_id, code) DO NOTHING`, [org, tc, tn, eligible]);
    }
    console.log(`  employment types: ${EMPLOYMENT_TYPES.map((t) => t[0]).join(', ')}`);

    const scale = (await c.query<{ id: string }>(
      `INSERT INTO rating_scale (org_id, code, version, name, published_at)
            VALUES ($1,'STD',1,'Standard 1–5',now())
       ON CONFLICT (org_id, code, version) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [org])).rows[0]!.id;
    for (const [i, [value, label]] of SCALE_POINTS.entries()) {
      await c.query(
        `INSERT INTO rating_scale_point (rating_scale_id, sequence, value, label)
              VALUES ($1,$2,$3,$4)
         ON CONFLICT (rating_scale_id, sequence) DO NOTHING`,
        [scale, i + 1, value, label]);
    }
    console.log(`  rating scale: STD v1, ${SCALE_POINTS.length} points`);

    const template = (await c.query<{ id: string }>(
      `INSERT INTO form_template (org_id, code, name, description)
            VALUES ($1,'STD','Standard Review','Starter annual review form')
       ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [org])).rows[0]!.id;

    const hasVersion = await c.query(
      `SELECT 1 FROM form_version WHERE form_template_id = $1`, [template]);
    if (hasVersion.rowCount === 0) {
      await c.query(
        `INSERT INTO form_version (form_template_id, version, schema_json,
                                   rating_scale_id, published_at, is_active)
              VALUES ($1,1,$2::jsonb,$3,now(),TRUE)`,
        [template, JSON.stringify(STARTER_FORM), scale]);
    }

    // The org-wide default: the row with no employment type and no role. Without
    // it resolve_form_version() returns NULL and every review is skipped.
    await c.query(
      `INSERT INTO form_template_assignment (org_id, form_template_id)
            SELECT $1,$2
             WHERE NOT EXISTS (
                   SELECT 1 FROM form_template_assignment
                    WHERE org_id=$1 AND employment_type_id IS NULL
                      AND app_role_id IS NULL)`, [org, template]);
    console.log(`  review form: STD v1, assigned as the organisation default`);

    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await c.end();
  }

  console.log(`\nNext:`);
  console.log(`  1. pnpm hr import-201 --org ${code} --file ./staff.csv --dry-run`);
  console.log(`  2. pnpm hr import-201 --org ${code} --file ./staff.csv`);
  console.log(`  3. pnpm hr grant-admin --org ${code} --employee-no <HR lead>`);
  console.log(`  4. pnpm hr preflight --org ${code}`);
}
