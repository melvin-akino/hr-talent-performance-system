import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../auth';
import type { Employee } from '../types';
import { ErrorNote, Spinner, Field, inputClass } from '../components/ui';
import { Btn, Card, EmptyState, PageHead, Section, Tag } from '../components/ds';

type ReportType =
  | 'evaluations'
  | 'workforce'
  | 'statutory'
  | 'payroll_register'
  | 'attendance'
  | 'leaves'
  | 'performance_curve';

interface Options {
  departments: { id: string; code: string; name: string }[];
  branches?: { id: string; code: string; name: string }[];
  payrollRuns?: { id: string; periodName: string; cutoffStart: string; cutoffEnd: string }[];
  leaveTypes?: { id: string; code: string; name: string; isStatutory: boolean }[];
  kinds: { value: string; label: string }[];
  evalTypes: { value: string; label: string }[];
  pipOutcomes: string[];
}

export default function Reports() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const [activeReport, setActiveReport] = useState<ReportType>('workforce');

  // Common filters
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('');
  const [runId, setRunId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());

  const options = useQuery({
    queryKey: ['report-options'],
    queryFn: () => api<Options>('/reports/options'),
  });

  // 1. Workforce Report
  const workforce = useQuery({
    queryKey: ['report-workforce', status, departmentId, branchId],
    queryFn: () => {
      const q = new URLSearchParams();
      if (status) q.set('status', status);
      if (departmentId) q.set('departmentId', departmentId);
      if (branchId) q.set('branchId', branchId);
      return api<{ rows: any[]; summary: any }>(`/reports/workforce?${q}`);
    },
    enabled: activeReport === 'workforce',
  });

  // 2. Statutory Contributions Summary
  const statutory = useQuery({
    queryKey: ['report-statutory', dateFrom, dateTo],
    queryFn: () => {
      const q = new URLSearchParams();
      if (dateFrom) q.set('from', dateFrom);
      if (dateTo) q.set('to', dateTo);
      return api<{ rows: any[]; summary: any }>(`/reports/statutory-summary?${q}`);
    },
    enabled: activeReport === 'statutory',
  });

  // 3. Payroll Register & Cost Summary
  const payrollReg = useQuery({
    queryKey: ['report-payroll-register', runId, branchId, departmentId],
    queryFn: () => {
      const q = new URLSearchParams();
      if (runId) q.set('runId', runId);
      if (branchId) q.set('branchId', branchId);
      if (departmentId) q.set('departmentId', departmentId);
      return api<{ rows: any[]; summary: any }>(`/reports/payroll-register?${q}`);
    },
    enabled: activeReport === 'payroll_register',
  });

  // 4. Attendance & Overtime Analysis
  const attendance = useQuery({
    queryKey: ['report-attendance', dateFrom, dateTo, departmentId, branchId],
    queryFn: () => {
      const q = new URLSearchParams();
      if (dateFrom) q.set('from', dateFrom);
      if (dateTo) q.set('to', dateTo);
      if (departmentId) q.set('departmentId', departmentId);
      if (branchId) q.set('branchId', branchId);
      return api<{ rows: any[]; summary: any }>(`/reports/attendance-analysis?${q}`);
    },
    enabled: activeReport === 'attendance',
  });

  // 5. Leave Balances & Statutory Utilization
  const leaves = useQuery({
    queryKey: ['report-leaves', year, leaveTypeId, departmentId],
    queryFn: () => {
      const q = new URLSearchParams();
      if (year) q.set('year', year);
      if (leaveTypeId) q.set('leaveTypeId', leaveTypeId);
      if (departmentId) q.set('departmentId', departmentId);
      return api<{ rows: any[]; summary: any }>(`/reports/leave-utilization?${q}`);
    },
    enabled: activeReport === 'leaves',
  });

  // 6. Performance Bell Curve Distribution
  const performanceCurve = useQuery({
    queryKey: ['report-performance-curve', departmentId],
    queryFn: () => {
      const q = new URLSearchParams();
      if (departmentId) q.set('departmentId', departmentId);
      return api<{ rows: any[]; summary: any }>(`/reports/performance-distribution?${q}`);
    },
    enabled: activeReport === 'performance_curve',
  });

  // 7. Legacy Evaluation History
  const [evalName, setEvalName] = useState('');
  const [evalKind, setEvalKind] = useState('');
  const evaluations = useQuery({
    queryKey: ['report-evaluations', dateFrom, dateTo, departmentId, evalName, evalKind],
    queryFn: () => {
      const q = new URLSearchParams();
      if (dateFrom) q.set('from', dateFrom);
      if (dateTo) q.set('to', dateTo);
      if (departmentId) q.set('departmentId', departmentId);
      if (evalName) q.set('name', evalName);
      if (evalKind) q.set('kinds', evalKind);
      return api<{ rows: any[]; limit: number; truncated: boolean }>(`/reports/evaluations?${q}`);
    },
    enabled: activeReport === 'evaluations',
  });

  const downloadCsv = async (endpoint: string, filename: string, params: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const csv = await api<string>(`/reports/${endpoint}?${q}`, { raw: true });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasPayroll = me.data?.features?.feature_ph_payroll ?? true;
  const hasAttendance = me.data?.features?.feature_time_attendance ?? true;
  const hasLeaves = me.data?.features?.feature_leave_management ?? true;

  return (
    <Section>
      <PageHead
        title="Executive & Compliance Reports"
        meta={
          <span style={{ fontSize: 15, opacity: 0.75 }}>
            Audit-ready reporting for HR, Statutory Compliance, Payroll, and Performance
          </span>
        }
      />

      {/* Report Category Navigation Bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button
          className={`btn ${activeReport === 'workforce' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveReport('workforce')}
        >
          Workforce & Headcount
        </button>

        {hasPayroll && (
          <>
            <button
              className={`btn ${activeReport === 'statutory' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveReport('statutory')}
            >
              Statutory Contributions (SSS / PH / HDMF / BIR)
            </button>
            <button
              className={`btn ${activeReport === 'payroll_register' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveReport('payroll_register')}
            >
              Payroll Register & Branch Costs
            </button>
          </>
        )}

        {hasAttendance && (
          <button
            className={`btn ${activeReport === 'attendance' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveReport('attendance')}
          >
            Attendance & Overtime
          </button>
        )}

        {hasLeaves && (
          <button
            className={`btn ${activeReport === 'leaves' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveReport('leaves')}
          >
            Leave Balances & SIL Monetization
          </button>
        )}

        <button
          className={`btn ${activeReport === 'performance_curve' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveReport('performance_curve')}
        >
          Rating Distribution (Bell Curve)
        </button>

        <button
          className={`btn ${activeReport === 'evaluations' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveReport('evaluations')}
        >
          Evaluation History
        </button>
      </div>

      {/* ==================================================================== */}
      {/* 1. WORKFORCE & DEMOGRAPHICS REPORT                                   */}
      {/* ==================================================================== */}
      {activeReport === 'workforce' && (
        <>
          <Card kicker="Filters" title="Workforce & Headcount Criteria">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Status">
                <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="on_leave">On Leave</option>
                  <option value="suspended">Suspended</option>
                  <option value="separated">Separated</option>
                </select>
              </Field>

              <Field label="Department">
                <select className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">All Departments</option>
                  {options.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>

              {options.data?.branches && options.data.branches.length > 0 && (
                <Field label="Branch / Entity">
                  <select className={inputClass} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">All Branches</option>
                    {options.data.branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <Btn
                variant="primary"
                onClick={() =>
                  downloadCsv('workforce.csv', 'workforce-report.csv', { status, departmentId, branchId })
                }
                disabled={!workforce.data?.rows.length}
              >
                Export Excel CSV
              </Btn>
            </div>
          </Card>

          {workforce.data?.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Total Headcount</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{workforce.data.summary.totalCount}</div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Active Employees</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--c-accent)' }}>
                  {workforce.data.summary.activeCount}
                </div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Average Tenure</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{workforce.data.summary.avgTenureYears} yrs</div>
              </div>
            </div>
          )}

          {workforce.isLoading && <Spinner label="Loading workforce data..." />}
          {workforce.error && <ErrorNote error={workforce.error} />}

          {workforce.data && (
            <Card kicker="Roster" title={`Employee Directory (${workforce.data.rows.length})`}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Emp No.</th><th>Full Name</th><th>Department</th><th>Branch</th>
                      <th>Type</th><th>Position</th><th>Tenure</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workforce.data.rows.map((r: any) => (
                      <tr key={r.employeeId}>
                        <td style={{ fontWeight: 600 }}>{r.employeeNo}</td>
                        <td>{r.employeeName}</td>
                        <td>{r.department}</td>
                        <td>{r.branch}</td>
                        <td>{r.employmentType}</td>
                        <td>{r.position}</td>
                        <td>{r.tenureYears} yrs</td>
                        <td>
                          <Tag tone={r.status === 'active' ? 'accent' : 'outline'}>{r.status}</Tag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ==================================================================== */}
      {/* 2. STATUTORY CONTRIBUTIONS MASTER SUMMARY                            */}
      {/* ==================================================================== */}
      {activeReport === 'statutory' && (
        <>
          <Card kicker="Filters" title="Statutory Remittance Range">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Cutoff From">
                <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </Field>
              <Field label="Cutoff To">
                <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </Field>
            </div>
            <div style={{ marginTop: 14 }}>
              <Btn
                variant="primary"
                onClick={() =>
                  downloadCsv('statutory-summary.csv', 'statutory-master-summary.csv', { from: dateFrom, to: dateTo })
                }
                disabled={!statutory.data?.rows.length}
              >
                Export BIR & Statutory CSV
              </Btn>
            </div>
          </Card>

          {statutory.data?.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Total SSS (EE + ER + WISP + EC)</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-accent)' }}>
                  ₱{Number(statutory.data.summary.totalSss).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Total PhilHealth (5% Split)</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-accent)' }}>
                  ₱{Number(statutory.data.summary.totalPhilhealth).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Total Pag-IBIG HDMF</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-accent)' }}>
                  ₱{Number(statutory.data.summary.totalPagibig).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Total BIR Withholding Tax</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-accent)' }}>
                  ₱{Number(statutory.data.summary.totalWithholdingTax).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          )}

          {statutory.isLoading && <Spinner label="Loading statutory contributions..." />}

          {statutory.data && (
            <Card kicker="Agency Breakdown" title="Statutory Remittances per Cutoff">
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Period</th><th>Cutoff Range</th><th>Employees</th><th>Gross Pay</th>
                      <th>SSS (EE/ER/WISP)</th><th>PhilHealth</th><th>Pag-IBIG</th><th>BIR Tax</th><th>Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statutory.data.rows.map((r: any) => {
                      const sssTotal = Number(r.totalSssEe) + Number(r.totalSssEr) + Number(r.totalWispEe) + Number(r.totalWispEr) + Number(r.totalEcEr);
                      const phTotal = Number(r.totalPhilhealthEe) + Number(r.totalPhilhealthEr);
                      const hdmfTotal = Number(r.totalPagibigEe) + Number(r.totalPagibigEr);
                      return (
                        <tr key={r.runId}>
                          <td style={{ fontWeight: 600 }}>{r.periodName}</td>
                          <td>{r.cutoffStart} to {r.cutoffEnd}</td>
                          <td>{r.employeeCount}</td>
                          <td>₱{Number(r.totalGross).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td>₱{sssTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td>₱{phTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td>₱{hdmfTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td>₱{Number(r.totalWithholdingTax).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td style={{ fontWeight: 700 }}>₱{Number(r.totalNetPay).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ==================================================================== */}
      {/* 3. PAYROLL REGISTER & BRANCH COST SUMMARY                            */}
      {/* ==================================================================== */}
      {activeReport === 'payroll_register' && (
        <>
          <Card kicker="Filters" title="Payroll Register Selection">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Payroll Cutoff Run">
                <select className={inputClass} value={runId} onChange={(e) => setRunId(e.target.value)}>
                  <option value="">All Runs</option>
                  {options.data?.payrollRuns?.map((pr) => (
                    <option key={pr.id} value={pr.id}>{pr.periodName} ({pr.cutoffStart} - {pr.cutoffEnd})</option>
                  ))}
                </select>
              </Field>

              <Field label="Department">
                <select className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">All Departments</option>
                  {options.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>

              {options.data?.branches && options.data.branches.length > 0 && (
                <Field label="Branch / Subsidiary">
                  <select className={inputClass} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">All Branches</option>
                    {options.data.branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <Btn
                variant="primary"
                onClick={() =>
                  downloadCsv('payroll-register.csv', 'payroll-register.csv', { runId, branchId, departmentId })
                }
                disabled={!payrollReg.data?.rows.length}
              >
                Export Full Payroll Register CSV
              </Btn>
            </div>
          </Card>

          {payrollReg.data?.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, margin: '16px 0' }}>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Employees Included</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{payrollReg.data.summary.employeeCount}</div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Grand Total Gross Pay</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  ₱{Number(payrollReg.data.summary.grandTotalGross).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Total Net Disbursement</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-accent)' }}>
                  ₱{Number(payrollReg.data.summary.grandTotalNet).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          )}

          {payrollReg.isLoading && <Spinner label="Loading payroll register..." />}

          {payrollReg.data && (
            <Card kicker="Master Register" title={`Detailed Register (${payrollReg.data.rows.length} items)`}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Emp No.</th><th>Employee</th><th>Branch</th><th>Basic</th>
                      <th>OT / Night</th><th>De Minimis</th><th>Gross</th><th>Statutory</th>
                      <th>BIR Tax</th><th>Net Pay</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollReg.data.rows.map((r: any) => (
                      <tr key={r.lineItemId}>
                        <td style={{ fontWeight: 600 }}>{r.employeeNo}</td>
                        <td>{r.employeeName}</td>
                        <td>{r.branch}</td>
                        <td>₱{Number(r.basicPay).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td>₱{(Number(r.overtimePay) + Number(r.nightDiffPay) + Number(r.holidayPay)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td>₱{Number(r.deMinimis).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td style={{ fontWeight: 600 }}>₱{Number(r.grossPay).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td>₱{Number(r.statutoryTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td>₱{Number(r.withholdingTax).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td style={{ fontWeight: 700, color: 'var(--c-accent)' }}>
                          ₱{Number(r.netPay).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td><Tag tone={r.paymentStatus === 'paid' ? 'accent' : 'outline'}>{r.paymentStatus}</Tag></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ==================================================================== */}
      {/* 4. ATTENDANCE & OVERTIME ANALYSIS                                    */}
      {/* ==================================================================== */}
      {activeReport === 'attendance' && (
        <>
          <Card kicker="Filters" title="Attendance & Lost Hours Analysis">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Work Date From">
                <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </Field>
              <Field label="Work Date To">
                <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </Field>
              <Field label="Department">
                <select className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">All Departments</option>
                  {options.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginTop: 14 }}>
              <Btn
                variant="primary"
                onClick={() =>
                  downloadCsv('attendance-analysis.csv', 'attendance-overtime-report.csv', { from: dateFrom, to: dateTo, departmentId, branchId })
                }
                disabled={!attendance.data?.rows.length}
              >
                Export Overtime & Tardiness CSV
              </Btn>
            </div>
          </Card>

          {attendance.data?.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, margin: '16px 0' }}>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Active Employees Recorded</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{attendance.data.summary.recordedEmployees}</div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Total Approved Overtime</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-accent)' }}>
                  {attendance.data.summary.totalOtHours} hrs
                </div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Lost Hours (Late & Undertime)</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#e53e3e' }}>
                  {attendance.data.summary.totalLostHours} hrs
                </div>
              </div>
            </div>
          )}

          {attendance.isLoading && <Spinner label="Loading attendance metrics..." />}

          {attendance.data && (
            <Card kicker="Timesheet Summary" title="Overtime & Tardiness by Employee">
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Emp No.</th><th>Employee</th><th>Department</th><th>Days</th>
                      <th>Regular Hours</th><th>Regular OT</th><th>Rest/Holiday OT</th>
                      <th>Night Diff</th><th>Late (Mins)</th><th>Incidents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.data.rows.map((r: any) => (
                      <tr key={r.employeeId}>
                        <td style={{ fontWeight: 600 }}>{r.employeeNo}</td>
                        <td>{r.employeeName}</td>
                        <td>{r.department}</td>
                        <td>{r.daysRecorded}</td>
                        <td>{r.totalRegularHours} hrs</td>
                        <td>{r.regularOtHours} hrs</td>
                        <td>{(Number(r.restDayOtHours) + Number(r.holidayOtHours)).toFixed(2)} hrs</td>
                        <td>{r.nightDiffHours} hrs</td>
                        <td style={{ color: r.totalTardinessMins > 0 ? '#e53e3e' : 'inherit' }}>
                          {r.totalTardinessMins} mins
                        </td>
                        <td>{r.tardinessIncidents}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ==================================================================== */}
      {/* 5. LEAVE BALANCES & STATUTORY UTILIZATION                            */}
      {/* ==================================================================== */}
      {activeReport === 'leaves' && (
        <>
          <Card kicker="Filters" title="Leave Balances & SIL Liability">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Year">
                <input type="number" className={inputClass} value={year} onChange={(e) => setYear(e.target.value)} />
              </Field>
              <Field label="Leave Type">
                <select className={inputClass} value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
                  <option value="">All Leave Types</option>
                  {options.data?.leaveTypes?.map((lt) => (
                    <option key={lt.id} value={lt.id}>{lt.name} ({lt.isStatutory ? 'Statutory' : 'Company'})</option>
                  ))}
                </select>
              </Field>
              <Field label="Department">
                <select className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">All Departments</option>
                  {options.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginTop: 14 }}>
              <Btn
                variant="primary"
                onClick={() =>
                  downloadCsv('leave-utilization.csv', 'leave-balances-utilization.csv', { year, leaveTypeId, departmentId })
                }
                disabled={!leaves.data?.rows.length}
              >
                Export Leave Balances CSV
              </Btn>
            </div>
          </Card>

          {leaves.data?.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, margin: '16px 0' }}>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Total Days Allocated</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{leaves.data.summary.totalAllocated} days</div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Total Days Consumed</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{leaves.data.summary.totalUsed} days</div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Remaining Available</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-accent)' }}>
                  {leaves.data.summary.totalRemaining} days
                </div>
              </div>
              <div className="card p-4 text-center">
                <div style={{ fontSize: 15.5, opacity: 0.7 }}>Est. Unused SIL Monetization Value</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-accent)' }}>
                  ₱{Number(leaves.data.summary.silMonetizationTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          )}

          {leaves.isLoading && <Spinner label="Loading leave balances..." />}

          {leaves.data && (
            <Card kicker="Allocations" title="Employee Leave Balances & SIL Value">
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Emp No.</th><th>Employee</th><th>Department</th><th>Leave Type</th>
                      <th>Statutory</th><th>Allocated</th><th>Used</th><th>Remaining</th><th>Daily Rate</th><th>Est. SIL Cash Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.data.rows.map((r: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{r.employeeNo}</td>
                        <td>{r.employeeName}</td>
                        <td>{r.department}</td>
                        <td>{r.leaveTypeName}</td>
                        <td><Tag tone={r.isStatutory ? 'accent' : 'neutral'}>{r.isStatutory ? 'Yes' : 'No'}</Tag></td>
                        <td>{r.allocatedDays}</td>
                        <td>{r.usedDays}</td>
                        <td style={{ fontWeight: 600 }}>{r.remainingDays}</td>
                        <td>₱{Number(r.dailyRate).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td>
                          {r.leaveTypeCode === 'SIL' ? (
                            `₱${Number(r.silMonetizationEst).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ==================================================================== */}
      {/* 6. PERFORMANCE BELL CURVE RATING DISTRIBUTION                        */}
      {/* ==================================================================== */}
      {activeReport === 'performance_curve' && (
        <>
          <Card kicker="Filters" title="Performance Distribution">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Department">
                <select className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">All Departments</option>
                  {options.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginTop: 14 }}>
              <Btn
                variant="primary"
                onClick={() =>
                  downloadCsv('performance-distribution.csv', 'performance-bell-curve.csv', { departmentId })
                }
                disabled={!performanceCurve.data?.rows.length}
              >
                Export Bell Curve CSV
              </Btn>
            </div>
          </Card>

          {performanceCurve.isLoading && <Spinner label="Loading distribution..." />}

          {performanceCurve.data && (
            <Card kicker="Bell Curve Breakdown" title="Performance Rating Bands Across Units">
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Department / Unit</th><th>Total Reviews</th><th>Average Score</th>
                      <th>Outstanding (4.5–5.0)</th><th>Exceeds (3.5–4.4)</th>
                      <th>Meets (2.5–3.4)</th><th>Below Standards (&lt;2.5)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performanceCurve.data.rows.map((r: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{r.department}</td>
                        <td>{r.evaluationsCount}</td>
                        <td style={{ fontWeight: 700, color: 'var(--c-accent)' }}>{r.averageScore} / 5.0</td>
                        <td><Tag tone="accent">{r.outstandingCount}</Tag></td>
                        <td><Tag tone="neutral">{r.exceedsCount}</Tag></td>
                        <td><Tag tone="outline">{r.meetsCount}</Tag></td>
                        <td><Tag tone={r.belowStandardCount > 0 ? 'outline' : 'neutral'}>{r.belowStandardCount}</Tag></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ==================================================================== */}
      {/* 7. EVALUATION HISTORY REPORT                                         */}
      {/* ==================================================================== */}
      {activeReport === 'evaluations' && (
        <>
          <Card kicker="Filters" title="Evaluation Timeline History">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Name or Emp No.">
                <input className={inputClass} value={evalName} onChange={(e) => setEvalName(e.target.value)} placeholder="e.g. Santos, or HCM-001" />
              </Field>
              <Field label="From">
                <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </Field>
              <Field label="Department">
                <select className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">All Departments</option>
                  {options.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Source Kind">
                <select className={inputClass} value={evalKind} onChange={(e) => setEvalKind(e.target.value)}>
                  <option value="">All Kinds</option>
                  {options.data?.kinds.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginTop: 14 }}>
              <Btn
                variant="primary"
                onClick={() =>
                  downloadCsv('evaluations.csv', 'evaluation-report.csv', { from: dateFrom, to: dateTo, departmentId, name: evalName, kinds: evalKind })
                }
                disabled={!evaluations.data?.rows.length}
              >
                Export Evaluation History CSV
              </Btn>
            </div>
          </Card>

          {evaluations.isLoading && <Spinner label="Loading events..." />}

          {evaluations.data && evaluations.data.rows.length === 0 && (
            <EmptyState title="No evaluation events found">
              Try adjusting your date range or removing department filters.
            </EmptyState>
          )}

          {evaluations.data && evaluations.data.rows.length > 0 && (
            <Card kicker="Timeline" title={`Evaluation Events (${evaluations.data.rows.length})`}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Employee</th><th>Department</th><th>Source</th><th>Title</th><th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluations.data.rows.map((r: any) => (
                      <tr key={r.refId}>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.occurredOn}</td>
                        <td style={{ fontWeight: 600 }}>{r.employeeName}</td>
                        <td>{r.department ?? '—'}</td>
                        <td><Tag tone="accent">{r.kind.replace(/_/g, ' ')}</Tag></td>
                        <td>{r.title}</td>
                        <td>{r.result ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </Section>
  );
}
