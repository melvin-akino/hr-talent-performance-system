import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLASSIFICATION, assertScoringValid, classificationsOf, pointsFor,
  ratingFraction, scoreResponses, totalFor,
} from '../src/reviews/scoring';
import {
  CLIENT_FORMATS, CLIENT_METRICS, combinedTemplate, formatTemplate, sectionTotal,
} from '../src/reviews/client-templates';

/**
 * Point-weighted form scoring (client requirements §3).
 *
 * These run without a database on purpose: the rules are arithmetic, and
 * arithmetic deserves tests that execute in milliseconds so they are run.
 *
 * The centrepiece is the client's own instrument. If their page-3 template
 * cannot be expressed and validated here, the abstraction is wrong — so it is
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

describe('the two prepared formats (B3)', () => {
  it('each totals 100 on its own, with no classification needed', () => {
    // The reason there are two single-column templates rather than one
    // two-column form: each scores without anyone first deciding which column
    // applies to the person, which is R6 and unanswered.
    for (const format of CLIENT_FORMATS) {
      const schema = formatTemplate(format.classification);
      expect(() => assertScoringValid(schema)).not.toThrow();
      expect(classificationsOf(schema)).toEqual([DEFAULT_CLASSIFICATION]);
      expect(totalFor(schema, DEFAULT_CLASSIFICATION)).toBe(100);
    }
  });

  it('keeps the client splits: 70/30 technical, 60/40 admin', () => {
    expect(sectionTotal('performance', 'technical')).toBe(70);
    expect(sectionTotal('attendance_demeanor', 'technical')).toBe(30);
    expect(sectionTotal('performance', 'admin')).toBe(60);
    expect(sectionTotal('attendance_demeanor', 'admin')).toBe(40);
  });

  it('measures both kinds of role on exactly the same metrics', () => {
    // The failure this prevents. Two hand-written templates drift, and the
    // drift is invisible -- both still total 100, and only the list differs, so
    // two people's scores quietly stop being comparable.
    const keys = (classification: 'technical' | 'admin') =>
      formatTemplate(classification)
        .sections.flatMap((sec) => sec.fields.map((f) => `${sec.key}.${f.key}`));

    expect(keys('technical')).toEqual(keys('admin'));
    expect(keys('technical')).toHaveLength(
      CLIENT_METRICS.reduce((n, sec) => n + sec.metrics.length, 0));
  });

  it('makes every line required', () => {
    // A 100-point instrument with an optional line is not a 100-point
    // instrument: the total would depend on how much the evaluator filled in.
    for (const format of CLIENT_FORMATS) {
      for (const section of formatTemplate(format.classification).sections) {
        for (const field of section.fields) expect(field.required).toBe(true);
      }
    }
  });

  it('gives every metric a human label, not a key', () => {
    for (const section of CLIENT_METRICS) {
      expect(section.title).not.toBe('');
      for (const m of section.metrics) {
        expect(m.label).toBeTruthy();
        expect(m.label).not.toBe(m.key);
      }
    }
  });
});

describe("the client's own template", () => {
  it('validates, and both columns total 100', () => {
    expect(() => assertScoringValid(clientTemplate)).not.toThrow();
    expect(totalFor(clientTemplate, 'technical')).toBe(100);
    expect(totalFor(clientTemplate, 'admin')).toBe(100);
  });

  it('splits 70/30 for technical and 60/40 for admin, as their page states', () => {
    // Worth asserting separately from the total: two columns can both reach 100
    // while the split between the two parts is wrong, and the split is what the
    // client's document actually specifies.
    const part = (key: string, classification: string) =>
      totalFor(
        { ...clientTemplate, sections: clientTemplate.sections.filter((s) => s.key === key) },
        classification);

    expect(part('performance', 'technical')).toBe(70);
    expect(part('attendance_demeanor', 'technical')).toBe(30);
    expect(part('performance', 'admin')).toBe(60);
    expect(part('attendance_demeanor', 'admin')).toBe(40);
  });

  it('catches a single mistyped point value', () => {
    // The failure this exists for. One 15 that should be 10 is invisible by
    // eye and silently rescores everyone evaluated on the form.
    const typo = structuredClone(clientTemplate);
    typo.sections[0]!.fields[1]!.points = { technical: 15, admin: 15 };

    expect(() => assertScoringValid(typo)).toThrow(/admin totals 105/);
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
