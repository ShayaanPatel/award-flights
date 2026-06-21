// ──────────────────────────────────────────────────────
// Component: ResultsStream
//
// Renders flight search results as they stream in from
// the Python workers.  Each airline program gets a
// collapsible section that fills in as data arrives.
// ──────────────────────────────────────────────────────
import React, { useState } from 'react';

const CABIN_COLORS = {
  economy: '#64748b',
  business: '#f59e0b',
  first: '#8b5cf6',
};

const STATUS_LABELS = {
  success: '✅ Done',
  error: '❌ Failed',
  relayed: '🔄 Queued',
  relay_error: '⚠️ Relay Error',
  rate_limited: '⏸  Rate Limited',
  timeout: '⏰ Timeout',
};

export default function ResultsStream({ search, connected, onCancel, onReset }) {
  const { phase, segments, totalFlights, completedSegments, totalSegments, error } = search;

  if (phase === 'idle') return null;

  const progressPct = totalSegments > 0
    ? Math.round((completedSegments / totalSegments) * 100)
    : 0;

  return (
    <div style={styles.container}>
      {/* Progress header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>
            {phase === 'searching' ? '🔍 Searching…' : '📊 Results'}
          </h2>
          <span style={styles.badge}>
            {totalFlights} flight{totalFlights !== 1 ? 's' : ''}
          </span>
          <span style={styles.badgeSecondary}>
            {completedSegments}/{totalSegments} programs
          </span>
        </div>
        <div style={styles.headerRight}>
          {phase === 'searching' && (
            <button style={styles.cancelBtn} onClick={onCancel}>
              Cancel
            </button>
          )}
          {phase === 'complete' && (
            <button style={styles.newBtn} onClick={onReset}>
              New Search
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {phase === 'searching' && (
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
        </div>
      )}

      {/* Connection warning */}
      {!connected && (
        <div style={styles.warning}>
          ⚠️ Disconnected from server — results may be incomplete.
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={styles.error}>
          ❌ {error}
        </div>
      )}

      {/* Segment results */}
      {[...segments.entries()].map(([program, segment]) => (
        <ProgramSection key={program} segment={segment} />
      ))}

      {/* Empty state for programs that haven't returned yet */}
      {phase === 'searching' && segments.size < totalSegments && (
        <div style={styles.waiting}>
          <div style={styles.spinner} />
          <span>Waiting for {totalSegments - segments.size} program(s)…</span>
        </div>
      )}
    </div>
  );
}

