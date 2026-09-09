-- The five org units the GGCHCM pilot's staff CSV refers to.
--
-- hcm-anonymised.example.csv carries a department_code per person, and
-- `hr import-employees` resolves it rather than creating it: an import that
-- invented departments from a typo would build a plausible-looking org chart
-- nobody asked for. So the units come first, and the import fails loudly with
-- "Department 'HCM' does not exist" until they do.
--
-- The shape is the client's, from the HCM TO sheet: one department with four
-- sections beneath it. Every person in the CSV is invented; this file carries
-- no names at all.
--
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/ggchcm-departments.sql
--
-- Run after `hr provision-org --org GGCHCM`, before `hr import-employees`.

WITH org AS (
  SELECT id FROM organization WHERE code = 'GGCHCM'
),
parent AS (
  INSERT INTO department (org_id, code, name, unit_type, effective_from)
  SELECT id, 'HCM', 'Human Capital Management', 'department', DATE '2020-01-01'
    FROM org
  RETURNING id, org_id
)
INSERT INTO department (org_id, parent_department_id, code, name, unit_type,
                        effective_from)
SELECT p.org_id, p.id, s.code, s.name, 'section', DATE '2020-01-01'
  FROM parent p,
       (VALUES ('HS', 'Hiring & Selection'),
               ('CB', 'Compensation & Benefits'),
               ('ER', 'Employee Relations'),
               ('OD', 'Organizational Development')) AS s(code, name);
