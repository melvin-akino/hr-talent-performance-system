/**
 * Demo activity for an organisation that already has its people.
 *
 * `seed-demo` builds the ACME fixture from nothing: it creates the org, imports
 * its own eight-person CSV, and hard-codes employee numbers `00001`–`00008`.
 * That makes it useless for an org whose staff are already loaded — pointing it
 * at one would import ACME's people into it.
 *
 * This command does the other half. It takes the employees, positions and
 * reporting lines as given, and adds the activity that makes the screens worth
 * looking at: goals with check-in history, a competency framework mapped to the
 * real position titles, a review cycle far enough along to populate the nine-box,
 * feedback, learning, development plans and one PIP.
 *
 * Everything is derived from the org chart rather than named, so it works for any
 * tenant: the seniority ladder comes from position titles, and reviewers come
 * from `reporting_line`. Employees are picked deterministically (ordered by
 * employee_no) so re-running produces the same demo, and every insert is guarded,
 * so it is idempotent.
 *
 * DEV ONLY, and guarded differently from `seed-demo`. That command can tell a
 * real database from a demo one by looking at whether it created the employees
 * itself; this one cannot, because pre-existing staff are the whole premise. So
 * confirmation is always required: the data it writes — PIPs, ratings, feedback
 * about named people — is exactly what must never appear against real employees
 * by accident.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { UnsafeSeedTargetError, assertNotProduction } from './seed-demo';

interface Person {
  id: string;
  employeeNo: string;
  name: string;
  positionTitle: string | null;
  departmentCode: string | null;
  supervisorId: string | null;
  isManager: boolean;
}

/** Seniority bands, matched against position titles. Order matters: the first
 *  hit wins, so "Senior QA Engineer" must be tested before "QA Engineer". */
const BANDS: [RegExp, 'lead' | 'senior' | 'mid' | 'junior'][] = [
  [/chief|head of|director|manager|lead/i, 'lead'],
  [/senior|principal|staff/i, 'senior'],
  [/junior|associate|intern|trainee/i, 'junior'],
  [/./, 'mid'],
];

const band = (title: string | null) =>
  BANDS.find(([re]) => re.test(title ?? ''))![1];

/** Required competency level per band — what makes a gap report meaningful
 *  rather than a flat checklist. */
const REQUIRED: Record<string, Record<string, number>> = {
  lead:   { JUDG: 4, COMM: 4, OWN: 4, MENT: 4 },
  senior: { JUDG: 4, COMM: 3, OWN: 4, MENT: 3 },
  mid:    { JUDG: 2, COMM: 2, OWN: 2, MENT: 1 },
  junior: { JUDG: 1, COMM: 2, OWN: 1, MENT: 1 },
};

/**
 * Refuses a target that might hold real people.
 *
 * `NODE_ENV=production` is refused outright, as everywhere. Beyond that there is
 * no signal to inspect — an org full of imported staff is what this command is
 * for — so it asks, every time, naming the headcount so a wrong target is
 * obvious in the refusal itself.
 */
