---
id: managing-people
title: Adding people, reporting lines and roles
summary: Importing staff from a 201 file, keeping the org chart right, and who gets which role.
section: administering
audience: [hr_admin]
routes: ["/setup", "/hr"]
keywords: [import, 201, onboarding, new hire, leaver, reporting line, org chart, supervisor, roles, permissions, admin]
order: 52
---

## Importing staff

Staff are loaded from a 201 file by an operator running the import on the
server — it is not a screen, because bulk-loading people is not something to do
by accident.

Two columns must be added to a standard 201 export:

| Column | Why |
|---|---|
| `Supervisor_ID` | Another row's `Employee_ID`. **This is the org chart.** |
| `Work_Email` | Binds the person to their directory account at first login. |

The import **always dry-runs first**. Read the report rather than skimming it:

- **Reporting lines** should equal headcount minus one.
- **Missing supervisors** should list exactly one person — the top. More than
  one means those people are invisible to every manager.
- **Columns not imported** lists everything discarded: TIN, SSS, PhilHealth,
  Pag-IBIG, address, birthdate, contact numbers, dependants, leave balances.
  That list is the privacy guarantee working; those fields stay in your 201 file
  and never enter this system.

An unrecognised employment status is rejected rather than guessed. Fix the file.

## The org chart is the permission model

Reporting lines are not decoration. They determine who can see whom, who
approves goals, and who writes supervisor reviews. A wrong line is a wrong
permission.

Lines are effective-dated, so last year's review stays calibrated against last
year's structure. When someone moves, record the move — do not edit history.

## Roles

| Role | Grants |
|---|---|
| `employee` | Their own records. Everyone has this. |
| `manager` | Their reporting subtree. |
| `hr_partner` | HR access, optionally scoped to one department. |
| `hr_admin` | The whole organisation, and configuration. |

`employee` and `manager` are **derived from the org chart** by an operator
command, not assigned by hand — a manager is someone with a direct report, not
someone with a manager-sounding job title. Re-run it after any re-org.

`hr_admin` and `hr_partner` are judgement calls and are granted deliberately.
Keep the number of org-wide admins small; they can see every rating in the
company.

## Joiners and leavers

**Joiners** need a work email matching their directory account, a supervisor,
and a position. Then re-run the role sync so their manager gains access, and
check they resolve to a review form if a cycle is running.

**Leavers** are marked separated with a date. They stop receiving notifications
and drop out of eligible populations. Their history is retained — a separated
employee's past reviews remain part of the record, which is the point of keeping
them.

Do not delete people. Deleting destroys the history that makes a trend
meaningful, and audit records refer to them.

## Before go-live

There is a readiness check the operator can run that verifies the things above —
that RLS is enforced, that one root exists in the org chart, that every eligible
employee resolves to a form, that a goal period is open, and that an
administrator exists. Ask for it to be run before the first cycle.
