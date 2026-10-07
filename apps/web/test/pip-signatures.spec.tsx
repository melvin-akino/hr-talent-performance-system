// @vitest-environment jsdom
/**
 * The four signature lines on a Performance Improvement Plan.
 *
 * What is worth pinning is behaviour a restyle could lose: that all four lines
 * are always shown (a plan with one signature must look incomplete, not finished),
 * that a button appears only for a line the server said may be signed, and that
 * the component never works out permissions for itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PipSignatures, type PipParty, type PipSignature } from '../src/components/PipSignatures';

afterEach(cleanup);

const show = (over: Partial<Parameters<typeof PipSignatures>[0]> = {}) => render(
  <PipSignatures
    state="active" signatures={[]} signable={[]} pending={false}
    onSign={() => {}} {...over}
  />,
);

const sig = (party: PipParty, by = 'Mary Manager'): PipSignature =>
  ({ party, by, at: '2026-03-02T09:30:00.000Z' });

describe('the signature block', () => {
  it('always shows all four lines, in the order the form prints them', () => {
    show();
    const lines = screen.getAllByRole('listitem').map((li) => li.querySelector('p')!.textContent);
    expect(lines).toEqual([
      'Employee', 'Reporting officer', 'Department manager / area head', 'HCM representative',
    ]);
  });

  it('shows an unsigned line as awaiting, so one signature does not look like a finished plan', () => {
    show({ signatures: [sig('employee', 'Ricky Report')] });
    expect(screen.getAllByText('Awaiting signature')).toHaveLength(3);
    expect(screen.getByText(/Ricky Report · 2026-03-02/)).toBeTruthy();
  });

  it('names who signed and when, on every signed line', () => {
    show({ signatures: [sig('reporting_officer', 'Mary Manager')] });
    expect(screen.getByText('Mary Manager · 2026-03-02')).toBeTruthy();
  });

  it('says so when all four have signed', () => {
    show({
      signatures: [sig('employee'), sig('reporting_officer'),
        sig('department_head'), sig('hcm_representative')],
    });
    expect(screen.getByText('All four parties have signed.')).toBeTruthy();
    expect(screen.queryAllByText('Awaiting signature')).toHaveLength(0);
  });

  it('does not claim completeness while any line is open', () => {
    show({ signatures: [sig('employee'), sig('reporting_officer'), sig('department_head')] });
    expect(screen.queryByText('All four parties have signed.')).toBeNull();
  });
});

describe('who is offered a button', () => {
  it('offers a button only for the lines the server said may be signed', () => {
    show({ signable: ['reporting_officer'] });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('Sign as reporting officer');
  });

  it('offers nothing to somebody who may sign nothing', () => {
    show({ signable: [] });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('keeps the HCM acronym in capitals on its button', () => {
    // Found by looking at the rendered page, not by a test: the wording was built
    // by lower-casing the line's label, which read "Sign as hcm representative".
    show({ signable: ['hcm_representative'] });
    expect(screen.getByRole('button').textContent).toBe('Sign as HCM representative');
  });

  it('offers two buttons to one person holding two lines — which is HCM', () => {
    show({ signable: ['department_head', 'hcm_representative'] });
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('reports which line was chosen', () => {
    const onSign = vi.fn();
    show({ signable: ['employee'], onSign });
    fireEvent.click(screen.getByRole('button', { name: /Sign as employee/ }));
    expect(onSign).toHaveBeenCalledWith('employee');
  });

  it('never offers a line that is already signed, even if told it may', () => {
    // Defence in depth: the server drops a signed line from `signable`, and if it
    // ever did not, a second button here would invite a refused request.
    show({ signatures: [sig('employee')], signable: ['employee'] });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('disables the button while a signature is in flight', () => {
    show({ signable: ['employee'], pending: true });
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('a plan that is not open for signature', () => {
  it('explains why a draft has no buttons', () => {
    show({ state: 'draft' });
    expect(screen.getByText('Signatures open when the plan is activated.')).toBeTruthy();
  });

  it('says nothing of the sort on an active plan', () => {
    show({ state: 'active' });
    expect(screen.queryByText(/Signatures open when/)).toBeNull();
  });
});
