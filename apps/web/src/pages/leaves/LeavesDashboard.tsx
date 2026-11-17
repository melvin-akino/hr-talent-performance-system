import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import type { Employee } from '../../types';
import { Card, Tag } from '../../components/ds';

interface LeaveType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_paid: boolean;
  is_statutory: boolean;
  default_days_per_year: string;
  can_cash_convert: boolean;
}

interface LeaveBalance {
  id: string;
  leave_type_id: string;
  leaveCode: string;
  leaveName: string;
  allocated_days: string;
  used_days: string;
  remaining_days: string;
  isPaid: boolean;
  isStatutory: boolean;
}

interface LeaveRequest {
  id: string;
  leaveCode: string;
  leaveName: string;
  isPaid: boolean;
  start_date: string;
  end_date: string;
  total_days: string;
  reason: string;
  status: string;
  firstName: string;
  lastName: string;
  created_at: string;
}

export default function LeavesDashboard() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const [activeTab, setActiveTab] = useState<'balances' | 'requests' | 'types'>('balances');
  const [showApplyModal, setShowApplyModal] = useState(false);

  const [applyForm, setApplyForm] = useState({
    leaveTypeId: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    totalDays: 1.0,
    reason: '',
  });

  const leavesEnabled = me.data?.features?.feature_leave_management ?? false;
  const currentYear = new Date().getFullYear();

  // 1. Fetch Balances
  const balancesQuery = useQuery({
    queryKey: ['leave-balances', currentYear],
    queryFn: () => api<LeaveBalance[]>(`/leaves/balances?year=${currentYear}`),
    enabled: leavesEnabled,
  });

  // 2. Fetch Requests
  const requestsQuery = useQuery({
    queryKey: ['leave-requests'],
    queryFn: () => api<LeaveRequest[]>('/leaves/requests'),
    enabled: leavesEnabled,
  });

  // 3. Fetch Types
  const typesQuery = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api<LeaveType[]>('/leaves/types'),
    enabled: leavesEnabled,
  });

  // Overlap and date sanity checks
  const isDateInverted = Boolean(
    applyForm.startDate && applyForm.endDate && applyForm.startDate > applyForm.endDate,
  );

  const activeConflictingRequest = (requestsQuery.data || []).find((r) => {
    if (r.status !== 'pending' && r.status !== 'approved') return false;
    const reqStart = typeof r.start_date === 'string' ? r.start_date.slice(0, 10) : '';
    const reqEnd = typeof r.end_date === 'string' ? r.end_date.slice(0, 10) : '';
    if (!reqStart || !reqEnd) return false;
    return applyForm.startDate <= reqEnd && applyForm.endDate >= reqStart;
  });

  // Apply Leave Mutation
  const applyMutation = useMutation({
    mutationFn: (payload: typeof applyForm) =>
      api<LeaveRequest>('/leaves/requests', {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      setShowApplyModal(false);
      setApplyForm({
        leaveTypeId: '',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
        totalDays: 1.0,
        reason: '',
      });
    },
  });

  // Approve Leave Mutation
  const approveMutation = useMutation({
    mutationFn: (requestId: string) =>
      api<LeaveRequest>(`/leaves/requests/${requestId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
    },
  });

  // Cancel Leave Mutation
  const cancelMutation = useMutation({
    mutationFn: (requestId: string) =>
      api<LeaveRequest>(`/leaves/requests/${requestId}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
    },
  });

  if (me.isLoading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>Loading leaves workspace…</div>;
  }

  // Graceful degradation when Leave Management is not enabled
  if (!leavesEnabled) {
    return (
      <div style={{ maxWidth: '800px', margin: '40px auto', padding: '0 20px' }}>
        <Card accent elevated style={{ padding: '36px', textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            borderRadius: '12px',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            color: '#60a5fa',
            marginBottom: '20px',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>

          <h2 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 8px 0', color: 'var(--color-fg)' }}>
            Leave Management Module Not Licensed
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--color-muted)', maxWidth: '520px', margin: '0 auto 24px auto', lineHeight: 1.5 }}>
            Philippine statutory leave tracking (SIL, Solo Parent, VAWC, Magna Carta, Paternity, Maternity) and leave balance ledgers are currently inactive for <strong>{me.data?.organization?.name || 'your company'}</strong>.
          </p>

          <div style={{
            display: 'inline-block',
            padding: '12px 20px',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '6px',
            fontSize: '14.5px',
            color: 'var(--color-muted)',
            textAlign: 'left',
          }}>
            <div style={{ fontWeight: 600, color: 'var(--color-fg)', marginBottom: '4px' }}>
              How to enable this module:
            </div>
            <div>1. Contact your platform account administrator.</div>
            <div>2. Activate the <strong>Leave Management License</strong> in the Superadmin Control Plane.</div>
          </div>
        </Card>
      </div>
    );
  }

  const balances = balancesQuery.data || [];
  const requests = requestsQuery.data || [];
  const leaveTypes = typesQuery.data || [];

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '28px',
        flexWrap: 'wrap',
        gap: '16px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>
              Statutory & Company Leaves
            </h1>
            <Tag tone="accent">DOLE Article 95 Compliant</Tag>
          </div>
          <p style={{ margin: '6px 0 0 0', fontSize: '14.5px', color: 'var(--color-muted)' }}>
            Service Incentive Leave (SIL), statutory parental leaves, vacation/sick leave credits, and approval workflows.
          </p>
        </div>

        {/* Apply Leave Action */}
        <button
          className="btn btn-primary"
          onClick={() => setShowApplyModal(true)}
        >
          + File Leave Application
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--color-border)', marginBottom: '24px' }}>
        <button
          onClick={() => setActiveTab('balances')}
          style={{
            padding: '10px 16px',
            border: 'none',
            background: 'none',
            fontSize: '14.5px',
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: activeTab === 'balances' ? '2px solid var(--color-accent)' : '2px solid transparent',
            color: activeTab === 'balances' ? 'var(--color-accent)' : 'var(--color-muted)',
          }}
        >
          My Leave Credits ({currentYear})
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          style={{
            padding: '10px 16px',
            border: 'none',
            background: 'none',
            fontSize: '14.5px',
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: activeTab === 'requests' ? '2px solid var(--color-accent)' : '2px solid transparent',
            color: activeTab === 'requests' ? 'var(--color-accent)' : 'var(--color-muted)',
          }}
        >
          Applications & Approvals ({requests.length})
        </button>
        <button
          onClick={() => setActiveTab('types')}
          style={{
            padding: '10px 16px',
            border: 'none',
            background: 'none',
            fontSize: '14.5px',
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: activeTab === 'types' ? '2px solid var(--color-accent)' : '2px solid transparent',
            color: activeTab === 'types' ? 'var(--color-accent)' : 'var(--color-muted)',
          }}
        >
          Philippine Leave Policies
        </button>
      </div>

      {/* Tab 1: Balances */}
      {activeTab === 'balances' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
        }}>
          {balances.length > 0 ? (
            balances.map((b) => (
              <Card key={b.id} kicker={b.isStatutory ? 'Statutory Leave' : 'Company Benefit'} title={b.leaveName}>
                <div style={{ fontSize: '28px', fontWeight: 600, marginTop: '8px', color: '#38bdf8' }}>
                  {b.remaining_days} <span style={{ fontSize: '15px', color: 'var(--color-muted)' }}>days left</span>
                </div>
                <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '4px' }}>
                  Allocated: {b.allocated_days} days · Used: {b.used_days} days
                </div>
              </Card>
            ))
          ) : (
            <Card style={{ padding: '32px', textAlign: 'center', gridColumn: '1 / -1' }}>
              <p style={{ color: 'var(--color-muted)' }}>
                No leave allocations recorded for {currentYear}. HR administrators can allocate credits via setup.
              </p>
            </Card>
          )}
        </div>
      )}

      {/* Tab 2: Requests */}
      {activeTab === 'requests' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', fontWeight: 600, fontSize: '15px' }}>
            Leave Applications Ledger
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  <th style={{ padding: '10px 16px' }}>Applicant</th>
                  <th style={{ padding: '10px 16px' }}>Leave Type</th>
                  <th style={{ padding: '10px 16px' }}>Start Date</th>
                  <th style={{ padding: '10px 16px' }}>End Date</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right' }}>Total Days</th>
                  <th style={{ padding: '10px 16px' }}>Reason</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.length > 0 ? (
                  requests.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>{r.lastName}, {r.firstName}</td>
                      <td style={{ padding: '12px 16px' }}>{r.leaveName}</td>
                      <td style={{ padding: '12px 16px' }}>{r.start_date}</td>
                      <td style={{ padding: '12px 16px' }}>{r.end_date}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>{r.total_days}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--color-muted)' }}>{r.reason}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <Tag tone={r.status === 'approved' ? 'accent' : 'neutral'}>
                          {r.status.toUpperCase()}
                        </Tag>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        {r.status === 'pending' && (
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: '14.5px', padding: '4px 10px' }}
                              onClick={() => approveMutation.mutate(r.id)}
                              disabled={approveMutation.isPending}
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '14.5px', padding: '4px 10px', color: '#ef4444' }}
                              onClick={() => {
                                const reason = window.prompt('Reason for rejection:') || 'Disapproved by supervisor';
                                api(`/leaves/requests/${r.id}/reject`, { method: 'POST', body: { rejectionReason: reason } }).then(() => {
                                  queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
                                  queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
                                });
                              }}
                              disabled={approveMutation.isPending || cancelMutation.isPending}
                            >
                              Reject
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '14.5px', padding: '4px 10px', color: '#94a3b8' }}
                              onClick={() => {
                                if (window.confirm('Are you sure you want to cancel this pending leave application?')) {
                                  cancelMutation.mutate(r.id);
                                }
                              }}
                              disabled={approveMutation.isPending || cancelMutation.isPending}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-muted)' }}>
                      No leave applications found. Click '+ File Leave Application' to apply.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Policies */}
      {activeTab === 'types' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {leaveTypes.map((t) => (
            <Card key={t.id} kicker={t.is_statutory ? 'Statutory Policy' : 'Company Leave'} title={t.name}>
              <p className="card-body" style={{ fontSize: '15px', marginTop: '4px' }}>
                {t.description || 'Standard company leave entitlement.'}
              </p>
              <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Tag tone="accent">{t.is_paid ? 'Paid' : 'Unpaid'}</Tag>
                {t.can_cash_convert && <Tag tone="neutral">Cash Convertible</Tag>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Apply Leave Modal */}
      {showApplyModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '12px',
            padding: '24px',
            width: '100%',
            maxWidth: '480px',
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 600 }}>
              File Leave Application
            </h3>

            {applyMutation.isError && (
              <div style={{
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #ef4444',
                color: '#fca5a5',
                fontSize: '14.5px',
                lineHeight: 1.4,
                marginBottom: '16px',
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: '16px' }}>⚠️</span>
                <div>
                  <strong>Application Error:</strong>
                  <div style={{ marginTop: '2px' }}>{applyMutation.error?.message || 'Failed to submit leave application'}</div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Leave Type
                </label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={applyForm.leaveTypeId}
                  onChange={(e) => setApplyForm({ ...applyForm, leaveTypeId: e.target.value })}
                >
                  <option value="">Select Leave Type...</option>
                  {leaveTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.is_paid ? 'Paid' : 'Unpaid'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                      Start Date
                    </label>
                    <input
                      type="date"
                      className="input"
                      style={{ width: '100%' }}
                      value={applyForm.startDate}
                      onChange={(e) => setApplyForm({ ...applyForm, startDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                      End Date
                    </label>
                    <input
                      type="date"
                      className="input"
                      style={{ width: '100%' }}
                      value={applyForm.endDate}
                      onChange={(e) => setApplyForm({ ...applyForm, endDate: e.target.value })}
                    />
                  </div>
                </div>

                {isDateInverted && (
                  <div style={{ color: '#ef4444', fontSize: '15px', marginTop: '6px' }}>
                    ⚠️ Start date cannot be after end date.
                  </div>
                )}

                {activeConflictingRequest && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 10px',
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid #f59e0b',
                    borderRadius: '6px',
                    color: '#fbbf24',
                    fontSize: '15px',
                    lineHeight: 1.4,
                  }}>
                    ⚠️ <strong>Date Range Conflict:</strong> You already have an active ({activeConflictingRequest.status}) leave ({activeConflictingRequest.leaveName}) covering <strong>{activeConflictingRequest.start_date?.slice(0, 10)}</strong> to <strong>{activeConflictingRequest.end_date?.slice(0, 10)}</strong>.
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Total Number of Days
                </label>
                <input
                  type="number"
                  step="0.5"
                  className="input"
                  style={{ width: '100%' }}
                  value={applyForm.totalDays}
                  onChange={(e) => setApplyForm({ ...applyForm, totalDays: parseFloat(e.target.value) || 1 })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Reason for Leave
                </label>
                <textarea
                  className="input"
                  rows={3}
                  style={{ width: '100%', resize: 'vertical' }}
                  value={applyForm.reason}
                  onChange={(e) => setApplyForm({ ...applyForm, reason: e.target.value })}
                  placeholder="Specify reason..."
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowApplyModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => applyMutation.mutate(applyForm)}
                disabled={
                  applyMutation.isPending ||
                  !applyForm.leaveTypeId ||
                  !applyForm.reason ||
                  isDateInverted ||
                  Boolean(activeConflictingRequest)
                }
              >
                {applyMutation.isPending ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
