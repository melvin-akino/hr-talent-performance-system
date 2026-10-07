import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLASSIFICATION, assertScoringValid, classificationsOf, pointsFor,
  ratingFraction, scoreResponses, totalFor,
} from '../src/reviews/scoring';
import {
  CLIENT_FORMATS, PART_MAX, PASSING_FLOOR, PEF_PARTS, SUPERSEDED_FORMAT_CODES,
  WEIGHTS_ARE_PROVISIONAL, combinedTemplate, formatTemplate, indicatorPoints, sectionTotal,
} from '../src/reviews/client-templates';
import { formSchema } from '../src/reviews/forms.service';

/**
 * Point-weighted form scoring (client requirements §3).
 *
 * These run without a database on purpose: the rules are arithmetic, and
 * arithmetic deserves tests that execute in milliseconds so they are run.
 *
 * The centrepiece is the client's own instrument. If their Performance Evaluation
 * Form cannot be expressed and validated here, the abstraction is wrong — so it is
 * built from their real numbers rather than a convenient invention.
 */

/**
 * The client's own instrument, imported from the module that SEEDS it rather
 * than transcribed again here.
 *
 * It was a local fixture until B3. Two copies of a hundred points is exactly
 * the arrangement where the seeded form and the tested form drift apart, and
 * the drift is invisible: both still total 100, and only the split is wrong.
 */
const clientTemplate = combinedTemplate();

