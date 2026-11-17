import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { Card, Tag } from '../../components/ds';

interface AttendanceShift {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_period_mins: number;
  is_night_shift: boolean;
  is_active: boolean;
}

export default function AttendancePoliciesAdmin() {
  const queryClient = useQueryClient();
  const [showAddShiftModal, setShowAddShiftModal] = useState(false);

  const [shiftForm, setShiftForm] = useState({
    code: '',
    name: '',
    startTime: '08:00',
    endTime: '17:00',
    breakMinutes: 60,
    gracePeriodMins: 15,
    isNightShift: false,
  });

  const { data: shifts, isLoading } = useQuery({
    queryKey: ['attendance-shifts'],
    queryFn: () => api<AttendanceShift[]>('/attendance/shifts'),
  });

  const createShiftMutation = useMutation({
    mutationFn: (body: typeof shiftForm) =>
      api<AttendanceShift>('/attendance/shifts', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-shifts'] });
      setShowAddShiftModal(false);
      setShiftForm({
        code: '',
        name: '',
        startTime: '08:00',
        endTime: '17:00',
        breakMinutes: 60,
        gracePeriodMins: 15,
        isNightShift: false,
      });
    },
  });

  const updateShiftMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api(`/admin/shifts/${id}`, { method: 'PATCH', body: data }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attendance-shifts'] }),
  });

  const deleteShiftMutation = useMutation({
    mutationFn: (id: string) => api(`/admin/shifts/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attendance-shifts'] }),
  });

  if (isLoading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>Loading attendance shift policies…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Work Shifts, Schedules & Attendance Rules</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '14.5px', color: 'var(--color-muted)' }}>
            Configure standard shift templates, meal break allowances, grace periods, and statutory premium rate matrices.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => setShowAddShiftModal(true)}
        >
          + Add New Shift Template
        </button>
      </div>

      <Card title="Configured Work Shifts & Grace Periods">
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '14.5px' }}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Shift Name</th>
                <th>Working Hours</th>
                <th>Break Allowance</th>
                <th>Grace Period</th>
                <th>Night Shift</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(shifts || []).map((s) => (
                <tr key={s.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{s.code}</td>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}</td>
                  <td>{s.break_minutes} mins</td>
                  <td>{s.grace_period_mins} mins</td>
                  <td>
                    {s.is_night_shift ? (
                      <Tag tone="accent">Night Differential (110%)</Tag>
                    ) : (
                      <span style={{ color: 'var(--color-muted)' }}>Day / Core</span>
                    )}
                  </td>
                  <td>
                    <Tag tone={s.is_active ? 'accent' : 'neutral'}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </Tag>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => updateShiftMutation.mutate({ id: s.id, data: { isActive: !s.is_active } })}
                    >
                      {s.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => deleteShiftMutation.mutate(s.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Philippine Labor Code Statutory Overtime & Premium Rates Matrix">
        <p style={{ fontSize: '14.5px', color: 'var(--color-muted)', marginBottom: '16px' }}>
          These statutory multipliers are applied automatically by the attendance engine when calculating daily time records and payroll runs.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '14.5px' }}>
            <thead>
              <tr>
                <th>Attendance Event</th>
                <th>DOLE Statutory Reference</th>
                <th>Premium Multiplier</th>
                <th>Effective Formula</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>Regular Day Overtime (OT)</td>
                <td>Article 87, Labor Code</td>
                <td><Tag tone="accent">125% (+25%)</Tag></td>
                <td>Hourly Rate × 1.25 × Excess Hours</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Night Shift Differential (NSD)</td>
                <td>Article 86 (10:00 PM – 06:00 AM)</td>
                <td><Tag tone="accent">110% (+10%)</Tag></td>
                <td>Hourly Rate × 0.10 × Night Hours</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Scheduled Rest Day Work</td>
                <td>Article 93, Labor Code</td>
                <td><Tag tone="accent">130% (+30%)</Tag></td>
                <td>Daily Rate × 1.30</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Rest Day Overtime</td>
                <td>Article 93 (Beyond 8 hours)</td>
                <td><Tag tone="accent">169% (+69%)</Tag></td>
                <td>Hourly Rate × 1.69 × OT Hours</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Special Non-Working Holiday</td>
                <td>Proclamation / Labor Code</td>
                <td><Tag tone="accent">130% (+30%)</Tag></td>
                <td>Daily Rate × 1.30</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Regular Holiday Work</td>
                <td>Article 94 (e.g. Christmas, New Year)</td>
                <td><Tag tone="accent">200% (Double Pay)</Tag></td>
                <td>Daily Rate × 2.00</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Regular Holiday Overtime</td>
                <td>Article 94 (Beyond 8 hours)</td>
                <td><Tag tone="accent">260% (+160%)</Tag></td>
                <td>Hourly Rate × 2.60 × OT Hours</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Shift Modal */}
      {showAddShiftModal && (
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
              Create Work Shift Schedule
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Shift Code</label>
                  <input
                    className="input"
                    style={{ width: '100%' }}
                    value={shiftForm.code}
                    onChange={(e) => setShiftForm({ ...shiftForm, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. OPEN"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Shift Name</label>
                  <input
                    className="input"
                    style={{ width: '100%' }}
                    value={shiftForm.name}
                    onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                    placeholder="e.g. Morning Opening Shift"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Start Time</label>
                  <input
                    type="time"
                    className="input"
                    style={{ width: '100%' }}
                    value={shiftForm.startTime}
                    onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>End Time</label>
                  <input
                    type="time"
                    className="input"
                    style={{ width: '100%' }}
                    value={shiftForm.endTime}
                    onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Break (Minutes)</label>
                  <input
                    type="number"
                    className="input"
                    style={{ width: '100%' }}
                    value={shiftForm.breakMinutes}
                    onChange={(e) => setShiftForm({ ...shiftForm, breakMinutes: parseInt(e.target.value, 10) || 60 })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Grace Period (Mins)</label>
                  <input
                    type="number"
                    className="input"
                    style={{ width: '100%' }}
                    value={shiftForm.gracePeriodMins}
                    onChange={(e) => setShiftForm({ ...shiftForm, gracePeriodMins: parseInt(e.target.value, 10) || 15 })}
                  />
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14.5px', cursor: 'pointer', marginTop: '6px' }}>
                <input
                  type="checkbox"
                  checked={shiftForm.isNightShift}
                  onChange={(e) => setShiftForm({ ...shiftForm, isNightShift: e.target.checked })}
                />
                <span>Classify as Night Differential Shift (Applies +10% NSD between 10PM - 6AM)</span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowAddShiftModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => createShiftMutation.mutate(shiftForm)}
                disabled={createShiftMutation.isPending || !shiftForm.code || !shiftForm.name}
              >
                {createShiftMutation.isPending ? 'Saving...' : 'Create Shift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
