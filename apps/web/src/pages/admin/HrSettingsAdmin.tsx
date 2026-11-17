import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { Card } from '../../components/ds';

export interface HrSettings {
  id: string;
  org_id: string;
  company_registered_name: string | null;
  company_trade_name: string | null;
  tin: string | null;
  rdo_code: string | null;
  sss_employer_no: string | null;
  philhealth_employer_no: string | null;
  pagibig_employer_no: string | null;
  sec_dti_reg_no: string | null;
  official_business_address: string | null;
  contact_number: string | null;
  official_hr_email: string | null;
  standard_working_days_per_week: string | number;
  standard_hours_per_day: string | number;
  probationary_months: number;
  retirement_age: number;
  required_201_documents: string[];
  default_shift_code: string;
  grace_period_mins: number;
  tardiness_monthly_threshold: number;
  overtime_approval_required: boolean;
  enable_kiosk_camera: boolean;
  require_kiosk_passcode: boolean;
  allow_mobile_attendance: boolean;
  pay_frequency: string;
  cutoff_1_start: number;
  cutoff_1_end: number;
  cutoff_2_start: number;
  cutoff_2_end: number;
  payout_day_quindena_1: number;
  payout_day_quindena_2: number;
  train_tax_active: boolean;
  sss_wisp_active: boolean;
  thirteenth_month_tax_exempt_ceiling: string | number;
  service_charge_enabled: boolean;
  service_charge_staff_share_pct: string | number;
  default_currency: string;
}

