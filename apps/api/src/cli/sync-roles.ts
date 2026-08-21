/**
 * Derives baseline role assignments from the org chart.
 *
 *   pnpm hr sync-roles --org DEVCORE [--dry-run]
 *
 * The employee importer deliberately writes no roles — it owns people and
 * reporting lines, not authorisation. Without this step every imported employee
 * has zero grants and cannot see their own goals, which makes an otherwise
 * successful import look like a broken deployment.
 *
 * Two rules, both mechanical:
 *   employee — every active, non-deleted employee.
 *   manager  — every employee with at least one current direct report.
 *
 * `hr_admin` and `hr_partner` are NOT derived: they are judgement calls about
 * who may see the whole organisation, so they stay manual (`hr grant-admin`).
 *
 * Idempotent, and safe to re-run after each import. Managers who lose their
 * last report have the grant closed rather than deleted, so the audit trail and
 * any effective-dated history stay intact.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

interface SyncReport {
  granted: { employeeNo: string; role: string }[];
  revoked: { employeeNo: string; role: string }[];
}

export async function syncRoles(orgCode: string, dryRun: boolean): Promise<void> {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL must be set');

  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);

  try {
    const org = (await c.query<{ id: string }>(
      'SELECT id FROM organization WHERE code = $1', [orgCode])).rows[0]?.id;
    if (!org) throw new Error(`Organization '${orgCode}' does not exist`);

    const report: SyncReport = { granted: [], revoked: [] };

    /**
     * Grants `roleCode` to exactly the employees matching `targetSql`, and
     * closes it for everyone else who currently holds it. Both directions in
     * one place so the two can never drift apart.
     */
    const reconcile = async (roleCode: string, targetSql: string) => {
      const grants = await c.query<{ employee_no: string }>(
        `WITH target AS (${targetSql}),
         ins AS (
           INSERT INTO role_assignment (org_id, employee_id, role_id, effective_from)
           SELECT $1, t.id, r.id, CURRENT_DATE
             FROM target t
             CROSS JOIN app_role r
            WHERE r.org_id = $1 AND r.code = $2
              AND NOT EXISTS (
                  SELECT 1 FROM role_assignment ra
                   WHERE ra.employee_id = t.id AND ra.role_id = r.id
                     AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_DATE))
           RETURNING employee_id)
         SELECT e.employee_no FROM ins JOIN employee e ON e.id = ins.employee_id
          ORDER BY e.employee_no`, [org, roleCode]);
      for (const row of grants.rows) {
        report.granted.push({ employeeNo: row.employee_no, role: roleCode });
      }

      // Revocation takes effect immediately, in both branches below. Deferring
      // it — closing the grant as of tomorrow to satisfy the date check — would
      // leave a demoted manager holding access to a former report's reviews for
      // the rest of the day, which is exactly the window a re-org needs closed.
      //
      // The split exists because `effective_to > effective_from` is strict:
      //   * a grant made on an earlier day is closed as of today, keeping the
      //     period it was genuinely held;
      //   * a grant made today and withdrawn today never applied to any
      //     completed day, so the row is removed. The audit trigger records the
      //     deletion, so this loses no history — it records a correction as a
      //     correction rather than inventing a one-day tenure.
      const revokes = await c.query<{ employee_no: string }>(
        `WITH target AS (${targetSql}),
         upd AS (
           UPDATE role_assignment ra
              SET effective_to = CURRENT_DATE
             FROM app_role r
            WHERE r.id = ra.role_id AND r.org_id = $1 AND r.code = $2
              AND ra.org_id = $1
              AND ra.effective_from < CURRENT_DATE
              AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_DATE)
              AND ra.employee_id NOT IN (SELECT id FROM target)
           RETURNING ra.employee_id),
         del AS (
           DELETE FROM role_assignment ra
            USING app_role r
            WHERE r.id = ra.role_id AND r.org_id = $1 AND r.code = $2
              AND ra.org_id = $1
              AND ra.effective_from >= CURRENT_DATE
              AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_DATE)
              AND ra.employee_id NOT IN (SELECT id FROM target)
           RETURNING ra.employee_id)
         SELECT e.employee_no FROM employee e
          WHERE e.id IN (SELECT employee_id FROM upd
                         UNION ALL
                         SELECT employee_id FROM del)
          ORDER BY e.employee_no`, [org, roleCode]);
      for (const row of revokes.rows) {
        report.revoked.push({ employeeNo: row.employee_no, role: roleCode });
      }
    };

    const ACTIVE = `
      SELECT e.id
        FROM employee e
        JOIN employment em ON em.employee_id = e.id AND em.effective_to IS NULL
       WHERE e.org_id = $1 AND e.deleted_at IS NULL`;

    await reconcile('employee', ACTIVE);

    // A manager is whoever currently has a direct report. Deriving it from the
    // reporting line rather than from job titles means a re-org is reflected the
    // moment the chart is re-imported.
    await reconcile('manager', `
      ${ACTIVE}
        AND EXISTS (
            SELECT 1 FROM reporting_line rl
             WHERE rl.supervisor_employee_id = e.id
               AND rl.effective_to IS NULL)`);

    if (dryRun) {
      await c.query('ROLLBACK');
    } else {
      await c.query('COMMIT');
    }

    const byRole = (list: { employeeNo: string; role: string }[], role: string) =>
      list.filter((g) => g.role === role).map((g) => g.employeeNo);

    console.log(`\n${dryRun ? 'DRY RUN — nothing was written' : 'Role sync complete'}`);
    for (const role of ['employee', 'manager']) {
      const g = byRole(report.granted, role);
      const r = byRole(report.revoked, role);
      console.log(`  ${role.padEnd(9)} +${g.length} granted, -${r.length} revoked`);
      if (g.length > 0) console.log(`    granted: ${g.join(', ')}`);
      if (r.length > 0) console.log(`    revoked: ${r.join(', ')}`);
    }
    console.log(`\n  hr_admin / hr_partner are not derived — grant them explicitly.`);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await c.end();
  }
}
