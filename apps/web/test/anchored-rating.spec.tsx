// @vitest-environment jsdom
/**
 * The rubric rating (Performance Evaluation Form, Dec 2025).
 *
 * What is worth pinning is not the look but the behaviour a restyle could
 * quietly lose: that the sentence is what the evaluator chooses between, that
 * it reads best-first as the printed form does, that a missing sentence degrades
 * to the scale's label instead of a blank row, and that a submitted review still
 * shows the answer that was given.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnchoredRating, type RatingPoint } from '../src/components/AnchoredRating';

afterEach(cleanup);

const scale: RatingPoint[] = [1, 2, 3, 4, 5].map((value) => ({
  value, label: `Scale ${value}`, description: null,
}));

const anchors = {
  5: 'Always exceeds target',
  4: 'Sometimes exceeds target',
  3: 'Meets target',
  2: 'Sometimes does not meet target',
  1: 'Does not meet target',
};

const show = (over: Partial<Parameters<typeof AnchoredRating>[0]> = {}) => render(
  <AnchoredRating
    name="Output / Performance" points={scale} anchors={anchors}
    value={undefined} readOnly={false} onChange={() => {}} {...over}
  />,
);

describe('the rubric rating', () => {
  it('offers the indicator’s own sentence for each value, not the scale label', () => {
    show();
    expect(screen.getByText('Always exceeds target')).toBeTruthy();
    expect(screen.getByText('Does not meet target')).toBeTruthy();
    // The org-wide label is NOT what the evaluator is choosing between.
    expect(screen.queryByText('Scale 5')).toBeNull();
  });

  it('lists best first, as the printed form does', () => {
    // Even when the scale arrives in ascending order — which it does.
    show();
    const rows = screen.getAllByRole('radio').map((r) => r.textContent);
    expect(rows).toEqual([
      '5Always exceeds target', '4Sometimes exceeds target', '3Meets target',
      '2Sometimes does not meet target', '1Does not meet target',
    ]);
  });

  it('reports the chosen value', () => {
    const onChange = vi.fn();
    show({ onChange });
    fireEvent.click(screen.getByRole('radio', { name: /Meets target/ }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('marks the current answer as checked, and only that one', () => {
    show({ value: 4 });
    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]!.textContent).toContain('Sometimes exceeds target');
  });

  it('is a labelled group, so a screen reader announces which indicator it is rating', () => {
    show();
    expect(screen.getByRole('radiogroup', { name: 'Output / Performance' })).toBeTruthy();
  });

  it('keeps the number readable, because the number is the answer', () => {
    show();
    expect(screen.getByRole('radio', { name: /5.*Always exceeds target/ })).toBeTruthy();
  });

  it('falls back to the scale label where a value has no sentence', () => {
    // A form may anchor some indicators and not others, and an organisation
    // whose scale is not 1-5 must not get a blank row.
    show({ anchors: { 5: 'Always exceeds target' } });
    expect(screen.getByText('Always exceeds target')).toBeTruthy();
    expect(screen.getByText('Scale 3')).toBeTruthy();
  });

  it('shows only the values the scale actually has', () => {
    // An anchor for a value the scale does not offer is not a choice.
    show({ points: scale.filter((p) => p.value <= 3) });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByText('Always exceeds target')).toBeNull();
  });
});

describe('a locked rating', () => {
  it('cannot be changed', () => {
    const onChange = vi.fn();
    show({ readOnly: true, value: 3, onChange });
    fireEvent.click(screen.getByRole('radio', { name: /Always exceeds target/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still shows the answer that was given', () => {
    // A submitted review must read as the answer it recorded. Greying out every
    // row, chosen one included, would make a locked review look empty.
    show({ readOnly: true, value: 3 });
    const chosen = screen.getByRole('radio', { name: /Meets target/ });
    expect(chosen.getAttribute('aria-checked')).toBe('true');
    expect(chosen.className).toContain('is-on');
  });
});
