import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HOME_PATH } from '../../routes';
import { setSaasSession, oidcEnabled, userManager, resolveApiPath } from '../../auth';

export default function Login() {
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo') || HOME_PATH;
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
      const res = await fetch(resolveApiPath('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Invalid email or password.');
      }

      setSaasSession(data.token, {
        employee: data.employee,
        organization: data.organization,
        roles: data.roles,
        features: data.features,
      });

      // Navigate to destination
      navigate(returnTo, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleSso = () => {
    if (userManager) {
      userManager.signinRedirect({ state: { returnTo } });
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--color-bg, #0f172a)',
      color: 'var(--color-fg, #f8fafc)',
      padding: '24px',
      fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '440px',
        backgroundColor: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: '8px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
        padding: '36px 32px',
      }}>
        {/* Brand header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '44px',
            height: '44px',
            borderRadius: '8px',
            backgroundColor: 'var(--color-accent-subtle, #1e3a8a)',
            color: 'var(--color-accent, #60a5fa)',
            marginBottom: '16px',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '22px', fontWeight: 600, letterSpacing: '-0.02em' }}>
            HR & Performance Cloud
          </h1>
          <p style={{ margin: 0, fontSize: '14.5px', color: 'var(--color-muted, #94a3b8)' }}>
            Sign in to access your organization workspace
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
            lineHeight: 1.4,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '14.5px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-fg, #e2e8f0)' }}>
              Work Email
            </label>
            <input
              type="email"
              required
              autoFocus
              placeholder="e.g. name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '15px',
                backgroundColor: 'var(--color-input-bg, #0f172a)',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: '6px',
                color: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '14.5px', fontWeight: 500, color: 'var(--color-fg, #e2e8f0)' }}>
                Password
              </label>
            </div>
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
                backgroundColor: 'var(--color-input-bg, #0f172a)',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: '6px',
                color: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '6px',
              padding: '11px 16px',
              backgroundColor: '#2563eb',
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
            {loading ? 'Authenticating…' : 'Sign in to Workspace'}
          </button>
        </form>

        {oidcEnabled && (
          <>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              margin: '24px 0 16px 0',
              color: 'var(--color-muted, #64748b)',
              fontSize: '15px',
            }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border, #334155)' }} />
              <span style={{ padding: '0 12px' }}>or connect with</span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border, #334155)' }} />
            </div>

            <button
              type="button"
              onClick={handleSso}
              style={{
                width: '100%',
                padding: '10px 16px',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: '6px',
                color: 'var(--color-fg, #e2e8f0)',
                fontSize: '14.5px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M7 7h10M7 12h10M7 17h10" />
              </svg>
              Enterprise Single Sign-On (OIDC / AD)
            </button>
          </>
        )}

        <div style={{
          marginTop: '28px',
          paddingTop: '18px',
          borderTop: '1px solid var(--color-border, #1e293b)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '15px',
          color: 'var(--color-muted, #94a3b8)',
        }}>
          <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
            ← Back to Product Overview
          </a>
          <a href="/superadmin/login" style={{ color: '#60a5fa', textDecoration: 'none' }}>
            Platform Admin Portal →
          </a>
        </div>
      </div>
    </div>
  );
}
