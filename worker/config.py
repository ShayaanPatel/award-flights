# ──────────────────────────────────────────────────────
# Module: Python Worker — Configuration
# ──────────────────────────────────────────────────────
import os
from typing import List

REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", None)

# The simple Redis list that the Node relay pushes jobs onto.
# Python workers BLPOP from this queue.
PYTHON_INPUT_QUEUE = "scrape:inbound"

# Pub/Sub channel prefix — Node subscribes to these.
RESULT_CHANNEL_PREFIX = "job:result:"
PROGRESS_CHANNEL_PREFIX = "job:progress:"

# ── Proxy Pool ───────────────────────────────────────
PROXY_POOL_RAW: str = os.getenv(
    "SCRAPER_PROXY_POOL",
    "http://user1:pass1@proxy1:8000,http://user2:pass2@proxy2:8000",
)

# Parse into a list, stripping whitespace
PROXY_POOL: List[str] = [p.strip() for p in PROXY_POOL_RAW.split(",") if p.strip()]

# How many seconds to pause a proxy after a 429
PROXY_COOLDOWN_SECONDS: int = int(os.getenv("PROXY_COOLDOWN_SECONDS", "30"))

# Max retries per individual scraping job
MAX_RETRIES: int = int(os.getenv("MAX_RETRIES", "3"))

# Default TLS impersonation fingerprint to use with curl_cffi
DEFAULT_IMPERSONATE: str = os.getenv("DEFAULT_IMPERSONATE", "chrome120")

# Rotate TLS fingerprint on every N requests (to reduce fingerprinting)
TLS_ROTATION_INTERVAL: int = int(os.getenv("TLS_ROTATION_INTERVAL", "5"))

# Timeout for individual HTTP requests (seconds)
REQUEST_TIMEOUT: int = int(os.getenv("REQUEST_TIMEOUT", "30"))