// ── Collapsible per-program result section ─────────
function ProgramSection({ segment }) {
  const [collapsed, setCollapsed] = useState(false);
  const { program, status, flights, error: segError, meta } = segment;

  const isSuccess = status === 'success';
  const flightCount = flights ? flights.length : 0;
  const cabinOrder = ['first', 'business', 'economy'];
  const sorted = flights
    ? [...flights].sort(
        (a, b) => cabinOrder.indexOf(a.cabin) - cabinOrder.indexOf(b.cabin)
      )
    : [];

  return (
    <div style={{
      ...styles.segment,
      borderLeft: `4px solid ${isSuccess ? '#22c55e' : '#ef4444'}`,
    }}>
      <div
        style={styles.segmentHeader}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={styles.segTitle}>
          <span style={styles.programCode}>{program}</span>
          <span style={styles.segStatus}>
            {STATUS_LABELS[status] || status}
          </span>
          {isSuccess && (
            <span style={styles.flightCount}>{flightCount} flights</span>
          )}
        </div>
        <div style={styles.segMeta}>
          {meta?.durationMs && (
            <span style={styles.metaText}>{meta.durationMs}ms</span>
          )}
          <span style={styles.collapseIcon}>{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>

      {!collapsed && (
        <div style={styles.segmentBody}>
          {segError && (
            <div style={styles.segError}>⚠️ {segError}</div>
          )}
          {isSuccess && sorted.length === 0 && (
            <div style={styles.noFlights}>No award availability found.</div>
          )}
          {sorted.map((f, i) => (
            <FlightCard key={i} flight={f} />
          ))}
          {meta?.proxyUsed && (
            <div style={styles.proxyInfo}>
              Proxy: {meta.proxyUsed} | Retries: {meta.retryCount ?? 0}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Individual flight row ──────────────────────────
function FlightCard({ flight }) {
  const depTime = flight.departure?.split('T')[1]?.slice(0, 5) || flight.departure;
  const arrTime = flight.arrival?.split('T')[1]?.slice(0, 5) || flight.arrival;
  const hours = Math.floor(flight.durationMin / 60);
  const mins = flight.durationMin % 60;
  const cabinColor = CABIN_COLORS[flight.cabin] || '#64748b';

  const availColors = {
    available: '#22c55e',
    waitlist: '#f59e0b',
    sold_out: '#ef4444',
  };

  return (
    <div style={styles.card}>
      <div style={styles.cardLeft}>
        <span style={styles.flightNum}>{flight.flightNumber}</span>
        <span style={{ ...styles.cabinBadge, background: cabinColor }}>
          {flight.cabin}
        </span>
      </div>
      <div style={styles.cardRoute}>
        <span style={styles.time}>{depTime}</span>
        <span style={styles.airport}>{flight.origin}</span>
      </div>
      <div style={styles.cardArrow}>
        <span style={styles.duration}>{hours}h{mins > 0 ? `${mins}m` : ''}</span>
        <span style={styles.stops}>
          {flight.stops === 0 ? '✈️ Nonstop' : `🔄 ${flight.stops} stop`}
        </span>
      </div>
      <div style={styles.cardRoute}>
        <span style={styles.time}>{arrTime}</span>
        <span style={styles.airport}>{flight.destination}</span>
      </div>
      <div style={styles.cardRight}>
        <span style={styles.points}>
          {flight.pointsCost.toLocaleString()} <span style={styles.pointsLabel}>pts</span>
        </span>
        <span style={styles.taxes}>+${flight.taxesAndFees.toFixed(0)}</span>
        <span style={{
          ...styles.avail,
          color: availColors[flight.availability] || '#94a3b8',
        }}>
          {flight.availability === 'available' ? '✓ Available' : flight.availability}
        </span>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────
const styles = {
  container: {
    background: '#1e293b',
    borderRadius: 12,
    padding: 20,
    border: '1px solid #334155',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
  },
  badge: {
    background: '#3b82f6',
    color: '#fff',
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
  },
  badgeSecondary: {
    background: '#334155',
    color: '#94a3b8',
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 13,
  },
  headerRight: {
    display: 'flex',
    gap: 8,
  },
  cancelBtn: {
    background: '#ef4444',
    color: '#fff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
  },
  newBtn: {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
  },
  progressBar: {
    width: '100%',
    height: 6,
    background: '#334155',
    borderRadius: 3,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #3b82f6, #22c55e)',
    borderRadius: 3,
    transition: 'width 0.3s ease',
  },
  warning: {
    background: '#78350f',
    color: '#fb923c',
    padding: '10px 14px',
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 14,
  },
  error: {
    background: '#7f1d1d',
    color: '#fca5a5',
    padding: '10px 14px',
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 14,
  },
  waiting: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 40,
    color: '#64748b',
  },
  spinner: {
    width: 20,
    height: 20,
    border: '2px solid #334155',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  segment: {
    background: '#0f172a',
    borderRadius: 8,
    marginBottom: 10,
    overflow: 'hidden',
  },
  segmentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  segTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  programCode: {
    fontWeight: 700,
    fontSize: 15,
    color: '#e2e8f0',
    minWidth: 36,
  },
  segStatus: {
    fontSize: 13,
    color: '#94a3b8',
  },
  flightCount: {
    background: '#1e3a5f',
    color: '#60a5fa',
    padding: '2px 8px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
  },
  segMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  metaText: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  collapseIcon: {
    fontSize: 11,
    color: '#64748b',
  },
  segmentBody: {
    padding: '0 16px 12px',
  },
  segError: {
    color: '#fca5a5',
    fontSize: 13,
    marginBottom: 8,
  },
  noFlights: {
    color: '#64748b',
    fontSize: 14,
    fontStyle: 'italic',
  },
  proxyInfo: {
    marginTop: 8,
    fontSize: 11,
    color: '#475569',
    fontFamily: 'monospace',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '10px 12px',
    marginBottom: 6,
    background: '#1e293b',
    borderRadius: 8,
    border: '1px solid #334155',
  },
  cardLeft: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    minWidth: 70,
  },
  flightNum: {
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'monospace',
    color: '#94a3b8',
  },
  cabinBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#fff',
    padding: '2px 8px',
    borderRadius: 4,
    textTransform: 'uppercase',
  },
  cardRoute: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  time: {
    fontSize: 16,
    fontWeight: 700,
    fontFamily: 'monospace',
    color: '#e2e8f0',
  },
  airport: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: 600,
  },
  cardArrow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  duration: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  stops: {
    fontSize: 11,
    color: '#64748b',
  },
  cardRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    minWidth: 90,
  },
  points: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fbbf24',
  },
  pointsLabel: {
    fontSize: 11,
    color: '#b45309',
  },
  taxes: {
    fontSize: 11,
    color: '#94a3b8',
  },
  avail: {
    fontSize: 11,
    fontWeight: 600,
  },
};
