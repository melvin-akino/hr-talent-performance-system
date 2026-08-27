# Follow-up questions after the HCM KPI workbook

**Round 2.** Please read this together with the earlier list — it replaces part
of it rather than repeating it.

We have gone through `20260819 hcm kpi only.xlsx` in detail. It is much more
concrete than the 5-page requirements, and it **answers several of our earlier
questions outright**, so please do not spend time on those. It also raises a
small number of sharper ones, and one of them now blocks more work than anything
else we have asked.

---

## What the workbook already answered — no reply needed

| Earlier question | Settled by |
|---|---|
| **Q3** — how the weights 1 / 1.5 / 2 work | `hcm kpi` rows 15–18: they are the **nature of the task** — Administrative 1, Field 1.5, Technical 2. The conversion is the banded table in rows 20–24. |
| What happens when too few evaluators respond | `20260616`: notify **HCM C&B**, "for insufficient evaluation data gathered". |
| How ranks are structured | `HCM TO`: ranks are **numbered 6–11**, already ordered. |
| Whether there is a defined evaluation cadence | `hcm kpi` rows 12–13: monthly scores → quarterly tally → PIP coaching at end of Q1 → two quarters averaged, on a 6-month cycle. |
| How peer/evaluator routing is decided | `HCM TO` rows 34–50: the Tier 1–5 matrix per section. |

Thank you — these were the ones costing us the most guesswork.

---

## The one question that blocks the most work

### R1. Is the quarterly task tally measured against each role's own target?

The band table converts task points into the KPI score:

> 71–80 → 10  ·  81–90 → 20  ·  91–100 → 30  ·  100 up → 35

The scorecards, though, are drawn to different totals. Taking the monthly target
× 3 months, as rows 12–13 describe:

| Scorecard | Monthly target | × 3 months | Lands in | Score |
|---|---|---|---|---|
| Onboarding 1 (Bianca) | 37 | 111 | 100 up | **35** |
| Screening (Patricia, Hannah, Harrison, Dave) | 33 | 99 | 91–100 | **30** |
| Onboarding 2 (Jhordane) | 25 | 75 | 71–80 | **10** |
| Area Coordinator (Charlie, Christopher, Charissa, JM, Jesse) | 81.5 | 244.5 | *off the table* | — |

Read literally, Jhordane earns 10 and Bianca earns 35 for doing **everything on
their own scorecard**, and the Area Coordinators score off the end of the scale.
The difference comes from how each scorecard was drawn, not from performance.

So which is intended?

- **(a)** The tally is converted to a percentage of that role's own target first,
  then banded — so full performance always lands in 91–100 regardless of
  scorecard size; or
- **(b)** The bands are absolute, and the scorecards are meant to be rebalanced
  so every role totals roughly 33 points a month; or
- **(c)** Something else — for instance Area Coordinators being scored on a
  different basis.

Everything numeric in the KPI evaluation depends on this answer.

---

## Where the workbook and the 5-page document disagree

Three points where we need to know which is current.

### R2. How many peer/360 evaluators?

Four different figures are now in play:

| Source | Figure |
|---|---|
| 5-pager, page 1 | "min. 2 personnel" |
| 5-pager, page 2 | "min 3 feedbacks" |
| 5-pager, page 4 | "min 3 reviews; max 5" |
| **Workbook** `hcm kpi` row 9 | **"Peer/Superior feedback (2pax)"**, "2 colleagues will be required for averaging" |

Is 2 the HCM-specific number and 3–5 the rule for branch staff, or has it changed
to 2 across the board?

### R3. What makes up the 40 points?

- **5-pager:** 40 = Performance, drawn from the competency library.
- **Workbook:** 40 = **30 task indicators + 10 manager's assessment**, under the
  heading "Competency".

These are different systems, not different wordings. The workbook's version is
the one with a full task catalogue and fifteen worked scorecards behind it, so we
assume it governs — please confirm.

### R4. How do the numbered ranks map to the named ones?

`HCM TO` uses **Rank 6–11**. The 5-pager lists Associate, Branch Head / OIC,
Jr / Sr Supervisor, Dept Head, GM. We need the mapping, because "1 rank up, 2
ranks up" in the peer rules has to be computed from it.

Also: does the numbering run **group-wide** — so a Rank 8 in Motorcycle is
equivalent to a Rank 8 in the Hotel — or is it per division?

---

## New questions raised by the workbook

### R5. Is subordinate evaluation in scope?

