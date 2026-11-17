import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../auth';

interface KioskPunchResponse {
  message: string;
  employee: {
    id: string;
    employee_number: string;
    first_name: string;
    last_name: string;
    department_id?: string;
  };
  record: {
    id: string;
    work_date: string;
    clock_in?: string | null;
    clock_out?: string | null;
    status: string;
  };
}

interface Branch {
  id: string;
  name: string;
  city?: string;
}

export default function KioskTerminal() {
  const [time, setTime] = useState(new Date());
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [pin, setPin] = useState('');
  const [activeInput, setActiveInput] = useState<'empNo' | 'pin'>('empNo');
  const [punchType, setPunchType] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [successInfo, setSuccessInfo] = useState<KioskPunchResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resetCountdown, setResetCountdown] = useState<number>(0);

  // Clock ticker
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Countdown timer for automatic reset after successful punch
  useEffect(() => {
    if (resetCountdown <= 0) {
      if (successInfo) {
        setSuccessInfo(null);
        setEmployeeNumber('');
        setPin('');
        setActiveInput('empNo');
      }
      return;
    }
    const cd = setTimeout(() => setResetCountdown((c) => c - 1), 1000);
    return () => clearTimeout(cd);
  }, [resetCountdown, successInfo]);

  // Fetch branches for kiosk selection
  const branchesQuery = useQuery({
    queryKey: ['kiosk-branches'],
    queryFn: async () => {
      try {
        return await api<Branch[]>('/attendance/branches');
      } catch {
        return [];
      }
    },
  });

  const punchMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      return api<KioskPunchResponse>('/attendance/kiosk/punch', {
        method: 'POST',
        body: {
          employeeNumber: employeeNumber.trim(),
          pin: pin.trim(),
          punchType,
          branchId: selectedBranchId || undefined,
        },
      });
    },
    onSuccess: (data) => {
      setSuccessInfo(data);
      setResetCountdown(5);
    },
    onError: (err: any) => {
      const msg = err?.message || 'Biometric terminal verification failed. Please check your credentials or contact HR.';
      setErrorMessage(msg);
    },
  });

  const handleKeyPress = (char: string) => {
    if (activeInput === 'empNo') {
      setEmployeeNumber((prev) => prev + char);
    } else {
      if (pin.length < 6) {
        setPin((prev) => prev + char);
      }
    }
  };

  const handleBackspace = () => {
    if (activeInput === 'empNo') {
      setEmployeeNumber((prev) => prev.slice(0, -1));
    } else {
      setPin((prev) => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    if (activeInput === 'empNo') {
      setEmployeeNumber('');
    } else {
      setPin('');
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!employeeNumber.trim()) {
      setActiveInput('empNo');
      setErrorMessage('Please enter your Employee Number');
      return;
    }
    if (!pin.trim()) {
      setActiveInput('pin');
      setErrorMessage('Please enter your 4-6 digit Passcode');
      return;
    }
    punchMutation.mutate();
  };

  const timeFormatted = time.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const dateFormatted = time.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#090d16',
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
    }}>
      {/* Top Bar */}
      <header style={{
        padding: '16px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #1e293b',
        backgroundColor: '#0f172a',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            backgroundColor: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 800,
            fontSize: '20px',
            boxShadow: '0 0 20px rgba(37,99,235,0.4)',
          }}>
            ⚡
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: '#f8fafc' }}>
              HR Biometric Terminal
            </h1>
            <p style={{ margin: 0, fontSize: '15px', color: '#94a3b8' }}>
              Pin & Badge Kiosk • DOLE Certified DTR Punch Station
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {branchesQuery.data && branchesQuery.data.length > 0 && (
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              style={{
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '14.5px',
                outline: 'none',
              }}
            >
              <option value="">🏢 Main Office / All Branches</option>
              {branchesQuery.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} {b.city ? `(${b.city})` : ''}
                </option>
              ))}
            </select>
          )}

          <a
            href="/"
            style={{
              fontSize: '14.5px',
              color: '#94a3b8',
              textDecoration: 'none',
              padding: '6px 12px',
              border: '1px solid #334155',
              borderRadius: '6px',
            }}
          >
            Exit to Portal →
          </a>
        </div>
      </header>

      {/* Main Terminal Screen */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}>
        {/* Live Digital Clock */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            fontSize: 'clamp(44px, 7vw, 68px)',
            fontWeight: 800,
            letterSpacing: '0.04em',
            color: '#38bdf8',
            fontVariantNumeric: 'tabular-nums',
            textShadow: '0 0 35px rgba(56, 189, 248, 0.35)',
          }}>
            {timeFormatted}
          </div>
          <div style={{ fontSize: '18px', color: '#94a3b8', marginTop: '4px', fontWeight: 500 }}>
            {dateFormatted}
          </div>
        </div>

        {/* Punch State Feedback Modal / Overlay */}
        {successInfo ? (
          <div style={{
            width: '100%',
            maxWidth: '560px',
            backgroundColor: '#064e3b',
            border: '2px solid #10b981',
            borderRadius: '20px',
            padding: '36px 32px',
            textAlign: 'center',
            boxShadow: '0 25px 50px -12px rgba(16, 185, 129, 0.3)',
            animation: 'fadeIn 0.3s ease',
          }}>
            <div style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '36px',
              margin: '0 auto 16px auto',
              boxShadow: '0 0 25px rgba(16, 185, 129, 0.6)',
            }}>
              ✓
            </div>
            <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0', color: '#ecfdf5' }}>
              {successInfo.message}
            </h2>
            <div style={{ fontSize: '18px', color: '#a7f3d0', fontWeight: 600 }}>
              {successInfo.employee.first_name} {successInfo.employee.last_name}
            </div>
            <div style={{ fontSize: '15px', color: '#6ee7b7', marginTop: '4px' }}>
              Employee No: {successInfo.employee.employee_number}
            </div>
            <div style={{
              marginTop: '20px',
              padding: '12px',
              backgroundColor: 'rgba(0,0,0,0.25)',
              borderRadius: '10px',
              fontSize: '14.5px',
              color: '#d1fae5',
            }}>
              Recorded at: {new Date().toLocaleTimeString()} • Status: Active DOLE Record
            </div>
            <div style={{ marginTop: '18px', fontSize: '15px', color: '#6ee7b7' }}>
              Screen resets automatically in <strong>{resetCountdown}</strong> seconds...
            </div>
          </div>
        ) : (
          <div style={{
            width: '100%',
            maxWidth: '540px',
            backgroundColor: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '20px',
            padding: '28px',
            boxShadow: '0 20px 45px rgba(0,0,0,0.5)',
          }}>
            {/* Punch Mode Switcher */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
              marginBottom: '20px',
              backgroundColor: '#1e293b',
              padding: '6px',
              borderRadius: '12px',
            }}>
              <button
                type="button"
                onClick={() => setPunchType('clock_in')}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '15px',
                  cursor: 'pointer',
                  backgroundColor: punchType === 'clock_in' ? '#10b981' : 'transparent',
                  color: punchType === 'clock_in' ? '#ffffff' : '#94a3b8',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <span>🟢</span> Clock In (Morning / Shift Start)
              </button>
              <button
                type="button"
                onClick={() => setPunchType('clock_out')}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '15px',
                  cursor: 'pointer',
                  backgroundColor: punchType === 'clock_out' ? '#ef4444' : 'transparent',
                  color: punchType === 'clock_out' ? '#ffffff' : '#94a3b8',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <span>🔴</span> Clock Out (Shift End)
              </button>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                color: '#fca5a5',
                padding: '12px 16px',
                borderRadius: '8px',
                marginBottom: '18px',
                fontSize: '14.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <span>⚠️</span>
                <div>{errorMessage}</div>
              </div>
            )}

            {/* Input Selectors */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              {/* Employee No Box */}
              <div
                onClick={() => setActiveInput('empNo')}
                style={{
                  border: `2px solid ${activeInput === 'empNo' ? '#38bdf8' : '#334155'}`,
                  borderRadius: '12px',
                  padding: '10px 14px',
                  backgroundColor: '#090d16',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{ fontSize: '14.5px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>
                  1. Employee ID / No.
                </div>
                <div style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: employeeNumber ? '#ffffff' : '#475569',
                  minHeight: '28px',
                  marginTop: '4px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {employeeNumber || 'Tap to enter'}
                </div>
              </div>

              {/* Passcode / PIN Box */}
              <div
                onClick={() => setActiveInput('pin')}
                style={{
                  border: `2px solid ${activeInput === 'pin' ? '#38bdf8' : '#334155'}`,
                  borderRadius: '12px',
                  padding: '10px 14px',
                  backgroundColor: '#090d16',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{ fontSize: '14.5px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>
                  2. Passcode (4-6 Digits)
                </div>
                <div style={{
                  fontSize: '22px',
                  fontWeight: 700,
                  color: pin ? '#38bdf8' : '#475569',
                  minHeight: '28px',
                  marginTop: '4px',
                  letterSpacing: '0.25em',
                }}>
                  {pin ? '•'.repeat(pin.length) : '••••'}
                </div>
              </div>
            </div>

            {/* Direct Keyboard input support */}
            <form onSubmit={handleSubmit} style={{ display: 'none' }}>
              <input
                type="text"
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
              />
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </form>

            {/* Touch Numpad */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '10px',
              marginBottom: '16px',
            }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleKeyPress(digit)}
                  style={{
                    backgroundColor: '#1e293b',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    borderRadius: '12px',
                    fontSize: '24px',
                    fontWeight: 600,
                    padding: '16px 0',
                    cursor: 'pointer',
                    outline: 'none',
                    transition: 'background-color 0.1s, transform 0.05s',
                  }}
                  onMouseDown={(e) => (e.currentTarget.style.backgroundColor = '#334155')}
                  onMouseUp={(e) => (e.currentTarget.style.backgroundColor = '#1e293b')}
                >
                  {digit}
                </button>
              ))}

              {/* Clear */}
              <button
                type="button"
                onClick={handleClear}
                style={{
                  backgroundColor: '#374151',
                  color: '#fca5a5',
                  border: '1px solid #4b5563',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: 700,
                  padding: '16px 0',
                  cursor: 'pointer',
                }}
              >
                CLEAR
              </button>

              {/* Zero */}
              <button
                type="button"
                onClick={() => handleKeyPress('0')}
                style={{
                  backgroundColor: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  borderRadius: '12px',
                  fontSize: '24px',
                  fontWeight: 600,
                  padding: '16px 0',
                  cursor: 'pointer',
                }}
              >
                0
              </button>

              {/* Backspace */}
              <button
                type="button"
                onClick={handleBackspace}
                style={{
                  backgroundColor: '#374151',
                  color: '#cbd5e1',
                  border: '1px solid #4b5563',
                  borderRadius: '12px',
                  fontSize: '20px',
                  fontWeight: 700,
                  padding: '16px 0',
                  cursor: 'pointer',
                }}
              >
                ⌫
              </button>
            </div>

            {/* Submit Action Button */}
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={punchMutation.isPending}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: punchType === 'clock_in' ? '#2563eb' : '#dc2626',
                color: '#ffffff',
                fontSize: '17px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: punchType === 'clock_in'
                  ? '0 10px 25px rgba(37, 99, 235, 0.4)'
                  : '0 10px 25px rgba(220, 38, 38, 0.4)',
                opacity: punchMutation.isPending ? 0.7 : 1,
                transition: 'transform 0.1s',
              }}
            >
              {punchMutation.isPending
                ? 'Verifying Pin & Recording DTR...'
                : punchType === 'clock_in'
                ? 'VERIFY & CLOCK IN'
                : 'VERIFY & CLOCK OUT'}
            </button>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px',
              fontSize: '15px',
              color: '#64748b',
            }}>
              <div>Default passcode for testing: <strong>1234</strong></div>
              <div>HR Self-Enrollment Active</div>
            </div>
          </div>
        )}
      </main>

      {/* Terminal Footer */}
      <footer style={{
        padding: '12px 32px',
        textAlign: 'center',
        fontSize: '15px',
        color: '#64748b',
        borderTop: '1px solid #1e293b',
        backgroundColor: '#0f172a',
      }}>
        © 2026 Summit HR Enterprise Biometrics • Secure RLS Multi-Tenant Architecture • DOLE Labor Code of the Philippines
      </footer>
    </div>
  );
}
