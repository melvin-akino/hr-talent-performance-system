import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type { Employee } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Btn, Card, EmptyState, PageHead, Section, Tag } from '../components/ds';

interface Announcement {
  id: string;
  title: string;
  category: string;
  body: string;
  is_pinned: boolean;
  publishedByName?: string;
  published_at: string;
  expires_at?: string | null;
}

interface EssProfile {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  status: string;
  hiredOn: string | null;
  positionTitle: string | null;
  departmentName: string | null;
  branchName: string | null;
  monthlyRate: string | null;
  payType: string | null;
  payFrequency: string | null;
  tin: string | null;
  sssNo: string | null;
  philhealthNo: string | null;
  pagibigNo: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
}

interface ProfileRequest {
  id: string;
  employeeNo: string;
  employeeName: string;
  request_type: string;
  requested_changes: Record<string, string>;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedByName?: string;
  review_note?: string;
  created_at: string;
}

interface CoeData {
  issuedOn: string;
  referenceNo: string;
  company: {
    registeredName: string;
    companyAddress: string;
    hrEmail: string;
    contactNumber: string;
  };
  employee: {
    employeeNo: string;
    fullName: string;
    positionTitle: string;
    departmentName: string;
    branchName: string;
    status: string;
    hiredOn: string;
    monthlyRate?: number;
  };
}

