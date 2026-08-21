# UI design brief — HR Performance System

Hand this to Claude Design. It describes what exists, what is wrong with it, and
what a good answer looks like. Paste the whole document; the "Prompt" section at
the end is the instruction, everything above it is the context it needs.


A companion walkthrough of the running application, with observations and two
known defects, is in [design/current-state.md](design/current-state.md).

---

## 1. What this product is

An on-premise performance and talent management system for Philippine companies
— the part of HR concerned with goals, reviews, competencies and development.
**Not** payroll, timekeeping or leave. It replaces a SaaS product (Sprout) that
the customer rejected because it could not keep data on their own server.

It is used by everyone in the company, a few times a quarter, on office desktops
and on phones. Most users are not HR professionals — they are engineers, QA,
sales and finance staff who open it because they were told to, do one task, and
leave. **The design has to survive infrequent, reluctant use.** Someone who last
saw this screen four months ago must know what to do without a tutorial.

It is deployed inside an office LAN behind a VPN. There is no marketing surface,
no onboarding funnel, no upsell. Every pixel is work.

## 2. Who uses it

| Role | How often | What they come to do |
|---|---|---|
| **Employee** (majority) | 4–6× a year | Set goals, check in on progress, write a self-review, read their released review, request feedback |
| **Manager** | monthly | Approve their team's goals, review check-ins, spot people going off track, write supervisor reviews, run PIPs |
| **HR admin** | weekly | Launch review cycles, chase completion, calibrate ratings, sign off, configure forms and competencies |
| **Executive** | quarterly | Look at analytics — rating distribution, nine-box, calibration movement |

One person can hold several of these at once. A manager is also an employee with
their own goals; an HR admin is usually a manager too. **The interface must make
"which hat am I wearing" obvious**, because acting on your own record and acting
on someone else's are very different things with different consequences.

## 3. What exists today

React 19 + Vite + Tailwind v4 + React Router + TanStack Query. About 7,500 lines
across 21 screens. It works and is fully wired to a real API — this is a
redesign, not a greenfield.

**Navigation** is a single flat row of tabs, conditionally shown by role:

```
My goals | Team* | Reviews | Competencies | Feedback | Development | Monitoring
         | PIPs* | HR* | Cycles* | Analytics* | KPI library* | Setup*
```
`*` = only for managers or HR. An HR admin who manages a team sees **thirteen
tabs in one row**.

**Screens**

*Employee*
- `MyGoals` — goal list with weights, attainment bars, state badges
- `NewGoal` / `GoalDetail` — create a goal, add targets, log check-ins
- `Reviews` → `ReviewForm` — a dynamic form rendered from a JSON schema (sections, textareas, ratings, booleans)
- `Competencies` — assessed level vs. required level per competency
- `Development` — learning resources, career paths, gap report
- `Feedback` — request and give peer feedback
- `Notifications` — in-app notification list and preferences

*Manager*
- `Team` — direct reports, their goal attainment, who is overdue
- `EmployeeGoals` — one report's goals
- `Monitoring` — check-in cadence compliance, goals trending badly
- `Pips` — performance improvement plans

*HR / admin*
- `HrConsole` — weight gates, goal approval queues
- `ReviewAdmin` — cycle state machine (draft → open → calibration → closed), completion tracking, calibration table, sign-off
- `Analytics` — rating distribution, nine-box grid, rater comparison, calibration movement, trend, completion funnel
- `KpiLibrary`, `Setup` (6 tabs), `admin/FormBuilder`, `admin/CompetencyAdmin`, `admin/DevelopmentAdmin`

**Component vocabulary today** is thin — `Card`, `Stat`, `Button`, `Field`,
`Empty`, `Spinner`, `ErrorNote`, `AttainmentBar`, `GoalStateBadge`,
`StatusBadge`. Everything else is ad-hoc Tailwind on slate greys.

## 4. What is wrong with it

Be direct about this with the designer — the current UI is competent developer
default, not design.

1. **No hierarchy.** Every screen is a stack of equal-weight white cards on a
   grey page. Nothing tells you what matters. The most important number on a
   page looks the same as a form label.
