import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import type { Employee } from '../../types';
import { Card, Tag } from '../../components/ds';

interface AttendanceRecord {
  id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_hours_worked: string;
  regular_hours: string;
  regular_ot_hours: string;
  rest_day_ot_hours: string;
  holiday_ot_hours: string;
  night_diff_hours: string;
  tardiness_minutes: number;
  undertime_minutes: number;
  status: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  shiftName: string | null;
  punch_source?: string;
  is_half_day?: boolean;
}

interface Shift {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_period_mins: number;
  is_broken_shift?: boolean;
  second_start_time?: string;
  second_end_time?: string;
}

interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  holiday_type: string;
  branch_name: string | null;
}

interface TerminalCredential {
  id: string;
  employee_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  department_name?: string;
  is_enrolled: boolean;
  last_punch_at?: string | null;
}

interface ShiftSwap {
  id: string;
  requestor_id: string;
  requestor_name: string;
  target_employee_id: string;
  target_name: string;
  swap_date: string;
  status: string;
  reason?: string;
}

interface DisciplinaryMemo {
  id: string;
  memo_number: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  memo_type: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
}

interface BusinessTrip {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  destination: string;
  purpose: string;
  start_date: string;
  end_date: string;
  per_diem_daily?: string;
  status: string;
}

interface MealVoucher {
  id: string;
  voucher_number: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  meal_type: string;
  valid_date: string;
  is_redeemed: boolean;
  redeemed_at?: string;
}

type TabType =
  | 'dtr'
  | 'roster'
  | 'adjustments'
  | 'kiosk-enrollment'
  | 'shifts'
  | 'swaps'
  | 'tardiness-memos'
  | 'ob-trips'
  | 'meal-vouchers'
  | 'holidays';

