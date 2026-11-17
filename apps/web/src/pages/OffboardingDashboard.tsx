import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type { Employee, EmployeeSummary } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Btn, Card, EmptyState, PageHead, Section, Tag } from '../components/ds';

interface ClearanceItem {
  id: string;
  department_area: string;
  item_title: string;
  status: 'pending' | 'cleared' | 'waived';
  clearedByName?: string;
  cleared_at?: string;
  notes?: string;
}

interface OffboardingCase {
  id: string;
  employee_id: string;
  employeeNo: string;
  employeeName: string;
  positionTitle?: string;
  departmentName?: string;
  separation_date: string;
  separation_reason: string;
  status: 'in_clearance' | 'cleared' | 'final_pay_computed' | 'released';
  unpaid_basic_pay: string;
  prorated_13th_month: string;
  sil_monetization: string;
  separation_pay: string;
  other_additions: string;
  outstanding_loans_deduction: string;
  other_deductions: string;
  net_final_pay: string;
  remarks?: string;
  clearanceItems: ClearanceItem[];
}

export default function OffboardingDashboard() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({
    employeeId: '',
    separationDate: new Date().toISOString().slice(0, 10),
    separationReason: 'resignation',
    remarks: '',
  });
  const [computingId, setComputingId] = useState<string | null>(null);
  const [payInputs, setPayInputs] = useState({
    unpaidBasicPay: '0',
    separationPay: '0',
    otherAdditions: '0',
    otherDeductions: '0',
  });

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const roles = me.data?.roles ?? [];
  const isHr = roles.includes('hr_admin') || roles.includes('hr_partner');
  const isHrOrMgr = isHr || roles.includes('manager');

  const cases = useQuery({
    queryKey: ['offboarding'],
    queryFn: () => api<OffboardingCase[]>('/offboarding'),
  });

  const employees = useQuery({
    queryKey: ['employees', 'offboarding-select'],
    queryFn: () => api<EmployeeSummary[]>('/employees?limit=200'),
    enabled: isHr && showNew,
  });

  const createCase = useMutation({
    mutationFn: () => api('/offboarding', { method: 'POST', body: newForm }),
    onSuccess: () => {
      setShowNew(false);
      setNewForm({ employeeId: '', separationDate: new Date().toISOString().slice(0, 10), separationReason: 'resignation', remarks: '' });
      void qc.invalidateQueries({ queryKey: ['offboarding'] });
    },
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: 'pending' | 'cleared' | 'waived' }) =>
      api(`/offboarding/clearance/${itemId}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offboarding'] }),
  });

  const computePay = useMutation({
    mutationFn: (caseId: string) =>
      api(`/offboarding/${caseId}/compute-final-pay`, {
        method: 'POST',
        body: {
          unpaidBasicPay: Number(payInputs.unpaidBasicPay || 0),
          separationPay: Number(payInputs.separationPay || 0),
          otherAdditions: Number(payInputs.otherAdditions || 0),
          otherDeductions: Number(payInputs.otherDeductions || 0),
        },
      }),
    onSuccess: () => {
      setComputingId(null);
      void qc.invalidateQueries({ queryKey: ['offboarding'] });
    },
  });

  const releasePay = useMutation({
    mutationFn: (caseId: string) => api(`/offboarding/${caseId}/release`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offboarding'] }),
  });

  if (cases.isLoading) return <Spinner />;
  const list = cases.data ?? [];

  return (
    <Section>
      <PageHead title="Offboarding Clearance & Final Pay">
        {isHr && (
          <Btn variant="primary" onClick={() => setShowNew(!showNew)}>
            {showNew ? 'Cancel' : '+ Initiate Offboarding'}
          </Btn>
        )}
      </PageHead>

      {showNew && isHr && (
        <Card kicker="Start Separation & Clearance Workflow" style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 8 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Employee</label>
              <select
                className="input"
                value={newForm.employeeId}
                onChange={(e) => setNewForm({ ...newForm, employeeId: e.target.value })}
              >
                <option value="">Select Employee...</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.lastName}, {e.firstName} ({e.employeeNo})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Effective Separation Date</label>
              <input
                type="date"
                className="input"
                value={newForm.separationDate}
                onChange={(e) => setNewForm({ ...newForm, separationDate: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Reason</label>
              <select
                className="input"
                value={newForm.separationReason}
                onChange={(e) => setNewForm({ ...newForm, separationReason: e.target.value })}
              >
                <option value="resignation">Voluntary Resignation</option>
                <option value="retirement">Retirement</option>
                <option value="end_of_contract">End of Contract</option>
                <option value="redundancy">Redundancy / Authorized Cause</option>
                <option value="termination">Termination</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Notes</label>
              <input
                className="input"
                placeholder="Optional HR remarks"
                value={newForm.remarks}
                onChange={(e) => setNewForm({ ...newForm, remarks: e.target.value })}
              />
            </div>
          </div>
          <ErrorNote error={createCase.error} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Btn
              variant="primary"
              disabled={!newForm.employeeId || createCase.isPending}
              onClick={() => createCase.mutate()}
            >
              {createCase.isPending ? 'Creating...' : 'Create Clearance Checklist'}
            </Btn>
          </div>
        </Card>
      )}

      {list.length === 0 ? (
        <EmptyState title="No active offboarding or clearance cases" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {list.map((c) => {
            const pendingCount = c.clearanceItems.filter((i) => i.status === 'pending').length;
            const allCleared = pendingCount === 0;
            return (
              <Card key={c.id} accent={c.status !== 'released'}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <h3 style={{ margin: 0 }}>{c.employeeName}</h3>
                      <Tag tone={c.status === 'released' ? 'accent' : 'solid'}>{c.status.toUpperCase()}</Tag>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--color-neutral-600)', marginTop: 4 }}>
                      {c.employeeNo} &bull; {c.positionTitle || 'Staff'} ({c.departmentName || 'General'}) &bull; Separation: {c.separation_date} ({c.separation_reason})
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {isHrOrMgr && c.status !== 'released' && (
                      <Btn
                        variant="secondary"
                        onClick={() => setComputingId(computingId === c.id ? null : c.id)}
                      >
                        {computingId === c.id ? 'Close Calculator' : 'Compute Final Pay'}
                      </Btn>
                    )}
                    {isHrOrMgr && c.status === 'final_pay_computed' && (
                      <Btn
                        variant="primary"
                        disabled={!allCleared || releasePay.isPending}
                        onClick={() => releasePay.mutate(c.id)}
                      >
                        {allCleared ? 'Release Final Pay & Settle Loans' : `${pendingCount} Clearance Pending`}
                      </Btn>
                    )}
                  </div>
                </div>

                {/* Clearance Checklist */}
                <div style={{ marginBottom: 16 }}>
                  <div className="card-kicker" style={{ marginBottom: 8 }}>CLEARANCE CHECKLIST</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                    {c.clearanceItems.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          padding: 12,
                          border: '1px solid var(--color-divider)',
                          background: 'var(--color-surface)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <strong style={{ fontSize: '0.85rem' }}>{item.department_area}</strong>
                            <Tag tone={item.status === 'pending' ? 'outline' : 'accent'}>{item.status}</Tag>
                          </div>
                          <div style={{ fontSize: '0.9rem' }}>{item.item_title}</div>
                          {item.clearedByName && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--color-neutral-600)', marginTop: 4 }}>
                              Cleared by {item.clearedByName}
                            </div>
                          )}
                        </div>
                        {isHrOrMgr && c.status !== 'released' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            {item.status !== 'cleared' && (
                              <Btn variant="primary" onClick={() => updateItem.mutate({ itemId: item.id, status: 'cleared' })}>
                                Clear
                              </Btn>
                            )}
                            {item.status !== 'waived' && (
                              <Btn variant="ghost" onClick={() => updateItem.mutate({ itemId: item.id, status: 'waived' })}>
                                Waive
                              </Btn>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Final Pay Computation Form */}
                {computingId === c.id && (
                  <div style={{ padding: 16, border: '1px solid var(--color-accent)', marginBottom: 16 }}>
                    <div className="card-kicker" style={{ marginBottom: 8 }}>
                      COMPUTE FINAL PAY (PRO-RATED 13TH MONTH, UNUSED SIL & LOANS AUTO-CALCULATED)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Unpaid Basic Salary (₱)</label>
                        <input
                          type="number"
                          className="input"
                          value={payInputs.unpaidBasicPay}
                          onChange={(e) => setPayInputs({ ...payInputs, unpaidBasicPay: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Separation Pay (₱)</label>
                        <input
                          type="number"
                          className="input"
                          value={payInputs.separationPay}
                          onChange={(e) => setPayInputs({ ...payInputs, separationPay: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Other Additions (₱)</label>
                        <input
                          type="number"
                          className="input"
                          value={payInputs.otherAdditions}
                          onChange={(e) => setPayInputs({ ...payInputs, otherAdditions: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Other Deductions / Assets (₱)</label>
                        <input
                          type="number"
                          className="input"
                          value={payInputs.otherDeductions}
                          onChange={(e) => setPayInputs({ ...payInputs, otherDeductions: e.target.value })}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                      <Btn variant="primary" disabled={computePay.isPending} onClick={() => computePay.mutate(c.id)}>
                        {computePay.isPending ? 'Calculating...' : 'Run Final Pay Engine'}
                      </Btn>
                    </div>
                  </div>
                )}

                {/* Final Pay Summary Breakdown */}
                <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, fontSize: '0.9rem' }}>
                  <div>
                    <div style={{ color: 'var(--color-neutral-600)', fontSize: '0.8rem' }}>Unpaid Basic</div>
                    <strong>₱{Number(c.unpaid_basic_pay).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-neutral-600)', fontSize: '0.8rem' }}>Pro-Rated 13th Month</div>
                    <strong>₱{Number(c.prorated_13th_month).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-neutral-600)', fontSize: '0.8rem' }}>Unused SIL Monetization</div>
                    <strong>₱{Number(c.sil_monetization).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-neutral-600)', fontSize: '0.8rem' }}>Loans Deducted</div>
                    <strong style={{ color: '#ef4444' }}>-₱{Number(c.outstanding_loans_deduction).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-neutral-600)', fontSize: '0.8rem' }}>Net Final Pay</div>
                    <strong style={{ fontSize: '1.15rem', color: 'var(--color-accent)' }}>
                      ₱{Number(c.net_final_pay).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>
                <ErrorNote error={releasePay.error || computePay.error} />
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}