2. **Navigation does not scale.** Thirteen flat tabs, with no grouping and no
   sense of "mine" vs. "my team's" vs. "the company's".
3. **Dense tables everywhere.** Calibration, team lists, monitoring and
   analytics are all raw `<table>`s. On a phone they scroll sideways.
4. **State is communicated only by small coloured text.** Goal states, review
   phases, PIP status, check-in health all look nearly identical.
5. **No empty-state or first-run design.** A new employee's first screen is four
   stat cards reading `0`, `0%`, `—`, `0` above a card saying "No goals yet for
   this period." Worse, the weight card renders in warning amber on an empty
   account — so the first thing a new joiner sees is a warning about a rule they
   have not yet had a chance to break.
6. **The review form is a wall.** It renders a JSON schema literally — every
   section expanded, every field the same size, no sense of progress through a
   long document.
7. **Analytics are the exception — do not rebuild them.** Walking the running
   app corrected an earlier claim in this brief. The rating distribution is a
   properly labelled bar chart per department, the nine-box is a real 3×3 grid
   with names in cells and labelled axes, and the "not shown on the grid" count
   is already a visible callout rather than a footnote. Each carries explanatory
   copy. **This is the best-designed part of the product**; raise the rest to
   meet it. What it still lacks is a considered type scale, colour system and
   responsive behaviour — the same things everything else lacks.
8. **No visual identity at all.** No typography choices, no colour beyond
   Tailwind slate/emerald/amber defaults, no density decisions.

## 5. Hard constraints

These are not preferences. Breaking them breaks the product.

- **Stack is fixed**: React 19, Tailwind v4, TanStack Query. No component
  library may be introduced without approval — no MUI, no Chakra, no shadcn
  wholesale. Tailwind utility classes plus our own primitives.
- **No external network at runtime.** The office LAN has no internet. No Google
  Fonts, no CDN, no remote icon service. Fonts must be self-hosted or system
  stacks; icons must be inline SVG.
- **The API shape is settled.** Do not design screens that need data the API
  does not return. If a design needs new data, call it out explicitly as a
  dependency rather than assuming it.
- **Row-level security is real.** A manager sees only their subtree; a peer's
  employee record is invisible. Designs must never assume a global directory,
  an org-wide people picker, or "see who else got a 4".
- **Reviews must print.** A signed-off review is an HR record; there is an
  existing `no-print` convention. Keep a deliberate print stylesheet.
- **Accessibility**: keyboard-navigable, visible focus, WCAG AA contrast. Some
  users are on old office monitors at 1366×768.
- **Data protection**: this system deliberately stores no statutory identifiers,
  addresses, birthdates or salary. Do not design profile pages with them.

## 6. What good looks like

- An employee opening the app knows within two seconds what is being asked of
  them and when it is due.
- A manager can see, without clicking, which of their people need attention.
- HR can run a review cycle without a spreadsheet on the side.
- The nine-box and rating distribution are readable by an executive who will
  look at them for thirty seconds.
- The whole thing feels calm. This is a system people use during a stressful,
  political process — performance review season. It should reduce the
  temperature, not raise it.

Reference points worth stealing from: Linear (density and keyboard focus),
Stripe Dashboard (data presentation without noise), GitHub's PR review flow
(long forms with a sense of progress). Explicitly *not* Workday.

## 7. What to produce

1. **Design system**: type scale, colour (semantic tokens for goal/review/PIP
   states, not raw palette names), spacing, elevation, density rules, focus and
   error styling, dark mode decision (yes or no, with a reason).
2. **Navigation model** that scales past 13 destinations and expresses
   "mine / my team / the company".
3. **High-fidelity designs** for the six screens that carry the product:
   `MyGoals`, `GoalDetail`, `Team`, `ReviewForm`, `ReviewAdmin` (calibration and
   sign-off), `Analytics` (nine-box + distribution).
4. **Component specs** for the primitives listed in §3, plus whatever new ones
   the designs need — with states: default, hover, focus, disabled, loading,
   error, empty.