export default function AttendanceDashboard() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const [activeTab, setActiveTab] = useState<TabType>('dtr');

  // Enrollment modal state
  const [enrollModalEmployee, setEnrollModalEmployee] = useState<TerminalCredential | null>(null);
  const [enrollPin, setEnrollPin] = useState('');
  const [enrollSuccessMsg, setEnrollSuccessMsg] = useState<string | null>(null);

  // Notice to Explain (NTE) memo modal state
  const [memoModalEmployee, setMemoModalEmployee] = useState<any | null>(null);
  const [memoSubject, setMemoSubject] = useState('');
  const [memoBody, setMemoBody] = useState('');

  // Business Trip Modal state
  const [showTripModal, setShowTripModal] = useState(false);
  const [tripForm, setTripForm] = useState({
    destination: '',
    purpose: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    perDiemDaily: '500.00',
  });

  // Meal Voucher Modal state
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [voucherForm, setVoucherForm] = useState({
    mealType: 'duty_meal',
    validDate: new Date().toISOString().slice(0, 10),
    count: 1,
  });

  // Holiday Modal state
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [holidayForm, setHolidayForm] = useState({
    name: '',
    holidayDate: new Date().toISOString().slice(0, 10),
    holidayType: 'regular_holiday',
  });

  // Manual DTR Modal state
  const [showManualDtrModal, setShowManualDtrModal] = useState(false);
  const [manualDtrForm, setManualDtrForm] = useState({
    employeeId: '',
    workDate: new Date().toISOString().slice(0, 10),
    clockIn: '08:00',
    clockOut: '17:00',
    notes: '',
  });

  // Batch Roster Modal state
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [rosterForm, setRosterForm] = useState({
    employeeIds: [] as string[],
    shiftId: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10),
    notes: '',
  });

  // OT / Timesheet Adjustment Modal state
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [adjForm, setAdjForm] = useState({
    workDate: new Date().toISOString().slice(0, 10),
    adjustmentType: 'overtime',
    requestedClockIn: '08:00',
    requestedClockOut: '19:00',
    reason: '',
  });

  const attendanceEnabled = me.data?.features?.feature_time_attendance ?? false;

  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonthStart = todayStr.slice(0, 8) + '01';

  // 1. Fetch DTR Records
  const recordsQuery = useQuery({
    queryKey: ['attendance-records', currentMonthStart, todayStr],
    queryFn: () =>
      api<AttendanceRecord[]>(
        `/attendance/records?startDate=${currentMonthStart}&endDate=${todayStr}`,
      ),
    enabled: attendanceEnabled,
  });

  // 2. Fetch Shifts
  const shiftsQuery = useQuery({
    queryKey: ['attendance-shifts'],
    queryFn: () => api<Shift[]>('/attendance/shifts'),
    enabled: attendanceEnabled,
  });

  // 3. Fetch Holidays
  const holidaysQuery = useQuery({
    queryKey: ['attendance-holidays'],
    queryFn: () => api<Holiday[]>(`/attendance/holidays?year=${new Date().getFullYear()}`),
    enabled: attendanceEnabled,
  });

  // 4. Fetch Kiosk Terminal Enrollments
  const enrollmentsQuery = useQuery({
    queryKey: ['kiosk-enrollments'],
    queryFn: () => api<TerminalCredential[]>('/attendance/enrollments'),
    enabled: attendanceEnabled && activeTab === 'kiosk-enrollment',
  });

  // 5. Fetch Shift Swaps
  const swapsQuery = useQuery({
    queryKey: ['shift-swaps'],
    queryFn: () => api<ShiftSwap[]>('/attendance/shift-swap'),
    enabled: attendanceEnabled && activeTab === 'swaps',
  });

  // 6. Fetch Tardiness Infractions & Memos
  const infractionsQuery = useQuery({
    queryKey: ['tardiness-infractions'],
    queryFn: () => api<any[]>('/attendance/tardiness-summary'),
    enabled: attendanceEnabled && activeTab === 'tardiness-memos',
  });

  const memosQuery = useQuery({
    queryKey: ['disciplinary-memos'],
    queryFn: () => api<DisciplinaryMemo[]>('/attendance/memos'),
    enabled: attendanceEnabled && activeTab === 'tardiness-memos',
  });

  // 7. Fetch Business Trips
  const tripsQuery = useQuery({
    queryKey: ['business-trips'],
    queryFn: () => api<BusinessTrip[]>('/attendance/business-trips'),
    enabled: attendanceEnabled && activeTab === 'ob-trips',
  });

  // 8. Fetch Meal Vouchers
  const vouchersQuery = useQuery({
    queryKey: ['meal-vouchers'],
    queryFn: () => api<MealVoucher[]>('/attendance/meal-vouchers'),
    enabled: attendanceEnabled && activeTab === 'meal-vouchers',
  });

  // 9. Fetch Employees (for Manual DTR & Batch Roster)
  const employeesQuery = useQuery({
    queryKey: ['attendance-employees'],
    queryFn: () => api<{ id: string; employeeNumber: string; firstName: string; lastName: string }[]>('/employees?limit=200'),
    enabled: attendanceEnabled && (showManualDtrModal || showRosterModal),
  });

  // 10. Fetch Shift Roster
  const rosterEndStr = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const rosterQuery = useQuery({
    queryKey: ['attendance-roster', todayStr, rosterEndStr],
    queryFn: () => api<any[]>(`/attendance/roster?startDate=${todayStr}&endDate=${rosterEndStr}`),
    enabled: attendanceEnabled && activeTab === 'roster',
  });

  // 11. Fetch Timesheet / OT Adjustments
  const adjustmentsQuery = useQuery({
    queryKey: ['attendance-adjustments'],
    queryFn: () => api<any[]>('/attendance/adjustments'),
    enabled: attendanceEnabled && activeTab === 'adjustments',
  });

  const manualDtrMutation = useMutation({
    mutationFn: (data: typeof manualDtrForm) =>
      api('/attendance/records/manual', {
        method: 'POST',
        body: {
          employeeId: data.employeeId,
          workDate: data.workDate,
          clockIn: `${data.workDate}T${data.clockIn}:00`,
          clockOut: `${data.workDate}T${data.clockOut}:00`,
          notes: data.notes,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-records'] });
      setShowManualDtrModal(false);
    },
  });

  const batchRosterMutation = useMutation({
    mutationFn: (data: typeof rosterForm) =>
      api('/attendance/roster/batch', {
        method: 'POST',
        body: { ...data, restDays: [0, 6] },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-roster'] });
      setShowRosterModal(false);
    },
  });

  const requestAdjustmentMutation = useMutation({
    mutationFn: (data: typeof adjForm) =>
      api('/attendance/adjustments', {
        method: 'POST',
        body: {
          workDate: data.workDate,
          adjustmentType: data.adjustmentType,
          requestedClockIn: `${data.workDate}T${data.requestedClockIn}:00`,
          requestedClockOut: `${data.workDate}T${data.requestedClockOut}:00`,
          reason: data.reason,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-adjustments'] });
      setShowAdjModal(false);
    },
  });

  const approveAdjustmentMutation = useMutation({
    mutationFn: (id: string) => api(`/attendance/adjustments/${id}/approve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-records'] });
    },
  });

  // Clock In / Out Mutation
  const clockMutation = useMutation({
    mutationFn: () =>
      api<{ action: string; record: AttendanceRecord }>('/attendance/clock', {
        method: 'POST',
        body: { workDate: todayStr },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-records'] });
    },
  });

  // Enroll Kiosk PIN Mutation
  const enrollMutation = useMutation({
    mutationFn: (data: { employeeId: string; pin: string }) =>
      api('/attendance/enroll-pin', {
        method: 'POST',
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kiosk-enrollments'] });
      setEnrollSuccessMsg('Passcode enrolled successfully!');
      setTimeout(() => {
        setEnrollModalEmployee(null);
        setEnrollPin('');
        setEnrollSuccessMsg(null);
      }, 1500);
    },
  });

  // Issue Disciplinary Memo Mutation
  const issueMemoMutation = useMutation({
    mutationFn: (data: { employeeId: string; subject: string; body: string; totalInfractions?: number }) => {
      const due = new Date();
      due.setDate(due.getDate() + 5);
      return api('/attendance/memos', {
        method: 'POST',
        body: {
          employeeId: data.employeeId,
          memoType: 'notice_to_explain',
          incidentPeriodStart: currentMonthStart,
          incidentPeriodEnd: todayStr,
          totalInfractions: data.totalInfractions ?? 1,
          details: `${data.subject}\n\n${data.body}`,
          responseDueDate: due.toISOString().slice(0, 10),
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disciplinary-memos'] });
      setMemoModalEmployee(null);
      setMemoSubject('');
      setMemoBody('');
    },
  });

  // Apply Business Trip Mutation
  const tripMutation = useMutation({
    mutationFn: (data: typeof tripForm) =>
      api('/attendance/business-trips', {
        method: 'POST',
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-trips'] });
      setShowTripModal(false);
    },
  });

  // Approve Business Trip Mutation
  const approveTripMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/attendance/business-trips/${id}/approve`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['business-trips'] }),
  });

  // Approve DTR Record Mutation
  const approveDtrMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/attendance/records/${id}/approve`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attendance-records'] }),
  });

  // Approve Shift Swap Mutation
  const approveSwapMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/attendance/shift-swap/${id}/approve`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shift-swaps'] }),
  });

  // Create Holiday Mutation
  const createHolidayMutation = useMutation({
    mutationFn: (data: typeof holidayForm) =>
      api('/attendance/holidays', { method: 'POST', body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-holidays'] });
      setShowHolidayModal(false);
      setHolidayForm({
        name: '',
        holidayDate: new Date().toISOString().slice(0, 10),
        holidayType: 'regular_holiday',
      });
    },
  });

  // Issue Meal Voucher Mutation
  const voucherMutation = useMutation({
    mutationFn: (data: typeof voucherForm) =>
      api('/attendance/meal-vouchers', {
        method: 'POST',
        body: {
          employeeId: me.data?.id,
          mealType: data.mealType,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-vouchers'] });
      setShowVoucherModal(false);
    },
  });

  // Redeem Meal Voucher Mutation
  const redeemVoucherMutation = useMutation({
    mutationFn: (voucherCode: string) =>
      api('/attendance/meal-vouchers/redeem', {
        method: 'POST',
        body: { voucherCode },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-vouchers'] });
    },
  });

  if (me.isLoading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>Loading attendance workspace…</div>;
  }

  // Graceful degradation when Time & Attendance is not enabled
  if (!attendanceEnabled) {
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
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>

          <h2 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 8px 0', color: 'var(--color-fg)' }}>
            Time & Attendance Module Not Licensed
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--color-muted)', maxWidth: '520px', margin: '0 auto 24px auto', lineHeight: 1.5 }}>
            Daily time recording (DTR), overtime tracking, night shift differential calculation, and biometric sync are currently inactive for <strong>{me.data?.organization?.name || 'your company'}</strong>.
          </p>
        </Card>
      </div>
    );
  }

  const records = recordsQuery.data || [];
  const todayRecord = records.find((r) => r.work_date === todayStr);
  const isClockedIn = Boolean(todayRecord?.clock_in && !todayRecord?.clock_out);

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '28px',
        flexWrap: 'wrap',
        gap: '16px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>
              Time & Attendance Management
            </h1>
            <Tag tone="accent">DOLE Compliant</Tag>
          </div>
          <p style={{ margin: '6px 0 0 0', fontSize: '14.5px', color: 'var(--color-muted)' }}>
            Biometrics & Kiosk, Rostering, Philippine OT/NSD Premiums, OB Trips, Meal Vouchers & Disciplinary Memos.
          </p>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <a
            href="/kiosk"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              textDecoration: 'none',
              padding: '8px 16px',
              fontWeight: 600,
            }}
          >
            <span>📱</span> Open Biometric Kiosk Station ↗
          </a>

          <button
            className={`btn ${isClockedIn ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => clockMutation.mutate()}
            disabled={clockMutation.isPending}
            style={{ minWidth: '150px' }}
          >
            {clockMutation.isPending
              ? 'Recording...'
              : isClockedIn
              ? 'Clock Out Now'
              : 'Web Clock In'}
          </button>
        </div>
      </div>

      {/* Quick Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <Card>
          <div className="card-kicker">Today's Clock In</div>
          <div style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}>
            {todayRecord?.clock_in ? new Date(todayRecord.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not clocked in'}
          </div>
          <div className="text-muted" style={{ fontSize: '14.5px' }}>Date: {todayStr}</div>
        </Card>

        <Card>
          <div className="card-kicker">Today's Clock Out</div>
          <div style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}>
            {todayRecord?.clock_out ? new Date(todayRecord.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : isClockedIn ? 'In Progress' : '—'}
          </div>
          <div className="text-muted" style={{ fontSize: '14.5px' }}>Status: {todayRecord ? todayRecord.status.toUpperCase() : 'PENDING'}</div>
        </Card>

        <Card>
          <div className="card-kicker">Regular Hours Worked</div>
          <div style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}>
            {todayRecord ? `${todayRecord.regular_hours} hrs` : '0.00 hrs'}
          </div>
          <div className="text-muted" style={{ fontSize: '14.5px' }}>Standard 8-hr cap</div>
        </Card>

        <Card>
          <div className="card-kicker">Overtime / Premium Hours</div>
          <div style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px', color: '#38bdf8' }}>
            {todayRecord ? `${Number(todayRecord.regular_ot_hours) + Number(todayRecord.night_diff_hours)} hrs` : '0.00 hrs'}
          </div>
          <div className="text-muted" style={{ fontSize: '14.5px' }}>+25% OT / +10% NSD</div>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div style={{
        display: 'flex',
        gap: '4px',
        borderBottom: '1px solid var(--color-border)',
        marginBottom: '24px',
        overflowX: 'auto',
      }}>
        {[
          { id: 'dtr', label: 'Daily Time Records (DTR)' },
          { id: 'roster', label: 'Shift Roster' },
          { id: 'adjustments', label: 'OT & Adjustments' },
          { id: 'kiosk-enrollment', label: 'Biometrics & Kiosk Enrollment' },
          { id: 'shifts', label: 'Work Shifts & Schedules' },
          { id: 'swaps', label: 'Shift Swapping & Comp-Off' },
          { id: 'tardiness-memos', label: 'Tardiness & NTE Memos' },
          { id: 'ob-trips', label: 'Official Business (OB) Trips' },
          { id: 'meal-vouchers', label: 'Hotel Meal Vouchers' },
          { id: 'holidays', label: 'Holiday Calendar' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            style={{
              padding: '10px 16px',
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

      {/* Tab 1: DTR Records */}
      {activeTab === 'dtr' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', fontWeight: 600, fontSize: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span>Attendance &amp; Overtime Ledger ({currentMonthStart} to {todayStr})</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '14px', color: 'var(--color-muted)', fontWeight: 400 }}>Auto-calculated per DOLE Omnibus Rules</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowManualDtrModal(true)}>
                + Manual DTR Entry
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  <th style={{ padding: '10px 16px' }}>Date</th>
                  <th style={{ padding: '10px 16px' }}>Employee</th>
                  <th style={{ padding: '10px 16px' }}>Clock In</th>
                  <th style={{ padding: '10px 16px' }}>Clock Out</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right' }}>Total Hrs</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right' }}>Regular OT</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right' }}>Night Diff</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right' }}>Tardy (mins)</th>
                  <th style={{ padding: '10px 16px' }}>Punch Mode</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.length > 0 ? (
                  records.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>{r.work_date}</td>
                      <td style={{ padding: '12px 16px' }}>{r.lastName}, {r.firstName}</td>
                      <td style={{ padding: '12px 16px' }}>
                        {r.clock_in ? new Date(r.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {r.clock_out ? new Date(r.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>{r.total_hours_worked}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: Number(r.regular_ot_hours) > 0 ? '#38bdf8' : 'inherit' }}>
                        {r.regular_ot_hours}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>{r.night_diff_hours}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: r.tardiness_minutes > 0 ? '#f87171' : 'inherit' }}>
                        {r.tardiness_minutes}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: '14.5px', padding: '3px 8px', borderRadius: '4px', backgroundColor: 'var(--color-surface-hover)' }}>
                          {r.punch_source === 'kiosk' ? '📱 Kiosk Terminal' : r.punch_source === 'mobile' ? '📲 Mobile App' : '💻 Web Portal'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <Tag tone={r.status === 'approved' ? 'accent' : 'neutral'}>
                          {r.status.toUpperCase()}
                        </Tag>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        {r.status !== 'approved' && (
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={approveDtrMutation.isPending}
                            onClick={() => approveDtrMutation.mutate(r.id)}
                          >
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-muted)' }}>
                      No attendance records found for this period. Click 'Web Clock In' or punch via Biometric Kiosk.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Shift Roster */}
      {activeTab === 'roster' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Shift Roster Schedule (Next 14 Days)</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Assign work shifts across employees and date ranges with automatic Sat/Sun rest-day mapping.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowRosterModal(true)}>
              + Assign Batch Roster
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  <th style={{ padding: '10px 12px' }}>Date</th>
                  <th style={{ padding: '10px 12px' }}>Employee</th>
                  <th style={{ padding: '10px 12px' }}>Assigned Shift</th>
                  <th style={{ padding: '10px 12px' }}>Schedule</th>
                  <th style={{ padding: '10px 12px' }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {(rosterQuery.data ?? []).length > 0 ? (
                  (rosterQuery.data ?? []).map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{String(r.roster_date).slice(0, 10)}</td>
                      <td style={{ padding: '10px 12px' }}>{r.lastName}, {r.firstName} ({r.employeeNo})</td>
                      <td style={{ padding: '10px 12px' }}>
                        {r.is_rest_day ? <Tag tone="neutral">REST DAY</Tag> : <Tag tone="accent">{r.shiftName || r.shiftCode || 'Assigned'}</Tag>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>{r.is_rest_day ? '—' : `${r.startTime ?? ''} – ${r.endTime ?? ''}`}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--color-muted)' }}>{r.notes || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-muted)' }}>
                      No roster entries scheduled for the next 14 days. Click '+ Assign Batch Roster' to schedule shifts.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: OT & Timesheet Adjustments */}
      {activeTab === 'adjustments' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Overtime Pre-Approval &amp; Timesheet Adjustments</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                File missed-punch corrections or overtime pre-approvals; approved entries update the DTR ledger automatically.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAdjModal(true)}>
              + File OT / Adjustment
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  <th style={{ padding: '10px 12px' }}>Work Date</th>
                  <th style={{ padding: '10px 12px' }}>Employee</th>
                  <th style={{ padding: '10px 12px' }}>Type</th>
                  <th style={{ padding: '10px 12px' }}>Requested Window</th>
                  <th style={{ padding: '10px 12px' }}>Reason</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {(adjustmentsQuery.data ?? []).length > 0 ? (
                  (adjustmentsQuery.data ?? []).map((a) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{String(a.work_date).slice(0, 10)}</td>
                      <td style={{ padding: '10px 12px' }}>{a.employeeName || `${a.last_name ?? ''}, ${a.first_name ?? ''}`}</td>
                      <td style={{ padding: '10px 12px', textTransform: 'capitalize' }}>{String(a.adjustment_type || 'overtime').replace(/_/g, ' ')}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {a.requested_clock_in ? new Date(a.requested_clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                        {' – '}
                        {a.requested_clock_out ? new Date(a.requested_clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--color-muted)' }}>{a.reason}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <Tag tone={a.status === 'approved' ? 'accent' : 'neutral'}>{String(a.status).toUpperCase()}</Tag>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {a.status === 'pending' && (
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={approveAdjustmentMutation.isPending}
                            onClick={() => approveAdjustmentMutation.mutate(a.id)}
                          >
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-muted)' }}>
                      No overtime or timesheet adjustment requests filed.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals for Manual DTR, Batch Roster, and OT Adjustment */}
      {showManualDtrModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '460px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>Manual DTR Entry</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Employee</label>
                <select value={manualDtrForm.employeeId} onChange={(e) => setManualDtrForm({ ...manualDtrForm, employeeId: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}>
                  <option value="">Select employee...</option>
                  {(employeesQuery.data ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.lastName}, {emp.firstName} ({emp.employeeNumber})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Work Date</label>
                <input type="date" value={manualDtrForm.workDate} onChange={(e) => setManualDtrForm({ ...manualDtrForm, workDate: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Clock In</label>
                  <input type="time" value={manualDtrForm.clockIn} onChange={(e) => setManualDtrForm({ ...manualDtrForm, clockIn: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Clock Out</label>
                  <input type="time" value={manualDtrForm.clockOut} onChange={(e) => setManualDtrForm({ ...manualDtrForm, clockOut: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Notes</label>
                <input type="text" value={manualDtrForm.notes} onChange={(e) => setManualDtrForm({ ...manualDtrForm, notes: e.target.value })} placeholder="Optional remarks"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button className="btn btn-ghost" onClick={() => setShowManualDtrModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!manualDtrForm.employeeId || manualDtrMutation.isPending} onClick={() => manualDtrMutation.mutate(manualDtrForm)}>
                {manualDtrMutation.isPending ? 'Saving...' : 'Save DTR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRosterModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '500px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>Assign Batch Shift Roster</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Work Shift</label>
                <select value={rosterForm.shiftId} onChange={(e) => setRosterForm({ ...rosterForm, shiftId: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}>
                  <option value="">Select shift...</option>
                  {(shiftsQuery.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Start Date</label>
                  <input type="date" value={rosterForm.startDate} onChange={(e) => setRosterForm({ ...rosterForm, startDate: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>End Date</label>
                  <input type="date" value={rosterForm.endDate} onChange={(e) => setRosterForm({ ...rosterForm, endDate: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Employees ({rosterForm.employeeIds.length} selected)</label>
                <select multiple size={6} value={rosterForm.employeeIds}
                  onChange={(e) => setRosterForm({ ...rosterForm, employeeIds: Array.from(e.target.selectedOptions, (o) => o.value) })}
                  style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}>
                  {(employeesQuery.data ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.lastName}, {emp.firstName} ({emp.employeeNumber})</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button className="btn btn-ghost" onClick={() => setShowRosterModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!rosterForm.shiftId || rosterForm.employeeIds.length === 0 || batchRosterMutation.isPending}
                onClick={() => batchRosterMutation.mutate(rosterForm)}>
                {batchRosterMutation.isPending ? 'Assigning...' : 'Assign Roster'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdjModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '460px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>File OT / Timesheet Adjustment</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Type</label>
                <select value={adjForm.adjustmentType} onChange={(e) => setAdjForm({ ...adjForm, adjustmentType: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}>
                  <option value="overtime">Overtime Pre-Approval / Claim</option>
                  <option value="missed_punch">Missed Clock-In / Clock-Out</option>
                  <option value="time_correction">Time Correction</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Work Date</label>
                <input type="date" value={adjForm.workDate} onChange={(e) => setAdjForm({ ...adjForm, workDate: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Requested In</label>
                  <input type="time" value={adjForm.requestedClockIn} onChange={(e) => setAdjForm({ ...adjForm, requestedClockIn: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Requested Out</label>
                  <input type="time" value={adjForm.requestedClockOut} onChange={(e) => setAdjForm({ ...adjForm, requestedClockOut: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Reason</label>
                <input type="text" value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })} placeholder="Reason for OT or correction"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button className="btn btn-ghost" onClick={() => setShowAdjModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!adjForm.reason.trim() || requestAdjustmentMutation.isPending}
                onClick={() => requestAdjustmentMutation.mutate(adjForm)}>
                {requestAdjustmentMutation.isPending ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Kiosk & Biometrics Enrollment */}
      {activeTab === 'kiosk-enrollment' && (
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Employee Kiosk Terminal Enrollment</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                HR managers enroll 4-6 digit passcodes for biometric / tablet punch kiosks. Default PIN for seeded accounts: <strong>1234</strong>.
              </p>
            </div>
            <a
              href="/kiosk"
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
              style={{ textDecoration: 'none', fontSize: '14.5px' }}
            >
              Test Kiosk Interface ↗
            </a>
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
                  <th style={{ padding: '12px 16px' }}>Employee No</th>
                  <th style={{ padding: '12px 16px' }}>Employee Name</th>
                  <th style={{ padding: '12px 16px' }}>Department</th>
                  <th style={{ padding: '12px 16px' }}>Enrollment Status</th>
                  <th style={{ padding: '12px 16px' }}>Last Kiosk Punch</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {enrollmentsQuery.data && enrollmentsQuery.data.length > 0 ? (
                  enrollmentsQuery.data.map((emp) => (
                    <tr key={emp.employee_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 600 }}>{emp.employee_number}</td>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>{emp.last_name}, {emp.first_name}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--color-muted)' }}>{emp.department_name || 'General'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '15px',
                          color: emp.is_enrolled ? '#10b981' : '#f59e0b',
                          fontWeight: 600,
                        }}>
                          <span>{emp.is_enrolled ? '●' : '○'}</span>
                          {emp.is_enrolled ? 'Enrolled (PIN Active)' : 'Pending Enrollment'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--color-muted)', fontSize: '15px' }}>
                        {emp.last_punch_at ? new Date(emp.last_punch_at).toLocaleString() : 'No punches yet'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEnrollModalEmployee(emp);
                            setEnrollPin('');
                          }}
                        >
                          {emp.is_enrolled ? 'Reset Passcode' : 'Enroll Passcode'}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-muted)' }}>
                      {enrollmentsQuery.isLoading ? 'Loading employee roster...' : 'No employees found in directory.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Enroll Modal */}
          {enrollModalEmployee && (
            <div style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
            }}>
              <div style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '12px',
                padding: '24px',
                width: '100%',
                maxWidth: '420px',
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px 0' }}>
                  Set Biometric Kiosk Passcode
                </h3>
                <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '0 0 20px 0' }}>
                  Assigning passcode for <strong>{enrollModalEmployee.first_name} {enrollModalEmployee.last_name}</strong> (Emp No: {enrollModalEmployee.employee_number}).
                </p>

                {enrollSuccessMsg ? (
                  <div style={{ padding: '12px', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#10b981', borderRadius: '8px', textAlign: 'center', fontWeight: 600 }}>
                    {enrollSuccessMsg}
                  </div>
                ) : (
                  <div>
                    <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                      Numeric Passcode (4 to 6 Digits):
                    </label>
                    <input
                      type="password"
                      maxLength={6}
                      placeholder="e.g. 1234"
                      value={enrollPin}
                      onChange={(e) => setEnrollPin(e.target.value.replace(/\D/g, ''))}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        fontSize: '18px',
                        letterSpacing: '0.25em',
                        textAlign: 'center',
                        borderRadius: '8px',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-bg)',
                        color: 'var(--color-fg)',
                        marginBottom: '16px',
                      }}
                    />

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setEnrollModalEmployee(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary"
                        disabled={enrollPin.length < 4 || enrollMutation.isPending}
                        onClick={() =>
                          enrollMutation.mutate({
                            employeeId: enrollModalEmployee.employee_id,
                            pin: enrollPin,
                          })
                        }
                      >
                        {enrollMutation.isPending ? 'Saving...' : 'Save Passcode'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Shifts */}
      {activeTab === 'shifts' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Work Shifts & Break Schedules</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Supports standard, opening, mid, graveyard, closing, and broken shift models.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {shiftsQuery.data?.map((s) => (
              <Card key={s.id} kicker={`Code: ${s.code}`} title={s.name}>
                <div style={{ marginTop: '8px', fontSize: '14.5px', color: 'var(--color-fg)' }}>
                  Primary Window: <strong>{s.start_time} - {s.end_time}</strong>
                </div>
                {s.is_broken_shift && (
                  <div style={{ fontSize: '14.5px', color: '#38bdf8', marginTop: '4px', fontWeight: 600 }}>
                    Broken Shift Split: {s.second_start_time} - {s.second_end_time}
                  </div>
                )}
                <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '4px' }}>
                  Grace Period: {s.grace_period_mins} minutes
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Shift Swaps & Comp-Off */}
      {activeTab === 'swaps' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
        }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 12px 0' }}>
            Shift Swapping & Compensatory Time-Off (CTO)
          </h2>
          <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginBottom: '20px' }}>
            Allows employees to request mutual duty schedule swaps and utilize accumulated comp-off days.
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                <th style={{ padding: '10px 12px' }}>Requestor</th>
                <th style={{ padding: '10px 12px' }}>Reliever (Swap Partner)</th>
                <th style={{ padding: '10px 12px' }}>Target Date</th>
                <th style={{ padding: '10px 12px' }}>Reason</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {swapsQuery.data && swapsQuery.data.length > 0 ? (
                swapsQuery.data.map((sw) => (
                  <tr key={sw.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{sw.requestor_name}</td>
                    <td style={{ padding: '10px 12px' }}>{sw.target_name}</td>
                    <td style={{ padding: '10px 12px' }}>{sw.swap_date}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-muted)' }}>{sw.reason || 'Personal matters'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <Tag tone={sw.status === 'approved' ? 'accent' : 'neutral'}>
                        {sw.status.toUpperCase()}
                      </Tag>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {sw.status === 'pending' && (
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={approveSwapMutation.isPending}
                          onClick={() => approveSwapMutation.mutate(sw.id)}
                        >
                          Approve Swap
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-muted)' }}>
                    No pending shift swap applications in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 5: Tardiness & Disciplinary Memos */}
      {activeTab === 'tardiness-memos' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* Infractions summary */}
          <div style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '20px',
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 8px 0' }}>
              Habitual Tardiness Watchlist
            </h3>
            <p style={{ fontSize: '15px', color: 'var(--color-muted)', marginBottom: '16px' }}>
              Employees with recurring tardiness (DOLE Article 297 compliance).
            </p>

            {infractionsQuery.data && infractionsQuery.data.length > 0 ? (
              infractionsQuery.data.map((inf: any) => (
                <div key={inf.employeeId} style={{
                  padding: '12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  marginBottom: '10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14.5px' }}>
                      {inf.employeeName}
                    </div>
                    <div style={{ fontSize: '15px', color: '#f87171' }}>
                      {inf.tardinessCount} tardy days • {inf.totalTardinessMinutes} accumulated minutes late
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setMemoModalEmployee(inf);
                      setMemoSubject(`Notice to Explain: Habitual Tardiness (${inf.tardinessCount} instances)`);
                      setMemoBody(`You are hereby requested to submit a written explanation within 5 days regarding habitual tardiness recorded between ${currentMonthStart} and ${todayStr}.`);
                    }}
                  >
                    Issue NTE Memo
                  </button>
                </div>
              ))
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-muted)', fontSize: '14.5px' }}>
                No habitual tardiness infractions flagged.
              </div>
            )}
          </div>

          {/* Issued Memos */}
          <div style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '20px',
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 8px 0' }}>
              Issued Disciplinary Notices & Memos
            </h3>
            <p style={{ fontSize: '15px', color: 'var(--color-muted)', marginBottom: '16px' }}>
              Formal legal record of DOLE twin-notice requirements.
            </p>

            {memosQuery.data && memosQuery.data.length > 0 ? (
              memosQuery.data.map((memo) => (
                <div key={memo.id} style={{
                  padding: '12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  marginBottom: '10px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14.5px', fontFamily: 'monospace', color: 'var(--color-muted)' }}>{memo.memo_number}</span>
                    <Tag tone="accent">{memo.memo_type.toUpperCase().replace(/_/g, ' ')}</Tag>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '14.5px', marginTop: '4px' }}>
                    {memo.subject}
                  </div>
                  <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '4px' }}>
                    To: {memo.first_name} {memo.last_name} • Date: {memo.created_at?.slice(0, 10)}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-muted)', fontSize: '14.5px' }}>
                No formal disciplinary notices issued.
              </div>
            )}
          </div>

          {/* Issue Memo Modal */}
          {memoModalEmployee && (
            <div style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
            }}>
              <div style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '12px',
                padding: '24px',
                width: '100%',
                maxWidth: '520px',
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px 0' }}>
                  Issue Notice to Explain (NTE)
                </h3>
                <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '0 0 16px 0' }}>
                  Recipient: <strong>{memoModalEmployee.employeeName || `${memoModalEmployee.first_name ?? ''} ${memoModalEmployee.last_name ?? ''}`}</strong>
                </p>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Subject:</label>
                  <input
                    type="text"
                    value={memoSubject}
                    onChange={(e) => setMemoSubject(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Memo Body:</label>
                  <textarea
                    rows={4}
                    value={memoBody}
                    onChange={(e) => setMemoBody(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="btn btn-ghost" onClick={() => setMemoModalEmployee(null)}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    disabled={issueMemoMutation.isPending}
                    onClick={() =>
                      issueMemoMutation.mutate({
                        employeeId: memoModalEmployee.employeeId || memoModalEmployee.employee_id,
                        subject: memoSubject,
                        body: memoBody,
                        totalInfractions: memoModalEmployee.tardinessCount ?? memoModalEmployee.tardy_days ?? 1,
                      })
                    }
                  >
                    {issueMemoMutation.isPending ? 'Issuing...' : 'Issue Official Memo'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Official Business (OB) Trips */}
      {activeTab === 'ob-trips' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Official Business (OB) & Travel Orders</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Track external client visits, provincial travel orders, and daily per diem allowances.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowTripModal(true)}>
              + File Official Business Trip
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                <th style={{ padding: '10px 12px' }}>Employee</th>
                <th style={{ padding: '10px 12px' }}>Destination</th>
                <th style={{ padding: '10px 12px' }}>Purpose</th>
                <th style={{ padding: '10px 12px' }}>Inclusive Dates</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Per Diem (Daily)</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {tripsQuery.data && tripsQuery.data.length > 0 ? (
                tripsQuery.data.map((trip) => (
                  <tr key={trip.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{trip.first_name} {trip.last_name}</td>
                    <td style={{ padding: '10px 12px' }}>{trip.destination}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-muted)' }}>{trip.purpose}</td>
                    <td style={{ padding: '10px 12px' }}>{trip.start_date} to {trip.end_date}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>₱{trip.per_diem_daily || '0.00'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <Tag tone={trip.status === 'approved' ? 'accent' : 'neutral'}>
                        {trip.status.toUpperCase()}
                      </Tag>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {trip.status === 'pending' && (
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={approveTripMutation.isPending}
                          onClick={() => approveTripMutation.mutate(trip.id)}
                        >
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-muted)' }}>
                    No business travel trips filed for this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* File OB Trip Modal */}
          {showTripModal && (
            <div style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
            }}>
              <div style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '12px',
                padding: '24px',
                width: '100%',
                maxWidth: '460px',
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>File Official Business (OB) Trip</h3>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Destination:</label>
                  <input
                    type="text"
                    placeholder="e.g. Cebu Branch Client Meeting"
                    value={tripForm.destination}
                    onChange={(e) => setTripForm({ ...tripForm, destination: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Purpose:</label>
                  <input
                    type="text"
                    placeholder="e.g. System rollout & client training"
                    value={tripForm.purpose}
                    onChange={(e) => setTripForm({ ...tripForm, purpose: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Start Date:</label>
                    <input
                      type="date"
                      value={tripForm.startDate}
                      onChange={(e) => setTripForm({ ...tripForm, startDate: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>End Date:</label>
                    <input
                      type="date"
                      value={tripForm.endDate}
                      onChange={(e) => setTripForm({ ...tripForm, endDate: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                    />
                  </div>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Daily Per Diem (₱):</label>
                  <input
                    type="number"
                    value={tripForm.perDiemDaily}
                    onChange={(e) => setTripForm({ ...tripForm, perDiemDaily: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowTripModal(false)}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    disabled={tripMutation.isPending}
                    onClick={() => tripMutation.mutate(tripForm)}
                  >
                    {tripMutation.isPending ? 'Filing...' : 'Submit Trip Order'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 7: Hotel Staff Meal Vouchers */}
      {activeTab === 'meal-vouchers' && (
        <div style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Hotel & Hospitality Duty Meal Vouchers</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Duty cafeteria meal allocation for hospitality, kitchen, and frontline staff.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowVoucherModal(true)}>
              + Issue Duty Meal Voucher
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14.5px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                <th style={{ padding: '10px 12px' }}>Voucher Serial</th>
                <th style={{ padding: '10px 12px' }}>Staff Name</th>
                <th style={{ padding: '10px 12px' }}>Meal Type</th>
                <th style={{ padding: '10px 12px' }}>Valid Date</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Redemption Status</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {vouchersQuery.data && vouchersQuery.data.length > 0 ? (
                vouchersQuery.data.map((vc: any) => {
                  const code = vc.voucher_code || vc.voucher_number;
                  const redeemed = vc.status === 'redeemed' || vc.is_redeemed;
                  return (
                    <tr key={vc.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{code}</td>
                      <td style={{ padding: '10px 12px' }}>{vc.employeeName || `${vc.first_name ?? ''} ${vc.last_name ?? ''}`}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ textTransform: 'capitalize' }}>{(vc.meal_type || 'duty_meal').replace(/_/g, ' ')}</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>{vc.valid_date || (vc.created_at ? String(vc.created_at).slice(0, 10) : '—')}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <Tag tone={redeemed ? 'neutral' : 'accent'}>
                          {redeemed ? 'REDEEMED' : 'ACTIVE'}
                        </Tag>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {!redeemed && code && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => redeemVoucherMutation.mutate(code)}
                            disabled={redeemVoucherMutation.isPending}
                          >
                            Mark Redeemed
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-muted)' }}>
                    No meal vouchers issued for today.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Issue Voucher Modal */}
          {showVoucherModal && (
            <div style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
            }}>
              <div style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '12px',
                padding: '24px',
                width: '100%',
                maxWidth: '420px',
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>Issue Duty Meal Voucher</h3>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Meal Type:</label>
                  <select
                    value={voucherForm.mealType}
                    onChange={(e) => setVoucherForm({ ...voucherForm, mealType: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  >
                    <option value="duty_meal">Standard Duty Meal (Shift)</option>
                    <option value="overtime_meal">Overtime Meal (OT &gt; 2 hrs)</option>
                    <option value="graveyard_snack">Graveyard Shift Midnight Snack</option>
                  </select>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Valid Date:</label>
                  <input
                    type="date"
                    value={voucherForm.validDate}
                    onChange={(e) => setVoucherForm({ ...voucherForm, validDate: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowVoucherModal(false)}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    disabled={voucherMutation.isPending}
                    onClick={() => voucherMutation.mutate(voucherForm)}
                  >
                    {voucherMutation.isPending ? 'Issuing...' : 'Generate Voucher'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 8: Holidays */}
      {activeTab === 'holidays' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Statutory &amp; Company Holidays</h2>
              <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', margin: '4px 0 0 0' }}>
                Regular &amp; special non-working holidays applied to attendance &amp; payroll holiday premiums.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowHolidayModal(true)}>
              + Add Holiday
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {holidaysQuery.data?.map((h) => (
              <Card key={h.id} kicker={h.holiday_type.replace(/_/g, ' ').toUpperCase()} title={h.name}>
                <div style={{ marginTop: '8px', fontSize: '14.5px', fontWeight: 600 }}>
                  Date: {h.holiday_date}
                </div>
                <div style={{ fontSize: '15px', color: 'var(--color-muted)', marginTop: '4px' }}>
                  Coverage: {h.branch_name || 'Nationwide (All Branches)'}
                </div>
              </Card>
            ))}
          </div>
          {showHolidayModal && (
            <div style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
            }}>
              <div style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '12px',
                padding: '24px',
                width: '100%',
                maxWidth: '420px',
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>Add Holiday</h3>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Holiday Name:</label>
                  <input
                    type="text"
                    value={holidayForm.name}
                    onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                    placeholder="e.g. Bonifacio Day"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Date:</label>
                  <input
                    type="date"
                    value={holidayForm.holidayDate}
                    onChange={(e) => setHolidayForm({ ...holidayForm, holidayDate: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Type:</label>
                  <select
                    value={holidayForm.holidayType}
                    onChange={(e) => setHolidayForm({ ...holidayForm, holidayType: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' }}
                  >
                    <option value="regular_holiday">Regular Holiday (200%)</option>
                    <option value="special_non_working">Special Non-Working (130%)</option>
                    <option value="special_working">Special Working</option>
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowHolidayModal(false)}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    disabled={!holidayForm.name.trim() || createHolidayMutation.isPending}
                    onClick={() => createHolidayMutation.mutate(holidayForm)}
                  >
                    {createHolidayMutation.isPending ? 'Saving...' : 'Save Holiday'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
