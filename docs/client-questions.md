# Questions on the performance management requirements

> **Partly superseded.** The HCM KPI workbook (2026-08-19) answered Q3 outright
> and changed Q4 and Q6. See **client-questions-round2.md**, which lists what is
> settled and what replaced it — send that one alongside this, not instead of it.

Thank you for the detailed requirements — they are unusually clear, and the point
tables are internally consistent, which tells us they are settled. We checked the
arithmetic and it holds:

- **Page 3** — Technical / Ops / Field: Part 1 (10+15+15+10+20 = 70) + Part 2
  (10+5+5+10 = 30) = **100**
- **Page 3** — Admin: Part 1 (10+10+10+10+20 = 60) + Part 2 (10+10+10+10 = 40) = **100**
- **Page 2** — Peer review: 5+5+5+10+5 = **30**, matching the 30-point peer
  component on page 1 exactly

The questions below are the points we cannot resolve from the document alone.
The first five block development — we would be guessing, and guessing wrong on
scoring means rebuilding it later. The rest we can design around for now, but
they will need answers before those parts are built.

---

## Index — where each question comes from

| # | Question | Your page | Section |
|---|---|---|---|
| **Q1** | Incentive bands leave 70 uncovered | **Page 1** | KPI [basis for incentives] — the band table |
| **Q2** | "80% or 30%" in the 81–90 band | **Page 1** | KPI [basis for incentives] — the band table |
| **Q3** | Score conversion cannot be reproduced | **Page 1** | Sample Scoring Table + "Uses score conversion" |
| **Q4** | Minimum peer reviewers: 2, 3 or 3–5? | **Pages 1, 2, 4** | KPI list / Peer Review / Notes for Peer Review |
| **Q5** | Are peer reviews anonymous? | **Pages 2 & 4** | Peer Review instrument; Notes for Peer Review *(not stated on either)* |
| **Q6** | Role names and who holds them | **Pages 1, 2, 5** | General System Features; Users Interface vs Access; Rank list |
| **Q7** | Probationary evaluation timing | **Pages 1 & 5** | Type I; Dates — Hired / Regularization |
| **Q8** | The attendance data feed | **Pages 1 & 3** | KPI 30-point line; Step 4c |
| **Q9** | Branch ranking basis | **Page 1** | Type II — "yearend bonuses, branch ranking" |
| **Q10** | Type IV evaluations — which form? | **Pages 1 & 3** | Type IV; default template header |
| — | Observation: two scoring models | **Pages 1 & 3** | KPI 40/30/30 vs the 100-point template |

---

## Blocking — we cannot start these until answered

### Q1. The incentive bands leave 70 uncovered

**Page 1**, under *KPI [basis for incentives]*, the band table:

> Below 70 → Not qualified
> 71 – 80 → 20%

A score of exactly **70** falls in neither. Should 70 be "not qualified", or the
bottom of the 20% band?

*(Scores will land on exactly 70 regularly, so the system needs a definite answer
rather than a default we choose.)*

---

### Q2. The 81–90 band reads "80% or 30%"

**Page 1**, same band table:

> 81 – 90 → 80% or 30%

Given that 71–80 earns 20% and 91–100 earns 50%, we read this as **30%** and the
"80" as a stray mark. Please confirm — if it really is 80%, the incentive curve
jumps from 20% to 80% and back down to 50%, which we assume is not intended.

---

### Q3. The score conversion is not reproducible from the sample table

**Page 1**, the *Sample Scoring Table* and the "Uses score conversion" note
directly beneath it. This is the one that blocks the most work.

The table gives:

- Weight: 1, 1.5 or 2
- Accomplishment: 0.5 or 1
- Score = Weight × Accomplishment
- Around 8 competencies

So the highest possible raw total is **8 × (2 × 1) = 16**. The note then says:

> Uses score conversion:
> 4 → for 40 max bearing
> 1.5 → for 30 max
> 1.0 → manager scoring

We cannot work out how a raw 16 becomes the 40 points of the KPI model (page 1),
or what the 1.5 and 1.0 lines apply to.

**What would settle it: one completed example with real numbers.** A single
employee's actual scoring sheet — the competencies, their weights, the
accomplishment values, and the final score out of 40 — would let us reproduce
your calculation exactly.

*Until this is answered, the entire KPI evaluation type (Type V, page 1) cannot
be built.*

---

### Q4. Minimum number of peer reviewers — the document says three different things