describe('the three prepared formats (Performance Evaluation Form, Dec 2025)', () => {
  it('each totals 100 on its own, with no classification needed', () => {
    // The reason there is one single-column template per classification rather
    // than one three-column form: each scores without anyone first deciding
    // which column applies to the person, and that is not recorded anywhere yet.
    expect(CLIENT_FORMATS.map((f) => f.classification)).toEqual(['sales', 'service', 'admin']);
    for (const format of CLIENT_FORMATS) {
      const schema = formatTemplate(format.classification);
      expect(() => assertScoringValid(schema)).not.toThrow();
      expect(classificationsOf(schema)).toEqual([DEFAULT_CLASSIFICATION]);
      expect(totalFor(schema, DEFAULT_CLASSIFICATION)).toBe(100);
    }
  });

  it("keeps the form's splits: Sales 70/30, Service 60/40, Admin 70/30", () => {
    // Printed in the PIP form's Parameter Guide. Admin matching Sales is not a
    // typo: the 5-pager put Admin at 60/40, and this form moved that split to
    // Service. Pinned on purpose, because it is the change most likely to be
    // "corrected" back by someone who remembers the old document.
    expect(sectionTotal('part_1', 'sales')).toBe(70);
    expect(sectionTotal('part_2', 'sales')).toBe(30);
    expect(sectionTotal('part_1', 'service')).toBe(60);
    expect(sectionTotal('part_2', 'service')).toBe(40);
    expect(sectionTotal('part_1', 'admin')).toBe(70);
    expect(sectionTotal('part_2', 'admin')).toBe(30);
  });

  it('measures every classification on exactly the same indicators', () => {
    // The failure this prevents. Hand-written templates drift, and the drift is
    // invisible — all three still total 100, and only the list differs, so two
    // people's scores quietly stop being comparable.
    const keys = (c: 'sales' | 'service' | 'admin') =>
      formatTemplate(c).sections.flatMap((sec) => sec.fields.map((f) => `${sec.key}.${f.key}`));

    expect(keys('sales')).toEqual(keys('service'));
    expect(keys('sales')).toEqual(keys('admin'));
  });

  it('has five indicators in each of two parts, as the form does', () => {
    expect(PEF_PARTS.map((p) => p.key)).toEqual(['part_1', 'part_2']);
    for (const part of PEF_PARTS) expect(part.indicators).toHaveLength(5);
    expect(PEF_PARTS[0]!.indicators.map((i) => i.label)).toEqual([
      'Output / Performance', 'Skills / Mastery', 'Efficiency and Productivity',
      'Teamwork and Commitment', "Supervisor's Assessment",
    ]);
    expect(PEF_PARTS[1]!.indicators.map((i) => i.label)).toEqual([
      'Attendance', 'Office Reporting', 'Training and Skills Enhancement',
      'Attitude and Decorum', 'Tenure',
    ]);
  });

  it('makes every rated line required', () => {
    // A 100-point instrument with an optional line is not a 100-point
    // instrument: the total would depend on how much the evaluator filled in.
    for (const format of CLIENT_FORMATS) {
      for (const section of formatTemplate(format.classification).sections) {
        for (const field of section.fields.filter((f) => f.type === 'rating')) {
          expect(field.required, field.key).toBe(true);
        }
      }
    }
  });

  it('gives every rated line a descriptor for every rating, 1 to 5', () => {
    // The descriptors ARE the instrument. A line missing one is a rating two
    // supervisors will read differently while both following the form.
    for (const part of PEF_PARTS) {
      for (const ind of part.indicators) {
        expect(Object.keys(ind.anchors).sort(), ind.key).toEqual(['1', '2', '3', '4', '5']);
        for (const text of Object.values(ind.anchors)) expect(text.trim()).not.toBe('');
      }
    }
    // And they reach the published form, not just this module.
    const rated = formatTemplate('sales').sections
      .flatMap((s) => s.fields).filter((f) => f.type === 'rating');
    expect(rated).toHaveLength(10);
    for (const f of rated) expect(Object.keys(f.anchors ?? {})).toHaveLength(5);
  });

  it('gives every indicator an optional remarks box, as the printed form does', () => {
    const fields = formatTemplate('admin').sections.flatMap((s) => s.fields);
    for (const part of PEF_PARTS) {
      for (const ind of part.indicators) {
        const remarks = fields.find((f) => f.key === `${ind.key}_remarks`);
        expect(remarks, `${ind.key} has no remarks box`).toBeDefined();
        expect(remarks!.type).toBe('textarea');
        expect(remarks!.required).toBe(false);
        expect(remarks!.points).toBeUndefined();   // evidence, not a score
      }
    }
  });

  it('gives every metric a human label, not a key', () => {
    for (const part of PEF_PARTS) {
      for (const m of part.indicators) {
        expect(m.label).toBeTruthy();
        expect(m.label).not.toBe(m.key);
      }
    }
  });

  it('weights indicators equally while the weights are provisional', () => {
    // The form prints what a PART is worth and not what an INDICATOR is, so the
    // weights are our assumption. This pins the assumption, so that changing one
    // weight without flipping WEIGHTS_ARE_PROVISIONAL fails loudly instead of
    // quietly turning an estimate into something that looks confirmed.
    expect(WEIGHTS_ARE_PROVISIONAL).toBe(true);
    expect(indicatorPoints('sales', 'part_1')).toBe(14);
    expect(indicatorPoints('sales', 'part_2')).toBe(6);
    expect(indicatorPoints('service', 'part_1')).toBe(12);
    expect(indicatorPoints('service', 'part_2')).toBe(8);
  });

  it('says it is provisional exactly while it is', () => {
    for (const format of CLIENT_FORMATS) {
      expect(/PROVISIONAL/.test(format.description)).toBe(WEIGHTS_ARE_PROVISIONAL);
    }
  });

  it('keeps the old instrument out of the new codes', () => {
    for (const format of CLIENT_FORMATS) {
      expect(SUPERSEDED_FORMAT_CODES as readonly string[]).not.toContain(format.code);
    }
  });
});

