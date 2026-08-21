// @vitest-environment jsdom
/**
 * The design system's components and the rules encoded in them.
 *
 * These are not screenshot tests — they assert the behaviour the design brief
 * argued for, so a future restyle cannot quietly drop it. Three things matter
 * most and are easy to lose in a refactor:
 *
 *   never-checked-in outranks at-risk everywhere attention is sorted,
 *   sign-off is gated and irreversible,
 *   status is carried by icon and word, never by an invented colour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  Attainment, Bar, Btn, Card, CheckinStatus, DeliveryStateTag, Dialog, EmptyState,
  GoalStateTag, ReviewStateTag, Stat, Tag, attentionRank, canSignOff, rampIndex,
} from '../src/components/ds';

afterEach(cleanup);

describe('check-in status', () => {
  it('names all four states, including the one with no data', () => {
    for (const [status, label] of [
      ['on_track', 'On track'],
      ['at_risk', 'At risk'],
      ['off_track', 'Off track'],
      [null, 'Never checked in'],
    ] as const) {
      cleanup();
      render(<CheckinStatus status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('treats undefined the same as null', () => {
    render(<CheckinStatus status={undefined} />);
    expect(screen.getByText('Never checked in')).toBeTruthy();
  });

  it('emphasises only the two states that need action', () => {
    const weight = (status: string | null) => {
      cleanup();
      const { container } = render(<CheckinStatus status={status} />);
      const span = container.querySelector('span span') as HTMLElement;
      return span.style.fontWeight;
    };
    expect(weight('at_risk')).toBe('600');
    expect(weight('off_track')).toBe('600');
    expect(weight('on_track')).toBe('');
    // "Never checked in" is urgent by rank, but shouting it on every unstarted
    // goal in the list would make the genuinely bad ones harder to spot.
    expect(weight(null)).toBe('');
  });
});

describe('attention ranking', () => {
  it('puts never-checked-in first, ahead of off track', () => {
    // The absence of information is worse than known-bad news: nobody has even
    // looked. This ordering is relied on by MyGoals and Team.
    const order = ['at_risk', null, 'on_track', 'off_track']
      .sort((a, b) => attentionRank(a) - attentionRank(b));
    expect(order).toEqual([null, 'off_track', 'at_risk', 'on_track']);
  });

  it('is stable for equal ranks', () => {
    expect(attentionRank('at_risk')).toBe(attentionRank('at_risk'));
  });
});

describe('goal state tags', () => {
  it('renders a distinct label for each of the six states', () => {
    const labels = ['draft', 'pending_approval', 'active', 'achieved', 'missed', 'cancelled']
      .map((state) => {
        cleanup();
        const { container } = render(<GoalStateTag state={state} />);
        return container.textContent;
      });
    expect(new Set(labels).size).toBe(6);
  });

  it('renders nothing for an unknown state rather than an empty badge', () => {
    const { container } = render(<GoalStateTag state="teleported" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('review state tags', () => {
  // These replaced a lookup map in which in_progress, submitted and returned all
  // resolved to the same classes. The appearance, not just the word, has to
  // differ — a reviewer scanning their inbox reads the badges, not the labels.
  it('renders four visually distinct states', () => {
    const rendered = ['not_started', 'in_progress', 'submitted', 'returned'].map((state) => {
      cleanup();
      const { container } = render(<ReviewStateTag state={state} />);
      return container.innerHTML;
    });
    expect(new Set(rendered).size).toBe(4);
  });

  it('gives returned and submitted different treatment', () => {
    // Returned needs action; submitted is finished. If these ever collapse into
    // each other, a reviewer cannot tell what is still theirs to do.
    const { container: returned } = render(<ReviewStateTag state="returned" />);
    const returnedHtml = returned.innerHTML;
    cleanup();
    const { container: submitted } = render(<ReviewStateTag state="submitted" />);
    expect(submitted.innerHTML).not.toBe(returnedHtml);
  });

  it('falls back to the humanised state name rather than an empty badge', () => {
    const { container } = render(<ReviewStateTag state="under_appeal" />);
    expect(container.textContent).toBe('under appeal');
  });
});

describe('delivery state tags', () => {
  // Verified here rather than on screen: the delivery history is empty on a
  // fresh install, so `sent` and `failed` looking identical — which they did —
  // is invisible until the day something actually fails.
  it('distinguishes sent from failed', () => {
    const { container: sent } = render(<DeliveryStateTag state="sent" />);
    const sentHtml = sent.innerHTML;
    cleanup();
    const { container: failed } = render(<DeliveryStateTag state="failed" />);
    expect(failed.innerHTML).not.toBe(sentHtml);
  });

  it('humanises an unknown state instead of dropping the row', () => {
    // The outbox has more states than these two — held_for_digest, retrying —
    // and a badge that renders nothing would read as "no state at all".
    const { container } = render(<DeliveryStateTag state="held_for_digest" />);
    expect(container.textContent).toBe('held for digest');
  });
});

describe('attainment', () => {
  it('says so plainly when nothing has been measured', () => {
    render(<Attainment pct={null} />);
    expect(screen.getByText('Not yet measured')).toBeTruthy();
  });

  it('treats an empty string as unmeasured, not as zero', () => {
    // The API returns exact decimals as strings; '' is absence, '0' is a real
    // and very different result.
    render(<Attainment pct="" />);
    expect(screen.getByText('Not yet measured')).toBeTruthy();
  });

  it('renders a measured zero as zero', () => {
    render(<Attainment pct="0" />);
    expect(screen.getByText('0% attained')).toBeTruthy();
  });

  it('reports beating the target without capping the number', () => {
    // Exceeding a target is a real result — especially for lower-is-better
    // measures — and rounding it down to 100 would misreport performance.
    render(<Attainment pct="128.4" />);
    expect(screen.getByText('128% attained')).toBeTruthy();
  });

  it('caps the bar at the track while leaving the number alone', () => {
    const { container } = render(<Bar pct={250} />);
    const fill = container.querySelector('div > div > div') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('never renders a negative bar', () => {
    const { container } = render(<Bar pct={-30} />);
    const fill = container.querySelector('div > div > div') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });
});

describe('sign-off gating', () => {
  it('allows sign-off only when every review is in', () => {
    expect(canSignOff({ instanceCount: 2, submittedCount: 2 })).toBe(true);
    expect(canSignOff({ instanceCount: 2, submittedCount: 1 })).toBe(false);
  });

  it('refuses a summary with no reviews generated', () => {
    // 0 === 0 is true, which is why this is a separate condition: an empty
    // summary is not a complete one, and signing it off would release a rating
    // nobody wrote.
    expect(canSignOff({ instanceCount: 0, submittedCount: 0 })).toBe(false);
  });

  it('refuses a summary already signed off', () => {
    expect(canSignOff({
      instanceCount: 2, submittedCount: 2, signedOffAt: '2026-08-15',
    })).toBe(false);
  });
});

describe('rating scale banding', () => {
  it('spreads a 1–5 scale across the ramp', () => {
    expect(rampIndex(1, 1, 5, 5)).toBe(0);
    expect(rampIndex(5, 1, 5, 5)).toBe(4);
  });

  it('spreads a six-point scale across the same ramp', () => {
    // The whole point: the cycle's own scale decides the banding, so a cycle
    // that used 1–6 still runs light to dark instead of clipping at 5.
    expect(rampIndex(1, 1, 6, 5)).toBe(0);
    expect(rampIndex(6, 1, 6, 5)).toBe(4);
  });

  it('handles a scale starting at zero', () => {
    expect(rampIndex(0, 0, 4, 5)).toBe(0);
    expect(rampIndex(4, 0, 4, 5)).toBe(4);
  });

  it('does not divide by zero when every rating is the same', () => {
    expect(rampIndex(3, 3, 3, 5)).toBe(4);
  });

  it('clamps a rating outside the declared scale', () => {
    expect(rampIndex(9, 1, 5, 5)).toBe(4);
    expect(rampIndex(-2, 1, 5, 5)).toBe(0);
  });
});

describe('dialog', () => {
  const open = (onDismiss = vi.fn()) => {
    render(
      <Dialog title="Sign off Ana?" onDismiss={onDismiss}
              actions={<button type="button">Confirm</button>}>
        This cannot be undone.
      </Dialog>,
    );
    return onDismiss;
  };

  it('is announced as a modal dialog with its title', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Sign off Ana?');
  });

  it('dismisses when the backdrop is clicked', () => {
    const onDismiss = open();
    fireEvent.click(screen.getByRole('presentation'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss when the dialog body is clicked', () => {
    // Losing a confirmation because the pointer strayed onto the text would be
    // maddening on an irreversible action.
    const onDismiss = open();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('cards and buttons', () => {
  it('renders a kicker and children', () => {
    render(<Card kicker="Measures">body text</Card>);
    expect(screen.getByText('Measures')).toBeTruthy();
    expect(screen.getByText('body text')).toBeTruthy();
  });

  it('no longer draws blueprint registration marks', () => {
    // Removed deliberately: they read as print crop marks on a working screen.
    // If they ever come back it should be a decision, not a regression.
    const { container } = render(<Card kicker="X">y</Card>);
    expect(container.querySelector('.corner')).toBeNull();
  });

  it('defaults buttons to type=button so they do not submit a form by accident', () => {
    render(<Btn>Check in</Btn>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('lets a caller opt into a submit button', () => {
    render(<Btn type="submit">Save</Btn>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit');
  });

  it('shows a stat with its tag', () => {
    render(<Stat kicker="Total weight" value="80%" tag={<Tag tone="outline">must total 100%</Tag>} />);
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('must total 100%')).toBeTruthy();
  });

  it('renders an empty state without any warning language', () => {
    const { container } = render(
      <EmptyState title="No goals set for this period yet">
        Nothing here is overdue — there is simply nothing yet.
      </EmptyState>,
    );
    expect(screen.getByText('No goals set for this period yet')).toBeTruthy();
    expect(container.textContent).not.toMatch(/must total|overdue\b(?! —)|warning|error/i);
  });
});

describe('the palette stays single-accent', () => {
  it('uses no green, red or amber anywhere in the rendered components', () => {
    // Status is carried by icon and word. A future contributor reaching for
    // "just one red" should fail here rather than in review.
    const { container } = render(
      <div>
        <CheckinStatus status="off_track" />
        <CheckinStatus status="at_risk" />
        <GoalStateTag state="missed" />
        <Attainment pct="42" />
        <Tag tone="accent">Active</Tag>
      </div>,
    );
    const html = container.innerHTML.toLowerCase();
    for (const banned of ['green', 'red', 'amber', 'emerald', 'crimson', '#f00']) {
      expect(html).not.toContain(banned);
    }
    expect(within(container).getByText('Off track')).toBeTruthy();
  });
});
