import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../auth';
import { ErrorNote, Spinner } from '../components/ui';
import { Card, PageHead, Section, Tag, Btn } from '../components/ds';

interface ExecutiveDashboardData {
  statutory: {
    totalOutflow: number;
    totalContributionsAndCoverage: number;
    sss: {
      agency: string;
      fullName: string;
      total: number;
      percentage: number;
      eeShare: number;
      erShare: number;
      regularEe: number;
      regularEr: number;
      wispEe: number;
      wispEr: number;
      ecEr: number;
    };
    pagibig: {
      agency: string;
      fullName: string;
      total: number;
      percentage: number;
      eeShare: number;
      erShare: number;
    };
    philhealth: {
      agency: string;
      fullName: string;
      total: number;
      percentage: number;
      eeShare: number;
      erShare: number;
    };
    withholdingTax: {
      agency: string;
      fullName: string;
      total: number;
      percentage: number;
    };
  };
  insuranceAndBenefits: {
    totalMonthlyBenefits: number;
    enrolledCount: number;
    riceSubsidy: number;
    clothingAllowance: number;
    laundryAllowance: number;
    medicalAllowance: number;
    providers: Array<{
      name: string;
      provider: string;
      monthlySpend: number;
      pct: number;
    }>;
  };
  loans: {
    totalActiveLoans: number;
    totalPrincipal: number;
    totalRemitted: number;
    outstandingBalance: number;
    portfolio: Array<{
      type: string;
      label: string;
      count: number;
      principal: number;
      balance: number;
      remitted: number;
      monthlyAmortization: number;
      borrowers: number;
    }>;
  };
  branches: Array<{
    branchId: string;
    code: string;
    name: string;
    region: string;
    headcount: number;
    monthlyPayroll: number;
    averageSalary: number;
    sharePercent: number;
  }>;
  salaryBrackets: Array<{
    bracketLabel: string;
    sortOrder: number;
    employeeCount: number;
    totalSpend: number;
    avgSalary: number;
    workforcePercent: number;
  }>;
  workforce: {
    totalHeadcount: number;
    managersCount: number;
    staffCount: number;
    spanOfControl: number;
    departmentsCount: number;
    branchesCount: number;
    totalMonthlyBasePayroll: number;
    averageBaseSalary: number;
    departments: Array<{
      department: string;
      headcount: number;
      totalSalary: number;
    }>;
  };
  payrollOverview: {
    totalGrossPay: number;
    totalNetPay: number;
    totalRuns: number;
    totalPayslips: number;
  };
}

