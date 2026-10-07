import { Btn, Tag } from './ds';

/**
 * The four lines a Performance Improvement Plan is signed on.
 *
 * The form's acknowledgement block names four parties — the employee, the
 * reporting officer, the department manager or area head, and an HCM
 * representative — and says why it matters: once acknowledged, the plan "may be
 * used as a metric in succeeding performance evaluation period", so every
 * clarification has to be answered before it is signed.
 *
 * WHICH BUTTONS APPEAR IS NOT DECIDED HERE.
 *
 * `signable` arrives from the server, computed by the same database function the
 * INSERT policy uses. This component renders what it is told it may offer and
 * never works out for itself who may sign as what — that would be the
 * authorization rule re-implemented in the browser, where it can be read by
 * anyone and enforced by nobody. A button shown here that the database would
 * refuse is impossible by construction; a button the database would accept and
 * this hides is the only way the two can differ, and it fails safe.
 */

export type PipParty = 'employee' | 'reporting_officer' | 'department_head' | 'hcm_representative';

export interface PipSignature { party: PipParty; by: string; at: string }

/** In the order the form prints them. */
// `as` is written out rather than derived from `label`: lower-casing a label to
// build "Sign as ..." turned "HCM representative" into "hcm representative".
const LINES: { party: PipParty; label: string; as: string }[] = [
  { party: 'employee', label: 'Employee', as: 'employee' },
  { party: 'reporting_officer', label: 'Reporting officer', as: 'reporting officer' },
  { party: 'department_head', label: 'Department manager / area head',
    as: 'department manager / area head' },
  { party: 'hcm_representative', label: 'HCM representative', as: 'HCM representative' },
];

export function PipSignatures(
  { state, signatures, signable, pending, onSign }: {
    state: 'draft' | 'active' | 'completed' | 'cancelled';
    signatures: PipSignature[];
    signable: PipParty[];
    pending: boolean;
    onSign: (party: PipParty) => void;
  },
) {
  const signed = new Map(signatures.map((s) => [s.party, s]));
  const complete = LINES.every((l) => signed.has(l.party));

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide t-muted uppercase">
        Acknowledgement
      </h3>

      <ul className="space-y-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {LINES.map(({ party, label, as }) => {
          const sig = signed.get(party);
          return (
            <li key={party} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs t-muted">
                  {sig
                    ? `${sig.by} · ${sig.at.slice(0, 10)}`
                    : 'Awaiting signature'}
                </p>
              </div>
              {sig ? (
                <Tag tone="accent">signed</Tag>
              ) : signable.includes(party) ? (
                <Btn variant="primary" disabled={pending} onClick={() => onSign(party)}>
                  Sign as {as}
                </Btn>
              ) : (
                <Tag tone="outline">awaiting</Tag>
              )}
            </li>
          );
        })}
      </ul>

      {/* Said where the people signing will read it. A draft is not open for
          signature because its terms can still change, and a signature on terms
          that may yet change attests to nothing. */}
      {state === 'draft' && (
        <p className="mt-2 text-xs t-muted">
          Signatures open when the plan is activated.
        </p>
      )}
      {state === 'active' && complete && (
        <p className="mt-2 text-xs t-muted">All four parties have signed.</p>
      )}
    </div>
  );
}
