// ──────────────────────────────────────────────────────
// Module: Bull Queue — Job Dispatch
// Role:  Creates the scrape queue and provides helper
//        functions to push jobs that the Python bridge
//        will relay to Python workers.
// ──────────────────────────────────────────────────────
const Queue = require('bull');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');

// ── Queue instance ──────────────────────────────────
const scrapeQueue = new Queue(config.SCRAPE_QUEUE_NAME, {
  redis: {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
  },
  defaultJobOptions: {
    attempts: 1,               // Retries handled inside Python worker
    backoff: { type: 'fixed', delay: 10_000 },
    removeOnComplete: 100,
    removeOnFail: 200,
    timeout: config.JOB_TIMEOUT_MS,
  },
});

// Log queue events for observability
scrapeQueue.on('ready', () => console.log('[Queue] Bull queue ready'));
scrapeQueue.on('error', (err) => console.error('[Queue] Error:', err.message));

/**
 * Split a user's search into N airline-program jobs.
 *
 * @param {object} searchPayload  — e.g.
 *   { from: "JFK", to: "LHR", date: "2026-10-12", passengers: 1 }
 * @param {string} clientId       — Socket.io socket.id to route results back
 * @param {string} batchId        — Pre-generated batch ID for Pub/Sub ordering
 * @returns {string} The batch jobId
 */
async function dispatchSearch(searchPayload, clientId, batchId) {
  if (!batchId) batchId = uuidv4();
  const { from, to, date, passengers, programFilter } = searchPayload;

  // Decide which airline programs to search
  const programs = programFilter
    ? config.AIRLINE_PROGRAMS.filter((p) => programFilter.includes(p.code))
    : config.AIRLINE_PROGRAMS;

  if (programs.length === 0) {
    throw new Error(`No matching airline programs for filter: ${programFilter}`);
  }

  // Push one Bull job per airline program.
  const jobs = programs.map((program) => ({
    data: {
      batchId,
      clientId,
      program: program.code,
      origin: from.toUpperCase(),
      destination: to.toUpperCase(),
      date,
      passengers: passengers || 1,
      retryCount: 0,
      maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
      proxyCooldown: parseInt(process.env.PROXY_COOLDOWN_SECONDS, 10) || 30,
    },
    opts: {
      // Deduplication: same program + route + date = same job ID
      // Bull v3 uses jobId for dedup
      jobId: `${program.code}:${from}-${to}:${date}`,
    },
  }));

  await scrapeQueue.addBulk(jobs);
  console.log(
    `[Queue] Dispatched ${jobs.length} jobs for batch ${batchId} ` +
    `(${from} → ${to} on ${date})`
  );

  return batchId;
}

/**
 * Get queue metrics (for status dashboard).
 */
async function getQueueMetrics() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    scrapeQueue.getWaitingCount(),
    scrapeQueue.getActiveCount(),
    scrapeQueue.getCompletedCount(),
    scrapeQueue.getFailedCount(),
    scrapeQueue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

/**
 * Gracefully close the queue (for shutdown).
 */
async function closeQueue() {
  await scrapeQueue.close();
}

module.exports = {
  scrapeQueue,
  dispatchSearch,
  getQueueMetrics,
  closeQueue,
};