describe('the passing floors', () => {
  it('are the form’s printed numbers', () => {
    // From the Parameter Guide on the PIP form. Transcribed once, asserted here.
    expect(PASSING_FLOOR).toEqual({
      sales:   { part_1: 42, part_2: 18 },
      service: { part_1: 36, part_2: 24 },
      admin:   { part_1: 42, part_2: 18 },
    });
  });

  it('are exactly 60% of their part, for every classification', () => {
    // A cross-check on the transcription rather than a rule we imposed: four
    // numbers read off a photograph that all land on the same proportion is
    // very unlikely to be four separate misreadings.
    for (const c of ['sales', 'service', 'admin'] as const) {
      for (const part of ['part_1', 'part_2'] as const) {
        expect(PASSING_FLOOR[c][part]).toBeCloseTo(PART_MAX[c][part] * 0.6, 10);
      }
    }
  });

  it('are reached by rating every indicator 3, whatever the weights turn out to be', () => {
    // The reason the floors can be trusted while the weights cannot. A rating
    // scores as value / scale maximum, so an all-3s evaluation earns 60% of
    // every part — and 60% of a part is its floor — for ANY split of the part's
    // points across its indicators.
    for (const format of CLIENT_FORMATS) {
      const schema = formatTemplate(format.classification);
      const threes = new Map(
        PEF_PARTS.flatMap((p) => p.indicators).map((i) => [i.key, 3] as const));
      const result = scoreResponses(schema, threes, DEFAULT_CLASSIFICATION, 5);

      for (const part of result.sections) {
        expect(part.earned, `${format.code} ${part.key}`).toBeCloseTo(part.floor!, 10);
        expect(part.meetsFloor).toBe(true);
      }
    }
  });

  it('fail a part rated all 2s, and the other part is judged on its own', () => {
    const schema = formatTemplate('sales');
    const answers = new Map<string, number>();
    for (const i of PEF_PARTS[0]!.indicators) answers.set(i.key, 2);   // Part 1 weak
    for (const i of PEF_PARTS[1]!.indicators) answers.set(i.key, 5);   // Part 2 perfect

    const r = scoreResponses(schema, answers, DEFAULT_CLASSIFICATION, 5);
    const [p1, p2] = r.sections;
    expect(p1!.earned).toBe(28);           // 2/5 of 70
    expect(p1!.meetsFloor).toBe(false);
    expect(p2!.earned).toBe(30);
    expect(p2!.meetsFloor).toBe(true);
    // The total is 58 out of 100 — and says nothing about WHICH part failed.
    // That is the reason the parts are reported separately.
    expect(r.earned).toBe(58);
  });

  it('score full marks for all 5s, and a fifth of the points for all 1s', () => {
    for (const format of CLIENT_FORMATS) {
      const schema = formatTemplate(format.classification);
      const keys = PEF_PARTS.flatMap((p) => p.indicators).map((i) => i.key);
      const best = scoreResponses(schema, new Map(keys.map((k) => [k, 5])), DEFAULT_CLASSIFICATION, 5);
      const worst = scoreResponses(schema, new Map(keys.map((k) => [k, 1])), DEFAULT_CLASSIFICATION, 5);
      expect(best.earned).toBe(100);
      // The bottom of the scale is still an answer, not zero.
      expect(worst.earned).toBe(20);
    }
  });

  it('are refused when no one could reach them', () => {
    const bad = formatTemplate('sales');
    (bad.scoring.passing as Record<string, number>).part_1 = 71;   // Part 1 is only worth 70
    expect(() => assertScoringValid(bad)).toThrow(/Nobody could pass it/);
  });

  it('are refused when they name a section the form does not have', () => {
    const bad = formatTemplate('sales');
    (bad.scoring.passing as Record<string, number>).part_9 = 10;
    expect(() => assertScoringValid(bad)).toThrow(/no such section/);
  });

  it('carry per-classification floors on the combined form', () => {
    const combined = combinedTemplate();
    expect(() => assertScoringValid(combined)).not.toThrow();
    const sales = scoreResponses(combined, new Map(), 'sales', 5);
    const service = scoreResponses(combined, new Map(), 'service', 5);
    expect(sales.sections.map((s) => s.floor)).toEqual([42, 18]);
    expect(service.sections.map((s) => s.floor)).toEqual([36, 24]);
  });

  it('do not appear on a section with no declared floor', () => {
    // No floor is not the same as passing. The absence of `floor` says so.
    const unfloored = scoreResponses(
      { scoring: { maxPoints: 10 },
        sections: [{ key: 'a', fields: [{ key: 'x', type: 'rating', points: 10 }] }] },
      new Map([['x', 5]]), DEFAULT_CLASSIFICATION, 5);
    expect(unfloored.sections[0]).toEqual({ key: 'a', earned: 10, available: 10 });
  });
});