`20260616` routes evaluations to "peer, **subordinate**, superior", which reads as
settled. But `HCM TO` (far right of row 47) says "evaluate possibility of allowing
his/her subordinates to perform the evaluation", which reads as still under
discussion.

Upward evaluation is a significant design decision — it changes who is invited,
and it raises the anonymity question (our earlier **Q5**, still open and still
important) much more sharply, because a subordinate's review of their own manager
is far easier to identify.

### R6. Task natures: A / F / T, or four categories?

The workbook classifies every task as **A**dministrative, **F**ield or
**T**echnical. The 5-pager's competency library lists Admin, Technical, **Ops**
and Field. Has Ops been dropped, merged into Field, or is it used elsewhere?

### R7. "Selection of Subject … by salary level"

`20260616` lists salary level as one of the ways to select who gets evaluated.

This system deliberately stores **no salary data at all** — that was a founding
decision, and a test fails the build if salary appears anywhere. If "salary
level" means a **pay grade or band** (a label like "Rank 8" or "SG-12"), we can
support it. If it means an actual amount, we cannot, and we would need to discuss
selecting by grade instead.

### R8. The band table's edges

Two gaps in rows 20–24:

- The table starts at **71**. What score does someone at **70 or below** receive —
  zero, or is there a floor?
- **"100 up → 35"** exceeds the 30 points that row 6 allocates to the KPI
  component. Is 35 a deliberate over-achievement bonus, and if so may the overall
  evaluation exceed 100?

### R9. The timeline's year and its second half

The `timeline` sheet runs March to July by week, but names no year — and the last
three phases (**Testing & Devt**, **Initial Run**, **Program Prep 2**) have no bars
drawn, so we cannot tell when they are meant to happen.

Given the workbook is dated August 2026, is this a plan for **2027**, or a record
of work already done?

---

## R10 — a formula in `hcm kpi` misses two of its own lines

**Attendance Processing & Payroll.** The target in `D132` is
`=SUM(D133:D159)`, which gives 33. But the block continues past row 159: rows
160 and 161 carry **Crafts Design** (2 points) and **Activity Organizing** (2
points), both plainly part of the same scorecard.

Summing every line in the block gives **37**, not 33.

So one of two things is true, and we cannot tell which:

- the **target is right at 33** and those two tasks belong to a different
  scorecard, or were added without updating the total; or
- the **lines are right** and the target should read 37.

We have loaded all 29 lines with a target of 37, on the reasoning that dropping
two real tasks to satisfy a formula would be the wrong way round — but it is
your number, so please confirm.

Worth a check across the other fourteen scorecards at the same time: this is the
kind of error a copied SUM range produces more than once, and every one of them
shifts somebody's score.

---

## R11 — six tasks are spelled two ways

Loading the catalogue turned up pairs of entries that are plainly the same piece
of work under two spellings. Left as they are, each pair splits one task into
two, and any comparison of the same work across sections silently understates
it.

| Spelling A | Spelling B |
|---|---|
| `Govt Liaison` (4 lines) | `Gov't Liaison` (1) |
| `Issue/Concern Intake` (12) | `Issue/ Concern Intake` (1) |
| `Payments processing` (20) | `Payments Processing` (catalogue only) |
| `Concern Follow-up` (1) | `Concern Followup` (1) |
| `Dox Tracking/ Dox Filing` (1) | `Dox Tracking/Dox Filing` (1) |
| `Info Dissemination` (13) | `Info Dissem` (1) |

We have loaded both spellings rather than merging them on our own judgement,
because a merge is not reversible once people are scored against it. Confirm
that each pair is one task and we will collapse them to the spelling you prefer.

---

## Still open from the first round

These were not touched by the workbook and still need answers:

- **Q1 / Q2** — the incentive bands: exactly 70 is uncovered, and the 81–90 row
  reads "80% or 30%".
- **Q5** — anonymity of peer reviews. Now more pressing, see R5.
- **Q7** — probationary timing when regularisation moves.
- **Q8** — the attendance feed: which payroll system, and at what grain.
- **Q9** — what branch ranking is calculated from.
- **Q10** — whether Type IV uses the standard template.

---

## One suggestion

The workbook is a near-complete specification for the HCM department: real
scorecards, real targets, named staff, and the routing rules. We would like to
propose building **HCM first as a working pilot**, against your own numbers, and
generalising to the other divisions afterwards.

It would let you see the scoring behave on data you recognise — which is usually
the fastest way to find out whether a rule such as R1 was written as intended.