5. **Responsive behaviour** for each of the six screens at 375px, 768px, 1366px.
   Specifically: what happens to every table.
6. **Empty, loading and error states** for each of the six.
7. **Print layout** for a signed-off review.

Deliver as annotated designs plus a written spec — the spec is what gets
implemented, so it matters more than the pictures.

---

## 8. Prompt

> You are designing the UI for an on-premise HR performance management system
> used by a Philippine IT company of ~30 staff. The full brief is above: read it
> before proposing anything.
>
> The existing interface is functional but visually undesigned — flat cards, 13
> tabs in one row, dense unstyled tables, and state communicated only by small
> coloured text. I want a genuine design pass, not a re-skin.
>
> Start by proposing the **design system and the navigation model**, and show me
> `MyGoals` and `ReviewAdmin` at high fidelity as proof the system works for both
> the simplest and the densest screen in the product. Wait for my feedback before
> designing the remaining four screens.
>
> Constraints that cannot be broken: React 19 + Tailwind v4 only, no component
> library, no external fonts/CDN/icon services (the office has no internet),
> WCAG AA, must work at 1366×768, and reviews must print cleanly.
>
> Where a design would need data the API does not currently return, say so
> explicitly instead of assuming it.

---

## Appendix A — what the API actually returns

The brief asks you not to design screens that need data the API does not
return. That is only a fair instruction if you can see what it *does* return, so
here are the real shapes for the six screens in scope.

Money and percentages arrive as **strings**, not numbers — they are exact
decimals in the database and are not rounded through a float on the way out.
Anything nullable is genuinely null in normal operation, and the design has to
say what that looks like.

### 1. MyGoals — `GET /dashboards/employee/:periodId`, `GET /employees/me/goals`

```ts
EmployeeDashboard {
  summary: {
    totalGoals: number; draft: number; pendingApproval: number; active: number;
    totalWeight: string;                 // "100" — flagged when it is not
    weightedAttainment: string | null;   // null until something is measured
  };
  needsCheckin: { id; title; dueOn: string | null;
                  lastCheckinOn: string | null; daysSinceCheckin: number }[];
}

Goal {
  id; goalPeriodId; employeeId; employeeName;
  title; description: string | null;
  weight: string; dueOn: string | null;
  state: 'draft' | 'pending_approval' | 'active' | 'achieved' | 'missed' | 'cancelled';
  parentGoalId: string | null;
  kpiCode: string | null; kpiDefinitionVersion: number | null;
  approvedBy: string | null; approvedAt: string | null;
  attainmentPct: string | null;
  latestStatus: 'on_track' | 'at_risk' | 'off_track' | null;
  latestCheckinAt: string | null;
  targets?: GoalTarget[];
}
```

**Six goal states**, not three — the current UI badges them all identically.
`latestStatus` is null for a goal never checked in on, which is a different and
more urgent state than `on_track`, and the design should distinguish them.

### 2. GoalDetail — `GET /goals/:id`, `GET /goals/:id/checkins`

```ts
GoalTarget {
  id; sequence: number; measureName: string;
  measureType: 'numeric' | 'percentage' | 'currency' | 'ratio' | 'milestone' | 'boolean';
  direction: 'higher_is_better' | 'lower_is_better';
  baselineValue: string | null; targetValue: string;
  actualValue: string | null; actualAsOf: string | null;
}

Checkin {
  id; reportedValue: string | null; progressPct: string | null;
  statusFlag: 'on_track' | 'at_risk' | 'off_track';
  comment: string | null; evidenceUrl: string | null;
  periodEnding: string;      // the period covered, not when it was written
  createdAt: string; checkedInBy: string;
}
```

A goal can carry **several targets**, each with its own direction. A design that
assumes one number per goal will not survive contact.

`periodEnding` and `createdAt` differ, sometimes by weeks. Showing only one of
them has misled people already.

### 3. Team — `GET /dashboards/manager/:periodId`

```ts
ManagerDashboard {
  team: { employeeId; employeeName; goalCount: number; totalWeight: string;
          attainment: string | null; offTrack: number; atRisk: number;
          awaitingApproval: number }[];
  atRisk: [...];
}
```

