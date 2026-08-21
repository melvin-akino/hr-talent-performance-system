# Handoff: HR Performance System UI

## Overview
Complete UI design for the HR Performance System — goal tracking, check-ins, review cycles (self-review, calibration, sign-off), team management, analytics, and supporting admin screens. Built on the Industry design system.

## About the Design Files
The files in this bundle are **design references built in HTML** (`hr-performance-design.dc.html`) — an interactive prototype showing intended layout, states, and behavior. It is not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (its framework, component library, routing, data layer) — or, if no environment exists yet, choose the most appropriate stack and implement there.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and component treatment are final, taken from the bound Industry design system tokens (`industry-styles.css`). Recreate pixel-accurately using the codebase's own component library, pulling exact values from the token file rather than eyeballing.

## Screens / Views

Sidebar nav: three groups — **Mine** (My goals, Reviews, Competencies, Development, Feedback), **My team** (Team, Monitoring, PIPs — manager/HR only), **Company** (HR console, Review cycles, Analytics, KPI library, Setup — HR only). A role switch (Employee / Manager / HR) at the top of the sidebar controls which groups render; see the `Component` class's `renderVals()` for the exact per-role visibility logic.

1. **My Goals** — goal cards with weight, due date, attainment progress bar, and status (on track / at risk / off track / never checked in). Toggle between populated and empty-account states. "Needs your attention" card surfaces at-risk/off-track/never-checked-in goals, sorted with "never checked in" first.
2. **Goal Detail** — measures table (baseline → target → actual, direction-labeled), check-in history and a new check-in field.
3. **Team** — awaiting-approval and needs-attention summary cards, team roll-up table (goals, weight, attainment, flags).
4. **Review Form (self-review)** — collapsible sections with per-section answered-field counts, dynamic rating scale (renders whatever scale the cycle defines, not hardcoded), "returned with comments" banner state.
5. **Review Admin** — cycle phase tags (Draft/Open/Calibration/Closed), subject/submitted/calibrated/signed-off counts, a table with editable calibrated rating (shows up/down arrow only when it differs from overall), potential dropdown, and sign-off gated on full submission with a confirm dialog. Locked rows can't be un-signed-off.
6. **Analytics** — rating distribution stacked bars per department (accent ramp steps 1–5, not new hues), 9-box grid, and an explicit "not shown on the grid" count for unrated/no-potential employees.
7. **Competencies** — assessed-vs-required bars per competency, gap flag when assessed < required.
8. **Development** — gap report, learning resources list, career path breadcrumb.
9. **Feedback** — request-feedback action, received-feedback list.
10. **Notifications** — reverse-chronological list, deliberately no read/unread state (not backed by the API).
11. **Monitoring** — 6-week check-in cadence grid per report, "trending badly" flag.
12. **PIPs** — milestone checklist per active PIP with start/end dates.
13. **HR console** — weight-gate list (goals not at 100% weight), goal approval queue.
14. **KPI library** — KPI code/name/measure type/version/status table.
15. **Setup** — settings shell with rating-scale editor as the active pane.

## Components (from the Industry design system)
`.card.blueprint` + four `<i class="corner tl/tr/bl/br">` marks for every card/panel — hairline border, no fill, square corners, "+" registration marks. `.btn-primary/.btn-secondary/.btn-ghost` (primary is the one solid accent-filled object). `.tag-accent/.tag-neutral/.tag-outline` for status labels. `.table` for data tables. `.seg`/`.seg-opt` for the role switch and view toggles. `.dialog-backdrop`/`.dialog` for the sign-off confirmation. Barlow Condensed headings over Barlow body text; single steel-blue accent (`#5980a6`) with its OKLCH tonal ramp — no invented colors, status color is always carried by icon + tag, never a new hue.

## Interactions & Behavior
- Role switch (Employee/Manager/HR) changes which sidebar groups render — no page reload, immediate.
- Sign-off button disabled per-row until `submittedCount === instanceCount`; once signed off, the row locks (calibrated input + potential dropdown disabled) with no reversal path.
- Calibrated-rating movement arrow (up/down) only shows when calibrated ≠ overall rating.
- Check-in "never checked in" ranks above "at risk"/"off track" in the attention list — treated as more urgent, not less.
- Empty-goals account shows no warnings (nothing has been violated yet); the 100%-weight tag only appears once at least one goal exists.
- Self-review sections are collapsible (native `<details>`), each showing an answered/total field count.

## State Management
Prototype state (for reference — replace with real data fetching):
- `role`: employee | manager | hr — drives nav visibility.
- `screen`: current route/view.
- Per-screen local state: `mgView` (My Goals populated/empty toggle), `rows` (Review Admin calibration table, with per-row `submitted`, `instances`, `calibrated`, `potential`, `signedOff`), `dialogFor` (sign-off confirmation target), `rfSelectedRating`/`rfReturned` (Review Form).

## Design Tokens
Pull all values from `industry-styles.css` in this bundle — do not hardcode. Key tokens: `--color-bg` #f2f2f3, `--color-text` #1d1f20, `--color-accent` #5980a6 (100–900 OKLCH ramp), `--font-heading` Barlow Condensed, `--font-body` Barlow, `--space-*` scale (0.85× density), `--radius-*` (4px base), `--shadow-sm/md/lg`.

## Assets
No photographs/icons beyond inline Lucide SVGs (stroke-width 1.5) drawn directly in the prototype markup.

## Files in this bundle
- `hr-performance-design.dc.html` — the full interactive prototype (all 21 screens, nav, role switch).
- `industry-styles.css` — Industry design system tokens and component classes referenced above.
- `design-handoff.md` — original UI brief: current-state audit, screens, data shapes, API appendix.
- `current-state.md` — notes from walking the running application.
- `decisions.md` — architecture decision record referenced for data model and business rules.
- `architecture.md`, `feature-roadmap.md`, `infra.md`, `pilot-runbook.md`, `roadmap.md` — supporting product/engineering context.
