# Current UI — observed state

Notes taken while walking the running application with the ACME demo data,
signed in as Maria Reyes (CEO **and** HR admin, so every screen is reachable).
Companion to [design-handoff.md](../design-handoff.md); this records what the
screens actually look like rather than what the code suggests.

Screenshots were captured at 1366×768. They are not committed — the capture
tooling returned images rather than files — so attach the ones from the
conversation, or re-take them with the walkthrough below.

## Walkthrough used

```
pnpm dev                       # api on 3000, web on 5273
http://localhost:5273          # sign in as maria / test1234
```

| # | Screen | Route |
|---|---|---|
| 1 | MyGoals (empty state) | `/` |
| 2 | GoalDetail | `/goals/:id` — via Team → "Reduce escaped defects" |
| 3 | Team | `/team` |
| 4 | Reviews list | `/reviews` |
| 5 | ReviewForm | `/reviews/:id` — "My self review" |
| 6 | ReviewAdmin | `/review-admin` |
| 7 | Analytics | `/analytics` |

## What the screens actually show

**MyGoals** — for Maria this is entirely empty: four stat cards reading 0, 0%,
—, 0, then a card saying "No goals yet for this period." It is the weakest
first impression in the product and it is what a new joiner sees. Note the stat
card "TOTAL WEIGHT 0% / must total 100% before lock" is rendered in warning
amber on an empty account, so the very first screen shows a warning about a
rule the user has not yet had a chance to break.

**GoalDetail** — genuinely good bones. Header with state badge, weight, due and
approved dates; a Measures table showing baseline → target → actual with
direction and an attainment bar; then a check-in form. The measures table is
the clearest thing in the application and the design should keep its logic.

**Team** — three stacked cards: "Awaiting my approval (0)", "Needs attention
(2)" with off-track/at-risk badges, and a "Team roll-up" table with attainment
bars and flags. The information is right; the hierarchy is flat, so an empty
approval queue occupies the same visual weight as two people going off track.

**Reviews** — "To complete", "Submitted", and "My reviews" as three equal cards.

**ReviewForm** — renders the JSON schema literally: every section expanded,
every textarea the same height, rating rendered as five side-by-side buttons
labelled "1 — Does not meet" … "5 — Outstanding". No progress indication, no
sense of length. This is the screen the brief describes as "a wall".

**ReviewAdmin** — the densest screen, and the one to prove a design system
against. Cycle selector, three action buttons, four stat cards, then a table of
eight employees with: name + department, "1/2 submitted" progress, goal
attainment, rating, an editable calibrated-rating input, a potential dropdown,
and a disabled "Sign off" button per row. Seven interactive columns.

**Analytics** — better than expected. Rating distribution is a labelled bar
chart per department with real explanatory copy ("The shape matters more than
the average…"). The nine-box is a proper 3×3 grid with names in cells, coloured
red/green, axes labelled Below/Meets/Exceeds and Well placed/Growth/High
potential, and the unplaced note is rendered as a visible amber callout
("Not shown on the grid: 1 with no rating…"). Rater comparison shows deviation
with signed values.

The brief calls analytics "debug output". That is too harsh — **the analytics
are the best-designed part of the product** and the redesign should raise the
rest to meet them rather than replace them.

## Defects found while walking it

Both are independent of the redesign. The first is fixed; the second is open.

### 1. Scroll position is not reset on route change — FIXED

Navigating from a scrolled page landed the new route at the previous scroll
offset. Going from a scrolled Team page to `/goals/:id` rendered what appeared
to be a completely blank screen — the content was there, 900px above the
viewport. It read as a broken page, and happened most on exactly the screens
with the most content.

React Router only restores scroll in a data router, via `<ScrollRestoration />`.
This app uses `BrowserRouter` with `<Routes>`, so the behaviour is supplied by
[`components/ScrollToTop.tsx`](../../apps/web/src/components/ScrollToTop.tsx),
mounted once in `App.tsx`.

Two deliberate exceptions: **POP** navigations (back/forward) keep the browser's
own restored offset, so nobody loses their place in a list they just backed out
of; and a URL **hash** is left alone, since the fragment target owns the
position.

Verified in the running app:

| Navigation | Before | After |
|---|---|---|
| Analytics (scrolled 800) → Team, in-app click | 800 | **0** |
| Back to Analytics | 0 | **800** (restored) |

### 2. "My reviews" offers Acknowledge on an unreleased review

For an HR admin, an unsigned review summary appears under "My reviews" with
rating "—" and an active **Acknowledge** button, directly under copy saying
"Reviews about you appear here once they have been signed off and released."

The cause is not an RLS failure: the page relies on the database hiding
unreleased summaries from the subject, which holds for a normal employee. An
HR admin sees every summary in the organisation through their admin grant,
including their own unreleased one.

**Severity: low, cosmetic.** The API guards the mutation with
`AND released_at IS NOT NULL`, so pressing the button fails server-side —
nothing can be acknowledged early. The fix is to filter the list on
`releasedAt` in the page rather than relying on visibility.

## Notes for whoever re-takes the screenshots

- Window resizing through the automation did not change the rendered viewport,
  so **the mobile captures were not taken**. Use browser devtools device
  emulation at 375px for the responsive evidence — the tables on ReviewAdmin
  and Team are the ones worth capturing.
- Maria has no goals of her own. For a populated `MyGoals`, sign in as
  **paolo** (two goals, one trending badly) or **grace** (weights total 80%, so
  the HR weight gate flags her).
- Goal attainment reads "not measured" for every row on ReviewAdmin in the demo
  data, because the demo's review cycle is not linked to goal results for those
  employees. Do not read that as a bug in the screen.
