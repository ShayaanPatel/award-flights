#!/usr/bin/env python3
# ──────────────────────────────────────────────────────
# Module: TLS Impersonation Worker — Main Loop
#
# Listens to the Redis list (populated by the Node.js
# BullMQ relay), scrapes the airline API using curl_cffi
# with TLS impersonation + proxy rotation, and publishes
# results back to the Node.js server via Redis Pub/Sub.
#
# ── Data flow ─────────────────────────────────────────
#
#   Node BullMQ → Node Relay → [Redis List]  →  Python (this)
#                                                ↓
#                                        curl_cffi scrape
#                                                ↓
#                                    Redis Pub/Sub → Node → Socket.io → Client
#
# ── Running ──────────────────────────────────────────
#
#   # Single worker
#   python -m worker.worker
#
#   # Multiple workers (scale horizontally)
#   for i in {1..4}; do python -m worker.worker &; done
# ──────────────────────────────────────────────────────
from __future__ import annotations

import os
import sys
import json
import time
import signal
import logging
import threading
from typing import Optional

import redis as redis_py

# Ensure package root is on sys.path when running as script
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from worker import config
from worker.proxy_rotator import ProxyRotator
from worker.scraper import scrape, RateLimitError, BlockedError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("Worker")


class FlightWorker:
    """One worker instance = one thread processing jobs forever."""

    def __init__(self, worker_id: int = 0):
        self.worker_id = worker_id
        self.shutdown_flag = threading.Event()

        # ── Redis connections ──────────────────────────
        self._redis_kwargs = {
            "host": config.REDIS_HOST,
            "port": config.REDIS_PORT,
        }
        if config.REDIS_PASSWORD:
            self._redis_kwargs["password"] = config.REDIS_PASSWORD

        # BLPOP connection (blocks indefinitely)
        self._redis_in = redis_py.Redis(
            decode_responses=True,
            socket_keepalive=True,
            socket_timeout=None,         # BLPOP blocks forever
            **self._redis_kwargs,
        )

        # Pub/Sub publisher (for results)
        self._redis_out = redis_py.Redis(
            decode_responses=False,      # We'll serialize ourself
            **self._redis_kwargs,
        )

        # ── Proxy rotator (shared state — could be
        #    externalised to Redis for multi-process). ──
        self.rotator = ProxyRotator()

        # Rate-limiting: track how many consecutive empty
        # polls we've had to avoid busy-looping.
        self._idle_polls = 0

        logger.info(
            "[Worker-%d] Initialised. Redis: %s:%s",
            self.worker_id, config.REDIS_HOST, config.REDIS_PORT,
        )
        logger.info(
            "[Worker-%d] Watching queue '%s'",
            self.worker_id, config.PYTHON_INPUT_QUEUE,
        )

    # ── Main loop ─────────────────────────────────────

    def run(self):
        """Blocking loop: BLPOP → scrape → publish → repeat."""
        logger.info("[Worker-%d] Started.", self.worker_id)
        queue = config.PYTHON_INPUT_QUEUE

        while not self.shutdown_flag.is_set():
            try:
                # ── Block until a job arrives ──────────
                # BLPOP returns (queue_name, payload_json)
                result = self._redis_in.blpop(queue, timeout=5)
                if result is None:
                    # Timeout with no job — loop back and
                    # check shutdown flag.
                    self._idle_polls += 1
                    continue

                self._idle_polls = 0
                _queue_name, payload_json = result

                # Deserialise the job
                job = json.loads(payload_json)
                logger.info(
                    "[Worker-%d] Got job %s | %s: %s → %s",
                    self.worker_id, job.get("jobId"),
                    job["program"], job["origin"], job["destination"],
                )

                # ── Process the job ────────────────────
                self._process_job(job)

            except redis_py.ConnectionError as e:
                logger.error(
                    "[Worker-%d] Redis connection error: %s. Retrying in 5s…",
                    self.worker_id, e,
                )
                time.sleep(5)
            except Exception:
                logger.exception(
                    "[Worker-%d] Unhandled error in main loop", self.worker_id,
                )
                time.sleep(1)

        logger.info("[Worker-%d] Shutdown complete.", self.worker_id)

    # ── Job processing ────────────────────────────────

    def _process_job(self, job: dict):
        """Attempt to scrape, retry with proxy rotation, publish result."""
        start_time = time.time()
        job_id = job.get("jobId", "unknown")
        batch_id = job["batchId"]
        program = job["program"]
        max_retries = job.get("maxRetries", config.MAX_RETRIES)
        retry_count = job.get("retryCount", 0)

        last_error: Optional[str] = None
        flights: list[dict] = []
        proxy_used: Optional[str] = None
        status = "error"

        for attempt in range(max_retries + 1):
            if self.shutdown_flag.is_set():
                return

            # ── Get proxy ────────────────────────────
            proxy = self.rotator.get_proxy()
            if proxy is None:
                # All proxies cooling or burned — wait and retry
                wait = 5 * (attempt + 1)
                logger.warning(
                    "[Worker-%d] No proxy available. Backing off %ds (attempt %d/%d)",
                    self.worker_id, wait, attempt + 1, max_retries + 1,
                )
                self._publish_progress(batch_id, program, {
                    "message": f"Waiting for proxy… (attempt {attempt + 1})",
                    "progress": 10 + attempt * 10,
                })
                time.sleep(wait)
                continue

            proxy_used = proxy

            # ── Get TLS fingerprint (rotate each attempt) ──
            tls_fp = self.rotator.get_tls_fingerprint()

            # Publish progress
            self._publish_progress(batch_id, program, {
                "message": f"Scraping (attempt {attempt + 1}/{max_retries + 1})",
                "progress": 20 + attempt * 15,
            })

            try:
                # ── THE ACTUAL SCRAPE ─────────────────
                flights = scrape(job, proxy, tls_fp)

                # Success — mark proxy healthy and break
                self.rotator.report_success(proxy)
                status = "success"
                last_error = None
                logger.info(
                    "[Worker-%d] ✅ %s: %d flights found (%s)",
                    self.worker_id, program, len(flights), proxy,
                )
                break

            except RateLimitError as e:
                self.rotator.report_429(proxy)
                last_error = f"429 rate limited on {proxy}"
                logger.warning(
                    "[Worker-%d] ⏸  %s %s (attempt %d/%d)",
                    self.worker_id, program, last_error,
                    attempt + 1, max_retries + 1,
                )
                # Continue to retry with a different proxy
                continue

            except BlockedError as e:
                self.rotator.report_429(proxy)  # treat as burned
                last_error = f"Blocked ({e})"
                logger.warning(
                    "[Worker-%d] 🚫 %s %s (attempt %d/%d)",
                    self.worker_id, program, last_error,
                    attempt + 1, max_retries + 1,
                )
                continue

            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                logger.error(
                    "[Worker-%d] ❌ %s scrape error: %s",
                    self.worker_id, program, last_error,
                )
                # Don't penalise proxy for transport errors
                continue

        # ── Publish final result ─────────────────────
        elapsed_ms = int((time.time() - start_time) * 1000)
        self._publish_result(
            batch_id=batch_id,
            job_id=job_id,
            program=program,
            status=status,
            flights=flights,
            error=last_error,
            duration_ms=elapsed_ms,
            proxy_used=proxy_used or "none",
            retry_count=retry_count,
        )

    # ── Redis Pub/Sub publishing ──────────────────────

    def _publish_result(self, **data):
        """Publish to the job's result channel."""
        channel = f"{config.RESULT_CHANNEL_PREFIX}{data['batch_id']}"
        payload = json.dumps({
            "jobId": data["job_id"],
            "batchId": data["batch_id"],
            "program": data["program"],
            "status": data["status"],
            "flights": data["flights"],
            "error": data["error"],
            "durationMs": data["duration_ms"],
            "proxyUsed": data["proxy_used"],
            "retryCount": data["retry_count"],
        })
        self._redis_out.publish(channel, payload)
        logger.info(
            "[Worker-%d] Published result for %s: %s (%d flights, %dms)",
            self.worker_id, data["program"], data["status"],
            len(data["flights"]), data["duration_ms"],
        )

    def _publish_progress(self, batch_id: str, program: str, data: dict):
        """Publish a progress update."""
        channel = f"{config.PROGRESS_CHANNEL_PREFIX}{batch_id}"
        payload = json.dumps({
            "batchId": batch_id,
            "program": program,
            "message": data.get("message", ""),
            "progress": data.get("progress", 0),
        })
        self._redis_out.publish(channel, payload)

    # ── Shutdown ──────────────────────────────────────

    def stop(self):
        logger.info("[Worker-%d] Shutdown requested…", self.worker_id)
        self.shutdown_flag.set()


# ── CLI entry point ──────────────────────────────────

def main():
    worker_id = int(os.environ.get("WORKER_ID", "0"))
    worker = FlightWorker(worker_id=worker_id)

    # Handle SIGTERM / SIGINT gracefully
    def _signal_handler(signum, frame):
        logger.info("[Worker-%d] Signal %d received.", worker_id, signum)
        worker.stop()

    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    worker.run()


if __name__ == "__main__":
    main()
