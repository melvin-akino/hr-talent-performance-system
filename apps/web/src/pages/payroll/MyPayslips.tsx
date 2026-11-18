import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../auth';
import type { Employee } from '../../types';
import { Card, Tag } from '../../components/ds';

interface MyPayslipSummary {
  id: string;
  runId: string;
  runCode: string;
  runTitle: string;
  periodStart: string;
  periodEnd: string;
  payoutDate: string;
  runType: string;
  basicPay: string;
  grossPay: string;
  totalDeductions: string;
  netPay: string;
  disbursementStatus: string;
  createdAt: string;
}

interface PayslipDetail {
  id: string;
  payrollRunId: string;
  employeeId: string;
  basicPay: string;
  overtimePay: string;
  nightDiffPay: string;
  holidayPay: string;
  deMinimisAllowances: string;
  taxableAllowances: string;
  grossPay: string;
  tardinessUndertime: string;
  absencesUnpaid: string;
  sssEe: string;
  sssWispEe: string;
  philhealthEe: string;
  pagibigEe: string;
  taxableIncome: string;
  withholdingTax: string;
  totalDeductions: string;
  netPay: string;
  thirteenthMonthAccrual: string;
  disbursementStatus: string;
  runCode: string;
  runTitle: string;
  periodStart: string;
  periodEnd: string;
  payoutDate: string;
  runType: string;
  companyName: string;
  branchName: string;
  branchAddress: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  departmentName: string;
  tin: string | null;
  sssNo: string | null;
  philhealthNo: string | null;
  pagibigNo: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  monthlyRate: string | null;
  ytd: {
    ytdGross: string | number;
    ytdTax: string | number;
    ytdThirteenthMonth: string | number;
  };
}

