// ──────────────────────────────────────────────────────
// Module: Shared Configuration (loaded from env)
// ──────────────────────────────────────────────────────
require('dotenv/config');

module.exports = {
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: parseInt(process.env.REDIS_PORT, 10) || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,

  // The BullMQ queue name Python workers listen on
  SCRAPE_QUEUE_NAME: 'scrape-flight-awards',

  // Which airlines / programs this instance can search
  // Each entry maps to a different "worker type" the
  // Python side knows how to handle.
  AIRLINE_PROGRAMS: [
    { code: 'AC', name: 'Air Canada Aeroplan' },
    { code: 'AA', name: 'American AAdvantage' },
    { code: 'UA', name: 'United MileagePlus' },
    { code: 'EK', name: 'Emirates Skywards' },
    { code: 'EY', name: 'Etihad Guest' },
    { code: 'QR', name: 'Qatar Privilege Club' },
    { code: 'SQ', name: 'Singapore KrisFlyer' },
    { code: 'BA', name: 'British Airways Avios' },
    { code: 'CX', name: 'Cathay Asia Miles' },
    { code: 'NH', name: 'ANA Mileage Club' },
  ],

  SERVER_PORT: parseInt(process.env.SERVER_PORT, 10) || 4000,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  // How long (ms) before a job times out in BullMQ
  JOB_TIMEOUT_MS: 60_000,
};
