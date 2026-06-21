// ──────────────────────────────────────────────────────
// Module: Bull → Redis-List Relay
// Role:  Consumes jobs from the Bull queue and pushes
//        them as JSON to a simple Redis list so Python
//        workers can BLPOP without needing the Bull lib.
//
//        This is the cross-language bridge.
// ──────────────────────────────────────────────────────
const Queue = require('bull');
const IORedis = require('ioredis');
const config = require('./config');

// Simple Redis client for pushing to the Python-side queue
// and publishing failure results to Pub/Sub
const outbound = new IORedis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
});

const PYTHON_INPUT_QUEUE = 'scrape:inbound';
const RESULT_PREFIX = 'job:result:';
const PROGRESS_PREFIX = 'job:progress:';

// ── Bull queue (same queue the producer writes to) ──
const scrapeQueue = new Queue(config.SCRAPE_QUEUE_NAME, {
  redis: {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
  },
});

// ── Process jobs (20 concurrent) ────────────────────
// Bull's .process() is the consumer side — we relay
// each job to the Python-side Redis list.
scrapeQueue.process(20, async (job) => {
  const payload = JSON.stringify({
    jobId: job.id,
    batchId: job.data.batchId,
    clientId: job.data.clientId,
    program: job.data.program,
    origin: job.data.origin,
    destination: job.data.destination,
    date: job.data.date,
    passengers: job.data.passengers,
    retryCount: job.data.retryCount || 0,
    maxRetries: job.data.maxRetries || 3,
    proxyCooldown: job.data.proxyCooldown || 30,
  });

  await outbound.rpush(PYTHON_INPUT_QUEUE, payload);

  console.log(
    `[Relay] Job ${job.id} → Python queue | ` +
    `${job.data.program}: ${job.data.origin} → ${job.data.destination}`
  );

  // Return value tells Bull the job completed successfully
  return { relayed: true, jobId: job.id, batchId: job.data.batchId };
});

// ── Event handlers ──────────────────────────────────
scrapeQueue.on('completed', (job) => {
  console.log(`[Relay] ✅ Job ${job.id} completed`);

  // Publish a relayed result to Pub/Sub so the client
  // hears something immediately (Python worker will
  // replace this with real data when it processes the job).
  const channel = `${RESULT_PREFIX}${job.data.batchId}`;
  outbound.publish(channel, JSON.stringify({
    jobId: job.id,
    batchId: job.data.batchId,
    program: job.data.program,
    status: 'relayed',         // Python worker will overwrite with 'success'
    flights: [],
    error: null,
    durationMs: 0,
    proxyUsed: null,
    retryCount: job.data.retryCount,
    timestamp: new Date().toISOString(),
  }));
  console.log(`[Relay] Published relayed result for ${job.data.program}`);
});

scrapeQueue.on('failed', (job, err) => {
  console.error(`[Relay] ❌ Job ${job?.id} failed:`, err.message);
  // Publish an error result to Pub/Sub so the client hears about it
  if (job) {
    const channel = `${RESULT_PREFIX}${job.data.batchId}`;
    outbound.publish(channel, JSON.stringify({
      jobId: job.id,
      batchId: job.data.batchId,
      program: job.data.program,
      status: 'relay_error',
      flights: [],
      error: `Bull relay failed: ${err.message}`,
      durationMs: 0,
      retryCount: job.attemptsMade,
    }));
  }
});

scrapeQueue.on('error', (err) => {
  console.error('[Relay] Queue error:', err.message);
});

// ── Lifecycle ───────────────────────────────────────
function start() {
  console.log('[Relay] Bull → Python relay started');
  console.log(`[Relay] Watching queue: "${config.SCRAPE_QUEUE_NAME}"`);
  console.log(`[Relay] Relaying to Redis list: "${PYTHON_INPUT_QUEUE}"`);
}

async function shutdown() {
  console.log('[Relay] Shutting down…');
  await scrapeQueue.close();
  await outbound.quit();
}

module.exports = { start, shutdown };