| Your page | Section | What it says |
|---|---|---|
| **Page 1** | KPI [basis for incentives] | "30 – Peer Review / Feedback (min. **2** personnel)" |
| **Page 2** | Peer Review / Eval / Feedback | "(Averaged / min. **3** feedbacks)" |
| **Page 4** | Notes for Peer Review, final line | "Target is min **3** reviews; max **5**" |

We assume **minimum 3, maximum 5**. Please confirm.

Related, from **page 4** — the six-month interaction question means some invited
reviewers will decline. If the system cannot find 3 eligible reviewers, should it
proceed with 2, hold the evaluation open, or notify HCM to intervene?

---

### Q5. Are peer reviews anonymous?

**Pages 2 and 4** — the peer review instrument and the parameter rules. Neither
states this either way.

Averaging several reviews into one score suggests anonymity is intended, but we
need it stated explicitly, because it decides what the system records and who can
ever see it:

- Can the **employee** being reviewed see who reviewed them, or only the average?
- Can their **supervisor** see individual reviewers and their scores?
- Can **HCM** see them?
- Can anyone see them **later**, when investigating a dispute?

This cannot be changed quietly afterwards. If reviews are anonymous, the system
must be built so the link genuinely cannot be recovered; if they are not, that has
to be visible to reviewers before they write, since it changes what people say.

---

## Needed soon — we can design around these, but not build them

### Q6. Confirm the roles and who holds them

Drawn from three places:

- **Page 1**, *General System Features*: "Dashboard features for user levels
  (HCM, DH, Supervisor, RH/AH)"
- **Page 2**, *Users Interface vs Access*: "Only HCM DM & CB PW can set / reset
  scoring parameters / fields"
- **Page 5**, *Rank*: "Associate, Branch Head / OIC, Jr/Sr Supervisor, Dept Head, GM"

Questions:

- What do **HCM DM** and **CB PW** stand for, and are they individual people or
  small groups?
- Are **RH** and **AH** the same level, or two different ones?
- Should the **GM** see everything in their Division, or everything company-wide?

We need the full list of levels, and for each: what they can see, and whose
records they can see it for.

---

### Q7. Probationary evaluation timing

**Page 1**, Type I: "Eval for probationary (3rd & 4th month → averaging)", read
together with **page 5**, *Dates*: "Date - Hired", "Date - Regularization".

Are the 3rd and 4th month measured from **date hired**?

And if someone's regularisation is moved — extended probation, or early
regularisation — should the system reschedule the outstanding evaluation, or
leave it on the original dates?

---

### Q8. The attendance data feed

**Page 1**, KPI: "30 – (15 No tardiness, 15 No absences) (HCM input from Payroll
system)", and **page 3**, Step 4c: "HCM – supplies Attendance info. (Absences,
Tardiness)".

- Which payroll system is it, and can it export on a schedule?
- What can it give us per employee, per period: **counts** (e.g. "2 late, 1
  absent"), or an already-calculated **score out of 15**?
- If counts, what is the rule that turns a count into points?

**Important:** this system deliberately holds no payroll or timekeeping data — no
salaries, no TIN/SSS/PhilHealth/Pag-IBIG numbers, no daily time records. We want
to keep it that way, so we would take only a summary figure per employee per
period, not the underlying attendance records. Please confirm that works on your
side.

---

### Q9. Branch ranking

**Page 1**, Type II: "Annual performance (yearend bonuses, branch ranking)".

Ranked on what?

- The average score of all staff in the branch?
- Only certain roles, or weighted by rank?
- Or a separate branch-level scorecard with its own measures?

---

### Q10. Type IV (Project / Term-based) evaluations

**Page 1**, Type IV: "Project / Term based (special, behavioral, corrective,
promotions)" — and **page 3**, where the default template is headed "Eval for
Probationary / Annual / Semi-Annual", which does not mention Type IV.

Do project/term evaluations use that same 100-point template, or do they get their
own form?

We would also like to understand who triggers one, and whether the result feeds
the same history and incentive calculations as the scheduled evaluations.

---

## One observation, not a question

**Pages 1 and 3.** The requirements describe **two different scoring models**, and
we have planned for both:

1. **Page 3** — Probationary / Annual / Semi-annual use the 100-point template:
   Part 1 Performance (60 or 70 points depending on classification) plus Part 2
   Attendance & Demeanor (40 or 30).
2. **Page 1** — KPI uses 40 Performance + 30 Attendance + 30 Peer Review.

If that is a misreading and there is meant to be a single model, it is much better
to know now than after both are built.