`awaitingApproval` is the manager's own queue — those goals do not count until
they act. It deserves more prominence than a number in a table cell.

### 4. ReviewForm — `GET /reviews/:id`

```ts
ReviewInstance {
  id;
  reviewerRole: 'self' | 'supervisor' | 'calibrator';
  state: 'not_started' | 'in_progress' | 'submitted' | 'returned';
  overallRating: string | null; returnedReason: string | null;
  subjectName: string; cycleName: string;
  schema: { sections: { key; title; description?; fields: FormField[] }[] };
  ratingPoints: { value: number; label: string; description: string | null }[];
  responses: Record<string, unknown>;
}

FormField {
  key; label;
  type: 'rating' | 'text' | 'textarea' | 'select' | 'multiselect'
      | 'number' | 'boolean' | 'goal_review';
  required: boolean; helpText?: string; options?: string[]; maxLength?: number;
}
```

**The form is data, not markup.** HR builds it, so section count, field count and
ordering all vary — the design must be a renderer for arbitrary schemas, not a
layout for one known form.

`ratingPoints` comes from the cycle's own scale. **Do not hardcode 1–5**; a
scale may have a different number of points and every point carries a label and
optional description that should be visible when choosing.

`state: 'returned'` with `returnedReason` is a real path the current UI barely
shows: the reviewer must see why it came back.

### 5. ReviewAdmin — `GET /review-cycles`, `GET /review-cycles/:id/summaries`

```ts
Cycle {
  id; name; state: 'draft' | 'open' | 'calibration' | 'closed';
  opensOn; closesOn; goalPeriodId: string | null;
  phases: { phaseType: string; opensOn: string; closesOn: string }[];
}

Summary {
  id; subjectEmployeeId; subjectName; department: string | null;
  overallRating: string | null; calibratedRating: string | null;
  goalAttainmentPct: string | null;
  releasedAt: string | null; signedOffAt: string | null; acknowledgedAt: string | null;
  potentialRating: number | null;
  instanceCount: number; submittedCount: number;
}
```

This is the densest screen in the product and the one to prove a design system
against. Per row: a name, two ratings that may differ, an attainment bar, a
potential picker, a progress fraction, and an **irreversible** sign-off action
that is disabled until `submittedCount === instanceCount`.

Four cycle states drive which controls exist at all. The state machine is
one-way.

### 6. Analytics — `GET /analytics/cycles/:id/*`

```ts
Distribution {
  scale: { min: number | null; max: number | null };   // the cycle's own scale
  rows: { department: string; rating: number; employeeCount: number; pctOfGroup: number }[];
}

NineBox {
  employees: NineBoxEmployee[];
  grid: Record<string, NineBoxEmployee[]>;             // keyed "perf:potential"
  unplaced: { noRating: number; noPotential: number };
}

Rater { reviewerEmployeeId; reviewerName; reviewsSubmitted: number;
        averageRating: number; groupAverage: number; deviation: number }

Movement { subjectEmployeeId; employeeName; department;
           originalRating: number; calibratedRating: number; movement: number }

Progress { subjects; instances; submitted; returned;
           calibrated; signedOff; acknowledged }
```

`unplaced` must be **visible in the design, not a footnote**. People with no
rating or no potential are counted rather than dropped, because a nine-box that
silently shrinks is how the chart lies. If the grid shows 18 of 27 people, the
design has to say so.

`scale` is per cycle. Band against it rather than assuming five points, or
historical cycles render wrongly.

### Things the API does not give you

Design around these absences, or flag them as dependencies:

- **No avatars or photos.** No image is stored for anyone.
- **No global people directory.** Row-level security means a peer's record is
  invisible; an org-wide people picker cannot be built.
- **No free-text search across employees.** No such endpoint exists.
- **No unread/read state on notifications** beyond what the list returns.
- **No salary, statutory identifiers, birthdate, address or contact details** —
  these are deliberately absent and will not be added ([D-009], [D-014]).
