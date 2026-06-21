// ──────────────────────────────────────────────────────
// Module: App — Root Component
//
// Ties the search form and streaming results together.
// ──────────────────────────────────────────────────────
import React from 'react';
import useFlightSearch from './hooks/useFlightSearch';
import SearchForm from './components/SearchForm';
import ResultsStream from './components/ResultsStream';

export default function App() {
  const { connected, search, submitSearch, cancelSearch, resetSearch } =
    useFlightSearch();

  const isSearching = search.phase === 'searching';

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <h1 style={styles.logo}>✈️ Award Flight Search</h1>
          <div style={styles.connectionStatus}>
            <span
              style={{
                ...styles.dot,
                background: connected ? '#22c55e' : '#ef4444',
              }}
            />
            <span style={styles.statusText}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        <p style={styles.subtitle}>
          Real-time award availability across 10 airline programs
        </p>
      </header>

      {/* Main content */}
      <main style={styles.main}>
        <SearchForm onSearch={submitSearch} disabled={isSearching} />
        <ResultsStream
          search={search}
          connected={connected}
          onCancel={cancelSearch}
          onReset={resetSearch}
        />
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <span>Built with React + Socket.io → Node.js → Redis → Python (curl_cffi)</span>
      </footer>

      {/* Spinner animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    maxWidth: 960,
    margin: '0 auto',
    padding: '0 20px',
  },
  header: {
    padding: '28px 0 20px',
    borderBottom: '1px solid #1e293b',
    marginBottom: 24,
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#1e293b',
    padding: '6px 14px',
    borderRadius: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 600,
    color: '#94a3b8',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 6,
  },
  main: {
    flex: 1,
    paddingBottom: 40,
  },
  footer: {
    textAlign: 'center',
    padding: '20px 0',
    color: '#475569',
    fontSize: 12,
    borderTop: '1px solid #1e293b',
  },
};
