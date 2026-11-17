import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { Card, Tag } from '../../components/ds';

interface LeaveType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_paid: boolean;
  is_statutory: boolean;
  default_days_per_year: string | number;
  can_cash_convert: boolean;
  can_carry_over: boolean;
  max_carry_over_days: string | number;
  gender_restriction: string;
  is_active: boolean;
}

export default function LeavePoliciesAdmin() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [seedSuccess, setSeedSuccess] = useState(false);

  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    isPaid: true,
    isStatutory: false,
    defaultDaysPerYear: 5,
    canCashConvert: false,
    canCarryOver: false,
    maxCarryOverDays: 0,
    genderRestriction: 'all',
  });

  const { data: types, isLoading } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api<LeaveType[]>('/leaves/types'),
  });

  const seedMutation = useMutation({
    mutationFn: () => api<LeaveType[]>('/leaves/types/seed-statutory', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      setSeedSuccess(true);
      setTimeout(() => setSeedSuccess(false), 3500);
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      api<LeaveType>('/leaves/types', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      setShowAddModal(false);
      setForm({
        code: '',
        name: '',
        description: '',
        isPaid: true,
        isStatutory: false,
        defaultDaysPerYear: 5,
        canCashConvert: false,
        canCarryOver: false,
        maxCarryOverDays: 0,
        genderRestriction: 'all',
      });
    },
  });

  const updateLeaveMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api(`/admin/leave-types/${id}`, { method: 'PATCH', body: data }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave-types'] }),
  });

  const deleteLeaveMutation = useMutation({
    mutationFn: (id: string) => api(`/admin/leave-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave-types'] }),
  });

  if (isLoading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>Loading leave policies…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Philippine Statutory & Company Leave Policies</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '14.5px', color: 'var(--color-muted)' }}>
            Configure statutory entitlement days, gender restrictions, cash commutability (SIL Art. 95), and annual allowances.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            className="btn btn-secondary"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            title="Seeds SIL, Solo Parent, VAWC, Maternity, Paternity, and Magna Carta leaves"
          >
            {seedMutation.isPending ? 'Seeding...' : '🇵🇭 Seed Philippine Statutory Defaults'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddModal(true)}
          >
            + Add Custom Leave Type
          </button>
        </div>
      </div>

      {seedSuccess && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '8px',
          backgroundColor: 'rgba(34, 197, 94, 0.15)',
          border: '1px solid #22c55e',
          color: '#4ade80',
          fontSize: '14.5px',
          fontWeight: 500,
        }}>
          ✓ Philippine statutory leave types (SIL, Solo Parent, VAWC, Magna Carta, Paternity, Maternity) verified and aligned.
        </div>
      )}

      <Card title="Active Leave Types & Entitlements">
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '14.5px' }}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Leave Policy Name</th>
                <th>Classification</th>
                <th>Paid Status</th>
                <th>Default Days / Year</th>
                <th>Cash Convertibility</th>
                <th>Gender Scope</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(types || []).map((t) => (
                <tr key={t.id} style={t.is_active ? undefined : { opacity: 0.55 }}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{t.code}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    {t.description && (
                      <div style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginTop: '2px' }}>
                        {t.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <Tag tone={t.is_statutory ? 'accent' : 'neutral'}>
                      {t.is_statutory ? 'DOLE Statutory' : 'Company Discretionary'}
                    </Tag>
                  </td>
                  <td>
                    <Tag tone={t.is_paid ? 'accent' : 'outline'}>
                      {t.is_paid ? 'Paid' : 'Without Pay'}
                    </Tag>
                  </td>
                  <td style={{ fontWeight: 600 }}>{Number(t.default_days_per_year).toFixed(0)} days</td>
                  <td>
                    {t.can_cash_convert ? (
                      <Tag tone="accent">Commutable to Cash</Tag>
                    ) : (
                      <span style={{ color: 'var(--color-muted)' }}>Forfeited</span>
                    )}
                  </td>
                  <td>
                    <span style={{ textTransform: 'capitalize' }}>{t.gender_restriction || 'All'}</span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => updateLeaveMutation.mutate({ id: t.id, data: { isActive: !t.is_active } })}
                    >
                      {t.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    {!t.is_statutory && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => deleteLeaveMutation.mutate(t.id)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Custom Leave Modal */}
      {showAddModal && (
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
              Create Company Leave Policy
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Code</label>
                  <input
                    className="input"
                    style={{ width: '100%' }}
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. BL"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Policy Name</label>
                  <input
                    className="input"
                    style={{ width: '100%' }}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Birthday Leave"
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Description</label>
                <textarea
                  className="input"
                  rows={2}
                  style={{ width: '100%', resize: 'vertical' }}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Terms and entitlement conditions..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Default Days / Year</label>
                  <input
                    type="number"
                    step="0.5"
                    className="input"
                    style={{ width: '100%' }}
                    value={form.defaultDaysPerYear}
                    onChange={(e) => setForm({ ...form, defaultDaysPerYear: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Gender Scope</label>
                  <select
                    className="input"
                    style={{ width: '100%' }}
                    value={form.genderRestriction}
                    onChange={(e) => setForm({ ...form, genderRestriction: e.target.value })}
                  >
                    <option value="all">All Employees</option>
                    <option value="male">Male Only</option>
                    <option value="female">Female Only</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14.5px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.isPaid}
                    onChange={(e) => setForm({ ...form, isPaid: e.target.checked })}
                  />
                  <span>Paid Leave (Regular basic salary credited)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14.5px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.canCashConvert}
                    onChange={(e) => setForm({ ...form, canCashConvert: e.target.checked })}
                  />
                  <span>Cash Convertible (Commutable to cash if unused at year end)</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => createMutation.mutate(form)}
                disabled={createMutation.isPending || !form.code || !form.name}
              >
                {createMutation.isPending ? 'Saving...' : 'Create Leave Type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