export default function MyPayslips() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const [selectedPayslipId, setSelectedPayslipId] = useState<string | null>(null);
  const [showBir2316, setShowBir2316] = useState(false);
  const [birYear, setBirYear] = useState<number>(new Date().getFullYear());

  const phPayrollEnabled = me.data?.features?.feature_ph_payroll ?? false;

  const bir2316 = useQuery({
    queryKey: ['my-bir-2316', birYear],
    queryFn: () => api<any>(`/payroll/my-bir-2316?year=${birYear}`),
    enabled: phPayrollEnabled && showBir2316,
  });

  // 1. Fetch My Historical Payslips
  const payslipsQuery = useQuery({
    queryKey: ['my-payslips'],
    queryFn: () => api<MyPayslipSummary[]>('/payroll/my-payslips'),
    enabled: phPayrollEnabled,
  });

  // 2. Fetch Selected Payslip Detail
  const detailQuery = useQuery({
    queryKey: ['my-payslip-detail', selectedPayslipId],
    queryFn: () => api<PayslipDetail>(`/payroll/my-payslips/${selectedPayslipId}`),
    enabled: Boolean(selectedPayslipId),
  });

  const payslips = payslipsQuery.data ?? [];
  const activeDetail = detailQuery.data;

  // YTD Accumulation Summary
  const latestPayslip = payslips[0];
  const totalEarnedYtd = payslips.reduce((s, p) => s + Number(p.netPay || 0), 0);
  const totalGrossYtd = payslips.reduce((s, p) => s + Number(p.grossPay || 0), 0);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ width: '100%' }}>
      {/* Top Banner */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            My Digital Payslips
          </h1>
          <Tag tone="accent">Employee Self-Service</Tag>
        </div>
        <p style={{ color: 'var(--color-muted)', fontSize: '15px', margin: 0 }}>
          View and download your official Philippine semi-monthly payslips, statutory contributions, and take-home pay.
        </p>
      </div>

      {!phPayrollEnabled && (
        <Card style={{ padding: '32px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#f59e0b', margin: '0 0 8px 0' }}>
            Philippine Payroll Module Not Licensed
          </h3>
          <p style={{ color: 'var(--color-muted)', fontSize: '14.5px', margin: 0 }}>
            Philippine digital payslips and statutory computations are not currently enabled for your organization. Contact your system administrator to activate the Philippine Payroll license.
          </p>
        </Card>
      )}

      {phPayrollEnabled && (
        <>
          {/* Quick Metrics */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}>
            <Card title="Latest Take-Home Pay">
              <div style={{ fontSize: '26px', fontWeight: 700, color: '#10b981', marginTop: '4px' }}>
                ₱{Number(latestPayslip?.netPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '4px' }}>
                {latestPayslip ? `Payout: ${latestPayslip.payoutDate}` : 'No payouts yet'}
              </div>
            </Card>

            <Card title="Year-to-Date Take-Home">
              <div style={{ fontSize: '26px', fontWeight: 700, color: '#38bdf8', marginTop: '4px' }}>
                ₱{totalEarnedYtd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '4px' }}>
                Cumulative net salary received
              </div>
            </Card>

            <Card title="Year-to-Date Gross Earnings">
              <div style={{ fontSize: '26px', fontWeight: 700, color: '#a855f7', marginTop: '4px' }}>
                ₱{totalGrossYtd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '4px' }}>
                Total basic, OT, and allowances
              </div>
            </Card>

            <Card title="Payslips Issued">
              <div style={{ fontSize: '26px', fontWeight: 700, marginTop: '4px' }}>
                {payslips.length}
              </div>
              <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '4px' }}>
                Official semi-monthly cycles
              </div>
            </Card>
          </div>

          {/* BIR Form 2316 Annual Certificate Preview */}
          {showBir2316 && bir2316.data && (
            <Card
              kicker="Bureau of Internal Revenue — Certificate of Compensation Payment / Tax Withheld"
              title={`BIR Form 2316 (Tax Year ${bir2316.data.year})`}
              style={{ marginBottom: '24px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 8, marginBottom: 16 }}>
                <div style={{ fontSize: '14.5px' }}>
                  <div><strong>Employer:</strong> {bir2316.data.employer.registeredName} (TIN: {bir2316.data.employer.employerTin})</div>
                  <div><strong>Employee:</strong> {bir2316.data.employee.fullName} ({bir2316.data.employee.employeeNo}) &bull; TIN: {bir2316.data.employee.tin || 'N/A'}</div>
                </div>
                <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    className="input"
                    style={{ width: 'auto' }}
                    value={birYear}
                    onChange={(e) => setBirYear(Number(e.target.value))}
                  >
                    {[2026, 2025, 2024].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <button className="btn btn-primary" onClick={() => window.print()}>
                    Print BIR 2316
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: '14.5px', borderTop: '1px solid var(--color-divider)', paddingTop: 12 }}>
                <div>
                  <div style={{ color: 'var(--color-neutral-600)' }}>Gross Compensation Income</div>
                  <strong>₱{Number(bir2316.data.summary.grossCompensationIncome).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                </div>
                <div>
                  <div style={{ color: 'var(--color-neutral-600)' }}>Non-Taxable (13th Mo + De Minimis + SSS/PHIC/HDMF)</div>
                  <strong>₱{Number(bir2316.data.summary.nonTaxable.totalNonTaxable).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                </div>
                <div>
                  <div style={{ color: 'var(--color-neutral-600)' }}>Net Taxable Compensation</div>
                  <strong>₱{Number(bir2316.data.summary.taxable.netTaxableCompensation).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                </div>
                <div>
                  <div style={{ color: 'var(--color-neutral-600)' }}>Total Taxes Withheld (TRAIN)</div>
                  <strong style={{ color: 'var(--color-accent)' }}>₱{Number(bir2316.data.summary.totalTaxWithheld).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                </div>
              </div>
            </Card>
          )}

          {/* Payslip History Ledger */}
          <div style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '10px',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600, fontSize: '15px' }}>Payslip History</span>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowBir2316(!showBir2316)}
                >
                  {showBir2316 ? 'Hide BIR Form 2316' : `View BIR Form 2316 (${birYear})`}
                </button>
                <span style={{ fontSize: '15px', color: 'var(--color-muted)' }}>
                  Showing {payslips.length} cut-off periods
                </span>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)', fontSize: '15px' }}>
                    <th style={{ padding: '12px 16px' }}>Payroll Period</th>
                    <th style={{ padding: '12px 16px' }}>Cutoff Range</th>
                    <th style={{ padding: '12px 16px' }}>Payout Date</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Basic Pay</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Gross Pay</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Deductions</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Net Take-Home</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center' }}>Status</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.length > 0 ? (
                    payslips.map((p) => (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>{p.runTitle}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--color-muted)', fontSize: '15px' }}>
                          {p.periodStart} ~ {p.periodEnd}
                        </td>
                        <td style={{ padding: '12px 16px' }}>{p.payoutDate}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          ₱{Number(p.basicPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          ₱{Number(p.grossPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', color: '#ef4444' }}>
                          -₱{Number(p.totalDeductions).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#10b981' }}>
                          ₱{Number(p.netPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <Tag tone={p.disbursementStatus === 'paid' ? 'accent' : 'neutral'}>
                            {p.disbursementStatus.toUpperCase()}
                          </Tag>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '14.5px', padding: '4px 12px' }}
                            onClick={() => setSelectedPayslipId(p.id)}
                          >
                            View Payslip
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} style={{ padding: '36px', textAlign: 'center', color: 'var(--color-muted)' }}>
                        No payslips generated for your account yet. Approved payroll runs will automatically appear here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Official Printable Digital Payslip Modal */}
      {selectedPayslipId && activeDetail && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px',
        }}>
          <div style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '720px',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '28px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          }}>
            {/* Payslip Header for Print */}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid var(--color-border)', paddingBottom: '16px', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
                  {activeDetail.companyName}
                </h2>
                <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '2px' }}>
                  {activeDetail.branchName} · {activeDetail.branchAddress || 'Philippines'}
                </div>
                <div style={{ fontSize: '14.5px', fontWeight: 600, marginTop: '8px', color: '#38bdf8' }}>
                  {activeDetail.runTitle}
                </div>
                <div style={{ fontSize: '14.5px', color: 'var(--color-muted)' }}>
                  Cutoff: {activeDetail.periodStart} to {activeDetail.periodEnd} | Payout: {activeDetail.payoutDate}
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{
                  fontSize: '14.5px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                }}>
                  Official Payslip
                </span>
                <div style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginTop: '8px' }}>
                  Reference No.
                </div>
                <div style={{ fontSize: '15px', fontWeight: 600, fontFamily: 'monospace' }}>
                  {activeDetail.runCode}-{activeDetail.employeeNo}
                </div>
              </div>
            </div>

            {/* Employee Meta Details */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '14px',
              marginBottom: '20px',
              fontSize: '15px',
            }}>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Employee Name:</span>{' '}
                <strong>{activeDetail.lastName}, {activeDetail.firstName}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Employee ID:</span>{' '}
                <strong>{activeDetail.employeeNo}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Department:</span>{' '}
                <strong>{activeDetail.departmentName}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Tax Identification No (TIN):</span>{' '}
                <strong>{activeDetail.tin || 'N/A'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>SSS Number:</span>{' '}
                <strong>{activeDetail.sssNo || 'N/A'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>PhilHealth ID:</span>{' '}
                <strong>{activeDetail.philhealthNo || 'N/A'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Pag-IBIG MID:</span>{' '}
                <strong>{activeDetail.pagibigNo || 'N/A'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Bank Account:</span>{' '}
                <strong>{activeDetail.bankName || 'BANK'}: {activeDetail.bankAccountNo ? '••••' + activeDetail.bankAccountNo.slice(-4) : 'Cash'}</strong>
              </div>
            </div>

            {/* Earnings & Deductions Dual Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              {/* Earnings Column */}
              <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14.5px', fontWeight: 600, color: '#10b981', borderBottom: '1px solid var(--color-border)', paddingBottom: '6px' }}>
                  EARNINGS & ALLOWANCES
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '15px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Basic Pay</span>
                    <span>₱{Number(activeDetail.basicPay).toFixed(2)}</span>
                  </div>
                  {Number(activeDetail.overtimePay) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Overtime Pay</span>
                      <span>₱{Number(activeDetail.overtimePay).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(activeDetail.nightDiffPay) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Night Differential</span>
                      <span>₱{Number(activeDetail.nightDiffPay).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(activeDetail.holidayPay) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Holiday Pay</span>
                      <span>₱{Number(activeDetail.holidayPay).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(activeDetail.deMinimisAllowances) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>De Minimis (Tax-Exempt)</span>
                      <span>₱{Number(activeDetail.deMinimisAllowances).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(activeDetail.taxableAllowances) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Taxable Allowances</span>
                      <span>₱{Number(activeDetail.taxableAllowances).toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ borderTop: '1px dashed var(--color-border)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '14.5px' }}>
                    <span>GROSS PAY</span>
                    <span>₱{Number(activeDetail.grossPay).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Deductions Column */}
              <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14.5px', fontWeight: 600, color: '#ef4444', borderBottom: '1px solid var(--color-border)', paddingBottom: '6px' }}>
                  DEDUCTIONS & TAXES
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '15px' }}>
                  {Number(activeDetail.tardinessUndertime) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tardiness & Undertime</span>
                      <span>-₱{Number(activeDetail.tardinessUndertime).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(activeDetail.absencesUnpaid) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Absences (Unpaid)</span>
                      <span>-₱{Number(activeDetail.absencesUnpaid).toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>SSS Contribution (EE)</span>
                    <span>-₱{(Number(activeDetail.sssEe) + Number(activeDetail.sssWispEe)).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>PhilHealth (EE 2.5%)</span>
                    <span>-₱{Number(activeDetail.philhealthEe).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Pag-IBIG HDMF (EE)</span>
                    <span>-₱{Number(activeDetail.pagibigEe).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Withholding Tax (TRAIN)</span>
                    <span>-₱{Number(activeDetail.withholdingTax).toFixed(2)}</span>
                  </div>
                  <div style={{ borderTop: '1px dashed var(--color-border)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '14.5px', color: '#ef4444' }}>
                    <span>TOTAL DEDUCTIONS</span>
                    <span>-₱{Number(activeDetail.totalDeductions).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Net Pay Banner */}
            <div style={{
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '2px solid rgba(16, 185, 129, 0.4)',
              borderRadius: '8px',
              padding: '16px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
            }}>
              <div>
                <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Net Take-Home Pay (Disbursed)
                </span>
                <div style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginTop: '2px' }}>
                  Credited directly to {activeDetail.bankName || 'bank account'} on {activeDetail.payoutDate}
                </div>
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#10b981' }}>
                ₱{Number(activeDetail.netPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>

            {/* YTD Cumulative Footer */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
              borderTop: '1px solid var(--color-border)',
              paddingTop: '16px',
              fontSize: '14.5px',
              color: 'var(--color-muted)',
              marginBottom: '24px',
            }}>
              <div>
                13th Month Accrual (This Run):<br />
                <strong style={{ color: 'var(--color-text)', fontSize: '15px' }}>
                  ₱{Number(activeDetail.thirteenthMonthAccrual || 0).toFixed(2)}
                </strong>
              </div>
              <div>
                YTD Accrued 13th Month (PD 851):<br />
                <strong style={{ color: '#38bdf8', fontSize: '15px' }}>
                  ₱{Number(activeDetail.ytd?.ytdThirteenthMonth || 0).toFixed(2)}
                </strong>
              </div>
              <div>
                YTD Tax Withheld (BIR 2316):<br />
                <strong style={{ color: 'var(--color-text)', fontSize: '15px' }}>
                  ₱{Number(activeDetail.ytd?.ytdTax || 0).toFixed(2)}
                </strong>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedPayslipId(null)}
              >
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={handlePrint}
              >
                🖨️ Print / Save PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