export async function assertConfirmedTarget(
  c: Client, orgCode: string, opts: { confirmed?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  assertNotProduction(env);
  if (opts.confirmed) return;

  const headcount = Number((await c.query<{ n: string }>(
    `SELECT count(*)::int::text AS n
       FROM employee e JOIN organization o ON o.id = e.org_id
      WHERE o.code = $1 AND e.deleted_at IS NULL`, [orgCode])).rows[0]?.n ?? 0);

  throw new UnsafeSeedTargetError(
    `Refusing to seed activity into '${orgCode}' (${headcount} employee(s)) ` +
    'without confirmation.\n' +
    '  This writes goals, ratings, feedback and a performance improvement plan ' +
    'against those people.\n' +
    '  Unlike seed-demo, nothing here distinguishes a simulated org from a real ' +
    'one — check ADMIN_DATABASE_URL, then re-run with --yes-i-mean-it.');
}

export async function seedActivity(
  orgCode: string, opts: { confirmed?: boolean } = {},
): Promise<void> {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL must be set');

  const c = new Client({ connectionString: url });
  await c.connect();

  try {
    await assertConfirmedTarget(c, orgCode, opts);
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);

    const orgRow = await c.query<{ id: string; name: string }>(
      'SELECT id, name FROM organization WHERE code = $1', [orgCode]);
    if (!orgRow.rows[0]) throw new Error(`Organisation '${orgCode}' does not exist`);
    const org = orgRow.rows[0].id;
    console.log(`Seeding activity for ${orgRow.rows[0].name} (${orgCode})`);

    // Grants for the later phases. provision-org seeds the early ones; these are
    // idempotent, so calling them again costs nothing and a tenant provisioned
    // before a phase existed gets caught up.
    for (const fn of ['seed_phase4_grants', 'seed_phase5_feedback_grants',
      'seed_phase5_notification_grants', 'seed_phase6_grants', 'seed_help_grants']) {
      await c.query(`SELECT app.${fn}($1)`, [org]);
    }

    // --- the org chart, as given -------------------------------------------
    const people = (await c.query<Person>(
      `SELECT e.id,
              e.employee_no                      AS "employeeNo",
              e.first_name || ' ' || e.last_name AS name,
              p.title                            AS "positionTitle",
              d.code                             AS "departmentCode",
              rl.supervisor_employee_id          AS "supervisorId",
              EXISTS (SELECT 1 FROM reporting_line sub
                       WHERE sub.supervisor_employee_id = e.id
                         AND sub.effective_to IS NULL) AS "isManager"
         FROM employee e
         LEFT JOIN employment em ON em.employee_id = e.id AND em.effective_to IS NULL
         LEFT JOIN position p    ON p.id = em.position_id
         LEFT JOIN department d  ON d.id = em.department_id
         LEFT JOIN reporting_line rl ON rl.employee_id = e.id AND rl.effective_to IS NULL
        WHERE e.org_id = $1 AND e.deleted_at IS NULL
        ORDER BY e.employee_no`, [org])).rows;

    if (people.length === 0) throw new Error(`${orgCode} has no employees — import staff first`);
    const byNo = new Map(people.map((p) => [p.employeeNo, p]));
    const hrAdmin = (await c.query<{ id: string }>(
      `SELECT ra.employee_id AS id
         FROM role_assignment ra JOIN app_role r ON r.id = ra.role_id
        WHERE ra.org_id = $1 AND r.code = 'hr_admin'
          AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_DATE)
        LIMIT 1`, [org])).rows[0]?.id ?? people[0]!.id;

    const period = (await c.query<{ id: string; startsOn: string; endsOn: string }>(
      `SELECT id, starts_on::text AS "startsOn", ends_on::text AS "endsOn"
         FROM goal_period WHERE org_id = $1 AND state = 'open'
        ORDER BY starts_on DESC LIMIT 1`, [org])).rows[0];
    if (!period) {
      throw new Error(
        `${orgCode} has no open goal period — run: hr open-goal-period --org ${orgCode}`);
    }

    // --- KPI library --------------------------------------------------------
    const kpis: [string, string, string, string, string][] = [
      ['REV', 'Revenue growth', 'financial', 'currency', 'higher_is_better'],
      ['DEFECT', 'Escaped defects', 'process', 'numeric', 'lower_is_better'],
      ['CSAT', 'Customer satisfaction', 'customer', 'percentage', 'higher_is_better'],
      ['CYCLE', 'Cycle time (days)', 'process', 'numeric', 'lower_is_better'],
      ['UPTIME', 'Service uptime', 'process', 'percentage', 'higher_is_better'],
    ];
    for (const [code, name, category, measure, direction] of kpis) {
      await c.query(
        `INSERT INTO kpi_definition (org_id, code, version, name, category,
                                     measure_type, direction, published_at)
              VALUES ($1,$2,1,$3,$4,$5::kpi_measure_type,$6::kpi_direction,now())
         ON CONFLICT (org_id, code, version) DO NOTHING`,
        [org, code, name, category, measure, direction]);
    }

    // --- goals --------------------------------------------------------------
    /**
     * Goal titles by department, so an engineer's goals read like engineering
     * work and a QA engineer's like testing. Weights are chosen per person to
     * total 100 — except one deliberate exception below.
     */
    const GOALS: Record<string, [string, number, number, number | null, string][]> = {
      ENG: [
        ['Ship the payments integration', 50, 100, 80, 'higher_is_better'],
        ['Reduce escaped defects', 30, 5, 8, 'lower_is_better'],
        ['Cut median cycle time', 20, 4, 5, 'lower_is_better'],
      ],
      QA: [
        ['Raise regression coverage', 50, 85, 72, 'higher_is_better'],
        ['Cut escaped defects to production', 30, 3, 2, 'lower_is_better'],
        ['Automate the release smoke suite', 20, 100, 60, 'higher_is_better'],
      ],
      PRODUCT: [
        ['Ship the FY2026 roadmap commitments', 60, 100, 75, 'higher_is_better'],
        ['Raise customer satisfaction', 40, 90, 88, 'higher_is_better'],
      ],
      SALES: [
        ['Hit the new-business target', 70, 100, 92, 'higher_is_better'],
        ['Grow account retention', 30, 95, 96, 'higher_is_better'],
      ],
      HR: [
        ['Run the FY2026 review cycle to completion', 60, 100, 55, 'higher_is_better'],
        ['Cut time-to-hire', 40, 30, 38, 'lower_is_better'],
      ],
      EXEC: [
        ['Deliver the FY2026 revenue plan', 60, 100, 88, 'higher_is_better'],
        ['Keep voluntary attrition under target', 40, 10, 12, 'lower_is_better'],
      ],
      FA: [
        ['Close the books within five days', 60, 5, 6, 'lower_is_better'],
        ['Keep operating spend within budget', 40, 100, 97, 'higher_is_better'],
      ],
    };

    /** Check-in patterns, assigned round-robin so Monitoring has every state. */
    const PATTERNS: string[][] = [
      ['on_track', 'on_track', 'on_track'],
      ['on_track', 'at_risk'],
      ['at_risk', 'off_track'],          // escalation: two consecutive bad
      [],                                 // never checked in
      ['on_track'],
    ];

    let goalCount = 0;
    let checkinCount = 0;
    // Everyone except the very top of the chart — a CEO with a supervisor to
    // approve their goals does not exist, and an unapproved goal is a different
    // demo.
    const goalOwners = people.filter((p) => p.supervisorId);

    for (const [index, person] of goalOwners.entries()) {
      const set = GOALS[person.departmentCode ?? 'ENG'] ?? GOALS.ENG!;
      // One person is left at 80% on purpose, so the HR console's weight gate has
      // a row to flag and the period-lock refusal can be demonstrated.
      const dropLast = index === 3 && set.length > 2;
      const goals = dropLast ? set.slice(0, -1) : set;

      for (const [gIndex, [title, weight, target, actual, direction]] of goals.entries()) {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM goal WHERE employee_id=$1 AND goal_period_id=$2 AND title=$3`,
          [person.id, period.id, title]);
        if (existing.rows[0]) continue;

        const goalId = (await c.query<{ id: string }>(
          `INSERT INTO goal (org_id, goal_period_id, employee_id, title, weight, state,
                             approved_by, approved_at, due_on)
                VALUES ($1,$2,$3,$4,$5,'active',$6,now(),$7) RETURNING id`,
          [org, period.id, person.id, title, weight, person.supervisorId, period.endsOn]))
          .rows[0]!.id;
        goalCount++;

        await c.query(
          `INSERT INTO goal_target (goal_id, measure_name, measure_type, direction,
                                    baseline_value, target_value, actual_value, actual_as_of)
                VALUES ($1,$2,'numeric',$3::kpi_direction,$4,$5,$6,CURRENT_DATE)`,
          [goalId, title, direction,
           direction === 'lower_is_better' ? target * 2 : 0, target, actual]);

        // The pattern varies by person AND by goal, so one person can have a
        // healthy goal and a failing one — which is the realistic case.
        const pattern = PATTERNS[(index + gIndex) % PATTERNS.length]!;
        for (const [month, status] of pattern.entries()) {
          // Logged by the manager for some, by the owner for others: the actor
          // column matters (a manager-logged check-in must still be visible to
          // the employee, which is what own-records.spec.ts guards).
          const actor = gIndex === 0 ? person.id : person.supervisorId ?? person.id;
          await c.query(
            `INSERT INTO goal_checkin (goal_id, checked_in_by, status_flag, period_ending,
                                       comment, created_by)
                  VALUES ($1,$2,$3::checkin_status,
                          ($4::date + ($5::int * INTERVAL '1 month'))::date,$6,$2)`,
            [goalId, actor, status, period.startsOn, month + 1,
             `Month ${month + 1} update — ${status.replace(/_/g, ' ')}`]);
          checkinCount++;
        }
      }
    }
    await c.query('COMMIT');
    console.log(`  goals: ${goalCount} (${checkinCount} check-ins)`);

    // --- competency framework ----------------------------------------------
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);

    const framework = (await c.query<{ id: string }>(
      `INSERT INTO competency_framework (org_id, code, version, name, description)
            VALUES ($1,'CORE',1,'Core Competency Framework',
                    'Behavioural framework for all roles')
       ON CONFLICT (org_id, code, version) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [org])).rows[0]!.id;

    const built = await c.query(
      'SELECT 1 FROM competency WHERE framework_id = $1 LIMIT 1', [framework]);
    if (built.rowCount === 0) {
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
      // Publish last: the framework freezes on publish.
      await c.query(
        `UPDATE competency_framework SET is_active = TRUE, published_at = now()
          WHERE id = $1`, [framework]);
    }

    const comps = new Map((await c.query<{ code: string; id: string }>(
      'SELECT code, id FROM competency WHERE framework_id = $1', [framework]))
      .rows.map((r) => [r.code, r.id]));

    // Requirements per position, banded from the title. Every position that
    // exists gets a bar, so no employee lands on "nothing mapped".
    const positions = (await c.query<{ id: string; title: string }>(
      'SELECT id, title FROM position WHERE org_id = $1', [org])).rows;
    let mapped = 0;
    for (const pos of positions) {
      for (const [code, level] of Object.entries(REQUIRED[band(pos.title)]!)) {
        await c.query(
          `INSERT INTO position_competency_map (org_id, position_id, competency_id,
                                                required_level)
                VALUES ($1,$2,$3,$4)
           ON CONFLICT (position_id, competency_id)
           DO UPDATE SET required_level = EXCLUDED.required_level`,
          [org, pos.id, comps.get(code), level]);
        mapped++;
      }
    }

    // Assessments: most people assessed on three of four competencies, so the
    // fourth shows as "not assessed" rather than as a failure. Every third
    // person is left entirely unassessed, which is the honest state of a real
    // rollout and what the coverage figure is for.
    let assessed = 0;
    for (const [index, person] of people.entries()) {
      if (index % 3 === 2) continue;
      const required = REQUIRED[band(person.positionTitle)]!;
      const codes = ['JUDG', 'COMM', 'OWN'];
      for (const [i, code] of codes.entries()) {
        // Deterministic spread around the bar: at, one below, one above.
        const delta = [(0), (-1), (1)][(index + i) % 3]!;
        const level = Math.min(5, Math.max(1, required[code]! + delta));
        const competency = comps.get(code)!;
        const exists = await c.query(
          `SELECT 1 FROM competency_assessment
            WHERE subject_employee_id=$1 AND competency_id=$2 LIMIT 1`,
          [person.id, competency]);
        if (exists.rowCount) continue;
        await c.query(
          `INSERT INTO competency_assessment (org_id, subject_employee_id, competency_id,
                                              assessed_level, assessed_by, notes,
                                              assessed_on, created_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$5)`,
          [org, person.id, competency, level,
           person.supervisorId ?? hrAdmin,
           delta < 0
             ? 'Below the bar for the role; development plan agreed.'
             : delta > 0
               ? 'Consistently operating above the level for the role.'
               : 'Solid at the level expected for the role.',
           period.startsOn]);
        assessed++;
      }
    }
    await c.query('COMMIT');
    console.log(`  competencies: 4 mapped to ${positions.length} positions ` +
                `(${mapped} requirements), ${assessed} assessments`);

    // --- review cycle -------------------------------------------------------
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);

    const cycleName = 'FY2026 Annual Review';
    const cycle = (await c.query<{ id: string }>(
      `INSERT INTO review_cycle (org_id, goal_period_id, name, opens_on, closes_on, state)
            VALUES ($1,$2,$3,$4,$5,'open')
       ON CONFLICT (org_id, name) DO UPDATE SET state = EXCLUDED.state
         RETURNING id`,
      [org, period.id, cycleName, period.startsOn, period.endsOn])).rows[0]!.id;

    for (const [i, phase] of ['self', 'supervisor', 'calibration', 'signoff'].entries()) {
      await c.query(
        `INSERT INTO review_cycle_phase (review_cycle_id, phase_type, sequence,
                                         opens_on, closes_on)
              VALUES ($1,$2::review_phase_type,$3,$4,$5)
         ON CONFLICT (review_cycle_id, phase_type) DO NOTHING`,
        [cycle, phase, i + 1, period.startsOn, period.endsOn]);
    }

    // Same logic as the API's generate route, run as the operator.
    const subjects = (await c.query<{ id: string; sup: string | null }>(
      `SELECT e.id, rl.supervisor_employee_id AS sup
         FROM employee e
         JOIN employment em ON em.employee_id=e.id AND em.effective_to IS NULL
         JOIN employment_type et ON et.id=em.employment_type_id
                                AND et.is_eligible_for_review
         LEFT JOIN reporting_line rl ON rl.employee_id=e.id AND rl.effective_to IS NULL
        WHERE e.org_id=$1 AND e.deleted_at IS NULL
        ORDER BY e.employee_no`, [org])).rows;

    const instanceIds: { id: string; subject: string; role: string }[] = [];
    for (const s of subjects) {
      const fv = (await c.query<{ id: string | null }>(
        'SELECT app.resolve_form_version($1) AS id', [s.id])).rows[0]!.id;
      if (!fv) continue;
      await c.query(
        `INSERT INTO review_summary (review_cycle_id, subject_employee_id)
              VALUES ($1,$2) ON CONFLICT DO NOTHING`, [cycle, s.id]);
      for (const [role, reviewer] of [['self', s.id], ['supervisor', s.sup]] as const) {
        if (!reviewer) continue;
        const row = await c.query<{ id: string }>(
          `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                        reviewer_employee_id, reviewer_role,
                                        form_version_id)
                VALUES ($1,$2,$3,$4::reviewer_role,$5)
           ON CONFLICT DO NOTHING RETURNING id`,
          [cycle, s.id, reviewer, role, fv]);
        if (row.rows[0]) instanceIds.push({ id: row.rows[0].id, subject: s.id, role });
      }
    }

    /**
     * Fill in most of the cycle, leaving the last few subjects untouched.
     *
     * A cycle where everything is submitted has nothing to demonstrate: no
     * "waiting on you" list, and sign-off already gated open. Leaving a tail
     * incomplete is what makes the gate visible.
     */
    const ratingFor = (i: number) => [3, 4, 3, 5, 2, 4, 3, 4][i % 8]!;
    const answers = (rating: number) => ({
      goal_commentary: 'Delivered the committed scope; the integration slipped by ' +
        'two weeks after the vendor sandbox outage.',
      overall: rating,
      strengths: 'Reliable under pressure, and the person others ask when a ' +
        'release looks wrong.',
      development: 'Would benefit from writing the design down earlier, before ' +
        'the implementation settles the decision.',
      promotion_ready: rating >= 4,
    });

    const submitCutoff = Math.floor(instanceIds.length * 0.8);
    let submitted = 0;
    for (const [i, inst] of instanceIds.entries()) {
      if (i >= submitCutoff) continue;
      const rating = ratingFor(i);
      for (const [key, value] of Object.entries(answers(rating))) {
        await c.query(
          `INSERT INTO form_response (review_instance_id, field_key, value_json)
                VALUES ($1,$2,$3::jsonb)
           ON CONFLICT (review_instance_id, field_key)
           DO UPDATE SET value_json = EXCLUDED.value_json`,
          [inst.id, key, JSON.stringify(value)]);
      }
      await c.query(
        `UPDATE review_instance
            SET state='submitted', overall_rating=$2, submitted_at=now()
          WHERE id=$1 AND state <> 'submitted'`, [inst.id, rating]);
      submitted++;
    }

    // Supervisor ratings roll up to the summary; calibration moves a couple of
    // them, which is what the movement panel and the nine-box read.
    const summaries = (await c.query<{ id: string; subject: string }>(
      `SELECT id, subject_employee_id AS subject FROM review_summary
        WHERE review_cycle_id=$1 ORDER BY subject_employee_id`, [cycle])).rows;

    let rated = 0; let calibrated = 0; let signed = 0;
    for (const [i, s] of summaries.entries()) {
      const sup = (await c.query<{ r: number | null }>(
        `SELECT overall_rating AS r FROM review_instance
          WHERE review_cycle_id=$1 AND subject_employee_id=$2
            AND reviewer_role='supervisor' AND state='submitted'`, [cycle, s.subject]))
        .rows[0]?.r;
      if (sup == null) continue;

      const attainment = (await c.query<{ pct: string | null }>(
        `SELECT app.review_goal_attainment($1,$2)::text AS pct`, [s.subject, period.id]))
        .rows[0]?.pct ?? null;

      // Calibration nudges every fifth person down — the moderation that a
      // calibration session actually produces.
      const moved = i % 5 === 4 && Number(sup) > 1;
      // Every parameter is cast: `calibrated_rating = $4` alone is inferrable,
      // but the same `$4` inside a CASE is not, and the whole statement fails
      // with "could not determine data type of parameter".
      await c.query(
        `UPDATE review_summary
            SET overall_rating = $2::numeric,
                goal_attainment_pct = COALESCE($3::numeric, goal_attainment_pct),
                calibrated_rating = $4::numeric,
                calibration_notes = CASE WHEN $4::numeric IS NULL THEN calibration_notes
                                         ELSE 'Moderated down in calibration to match '
                                              || 'the department distribution.' END,
                potential_rating = $5::smallint
          WHERE id = $1`,
        [s.id, sup, attainment, moved ? Number(sup) - 1 : null, (i % 3) + 1]);
      rated++;
      if (moved) calibrated++;

      // Sign off the first few only: the rest stay gated, which is the point.
      if (i < 3) {
        await c.query(
          `UPDATE review_summary
              SET signed_off_by=$2, signed_off_at=now(), released_at=now()
            WHERE id=$1 AND signed_off_at IS NULL`, [s.id, hrAdmin]);
        signed++;
      }
    }
    await c.query('COMMIT');
    console.log(`  review cycle: ${instanceIds.length} instances, ${submitted} submitted, ` +
                `${rated} rated, ${calibrated} moved in calibration, ${signed} signed off`);

    // --- feedback, learning, development, one PIP ---------------------------
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);

    let threads = 0;
    const feedbackFor = people.filter((p) => p.supervisorId).slice(0, 6);
    const FEEDBACK: [string, string, string][] = [
      ['employee_and_supervisor', 'praise', 'Handled the release rollback calmly'],
      ['employee_only', 'coaching', 'Worth writing the design down sooner'],
      ['supervisor_only', 'concern', 'Readiness for the next level'],
    ];
    for (const [i, person] of feedbackFor.entries()) {
      const [visibility, kind, title] = FEEDBACK[i % FEEDBACK.length]!;
      const author = person.supervisorId!;
      const exists = await c.query(
        `SELECT 1 FROM feedback_thread WHERE org_id=$1 AND subject_employee_id=$2
           AND title=$3 LIMIT 1`, [org, person.id, title]);
      if (exists.rowCount) continue;
      const thread = (await c.query<{ id: string }>(
        `INSERT INTO feedback_thread (org_id, subject_employee_id, created_by,
                                      visibility, kind, title)
              VALUES ($1,$2,$3,$4::feedback_visibility,$5::feedback_kind,$6)
         RETURNING id`, [org, person.id, author, visibility, kind, title])).rows[0]!.id;
      await c.query(
        `INSERT INTO feedback_message (feedback_thread_id, author_employee_id, body,
                                       created_by)
              VALUES ($1,$2,$3,$2)`,
        [thread, author,
         'Noting this while it is fresh rather than saving it for the review — ' +
         'it is more useful now.']);
      threads++;
    }

    // Learning library, tied to the competencies so the recommendations on the
    // Development screen have something to match a gap against.
    const resources: [string, string, string, string | null][] = [
      ['Systems Design Intensive', 'course', 'JUDG', 'https://learn.test/systems-design'],
      ['Architecture Decision Records', 'document', 'JUDG', null],
      ['Writing for Engineers', 'workshop', 'COMM', null],
      ['Presenting to Non-Technical Audiences', 'course', 'COMM', 'https://learn.test/present'],
      ['Owning an Incident End to End', 'document', 'OWN', null],
      ['Coaching Fundamentals', 'course', 'MENT', 'https://learn.test/coaching'],
      ['Test Automation Patterns', 'course', 'JUDG', 'https://learn.test/test-automation'],
    ];
    const resourceIds: string[] = [];
    for (const [title, type, code, resourceUrl] of resources) {
      const found = await c.query<{ id: string }>(
        'SELECT id FROM learning_resource WHERE org_id=$1 AND title=$2', [org, title]);
      if (found.rows[0]) { resourceIds.push(found.rows[0].id); continue; }
      resourceIds.push((await c.query<{ id: string }>(
        `INSERT INTO learning_resource (org_id, title, resource_type, competency_id, url)
              VALUES ($1,$2,$3::learning_resource_type,$4,$5) RETURNING id`,
        [org, title, type, comps.get(code), resourceUrl])).rows[0]!.id);
    }

    // Career ladders, derived from the titles that actually exist.
    const titleOf = new Map(positions.map((p) => [p.title, p.id]));
    const LADDERS: string[][] = [
      ['Junior Software Engineer', 'Software Engineer', 'Senior Software Engineer',
       'Tech Lead', 'Engineering Manager'],
      ['Junior QA Engineer', 'QA Engineer', 'Senior QA Engineer', 'QA Lead'],
      ['Account Executive', 'Business Development Manager'],
      ['HR Associate', 'HR Manager'],
      ['UI/UX Designer', 'Product Manager'],
    ];
    let paths = 0;
    for (const ladder of LADDERS) {
      for (let i = 0; i < ladder.length - 1; i++) {
        const from = titleOf.get(ladder[i]!);
        const to = titleOf.get(ladder[i + 1]!);
        if (!from || !to) continue;
        await c.query(
          `INSERT INTO career_path (org_id, from_position_id, to_position_id,
                                    move_type, typical_months)
                VALUES ($1,$2,$3,'promotion',$4)
           ON CONFLICT (from_position_id, to_position_id) DO NOTHING`,
          [org, from, to, 18 + i * 6]);
        paths++;
      }
    }

    // Development plans with actions and assigned learning, for the people whose
    // assessments came out below the bar.
    let plans = 0; let assignments = 0;
    const planFor = people.filter((p) => p.supervisorId).slice(0, 5);
    for (const [i, person] of planFor.entries()) {
      const title = 'Grow into the next level';
      const found = await c.query<{ id: string }>(
        `SELECT id FROM development_plan WHERE org_id=$1 AND employee_id=$2 AND title=$3`,
        [org, person.id, title]);
      let planId = found.rows[0]?.id;
      if (!planId) {
        planId = (await c.query<{ id: string }>(
          `INSERT INTO development_plan (org_id, employee_id, title, objective,
                                         goal_period_id, starts_on, target_date, state)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [org, person.id, title,
           'Close the gap on the competencies the role expects, with something ' +
           'concrete to point at by the end of the period.',
           period.id, period.startsOn, period.endsOn,
           i === 0 ? 'draft' : 'active'])).rows[0]!.id;
        plans++;

        const actions: [string, string, number][] = [
          ['Write and circulate a design document for the next feature', 'JUDG', 0],
          ['Present the quarterly demo to the wider company', 'COMM', 2],
          ['Own one incident end to end, including the write-up', 'OWN', 4],
        ];
        for (const [seq, [description, code, resourceIndex]] of actions.entries()) {
          // `completed` and a completion date are one fact, enforced as a pair by
          // dev_action_completion_pair — likewise for the assignment below.
          const status = seq === 0 ? 'completed' : seq === 1 ? 'in_progress' : 'not_started';
          const actionId = (await c.query<{ id: string }>(
            `INSERT INTO dev_action (development_plan_id, sequence, description,
                                     competency_id, learning_resource_id, target_date,
                                     status, completed_on)
                  VALUES ($1,$2,$3,$4,$5,$6,$7::dev_action_status,
                          CASE WHEN $7 = 'completed' THEN CURRENT_DATE - 20 END)
             RETURNING id`,
            [planId, seq + 1, description, comps.get(code),
             resourceIds[resourceIndex] ?? null, period.endsOn, status]))
            .rows[0]!.id;

          if (resourceIds[resourceIndex]) {
            const state = seq === 0 ? 'completed' : 'assigned';
            await c.query(
              `INSERT INTO learning_assignment (org_id, employee_id, learning_resource_id,
                                                assigned_by, dev_action_id, due_on, state,
                                                completed_on)
                    VALUES ($1,$2,$3,$4,$5,$6,$7::learning_assignment_state,
                            CASE WHEN $7 = 'completed' THEN CURRENT_DATE - 20 END)`,
              [org, person.id, resourceIds[resourceIndex], person.supervisorId,
               actionId, period.endsOn, state]);
            assignments++;
          }
        }
      }
    }

    // One PIP, on someone whose check-ins went off track — which is the path a
    // real PIP follows, rather than appearing from nowhere.
    let pips = 0;
    const pipSubject = goalOwners[2];
    if (pipSubject?.supervisorId) {
      const exists = await c.query(
        'SELECT 1 FROM pip_plan WHERE org_id=$1 AND employee_id=$2', [org, pipSubject.id]);
      if (exists.rowCount === 0) {
        const pip = (await c.query<{ id: string }>(
          `INSERT INTO pip_plan (org_id, employee_id, initiated_by, supervisor_id,
                                 goal_period_id, reason, expected_outcome, starts_on,
                                 ends_on, review_cadence, state, acknowledged_at,
                                 created_by)
                VALUES ($1,$2,$3,$3,$4,$5,$6,CURRENT_DATE - 30,CURRENT_DATE + 30,
                        'biweekly','active',now(),$3) RETURNING id`,
          [org, pipSubject.id, pipSubject.supervisorId, period.id,
           'Two consecutive off-track check-ins on the delivery goal, and the ' +
           'quality bar slipped in the last two releases.',
           'Consistent on-track check-ins for two months, and no repeat of the ' +
           'defects that caused the rollback.'])).rows[0]!.id;
        pips++;

        const milestones: [string, string, number, boolean | null][] = [
          ['Agree the delivery plan with the tech lead',
           'A written plan, reviewed and signed off', -21, true],
          ['Land the outstanding integration work',
           'Merged and released with no rollback', -7, false],
          ['Two consecutive on-track check-ins',
           'Recorded in the system by the review date', 21, null],
        ];
        for (const [seq, [description, criteria, offset, met]] of milestones.entries()) {
          await c.query(
            `INSERT INTO pip_milestone (pip_plan_id, sequence, description,
                                        success_criteria, due_on, met, assessed_by,
                                        assessed_at, assessment_notes, created_by)
                  VALUES ($1,$2,$3,$4,CURRENT_DATE + $5::int,$6::boolean,
                          CASE WHEN $6::boolean IS NULL THEN NULL ELSE $7::uuid END,
                          CASE WHEN $6::boolean IS NULL THEN NULL ELSE now() END,
                          CASE WHEN $6::boolean IS NULL THEN NULL
                               WHEN $6::boolean THEN 'Done, and done well.'
                               ELSE 'Slipped — carried into the next review.' END,
                          $7::uuid)`,
            [pip, seq + 1, description, criteria, offset, met, pipSubject.supervisorId]);
        }
        await c.query(
          `INSERT INTO pip_review (pip_plan_id, reviewed_by, review_date,
                                   progress_summary, status_flag, employee_comment,
                                   created_by)
                VALUES ($1,$2,CURRENT_DATE - 14,$3,'at_risk',$4,$2)`,
          [pip, pipSubject.supervisorId,
           'The plan is agreed and the first milestone is done. The integration ' +
           'work is late, which is the one that matters.',
           'Agreed. The vendor sandbox outage cost me a week; I should have ' +
           'flagged it sooner.']);
      }
    }

    await c.query('COMMIT');
    console.log(`  feedback: ${threads} threads`);
    console.log(`  learning: ${resources.length} resources, ${assignments} assignments`);
    console.log(`  development: ${plans} plans, ${paths} career paths`);
    console.log(`  PIPs: ${pips}`);
    console.log('\nActivity seeded.\n');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await c.end();
  }
}