describe("the client's combined template", () => {
  it('validates, and every column totals 100', () => {
    expect(() => assertScoringValid(clientTemplate)).not.toThrow();
    for (const c of ['sales', 'service', 'admin']) {
      expect(totalFor(clientTemplate, c)).toBe(100);
    }
  });

  it('splits each part as the form states, per classification', () => {
    // Worth asserting separately from the total: columns can all reach 100 while
    // the split between the parts is wrong, and the split is what the form
    // actually specifies.
    const part = (key: string, classification: string) =>
      totalFor(
        { ...clientTemplate, sections: clientTemplate.sections.filter((s) => s.key === key) },
        classification);

    expect(part('part_1', 'sales')).toBe(70);
    expect(part('part_2', 'sales')).toBe(30);
    expect(part('part_1', 'service')).toBe(60);
    expect(part('part_2', 'service')).toBe(40);
    expect(part('part_1', 'admin')).toBe(70);
    expect(part('part_2', 'admin')).toBe(30);
  });

  it('catches a single mistyped point value', () => {
    // The failure this exists for. One 14 that should be 12 is invisible by eye
    // and silently rescores everyone evaluated on the form.
    const typo = structuredClone(clientTemplate);
    typo.sections[0]!.fields[0]!.points = { sales: 14, service: 14, admin: 14 };

    expect(() => assertScoringValid(typo)).toThrow(/service totals 102/);
  });
});

describe('field anchors', () => {
  const base = { key: 'q', label: 'Q', type: 'rating' as const };

  it('are accepted on a rating, keyed by the rating value', () => {
    expect(() => formSchema.parse({
      sections: [{ key: 's', title: 'S', fields: [{ ...base, anchors: { 5: 'Best', 1: 'Worst' } }] }],
    })).not.toThrow();
  });

  it('are refused on anything that is not a rating', () => {
    // A descriptor for a rating value on a text box describes nothing, and would
    // be silently ignored by every renderer.
    expect(() => formSchema.parse({
      sections: [{ key: 's', title: 'S',
        fields: [{ ...base, type: 'textarea', anchors: { 5: 'Best' } }] }],
    })).toThrow(/only a rating field may carry them/);
  });

  it('must be keyed by a number', () => {
    expect(() => formSchema.parse({
      sections: [{ key: 's', title: 'S', fields: [{ ...base, anchors: { best: 'Best' } }] }],
    })).toThrow(/keyed by the rating value/);
  });

  it('may not be blank', () => {
    expect(() => formSchema.parse({
      sections: [{ key: 's', title: 'S', fields: [{ ...base, anchors: { 5: '  ' } }] }],
    })).toThrow();
  });

  it('are optional, so every form built before they existed is still valid', () => {
    expect(() => formSchema.parse({
      sections: [{ key: 's', title: 'S', fields: [base] }],
    })).not.toThrow();
  });

  it('survive the round trip into a published form', () => {
    // formatTemplate() must produce something formSchema accepts as it stands,
    // or the first provision of a new organisation fails on the very form the
    // client declared official.
    for (const format of CLIENT_FORMATS) {
      expect(() => formSchema.parse(formatTemplate(format.classification))).not.toThrow();
    }
    expect(() => formSchema.parse(combinedTemplate())).not.toThrow();
  });
});

describe('forms without points', () => {
  const plain = {
    sections: [{ key: 'overall', fields: [{ key: 'comments', type: 'textarea' }] }],
  };

  it('are still valid — every form built before scoring existed is one', () => {
    expect(() => assertScoringValid(plain)).not.toThrow();
  });

  it('may not claim a total they do not compute', () => {
    expect(() => assertScoringValid({ ...plain, scoring: { maxPoints: 100 } }))
      .toThrow(/declares a scoring total but no field carries points/);
  });
});

