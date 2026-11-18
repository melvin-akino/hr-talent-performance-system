import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { superadminApi, getSuperadminUser, clearSuperadminSession, setSaasSession } from '../../auth';

interface TenantFeatureSet {
  feature_core_hr: boolean;
  feature_performance: boolean;
  feature_kpis: boolean;
  feature_peer_reviews: boolean;
  feature_competencies_pip: boolean;
  feature_leave_management: boolean;
  feature_time_attendance: boolean;
  feature_ph_payroll: boolean;
  feature_bank_disbursement: boolean;
  feature_bir_statutory_gen: boolean;
}

interface TenantRow {
  id: string;
  name: string;
  code: string;
  slug: string;
  status: 'active' | 'trial' | 'suspended';
  plan_tier: 'starter' | 'professional' | 'enterprise';
  max_employees: number;
  employee_count: number;
  trial_ends_at: string | null;
  subscription_expires_at: string | null;
  features: TenantFeatureSet;
}

export default function SuperadminDashboard() {
  const navigate = useNavigate();
  const superadminUser = getSuperadminUser();

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial new tenant template
  const initialNewOrg = {
    name: '',
    code: '',
    slug: '',
    planTier: 'professional',
    maxEmployees: 100,
    adminFirstName: '',
    adminLastName: '',
    adminEmail: '',
    adminPassword: '',
    features: {
      featureCoreHr: true,
      featurePerformance: true,
      featureKpis: true,
      featurePeerReviews: false,
      featureCompetenciesPip: false,
      featureLeaveManagement: true,
      featureTimeAttendance: true,
      featurePhPayroll: false, // Default unselected so superadmin controls licensing
      featureBankDisbursement: false,
      featureBirStatutoryGen: false,
    },
  };

  // Modals state
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [activeTenant, setActiveTenant] = useState<TenantRow | null>(null);
  const [savingFeatures, setSavingFeatures] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // New tenant form
  const [newOrg, setNewOrg] = useState(initialNewOrg);

  const loadTenants = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await superadminApi<TenantRow[]>('/superadmin/tenants');
      setTenants(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch platform tenants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  const handleLogout = () => {
    clearSuperadminSession();
    navigate('/superadmin/login');
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreatingTenant(true);
    try {
      await superadminApi('/superadmin/tenants', {
        method: 'POST',
        body: newOrg,
      });
      setOnboardingOpen(false);
      setNewOrg(initialNewOrg);
      setActionSuccessMessage(`Successfully onboarded company: ${newOrg.name}`);
      setTimeout(() => setActionSuccessMessage(null), 5000);
      await loadTenants();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to provision tenant organization');
    } finally {
      setCreatingTenant(false);
    }
  };

  const handleToggleFeature = async (featureKey: keyof TenantFeatureSet, currentValue: boolean) => {
    if (!activeTenant) return;
    try {
      setSavingFeatures(true);
      const camelKey = featureKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      const updated = await superadminApi<TenantFeatureSet>(`/superadmin/tenants/${activeTenant.id}/features`, {
        method: 'PATCH',
        body: { [camelKey]: !currentValue },
      });

      setActiveTenant((prev) => prev ? { ...prev, features: updated } : null);
      setTenants((prev) =>
        prev.map((t) => (t.id === activeTenant.id ? { ...t, features: updated } : t)),
      );
    } catch (err: any) {
      alert(`Error updating module: ${err.message}`);
    } finally {
      setSavingFeatures(false);
    }
  };

  const handleStatusChange = async (tenantId: string, status: string) => {
    try {
      await superadminApi(`/superadmin/tenants/${tenantId}/status`, {
        method: 'PATCH',
        body: { status },
      });
      await loadTenants();
      if (activeTenant && activeTenant.id === tenantId) {
        setActiveTenant((prev) => prev ? { ...prev, status: status as any } : null);
      }
    } catch (err: any) {
      alert(`Failed to change status: ${err.message}`);
    }
  };

  const handleImpersonate = async (tenantId: string) => {
    try {
      const data = await superadminApi<{
        token: string;
        employee: any;
        organization: any;
        roles: string[];
        features: any;
      }>(`/superadmin/tenants/${tenantId}/impersonate`, { method: 'POST' });

      setSaasSession(data.token, data);
      window.open('/home', '_blank');
    } catch (err: any) {
      alert(`Failed to impersonate tenant: ${err.message}`);
    }
  };

  // Metrics
  const totalTenants = tenants.length;
  const activeTenants = tenants.filter((t) => t.status === 'active').length;
  const totalEmployees = tenants.reduce((acc, t) => acc + Number(t.employee_count || 0), 0);
  const phPayrollLicensed = tenants.filter((t) => t.features?.feature_ph_payroll).length;

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0f1d',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Platform Topbar */}
      <header style={{
        backgroundColor: '#111827',
        borderBottom: '1px solid #1f2937',
        padding: '0 32px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            padding: '6px 10px',
            backgroundColor: '#312e81',
            borderRadius: '6px',
            fontSize: '15px',
            fontWeight: 700,
            color: '#a5b4fc',
            letterSpacing: '0.05em',
          }}>
            SUMMIT SAAS ENGINE
          </div>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>
            Platform Control & Superadmin Portal
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ fontSize: '14.5px', textAlign: 'right' }}>
            <div style={{ fontWeight: 600, color: '#f9fafb' }}>{superadminUser?.fullName || 'Superadmin'}</div>
            <div style={{ color: '#9ca3af', fontSize: '15px' }}>{superadminUser?.email}</div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 14px',
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '6px',
              color: '#d1d5db',
              fontSize: '14.5px',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main style={{ padding: '20px 24px', width: '100%' }}>
        {actionSuccessMessage && (
          <div style={{
            padding: '12px 18px',
            marginBottom: '24px',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid #10b981',
            borderRadius: '6px',
            color: '#34d399',
            fontSize: '15px',
          }}>
            {actionSuccessMessage}
          </div>
        )}

        {/* Metric Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '20px',
          marginBottom: '32px',
        }}>
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '8px',
            padding: '20px',
          }}>
            <div style={{ fontSize: '15px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Organizations
            </div>
            <div style={{ fontSize: '32px', fontWeight: 700, color: '#f9fafb', marginTop: '6px' }}>
              {totalTenants}
            </div>
            <div style={{ fontSize: '15px', color: '#10b981', marginTop: '4px' }}>
              {activeTenants} active subscriptions
            </div>
          </div>

          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '8px',
            padding: '20px',
          }}>
            <div style={{ fontSize: '15px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Active Employee Seats
            </div>
            <div style={{ fontSize: '32px', fontWeight: 700, color: '#f9fafb', marginTop: '6px' }}>
              {totalEmployees}
            </div>
            <div style={{ fontSize: '15px', color: '#9ca3af', marginTop: '4px' }}>
              across all registered organizations
            </div>
          </div>

          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '8px',
            padding: '20px',
          }}>
            <div style={{ fontSize: '15px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              PH Payroll Licenses
            </div>
            <div style={{ fontSize: '32px', fontWeight: 700, color: '#60a5fa', marginTop: '6px' }}>
              {phPayrollLicensed}
            </div>
            <div style={{ fontSize: '15px', color: '#93c5fd', marginTop: '4px' }}>
              {Math.round((phPayrollLicensed / (totalTenants || 1)) * 100)}% client adoption
            </div>
          </div>

          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '8px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}>
            <button
              onClick={() => {
                setCreateError(null);
                setOnboardingOpen(true);
              }}
              style={{
                padding: '12px 20px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '15px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Onboard Client Organization
            </button>
          </div>
        </div>

        {/* Tenant List Table */}
        <div style={{
          backgroundColor: '#111827',
          border: '1px solid #1f2937',
          borderRadius: '8px',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '18px 24px',
            borderBottom: '1px solid #1f2937',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Client Organizations & License Modules</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '14.5px', color: '#9ca3af' }}>
                Activate or deactivate system features per tenant including Philippine Payroll and seat allocations.
              </p>
            </div>
            <button
              onClick={loadTenants}
              style={{
                padding: '6px 12px',
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#d1d5db',
                fontSize: '14.5px',
                cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af' }}>
              Loading platform tenants…
            </div>
          ) : error ? (
            <div style={{ padding: '32px', color: '#f87171' }}>{error}</div>
          ) : tenants.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af' }}>
              No client organizations created yet. Click "Onboard Client Organization" to provision your first tenant.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14.5px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#0d1322', color: '#9ca3af', borderBottom: '1px solid #1f2937' }}>
                    <th style={{ padding: '12px 20px', fontWeight: 600 }}>Company</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Plan Tier</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Seats</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>PH Payroll License</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Other Modules</th>
                    <th style={{ padding: '12px 20px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.id} style={{ borderBottom: '1px solid #1f2937' }}>
                      <td style={{ padding: '16px 20px' }}>
                        <div style={{ fontWeight: 600, color: '#f3f4f6' }}>{tenant.name}</div>
                        <div style={{ fontSize: '14.5px', color: '#9ca3af', marginTop: '2px' }}>
                          Code: {tenant.code} · Slug: {tenant.slug}
                        </div>
                      </td>

                      <td style={{ padding: '16px 16px' }}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '14.5px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          backgroundColor:
                            tenant.plan_tier === 'enterprise' ? '#312e81' :
                            tenant.plan_tier === 'professional' ? '#1e3a8a' : '#374151',
                          color:
                            tenant.plan_tier === 'enterprise' ? '#c7d2fe' :
                            tenant.plan_tier === 'professional' ? '#93c5fd' : '#d1d5db',
                        }}>
                          {tenant.plan_tier}
                        </span>
                      </td>

                      <td style={{ padding: '16px 16px' }}>
                        <select
                          value={tenant.status}
                          onChange={(e) => handleStatusChange(tenant.id, e.target.value)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '15px',
                            fontWeight: 500,
                            backgroundColor:
                              tenant.status === 'active' ? 'rgba(16, 185, 129, 0.15)' :
                              tenant.status === 'trial' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color:
                              tenant.status === 'active' ? '#34d399' :
                              tenant.status === 'trial' ? '#facc15' : '#f87171',
                            border: '1px solid #374151',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="active">Active</option>
                          <option value="trial">Trial</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      </td>

                      <td style={{ padding: '16px 16px' }}>
                        <div style={{ color: '#f3f4f6' }}>
                          {tenant.employee_count} / {tenant.max_employees}
                        </div>
                        <div style={{
                          width: '80px',
                          height: '4px',
                          backgroundColor: '#374151',
                          borderRadius: '2px',
                          marginTop: '4px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${Math.min(100, ((tenant.employee_count || 0) / (tenant.max_employees || 1)) * 100)}%`,
                            height: '100%',
                            backgroundColor: '#3b82f6',
                          }} />
                        </div>
                      </td>

                      {/* PH Payroll Toggle Badge */}
                      <td style={{ padding: '16px 16px' }}>
                        {tenant.features?.feature_ph_payroll ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '14.5px',
                            fontWeight: 600,
                            backgroundColor: 'rgba(37, 99, 235, 0.2)',
                            color: '#60a5fa',
                            border: '1px solid rgba(59, 130, 246, 0.4)',
                          }}>
                            ✓ ACTIVATED (PH RA 10963)
                          </span>
                        ) : (
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '14.5px',
                            fontWeight: 500,
                            backgroundColor: '#1f2937',
                            color: '#9ca3af',
                          }}>
                            Inactive / Not Licensed
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '16px 16px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {tenant.features?.feature_performance && (
                            <span style={{ fontSize: '15px', padding: '2px 6px', backgroundColor: '#1e293b', borderRadius: '3px', color: '#94a3b8' }}>Performance</span>
                          )}
                          {tenant.features?.feature_time_attendance && (
                            <span style={{ fontSize: '15px', padding: '2px 6px', backgroundColor: '#1e293b', borderRadius: '3px', color: '#94a3b8' }}>Attendance</span>
                          )}
                          {tenant.features?.feature_leave_management && (
                            <span style={{ fontSize: '15px', padding: '2px 6px', backgroundColor: '#1e293b', borderRadius: '3px', color: '#94a3b8' }}>Leaves</span>
                          )}
                        </div>
                      </td>

                      <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button
                            onClick={() => setActiveTenant(tenant)}
                            style={{
                              padding: '5px 10px',
                              backgroundColor: '#2563eb',
                              border: 'none',
                              borderRadius: '4px',
                              color: '#ffffff',
                              fontSize: '15px',
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            Manage Modules
                          </button>
                          <button
                            onClick={() => handleImpersonate(tenant.id)}
                            title="Audit / Impersonate tenant admin session"
                            style={{
                              padding: '5px 10px',
                              backgroundColor: '#1f2937',
                              border: '1px solid #374151',
                              borderRadius: '4px',
                              color: '#d1d5db',
                              fontSize: '15px',
                              cursor: 'pointer',
                            }}
                          >
                            Impersonate
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Feature Management Drawer / Modal */}
      {activeTenant && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          zIndex: 50,
        }}>
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '620px',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '28px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                  Manage Modules & Licenses
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '14.5px', color: '#9ca3af' }}>
                  Client: <strong style={{ color: '#e5e7eb' }}>{activeTenant.name}</strong> ({activeTenant.slug})
                </p>
              </div>
              <button
                onClick={() => setActiveTenant(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  fontSize: '20px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{
              padding: '16px',
              backgroundColor: '#1e1b4b',
              border: '1px solid #3730a3',
              borderRadius: '6px',
              marginBottom: '24px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#e0e7ff' }}>
                      🇵🇭 Philippine Payroll System
                    </span>
                    <span style={{
                      fontSize: '14.5px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: '#4338ca',
                      color: '#ffffff',
                      fontWeight: 600,
                    }}>
                      PREMIUM MODULE
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0 0', fontSize: '15px', color: '#c7d2fe', lineHeight: 1.4 }}>
                    Automated TRAIN tax calculation, SSS + WISP, PhilHealth (5%), Pag-IBIG HDMF, 13th month accrual, and multi-branch payroll runs.
                  </p>
                </div>
                <div>
                  <button
                    disabled={savingFeatures}
                    onClick={() => handleToggleFeature('feature_ph_payroll', activeTenant.features?.feature_ph_payroll)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: 'none',
                      fontWeight: 600,
                      fontSize: '14.5px',
                      cursor: savingFeatures ? 'not-allowed' : 'pointer',
                      backgroundColor: activeTenant.features?.feature_ph_payroll ? '#10b981' : '#374151',
                      color: '#ffffff',
                    }}
                  >
                    {activeTenant.features?.feature_ph_payroll ? 'Active (Licensed)' : 'Enable Feature'}
                  </button>
                </div>
              </div>
            </div>

            <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#9ca3af', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Standard & Add-on HR Modules
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { key: 'feature_core_hr', label: 'Core HR & 201 Directory', desc: 'Employee records, position hierarchy, departments' },
                { key: 'feature_performance', label: 'Performance Management & Reviews', desc: 'Performance appraisal cycles, scoring matrices, self-evaluations' },
                { key: 'feature_kpis', label: 'KPI Library & Goal Tracking', desc: 'Target vs actual progress, department weightings' },
                { key: 'feature_peer_reviews', label: 'Peer & 360° Feedback', desc: 'Multi-rater evaluations and peer praise' },
                { key: 'feature_competencies_pip', label: 'Competencies & PIPs', desc: 'Performance improvement plans and competency framework' },
                { key: 'feature_time_attendance', label: 'Time & Attendance Module', desc: 'Shift scheduling, overtime, tardiness, biometric clock logs' },
                { key: 'feature_leave_management', label: 'Statutory & Discretionary Leaves', desc: 'VL, SL, Maternity, Paternity, Solo Parent leave balances' },
                { key: 'feature_bank_disbursement', label: 'Bank Disbursement Files', desc: 'Export formatted disbursement files for BPI, BDO, Metrobank' },
                { key: 'feature_bir_statutory_gen', label: 'BIR 2316 & Statutory Exports', desc: 'Annualized tax return and SSS/PhilHealth monthly transmittals' },
              ].map((mod) => {
                const isEnabled = (activeTenant.features as any)?.[mod.key] ?? false;
                return (
                  <div
                    key={mod.key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 14px',
                      backgroundColor: '#0f172a',
                      borderRadius: '6px',
                      border: '1px solid #1f2937',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '14.5px', fontWeight: 600, color: '#f3f4f6' }}>{mod.label}</div>
                      <div style={{ fontSize: '15px', color: '#94a3b8' }}>{mod.desc}</div>
                    </div>
                    <button
                      disabled={savingFeatures}
                      onClick={() => handleToggleFeature(mod.key as any, isEnabled)}
                      style={{
                        padding: '5px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        fontSize: '15px',
                        fontWeight: 600,
                        cursor: savingFeatures ? 'not-allowed' : 'pointer',
                        backgroundColor: isEnabled ? '#2563eb' : '#374151',
                        color: isEnabled ? '#ffffff' : '#9ca3af',
                      }}
                    >
                      {isEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '24px', textAlign: 'right' }}>
              <button
                onClick={() => setActiveTenant(null)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#374151',
                  color: '#f9fafb',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14.5px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Modal */}
      {onboardingOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          zIndex: 50,
        }}>
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '640px',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '28px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                  Onboard New Client Organization
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '14.5px', color: '#9ca3af' }}>
                  Provision workspace, database tenant isolation, and client admin credentials.
                </p>
              </div>
              <button
                onClick={() => {
                  setCreateError(null);
                  setOnboardingOpen(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  fontSize: '20px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {createError && (
              <div style={{
                padding: '12px 16px',
                marginBottom: '16px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                borderRadius: '6px',
                color: '#f87171',
                fontSize: '14.5px',
                lineHeight: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateTenant} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 500, color: '#d1d5db', marginBottom: '4px' }}>
                    Company / Organization Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Acme Corporation PH"
                    value={newOrg.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                      const code = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
                      setNewOrg((prev) => ({ ...prev, name, slug, code }));
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: '#0a0f1d',
                      border: '1px solid #374151',
                      borderRadius: '6px',
                      color: '#f9fafb',
                      fontSize: '14.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 500, color: '#d1d5db', marginBottom: '4px' }}>
                    Org Code * (Max 10 chars)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ACM"
                    maxLength={10}
                    value={newOrg.code}
                    onChange={(e) => {
                      const code = e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 10);
                      setNewOrg((prev) => ({ ...prev, code }));
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: '#0a0f1d',
                      border: '1px solid #374151',
                      borderRadius: '6px',
                      color: '#f9fafb',
                      fontSize: '14.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 500, color: '#d1d5db', marginBottom: '4px' }}>
                    Workspace URL Slug *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="acme-ph"
                    value={newOrg.slug}
                    onChange={(e) => setNewOrg((prev) => ({ ...prev, slug: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: '#0a0f1d',
                      border: '1px solid #374151',
                      borderRadius: '6px',
                      color: '#f9fafb',
                      fontSize: '14.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 500, color: '#d1d5db', marginBottom: '4px' }}>
                    Plan Tier
                  </label>
                  <select
                    value={newOrg.planTier}
                    onChange={(e) => setNewOrg((prev) => ({ ...prev, planTier: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: '#0a0f1d',
                      border: '1px solid #374151',
                      borderRadius: '6px',
                      color: '#f9fafb',
                      fontSize: '14.5px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 500, color: '#d1d5db', marginBottom: '4px' }}>
                    Max Seats / Employees
                  </label>
                  <input
                    type="number"
                    min={5}
                    value={newOrg.maxEmployees}
                    onChange={(e) => setNewOrg((prev) => ({ ...prev, maxEmployees: Number(e.target.value) }))}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: '#0a0f1d',
                      border: '1px solid #374151',
                      borderRadius: '6px',
                      color: '#f9fafb',
                      fontSize: '14.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Initial Admin Account */}
              <div style={{
                marginTop: '8px',
                padding: '16px',
                backgroundColor: '#0b1120',
                border: '1px solid #1e293b',
                borderRadius: '6px',
              }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14.5px', fontWeight: 600, color: '#93c5fd' }}>
                  Initial Organization Administrator Account
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '15px', color: '#cbd5e1', marginBottom: '4px' }}>
                      Admin First Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Juan"
                      value={newOrg.adminFirstName}
                      onChange={(e) => setNewOrg((prev) => ({ ...prev, adminFirstName: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: '#0a0f1d',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        color: '#f9fafb',
                        fontSize: '14.5px',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '15px', color: '#cbd5e1', marginBottom: '4px' }}>
                      Admin Last Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Dela Cruz"
                      value={newOrg.adminLastName}
                      onChange={(e) => setNewOrg((prev) => ({ ...prev, adminLastName: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: '#0a0f1d',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        color: '#f9fafb',
                        fontSize: '14.5px',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '15px', color: '#cbd5e1', marginBottom: '4px' }}>
                      Work Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="admin@acme.ph"
                      value={newOrg.adminEmail}
                      onChange={(e) => setNewOrg((prev) => ({ ...prev, adminEmail: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: '#0a0f1d',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        color: '#f9fafb',
                        fontSize: '14.5px',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '15px', color: '#cbd5e1', marginBottom: '4px' }}>
                      Temporary Password *
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="Min 8 characters"
                      value={newOrg.adminPassword}
                      onChange={(e) => setNewOrg((prev) => ({ ...prev, adminPassword: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: '#0a0f1d',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        color: '#f9fafb',
                        fontSize: '14.5px',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Initial Feature Checkboxes */}
              <div>
                <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>
                  License Modules to Provision:
                </label>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  backgroundColor: '#1e1b4b',
                  borderRadius: '6px',
                  border: '1px solid #3730a3',
                  marginBottom: '8px',
                }}>
                  <input
                    type="checkbox"
                    id="feat_ph_payroll"
                    checked={newOrg.features.featurePhPayroll}
                    onChange={(e) => setNewOrg((prev) => ({
                      ...prev,
                      features: { ...prev.features, featurePhPayroll: e.target.checked },
                    }))}
                  />
                  <label htmlFor="feat_ph_payroll" style={{ fontSize: '14.5px', fontWeight: 600, color: '#e0e7ff', cursor: 'pointer' }}>
                    🇵🇭 Philippine Payroll Module (RA 10963, SSS, PhilHealth, Pag-IBIG)
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '15px', color: '#94a3b8' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newOrg.features.featureTimeAttendance}
                      onChange={(e) => setNewOrg((prev) => ({
                        ...prev,
                        features: { ...prev.features, featureTimeAttendance: e.target.checked },
                      }))}
                    />
                    Time & Attendance
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newOrg.features.featureLeaveManagement}
                      onChange={(e) => setNewOrg((prev) => ({
                        ...prev,
                        features: { ...prev.features, featureLeaveManagement: e.target.checked },
                      }))}
                    />
                    Statutory Leave Management
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newOrg.features.featurePerformance}
                      onChange={(e) => setNewOrg((prev) => ({
                        ...prev,
                        features: { ...prev.features, featurePerformance: e.target.checked },
                      }))}
                    />
                    Performance Appraisals
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newOrg.features.featureKpis}
                      onChange={(e) => setNewOrg((prev) => ({
                        ...prev,
                        features: { ...prev.features, featureKpis: e.target.checked },
                      }))}
                    />
                    KPI & Goal Library
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setCreateError(null);
                    setOnboardingOpen(false);
                  }}
                  style={{
                    padding: '9px 18px',
                    backgroundColor: '#1f2937',
                    color: '#d1d5db',
                    border: '1px solid #374151',
                    borderRadius: '6px',
                    fontSize: '14.5px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingTenant}
                  style={{
                    padding: '9px 20px',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14.5px',
                    fontWeight: 600,
                    cursor: creatingTenant ? 'not-allowed' : 'pointer',
                    opacity: creatingTenant ? 0.7 : 1,
                  }}
                >
                  {creatingTenant ? 'Provisioning Tenant…' : 'Provision & Activate Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