export default function EssPortal() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'bulletins' | 'profile' | 'coe'>('bulletins');

  // Announcement form state
  const [showPostForm, setShowPostForm] = useState(false);
  const [annForm, setAnnForm] = useState({
    title: '',
    category: 'general',
    body: '',
    isPinned: false,
  });

  // Profile Change Request form state
  const [reqType, setReqType] = useState<'bank_account' | 'government_id' | 'contact_info'>('bank_account');
  const [reqReason, setReqReason] = useState('');
  const [reqFields, setReqFields] = useState<Record<string, string>>({});

  // COE state
  const [includeComp, setIncludeComp] = useState(false);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const roles = me.data?.roles ?? [];
  const isHr = roles.includes('hr_admin') || roles.includes('hr_partner');
  const canPost = isHr || roles.includes('manager');

  const announcements = useQuery({
    queryKey: ['ess', 'announcements'],
    queryFn: () => api<Announcement[]>('/ess/announcements'),
  });

  const profile = useQuery({
    queryKey: ['ess', 'profile'],
    queryFn: () => api<EssProfile>('/ess/profile'),
  });

  const requests = useQuery({
    queryKey: ['ess', 'profile-requests'],
    queryFn: () => api<ProfileRequest[]>('/ess/profile-requests'),
  });

  const coe = useQuery({
    queryKey: ['ess', 'coe', includeComp],
    queryFn: () => api<CoeData>(`/ess/coe?includeCompensation=${includeComp}`),
    enabled: activeTab === 'coe',
  });

  const postAnn = useMutation({
    mutationFn: (payload: typeof annForm) =>
      api('/ess/announcements', { method: 'POST', body: payload }),
    onSuccess: () => {
      setShowPostForm(false);
      setAnnForm({ title: '', category: 'general', body: '', isPinned: false });
      void qc.invalidateQueries({ queryKey: ['ess', 'announcements'] });
    },
  });

  const deleteAnn = useMutation({
    mutationFn: (id: string) => api(`/ess/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ess', 'announcements'] }),
  });

  const submitReq = useMutation({
    mutationFn: () =>
      api('/ess/profile-requests', {
        method: 'POST',
        body: {
          requestType: reqType,
          requestedChanges: reqFields,
          reason: reqReason,
        },
      }),
    onSuccess: () => {
      setReqFields({});
      setReqReason('');
      void qc.invalidateQueries({ queryKey: ['ess', 'profile-requests'] });
    },
  });

  const reviewReq = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api(`/ess/profile-requests/${id}/${decision}`, { method: 'POST', body: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ess', 'profile-requests'] });
      void qc.invalidateQueries({ queryKey: ['ess', 'profile'] });
    },
  });

  if (announcements.isLoading || profile.isLoading) return <Spinner />;

  const p = profile.data;
  const annList = announcements.data ?? [];
  const reqList = requests.data ?? [];

  return (
    <Section>
      <PageHead title="Self-Service & Company Bulletin">
        <Btn variant={activeTab === 'bulletins' ? 'primary' : 'secondary'} onClick={() => setActiveTab('bulletins')}>
          Bulletins ({annList.length})
        </Btn>
        <Btn variant={activeTab === 'profile' ? 'primary' : 'secondary'} onClick={() => setActiveTab('profile')}>
          My Profile & Requests
        </Btn>
        <Btn variant={activeTab === 'coe' ? 'primary' : 'secondary'} onClick={() => setActiveTab('coe')}>
          Certificate of Employment (COE)
        </Btn>
      </PageHead>

      {/* TAB 1: Company Announcements */}
      {activeTab === 'bulletins' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {canPost && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn variant="primary" onClick={() => setShowPostForm(!showPostForm)}>
                {showPostForm ? 'Cancel' : '+ Post Announcement'}
              </Btn>
            </div>
          )}

          {showPostForm && (
            <Card kicker="New Company Announcement">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Title</label>
                    <input
                      className="input"
                      placeholder="e.g., 2026 Holiday Advisory & Payroll Schedule"
                      value={annForm.title}
                      onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Category</label>
                    <select
                      className="input"
                      value={annForm.category}
                      onChange={(e) => setAnnForm({ ...annForm, category: e.target.value })}
                    >
                      <option value="general">General</option>
                      <option value="policy">HR Policy</option>
                      <option value="hr_memo">HR Memo</option>
                      <option value="holiday">Holiday Advisory</option>
                      <option value="event">Company Event</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Message Body</label>
                  <textarea
                    className="input"
                    rows={4}
                    placeholder="Write announcement details..."
                    value={annForm.body}
                    onChange={(e) => setAnnForm({ ...annForm, body: e.target.value })}
                  />
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={annForm.isPinned}
                    onChange={(e) => setAnnForm({ ...annForm, isPinned: e.target.checked })}
                  />
                  Pin this announcement to the top
                </label>
                <ErrorNote error={postAnn.error} />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Btn
                    variant="primary"
                    disabled={postAnn.isPending || !annForm.title.trim() || !annForm.body.trim()}
                    onClick={() => postAnn.mutate(annForm)}
                  >
                    {postAnn.isPending ? 'Publishing...' : 'Publish Announcement'}
                  </Btn>
                </div>
              </div>
            </Card>
          )}

          {annList.length === 0 ? (
            <EmptyState title="No company announcements posted yet" />
          ) : (
            annList.map((a) => (
              <Card key={a.id} accent={a.is_pinned}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      {a.is_pinned && <Tag tone="accent">PINNED</Tag>}
                      <Tag tone="outline">{a.category.toUpperCase()}</Tag>
                      <span style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
                        {new Date(a.published_at).toLocaleDateString('en-PH')} &bull; {a.publishedByName || 'HR Team'}
                      </span>
                    </div>
                    <h3 style={{ margin: '4px 0 8px 0', fontSize: '1.15rem' }}>{a.title}</h3>
                  </div>
                  {isHr && (
                    <Btn variant="ghost" onClick={() => deleteAnn.mutate(a.id)}>
                      Delete
                    </Btn>
                  )}
                </div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{a.body}</p>
              </Card>
            ))
          )}
        </div>
      )}

      {/* TAB 2: My Profile & Change Requests */}
      {activeTab === 'profile' && p && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-3)' }}>
            <Card kicker="Employment Record">
              <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 6 }}>
                {p.firstName} {p.lastName}
              </div>
              <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div><strong>Employee No:</strong> {p.employeeNo}</div>
                <div><strong>Position:</strong> {p.positionTitle || 'Staff'}</div>
                <div><strong>Department:</strong> {p.departmentName || 'General'}</div>
                <div><strong>Branch:</strong> {p.branchName || 'Main / HQ'}</div>
                <div><strong>Work Email:</strong> {p.workEmail || '—'}</div>
                <div><strong>Hired On:</strong> {p.hiredOn || '—'}</div>
                <div><strong>Status:</strong> <Tag tone="accent">{p.status}</Tag></div>
              </div>
            </Card>

            <Card kicker="Statutory IDs & Payroll Bank">
              <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                <div><strong>TIN:</strong> {p.tin || 'Not encoded'}</div>
                <div><strong>SSS No:</strong> {p.sssNo || 'Not encoded'}</div>
                <div><strong>PhilHealth No:</strong> {p.philhealthNo || 'Not encoded'}</div>
                <div><strong>Pag-IBIG MID:</strong> {p.pagibigNo || 'Not encoded'}</div>
                <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 6, marginTop: 4 }}>
                  <strong>Payroll Bank:</strong> {p.bankName || '—'} ({p.bankAccountNo || 'No account'})
                </div>
                <div><strong>Account Name:</strong> {p.bankAccountName || '—'}</div>
              </div>
            </Card>
          </div>

          {/* Submit Profile Update Request */}
          <Card kicker="Request HR Data Update">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: 8 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Update Type</label>
                <select
                  className="input"
                  value={reqType}
                  onChange={(e) => {
                    setReqType(e.target.value as any);
                    setReqFields({});
                  }}
                >
                  <option value="bank_account">Payroll Bank Account Change</option>
                  <option value="government_id">Government IDs (TIN / SSS / PHIC / HDMF)</option>
                  <option value="contact_info">Work Email / Contact Info</option>
                </select>
              </div>

              {reqType === 'bank_account' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Bank Name</label>
                    <select
                      className="input"
                      value={reqFields.bankName || ''}
                      onChange={(e) => setReqFields({ ...reqFields, bankName: e.target.value })}
                    >
                      <option value="">Select Bank...</option>
                      <option value="BPI">BPI</option>
                      <option value="BDO">BDO</option>
                      <option value="METROBANK">Metrobank</option>
                      <option value="UNIONBANK">UnionBank</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>New Account Number</label>
                    <input
                      className="input"
                      placeholder="e.g., 0012-3456-78"
                      value={reqFields.bankAccountNo || ''}
                      onChange={(e) => setReqFields({ ...reqFields, bankAccountNo: e.target.value })}
                    />
                  </div>
                </>
              )}

              {reqType === 'government_id' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>TIN</label>
                    <input
                      className="input"
                      placeholder="000-000-000-000"
                      value={reqFields.tin || ''}
                      onChange={(e) => setReqFields({ ...reqFields, tin: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>SSS / PhilHealth / Pag-IBIG</label>
                    <input
                      className="input"
                      placeholder="SSS No."
                      value={reqFields.sssNo || ''}
                      onChange={(e) => setReqFields({ ...reqFields, sssNo: e.target.value })}
                    />
                  </div>
                </>
              )}

              {reqType === 'contact_info' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>New Work Email</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="name@company.com"
                    value={reqFields.workEmail || ''}
                    onChange={(e) => setReqFields({ ...reqFields, workEmail: e.target.value })}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Reason / Supporting Note</label>
                <input
                  className="input"
                  placeholder="Why is this update needed?"
                  value={reqReason}
                  onChange={(e) => setReqReason(e.target.value)}
                />
              </div>
            </div>
            <ErrorNote error={submitReq.error} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Btn
                variant="primary"
                disabled={submitReq.isPending || !reqReason.trim()}
                onClick={() => submitReq.mutate()}
              >
                {submitReq.isPending ? 'Submitting...' : 'Submit Request to HR'}
              </Btn>
            </div>
          </Card>

          {/* Requests Ledger */}
          <Card kicker={isHr ? 'Employee Data Change Requests (HR Approval Queue)' : 'My Submitted Requests'}>
            {reqList.length === 0 ? (
              <p className="card-body" style={{ margin: 0 }}>No profile update requests.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Type</th>
                      <th>Requested Values</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {reqList.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.employeeName}</strong>
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)' }}>{r.employeeNo}</div>
                        </td>
                        <td><Tag tone="outline">{r.request_type}</Tag></td>
                        <td style={{ fontSize: '0.85rem' }}>
                          {Object.entries(r.requested_changes || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}
                        </td>
                        <td>{r.reason}</td>
                        <td>
                          <Tag tone={r.status === 'approved' ? 'accent' : r.status === 'rejected' ? 'outline' : 'solid'}>
                            {r.status}
                          </Tag>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {isHr && r.status === 'pending' && (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <Btn
                                variant="primary"
                                disabled={reviewReq.isPending}
                                onClick={() => reviewReq.mutate({ id: r.id, decision: 'approve' })}
                              >
                                Approve
                              </Btn>
                              <Btn
                                variant="secondary"
                                disabled={reviewReq.isPending}
                                onClick={() => reviewReq.mutate({ id: r.id, decision: 'reject' })}
                              >
                                Reject
                              </Btn>
                            </div>
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

      {/* TAB 3: Certificate of Employment (COE) */}
      {activeTab === 'coe' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeComp}
                onChange={(e) => setIncludeComp(e.target.checked)}
              />
              Include monthly compensation rate on certificate
            </label>
            <Btn variant="primary" onClick={() => window.print()}>
              Print / Save COE as PDF
            </Btn>
          </div>

          {coe.isLoading ? (
            <Spinner />
          ) : coe.data ? (
            <Card style={{ padding: '40px', maxWidth: 780, margin: '0 auto', width: '100%' }}>
              <div style={{ textAlign: 'center', borderBottom: '2px solid var(--color-divider)', paddingBottom: 16, marginBottom: 28 }}>
                <h2 style={{ margin: 0, letterSpacing: 1 }}>{coe.data.company.registeredName}</h2>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-neutral-600)', marginTop: 4 }}>
                  {coe.data.company.companyAddress}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
                  {coe.data.company.hrEmail} {coe.data.company.contactNumber ? `• ${coe.data.company.contactNumber}` : ''}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: 24 }}>
                <span><strong>Ref No:</strong> {coe.data.referenceNo}</span>
                <span><strong>Date Issued:</strong> {coe.data.issuedOn}</span>
              </div>

              <h3 style={{ textAlign: 'center', letterSpacing: 2, margin: '0 0 24px 0' }}>
                CERTIFICATE OF EMPLOYMENT
              </h3>

              <p style={{ lineHeight: 1.8, fontSize: '1rem' }}>
                To Whom It May Concern:
              </p>
              <p style={{ lineHeight: 1.8, fontSize: '1rem' }}>
                This is to certify that <strong>{coe.data.employee.fullName}</strong> (Employee No.{' '}
                <strong>{coe.data.employee.employeeNo}</strong>) is currently employed with{' '}
                <strong>{coe.data.company.registeredName}</strong> as{' '}
                <strong>{coe.data.employee.positionTitle}</strong> under the{' '}
                <strong>{coe.data.employee.departmentName}</strong> department (assigned at{' '}
                <strong>{coe.data.employee.branchName}</strong>) from{' '}
                <strong>{coe.data.employee.hiredOn || 'start of service'}</strong> up to the present,
                holding <strong>{coe.data.employee.status}</strong> employment status.
              </p>

              {includeComp && coe.data.employee.monthlyRate !== undefined && (
                <p style={{ lineHeight: 1.8, fontSize: '1rem' }}>
                  They are currently receiving a gross monthly basic compensation of{' '}
                  <strong>
                    ₱{Number(coe.data.employee.monthlyRate).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </strong>.
                </p>
              )}

              <p style={{ lineHeight: 1.8, fontSize: '1rem' }}>
                This certification is issued upon the request of the aforementioned employee for whatever
                lawful purpose it may serve.
              </p>

              <div style={{ marginTop: 48 }}>
                <div style={{ fontWeight: 700 }}>Human Resources Department</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-neutral-600)' }}>
                  {coe.data.company.registeredName}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)', marginTop: 8 }}>
                  System-generated digital certificate &bull; Ref: {coe.data.referenceNo}
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </Section>
  );
}
