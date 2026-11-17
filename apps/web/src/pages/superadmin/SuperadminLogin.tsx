import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSuperadminSession, resolveApiPath } from '../../auth';

export default function SuperadminLogin() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(resolveApiPath('/superadmin/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Authentication failed.');
      }

      setSuperadminSession(data.token, data.user);
      navigate('/superadmin', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Invalid superadmin credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#090d16',
      color: '#f1f5f9',
      padding: '24px',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px',
        backgroundColor: '#111827',
        border: '1px solid #1f2937',
        borderRadius: '8px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
        padding: '36px 32px',
      }}>
        {/* Security badge */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '46px',
            height: '46px',
            borderRadius: '8px',
            backgroundColor: '#1e1b4b',
            color: '#a5b4fc',
            border: '1px solid #312e81',
            marginBottom: '16px',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div style={{
            fontSize: '14.5px',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: '#818cf8',
            fontWeight: 700,
            marginBottom: '6px',
          }}>
            Summit Platform Engine
          </div>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: 600 }}>
            Superadmin Management
          </h1>
          <p style={{ margin: 0, fontSize: '14.5px', color: '#9ca3af' }}>
            Multi-tenant control, licensing & Philippine payroll provision
          </p>
        </div>

        {error && (
          <div style={{
            padding: '12px 14px',
            marginBottom: '20px',
            borderRadius: '6px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
            fontSize: '14.5px',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '14.5px', fontWeight: 500, marginBottom: '6px', color: '#d1d5db' }}>
              Platform Administrator Email
            </label>
            <input
              type="email"
              required
              autoFocus
              placeholder="superadmin@summitlogic.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '15px',
                backgroundColor: '#0a0f1d',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#f9fafb',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14.5px', fontWeight: 500, marginBottom: '6px', color: '#d1d5db' }}>
              Master Security Key / Password
            </label>
            <input
              type="password"
              required
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '15px',
                backgroundColor: '#0a0f1d',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#f9fafb',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '8px',
              padding: '11px 16px',
              backgroundColor: '#4f46e5',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '15px',
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'background-color 0.15s ease',
            }}
          >
            {loading ? 'Verifying access…' : 'Access Superadmin Console'}
          </button>
        </form>

        <div style={{
          marginTop: '20px',
          padding: '12px',
          backgroundColor: '#0a0f1d',
          border: '1px solid #1f2937',
          borderRadius: '6px',
          fontSize: '14.5px',
          color: '#9ca3af',
          lineHeight: '1.5',
        }}>
          <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: '4px' }}>Demo Superadmin Access:</div>
          <div>Account: <code style={{ color: '#93c5fd' }}>superadmin@summitlogic.io</code></div>
          <div>Password: <code style={{ color: '#93c5fd' }}>SuperAdminPassword123!</code></div>
          <div style={{ marginTop: '4px', fontSize: '15px', color: '#6b7280' }}>
            Also supports: <code style={{ color: '#a5b4fc' }}>admin@summitlogic.ph</code> / <code style={{ color: '#a5b4fc' }}>Password123!</code>
          </div>
        </div>

        <div style={{
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: '1px solid #1f2937',
          textAlign: 'center',
          fontSize: '15px',
          color: '#6b7280',
        }}>
          <a href="/login" style={{ color: '#9ca3af', textDecoration: 'none' }}>
            ← Switch to Tenant Client Login
          </a>
        </div>
      </div>
    </div>
  );
}
