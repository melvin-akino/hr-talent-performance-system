/**
 * Demo data for local UI testing.
 *
 * Creates the reference data the CSV importer expects, imports the example
 * staff file, assigns roles, then builds enough goal/review scaffolding that
 * every screen has something to show. Idempotent: safe to re-run.
 *
 * Employee work emails match the Keycloak users in ops/keycloak/realm-hr.json,
 * which is what lets first login bind an IdP subject to an employee record.
 *
 * DEV ONLY. Never point this at a real database — and since "never" is not a
 * mechanism, see assertSafeTarget below for the one that is.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';
import { DbService } from '../db/db.service';
import { EmployeeImportService } from '../import/employee-import.service';

const CSV = join(__dirname, '../../../../db/seeds/employees.example.csv');

/**
 * The eight employees in db/seeds/employees.example.csv. An organisation that
 * holds only these was created by this command; one holding anybody else was
 * not, and is therefore somebody's real data.
 */
const DEMO_EMPLOYEE_NOS = ['00001', '00002', '00003', '00004', '00005',
                           '00006', '00007', '00008'];

export class UnsafeSeedTargetError extends Error {}

/**
 * Refuses to write demo data into a database that holds real people.
 *
 * The accident this prevents is a single mistyped shell — ADMIN_DATABASE_URL
 * still pointing at a customer from an earlier command, and `hr seed-demo` run
 * out of habit. Nothing about the command's own arguments distinguishes that
 * from a local run, so the target is what gets inspected:
 *
 *   - NODE_ENV=production is refused outright. That variable is set on the api
 *     service in docker-compose.yml, so it holds on every deployed install.
 *   - An organisation containing employees this command did not create is
 *     refused, overridable with --yes-i-mean-it for the one legitimate case:
 *     topping up a dev database that has been hand-edited.
 *
 * Read-only, and runs before the first write.
 */
/**
 * The half of the guard that every demo-data command shares.
 *
 * Kept separate because the rest of `assertSafeTarget` — refusing an org whose
 * employees this command did not create — is specific to seed-demo, which brings
 * its own people. `seed-activity` targets orgs whose staff are real imports by
 * definition, so it needs this check and its own second one.
 */
export function assertNotProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new UnsafeSeedTargetError(
      'Refusing to seed demo data: NODE_ENV=production.\n' +
      '  This command creates accounts whose password is committed to the ' +
      'repository.\n' +
      '  There is no override. If this really is a development database, unset ' +
      'NODE_ENV.');
  }
}

