// ──────────────────────────────────────────────────────
// Hook: useFlightSearch — Socket.io WebSocket client
//
// Manages the connection lifecycle, sends search payloads,
// and accumulates streaming results as they arrive from
// the Python workers via the Node relay.
// ──────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_WS_URL || 'http://localhost:4000';

/**
 * @typedef {Object} FlightResult
 * @property {string}  airline
 * @property {string}  program
 * @property {string}  flightNumber
 * @property {string}  origin
 * @property {string}  destination
 * @property {string}  departure
 * @property {string}  arrival
 * @property {number}  durationMin
 * @property {string}  cabin
 * @property {number}  pointsCost
 * @property {number}  taxesAndFees
 * @property {string}  availability
 * @property {number}  stops
 *
 * @typedef {Object} SegmentResult
 * @property {string}        batchId
 * @property {string}        program
 * @property {'success'|'error'|'rate_limited'|'timeout'} status
 * @property {FlightResult[]} flights
 * @property {string|null}   error
 * @property {object}        meta
 *
 * @typedef {Object} SearchState
 * @property {string|null}      batchId
 * @property {'idle'|'searching'|'complete'|'error'} phase
 * @property {Map<string, SegmentResult>} segments    — keyed by program code
 * @property {number}            totalFlights
 * @property {number}            completedSegments
 * @property {number}            totalSegments
 * @property {string|null}       error
 */

export default function useFlightSearch() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  const [search, setSearch] = useState(/** @type {SearchState} */ ({
    batchId: null,
    phase: 'idle',
    segments: new Map(),
    totalFlights: 0,
    completedSegments: 0,
    totalSegments: 0,
    error: null,
  }));

  // ── Connect on mount, disconnect on unmount ─────────
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });

    socket.on('connect', () => {
      console.log('[WS] Connected:', socket.id);
      setConnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.log('[WS] Disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('[WS] Connection error:', err.message);
      setConnected(false);
    });

    socket.on('connected', (data) => {
      console.log('[WS] Server handshake:', data);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  // ── Listen for streaming results ───────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleSegment = (/** @type {SegmentResult} */ data) => {
      setSearch((prev) => {
        // Accumulate flights per airline program
        const nextSegments = new Map(prev.segments);
        nextSegments.set(data.program, data);

        const allFlights = [];
        for (const seg of nextSegments.values()) {
          if (seg.flights) allFlights.push(...seg.flights);
        }

        const completed = [...nextSegments.values()].filter(
          (s) => s.status === 'success' || s.status === 'relayed'
            || s.status === 'relay_error' || s.status === 'error'
            || s.status === 'rate_limited' || s.status === 'timeout'
        ).length;

        const isComplete = completed >= prev.totalSegments;

        return {
          ...prev,
          phase: isComplete ? 'complete' : 'searching',
          segments: nextSegments,
          totalFlights: allFlights.length,
          completedSegments: completed,
        };
      });
    };

    const handleProgress = (data) => {
      // Could update per-program progress bars
      console.log('[WS] Progress:', data.program, data.message);
    };

    const handleError = (data) => {
      setSearch((prev) => ({
        ...prev,
        phase: 'error',
        error: data.message || 'Unknown server error',
      }));
    };

    socket.on('result:segment', handleSegment);
    socket.on('result:progress', handleProgress);
    socket.on('error', handleError);

    return () => {
      socket.off('result:segment', handleSegment);
      socket.off('result:progress', handleProgress);
      socket.off('error', handleError);
    };
  }, []);

  // ── Search action ──────────────────────────────────
  const submitSearch = useCallback((/** @type {object} */ payload) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setSearch((prev) => ({
        ...prev,
        phase: 'error',
        error: 'Not connected to server.',
      }));
      return;
    }

    // Reset state for new search
    setSearch({
      batchId: null,
      phase: 'searching',
      segments: new Map(),
      totalFlights: 0,
      completedSegments: 0,
      totalSegments: payload.programFilter
        ? payload.programFilter.length
        : 10,  // default: all programs
      error: null,
    });

    // Send with acknowledgement callback
    socket.emit('search:flights', payload, (ack) => {
      if (ack.error) {
        setSearch((prev) => ({
          ...prev,
          phase: 'error',
          error: ack.error,
        }));
        return;
      }
      setSearch((prev) => ({ ...prev, batchId: ack.batchId }));
    });
  }, []);

  const cancelSearch = useCallback(() => {
    const socket = socketRef.current;
    if (socket && search.batchId) {
      socket.emit('search:cancel', search.batchId);
    }
    setSearch({
      batchId: null,
      phase: 'idle',
      segments: new Map(),
      totalFlights: 0,
      completedSegments: 0,
      totalSegments: 0,
      error: null,
    });
  }, [search.batchId]);

  const resetSearch = useCallback(() => {
    setSearch({
      batchId: null,
      phase: 'idle',
      segments: new Map(),
      totalFlights: 0,
      completedSegments: 0,
      totalSegments: 0,
      error: null,
    });
  }, []);

  return {
    connected,
    search,
    submitSearch,
    cancelSearch,
    resetSearch,
  };
}
