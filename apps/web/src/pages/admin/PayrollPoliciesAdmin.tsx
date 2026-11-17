import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { Card, Tag } from '../../components/ds';

interface SalaryMatrix {
  id: string;
  grade_code: string;
  grade_name: string;
  min_monthly_rate: string | number;
  max_monthly_rate: string | number;
  industry_type: string;
  region: string;
}

export default function PayrollPoliciesAdmin() {
  const queryClient = useQueryClient();
  const [showAddMatrixModal, setShowAddMatrixModal] = useState(false);

  const [matrixForm, setMatrixForm] = useState({
    gradeCode: '',
    gradeName: '',
    minMonthlyRate: 20000,
    maxMonthlyRate: 35000,
    industryType: 'General',
    region: 'NCR',
  });

  const { data: matrices, isLoading } = useQuery({
    queryKey: ['salary-matrices'],
    queryFn: () => api<SalaryMatrix[]>('/payroll/salary-matrices'),
  });

  const createMatrixMutation = useMutation({
    mutationFn: (body: typeof matrixForm) =>
      api<SalaryMatrix>('/payroll/salary-matrices', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-matrices'] });
      setShowAddMatrixModal(false);
      setMatrixForm({
        gradeCode: '',
        gradeName: '',
        minMonthlyRate: 20000,
        maxMonthlyRate: 35000,
        industryType: 'General',
        region: 'NCR',
      });
    },
  });

  const deleteMatrixMutation = useMutation({
    mutationFn: (id: string) => api(`/admin/salary-matrices/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['salary-matrices'] }),
  });

  if (isLoading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>Loading payroll policies…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Philippine Payroll, Tax & Salary Matrices Setup</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '14.5px', color: 'var(--color-muted)' }}>
            Configure regional salary grade matrices, statutory SSS, PhilHealth, Pag-IBIG rates, and TRAIN Law withholding tax tables.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => setShowAddMatrixModal(true)}
        >
          + Add Salary Grade Matrix
        </button>
      </div>

      {/* Salary Matrices */}
      <Card title="Regional Salary Grade Matrices & Wage Ladders">
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '14.5px' }}>
            <thead>
              <tr>
                <th>Grade Code</th>
                <th>Grade Name</th>
                <th>Region Scope</th>
                <th>Industry Type</th>
                <th>Minimum Monthly Rate</th>
                <th>Maximum Monthly Rate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(matrices || []).map((m) => (
                <tr key={m.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{m.grade_code}</td>
                  <td style={{ fontWeight: 600 }}>{m.grade_name}</td>
                  <td><Tag tone="neutral">{m.region}</Tag></td>
                  <td>{m.industry_type}</td>
                  <td style={{ fontWeight: 600, color: '#38bdf8' }}>
                    ₱{Number(m.min_monthly_rate).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ fontWeight: 600, color: '#4ade80' }}>
                    ₱{Number(m.max_monthly_rate).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => deleteMatrixMutation.mutate(m.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Statutory Rules & Rate Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        <Card title="SSS Contribution Schedule (2026)">
          <div style={{ fontSize: '14.5px', lineHeight: 1.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: '6px' }}>
              <span>Total Contribution Rate:</span>
              <strong>14.0% of Monthly Salary Credit (MSC)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>Employer (ER) Share:</span>
              <strong>9.5%</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>Employee (EE) Share:</span>
              <strong>4.5%</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>Minimum MSC:</span>
              <strong>₱4,000.00</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span>WISP Mandatory Provident Fund:</span>
              <strong style={{ color: '#4ade80' }}>Active (Salary Credits &gt; ₱20,000)</strong>
            </div>
          </div>
        </Card>

        <Card title="PhilHealth Premium Rate (5.0%)">
          <div style={{ fontSize: '14.5px', lineHeight: 1.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: '6px' }}>
              <span>Premium Rate:</span>
              <strong>5.0% of Basic Monthly Salary</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>Employer (ER) Split:</span>
              <strong>2.5% (50% of Total)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>Employee (EE) Split:</span>
              <strong>2.5% (50% of Total)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>Monthly Salary Floor:</span>
              <strong>₱10,000.00 (Min. ₱500)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span>Monthly Salary Ceiling:</span>
              <strong>₱100,000.00 (Max. ₱5,000)</strong>
            </div>
          </div>
        </Card>

        <Card title="Pag-IBIG / HDMF Contributions">
          <div style={{ fontSize: '14.5px', lineHeight: 1.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: '6px' }}>
              <span>Mandatory EE Share:</span>
              <strong>₱200.00 / month (or 2% up to cap)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>Mandatory ER Share:</span>
              <strong>₱200.00 / month</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>Quindena Split:</span>
              <strong>₱100 / cutoff EE & ER</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span>Voluntary Pag-IBIG MP2:</span>
              <strong style={{ color: '#38bdf8' }}>Individual Auto-deduct Supported</strong>
            </div>
          </div>
        </Card>

        <Card title="TRAIN Law (RA 10963) Withholding Tax Brackets">
          <div style={{ fontSize: '14.5px', lineHeight: 1.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: '6px' }}>
              <span>₱0 – ₱10,417 (Semi-Monthly):</span>
              <strong style={{ color: '#4ade80' }}>₱0 (0% Tax-Exempt)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>₱10,417 – ₱16,666:</span>
              <strong>15% in excess over ₱10,417</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>₱16,667 – ₱33,332:</span>
              <strong>₱937.50 + 20% in excess over ₱16,667</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span>₱33,333 – ₱83,332:</span>
              <strong>₱4,270.70 + 25% in excess over ₱33,333</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span>13th Month Tax Exemption:</span>
              <strong style={{ color: '#38bdf8' }}>₱90,000 Annual Ceiling</strong>
            </div>
          </div>
        </Card>
      </div>

      {/* Add Salary Matrix Modal */}
      {showAddMatrixModal && (
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
            maxWidth: '460px',
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 600 }}>
              Add Salary Grade Matrix
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Grade Code</label>
                  <input
                    className="input"
                    style={{ width: '100%' }}
                    value={matrixForm.gradeCode}
                    onChange={(e) => setMatrixForm({ ...matrixForm, gradeCode: e.target.value.toUpperCase() })}
                    placeholder="e.g. SG-07"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Grade Name</label>
                  <input
                    className="input"
                    style={{ width: '100%' }}
                    value={matrixForm.gradeName}
                    onChange={(e) => setMatrixForm({ ...matrixForm, gradeName: e.target.value })}
                    placeholder="e.g. Senior Specialist"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Region</label>
                  <select
                    className="input"
                    style={{ width: '100%' }}
                    value={matrixForm.region}
                    onChange={(e) => setMatrixForm({ ...matrixForm, region: e.target.value })}
                  >
                    <option value="NCR">NCR (Metro Manila)</option>
                    <option value="Region III">Region III (Central Luzon)</option>
                    <option value="Region IV-A">Region IV-A (CALABARZON)</option>
                    <option value="Region VII">Region VII (Central Visayas)</option>
                    <option value="Region XI">Region XI (Davao Region)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Industry Type</label>
                  <input
                    className="input"
                    style={{ width: '100%' }}
                    value={matrixForm.industryType}
                    onChange={(e) => setMatrixForm({ ...matrixForm, industryType: e.target.value })}
                    placeholder="e.g. Logistics / Tech"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Min Monthly Rate (₱)</label>
                  <input
                    type="number"
                    step="500"
                    className="input"
                    style={{ width: '100%' }}
                    value={matrixForm.minMonthlyRate}
                    onChange={(e) => setMatrixForm({ ...matrixForm, minMonthlyRate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Max Monthly Rate (₱)</label>
                  <input
                    type="number"
                    step="500"
                    className="input"
                    style={{ width: '100%' }}
                    value={matrixForm.maxMonthlyRate}
                    onChange={(e) => setMatrixForm({ ...matrixForm, maxMonthlyRate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowAddMatrixModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => createMatrixMutation.mutate(matrixForm)}
                disabled={createMatrixMutation.isPending || !matrixForm.gradeCode || !matrixForm.gradeName}
              >
                {createMatrixMutation.isPending ? 'Saving...' : 'Create Grade Matrix'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