export async function assertSafeTarget(
  c: Client, orgCode: string, opts: { confirmed?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  assertNotProduction(env);

  const existing = await c.query<{ total: string; not_ours: string }>(
    `SELECT count(*)::int::text AS total,
            count(*) FILTER (WHERE e.employee_no <> ALL($2::text[]))::int::text
              AS not_ours
       FROM employee e
       JOIN organization o ON o.id = e.org_id
      WHERE o.code = $1 AND e.deleted_at IS NULL`,
    [orgCode, DEMO_EMPLOYEE_NOS]);

  const total = Number(existing.rows[0]?.total ?? 0);
  const notOurs = Number(existing.rows[0]?.not_ours ?? 0);
  if (notOurs === 0) return;                      // empty, or our own fixtures
  if (opts.confirmed) {
    console.warn(`  WARNING: '${orgCode}' holds ${total} employee(s), ` +
                 `${notOurs} of whom this command did not create. ` +
                 `Proceeding because --yes-i-mean-it was given.`);
    return;
  }

  throw new UnsafeSeedTargetError(
    `Refusing to seed demo data into '${orgCode}': it holds ${total} employee(s), ` +
    `${notOurs} of whom this command did not create.\n` +
    '  That means this is not a database seed-demo built — check ' +
    'ADMIN_DATABASE_URL points where you think it does.\n' +
    '  If you are certain, re-run with --yes-i-mean-it.');
}

export async function seedDemo(
  orgCode = 'ACME', opts: { confirmed?: boolean } = {},
): Promise<void> {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL must be set');

  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await assertSafeTarget(c, orgCode, opts);
  } catch (err) {
    await c.end();
    throw err;
  }
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);

  try {
    // --- reference data ---------------------------------------------------
    const org = (await c.query<{ id: string }>(
      `INSERT INTO organization (code, name, timezone)
            VALUES ($1, 'Acme Corporation', 'Asia/Manila')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [orgCode])).rows[0]!.id;

    for (const [code, name] of [
      ['EXEC', 'Executive'], ['ENG', 'Engineering'],
      ['SALES', 'Sales'], ['HR', 'Human Resources'],
    ]) {
      await c.query(
        `INSERT INTO department (org_id, code, name, effective_from)
              VALUES ($1, $2, $3, '2018-01-01')
         ON CONFLICT (org_id, code, effective_from) DO NOTHING`, [org, code, name]);
    }

    for (const [code, name, eligible] of [
      ['REG', 'Regular', true], ['PROB', 'Probationary', true],
      ['CONS', 'Consultant', false],
    ] as const) {
      await c.query(
        `INSERT INTO employment_type (org_id, code, name, is_eligible_for_review)
              VALUES ($1,$2,$3,$4)
         ON CONFLICT (org_id, code) DO NOTHING`, [org, code, name, eligible]);
    }

    await c.query('SELECT app.seed_baseline_roles($1)', [org]);
    await c.query('SELECT app.seed_phase1_grants($1)', [org]);
    await c.query('SELECT app.seed_phase2_grants($1)', [org]);
    await c.query('SELECT app.seed_phase3_grants($1)', [org]);
    await c.query('COMMIT');

    // --- employees (via the real importer, so it exercises that path) ------
    const db = new DbService();
    const importer = new EmployeeImportService(db);
    const report = await importer.import(readFileSync(CSV, 'utf8'), orgCode);
    await db.onModuleDestroy();
    if (report.errors.length > 0) {
      throw new Error(`Employee import failed: ${JSON.stringify(report.errors, null, 2)}`);
    }
    console.log(`  employees: ${report.created} created, ${report.updated} updated`);

    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);

    // --- roles ------------------------------------------------------------
    const role = async (code: string) => (await c.query<{ id: string }>(
      `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, code])).rows[0]!.id;
    const empId = async (no: string) => (await c.query<{ id: string }>(
      `SELECT id FROM employee WHERE org_id=$1 AND employee_no=$2`, [org, no])).rows[0]!.id;
    const deptId = async (code: string) => (await c.query<{ id: string }>(
      `SELECT id FROM department WHERE org_id=$1 AND code=$2`, [org, code])).rows[0]!.id;

    const assign = async (no: string, roleCode: string, scopeDept?: string) => {
      const e = await empId(no);
      const r = await role(roleCode);
      await c.query(
        `INSERT INTO role_assignment (org_id, employee_id, role_id, scope_department_id,
                                      effective_from)
              SELECT $1,$2,$3,$4,'2018-01-01'
               WHERE NOT EXISTS (
                     SELECT 1 FROM role_assignment
                      WHERE employee_id=$2 AND role_id=$3
                        AND (effective_to IS NULL OR effective_to > CURRENT_DATE))`,
        [org, e, r, scopeDept ? await deptId(scopeDept) : null]);
    };

    for (const no of ['00001','00002','00003','00004','00005','00006','00007','00008']) {
      await assign(no, 'employee');
    }
    await assign('00001', 'hr_admin');            // Maria — CEO, org-wide admin
    await assign('00001', 'manager');
    await assign('00002', 'manager');             // Jose — Engineering Director
    await assign('00003', 'manager');             // Ana — Engineering Manager
    await assign('00006', 'manager');             // Miguel — Sales Director
    await assign('00008', 'hr_partner', 'ENG');   // Ramon — HR BP, scoped to ENG

    // --- goal period, KPI library, goals ----------------------------------
    const period = (await c.query<{ id: string }>(
      `INSERT INTO goal_period (org_id, name, period_type, starts_on, ends_on,
                                state, checkin_cadence)
            VALUES ($1,'FY2026','annual','2026-01-01','2026-12-31','open','monthly')
       ON CONFLICT (org_id, name) DO UPDATE SET state = EXCLUDED.state
         RETURNING id`, [org])).rows[0]!.id;

    const kpis: [string, string, string, string, string][] = [
      ['REV', 'Revenue growth', 'financial', 'currency', 'higher_is_better'],
      ['COST', 'Cost per unit', 'financial', 'currency', 'lower_is_better'],
      ['DEFECT', 'Escaped defects', 'process', 'numeric', 'lower_is_better'],
      ['CSAT', 'Customer satisfaction', 'customer', 'percentage', 'higher_is_better'],
    ];
    for (const [code, name, category, measure, direction] of kpis) {
      await c.query(
        `INSERT INTO kpi_definition (org_id, code, version, name, category,
                                     measure_type, direction, published_at)
              VALUES ($1,$2,1,$3,$4,$5::kpi_measure_type,$6::kpi_direction,now())
         ON CONFLICT (org_id, code, version) DO NOTHING`,
        [org, code, name, category, measure, direction]);
    }

    const ana = await empId('00003');
    const paolo = await empId('00004');
    const grace = await empId('00005');

    /** Goal + one measure + optional check-in history. */
    const goal = async (
      employee: string, title: string, weight: number,
      target: number, actual: number | null, direction: string,
      baseline: number | null, checkins: string[],
    ) => {
      const existing = await c.query<{ id: string }>(
        `SELECT id FROM goal WHERE employee_id=$1 AND goal_period_id=$2 AND title=$3`,
        [employee, period, title]);
      if (existing.rows[0]) return existing.rows[0].id;

      const g = (await c.query<{ id: string }>(
        `INSERT INTO goal (org_id, goal_period_id, employee_id, title, weight, state,
                           approved_by, approved_at, due_on)
              VALUES ($1,$2,$3,$4,$5,'active',$6,now(),'2026-12-31') RETURNING id`,
        [org, period, employee, title, weight, ana])).rows[0]!.id;

      await c.query(
        `INSERT INTO goal_target (goal_id, measure_name, measure_type, direction,
                                  baseline_value, target_value, actual_value, actual_as_of)
              VALUES ($1,$2,'numeric',$3::kpi_direction,$4,$5,$6,CURRENT_DATE)`,
        [g, title, direction, baseline, target, actual]);

      let month = 1;
      for (const status of checkins) {
        await c.query(
          `INSERT INTO goal_checkin (goal_id, checked_in_by, status_flag, period_ending,
                                     comment, created_by)
                VALUES ($1,$2,$3::checkin_status,
                        (DATE '2026-01-31' + ($4::int * INTERVAL '1 month'))::date,
                        $5,$2)`,
          [g, employee, status, month,
           `Month ${month + 1} update — ${status.replace(/_/g, ' ')}`]);
        month++;
      }
      return g;
    };

    // Paolo: balanced 60/40, one healthy goal and one trending badly (two
    // consecutive bad check-ins, so the escalation screen has a row).
    await goal(paolo, 'Ship payments integration', 60, 100, 80,
               'higher_is_better', 0, ['on_track', 'on_track', 'at_risk']);
    await goal(paolo, 'Reduce escaped defects', 40, 5, 8,
               'lower_is_better', 12, ['at_risk', 'off_track']);

    // Grace: weights total 80, so the HR weight gate has something to flag.
    await goal(grace, 'Improve test coverage', 50, 85, 72,
               'higher_is_better', 60, ['on_track']);
    await goal(grace, 'Cut build time', 30, 4, 3,
               'lower_is_better', 9, []);   // never checked in -> overdue

    // --- rating scale, form template, review cycle ------------------------
    const scale = (await c.query<{ id: string }>(
      `INSERT INTO rating_scale (org_id, code, version, name, published_at)
            VALUES ($1,'STD',1,'Standard 1–5',now())
       ON CONFLICT (org_id, code, version) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [org])).rows[0]!.id;

    const points: [number, string][] = [
      [1, 'Does not meet'], [2, 'Partially meets'], [3, 'Meets'],
      [4, 'Exceeds'], [5, 'Outstanding'],
    ];
    for (const [i, [value, label]] of points.entries()) {
      await c.query(
        `INSERT INTO rating_scale_point (rating_scale_id, sequence, value, label)
              VALUES ($1,$2,$3,$4)
         ON CONFLICT (rating_scale_id, sequence) DO NOTHING`,
        [scale, i + 1, value, label]);
    }

    const template = (await c.query<{ id: string }>(
      `INSERT INTO form_template (org_id, code, name, description)
            VALUES ($1,'STD','Standard Review','Default annual review form')
       ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [org])).rows[0]!.id;

    const schema = {
      sections: [
        {
          key: 'goals', title: 'Goal performance',
          description: 'Goal results for the period are shown above this form.',
          fields: [
            { key: 'goal_commentary', label: 'Commentary on goal results',
              type: 'textarea', required: true,
              helpText: 'What drove the results, in one paragraph.' },
          ],
        },
        {
          key: 'overall', title: 'Overall assessment',
          fields: [
            { key: 'overall', label: 'Overall rating', type: 'rating', required: true },
            { key: 'strengths', label: 'Strengths', type: 'textarea', required: true },
            { key: 'development', label: 'Development areas', type: 'textarea',
              required: false },
            { key: 'promotion_ready', label: 'Ready for promotion within 12 months',
              type: 'boolean', required: false },
          ],
        },
      ],
    };

    const hasVersion = await c.query(
      `SELECT 1 FROM form_version WHERE form_template_id=$1`, [template]);
    if (hasVersion.rowCount === 0) {
      await c.query(
        `INSERT INTO form_version (form_template_id, version, schema_json,
                                   rating_scale_id, published_at, is_active)
              VALUES ($1,1,$2::jsonb,$3,now(),TRUE)`,
        [template, JSON.stringify(schema), scale]);
    }

    await c.query(
      `INSERT INTO form_template_assignment (org_id, form_template_id)
            SELECT $1,$2
             WHERE NOT EXISTS (
                   SELECT 1 FROM form_template_assignment
                    WHERE org_id=$1 AND employment_type_id IS NULL
                      AND app_role_id IS NULL)`, [org, template]);

    const cycle = (await c.query<{ id: string }>(
      `INSERT INTO review_cycle (org_id, goal_period_id, name, opens_on, closes_on, state)
            VALUES ($1,$2,'FY2026 Annual Review','2026-11-01','2026-12-15','open')
       ON CONFLICT (org_id, name) DO UPDATE SET state = EXCLUDED.state
         RETURNING id`, [org, period])).rows[0]!.id;

    for (const [i, phase] of ['self', 'supervisor', 'calibration', 'signoff'].entries()) {
      await c.query(
        `INSERT INTO review_cycle_phase (review_cycle_id, phase_type, sequence,
                                         opens_on, closes_on)
              VALUES ($1,$2::review_phase_type,$3,'2026-11-01','2026-12-15')
         ON CONFLICT (review_cycle_id, phase_type) DO NOTHING`, [cycle, phase, i + 1]);
    }

    // Generate review instances directly (the API route needs a logged-in HR
    // user; this is the same logic run as the operator).
    const subjects = await c.query<{ id: string; sup: string | null }>(
      `SELECT e.id, rl.supervisor_employee_id AS sup
         FROM employee e
         JOIN employment em ON em.employee_id=e.id AND em.effective_to IS NULL
         JOIN employment_type et ON et.id=em.employment_type_id
                                AND et.is_eligible_for_review
         LEFT JOIN reporting_line rl ON rl.employee_id=e.id AND rl.effective_to IS NULL
        WHERE e.org_id=$1 AND e.deleted_at IS NULL`, [org]);

    let instances = 0;
    for (const s of subjects.rows) {
      const fv = (await c.query<{ id: string | null }>(
        'SELECT app.resolve_form_version($1) AS id', [s.id])).rows[0]!.id;
      if (!fv) continue;
      await c.query(
        `INSERT INTO review_summary (review_cycle_id, subject_employee_id)
              VALUES ($1,$2) ON CONFLICT DO NOTHING`, [cycle, s.id]);
      const self = await c.query(
        `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                      reviewer_employee_id, reviewer_role, form_version_id)
              VALUES ($1,$2,$2,'self',$3) ON CONFLICT DO NOTHING RETURNING id`,
        [cycle, s.id, fv]);
      instances += self.rowCount ?? 0;
      if (s.sup) {
        const sup = await c.query(
          `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                        reviewer_employee_id, reviewer_role, form_version_id)
                VALUES ($1,$2,$3,'supervisor',$4) ON CONFLICT DO NOTHING RETURNING id`,
          [cycle, s.id, s.sup, fv]);
        instances += sup.rowCount ?? 0;
      }
    }

    // --- competency framework, mapping, assessments -----------------------
    const framework = (await c.query<{ id: string }>(
      `INSERT INTO competency_framework (org_id, code, version, name, description)
            VALUES ($1,'CORE',1,'Core Competency Framework',
                    'Behavioural framework for all engineering roles')
       ON CONFLICT (org_id, code, version) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [org])).rows[0]!.id;

    const alreadyBuilt = await c.query(
      `SELECT 1 FROM competency WHERE framework_id = $1 LIMIT 1`, [framework]);

    if (alreadyBuilt.rowCount === 0) {
      const competencies: [string, string, string, string[]][] = [
        ['JUDG', 'Technical judgement', 'technical', [
          'Follows established patterns with guidance',
          'Makes sound choices within a component',
          'Weighs trade-offs across a system',
          'Sets technical direction for a team',
          'Shapes direction across the organisation']],
        ['COMM', 'Communication', 'core', [
          'Communicates clearly within the team',
          'Explains work to non-technical colleagues',
          'Writes documents others rely on',
          'Aligns multiple teams',
          'Represents the organisation externally']],
        ['OWN', 'Ownership', 'core', [
          'Completes assigned tasks',
          'Owns a feature end to end',
          'Owns an area including its failures',
          'Owns outcomes across teams',
          'Owns organisational results']],
        ['MENT', 'Mentoring', 'leadership', [
          'Shares knowledge when asked',
          'Onboards new joiners',
          'Actively grows peers',
          'Develops other mentors',
          'Builds the growth culture']],
      ];

      let seq = 1;
      for (const [code, name, category, levels] of competencies) {
        const comp = (await c.query<{ id: string }>(
          `INSERT INTO competency (framework_id, code, name, category, sequence)
                VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [framework, code, name, category, seq++])).rows[0]!.id;
        for (const [i, indicator] of levels.entries()) {
          await c.query(
            `INSERT INTO competency_level (competency_id, level_no, label,
                                           behavioral_indicator)
                  VALUES ($1,$2,$3,$4)`,
            [comp, i + 1, `Level ${i + 1}`, indicator]);
        }
      }

      // Publish only after the content exists — the framework freezes on publish.
      await c.query(
        `UPDATE competency_framework SET is_active = TRUE, published_at = now()
          WHERE id = $1`, [framework]);
    }

    const compId = async (code: string) => (await c.query<{ id: string }>(
      `SELECT c.id FROM competency c WHERE c.framework_id=$1 AND c.code=$2`,
      [framework, code])).rows[0]!.id;
    const positionId = async (title: string) => (await c.query<{ id: string }>(
      `SELECT id FROM position WHERE org_id=$1 AND title=$2`, [org, title])).rows[0]?.id;

    // Senior engineers are held to a higher bar than engineers — which is what
    // makes a gap report meaningful rather than a flat checklist.
    const requirements: [string, [string, number][]][] = [
      ['Senior Software Engineer', [['JUDG', 4], ['COMM', 3], ['OWN', 4], ['MENT', 3]]],
      ['Software Engineer', [['JUDG', 2], ['COMM', 2], ['OWN', 2], ['MENT', 1]]],
      ['Engineering Manager', [['JUDG', 3], ['COMM', 4], ['OWN', 4], ['MENT', 4]]],
    ];
    for (const [title, reqs] of requirements) {
      const pos = await positionId(title);
      if (!pos) continue;
      for (const [code, level] of reqs) {
        await c.query(
          `INSERT INTO position_competency_map (org_id, position_id, competency_id,
                                                required_level)
                VALUES ($1,$2,$3,$4)
           ON CONFLICT (position_id, competency_id)
           DO UPDATE SET required_level = EXCLUDED.required_level`,
          [org, pos, await compId(code), level]);
      }
    }

    // Assess Paolo and Grace, leaving deliberate holes so the report shows all
    // three states: meeting, below, and never assessed.
    const assessments: [string, [string, number][]][] = [
      ['00004', [['JUDG', 4], ['COMM', 2], ['OWN', 4]]],   // COMM below, MENT unassessed
      ['00005', [['JUDG', 2], ['COMM', 3]]],               // OWN and MENT unassessed
    ];
    for (const [employeeNo, items] of assessments) {
      const subject = await empId(employeeNo);
      for (const [code, level] of items) {
        const competency = await compId(code);
        const exists = await c.query(
          `SELECT 1 FROM competency_assessment
            WHERE subject_employee_id=$1 AND competency_id=$2 LIMIT 1`,
          [subject, competency]);
        if (exists.rowCount === 0) {
          await c.query(
            `INSERT INTO competency_assessment (org_id, subject_employee_id, competency_id,
                                                assessed_level, assessed_by, notes,
                                                assessed_on, created_by)
                  VALUES ($1,$2,$3,$4,$5,'Assessed during the FY2026 cycle',
                          '2026-06-30',$5)`,
            [org, subject, competency, level, ana]);
        }
      }
    }

    // --- Phase 6: learning library, career paths -------------------------
    await c.query('SELECT app.seed_phase6_grants($1)', [org]);

    const resources: [string, string, string, string | null][] = [
      ['Systems Design Intensive', 'course', 'JUDG', 'https://learn.test/systems-design'],
      ['Architecture Decision Records', 'document', 'JUDG', null],
      ['Writing for Engineers', 'workshop', 'COMM', null],
      ['Presenting to Non-Technical Audiences', 'course', 'COMM',
       'https://learn.test/presenting'],
      ['Owning an Incident End to End', 'document', 'OWN', null],
      ['Coaching Fundamentals', 'course', 'MENT', 'https://learn.test/coaching'],
    ];
    for (const [title, type, code, url] of resources) {
      const exists = await c.query(
        `SELECT 1 FROM learning_resource WHERE org_id=$1 AND title=$2`, [org, title]);
      if (exists.rowCount === 0) {
        await c.query(
          `INSERT INTO learning_resource (org_id, title, resource_type, competency_id, url)
                VALUES ($1,$2,$3::learning_resource_type,$4,$5)`,
          [org, title, type, await compId(code), url]);
      }
    }

    // A small ladder so the career view has something honest to show.
    const paths: [string, string, string, number][] = [
      ['Software Engineer', 'Senior Software Engineer', 'promotion', 24],
      ['Senior Software Engineer', 'Engineering Manager', 'promotion', 36],
    ];
    for (const [from, to, moveType, months] of paths) {
      const fromId = await positionId(from);
      const toId = await positionId(to);
      if (!fromId || !toId) continue;
      await c.query(
        `INSERT INTO career_path (org_id, from_position_id, to_position_id,
                                  move_type, typical_months)
              VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (from_position_id, to_position_id) DO NOTHING`,
        [org, fromId, toId, moveType, months]);
    }

    await c.query('COMMIT');

    console.log(`  competency framework: CORE v1, 4 competencies, 5 levels each`);
    console.log(`  learning library: ${resources.length} resources`);
    console.log(`  career paths: ${paths.length}`);
    console.log(`  goal period: FY2026 (open)`);
    console.log(`  KPI library: ${kpis.length} definitions`);
    console.log(`  goals: 4 with check-in history`);
    console.log(`  review cycle: FY2026 Annual Review, ${instances} instances`);
    console.log('\nDemo data ready.\n');
    console.log('Sign in at http://localhost:5273 with password  test1234');
    console.log('  maria  — CEO, HR admin (sees everything)');
    console.log('  jose   — Engineering Director (skip-level manager)');
    console.log('  ana    — Engineering Manager (Paolo + Grace report to her)');
    console.log('  paolo  — Engineer (has goals, one trending badly)');
    console.log('  grace  — Engineer (weights total 80% — HR gate flags her)');
    console.log('  ramon  — HR Business Partner, scoped to Engineering');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await c.end();
  }
}
