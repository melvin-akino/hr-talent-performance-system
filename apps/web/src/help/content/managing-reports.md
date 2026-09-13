---
id: reports
title: Building a report
summary: Filter evaluation history by person, source, type, period, unit or result — and share the result as a link.
section: managing
audience: [manager, hr_admin, hr_partner]
routes: ["/reports"]
keywords: [report, filter, export, csv, pip results, search, by name, period, download]
order: 44
---

The report screen answers questions that span people: *who in my section is on
an improvement plan*, *what happened in the last quarter*, *how did the
probationary evaluations go*.

It draws on exactly the same history as an individual's record — the two can
never disagree, because they are the same query asked two ways.

## The filters

| Filter | What it does |
|---|---|
| **Name or employee no.** | Matches the person, not the event. Searching for *Cruz* finds people called Cruz, not everybody in a cycle called "Cruz Branch Annual". |
| **From / To** | The period the event belongs to — a Q1 evaluation signed in May counts as Q1. |
| **Unit** | Includes everything underneath it. Filtering to a division reaches its sections, areas and branches. |
| **Source** | Reviews, task evaluations, improvement plans, competency assessments, employment events. |
| **Evaluation type** | Probationary, annual, semi-annual, project, KPI. |
| **Result** | A PIP outcome such as `successful`, or an exact score. |

:::note
**Evaluation type and source are not the same question.** The type comes from
the evaluation definition a review was run from, so filtering by type returns
reviews only — improvement plans and task evaluations have no type and are left
out. The screen says so when you pick one, because otherwise an empty report
reads as missing data.
:::

## Sharing what you found

The filters live in the address bar, so the link in your browser *is* the
report. Copy it into an email and the person who opens it sees the same
filters — scoped, of course, to what they are allowed to see.

That last part matters: sending somebody a report link does not send them the
data. They run it themselves, under their own permissions, and may get fewer
rows than you did.

:::tip
This is why the link is worth using instead of a screenshot. A screenshot is a
copy of confidential assessment that now lives in an inbox; a link is a question
the recipient answers with their own access.
:::

## Exporting

**Export CSV** gives you the same report as a file — the same filters, the same
rows. It is deliberately not a wider export: a file containing more than the
screen showed is the kind of surprise that ends up somewhere it should not be.

Both the screen and the file are capped. If a report was cut short you are told
so in as many words, because a report that silently stops is one somebody makes
a decision on.

## What you will see, and what you will not

:::diagram who-sees-what

The report is scoped by who you are, not by what you ask for. A Department Head
running it with no filters gets their section; HCM running the identical query
gets the company. Nothing is hidden by the screen — the data simply is not
yours to read, in the same way it would not be on any other screen.

A draft evaluation stays invisible to the person it is about here, exactly as it
does everywhere else.
