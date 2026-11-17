import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type { Employee } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Btn, Card, EmptyState, PageHead, Section, Tag } from '../components/ds';

interface Requisition {
  id: string;
  title: string;
  departmentName?: string;
  branchName?: string;
  employment_type: string;
  headcount_target: number;
  salary_range?: string;
  status: string;
  applicantCount: number;
  hiredCount: number;
}

interface Applicant {
  id: string;
  requisition_id: string;
  requisitionTitle: string;
  full_name: string;
  email: string;
  phone?: string;
  source: string;
  stage: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';
  expected_salary?: string;
  interview_date?: string;
}

interface AuditLogRow {
  id: string;
  occurredAt: string;
  tableName: string;
  recordId: string;
  operation: string;
  changedColumns?: string[];
  actorName?: string;
  actorEmployeeNo?: string;
}

export default function RecruitmentAndAudit() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'ats' | 'audit'>('ats');

  const [reqForm, setReqForm] = useState({
    title: '',
    employmentType: 'Full-time Regular',
    headcountTarget: '1',
    salaryRange: '',
  });
  const [appForm, setAppForm] = useState({
    requisitionId: '',
    fullName: '',
    email: '',
    phone: '',
    source: 'JobStreet / LinkedIn',
  });
  const [auditTable, setAuditTable] = useState('');

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const isHrAdmin = (me.data?.roles ?? []).includes('hr_admin');

  const requisitions = useQuery({
    queryKey: ['operations', 'requisitions'],
    queryFn: () => api<Requisition[]>('/operations/requisitions'),
  });

  const applicants = useQuery({
    queryKey: ['operations', 'applicants'],
    queryFn: () => api<Applicant[]>('/operations/applicants'),
  });

  const auditLogs = useQuery({
    queryKey: ['operations', 'audit-logs', auditTable],
    queryFn: () => api<AuditLogRow[]>(`/operations/audit-logs?limit=100${auditTable ? `&table=${encodeURIComponent(auditTable)}` : ''}`),
    enabled: tab === 'audit' && isHrAdmin,
  });

  const createReq = useMutation({
    mutationFn: () =>
      api('/operations/requisitions', {
        method: 'POST',
        body: { ...reqForm, headcountTarget: Number(reqForm.headcountTarget || 1) },
      }),
    onSuccess: () => {
      setReqForm({ title: '', employmentType: 'Full-time Regular', headcountTarget: '1', salaryRange: '' });
      void qc.invalidateQueries({ queryKey: ['operations', 'requisitions'] });
    },
  });

  const createApp = useMutation({
    mutationFn: () => api('/operations/applicants', { method: 'POST', body: appForm }),
    onSuccess: () => {
      setAppForm({ ...appForm, fullName: '', email: '', phone: '' });
      void qc.invalidateQueries({ queryKey: ['operations', 'applicants'] });
      void qc.invalidateQueries({ queryKey: ['operations', 'requisitions'] });
    },
  });

  const moveStage = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api(`/operations/applicants/${id}/stage`, { method: 'PATCH', body: { stage } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['operations', 'applicants'] });
      void qc.invalidateQueries({ queryKey: ['operations', 'requisitions'] });
    },
  });

  return (
    <Section>
      <PageHead title="Recruitment (ATS) & System Audit Trail">
        <Btn variant={tab === 'ats' ? 'primary' : 'secondary'} onClick={() => setTab('ats')}>
          Recruitment & Applicants
        </Btn>
        {isHrAdmin && (
          <Btn variant={tab === 'audit' ? 'primary' : 'secondary'} onClick={() => setTab('audit')}>
            Audit Trail Viewer
          </Btn>
        )}
      </PageHead>

      {tab === 'ats' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-3)' }}>
            <Card kicker="Open Job Requisition">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                <input className="input" placeholder="Position Title (e.g., Fleet Dispatcher)" value={reqForm.title} onChange={(e) => setReqForm({ ...reqForm, title: e.target.value })} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input className="input" placeholder="Salary Range (e.g., ₱25k–₱35k)" value={reqForm.salaryRange} onChange={(e) => setReqForm({ ...reqForm, salaryRange: e.target.value })} />
                  <input type="number" className="input" placeholder="Headcount" value={reqForm.headcountTarget} onChange={(e) => setReqForm({ ...reqForm, headcountTarget: e.target.value })} />
                </div>
                <ErrorNote error={createReq.error} />
                <Btn variant="primary" disabled={createReq.isPending || !reqForm.title.trim()} onClick={() => createReq.mutate()}>
                  {createReq.isPending ? 'Creating...' : '+ Post Job Requisition'}
                </Btn>
              </div>
            </Card>

            <Card kicker="Add Candidate to Pipeline">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                <select className="input" value={appForm.requisitionId} onChange={(e) => setAppForm({ ...appForm, requisitionId: e.target.value })}>
                  <option value="">Select Job Requisition...</option>
                  {(requisitions.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{r.title} ({r.status})</option>
                  ))}
                </select>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input className="input" placeholder="Candidate Full Name" value={appForm.fullName} onChange={(e) => setAppForm({ ...appForm, fullName: e.target.value })} />
                  <input className="input" type="email" placeholder="Email Address" value={appForm.email} onChange={(e) => setAppForm({ ...appForm, email: e.target.value })} />
                </div>
                <ErrorNote error={createApp.error} />
                <Btn variant="primary" disabled={createApp.isPending || !appForm.requisitionId || !appForm.fullName.trim()} onClick={() => createApp.mutate()}>
                  {createApp.isPending ? 'Adding...' : '+ Add Applicant'}
                </Btn>
              </div>
            </Card>
          </div>

          <Card kicker="Open Requisitions">
            {requisitions.isLoading ? <Spinner /> : (requisitions.data ?? []).length === 0 ? (
              <EmptyState title="No job requisitions posted yet" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th>Salary Range</th>
                      <th>Target</th>
                      <th>Applicants</th>
                      <th>Hired</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(requisitions.data ?? []).map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.title}</strong></td>
                        <td>{r.salary_range || '—'}</td>
                        <td>{r.headcount_target}</td>
                        <td>{r.applicantCount}</td>
                        <td>{r.hiredCount}</td>
                        <td><Tag tone="accent">{r.status}</Tag></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card kicker="Applicant Pipeline">
            {applicants.isLoading ? <Spinner /> : (applicants.data ?? []).length === 0 ? (
              <EmptyState title="No applicants in pipeline yet" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Position</th>
                      <th>Source</th>
                      <th>Stage</th>
                      <th>Update Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(applicants.data ?? []).map((a) => (
                      <tr key={a.id}>
                        <td><strong>{a.full_name}</strong><div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)' }}>{a.email}</div></td>
                        <td>{a.requisitionTitle}</td>
                        <td>{a.source}</td>
                        <td><Tag tone={a.stage === 'hired' ? 'accent' : a.stage === 'rejected' ? 'outline' : 'solid'}>{a.stage}</Tag></td>
                        <td>
                          <select
                            className="input"
                            style={{ width: 'auto', minHeight: 32, padding: '2px 8px' }}
                            value={a.stage}
                            onChange={(e) => moveStage.mutate({ id: a.id, stage: e.target.value })}
                          >
                            <option value="applied">Applied</option>
                            <option value="screening">Screening</option>
                            <option value="interview">Interview</option>
                            <option value="offer">Job Offer</option>
                            <option value="hired">Hired</option>
                            <option value="rejected">Rejected</option>
                          </select>
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

      {tab === 'audit' && isHrAdmin && (
        <Card kicker="Immutable System Audit Log (Trigger-Recorded)">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--color-neutral-600)' }}>
              Shows database-level INSERT, UPDATE, and DELETE audit events for your organization.
            </span>
            <select className="input" style={{ width: 'auto' }} value={auditTable} onChange={(e) => setAuditTable(e.target.value)}>
              <option value="">All Tables</option>
              <option value="payroll_run">payroll_run</option>
              <option value="employee_compensation">employee_compensation</option>
              <option value="employee">employee</option>
              <option value="leave_request">leave_request</option>
              <option value="attendance_record">attendance_record</option>
              <option value="hr_settings">hr_settings</option>
            </select>
          </div>
          {auditLogs.isLoading ? <Spinner /> : (auditLogs.data ?? []).length === 0 ? (
            <EmptyState title="No audit log entries found" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Operation</th>
                    <th>Table</th>
                    <th>Changed Columns</th>
                  </tr>
                </thead>
                <tbody>
                  {(auditLogs.data ?? []).map((row) => (
                    <tr key={row.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                        {new Date(row.occurredAt).toLocaleString('en-PH')}
                      </td>
                      <td>{row.actorName ? `${row.actorName} (${row.actorEmployeeNo})` : 'System'}</td>
                      <td><Tag tone={row.operation === 'DELETE' ? 'solid' : 'outline'}>{row.operation}</Tag></td>
                      <td><code>{row.tableName}</code></td>
                      <td style={{ fontSize: '0.85rem' }}>{row.changedColumns?.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}
