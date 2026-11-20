import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getSaasToken, resolveApiPath } from '../../auth';
import type { Employee } from '../../types';
import { Card, Tag } from '../../components/ds';

interface Branch {
  id: string;
  code: string;
  name: string;
  region: string;
  isHeadOffice: boolean;
}

interface PayrollRun {
  id: string;
  code: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  payoutDate: string;
  runType: string;
  status: string;
  totalGross: string;
  totalTaxable: string;
  totalWithholdingTax: string;
  totalSssEe: string;
  totalSssEr: string;
  totalPhilhealthEe: string;
  totalPhilhealthEr: string;
  totalPagibigEe: string;
  totalPagibigEr: string;
  totalNetPay: string;
  employeeCount: number;
  branchName: string | null;
  createdAt: string;
}

interface PayrollLineItem {
  id: string;
  employee_id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  branchName: string | null;
  basic_pay: string;
  de_minimis_allowances: string;
  taxable_allowances: string;
  gross_pay: string;
  sss_ee: string;
  philhealth_ee: string;
  pagibig_ee: string;
  taxable_income: string;
  withholding_tax: string;
  total_deductions: string;
  net_pay: string;
  thirteenth_month_accrual: string;
  disbursement_status: string;
  bank_name: string;
  bank_account_no: string;
}

interface PayrollDetail {
  run: PayrollRun;
  lineItems: PayrollLineItem[];
}

interface EmployeeLoan {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  loan_type: string;
  reference_number: string;
  principal_amount: string;
  monthly_amortization: string;
  balance_remaining: string;
  status: string;
  start_date: string;
}

interface ServiceChargePool {
  id: string;
  pool_period: string;
  total_collected_amount: string;
  eligible_employee_share_pct: string;
  distributed_amount: string;
  eligible_employee_count: number;
  amount_per_employee: string;
  distribution_date: string;
}

interface SalaryGradeMatrix {
  id: string;
  region: string;
  industry_type: string;
  rank_level: string;
  salary_grade: number;
  min_base_salary: string;
  max_base_salary: string;
  standard_daily_rate: string;
  effective_date: string;
}

interface PayrollAdjustment {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  adjustment_type: string;
  amount: string;
  is_taxable: boolean;
  effective_date: string;
  remarks: string;
  status: string;
}

type PayrollTab = 'run' | 'compensation' | 'year-end' | 'statutory' | 'disbursement' | 'loans' | 'service-charge' | 'salary-matrix' | 'adjustments';

