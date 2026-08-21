---
id: configuring-the-system
title: Forms, scales, competencies and the KPI library
summary: How versioning protects reviews already in flight, and what publishing freezes.
section: administering
audience: [hr_admin]
routes: ["/setup", "/kpis", "/competencies"]
keywords: [form, template, builder, rating scale, version, publish, competency framework, KPI, library, configuration]
order: 51
---

One principle runs through all of this: **definitions are versioned, and
anything already issued keeps the version it was issued under.**

So editing a form does not change reviews already in progress, and a competency
framework used in last year's cycle still reads as it did then. This is what
makes a signed-off review trustworthy a year later — it cannot quietly change
because someone tidied a template.

## Review forms

A form template holds versions; a version holds the sections and fields.

- Build and edit freely **before** publishing.
- Publishing makes a version usable by a cycle.
- Reviews snapshot the version they were generated with. Publishing a new
  version affects future reviews only.

**Assignment** decides who gets which form. The organisation-wide default is the
assignment with no employment type and no role — without one, `resolve` returns
nothing and every employee is skipped at generation. Use the resolve tool on the
Setup screen to check a specific person before you open a cycle.

## Rating scales

A scale is a set of points with values and labels. Attach it to a form version.

Changing a scale mid-cycle is the fastest way to make a distribution
meaningless — 4-out-of-5 and 4-out-of-6 are not comparable, and analytics band
against the cycle's own scale precisely so historical cycles stay readable.
Create a new version instead.

## Competency frameworks

A framework holds competencies, each with levels and a written behavioural
indicator per level.

**Publishing freezes the framework.** Get the content right first — the levels
are what assessors read, and vague indicators produce meaningless assessments.
Write behaviours that describe scope ("weighs trade-offs across a system"), not
effort ("works hard on design").

Map required levels to positions afterwards. Without that mapping there is no
gap report, because there is nothing to compare an assessment against.

## The KPI library

Definitions are versioned here too, and a goal snapshots the version it used.

The library is a convenience, not a constraint: employees can write goals
outside it. Its value is consistency — everyone measuring "escaped defects" the
same way.

Set the direction correctly. A cost or defect KPI must be *lower is better*; the
wrong direction inverts every attainment calculated from it, and it will not be
obvious until someone queries a suspiciously excellent result.

## Departments, positions and reference data

Departments, positions, job families and employment types are managed on Setup.

Two settings have consequences beyond their screen:

- **Employment type review eligibility** determines who is included in a cycle.
- **Position** drives competency requirements and career paths, so a wrong
  position produces a wrong gap report.
