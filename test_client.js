/**
 * Integration test: connects via Socket.io, dispatches a
 * search, and prints streaming results as they arrive.
 */
const { io } = require('socket.io-client');

const socket = io('http://localhost:4000', {
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log('✅ Connected:', socket.id);

  // Query queue status first
  socket.emit('queue:status', (metrics) => {
    console.log('📊 Queue metrics:', JSON.stringify(metrics));
  });

  // Send a search
  const payload = {
    from: 'JFK',
    to: 'LHR',
    date: '2026-10-12',
    passengers: 1,
    // Search only 2 programs to keep things fast
    programFilter: ['EK', 'BA'],
  };

  console.log('🔍 Sending search:', JSON.stringify(payload));

  socket.emit('search:flights', payload, (ack) => {
    console.log('📨 Dispatch ACK:', JSON.stringify(ack));
  });
});

socket.on('connected', (data) => {
  console.log('🤝 Server handshake:', JSON.stringify(data));
});

socket.on('result:segment', (data) => {
  console.log(`\n📦 Segment: ${data.program} | ${data.status}`);
  console.log(`   Flights: ${data.flights?.length || 0}`);
  console.log(`   Duration: ${data.meta?.durationMs}ms`);
  if (data.error) console.log(`   Error: ${data.error}`);
  if (data.flights?.length > 0) {
    console.log(`   First: ${data.flights[0].airline} ${data.flights[0].flightNumber} | ` +
      `${data.flights[0].pointsCost} pts + $${data.flights[0].taxesAndFees}`);
  }
});

socket.on('result:progress', (data) => {
  console.log(`⏳ Progress ${data.program}: ${data.message} (${data.progress}%)`);
});

socket.on('error', (err) => {
  console.log('❌ Server error:', JSON.stringify(err));
});

socket.on('disconnect', (reason) => {
  console.log('👋 Disconnected:', reason);
  process.exit(0);
});

// Timeout after 15 seconds
setTimeout(() => {
  console.log('⏰ Timeout — closing');
  socket.close();
  process.exit(0);
}, 15000);
