import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../auth';
import type { Employee, TimelineEvent, TimelineKind } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Card, EmptyState, Icon, PageHead, Section, Tag, paths } from '../components/ds';
import EmploymentActions from './admin/EmploymentActions';

const KIND_LABEL: Record<TimelineKind, string> = {
  review: 'Review',
  task_evaluation: 'Task evaluation',
  pip: 'Improvement plan',
  competency: 'Competency',
  employment_event: 'Employment',
};

const KIND_ICON: Record<TimelineKind, keyof typeof paths> = {
  review: 'clipboard',
  task_evaluation: 'target',
  pip: 'lifeBuoy',
  competency: 'layers',
  employment_event: 'briefcase',
};

interface EmployeeDocument {
  id: string;
  document_type: string;
  title: string;
  file_url: string;
  file_size_bytes?: number;
  mime_type?: string;
  verification_status: string;
  expiry_date?: string;
  created_at: string;
}

interface MeritAward {
  id: string;
  award_type: string;
  title: string;
  issuing_body?: string;
  date_awarded: string;
  citation?: string;
  created_at: string;
}

export default function EmployeeHistory() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'timeline' | 'vault' | 'merits'>('timeline');

  // Vault upload modal state
  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm] = useState({
    documentType: 'nbi_clearance',
    title: '',
    fileUrl: 'https://storage.googleapis.com/hr-vault-sample/sample_document.pdf',
    expiryDate: '',
  });

  // Merit award modal state
  const [showMeritModal, setShowMeritModal] = useState(false);
  const [meritForm, setMeritForm] = useState({
    awardType: 'commendation',
    title: '',
    issuingBody: 'Executive Committee',
    dateAwarded: new Date().toISOString().slice(0, 10),
    citation: '',
  });

  const employee = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api<Employee>(`/employees/${employeeId}`),
  });

  const timeline = useQuery({
    queryKey: ['timeline', employeeId],
    queryFn: () => api<TimelineEvent[]>(`/employees/${employeeId}/timeline`),
  });

  const documents = useQuery({
    queryKey: ['employee-documents', employeeId],
    queryFn: () => api<EmployeeDocument[]>(`/employees/${employeeId}/documents`),
    enabled: Boolean(employeeId),
  });

  const merits = useQuery({
    queryKey: ['employee-merits', employeeId],
    queryFn: () => api<MeritAward[]>(`/employees/${employeeId}/merits`),
    enabled: Boolean(employeeId),
  });

  const uploadDocMutation = useMutation({
    mutationFn: (data: typeof docForm) =>
      api(`/employees/${employeeId}/documents`, {
        method: 'POST',
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
      setShowDocModal(false);
      setDocForm({
        documentType: 'nbi_clearance',
        title: '',
        fileUrl: 'https://storage.googleapis.com/hr-vault-sample/sample_document.pdf',
        expiryDate: '',
      });
    },
  });

  const addMeritMutation = useMutation({
    mutationFn: (data: typeof meritForm) =>
      api(`/employees/${employeeId}/merits`, {
        method: 'POST',
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-merits', employeeId] });
      setShowMeritModal(false);
      setMeritForm({
        awardType: 'commendation',
        title: '',
        issuingBody: 'Executive Committee',
        dateAwarded: new Date().toISOString().slice(0, 10),
        citation: '',
      });
    },
  });

  if (employee.error) return <ErrorNote error={employee.error} />;
  if (timeline.error) return <ErrorNote error={timeline.error} />;
  if (employee.isLoading || timeline.isLoading) return <Spinner />;

  const events = timeline.data ?? [];
  const name = `${employee.data?.firstName ?? ''} ${employee.data?.lastName ?? ''}`.trim();
  const years = [...new Set(events.map((e) => e.occurredOn.slice(0, 4)))];

  return (
    <Section>
      <PageHead
        title={name || 'Employee history'}
        meta={<span style={{ fontSize: 15, opacity: 0.7 }}>
          {events.length} {events.length === 1 ? 'entry' : 'entries'} • 201 Digital File
        </span>}
      >
        <Link className="btn btn-ghost" to={`/employees/${employeeId}/goals`}>Goals</Link>
      </PageHead>

      <EmploymentActions employeeId={employeeId!} name={name} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--color-border)', margin: '20px 0' }}>
        <button
          className={`btn ${activeTab === 'timeline' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('timeline')}
          style={{ fontSize: '14.5px' }}
        >
          Timeline & Career Events
        </button>
        <button
          className={`btn ${activeTab === 'vault' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('vault')}
          style={{ fontSize: '14.5px' }}
        >
          201 Document Vault ({documents.data?.length ?? 0})
        </button>
        <button
          className={`btn ${activeTab === 'merits' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('merits')}
          style={{ fontSize: '14.5px' }}
        >
          Merits, Commendations & Certifications ({merits.data?.length ?? 0})
        </button>
      </div>

      {/* Tab 1: Timeline Events */}
      {activeTab === 'timeline' && (
        events.length === 0 ? (
          <EmptyState title="Nothing recorded yet">
            Reviews, task evaluations, improvement plans, competency assessments and
            employment changes all appear here as they happen.
          </EmptyState>
        ) : (
          years.map((year) => (
            <Card key={year} kicker={year}>
              <ul style={{
                margin: 0, padding: 0, listStyle: 'none',
                display: 'flex', flexDirection: 'column',
              }}>
                {events.filter((e) => e.occurredOn.startsWith(year)).map((e) => (
                  <li
                    key={e.refId + e.kind}
                    style={{
                      display: 'flex', gap: 'var(--space-3)',
                      padding: 'var(--space-3) 0',
                      borderTop: '1px solid var(--color-border)',
                      alignItems: 'flex-start',
                    }}
                  >
                    <Icon path={paths[KIND_ICON[e.kind]]} size={18}
                          style={{ opacity: 0.7, flexShrink: 0, marginTop: 2 }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 'var(--space-2)',
                                    alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong>{e.title}</strong>
                        <Tag>{KIND_LABEL[e.kind]}</Tag>
                      </div>
                      {e.detail && (
                        <div className="text-xs t-muted" style={{ marginTop: 2 }}>
                          {e.detail}
                        </div>
                      )}
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {e.result && <div className="tabular-nums">{e.result}</div>}
                      <div className="text-xs t-faint tabular-nums">{e.occurredOn}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))
        )
      )}

      {/* Tab 2: 201 Document Vault */}
      {activeTab === 'vault' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>201 Digital Personnel Records</h3>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Secure employee record archive (NBI, Fit-to-Work Medical, Contracts, Government Form IDs).
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowDocModal(true)}>
              + Upload 201 Document
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-muted)' }}>
                  <th style={{ padding: '12px 14px' }}>Document Category</th>
                  <th style={{ padding: '12px 14px' }}>Title / Description</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>Verification</th>
                  <th style={{ padding: '12px 14px' }}>Expiry Date</th>
                  <th style={{ padding: '12px 14px' }}>Uploaded</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.data && documents.data.length > 0 ? (
                  documents.data.map((doc) => (
                    <tr key={doc.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 600, textTransform: 'capitalize' }}>
                        {doc.document_type.replace(/_/g, ' ')}
                      </td>
                      <td style={{ padding: '12px 14px' }}>{doc.title}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <Tag tone={doc.verification_status === 'verified' ? 'accent' : 'neutral'}>
                          {doc.verification_status.toUpperCase()}
                        </Tag>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--color-muted)' }}>{doc.expiry_date || 'No Expiry'}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--color-muted)' }}>{doc.created_at?.slice(0, 10)}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <a href={doc.file_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                          View ↗
                        </a>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-muted)' }}>
                      No 201 records uploaded yet. Click '+ Upload 201 Document' to archive credentials.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Upload Modal */}
          {showDocModal && (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
              <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '440px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>Attach 201 Personnel Document</h3>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Document Category</label>
                  <select
                    className="input"
                    style={{ width: '100%' }}
                    value={docForm.documentType}
                    onChange={(e) => setDocForm({ ...docForm, documentType: e.target.value })}
                  >
                    <option value="nbi_clearance">NBI Clearance</option>
                    <option value="medical_fit_to_work">Pre-Employment Medical / Fit-to-Work</option>
                    <option value="employment_contract">Signed Employment Contract</option>
                    <option value="diploma_tor">Transcript of Records / Diploma</option>
                    <option value="sss_form_e1">SSS Member Data / E-1</option>
                    <option value="philhealth_mdr">PhilHealth Member Data Record</option>
                    <option value="pagibig_mdf">Pag-IBIG Member Data Form</option>
                    <option value="bir_form_1902">BIR Form 1902 / 2316</option>
                  </select>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Document Title</label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: '100%' }}
                    placeholder="e.g. Valid NBI Clearance 2026"
                    value={docForm.title}
                    onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                  />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Expiry Date (Optional)</label>
                  <input
                    type="date"
                    className="input"
                    style={{ width: '100%' }}
                    value={docForm.expiryDate}
                    onChange={(e) => setDocForm({ ...docForm, expiryDate: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowDocModal(false)}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    disabled={!docForm.title || uploadDocMutation.isPending}
                    onClick={() => uploadDocMutation.mutate(docForm)}
                  >
                    {uploadDocMutation.isPending ? 'Archiving...' : 'Save into 201 Vault'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Merits & Commendations */}
      {activeTab === 'merits' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Merits, Commendations & Certifications</h3>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Formal recognitions, service excellence citations, and technical seminar certifications.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowMeritModal(true)}>
              + Record Merit / Award
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {merits.data && merits.data.length > 0 ? (
              merits.data.map((m) => (
                <Card key={m.id} kicker={m.award_type.toUpperCase().replace(/_/g, ' ')} title={m.title}>
                  <div style={{ fontSize: '14.5px', color: 'var(--color-fg)', marginTop: '6px' }}>
                    Issuing Authority: <strong>{m.issuing_body || 'Company Executive Committee'}</strong>
                  </div>
                  <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '4px' }}>
                    Award Date: {m.date_awarded}
                  </div>
                  {m.citation && (
                    <div style={{ marginTop: '10px', fontSize: '15px', fontStyle: 'italic', color: 'var(--color-muted)', borderLeft: '2px solid var(--color-accent)', paddingLeft: '8px' }}>
                      "{m.citation}"
                    </div>
                  )}
                </Card>
              ))
            ) : (
              <div style={{ gridColumn: '1 / -1', padding: '32px', textAlign: 'center', color: 'var(--color-muted)', backgroundColor: 'var(--color-surface)', borderRadius: '8px' }}>
                No commendations or certifications recorded yet.
              </div>
            )}
          </div>

          {/* Merit Modal */}
          {showMeritModal && (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
              <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '440px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>Record Commendation or Award</h3>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Award / Merit Type</label>
                  <select
                    className="input"
                    style={{ width: '100%' }}
                    value={meritForm.awardType}
                    onChange={(e) => setMeritForm({ ...meritForm, awardType: e.target.value })}
                  >
                    <option value="commendation">Commendation / Letter of Appreciation</option>
                    <option value="employee_of_the_month">Employee of the Month</option>
                    <option value="excellence_award">Customer Service Excellence</option>
                    <option value="certification">Professional Training / DOLE Certification</option>
                    <option value="service_award">Loyalty / Length of Service Award</option>
                  </select>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Award Title</label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: '100%' }}
                    placeholder="e.g. Q3 Top Performer Citation"
                    value={meritForm.title}
                    onChange={(e) => setMeritForm({ ...meritForm, title: e.target.value })}
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Date Awarded</label>
                  <input
                    type="date"
                    className="input"
                    style={{ width: '100%' }}
                    value={meritForm.dateAwarded}
                    onChange={(e) => setMeritForm({ ...meritForm, dateAwarded: e.target.value })}
                  />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Citation / Remarks</label>
                  <textarea
                    rows={3}
                    className="input"
                    style={{ width: '100%' }}
                    placeholder="e.g. Demonstrated exceptional dedication during peak operations..."
                    value={meritForm.citation}
                    onChange={(e) => setMeritForm({ ...meritForm, citation: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowMeritModal(false)}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    disabled={!meritForm.title || addMeritMutation.isPending}
                    onClick={() => addMeritMutation.mutate(meritForm)}
                  >
                    {addMeritMutation.isPending ? 'Recording...' : 'Record Award'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
