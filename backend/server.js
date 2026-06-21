// ──────────────────────────────────────────────────────
// Module: WebSocket Backend (Express + Socket.io)
// Role:  Accept search payloads from clients, dispatch
//        to BullMQ, stream results back via Socket.io.
//
// Architecture:
//   Client ──WS──> Socket.io Server ──BullMQ──> Python Workers
//                     ↑                               │
//                     │   Redis Pub/Sub               │
//                     └──── job:result:<id> ◄──────────┘
// ──────────────────────────────────────────────────────
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const redis = require('./redis');
const relay = require('./jobRelay');
const { dispatchSearch, getQueueMetrics, closeQueue } = require('./queue');

// ── Express app ─────────────────────────────────────
const app = express();
app.use(express.json());

// Health-check endpoint (useful for k8s / docker health probes)
app.get('/health', async (_req, res) => {
  try {
    const metrics = await getQueueMetrics();
    res.json({ status: 'ok', queue: metrics, uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

// Quick queue dashboard
app.get('/metrics', async (_req, res) => {
  const metrics = await getQueueMetrics();
  res.json(metrics);
});

// ── HTTP + Socket.io server ─────────────────────────
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.CORS_ORIGIN, methods: ['GET', 'POST'] },
  // Socket.io with Redis adapter for horizontal scaling:
  // When you run multiple Node instances behind a load balancer,
  // uncomment below so rooms and events broadcast across processes.
  // adapter: require('@socket.io/redis-adapter')(redis.getPublisher(), redis.getSubscriber()),
});

// ── Connection lifecycle ────────────────────────────
io.on('connection', (socket) => {
  const clientId = socket.id;
  console.log(`[WS] Client connected: ${clientId}`);

  // Track which batch jobs this socket cares about so we
  // can cleanly unsubscribe on disconnect.
  const activeJobs = new Set();

  // ── Client sends a search ──────────────────────────
  socket.on('search:flights', async (payload, ackCallback) => {
    // Validate payload
    if (!payload || !payload.from || !payload.to || !payload.date) {
      const errMsg = 'Missing required fields: from, to, date';
      if (ackCallback) ackCallback({ error: errMsg });
      else socket.emit('error', { message: errMsg });
      return;
    }

    // Acknowledge immediately with the batchId so the client
    // can show "Searching 10 airlines…" before data arrives.
    try {
      // ── 1. Generate batchId BEFORE dispatching ──────
      // This ensures we can subscribe to Pub/Sub channels before
      // the Python worker processes jobs, avoiding the race
      // condition where the worker publishes results before
      // our subscriber is listening.
      const batchId = uuidv4();
      activeJobs.add(batchId);

      // ── 2. Subscribe to Redis Pub/Sub FIRST ──────────
      // Every Python worker publishes to a result channel
      // keyed by batchId.  We subscribe once per batch and
      // forward every incoming result to the client.
      const unsubResult = await redis.onJobResult(batchId, (data) => {
        // Forward to the specific client over Socket.io
        socket.emit('result:segment', {
          batchId,
          program: data.program,
          status: data.status,          // 'success' | 'error' | 'rate_limited' | 'timeout'
          flights: data.flights || [],
          error: data.error || null,
          meta: {
            durationMs: data.durationMs,
            proxyUsed: data.proxyUsed,
            retryCount: data.retryCount,
            timestamp: data.timestamp,
          },
        });
        console.log(
          `[WS → ${clientId}] Segment result for ${data.program}: ` +
          `${data.flights ? data.flights.length : 0} flights (${data.status})`
        );
      });

      // Also subscribe to progress updates (e.g., "fetching page 2 of 5")
      const unsubProgress = await redis.onJobProgress(batchId, (data) => {
        socket.emit('result:progress', {
          batchId,
          program: data.program,
          message: data.message,
          progress: data.progress,      // 0–100
        });
      });

      // Store cleanup functions so disconnect can drop them
      activeJobs._cleanup = activeJobs._cleanup || new Map();
      activeJobs._cleanup.set(batchId, async () => {
        (await unsubResult)();
        (await unsubProgress)();
      });

      // ── 3. NOW dispatch to Bull queue ───────────────
      // At this point our subscriber is ready and won't miss
      // any results the Python worker publishes.
      const dispatchBatchId = await dispatchSearch(payload, clientId, batchId);

      if (ackCallback) ackCallback({ status: 'dispatched', batchId });
      console.log(`[WS] ${clientId} dispatched batch ${batchId}`);

    } catch (err) {
      console.error(`[WS] dispatch error for ${clientId}:`, err.message);
      if (ackCallback) ackCallback({ error: err.message });
      else socket.emit('error', { message: err.message });
    }
  });

  // ── Client asks for queue status ───────────────────
  socket.on('queue:status', async (ackCallback) => {
    try {
      const metrics = await getQueueMetrics();
      if (ackCallback) ackCallback(metrics);
      else socket.emit('queue:status', metrics);
    } catch (err) {
      if (ackCallback) ackCallback({ error: err.message });
    }
  });

  // ── Client cancels a batch ─────────────────────────
  socket.on('search:cancel', (batchId) => {
    console.log(`[WS] ${clientId} cancelled batch ${batchId}`);
    // BullMQ doesn't support batch cancellation natively,
    // but we could iterate and remove jobs by batchId:
    //   const jobs = await scrapeQueue.getJobs(['active', 'waiting']);
    //   jobs.filter(j => j.data.batchId === batchId).forEach(j => j.remove());
    // For now, just notify the client.
    socket.emit('result:cancelled', { batchId });
    cleanupBatch(batchId);
  });

  // ── Cleanup on disconnect ──────────────────────────
  socket.on('disconnect', async (reason) => {
    console.log(`[WS] Client disconnected: ${clientId} (${reason})`);

    // Unsubscribe from all Redis channels for this client
    for (const batchId of activeJobs) {
      await cleanupBatch(batchId);
    }
  });

  async function cleanupBatch(batchId) {
    if (activeJobs._cleanup && activeJobs._cleanup.has(batchId)) {
      await activeJobs._cleanup.get(batchId)();
      activeJobs._cleanup.delete(batchId);
    }
    activeJobs.delete(batchId);
  }

  // Send a welcome event confirming connection
  socket.emit('connected', {
    clientId,
    supportedAirlines: config.AIRLINE_PROGRAMS.map((p) => p.code),
    serverTime: new Date().toISOString(),
  });
});

// ── Boot ────────────────────────────────────────────
async function start() {
  // Initialise Redis pub/sub clients
  await redis.connect();

  // Start the BullMQ → Python relay worker
  relay.start();

  server.listen(config.SERVER_PORT, () => {
    console.log(`[Server] Award Flight Search Engine — http://0.0.0.0:${config.SERVER_PORT}`);
    console.log(`[Server] Redis at ${config.REDIS_HOST}:${config.REDIS_PORT}`);
    console.log(`[Server] Queue "${config.SCRAPE_QUEUE_NAME}" ready`);
    console.log(`[Server] ${config.AIRLINE_PROGRAMS.length} airline programs loaded`);
  });
}

start().catch((err) => {
  console.error('[Server] Fatal boot error:', err);
  process.exit(1);
});

// ── Graceful shutdown ───────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM — draining…');
  io.close();
  await redis.disconnect();
  await relay.shutdown();
  await closeQueue();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT — draining…');
  io.close();
  await redis.disconnect();
  await relay.shutdown();
  await closeQueue();
  process.exit(0);
});