function formatPhp(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatPhpCompact(amount: number): string {
  if (amount >= 1_000_000) {
    return `₱${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `₱${(amount / 1_000).toFixed(2)}k`;
  }
  return `₱${amount.toFixed(2)}`;
}

export default function ExecutiveDashboard() {
  const [activeTab, setActiveTab] = useState<'pay_benefits' | 'branches' | 'brackets_loans' | 'leadership'>('pay_benefits');

  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'executive-dashboard'],
    queryFn: () => api<ExecutiveDashboardData>('/reports/executive-dashboard'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  const { statutory, insuranceAndBenefits, loans, branches, salaryBrackets, workforce } = data;

  return (
    <Section>
      <PageHead title="Executive Outflow & Workforce Intelligence">
        <Btn
          variant={activeTab === 'pay_benefits' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('pay_benefits')}
        >
          Pay & Statutory Benefits
        </Btn>
        <Btn
          variant={activeTab === 'branches' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('branches')}
        >
          Branch Costs ({branches.length})
        </Btn>
        <Btn
          variant={activeTab === 'brackets_loans' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('brackets_loans')}
        >
          Salary Brackets & Loans
        </Btn>
        <Btn
          variant={activeTab === 'leadership' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('leadership')}
        >
          Workforce & Leadership
        </Btn>
      </PageHead>

      {/* Top Level Executive Pill Banner inspired by uploaded screenshot */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-divider)',
            borderRadius: '9999px',
            padding: '6px 16px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.9rem',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6' }} />
          <strong>{formatPhpCompact(statutory.totalContributionsAndCoverage)}</strong> statutory contributions & coverage
        </div>

        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-divider)',
            borderRadius: '9999px',
            padding: '6px 16px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.9rem',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
          <strong>{formatPhpCompact(loans.totalRemitted)}</strong> loan payments remitted
        </div>

        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-divider)',
            borderRadius: '9999px',
            padding: '6px 16px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.9rem',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
          <strong>{workforce.totalHeadcount} Active Personnel</strong> Across {branches.length} Regional Hubs
        </div>

        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-divider)',
            borderRadius: '9999px',
            padding: '6px 16px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.9rem',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6' }} />
          Span of Control: <strong>1 : {workforce.spanOfControl}</strong> (Managers : Staff)
        </div>
      </div>

      {/* TAB 1: Pay & Statutory Benefits */}
      {activeTab === 'pay_benefits' && (
        <>
          {/* Statutory Agencies */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Statutory Agencies</h3>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
                Total Mandated Outflow: {formatPhp(statutory.totalOutflow)}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              {/* SSS Card */}
              <Card
                style={{
                  borderTop: '3px solid #005696',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 6,
                      background: '#005696',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                      letterSpacing: 1,
                    }}
                  >
                    SSS
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>SSS</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-600)' }}>Social Security System</div>
                  </div>
                </div>

                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--color-text)', margin: '6px 0' }}>
                  {formatPhpCompact(statutory.sss.total)}
                </div>

                <div style={{ width: '100%', height: 6, background: 'var(--color-divider)', borderRadius: 3, margin: '8px 0', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(statutory.sss.percentage, 100)}%`, height: '100%', background: '#005696', borderRadius: 3 }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-neutral-600)', marginBottom: 8 }}>
                  <span>{statutory.sss.percentage}% of total outflow</span>
                  <span>{formatPhp(statutory.sss.total)}</span>
                </div>

                <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 6, fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                  <span>EE Share: {formatPhp(statutory.sss.eeShare)}</span>
                  <span>ER Share: {formatPhp(statutory.sss.erShare)}</span>
                </div>
              </Card>

              {/* Pag-IBIG (HDMF) Card */}
              <Card
                style={{
                  borderTop: '3px solid #dc2626',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 6,
                      background: '#dc2626',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '0.75rem',
                      letterSpacing: 0.5,
                    }}
                  >
                    HDMF
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Pag-IBIG (HDMF)</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-600)' }}>Mutual Development Fund</div>
                  </div>
                </div>

                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--color-text)', margin: '6px 0' }}>
                  {formatPhpCompact(statutory.pagibig.total)}
                </div>

                <div style={{ width: '100%', height: 6, background: 'var(--color-divider)', borderRadius: 3, margin: '8px 0', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(statutory.pagibig.percentage, 100)}%`, height: '100%', background: '#dc2626', borderRadius: 3 }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-neutral-600)', marginBottom: 8 }}>
                  <span>{statutory.pagibig.percentage}% of total outflow</span>
                  <span>{formatPhp(statutory.pagibig.total)}</span>
                </div>

                <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 6, fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                  <span>EE Share: {formatPhp(statutory.pagibig.eeShare)}</span>
                  <span>ER Share: {formatPhp(statutory.pagibig.erShare)}</span>
                </div>
              </Card>

              {/* PhilHealth (PHIC) Card */}
              <Card
                style={{
                  borderTop: '3px solid #16a34a',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 6,
                      background: '#16a34a',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '0.8rem',
                      letterSpacing: 0.5,
                    }}
                  >
                    PHIC
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>PhilHealth (PHIC)</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-600)' }}>Health Insurance Corp</div>
                  </div>
                </div>

                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--color-text)', margin: '6px 0' }}>
                  {formatPhpCompact(statutory.philhealth.total)}
                </div>

                <div style={{ width: '100%', height: 6, background: 'var(--color-divider)', borderRadius: 3, margin: '8px 0', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(statutory.philhealth.percentage, 100)}%`, height: '100%', background: '#16a34a', borderRadius: 3 }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-neutral-600)', marginBottom: 8 }}>
                  <span>{statutory.philhealth.percentage}% of total outflow</span>
                  <span>{formatPhp(statutory.philhealth.total)}</span>
                </div>

                <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 6, fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                  <span>EE Share: {formatPhp(statutory.philhealth.eeShare)}</span>
                  <span>ER Share: {formatPhp(statutory.philhealth.erShare)}</span>
                </div>
              </Card>

              {/* BIR Tax Card */}
              <Card
                style={{
                  borderTop: '3px solid #d97706',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 6,
                      background: '#d97706',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                      letterSpacing: 0.5,
                    }}
                  >
                    BIR
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>BIR Withholding Tax</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-600)' }}>TRAIN Law Withholding</div>
                  </div>
                </div>

                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--color-text)', margin: '6px 0' }}>
                  {formatPhpCompact(statutory.withholdingTax.total)}
                </div>

                <div style={{ width: '100%', height: 6, background: 'var(--color-divider)', borderRadius: 3, margin: '8px 0', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(statutory.withholdingTax.percentage, 100)}%`, height: '100%', background: '#d97706', borderRadius: 3 }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-neutral-600)', marginBottom: 8 }}>
                  <span>{statutory.withholdingTax.percentage}% of total outflow</span>
                  <span>{formatPhp(statutory.withholdingTax.total)}</span>
                </div>

                <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 6, fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Taxable Staff: All active non-MWE</span>
                  <span>RA 10963 Compliant</span>
                </div>
              </Card>
            </div>
          </div>

          {/* Insurance Providers & Voluntary Benefits */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Corporate Insurance & Benefits Providers</h3>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
                Total Monthly Subsidies: {formatPhp(insuranceAndBenefits.totalMonthlyBenefits)}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              {insuranceAndBenefits.providers.map((p, idx) => (
                <Card key={idx}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-neutral-600)' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, margin: '4px 0' }}>
                    {formatPhpCompact(p.monthlySpend)}
                  </div>
                  <div style={{ width: '100%', height: 4, background: 'var(--color-divider)', borderRadius: 2, margin: '6px 0', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(p.pct, 100)}%`, height: '100%', background: 'var(--color-accent)', borderRadius: 2 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-neutral-600)' }}>
                    <span>{p.pct}% of voluntary spend</span>
                    <span>{p.provider}</span>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Where the Outflow Goes Section */}
          <Card kicker="Where the Outflow Goes" style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)', alignItems: 'center' }}>
              <div>
                <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-neutral-600)' }}>
                  Aggregated outflow distribution across statutory contributions (SSS, PHIC, HDMF), national income tax (BIR), corporate benefits, and direct take-home pay disbursed to Philippine personnel.
                </p>
                <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 12, height: 12, background: '#005696', borderRadius: 2 }} />
                      SSS Social Security System
                    </span>
                    <strong>{formatPhp(statutory.sss.total)} ({statutory.sss.percentage}%)</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 12, height: 12, background: '#16a34a', borderRadius: 2 }} />
                      PhilHealth Health Insurance
                    </span>
                    <strong>{formatPhp(statutory.philhealth.total)} ({statutory.philhealth.percentage}%)</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 12, height: 12, background: '#dc2626', borderRadius: 2 }} />
                      Pag-IBIG Mutual Fund
                    </span>
                    <strong>{formatPhp(statutory.pagibig.total)} ({statutory.pagibig.percentage}%)</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 12, height: 12, background: '#d97706', borderRadius: 2 }} />
                      BIR Withholding Tax
                    </span>
                    <strong>{formatPhp(statutory.withholdingTax.total)} ({statutory.withholdingTax.percentage}%)</strong>
                  </div>
                </div>
              </div>

              <div style={{ padding: 'var(--space-3)', background: 'var(--color-surface)', borderRadius: 8 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-neutral-600)', marginBottom: 6 }}>
                  OUTFLOW SUMMARY
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-accent)' }}>
                  {formatPhp(statutory.totalOutflow)}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)', marginTop: 4 }}>
                  Total remittances to Philippine statutory institutions across {data.payrollOverview.totalRuns} payroll cycles.
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* TAB 2: Branch Costs & Regional Distribution */}
      {activeTab === 'branches' && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
            }}
          >
            {branches.map((b) => (
              <Card key={b.branchId}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{b.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)' }}>
                      Code: {b.code} &bull; Region: {b.region}
                    </div>
                  </div>
                  <Tag tone="accent">{`${b.sharePercent}% Share`}</Tag>
                </div>

                <div style={{ margin: '14px 0 8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)' }}>Monthly Payroll Spend</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text)' }}>
                    {formatPhp(b.monthlyPayroll)}
                  </div>
                </div>

                <div style={{ width: '100%', height: 6, background: 'var(--color-divider)', borderRadius: 3, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(b.sharePercent, 100)}%`, height: '100%', background: 'var(--color-accent)', borderRadius: 3 }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', borderTop: '1px solid var(--color-divider)', paddingTop: 8 }}>
                  <span>Headcount: <strong>{b.headcount}</strong></span>
                  <span>Avg Salary: <strong>{formatPhp(b.averageSalary)}</strong></span>
                </div>
              </Card>
            ))}
          </div>

          <Card kicker="Regional Payroll Comparison Table">
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-divider)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px' }}>Branch Hub</th>
                    <th style={{ padding: '10px 12px' }}>Code</th>
                    <th style={{ padding: '10px 12px' }}>Region</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Active Headcount</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Monthly Payroll Outlay</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Average Monthly Salary</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Company Share</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b) => (
                    <tr key={b.branchId} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{b.name}</td>
                      <td style={{ padding: '10px 12px' }}>{b.code}</td>
                      <td style={{ padding: '10px 12px' }}><Tag tone="outline">{b.region}</Tag></td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{b.headcount}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{formatPhp(b.monthlyPayroll)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatPhp(b.averageSalary)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{ fontWeight: 600, color: 'var(--color-accent)' }}>{b.sharePercent}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* TAB 3: Salary Brackets & Loans Portfolio */}
      {activeTab === 'brackets_loans' && (
        <>
          {/* Salary Brackets */}
          <Card kicker="Salary Distribution by Bracket / Grade" style={{ marginBottom: 'var(--space-4)' }}>
            <p style={{ margin: '0 0 var(--space-3)', fontSize: '0.9rem', color: 'var(--color-neutral-600)' }}>
              Headcount and monthly financial spend clustered into progressive compensation tiers.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {salaryBrackets.map((bk) => (
                <div key={bk.sortOrder} style={{ padding: '12px 16px', background: 'var(--color-surface)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>{bk.bracketLabel}</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)', marginLeft: 8 }}>
                        ({bk.employeeCount} staff &bull; {bk.workforcePercent}% of workforce)
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>{formatPhp(bk.totalSpend)}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)', display: 'block' }}>
                        Avg: {formatPhp(bk.avgSalary)} / mo
                      </span>
                    </div>
                  </div>

                  <div style={{ width: '100%', height: 8, background: 'var(--color-divider)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(bk.workforcePercent, 100)}%`,
                        height: '100%',
                        background:
                          bk.sortOrder === 5
                            ? '#8b5cf6'
                            : bk.sortOrder === 4
                            ? '#3b82f6'
                            : bk.sortOrder === 3
                            ? '#10b981'
                            : bk.sortOrder === 2
                            ? '#f59e0b'
                            : '#64748b',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Employee Loans Portfolio */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Employee Loans & Amortizations</h3>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
                Active Loans: {loans.totalActiveLoans}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-3)',
              }}
            >
              <Card>
                <div className="card-kicker">TOTAL PRINCIPAL DISBURSED</div>
                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--color-text)' }}>
                  {formatPhp(loans.totalPrincipal)}
                </div>
              </Card>

              <Card>
                <div className="card-kicker">TOTAL REMITTED TO DATE</div>
                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--color-success, #16a34a)' }}>
                  {formatPhp(loans.totalRemitted)}
                </div>
              </Card>

              <Card>
                <div className="card-kicker">OUTSTANDING LOAN BALANCE</div>
                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--color-warning, #d97706)' }}>
                  {formatPhp(loans.outstandingBalance)}
                </div>
              </Card>
            </div>

            <Card kicker="Active Loan Breakdown">
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-divider)', textAlign: 'left' }}>
                      <th style={{ padding: '10px 12px' }}>Loan Facility</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Active Loans</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Borrowers</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Principal</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Remitted</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Remaining Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.portfolio.map((l, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{l.label}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{l.count}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{l.borrowers}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatPhp(l.principal)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--color-success, #16a34a)' }}>{formatPhp(l.remitted)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--color-warning, #d97706)' }}>
                          {formatPhp(l.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}

      {/* TAB 4: Workforce & Leadership */}
      {activeTab === 'leadership' && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
            }}
          >
            <Card>
              <div className="card-kicker">TOTAL HEADCOUNT</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-accent)' }}>
                {workforce.totalHeadcount}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>Active regular & probationary</div>
            </Card>

            <Card>
              <div className="card-kicker">MANAGERS & SUPERVISORS</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#3b82f6' }}>
                {workforce.managersCount}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>Leaders with direct reports</div>
            </Card>

            <Card>
              <div className="card-kicker">OPERATIONAL STAFF</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#10b981' }}>
                {workforce.staffCount}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>Individual contributors</div>
            </Card>

            <Card>
              <div className="card-kicker">SPAN OF CONTROL</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#8b5cf6' }}>
                1 : {workforce.spanOfControl}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>Avg direct reports per manager</div>
            </Card>
          </div>

          <Card kicker="Department Headcount & Payroll Spend">
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-divider)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px' }}>Department</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Headcount</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Monthly Salary Outlay</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Average Salary</th>
                  </tr>
                </thead>
                <tbody>
                  {workforce.departments.map((d, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{d.department}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{d.headcount}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{formatPhp(d.totalSalary)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {formatPhp(d.headcount > 0 ? d.totalSalary / d.headcount : 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Section>
  );
}