export default function HrSettingsAdmin() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<'company' | 'attendance' | 'payroll' | 'workforce'>('company');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin-hr-settings'],
    queryFn: () => api<HrSettings>('/admin/settings'),
  });

  const [form, setForm] = useState<Partial<HrSettings>>({});

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<HrSettings>) =>
      api<HrSettings>('/admin/settings', {
        method: 'PUT',
        body: payload,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin-hr-settings'], updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    },
  });

  if (isLoading || !settings) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>Loading HR system settings…</div>;
  }

  const handleTextChange = (key: keyof HrSettings, val: any) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleToggleDoc = (doc: string) => {
    const current = (form.required_201_documents || []) as string[];
    const exists = current.includes(doc);
    const updated = exists ? current.filter((d) => d !== doc) : [...current, doc];
    setForm((prev) => ({ ...prev, required_201_documents: updated }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(form);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Category Pills Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div className="seg" style={{ margin: 0 }}>
          <label className="seg-opt">
            <input
              type="radio"
              name="settings-cat"
              checked={activeCategory === 'company'}
              onChange={() => setActiveCategory('company')}
            />
            <span>🏢 Company & Statutory IDs</span>
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name="settings-cat"
              checked={activeCategory === 'workforce'}
              onChange={() => setActiveCategory('workforce')}
            />
            <span>👥 Workforce & 201 Checklist</span>
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name="settings-cat"
              checked={activeCategory === 'attendance'}
              onChange={() => setActiveCategory('attendance')}
            />
            <span>⏰ Time, Shifts & Biometrics</span>
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name="settings-cat"
              checked={activeCategory === 'payroll'}
              onChange={() => setActiveCategory('payroll')}
            />
            <span>💰 Payroll, Tax & Cutoffs</span>
          </label>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={updateMutation.isPending}
          style={{ minWidth: '130px' }}
        >
          {updateMutation.isPending ? 'Saving...' : '💾 Save Changes'}
        </button>
      </div>

      {saveSuccess && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '8px',
          backgroundColor: 'rgba(34, 197, 94, 0.15)',
          border: '1px solid #22c55e',
          color: '#4ade80',
          fontSize: '14.5px',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span>✓</span> HR settings and compliance policies have been updated successfully.
        </div>
      )}

      {/* 1. Company Profile & Statutory IDs */}
      {activeCategory === 'company' && (
        <Card title="Company Profile & Government Statutory Registrations">
          <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginBottom: '20px' }}>
            Official registered identifiers used across Philippine BIR tax reporting, SSS, PhilHealth, Pag-IBIG remittances, and payslip headers.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                Official Registered Name
              </label>
              <input
                className="input"
                style={{ width: '100%' }}
                value={form.company_registered_name || ''}
                onChange={(e) => handleTextChange('company_registered_name', e.target.value)}
                placeholder="e.g. Apex Logistics Solutions Inc."
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                Trade Name / DBA
              </label>
              <input
                className="input"
                style={{ width: '100%' }}
                value={form.company_trade_name || ''}
                onChange={(e) => handleTextChange('company_trade_name', e.target.value)}
                placeholder="e.g. Apex Logistics"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                BIR Tax Identification Number (TIN)
              </label>
              <input
                className="input"
                style={{ width: '100%' }}
                value={form.tin || ''}
                onChange={(e) => handleTextChange('tin', e.target.value)}
                placeholder="000-000-000-000"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                Revenue District Office (RDO Code)
              </label>
              <input
                className="input"
                style={{ width: '100%' }}
                value={form.rdo_code || ''}
                onChange={(e) => handleTextChange('rdo_code', e.target.value)}
                placeholder="e.g. 044 - Taguig City"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                SSS Employer Registration No.
              </label>
              <input
                className="input"
                style={{ width: '100%' }}
                value={form.sss_employer_no || ''}
                onChange={(e) => handleTextChange('sss_employer_no', e.target.value)}
                placeholder="03-0000000-0"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                PhilHealth Employer No. (PEN)
              </label>
              <input
                className="input"
                style={{ width: '100%' }}
                value={form.philhealth_employer_no || ''}
                onChange={(e) => handleTextChange('philhealth_employer_no', e.target.value)}
                placeholder="12-000000000-0"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                Pag-IBIG / HDMF Employer ID
              </label>
              <input
                className="input"
                style={{ width: '100%' }}
                value={form.pagibig_employer_no || ''}
                onChange={(e) => handleTextChange('pagibig_employer_no', e.target.value)}
                placeholder="1234-0000-0000"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                SEC / DTI Registration No.
              </label>
              <input
                className="input"
                style={{ width: '100%' }}
                value={form.sec_dti_reg_no || ''}
                onChange={(e) => handleTextChange('sec_dti_reg_no', e.target.value)}
                placeholder="CS202612345"
              />
            </div>
          </div>

          <div style={{ marginTop: '16px' }}>
            <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
              Official Business / Head Office Address
            </label>
            <textarea
              className="input"
              rows={2}
              style={{ width: '100%', resize: 'vertical' }}
              value={form.official_business_address || ''}
              onChange={(e) => handleTextChange('official_business_address', e.target.value)}
              placeholder="Unit, Building, Street, Barangay, City, Province, Zip Code"
            />
          </div>
        </Card>
      )}

      {/* 2. Workforce Governance & 201 Checklist */}
      {activeCategory === 'workforce' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Card title="Labor Standards & Employment Rules (DOLE Compliance)">
            <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginBottom: '20px' }}>
              Governs baseline working hours, probationary durations, and retirement requirements according to the Philippine Labor Code.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                  Standard Working Days / Week
                </label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={form.standard_working_days_per_week || 5.0}
                  onChange={(e) => handleTextChange('standard_working_days_per_week', parseFloat(e.target.value))}
                >
                  <option value={5.0}>5 Days / Week (Monday – Friday standard)</option>
                  <option value={6.0}>6 Days / Week (Monday – Saturday / Compressed)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                  Standard Working Hours / Day
                </label>
                <input
                  type="number"
                  step="0.5"
                  className="input"
                  style={{ width: '100%' }}
                  value={form.standard_hours_per_day || 8.0}
                  onChange={(e) => handleTextChange('standard_hours_per_day', parseFloat(e.target.value))}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                  Probationary Period Limit
                </label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={form.probationary_months || 6}
                  onChange={(e) => handleTextChange('probationary_months', parseInt(e.target.value, 10))}
                >
                  <option value={3}>3 Months (Accelerated Regularization)</option>
                  <option value={6}>6 Months (DOLE Article 296 Standard)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                  Compulsory Retirement Age
                </label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%' }}
                  value={form.retirement_age || 65}
                  onChange={(e) => handleTextChange('retirement_age', parseInt(e.target.value, 10))}
                />
              </div>
            </div>
          </Card>

          <Card title="Mandatory 201 Personnel Document Checklist">
            <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginBottom: '16px' }}>
              Select documents required for new employee onboarding compliance. These items are tracked in each employee’s 201 digital personnel vault.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
              {[
                'NBI Clearance',
                'Pre-employment Medical (Fit-to-Work)',
                'BIR Form 1902 / 2316',
                'SSS / PhilHealth / Pag-IBIG Numbers Proof',
                'Employment Contract',
                'Transcript of Records (TOR) or Diploma',
                'Government Issued IDs',
                'Barangay Clearance',
                'Drug Test Result',
                'Previous Certificate of Employment (COE)',
              ].map((doc) => {
                const checked = (form.required_201_documents || []).includes(doc);
                return (
                  <label
                    key={doc}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 14px',
                      backgroundColor: checked ? 'rgba(59, 130, 246, 0.1)' : 'var(--color-surface)',
                      border: checked ? '1px solid #3b82f6' : '1px solid var(--color-border)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '14.5px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleDoc(doc)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontWeight: checked ? 600 : 400 }}>{doc}</span>
                  </label>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* 3. Time, Shifts & Biometrics */}
      {activeCategory === 'attendance' && (
        <Card title="Time, Shifts, Tardiness & Biometric Kiosk Policies">
          <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginBottom: '20px' }}>
            Configure attendance thresholds, grace periods before tardiness penalties, and biometric hardware tablet behaviors.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                Default Assigned Shift
              </label>
              <select
                className="input"
                style={{ width: '100%' }}
                value={form.default_shift_code || 'DAY'}
                onChange={(e) => handleTextChange('default_shift_code', e.target.value)}
              >
                <option value="DAY">Standard Day Shift (08:00 – 17:00)</option>
                <option value="MID">Mid Shift (13:00 – 22:00)</option>
                <option value="NIGHT">Graveyard Night Shift (22:00 – 06:00)</option>
                <option value="BROKEN">Split / Broken Shift (10:00-14:00 & 17:00-21:00)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                Grace Period Before Tardy (Minutes)
              </label>
              <input
                type="number"
                className="input"
                style={{ width: '100%' }}
                value={form.grace_period_mins || 15}
                onChange={(e) => handleTextChange('grace_period_mins', parseInt(e.target.value, 10))}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                Monthly Tardiness Disciplinary Threshold
              </label>
              <input
                type="number"
                className="input"
                style={{ width: '100%' }}
                value={form.tardiness_monthly_threshold || 3}
                onChange={(e) => handleTextChange('tardiness_monthly_threshold', parseInt(e.target.value, 10))}
              />
              <span style={{ fontSize: '14.5px', color: 'var(--color-muted)', display: 'block', marginTop: '4px' }}>
                Triggers automatic Notice to Explain (NTE) memo after this many occurrences per month.
              </span>
            </div>
          </div>

          <div style={{ marginTop: '24px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px 0' }}>Biometrics & Mobile Punch Security</h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.enable_kiosk_camera ?? true}
                  onChange={(e) => handleTextChange('enable_kiosk_camera', e.target.checked)}
                />
                <span><strong>Enable Camera Snapshot Verification:</strong> Takes an instant photo upon biometric keypad punch to prevent buddy punching.</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.require_kiosk_passcode ?? true}
                  onChange={(e) => handleTextChange('require_kiosk_passcode', e.target.checked)}
                />
                <span><strong>Require 4–6 Digit Passcode on Tablet:</strong> Requires enrolled employee security PIN in addition to Employee ID.</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.allow_mobile_attendance ?? true}
                  onChange={(e) => handleTextChange('allow_mobile_attendance', e.target.checked)}
                />
                <span><strong>Allow Mobile / Remote Web Clock-in:</strong> Permits field and remote personnel to log attendance via browser.</span>
              </label>
            </div>
          </div>
        </Card>
      )}

      {/* 4. Payroll, Tax & Cutoffs */}
      {activeCategory === 'payroll' && (
        <Card title="Payroll Cut-off Schedules & Philippine Statutory Engines">
          <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginBottom: '20px' }}>
            Defines quindena cut-off dates, payout release dates, TRAIN Law tax configurations, and service charge distribution rules.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                Pay Frequency
              </label>
              <select
                className="input"
                style={{ width: '100%' }}
                value={form.pay_frequency || 'semi_monthly'}
                onChange={(e) => handleTextChange('pay_frequency', e.target.value)}
              >
                <option value="semi_monthly">Semi-Monthly (Standard Philippine Quindena)</option>
                <option value="monthly">Monthly Payout</option>
                <option value="weekly">Weekly Payout</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                1st Quindena Cut-off Period
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '15px', color: 'var(--color-muted)' }}>Day</span>
                <input
                  type="number"
                  className="input"
                  style={{ width: '70px' }}
                  value={form.cutoff_1_start || 1}
                  onChange={(e) => handleTextChange('cutoff_1_start', parseInt(e.target.value, 10))}
                />
                <span style={{ fontSize: '15px', color: 'var(--color-muted)' }}>to</span>
                <input
                  type="number"
                  className="input"
                  style={{ width: '70px' }}
                  value={form.cutoff_1_end || 15}
                  onChange={(e) => handleTextChange('cutoff_1_end', parseInt(e.target.value, 10))}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                2nd Quindena Cut-off Period
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '15px', color: 'var(--color-muted)' }}>Day</span>
                <input
                  type="number"
                  className="input"
                  style={{ width: '70px' }}
                  value={form.cutoff_2_start || 16}
                  onChange={(e) => handleTextChange('cutoff_2_start', parseInt(e.target.value, 10))}
                />
                <span style={{ fontSize: '15px', color: 'var(--color-muted)' }}>to End of Month</span>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                13th Month Tax-Exempt Ceiling (TRAIN Law)
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '10px', top: '8px', color: 'var(--color-muted)' }}>₱</span>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%', paddingLeft: '26px' }}
                  value={form.thirteenth_month_tax_exempt_ceiling || 90000}
                  onChange={(e) => handleTextChange('thirteenth_month_tax_exempt_ceiling', parseFloat(e.target.value))}
                />
              </div>
              <span style={{ fontSize: '14.5px', color: 'var(--color-muted)', display: 'block', marginTop: '4px' }}>
                Statutory DOLE & BIR de minimis and 13th month exemption cap (₱90,000).
              </span>
            </div>
          </div>

          <div style={{ marginTop: '24px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px 0' }}>Statutory Calculation Modules & Service Charge</h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.train_tax_active ?? true}
                  onChange={(e) => handleTextChange('train_tax_active', e.target.checked)}
                />
                <span><strong>RA 10963 (TRAIN Law) Withholding Tax Engine:</strong> Automatically computes graduated withholding tax brackets on payroll runs.</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.sss_wisp_active ?? true}
                  onChange={(e) => handleTextChange('sss_wisp_active', e.target.checked)}
                />
                <span><strong>SSS Worker’s Investment and Savings Program (WISP):</strong> Computes mandatory provident fund contributions for salary credits above ₱20,000.</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.service_charge_enabled ?? false}
                  onChange={(e) => handleTextChange('service_charge_enabled', e.target.checked)}
                />
                <span><strong>RA 11360 Hospitality Service Charge Pool:</strong> Distributes monthly guest service charge equally to eligible non-managerial staff.</span>
              </label>

              {form.service_charge_enabled && (
                <div style={{ marginLeft: '26px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ fontSize: '15px', fontWeight: 600 }}>Staff Share Percentage:</label>
                  <input
                    type="number"
                    step="1"
                    className="input"
                    style={{ width: '80px' }}
                    value={form.service_charge_staff_share_pct || 85}
                    onChange={(e) => handleTextChange('service_charge_staff_share_pct', parseFloat(e.target.value))}
                  />
                  <span style={{ fontSize: '15px', color: 'var(--color-muted)' }}>% (Statutory 85% minimum per RA 11360)</span>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
