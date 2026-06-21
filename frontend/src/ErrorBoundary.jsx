import React from 'react';

/**
 * ErrorBoundary — catches render crashes so the app
 * never goes white. Shows a recoverable error card instead.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: 40,
          background: '#0f172a',
          color: '#e2e8f0',
          fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        }}>
          <div style={{
            background: '#1e293b',
            borderRadius: 16,
            padding: 32,
            maxWidth: 560,
            border: '1px solid #334155',
          }}>
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>⚠️ Something went wrong</h1>
            <p style={{ color: '#94a3b8', marginBottom: 16, lineHeight: 1.5 }}>
              The app crashed while rendering. This is usually a temporary issue.
            </p>
            <pre style={{
              background: '#0f172a',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              color: '#f87171',
              overflowX: 'auto',
              marginBottom: 20,
              fontFamily: 'monospace',
            }}>
              {this.state.error.message}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                padding: '10px 24px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🔄 Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
