import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type { Employee, EmployeeSummary } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Btn, Card, EmptyState, PageHead, Section, Tag } from '../components/ds';

interface ExpenseClaim {
  id: string;
  employeeNo: string;
  employeeName: string;
  claim_date: string;
  category: string;
  description: string;
  amount: string;
  receipt_ref?: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  reviewedByName?: string;
}

interface CompanyAsset {
  id: string;
  asset_tag: string;
  name: string;
  category: string;
  serial_no?: string;
  assigned_to?: string | null;
  assignedEmployeeNo?: string;
  assignedToName?: string;
  assigned_on?: string;
  condition: string;
  status: string;
}

interface EmployeeTraining {
  id: string;
  employeeNo: string;
  employeeName: string;
  title: string;
  provider: string;
  training_type: string;
  completed_on?: string;
  expires_on?: string;
  hours: string;
  credential_no?: string;
  expiryAlert: 'valid' | 'expiring_soon' | 'expired';
}

export default function OperationsHub() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'expenses' | 'trainings' | 'assets'>('expenses');

  // Expense form
  const [expForm, setExpForm] = useState({
    claimDate: new Date().toISOString().slice(0, 10),
    category: 'travel',
    description: '',
    amount: '',
    receiptRef: '',
  });

  // Training form
  const [trnForm, setTrnForm] = useState({
    employeeId: '',
    title: '',
    provider: '',
    trainingType: 'certification',
    completedOn: new Date().toISOString().slice(0, 10),
    expiresOn: '',
    hours: '8',
    credentialNo: '',
  });

  // Asset form
  const [assetForm, setAssetForm] = useState({
    assetTag: '',
    name: '',
    category: 'laptop',
    serialNo: '',
    assignedTo: '',
  });

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const roles = me.data?.roles ?? [];
  const isMgrOrHr = roles.some((r) => ['hr_admin', 'hr_partner', 'manager'].includes(r));

  const employees = useQuery({
    queryKey: ['employees', 'ops-select'],
    queryFn: () => api<EmployeeSummary[]>('/employees?limit=200'),
    enabled: isMgrOrHr,
  });

  const expenses = useQuery({
    queryKey: ['operations', 'expenses'],
    queryFn: () => api<ExpenseClaim[]>('/operations/expenses'),
  });

  const trainings = useQuery({
    queryKey: ['operations', 'trainings'],
    queryFn: () => api<EmployeeTraining[]>('/operations/trainings'),
    enabled: tab === 'trainings',
  });

  const assets = useQuery({
    queryKey: ['operations', 'assets'],
    queryFn: () => api<CompanyAsset[]>('/operations/assets'),
    enabled: tab === 'assets',
  });

  const submitExp = useMutation({
    mutationFn: () =>
      api('/operations/expenses', {
        method: 'POST',
        body: { ...expForm, amount: Number(expForm.amount) },
      }),
    onSuccess: () => {
      setExpForm({ ...expForm, description: '', amount: '', receiptRef: '' });
      void qc.invalidateQueries({ queryKey: ['operations', 'expenses'] });
    },
  });

  const reviewExp = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'mark-paid' }) =>
      api(`/operations/expenses/${id}/${action}`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operations', 'expenses'] }),
  });

  const addTraining = useMutation({
    mutationFn: () =>
      api('/operations/trainings', {
        method: 'POST',
        body: {
          ...trnForm,
          employeeId: trnForm.employeeId || undefined,
          expiresOn: trnForm.expiresOn || undefined,
          hours: Number(trnForm.hours || 0),
        },
      }),
    onSuccess: () => {
      setTrnForm({ ...trnForm, title: '', provider: '', expiresOn: '', credentialNo: '' });
      void qc.invalidateQueries({ queryKey: ['operations', 'trainings'] });
    },
  });

  const createAsset = useMutation({
    mutationFn: () =>
      api('/operations/assets', {
        method: 'POST',
        body: { ...assetForm, assignedTo: assetForm.assignedTo || undefined },
      }),
    onSuccess: () => {
      setAssetForm({ assetTag: '', name: '', category: 'laptop', serialNo: '', assignedTo: '' });
      void qc.invalidateQueries({ queryKey: ['operations', 'assets'] });
    },
  });

  const returnAsset = useMutation({
    mutationFn: (id: string) =>
      api(`/operations/assets/${id}/assign`, { method: 'PATCH', body: { assignedTo: null } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operations', 'assets'] }),
  });

  return (
    <Section>
      <PageHead title="Workforce Operations: Expenses, Training & Assets">
        <Btn variant={tab === 'expenses' ? 'primary' : 'secondary'} onClick={() => setTab('expenses')}>
          Expenses & Reimbursements
        </Btn>
        <Btn variant={tab === 'trainings' ? 'primary' : 'secondary'} onClick={() => setTab('trainings')}>
          Training & Certifications
        </Btn>
        <Btn variant={tab === 'assets' ? 'primary' : 'secondary'} onClick={() => setTab('assets')}>
          Company Assets
        </Btn>
      </PageHead>

      {/* TAB 1: EXPENSES */}
      {tab === 'expenses' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Card kicker="Submit Expense / Liquidation Claim">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 8 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Date</label>
                <input type="date" className="input" value={expForm.claimDate} onChange={(e) => setExpForm({ ...expForm, claimDate: e.target.value })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Category</label>
                <select className="input" value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}>
                  <option value="travel">Travel & Fuel</option>
                  <option value="meal">Business Meal</option>
                  <option value="lodging">Lodging / Hotel</option>
                  <option value="supplies">Office Supplies</option>
                  <option value="communication">Load / Communication</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Amount (₱)</label>
                <input type="number" className="input" placeholder="0.00" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>OR / Receipt Ref</label>
                <input className="input" placeholder="OR-12345" value={expForm.receiptRef} onChange={(e) => setExpForm({ ...expForm, receiptRef: e.target.value })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Description</label>
                <input className="input" placeholder="Client visit toll & fuel liquidation..." value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} />
              </div>
            </div>
            <ErrorNote error={submitExp.error} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Btn variant="primary" disabled={submitExp.isPending || !expForm.description.trim() || !expForm.amount} onClick={() => submitExp.mutate()}>
                {submitExp.isPending ? 'Submitting...' : 'Submit Claim'}
              </Btn>
            </div>
          </Card>

          <Card kicker="Expense Claims Ledger">
            {expenses.isLoading ? <Spinner /> : (expenses.data ?? []).length === 0 ? (
              <EmptyState title="No expense claims filed yet" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Date</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(expenses.data ?? []).map((x) => (
                      <tr key={x.id}>
                        <td><strong>{x.employeeName}</strong><div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)' }}>{x.employeeNo}</div></td>
                        <td>{x.claim_date}</td>
                        <td><Tag tone="outline">{x.category}</Tag></td>
                        <td>{x.description} {x.receipt_ref ? `(${x.receipt_ref})` : ''}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>₱{Number(x.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td><Tag tone={x.status === 'paid' || x.status === 'approved' ? 'accent' : x.status === 'rejected' ? 'outline' : 'solid'}>{x.status}</Tag></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {isMgrOrHr && x.status === 'pending' && (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <Btn variant="primary" onClick={() => reviewExp.mutate({ id: x.id, action: 'approve' })}>Approve</Btn>
                              <Btn variant="secondary" onClick={() => reviewExp.mutate({ id: x.id, action: 'reject' })}>Reject</Btn>
                            </div>
                          )}
                          {isMgrOrHr && x.status === 'approved' && (
                            <Btn variant="primary" onClick={() => reviewExp.mutate({ id: x.id, action: 'mark-paid' })}>Mark Paid</Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 2: TRAINING & CERTIFICATIONS */}
      {tab === 'trainings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Card kicker="Record Seminar, License or Certification">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginTop: 8 }}>
              {isMgrOrHr && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Employee</label>
                  <select className="input" value={trnForm.employeeId} onChange={(e) => setTrnForm({ ...trnForm, employeeId: e.target.value })}>
                    <option value="">Myself</option>
                    {(employees.data ?? []).map((e) => (
                      <option key={e.id} value={e.id}>{e.lastName}, {e.firstName} ({e.employeeNo})</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Course / License Title</label>
                <input className="input" placeholder="e.g., BOSH Safety Officer II / PRC" value={trnForm.title} onChange={(e) => setTrnForm({ ...trnForm, title: e.target.value })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Type</label>
                <select className="input" value={trnForm.trainingType} onChange={(e) => setTrnForm({ ...trnForm, trainingType: e.target.value })}>
                  <option value="certification">Certification</option>
                  <option value="license">Professional / Driver License</option>
                  <option value="seminar">Seminar / Workshop</option>
                  <option value="compliance">DOLE / Compliance Training</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Provider / Agency</label>
                <input className="input" placeholder="e.g., DOLE / LTO / PRC" value={trnForm.provider} onChange={(e) => setTrnForm({ ...trnForm, provider: e.target.value })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Completed On</label>
                <input type="date" className="input" value={trnForm.completedOn} onChange={(e) => setTrnForm({ ...trnForm, completedOn: e.target.value })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Expires On (Optional)</label>
                <input type="date" className="input" value={trnForm.expiresOn} onChange={(e) => setTrnForm({ ...trnForm, expiresOn: e.target.value })} />
              </div>
            </div>
            <ErrorNote error={addTraining.error} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Btn variant="primary" disabled={addTraining.isPending || !trnForm.title.trim()} onClick={() => addTraining.mutate()}>
                {addTraining.isPending ? 'Saving...' : 'Save Training Record'}
              </Btn>
            </div>
          </Card>

          <Card kicker="Training & Certification Expiry Tracker">
            {trainings.isLoading ? <Spinner /> : (trainings.data ?? []).length === 0 ? (
              <EmptyState title="No training or certification records yet" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Course / License</th>
                      <th>Type & Provider</th>
                      <th>Completed</th>
                      <th>Expiry Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(trainings.data ?? []).map((t) => (
                      <tr key={t.id}>
                        <td><strong>{t.employeeName}</strong><div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)' }}>{t.employeeNo}</div></td>
                        <td><strong>{t.title}</strong></td>
                        <td>{t.training_type} &bull; {t.provider}</td>
                        <td>{t.completed_on || '—'}</td>
                        <td>
                          {t.expires_on ? (
                            <Tag tone={t.expiryAlert === 'expired' ? 'solid' : t.expiryAlert === 'expiring_soon' ? 'outline' : 'accent'}>
                              {t.expiryAlert === 'expired' ? `EXPIRED (${t.expires_on})` : t.expiryAlert === 'expiring_soon' ? `EXPIRING SOON (${t.expires_on})` : `Valid thru ${t.expires_on}`}
                            </Tag>
                          ) : <Tag tone="neutral">No Expiry</Tag>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 3: COMPANY ASSETS */}
      {tab === 'assets' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {isMgrOrHr && (
            <Card kicker="Register & Assign Company Asset">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Asset Tag</label>
                  <input className="input" placeholder="e.g., AST-LPT-001" value={assetForm.assetTag} onChange={(e) => setAssetForm({ ...assetForm, assetTag: e.target.value })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Asset Name</label>
                  <input className="input" placeholder="e.g., ThinkPad T14 Gen 4" value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Category</label>
                  <select className="input" value={assetForm.category} onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value })}>
                    <option value="laptop">Laptop / Workstation</option>
                    <option value="mobile">Mobile Phone / Tablet</option>
                    <option value="vehicle">Fleet Vehicle / Truck</option>
                    <option value="access_badge">RFID / Access Badge</option>
                    <option value="sim_card">Company SIM</option>
                    <option value="equipment">Warehouse Equipment</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Assign To Employee</label>
                  <select className="input" value={assetForm.assignedTo} onChange={(e) => setAssetForm({ ...assetForm, assignedTo: e.target.value })}>
                    <option value="">Unassigned (In Stock)</option>
                    {(employees.data ?? []).map((e) => (
                      <option key={e.id} value={e.id}>{e.lastName}, {e.firstName} ({e.employeeNo})</option>
                    ))}
                  </select>
                </div>
              </div>
              <ErrorNote error={createAsset.error} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <Btn variant="primary" disabled={createAsset.isPending || !assetForm.assetTag.trim() || !assetForm.name.trim()} onClick={() => createAsset.mutate()}>
                  {createAsset.isPending ? 'Saving...' : 'Save Asset'}
                </Btn>
              </div>
            </Card>
          )}

          <Card kicker="Asset Inventory & Accountability">
            {assets.isLoading ? <Spinner /> : (assets.data ?? []).length === 0 ? (
              <EmptyState title="No company assets tracked yet" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Asset Tag</th>
                      <th>Item</th>
                      <th>Category</th>
                      <th>Assigned To</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(assets.data ?? []).map((a) => (
                      <tr key={a.id}>
                        <td><strong>{a.asset_tag}</strong></td>
                        <td>{a.name}</td>
                        <td><Tag tone="outline">{a.category}</Tag></td>
                        <td>{a.assignedToName ? `${a.assignedToName} (${a.assignedEmployeeNo})` : 'In Stock'}</td>
                        <td><Tag tone={a.status === 'assigned' ? 'accent' : 'neutral'}>{a.status}</Tag></td>
                        <td style={{ textAlign: 'right' }}>
                          {isMgrOrHr && a.assigned_to && (
                            <Btn variant="secondary" onClick={() => returnAsset.mutate(a.id)}>
                              Mark Returned
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </Section>
  );
}