describe('refusals', () => {
  it('rejects points with no declared total', () => {
    expect(() => assertScoringValid({
      sections: [{ key: 's', fields: [{ key: 'a', type: 'rating', points: 10 }] }],
    })).toThrow(/does not say what they add up to/);
  });

  it('rejects points on a field whose answer is never stored', () => {
    // goal_review and competency_review write their answers elsewhere, so points
    // on them would be unscoreable — and silently so.
    expect(() => assertScoringValid({
      scoring: { maxPoints: 10 },
      sections: [{ key: 's', fields: [{ key: 'goals', type: 'goal_review', points: 10 }] }],
    })).toThrow(/cannot carry points/);
  });

  it('rejects points on a number, which has no target to be a fraction of', () => {
    // Allowed when points were introduced, before anything computed a score.
    // Narrowed once it became clear there was no conversion rule to apply.
    expect(() => assertScoringValid({
      scoring: { maxPoints: 10 },
      sections: [{ key: 's', fields: [{ key: 'count', type: 'number', points: 10 }] }],
    })).toThrow(/cannot carry points/);
  });

  it('rejects points on free text, which computes nothing', () => {
    expect(() => assertScoringValid({
      scoring: { maxPoints: 10 },
      sections: [{ key: 's', fields: [{ key: 'why', type: 'textarea', points: 10 }] }],
    })).toThrow(/cannot carry points/);
  });

  it('rejects a classification a field forgot, rather than scoring it zero', () => {
    // Omission and a deliberate zero are indistinguishable to the arithmetic and
    // completely different to the author, so the author has to say which.
    expect(() => assertScoringValid({
      scoring: { maxPoints: 10, classifications: ['technical', 'admin'] },
      sections: [{ key: 's', fields: [{ key: 'a', type: 'rating', points: { technical: 10 } }] }],
    })).toThrow(/gives no points for admin.*Write 0 if that is deliberate/s);
  });

  it('accepts an explicit zero for a line that does not apply', () => {
    expect(() => assertScoringValid({
      scoring: { maxPoints: 10, classifications: ['technical', 'admin'] },
      sections: [{
        key: 's',
        fields: [
          { key: 'a', type: 'rating', points: { technical: 10, admin: 0 } },
          { key: 'b', type: 'rating', points: { technical: 0, admin: 10 } },
        ],
      }],
    })).not.toThrow();
  });

  it('rejects a classification the form does not score for', () => {
    expect(() => assertScoringValid({
      scoring: { maxPoints: 10, classifications: ['technical'] },
      sections: [{
        key: 's',
        fields: [{ key: 'a', type: 'rating', points: { technical: 10, ops: 10 } }],
      }],
    })).toThrow(/gives points for ops, which this form does not score for/);
  });

  it('names every column that is wrong, not just the first', () => {
    // An author fixing one number at a time, told only about one at a time, is
    // how a form takes four attempts to publish.
    expect(() => assertScoringValid({
      scoring: { maxPoints: 100, classifications: ['technical', 'admin'] },
      sections: [{
        key: 's',
        fields: [{ key: 'a', type: 'rating', points: { technical: 90, admin: 80 } }],
      }],
    })).toThrow(/technical totals 90; admin totals 80/);
  });
});

describe('single-column forms', () => {
  const single = {
    scoring: { maxPoints: 100 },
    sections: [{
      key: 's',
      fields: [
        { key: 'a', type: 'rating', points: 60 },
        { key: 'b', type: 'rating', points: 40 },
      ],
    }],
  };

  it('need no classifications at all', () => {
    expect(() => assertScoringValid(single)).not.toThrow();
    expect(classificationsOf(single)).toEqual([DEFAULT_CLASSIFICATION]);
  });

  it('score every classification the same', () => {
    // A plain number is not "the default variant" — it applies to whoever is
    // being scored, whatever they are classified as.
    expect(pointsFor(60, 'admin')).toBe(60);
    expect(pointsFor(60, 'anything-at-all')).toBe(60);
  });

  it('still have to add up', () => {
    expect(() => assertScoringValid({
      ...single,
      sections: [{ key: 's', fields: [{ key: 'a', type: 'rating', points: 90 }] }],
    })).toThrow(/must total 100 points/);
  });
});

describe('pointsFor', () => {
  it('treats an absent field as worth nothing', () => {
    expect(pointsFor(undefined, 'admin')).toBe(0);
  });

  it('treats a classification missing from a map as zero', () => {
    // Validation refuses to publish such a form, but scoring must not throw if
    // one reaches it — a stored evaluation is read long after publication.
    expect(pointsFor({ technical: 10 }, 'admin')).toBe(0);
  });
});


