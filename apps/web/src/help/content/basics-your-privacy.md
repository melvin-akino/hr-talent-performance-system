---
id: your-privacy
title: Your privacy — what is stored and who can see it
summary: Exactly which fields exist, which deliberately do not, and who can read your records.
section: basics
audience: [everyone]
routes: ["/"]
keywords: [privacy, data, personal, tin, sss, philhealth, pagibig, confidential, who can see, RA 10173, data privacy act]
order: 2
---

Performance records are sensitive in a way that is easy to underestimate. A
rating is not embarrassing because it might leak to a competitor; it is
embarrassing because it might leak to the person sitting next to you. The system
is built around that.

## What is stored about you

- Your name, employee number and work email
- Your department, position, job family and level
- Your hire date and employment type
- Who you report to, and since when
- Your goals, check-ins, reviews, ratings, competency assessments and feedback

That is the complete list.

## What is deliberately not stored

None of the following exists anywhere in this system:

| Not stored | |
|---|---|
| TIN, SSS, PhilHealth, Pag-IBIG numbers | Statutory identifiers belong in payroll |
| Home address, birthdate, gender, civil status | Not needed to run a review |
| Personal contact numbers, emergency contacts | |
| Dependants | |
| Salary, allowances, any compensation figure | |
| Leave balances, medical records, NBI or PEME status | |

This is enforced, not merely intended. When HR imports staff from a 201 file,
every one of those columns is discarded, and the import report lists exactly
what it dropped. An automated test checks every field in the database for these
values on every single build, and the build fails if any of them appear.

The reasoning is simple: **data that is never collected cannot be leaked.**

## Who can see your records

Access is enforced by the database itself, not by hiding buttons in the
interface. What you cannot see, you cannot reach — including by guessing a URL.

- **You** see your own goals, check-ins, reviews and assessments.
- **Your manager** sees yours, and everyone below them in the reporting line.
  Your manager's own manager sees you too.
- **Your colleagues** see nothing of yours. A peer cannot look up your goals,
  your rating, or your competency assessment.
- **HR** sees the organisation, because running a review cycle requires it.
- **Nobody in another company** can see anything, even when the system is shared.

Two consequences worth knowing:

- **Feedback you give is attributed.** When a colleague requests feedback, your
  name is attached to your response. This is not an anonymous channel — say
  things you are willing to own.
- **A released review cannot be unreleased.** Once HR signs off, the rating is
  final and visible to you. That is deliberate: a rating that could quietly
  change afterwards would be worthless.

## Your rights

Under the Data Privacy Act (RA 10173) you may ask what is held about you and ask
for corrections. In practice you can see almost all of it on your own screens.
For anything else, ask HR — they are the data controller here, not the system.
