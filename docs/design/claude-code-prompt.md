# Prompt for Claude Code

Implement the HR Performance System UI in this codebase, using the approved design as reference.

## What to reference

- `HR Performance - Design Proposal.dc.html` — an HTML/React design prototype covering all 21 screens (My Goals, Goal Detail, Team, Reviews/self-review, Review Admin, Analytics, Competencies, Development, Feedback, Notifications, Monitoring, PIPs, HR console, KPI library, Setup) plus the sidebar nav (grouped Mine / My team / Company, with a role switch for Employee/Manager/HR visibility).
- `uploads/docs/design-handoff.md`, `uploads/docs/design/current-state.md`, `uploads/docs/decisions.md`, `uploads/docs/architecture.md`, `uploads/docs/feature-roadmap.md`, `uploads/docs/infra.md`, `uploads/docs/pilot-runbook.md`, `uploads/docs/roadmap.md` — product/engineering context: data shapes, API appendix, architecture decisions, and rollout plan the design was built against.
- `_ds/industry-*/styles.css` and `_ds/industry-*/readme.md` — the Industry design system tokens (colors, type, spacing, the `.blueprint`/corner-mark card and button treatment) the prototype is styled with.

## Important: this is a design reference, not production code

The `.dc.html` file is a prototype built to show layout, states, and interaction — it is not code to copy verbatim. Recreate these screens **in this codebase's existing stack** (its framework, component library, routing, and data-fetching patterns) with pixel-accurate fidelity to the prototype's layout, spacing, typography, and colors. Pull exact values (hex colors, spacing, font stack, corner-mark/blueprint styling) from the Industry `styles.css` tokens rather than eyeballing the screenshot.

## Scope

1. Sidebar navigation: three groups (Mine / My team / Company), visibility driven by the current user's role (employee / manager / HR admin) — see the role-switch logic in the prototype's `Component` class for exactly which groups/items show per role.
2. Build all 21 screens listed above with their states as prototyped:
   - My Goals: populated + empty-account states, six goal states (draft/pending/active/achieved/missed/cancelled), four check-in health states (on track/at risk/off track/never checked in).
   - Review Admin: calibration table with sign-off gated on `submittedCount === instanceCount`, locked once signed off, confirm dialog before signing.
   - Review Form: collapsible sections with per-section answered-field counts, dynamic rating scale (don't hardcode 1–5), "returned" state banner.
   - Analytics: rating distribution stacked bars and 9-box grid, unplaced-count called out explicitly (not hidden).
   - The remaining 9 screens (Competencies, Development, Feedback, Notifications, Monitoring, PIPs, HR console, KPI library, Setup) are lighter passes — their design notes in the prototype flag open data-shape questions to confirm against the real API before finalizing.
3. Wire real data per the API/data shapes in `design-handoff.md` and `architecture.md`, replacing the prototype's mock data.

## Design notes carried over from the prototype (per-screen callouts)

Each screen section in the `.dc.html` file has a "Design notes" card listing specific rationale (e.g., why "never checked in" ranks above "at risk", why empty states don't show warnings, why sign-off has no un-sign-off path). Read and preserve that reasoning during implementation — it reflects decisions already validated with design.

## Acceptance

- Visual fidelity to the prototype's layout/spacing/type/color (Industry design system tokens).
- All listed states are reachable and correctly gated per the business rules called out in the design notes.
- No new colors, status colors, or components invented outside the Industry system.