export default function PayrollDashboard() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<PayrollTab>('run');
  const [showComputeModal, setShowComputeModal] = useState(false);
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showServiceChargeModal, setShowServiceChargeModal] = useState(false);
  const [showRetroModal, setShowRetroModal] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [yearEndYear, setYearEndYear] = useState<number>(new Date().getFullYear());
  const [compSearch, setCompSearch] = useState('');
  const [editingComp, setEditingComp] = useState<any | null>(null);

  // Form state for Loan Modal
  const [loanForm, setLoanForm] = useState({
    employeeId: '',
    loanType: 'sss_salary_loan',
    referenceNumber: '',
    principalAmount: '20000',
    monthlyAmortization: '1000',
    totalTermsMonths: 24,
    startDate: new Date().toISOString().slice(0, 10),
  });

  // Form state for Service Charge Pool
  const [serviceChargeForm, setServiceChargeForm] = useState({
    poolPeriod: new Date().toISOString().slice(0, 7),
    totalCollectedAmount: '250000',
    distributionDate: new Date().toISOString().slice(0, 10),
  });

  // Form state for Retro Pay Calculator
  const [retroForm, setRetroForm] = useState({
    employeeId: '',
    effectiveDate: new Date().toISOString().slice(0, 8) + '01',
    previousMonthlyRate: '25000',
    newMonthlyRate: '30000',
  });

  // Form state for Compute Run Modal
  const [computeForm, setComputeForm] = useState({
    code: `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-Q1`,
    title: `${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })} 1st Quindena Payroll`,
    periodStart: new Date().toISOString().slice(0, 8) + '01',
    periodEnd: new Date().toISOString().slice(0, 8) + '15',
    payoutDate: new Date().toISOString().slice(0, 8) + '15',
    runType: 'quindena_1',
    branchId: '',
  });

  const phPayrollEnabled = me.data?.features?.feature_ph_payroll ?? false;

  // 1. Fetch Branches
  const branchesQuery = useQuery({
    queryKey: ['payroll-branches'],
    queryFn: () => api<Branch[]>('/payroll/branches'),
    enabled: phPayrollEnabled,
  });

  // 2. Fetch Payroll Runs
  const runsQuery = useQuery({
    queryKey: ['payroll-runs', selectedBranch],
    queryFn: () =>
      api<PayrollRun[]>(
        `/payroll/runs${selectedBranch !== 'all' ? `?branchId=${selectedBranch}` : ''}`,
      ),
    enabled: phPayrollEnabled,
  });

  // Set activeRunId to first run if not set
  const runs = runsQuery.data || [];
  const currentRunId = activeRunId || (runs[0]?.id ?? null);

  // 3. Fetch Selected Payroll Run Detail & Line Items
  const runDetailQuery = useQuery({
    queryKey: ['payroll-run', currentRunId],
    queryFn: () => api<PayrollDetail>(`/payroll/runs/${currentRunId}`),
    enabled: phPayrollEnabled && Boolean(currentRunId),
  });

  // 4. Fetch Loans
  const loansQuery = useQuery({
    queryKey: ['payroll-loans'],
    queryFn: () => api<EmployeeLoan[]>('/payroll/loans'),
    enabled: phPayrollEnabled && activeTab === 'loans',
  });

  // 5. Fetch Service Charge Pools
  const serviceChargeQuery = useQuery({
    queryKey: ['payroll-service-charge'],
    queryFn: () => api<ServiceChargePool[]>('/payroll/service-charge'),
    enabled: phPayrollEnabled && activeTab === 'service-charge',
  });

  // 6. Fetch Salary Grade Matrix
  const salaryMatrixQuery = useQuery({
    queryKey: ['payroll-salary-matrix'],
    queryFn: () => api<SalaryGradeMatrix[]>('/payroll/salary-matrix'),
    enabled: phPayrollEnabled && activeTab === 'salary-matrix',
  });

  // 7. Fetch Adjustments
  const adjustmentsQuery = useQuery({
    queryKey: ['payroll-adjustments'],
    queryFn: () => api<PayrollAdjustment[]>('/payroll/adjustments'),
    enabled: phPayrollEnabled && activeTab === 'adjustments',
  });

  // 8. Fetch Compensation Profiles
  const compensationQuery = useQuery({
    queryKey: ['payroll-compensation', selectedBranch],
    queryFn: () =>
      api<any[]>(
        `/payroll/compensation${selectedBranch !== 'all' ? `?branchId=${selectedBranch}` : ''}`,
      ),
    enabled: phPayrollEnabled && activeTab === 'compensation',
  });

  // 9. Fetch 13th Month Preview & Year-End Tax Reconciliation
  const thirteenthPreviewQuery = useQuery({
    queryKey: ['payroll-13th-preview', yearEndYear, selectedBranch],
    queryFn: () =>
      api<any[]>(
        `/payroll/13th-month/preview?year=${yearEndYear}${selectedBranch !== 'all' ? `&branchId=${selectedBranch}` : ''}`,
      ),
    enabled: phPayrollEnabled && activeTab === 'year-end',
  });

  const yearEndTaxQuery = useQuery({
    queryKey: ['payroll-year-end-tax', yearEndYear],
    queryFn: () => api<any>(`/payroll/year-end-tax?year=${yearEndYear}`),
    enabled: phPayrollEnabled && activeTab === 'year-end',
  });

  const upsertCompensationMutation = useMutation({
    mutationFn: ({ employeeId, body }: { employeeId: string; body: any }) =>
      api(`/payroll/compensation/${employeeId}`, { method: 'PUT', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-compensation'] });
      setEditingComp(null);
    },
  });

  const compute13thMutation = useMutation({
    mutationFn: () =>
      api<PayrollRun>('/payroll/runs/compute-13th-month', {
        method: 'POST',
        body: {
          year: yearEndYear,
          payoutDate: `${yearEndYear}-12-15`,
          branchId: selectedBranch !== 'all' ? selectedBranch : undefined,
        },
      }),
    onSuccess: (newRun) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      setActiveRunId(newRun.id);
      setActiveTab('run');
    },
  });

  const downloadBir1604c = async () => {
    try {
      const token = getSaasToken();
      const response = await fetch(resolveApiPath(`/payroll/bir-1604c/csv?year=${yearEndYear}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BIR_1604C_Alphalist_${yearEndYear}.csv`;
      a.click();
    } catch (e) {
      console.error('Failed to download BIR 1604-C CSV', e);
    }
  };

  // Mutations
  const computeMutation = useMutation({
    mutationFn: (payload: typeof computeForm) =>
      api<PayrollRun>('/payroll/runs/compute', {
        method: 'POST',
        body: {
          ...payload,
          branchId: payload.branchId || null,
        },
      }),
    onSuccess: (newRun) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      setActiveRunId(newRun.id);
      setShowComputeModal(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (runId: string) =>
      api<PayrollRun>(`/payroll/runs/${runId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-run', currentRunId] });
    },
  });

  const disburseMutation = useMutation({
    mutationFn: (runId: string) =>
      api<PayrollRun>(`/payroll/runs/${runId}/disburse`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-run', currentRunId] });
    },
  });

  const createLoanMutation = useMutation({
    mutationFn: (data: typeof loanForm) =>
      api('/payroll/loans', {
        method: 'POST',
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-loans'] });
      setShowLoanModal(false);
    },
  });

  const updateLoanStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' | 'paid_off' }) =>
      api(`/payroll/loans/${id}/status`, {
        method: 'PATCH',
        body: { status },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-loans'] });
    },
  });

  const distributeServiceChargeMutation = useMutation({
    mutationFn: (data: typeof serviceChargeForm) =>
      api('/payroll/service-charge', {
        method: 'POST',
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-service-charge'] });
      setShowServiceChargeModal(false);
    },
  });

  const [retroResult, setRetroResult] = useState<any | null>(null);
  const calculateRetroMutation = useMutation({
    mutationFn: (data: typeof retroForm) =>
      api('/payroll/retro-pay', {
        method: 'POST',
        body: data,
      }),
    onSuccess: (res) => {
      setRetroResult(res);
      queryClient.invalidateQueries({ queryKey: ['payroll-adjustments'] });
    },
  });

  // Download helpers
  const downloadDisbursement = async (bank: string) => {
    if (!currentRunId) return;
    try {
      const token = getSaasToken();
      const response = await fetch(resolveApiPath(`/payroll/runs/${currentRunId}/disbursement/${bank.toLowerCase()}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Disbursement_${bank.toUpperCase()}_${currentRunId.slice(0, 8)}.csv`;
      a.click();
    } catch (e) {
      console.error('Failed to download disbursement file', e);
    }
  };

  const downloadStatutory = async (agency: string) => {
    if (!currentRunId) return;
    try {
      const token = getSaasToken();
      const response = await fetch(resolveApiPath(`/payroll/runs/${currentRunId}/statutory/${agency.toLowerCase()}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${agency.toUpperCase()}_Report_${currentRunId.slice(0, 8)}.csv`;
      a.click();
    } catch (e) {
      console.error('Failed to download statutory report', e);
    }
  };

  if (me.isLoading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>Loading payroll workspace…</div>;
  }

  // Graceful degradation when Philippine Payroll is not enabled for this tenant
  if (!phPayrollEnabled) {
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
              <rect width="20" height="14" x="2" y="5" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>

          <h2 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 8px 0', color: 'var(--color-fg)' }}>
            Philippine Payroll Module Not Licensed
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--color-muted)', maxWidth: '520px', margin: '0 auto 24px auto', lineHeight: 1.5 }}>
            Automated TRAIN Law tax tables, SSS, PhilHealth, Pag-IBIG statutory calculations, and bank disbursement exports are currently inactive for <strong>{me.data?.organization?.name || 'your company'}</strong>.
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
              How to enable this feature:
            </div>
            <div>
              1. Contact your platform account administrator or platform provider.
            </div>
            <div>
              2. Request the <strong>Philippine Payroll Add-on License</strong> to be activated in the Superadmin Console.
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const selectedRun = runDetailQuery.data?.run || runs[0];
  const lineItems = runDetailQuery.data?.lineItems || [];

  return (
    <div style={{ width: '100%' }}>
      {/* Top Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '28px',
        flexWrap: 'wrap',
        gap: '16px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>
              Philippine Payroll & Statutory Engine
            </h1>
            <Tag tone="accent">RA 10963 TRAIN Compliant</Tag>
          </div>
          <p style={{ margin: '6px 0 0 0', fontSize: '14.5px', color: 'var(--color-muted)' }}>
            Bi-monthly quindena payroll processing, multi-branch statutory compliance, and bank disbursement files.
          </p>
        </div>

        {/* Branch Filter & Run Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '14.5px', color: 'var(--color-muted)', fontWeight: 500 }}>
            Branch:
          </label>
          <select
            className="input"
            style={{ width: 'auto' }}
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
          >
            <option value="all">All Branches (Consolidated)</option>
            {branchesQuery.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>

          <button
            className="btn btn-primary"
            onClick={() => setShowComputeModal(true)}
          >
            + Run New Payroll
          </button>
        </div>
      </div>

      {/* Statutory Regulatory Banners */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <div style={{
          padding: '12px 16px',
          borderRadius: '6px',
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}>
          <div style={{ fontSize: '14.5px', textTransform: 'uppercase', color: 'var(--color-muted)', fontWeight: 600 }}>
            BIR TRAIN Withholding
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-fg)', marginTop: '4px' }}>
            2023–2026 Tax Table
          </div>
          <div style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginTop: '2px' }}>
            0% below ₱20,833/mo · Graduated 15%–35%
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          borderRadius: '6px',
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}>
          <div style={{ fontSize: '14.5px', textTransform: 'uppercase', color: 'var(--color-muted)', fontWeight: 600 }}>
            SSS & WISP Mandatory
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-fg)', marginTop: '4px' }}>
            14% Contribution Rate
          </div>
          <div style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginTop: '2px' }}>
            EE: 4.5% · ER: 9.5% · MSC Cap ₱35,000
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          borderRadius: '6px',
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}>
          <div style={{ fontSize: '14.5px', textTransform: 'uppercase', color: 'var(--color-muted)', fontWeight: 600 }}>
            PhilHealth (Universal HC)
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-fg)', marginTop: '4px' }}>
            5.0% Premium Rate
          </div>
          <div style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginTop: '2px' }}>
            EE: 2.5% · ER: 2.5% · Floor ₱10k, Ceiling ₱100k
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          borderRadius: '6px',
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}>
          <div style={{ fontSize: '14.5px', textTransform: 'uppercase', color: 'var(--color-muted)', fontWeight: 600 }}>
            Pag-IBIG / HDMF
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-fg)', marginTop: '4px' }}>
            ₱200 EE / ₱200 ER
          </div>
          <div style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginTop: '2px' }}>
            Circular 460 · MFS Cap ₱10,000
          </div>
        </div>
      </div>

      {/* Runs Selector Dropdown if runs exist */}
      {runs.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '20px',
          padding: '12px 16px',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
        }}>
          <span style={{ fontSize: '14.5px', fontWeight: 600 }}>Selected Cut-off Run:</span>
          <select
            className="input"
            style={{ width: 'auto', minWidth: '320px' }}
            value={currentRunId || ''}
            onChange={(e) => setActiveRunId(e.target.value)}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.code}) — {r.status.toUpperCase()}
              </option>
            ))}
          </select>
          {selectedRun && (
            <Tag tone={selectedRun.status === 'disbursed' || selectedRun.status === 'approved' ? 'accent' : 'neutral'}>
              {selectedRun.status.toUpperCase()}
            </Tag>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--color-border)', marginBottom: '24px', overflowX: 'auto' }}>
        {[
          { id: 'run', label: 'Payroll Register Summary' },
          { id: 'compensation', label: 'Compensation & Bank Profiles' },
          { id: 'year-end', label: '13th Month & Year-End Tax' },
          { id: 'statutory', label: 'Statutory Remittances (SSS, PHIC, HDMF, BIR)' },
          { id: 'disbursement', label: 'Bank Disbursement' },
          { id: 'loans', label: 'SSS / Pag-IBIG Loans' },
          { id: 'service-charge', label: 'Service Charge Pool (RA 11360)' },
          { id: 'salary-matrix', label: 'Salary Matrices & Regional Rates' },
          { id: 'adjustments', label: 'Retro Pay & Adjustments' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as PayrollTab)}
            style={{
              padding: '10px 14px',
              border: 'none',
              background: 'none',
              fontSize: '14.5px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              borderBottom: activeTab === tab.id ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--color-accent)' : 'var(--color-muted)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Current Payroll Run */}
      {activeTab === 'run' && (
        <>
          {selectedRun ? (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '16px',
                marginBottom: '24px',
              }}>
                <Card>
                  <div className="card-kicker">Gross Payroll (PHP)</div>
                  <div style={{ fontSize: '24px', fontWeight: 600, marginTop: '4px' }}>
                    ₱ {Number(selectedRun.totalGross || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-muted" style={{ fontSize: '14.5px' }}>
                    {selectedRun.employeeCount} Employees ({selectedRun.runType})
                  </div>
                </Card>

                <Card>
                  <div className="card-kicker">BIR Withholding Tax</div>
                  <div style={{ fontSize: '24px', fontWeight: 600, marginTop: '4px' }}>
                    ₱ {Number(selectedRun.totalWithholdingTax || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-muted" style={{ fontSize: '14.5px' }}>TRAIN Law Withholding</div>
                </Card>

                <Card>
                  <div className="card-kicker">Statutory Deductions (EE)</div>
                  <div style={{ fontSize: '24px', fontWeight: 600, marginTop: '4px' }}>
                    ₱ {(
                      Number(selectedRun.totalSssEe || 0) +
                      Number(selectedRun.totalPhilhealthEe || 0) +
                      Number(selectedRun.totalPagibigEe || 0)
                    ).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-muted" style={{ fontSize: '14.5px' }}>SSS, PhilHealth, HDMF</div>
                </Card>

                <Card>
                  <div className="card-kicker">Total Net Pay Disbursable</div>
                  <div style={{ fontSize: '24px', fontWeight: 600, marginTop: '4px', color: '#38bdf8' }}>
                    ₱ {Number(selectedRun.totalNetPay || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-muted" style={{ fontSize: '14.5px' }}>Payout Date: {selectedRun.payoutDate}</div>
                </Card>
              </div>

              <div style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                overflow: 'hidden',
              }}>
                <div style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--color-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>
                      {selectedRun.title} ({selectedRun.periodStart} to {selectedRun.periodEnd})
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-neutral-600)', marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {(selectedRun as any).computed_by_name && (
                        <span>Prepared by: <strong>{(selectedRun as any).computed_by_name}</strong></span>
                      )}
                      {(selectedRun as any).approved_by_name && (
                        <span>Approved by: <strong>{(selectedRun as any).approved_by_name}</strong></span>
                      )}
                      {(selectedRun as any).disbursed_by_name && (
                        <span>Disbursed by: <strong>{(selectedRun as any).disbursed_by_name}</strong></span>
                      )}
                    </div>
                    {approveMutation.error && (
                      <div style={{ color: '#ef4444', fontSize: '13.5px', marginTop: '6px', fontWeight: 500 }}>
                        {(approveMutation.error as Error).message}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {selectedRun.status === 'computed' && (
                      (selectedRun as any).computed_by && (selectedRun as any).computed_by === me.data?.id ? (
                        <Tag tone="outline">Maker-Checker: Awaiting Another Approver</Tag>
                      ) : (
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: '15px' }}
                          onClick={() => approveMutation.mutate(selectedRun.id)}
                          disabled={approveMutation.isPending}
                        >
                          Approve Payroll Run
                        </button>
                      )
                    )}
                    {selectedRun.status === 'approved' && (
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: '15px' }}
                        onClick={() => disburseMutation.mutate(selectedRun.id)}
                        disabled={disburseMutation.isPending}
                      >
                        Mark as Disbursed
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                        <th style={{ padding: '10px 16px' }}>Emp No</th>
                        <th style={{ padding: '10px 16px' }}>Employee Name</th>
                        <th style={{ padding: '10px 16px' }}>Branch</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>Basic Salary</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>De Minimis</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>Gross Pay</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>SSS (EE)</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>PhilHealth</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>Pag-IBIG</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>Withholding Tax</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>Net Take-Home</th>
                        <th style={{ padding: '10px 16px', textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((row) => (
                        <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '12px 16px', fontWeight: 600 }}>{row.employeeNo}</td>
                          <td style={{ padding: '12px 16px' }}>{row.lastName}, {row.firstName}</td>
                          <td style={{ padding: '12px 16px', color: 'var(--color-muted)' }}>{row.branchName || 'Head Office'}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>₱ {Number(row.basic_pay).toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>₱ {Number(row.de_minimis_allowances).toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>₱ {Number(row.gross_pay).toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>₱ {Number(row.sss_ee).toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>₱ {Number(row.philhealth_ee).toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>₱ {Number(row.pagibig_ee).toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>₱ {Number(row.withholding_tax).toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#38bdf8' }}>
                            ₱ {Number(row.net_pay).toFixed(2)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <Tag tone={row.disbursement_status === 'paid' ? 'accent' : 'neutral'}>
                              {row.disbursement_status.toUpperCase()}
                            </Tag>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <Card style={{ padding: '40px', textAlign: 'center' }}>
              <p style={{ color: 'var(--color-muted)', marginBottom: '16px' }}>
                No payroll runs found yet. Click below to compute your first Philippine payroll cut-off.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => setShowComputeModal(true)}
              >
                + Compute First Quindena Run
              </button>
            </Card>
          )}
        </>
      )}

      {/* Tab 2: Statutory Contributions */}
      {activeTab === 'statutory' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
          <Card kicker="Social Security System" title="Monthly SSS R-3 Contribution Report">
            <p className="card-body" style={{ fontSize: '14.5px' }}>
              Includes Employee (4.5%) and Employer (9.5%) shares plus WISP mandatory provident fund for salaries exceeding ₱20,000.
            </p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => downloadStatutory('sss')}
                disabled={!currentRunId}
              >
                Download SSS R-3 File
              </button>
            </div>
          </Card>

          <Card kicker="Philippine Health Insurance Corporation" title="PhilHealth EPRS Monthly Remittance">
            <p className="card-body" style={{ fontSize: '14.5px' }}>
              Accurate 5.0% premium split evenly 50/50 between employee and employer, formatted for the Electronic Premium Reporting System.
            </p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => downloadStatutory('philhealth')}
                disabled={!currentRunId}
              >
                Download PhilHealth EPRS
              </button>
            </div>
          </Card>

          <Card kicker="Home Development Mutual Fund" title="Pag-IBIG MCRF Remittance Report">
            <p className="card-body" style={{ fontSize: '14.5px' }}>
              Monthly Contribution Remittance File complying with HDMF online employer portal specifications.
            </p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => downloadStatutory('pagibig')}
                disabled={!currentRunId}
              >
                Download Pag-IBIG MCRF
              </button>
            </div>
          </Card>

          <Card kicker="Bureau of Internal Revenue" title="BIR Form 1601-C & 2316 Monthly Summary">
            <p className="card-body" style={{ fontSize: '14.5px' }}>
              Monthly remittance return of income taxes withheld on compensation, tracking de minimis exemptions and TRAIN brackets.
            </p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => downloadStatutory('bir')}
                disabled={!currentRunId}
              >
                Download BIR 1601-C Summary
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Tab 4: Loans & Amortizations */}
      {activeTab === 'loans' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>SSS, Pag-IBIG & Company Employee Loans</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Active amortizations are automatically deducted during payroll runs and settle toward loan balance upon payout.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowLoanModal(true)}>
              + Register New Loan
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)', backgroundColor: 'var(--color-surface-hover)' }}>
                <th style={{ padding: '12px 14px' }}>Employee</th>
                <th style={{ padding: '12px 14px' }}>Loan Type</th>
                <th style={{ padding: '12px 14px' }}>Ref / SSS / Pag-IBIG No.</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Principal</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Monthly Amortization</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Balance Remaining</th>
                <th style={{ padding: '12px 14px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loansQuery.data && loansQuery.data.length > 0 ? (
                loansQuery.data.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 600 }}>{l.last_name}, {l.first_name}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ textTransform: 'capitalize' }}>{l.loan_type.replace(/_/g, ' ')}</span>
                    </td>
                    <td style={{ padding: '12px 14px', fontFamily: 'monospace' }}>{l.reference_number || '—'}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>₱{Number(l.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: '#f87171' }}>₱{Number(l.monthly_amortization).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600 }}>₱{Number(l.balance_remaining).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <Tag tone={l.status === 'active' ? 'accent' : 'neutral'}>
                        {l.status.toUpperCase()}
                      </Tag>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {l.status === 'active' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={updateLoanStatusMutation.isPending}
                          onClick={() => updateLoanStatusMutation.mutate({ id: l.id, status: 'paused' })}
                        >
                          Pause
                        </button>
                      )}
                      {l.status === 'paused' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={updateLoanStatusMutation.isPending}
                          onClick={() => updateLoanStatusMutation.mutate({ id: l.id, status: 'active' })}
                        >
                          Resume
                        </button>
                      )}
                      {l.status !== 'paid_off' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={updateLoanStatusMutation.isPending}
                          onClick={() => updateLoanStatusMutation.mutate({ id: l.id, status: 'paid_off' })}
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-muted)' }}>
                    No employee loans registered. Click '+ Register New Loan' above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 5: Service Charge Pool (RA 11360) */}
      {activeTab === 'service-charge' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Hospitality Service Charge Distribution</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Republic Act 11360 requires 85% distributed equally among covered rank-and-file & supervisory staff.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowServiceChargeModal(true)}>
              + Distribute Monthly Service Charge
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)', backgroundColor: 'var(--color-surface-hover)' }}>
                <th style={{ padding: '12px 14px' }}>Pool Period</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Total Collected</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>85% Employee Share</th>
                <th style={{ padding: '12px 14px', textAlign: 'center' }}>Covered Workers</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Net Payout Per Staff</th>
                <th style={{ padding: '12px 14px' }}>Distributed Date</th>
              </tr>
            </thead>
            <tbody>
              {serviceChargeQuery.data && serviceChargeQuery.data.length > 0 ? (
                serviceChargeQuery.data.map((sc) => (
                  <tr key={sc.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 600 }}>{sc.pool_period}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>₱{Number(sc.total_collected_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>₱{Number(sc.distributed_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>{sc.eligible_employee_count} staff</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>₱{Number(sc.amount_per_employee).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px' }}>{sc.distribution_date}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-muted)' }}>
                    No service charge distribution pools recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 6: Salary Matrices & Regional Rates */}
      {activeTab === 'salary-matrix' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
        }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 6px 0' }}>Salary Matrices & Regional Wage Rates</h2>
          <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginBottom: '16px' }}>
            Benchmarked against DOLE National Wages and Productivity Commission (NWPC) regional minimum wage orders.
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)', backgroundColor: 'var(--color-surface-hover)' }}>
                <th style={{ padding: '12px 14px' }}>Region</th>
                <th style={{ padding: '12px 14px' }}>Industry</th>
                <th style={{ padding: '12px 14px' }}>Rank Level</th>
                <th style={{ padding: '12px 14px', textAlign: 'center' }}>Grade</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Base Min</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Base Max</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Daily Standard</th>
                <th style={{ padding: '12px 14px' }}>Effective Date</th>
              </tr>
            </thead>
            <tbody>
              {salaryMatrixQuery.data && salaryMatrixQuery.data.length > 0 ? (
                salaryMatrixQuery.data.map((sm) => (
                  <tr key={sm.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 600 }}>{sm.region}</td>
                    <td style={{ padding: '12px 14px' }}>{sm.industry_type}</td>
                    <td style={{ padding: '12px 14px', textTransform: 'capitalize' }}>{sm.rank_level}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>SG-{sm.salary_grade}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>₱{Number(sm.min_base_salary).toLocaleString()}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>₱{Number(sm.max_base_salary).toLocaleString()}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600 }}>₱{Number(sm.standard_daily_rate).toFixed(2)}</td>
                    <td style={{ padding: '12px 14px' }}>{sm.effective_date}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-muted)' }}>
                    {salaryMatrixQuery.isLoading ? 'Loading matrix...' : 'No regional salary grades configured.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 7: Adjustments & Retro Pay */}
      {activeTab === 'adjustments' && (
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Retroactive Pay & Custom Adjustments</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Calculate backpay differential across past cutoffs or apply one-time adjustments and attendance bonuses.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowRetroModal(true)}>
              âš¡ Calculate Retro Pay
            </button>
          </div>

          <div style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)', backgroundColor: 'var(--color-surface-hover)' }}>
                  <th style={{ padding: '12px 14px' }}>Employee</th>
                  <th style={{ padding: '12px 14px' }}>Adjustment Type</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>Taxable</th>
                  <th style={{ padding: '12px 14px' }}>Effective Date</th>
                  <th style={{ padding: '12px 14px' }}>Remarks</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {adjustmentsQuery.data && adjustmentsQuery.data.length > 0 ? (
                  adjustmentsQuery.data.map((adj) => (
                    <tr key={adj.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 600 }}>{adj.last_name}, {adj.first_name}</td>
                      <td style={{ padding: '12px 14px', textTransform: 'capitalize' }}>{adj.adjustment_type.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: Number(adj.amount) >= 0 ? '#10b981' : '#f87171' }}>
                        ₱{Number(adj.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>{adj.is_taxable ? 'Yes' : 'No (Tax-Exempt)'}</td>
                      <td style={{ padding: '12px 14px' }}>{adj.effective_date}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--color-muted)' }}>{adj.remarks || '—'}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <Tag tone={adj.status === 'applied' ? 'accent' : 'neutral'}>
                          {adj.status.toUpperCase()}
                        </Tag>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-muted)' }}>
                      No adjustments logged. Use 'Calculate Retro Pay' above to simulate backpay.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loan Modal */}
      {showLoanModal && (
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
              Register Employee Loan
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Select Employee
                </label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={loanForm.employeeId}
                  onChange={(e) => setLoanForm({ ...loanForm, employeeId: e.target.value })}
                >
                  <option value="">Select Employee...</option>
                  {lineItems.map((item) => (
                    <option key={item.employee_id} value={item.employee_id}>
                      {item.lastName}, {item.firstName} ({item.employeeNo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Loan Type
                </label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={loanForm.loanType}
                  onChange={(e) => setLoanForm({ ...loanForm, loanType: e.target.value })}
                >
                  <option value="sss_salary_loan">SSS Salary Loan</option>
                  <option value="sss_calamity_loan">SSS Calamity Loan</option>
                  <option value="pagibig_mpl">Pag-IBIG Multi-Purpose Loan (MPL)</option>
                  <option value="pagibig_housing_loan">Pag-IBIG Housing Loan</option>
                  <option value="company_emergency_loan">Company Emergency / Salary Loan</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Loan Reference / Billing Number
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  placeholder="e.g. SSS-LN-2026-9921"
                  value={loanForm.referenceNumber}
                  onChange={(e) => setLoanForm({ ...loanForm, referenceNumber: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                    Principal Amount (₱)
                  </label>
                  <input
                    type="number"
                    className="input"
                    style={{ width: '100%' }}
                    value={loanForm.principalAmount}
                    onChange={(e) => setLoanForm({ ...loanForm, principalAmount: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                    Monthly Amortization (₱)
                  </label>
                  <input
                    type="number"
                    className="input"
                    style={{ width: '100%' }}
                    value={loanForm.monthlyAmortization}
                    onChange={(e) => setLoanForm({ ...loanForm, monthlyAmortization: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
              <button className="btn btn-secondary" onClick={() => setShowLoanModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!loanForm.employeeId || createLoanMutation.isPending}
                onClick={() => createLoanMutation.mutate(loanForm)}
              >
                {createLoanMutation.isPending ? 'Saving...' : 'Register Loan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Service Charge Modal */}
      {showServiceChargeModal && (
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
              Distribute Service Charge Pool (RA 11360)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Pool Period (YYYY-MM)
                </label>
                <input
                  type="month"
                  className="input"
                  style={{ width: '100%' }}
                  value={serviceChargeForm.poolPeriod}
                  onChange={(e) => setServiceChargeForm({ ...serviceChargeForm, poolPeriod: e.target.value })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Total Collected Service Charge from Guests (₱)
                </label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%' }}
                  value={serviceChargeForm.totalCollectedAmount}
                  onChange={(e) => setServiceChargeForm({ ...serviceChargeForm, totalCollectedAmount: e.target.value })}
                />
              </div>
              <div style={{ padding: '10px', backgroundColor: 'var(--color-surface-hover)', borderRadius: '6px', fontSize: '15px' }}>
                <div>• <strong>85% Covered Worker Share:</strong> ₱{(Number(serviceChargeForm.totalCollectedAmount) * 0.85).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                <div style={{ color: 'var(--color-muted)', marginTop: '2px' }}>• 15% Management / Breakage Reserve: ₱{(Number(serviceChargeForm.totalCollectedAmount) * 0.15).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
              <button className="btn btn-secondary" onClick={() => setShowServiceChargeModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={distributeServiceChargeMutation.isPending}
                onClick={() => distributeServiceChargeMutation.mutate(serviceChargeForm)}
              >
                {distributeServiceChargeMutation.isPending ? 'Distributing...' : 'Distribute Pool'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retro Pay Modal */}
      {showRetroModal && (
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
              Calculate Retroactive Salary Increase
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>Select Employee</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={retroForm.employeeId}
                  onChange={(e) => setRetroForm({ ...retroForm, employeeId: e.target.value })}
                >
                  <option value="">Select Employee...</option>
                  {lineItems.map((item) => (
                    <option key={item.employee_id} value={item.employee_id}>
                      {item.lastName}, {item.firstName} ({item.employeeNo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>Effective Date of Increase</label>
                <input
                  type="date"
                  className="input"
                  style={{ width: '100%' }}
                  value={retroForm.effectiveDate}
                  onChange={(e) => setRetroForm({ ...retroForm, effectiveDate: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>Old Monthly Rate (₱)</label>
                  <input
                    type="number"
                    className="input"
                    style={{ width: '100%' }}
                    value={retroForm.previousMonthlyRate}
                    onChange={(e) => setRetroForm({ ...retroForm, previousMonthlyRate: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>New Monthly Rate (₱)</label>
                  <input
                    type="number"
                    className="input"
                    style={{ width: '100%' }}
                    value={retroForm.newMonthlyRate}
                    onChange={(e) => setRetroForm({ ...retroForm, newMonthlyRate: e.target.value })}
                  />
                </div>
              </div>

              {retroResult && (
                <div style={{ padding: '12px', backgroundColor: 'rgba(16, 185, 129, 0.15)', borderRadius: '8px', border: '1px solid #10b981', marginTop: '8px' }}>
                  <div style={{ fontWeight: 600, color: '#10b981', fontSize: '15px' }}>Computed Backpay: ₱{Number(retroResult.totalRetroPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  <div style={{ fontSize: '15px', color: 'var(--color-fg)', marginTop: '2px' }}>Across {retroResult.cutoffsAffected} previous payroll cut-off period(s). Adjustment queued!</div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
              <button className="btn btn-secondary" onClick={() => { setShowRetroModal(false); setRetroResult(null); }}>Close</button>
              <button
                className="btn btn-primary"
                disabled={!retroForm.employeeId || calculateRetroMutation.isPending}
                onClick={() => calculateRetroMutation.mutate(retroForm)}
              >
                {calculateRetroMutation.isPending ? 'Calculating...' : 'Compute & Queue Retro Pay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Compensation & Bank Profiles */}
      {activeTab === 'compensation' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Employee Compensation, Statutory IDs &amp; Bank Profiles</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Configure monthly base rates, de minimis allowances, MWE status, TIN/SSS/PhilHealth/Pag-IBIG IDs, and payroll bank accounts.
              </p>
            </div>
            <input
              type="text"
              placeholder="Search employee or ID..."
              value={compSearch}
              onChange={(e) => setCompSearch(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)', minWidth: '240px' }}
            />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)', backgroundColor: 'var(--color-surface-hover)' }}>
                  <th style={{ padding: '10px 12px' }}>Emp No</th>
                  <th style={{ padding: '10px 12px' }}>Employee</th>
                  <th style={{ padding: '10px 12px' }}>Branch</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Monthly Rate</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>De Minimis</th>
                  <th style={{ padding: '10px 12px' }}>Bank &amp; Account</th>
                  <th style={{ padding: '10px 12px' }}>TIN</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {(compensationQuery.data ?? [])
                  .filter((c) => {
                    const q = compSearch.trim().toLowerCase();
                    if (!q) return true;
                    return `${c.firstName} ${c.lastName} ${c.employeeNo}`.toLowerCase().includes(q);
                  })
                  .map((c) => {
                    const totalDm = Number(c.riceSubsidy || 0) + Number(c.clothingAllowance || 0) + Number(c.laundryAllowance || 0) + Number(c.medicalAllowance || 0);
                    return (
                      <tr key={c.employeeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{c.employeeNo}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                          {c.lastName}, {c.firstName}{' '}
                          {c.isMinimumWage && <Tag tone="accent">MWE</Tag>}
                        </td>
                        <td style={{ padding: '10px 12px' }}>{c.branchName || 'Unassigned'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>
                          ₱{Number(c.monthlyRate || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          ₱{totalDm.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                          {c.bankName} · {c.bankAccountNo || '—'}
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{c.tin || '—'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditingComp({
                              employeeId: c.employeeId,
                              name: `${c.firstName} ${c.lastName}`,
                              branchId: c.branchId || '',
                              monthlyRate: Number(c.monthlyRate || 0),
                              payType: c.payType || 'monthly',
                              payFrequency: c.payFrequency || 'semi_monthly',
                              isMinimumWage: Boolean(c.isMinimumWage),
                              riceSubsidy: Number(c.riceSubsidy || 0),
                              clothingAllowance: Number(c.clothingAllowance || 0),
                              laundryAllowance: Number(c.laundryAllowance || 0),
                              medicalAllowance: Number(c.medicalAllowance || 0),
                              taxableAllowance: Number(c.taxableAllowance || 0),
                              bankName: c.bankName || 'BPI',
                              bankAccountNo: c.bankAccountNo || '',
                              tin: c.tin || '',
                              sssNo: c.sssNo || '',
                              philhealthNo: c.philhealthNo || '',
                              pagibigNo: c.pagibigNo || '',
                            })}
                          >
                            Edit Pay Profile
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {editingComp && (
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
                maxWidth: '640px',
                maxHeight: '90vh',
                overflowY: 'auto',
              }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 600 }}>
                  Edit Compensation Profile — {editingComp.name}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Monthly Rate (₱)</label>
                    <input type="number" step="0.01" value={editingComp.monthlyRate}
                      onChange={(e) => setEditingComp({ ...editingComp, monthlyRate: Number(e.target.value) })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Branch</label>
                    <select value={editingComp.branchId}
                      onChange={(e) => setEditingComp({ ...editingComp, branchId: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}>
                      <option value="">Unassigned</option>
                      {(branchesQuery.data ?? []).map((b) => (
                        <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Rice Subsidy (₱/mo)</label>
                    <input type="number" step="0.01" value={editingComp.riceSubsidy}
                      onChange={(e) => setEditingComp({ ...editingComp, riceSubsidy: Number(e.target.value) })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Clothing Allowance (₱/mo)</label>
                    <input type="number" step="0.01" value={editingComp.clothingAllowance}
                      onChange={(e) => setEditingComp({ ...editingComp, clothingAllowance: Number(e.target.value) })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Laundry Allowance (₱/mo)</label>
                    <input type="number" step="0.01" value={editingComp.laundryAllowance}
                      onChange={(e) => setEditingComp({ ...editingComp, laundryAllowance: Number(e.target.value) })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Medical Allowance (₱/mo)</label>
                    <input type="number" step="0.01" value={editingComp.medicalAllowance}
                      onChange={(e) => setEditingComp({ ...editingComp, medicalAllowance: Number(e.target.value) })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Bank Name</label>
                    <select value={editingComp.bankName}
                      onChange={(e) => setEditingComp({ ...editingComp, bankName: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}>
                      <option value="BPI">BPI</option>
                      <option value="BDO">BDO</option>
                      <option value="Metrobank">Metrobank</option>
                      <option value="UnionBank">UnionBank</option>
                      <option value="Security Bank">Security Bank</option>
                      <option value="GCash">GCash</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Bank Account No.</label>
                    <input type="text" value={editingComp.bankAccountNo}
                      onChange={(e) => setEditingComp({ ...editingComp, bankAccountNo: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>TIN</label>
                    <input type="text" value={editingComp.tin}
                      onChange={(e) => setEditingComp({ ...editingComp, tin: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>SSS No.</label>
                    <input type="text" value={editingComp.sssNo}
                      onChange={(e) => setEditingComp({ ...editingComp, sssNo: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>PhilHealth No.</label>
                    <input type="text" value={editingComp.philhealthNo}
                      onChange={(e) => setEditingComp({ ...editingComp, philhealthNo: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Pag-IBIG MID No.</label>
                    <input type="text" value={editingComp.pagibigNo}
                      onChange={(e) => setEditingComp({ ...editingComp, pagibigNo: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', fontSize: '14.5px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editingComp.isMinimumWage}
                    onChange={(e) => setEditingComp({ ...editingComp, isMinimumWage: e.target.checked })} />
                  Minimum Wage Earner (MWE — Statutory Withholding Tax Exempt under TRAIN Law)
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                  <button className="btn btn-secondary" onClick={() => setEditingComp(null)}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    disabled={upsertCompensationMutation.isPending}
                    onClick={() => upsertCompensationMutation.mutate({ employeeId: editingComp.employeeId, body: editingComp })}
                  >
                    {upsertCompensationMutation.isPending ? 'Saving...' : 'Save Compensation Profile'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: 13th Month Pay & Annualized Year-End Tax Reconciliation */}
      {activeTab === 'year-end' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ fontSize: '14.5px', fontWeight: 600 }}>Fiscal Year:</label>
              <select
                value={yearEndYear}
                onChange={(e) => setYearEndYear(Number(e.target.value))}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-fg)' }}
              >
                {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={downloadBir1604c}>
                Export BIR 1604-C Alphalist (.csv)
              </button>
              <button
                className="btn btn-primary"
                disabled={compute13thMutation.isPending}
                onClick={() => compute13thMutation.mutate()}
              >
                {compute13thMutation.isPending ? 'Generating...' : `+ Generate ${yearEndYear} 13th Month Payroll Run`}
              </button>
            </div>
          </div>

          {/* 13th Month Pay Preview */}
          <Card title={`${yearEndYear} 13th Month Pay Preview (PD 851 — ₱90,000 Tax-Exempt Ceiling)`}>
            <div style={{ overflowX: 'auto', marginTop: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                    <th style={{ padding: '10px 12px' }}>Emp No</th>
                    <th style={{ padding: '10px 12px' }}>Employee</th>
                    <th style={{ padding: '10px 12px' }}>Basis</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>YTD Basic Pay</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>13th Month Pay</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Non-Taxable (≤₱90k)</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Taxable Excess</th>
                  </tr>
                </thead>
                <tbody>
                  {(thirteenthPreviewQuery.data ?? []).map((p) => (
                    <tr key={p.employeeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{p.employeeNo}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{p.employeeName}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <Tag tone={p.source === 'actual_runs' ? 'accent' : 'neutral'}>
                          {p.source === 'actual_runs' ? 'Posted Runs' : 'Salary Estimate'}
                        </Tag>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>₱{Number(p.ytdBasicPay).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#38bdf8' }}>
                        ₱{Number(p.thirteenthMonthPay).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>₱{Number(p.nonTaxablePart).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: p.taxableExcess > 0 ? '#f59e0b' : 'var(--color-muted)' }}>
                        ₱{Number(p.taxableExcess).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Annualized Year-End Tax Reconciliation */}
          <Card title={`${yearEndYear} Annualized Year-End TRAIN Law Tax Reconciliation (BIR 1604-C)`}>
            {yearEndTaxQuery.data?.summary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', margin: '10px 0 16px' }}>
                <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--color-surface-hover)' }}>
                  <div style={{ fontSize: '13px', color: 'var(--color-muted)' }}>Annual Tax Due</div>
                  <div style={{ fontSize: '20px', fontWeight: 600 }}>₱{Number(yearEndTaxQuery.data.summary.totalTaxDue).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
                </div>
                <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--color-surface-hover)' }}>
                  <div style={{ fontSize: '13px', color: 'var(--color-muted)' }}>YTD Tax Withheld</div>
                  <div style={{ fontSize: '20px', fontWeight: 600 }}>₱{Number(yearEndTaxQuery.data.summary.totalTaxWithheld).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
                </div>
                <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--color-surface-hover)' }}>
                  <div style={{ fontSize: '13px', color: 'var(--color-muted)' }}>Total Employee Refund</div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: '#10b981' }}>₱{Number(yearEndTaxQuery.data.summary.totalRefund).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
                </div>
                <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--color-surface-hover)' }}>
                  <div style={{ fontSize: '13px', color: 'var(--color-muted)' }}>Total Tax Still Due</div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: '#f59e0b' }}>₱{Number(yearEndTaxQuery.data.summary.totalStillDue).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
                </div>
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                    <th style={{ padding: '10px 12px' }}>Employee</th>
                    <th style={{ padding: '10px 12px' }}>TIN</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Gross</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Taxable Income</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Annual Tax Due</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Tax Withheld</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Adjustment</th>
                  </tr>
                </thead>
                <tbody>
                  {(yearEndTaxQuery.data?.employees ?? []).map((e: any) => (
                    <tr key={e.employeeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{e.employeeName}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{e.tin || '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>₱{Number(e.totalGross).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>₱{Number(e.annualTaxableIncome).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>₱{Number(e.annualTaxDue).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>₱{Number(e.ytdTaxWithheld).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: e.variance < 0 ? '#10b981' : e.variance > 0 ? '#f59e0b' : 'var(--color-muted)' }}>
                        {e.variance < 0
                          ? `Refund ₱${Math.abs(e.variance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                          : e.variance > 0
                            ? `Due ₱${e.variance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                            : 'Balanced'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Tab 3: Disbursement */}
      {activeTab === 'disbursement' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Card title="Bank Disbursement Batch Exports">
            <p className="card-body" style={{ fontSize: '14.5px' }}>
              Export compliant batch credit files directly formatted for Philippine commercial banking corporate portals.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                onClick={() => downloadDisbursement('bpi')}
                disabled={!currentRunId}
              >
                Export BPI BizLink (.csv)
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => downloadDisbursement('bdo')}
                disabled={!currentRunId}
              >
                Export BDO PayLink (.csv)
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => downloadDisbursement('metrobank')}
                disabled={!currentRunId}
              >
                Export Metrobank Direct (.csv)
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => downloadDisbursement('unionbank')}
                disabled={!currentRunId}
              >
                Export UnionBank The Portal (.csv)
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Compute Modal */}
      {showComputeModal && (
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
            maxWidth: '500px',
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 600 }}>
              Compute Quindena Payroll Run
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Payroll Run Title
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  value={computeForm.title}
                  onChange={(e) => setComputeForm({ ...computeForm, title: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Batch Code
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  value={computeForm.code}
                  onChange={(e) => setComputeForm({ ...computeForm, code: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                    Period Start
                  </label>
                  <input
                    type="date"
                    className="input"
                    style={{ width: '100%' }}
                    value={computeForm.periodStart}
                    onChange={(e) => setComputeForm({ ...computeForm, periodStart: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                    Period End
                  </label>
                  <input
                    type="date"
                    className="input"
                    style={{ width: '100%' }}
                    value={computeForm.periodEnd}
                    onChange={(e) => setComputeForm({ ...computeForm, periodEnd: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Payout Date
                </label>
                <input
                  type="date"
                  className="input"
                  style={{ width: '100%' }}
                  value={computeForm.payoutDate}
                  onChange={(e) => setComputeForm({ ...computeForm, payoutDate: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  Branch
                </label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={computeForm.branchId}
                  onChange={(e) => setComputeForm({ ...computeForm, branchId: e.target.value })}
                >
                  <option value="">All Branches (Consolidated)</option>
                  {branchesQuery.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowComputeModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => computeMutation.mutate(computeForm)}
                disabled={computeMutation.isPending}
              >
                {computeMutation.isPending ? 'Computing...' : 'Calculate & Generate Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
