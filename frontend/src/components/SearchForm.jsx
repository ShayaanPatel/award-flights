// ──────────────────────────────────────────────────────
// Component: SearchForm
// Renders the airport/date search form and dispatches
// the search to the WebSocket backend.
// ──────────────────────────────────────────────────────
import React, { useState } from 'react';

const AIRLINES = [
  { code: 'AC', name: 'Aeroplan' },
  { code: 'AA', name: 'American AAdvantage' },
  { code: 'UA', name: 'United MileagePlus' },
  { code: 'EK', name: 'Emirates Skywards' },
  { code: 'EY', name: 'Etihad Guest' },
  { code: 'QR', name: 'Qatar Privilege Club' },
  { code: 'SQ', name: 'Singapore KrisFlyer' },
  { code: 'BA', name: 'British Airways Avios' },
  { code: 'CX', name: 'Cathay Asia Miles' },
  { code: 'NH', name: 'ANA Mileage Club' },
];

export default function SearchForm({ onSearch, disabled }) {
  const [origin, setOrigin] = useState('');
  const [destination, setDest] = useState('');
  const [date, setDate] = useState('');
  const [passengers, setPassengers] = useState(1);
  const [selectedPrograms, setSelectedPrograms] = useState(
    AIRLINES.map((a) => a.code)
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!origin || !destination || !date) return;

    onSearch({
      from: origin.toUpperCase().trim(),
      to: destination.toUpperCase().trim(),
      date,
      passengers,
      programFilter: selectedPrograms,
    });
  };

  const toggleProgram = (code) => {
    setSelectedPrograms((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : [...prev, code]
    );
  };

  const selectAll = () => setSelectedPrograms(AIRLINES.map((a) => a.code));
  const selectNone = () => setSelectedPrograms([]);

  // Tomorrow as default minimum date
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);
  const minDateStr = minDate.toISOString().split('T')[0];

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div style={styles.row}>
        <div style={styles.field}>
          <label style={styles.label}>From</label>
          <input
            style={styles.input}
            type="text"
            placeholder="JFK"
            value={origin}
            onChange={(e) => setOrigin(e.target.value.toUpperCase())}
            maxLength={3}
            required
            disabled={disabled}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>To</label>
          <input
            style={styles.input}
            type="text"
            placeholder="LHR"
            value={destination}
            onChange={(e) => setDest(e.target.value.toUpperCase())}
            maxLength={3}
            required
            disabled={disabled}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Date</label>
          <input
            style={styles.input}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={minDateStr}
            required
            disabled={disabled}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Pax</label>
          <input
            style={{ ...styles.input, width: 70 }}
            type="number"
            min={1}
            max={9}
            value={passengers}
            onChange={(e) => setPassengers(parseInt(e.target.value, 10) || 1)}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Airline program selector */}
      <div style={styles.programSection}>
        <div style={styles.programHeader}>
          <span style={styles.programLabel}>Airline Programs</span>
          <div style={styles.programActions}>
            <button type="button" onClick={selectAll} style={styles.actionBtn}>
              All
            </button>
            <button type="button" onClick={selectNone} style={styles.actionBtn}>
              None
            </button>
          </div>
        </div>
        <div style={styles.chipRow}>
          {AIRLINES.map((a) => (
            <button
              key={a.code}
              type="button"
              onClick={() => toggleProgram(a.code)}
              style={{
                ...styles.chip,
                background: selectedPrograms.includes(a.code)
                  ? '#3b82f6'
                  : '#1e293b',
                color: selectedPrograms.includes(a.code) ? '#fff' : '#64748b',
                borderColor: selectedPrograms.includes(a.code)
                  ? '#3b82f6'
                  : '#334155',
              }}
              disabled={disabled}
            >
              {a.code} — {a.name}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        style={{
          ...styles.submitBtn,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        disabled={disabled}
      >
        {disabled ? 'Searching…' : '✈️  Search Award Flights'}
      </button>
    </form>
  );
}

// ── Inline styles (no build step dependency) ────────
const styles = {
  form: {
    background: '#1e293b',
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    border: '1px solid #334155',
  },
  row: {
    display: 'flex',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  field: {
    flex: 1,
    minWidth: 120,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#94a3b8',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#0f172a',
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: 600,
    outline: 'none',
  },
  programSection: {
    marginBottom: 20,
  },
  programHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  programLabel: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#94a3b8',
  },
  programActions: {
    display: 'flex',
    gap: 8,
  },
  actionBtn: {
    background: '#334155',
    border: 'none',
    color: '#94a3b8',
    padding: '4px 12px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    padding: '6px 14px',
    borderRadius: 20,
    border: '1px solid',
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'all 0.15s',
  },
  submitBtn: {
    width: '100%',
    padding: '14px 24px',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
};
