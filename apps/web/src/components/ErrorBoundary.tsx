import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Stops one bad render from blanking the whole application.
 *
 * Without a boundary, any exception thrown during render unmounts the entire
 * React tree and the user is left staring at a white page with no explanation
 * and no way forward — which is exactly what happened when a 404 left a query
 * result undefined. On an internal tool with no error reporting service, a
 * blank page is also an unreportable bug: the user cannot tell you what broke.
 */
interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser console is the only diagnostic available here.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-6)' }}>
        <div role="alert" className="card" style={{ borderColor: 'var(--color-accent)' }}>
          <h4 style={{ margin: 0 }}>Something went wrong</h4>
          <p className="card-body" style={{ margin: 0 }}>
            This page failed to render. Your data has not been changed.
          </p>
          <pre style={{
            margin: 'var(--space-3) 0 0', padding: 'var(--space-2)',
            overflowX: 'auto', fontSize: 12,
            background: 'color-mix(in srgb, var(--color-text) 5%, transparent)',
          }}>
            {this.state.error.message}
          </pre>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <button className="btn btn-secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <a href="/" className="btn btn-secondary">Back to my goals</a>
          </div>
        </div>
      </div>
    );
  }
}
