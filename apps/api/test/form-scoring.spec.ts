import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLASSIFICATION, assertScoringValid, classificationsOf, pointsFor, totalFor,
} from '../src/reviews/scoring';

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

/** The client's default template, exactly as their page 3 states it. */
const clientTemplate = {
  scoring: { maxPoints: 100, classifications: ['technical', 'admin'] },
  sections: [
    {
      key: 'performance',
      fields: [
        { key: 'mastery', type: 'rating', points: { technical: 10, admin: 10 } },
        { key: 'efficiency', type: 'rating', points: { technical: 15, admin: 10 } },
        { key: 'productivity', type: 'rating', points: { technical: 15, admin: 10 } },
        { key: 'team_cooperation', type: 'rating', points: { technical: 10, admin: 10 } },
        { key: 'supervisor_assessment', type: 'rating', points: { technical: 20, admin: 20 } },
      ],
    },
    {
      key: 'attendance_demeanor',
      fields: [
        { key: 'attendance', type: 'rating', points: { technical: 10, admin: 10 } },
        { key: 'seminars', type: 'rating', points: { technical: 5, admin: 10 } },
        { key: 'tenure', type: 'rating', points: { technical: 5, admin: 10 } },
        { key: 'policy_compliance', type: 'rating', points: { technical: 10, admin: 10 } },
      ],
    },
  ],
};

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