describe('computing a score', () => {
  const form = {
    scoring: { maxPoints: 100, classifications: ['technical', 'admin'] },
    sections: [{
      key: 's',
      fields: [
        { key: 'efficiency', type: 'rating', points: { technical: 15, admin: 10 } },
        { key: 'mastery', type: 'rating', points: { technical: 10, admin: 10 } },
        { key: 'attendance', type: 'rating', points: { technical: 75, admin: 80 } },
      ],
    }],
  };

  it('scores a rating as its position on the scale, times the points', () => {
    // 4 out of 5 on a 15-point line is 12.
    const r = scoreResponses(form, new Map([['efficiency', 4]]), 'technical', 5);
    expect(r.lines.find((l) => l.key === 'efficiency')!.earned).toBe(12);
  });

  it('scores the same answer differently on the other column', () => {
    // The whole reason points are a map: 4/5 of a 10-point line is 8, not 12.
    const r = scoreResponses(form, new Map([['efficiency', 4]]), 'admin', 5);
    expect(r.lines.find((l) => l.key === 'efficiency')!.earned).toBe(8);
  });

  it('counts unanswered lines as available but not earned', () => {
    // A review with most lines blank is not a perfect score on the rest.
    const r = scoreResponses(form, new Map([['efficiency', 5]]), 'technical', 5);
    expect(r.earned).toBe(15);
    expect(r.available).toBe(100);
  });

  it('gives the bottom of the scale its share, not zero', () => {
    // Their sheet reads "10 pts" against "1 2 3 4 5". A 1 is worth 2 there.
    // Scoring it as zero would treat the lowest answer as no answer at all.
    const r = scoreResponses(form, new Map([['mastery', 1]]), 'technical', 5);
    expect(r.lines.find((l) => l.key === 'mastery')!.earned).toBe(2);
  });

  it('never exceeds the points available, whatever arrives', () => {
    // A 9 on a 1-5 scale is bad data, not a bonus.
    const r = scoreResponses(form, new Map([['mastery', 9]]), 'technical', 5);
    expect(r.lines.find((l) => l.key === 'mastery')!.earned).toBe(10);
  });

  it('treats a negative rating as the floor rather than a deduction', () => {
    const r = scoreResponses(form, new Map([['mastery', -3]]), 'technical', 5);
    expect(r.lines.find((l) => l.key === 'mastery')!.earned).toBe(0);
  });

  it('rounds to two decimals so identical reviews cannot differ in float dust', () => {
    // 1/3 of 10 is 3.3333...; two of them must agree exactly.
    const of = (r: { lines: { key: string; earned: number }[] }) =>
      r.lines.find((l) => l.key === 'mastery')!.earned;
    const a = scoreResponses(form, new Map([['mastery', 1]]), 'technical', 3);
    const b = scoreResponses(form, new Map([['mastery', 1]]), 'technical', 3);
    expect(of(a)).toBe(of(b));
    expect(of(a)).toBe(3.33);
  });

  it('ignores an answer of the wrong shape rather than guessing', () => {
    const r = scoreResponses(form, new Map([['mastery', 'excellent']]), 'technical', 5);
    expect(r.earned).toBe(0);
  });

  it('scores a boolean as all or nothing', () => {
    const yesNo = {
      scoring: { maxPoints: 10 },
      sections: [{ key: 's', fields: [{ key: 'promotable', type: 'boolean', points: 10 }] }],
    };
    expect(scoreResponses(yesNo, new Map([['promotable', true]]), DEFAULT_CLASSIFICATION, 5)
      .earned).toBe(10);
    expect(scoreResponses(yesNo, new Map([['promotable', false]]), DEFAULT_CLASSIFICATION, 5)
      .earned).toBe(0);
  });

  it('skips lines worth nothing on this column', () => {
    // A line scored 0 for admin should not appear in the admin breakdown at all.
    const oneSided = {
      scoring: { maxPoints: 10, classifications: ['technical', 'admin'] },
      sections: [{
        key: 's',
        fields: [
          { key: 'field_work', type: 'rating', points: { technical: 10, admin: 0 } },
          { key: 'paperwork', type: 'rating', points: { technical: 0, admin: 10 } },
        ],
      }],
    };
    const admin = scoreResponses(oneSided, new Map([['field_work', 5]]), 'admin', 5);
    expect(admin.lines.map((l) => l.key)).toEqual(['paperwork']);
    expect(admin.available).toBe(10);
  });

  it('survives a scale maximum of zero without dividing by it', () => {
    expect(ratingFraction(3, 0)).toBe(0);
  });
});
