// ──────────────────────────────────────────────────────
// Module: Redis Client + Pub/Sub Helper
// Role:  Wraps ioredis with typed Pub/Sub channels for
//        cross-language (Node ↔ Python) communication.
// ──────────────────────────────────────────────────────
const IORedis = require('ioredis');
const config = require('./config');

let publisher = null;
let subscriber = null;

/** Connect the two dedicated Redis clients (pub + sub). */
function connect() {
  if (publisher && subscriber) return;

  const opts = {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    retryStrategy(times) {
      // Exponential backoff, cap at 30 s
      return Math.min(times * 200, 30000);
    },
  };
  if (config.REDIS_PASSWORD) {
    opts.password = config.REDIS_PASSWORD;
  }

  publisher = new IORedis(opts);
  subscriber = new IORedis(opts);

  publisher.on('error', (err) => console.error('[Redis Pub]', err.message));
  subscriber.on('error', (err) => console.error('[Redis Sub]', err.message));

  console.log('[Redis] Connected — pub + sub clients ready.');
}

// ── Pub/Sub channel naming ───────────────────────────
//
//   Result channel:   "job:result:<jobId>"
//   Progress channel: "job:progress:<jobId>"
//
//   Python workers PUBLISH to "job:result:<jobId>" when
//   they finish scraping an airline segment.
//   The Node subscriber listens on each job's channel.

/** Subscribe to a job's result channel. Returns an async iterator-like callback. */
function onJobResult(jobId, handler) {
  const channel = `job:result:${jobId}`;
  return subscriber.subscribe(channel, (err, count) => {
    if (err) {
      console.error(`[Redis] Subscribe error on ${channel}:`, err.message);
      return;
    }
    console.log(`[Redis] Subscribed to ${channel} (${count} channels)`);
  }).then(() => {
    subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          handler(JSON.parse(message));
        } catch (e) {
          handler({ raw: message, parseError: e.message });
        }
      }
    });
    // Return an unsubscribe function for cleanup
    return () => subscriber.unsubscribe(channel);
  });
}

/** Subscribe to a job's progress channel. Same pattern as onJobResult. */
function onJobProgress(jobId, handler) {
  const channel = `job:progress:${jobId}`;
  return subscriber.subscribe(channel).then(() => {
    subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          handler(JSON.parse(message));
        } catch (e) {
          handler({ raw: message, parseError: e.message });
        }
      }
    });
    return () => subscriber.unsubscribe(channel);
  });
}

/** Publish a result message (called by BullMQ worker completion handler). */
async function publishResult(jobId, data) {
  const channel = `job:result:${jobId}`;
  const msg = JSON.stringify({
    jobId,
    timestamp: new Date().toISOString(),
    ...data,
  });
  await publisher.publish(channel, msg);
}

/** Publish a progress update. */
async function publishProgress(jobId, data) {
  const channel = `job:progress:${jobId}`;
  const msg = JSON.stringify({
    jobId,
    timestamp: new Date().toISOString(),
    ...data,
  });
  await publisher.publish(channel, msg);
}

/** Disconnect both Redis clients gracefully. */
async function disconnect() {
  if (publisher) { await publisher.quit(); publisher = null; }
  if (subscriber) { await subscriber.quit(); subscriber = null; }
  console.log('[Redis] Disconnected.');
}

module.exports = {
  connect,
  disconnect,
  onJobResult,
  onJobProgress,
  publishResult,
  publishProgress,
  getPublisher: () => publisher,
  getSubscriber: () => subscriber,
};
