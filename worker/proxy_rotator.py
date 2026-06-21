# ──────────────────────────────────────────────────────
# Module: Proxy Rotator with Cooldown Management
#
# Handles:
#   1. Round-robin proxy rotation
#   2. Cooldown tracking after 429 rate-limit responses
#   3. TLS fingerprint rotation
#   4. Burn detection — permanently removes proxies that
#      keep getting rate-limited (TLS fingerprint burned)
# ──────────────────────────────────────────────────────
import time
import random
import threading
from typing import Optional, List
from dataclasses import dataclass, field

from . import config


@dataclass
class ProxyEntry:
    url: str
    cooldown_until: float = 0.0        # epoch seconds; 0 = not cooling
    consecutive_429s: int = 0
    total_requests: int = 0
    total_429s: int = 0
    is_burned: bool = False            # True = permanently removed


class ProxyRotator:
    """Thread-safe round-robin proxy rotator with cooldown management."""

    def __init__(self, proxies: Optional[List[str]] = None):
        self._lock = threading.Lock()

        raw = proxies if proxies is not None else config.PROXY_POOL
        self._proxies: List[ProxyEntry] = [ProxyEntry(url=p) for p in raw]
        self._index = 0

        # Available impersonation strings for TLS rotation.
        # curl_cffi supports these; we cycle through them
        # to further reduce fingerprint correlation.
        self._tls_fingerprints = [
            "chrome120",
            "chrome123",
            "chrome124",
            "safari15_5",
            "safari17_0",
            "edge99",
            "firefox109",
        ]
        self._tls_index = 0

        # How many 429s before we consider a proxy "burned"
        self._burn_threshold = 3

        print(
            f"[ProxyRotator] Initialised with {len(self._proxies)} proxies, "
            f"{len(self._tls_fingerprints)} TLS fingerprints"
        )

    # ── Public API ────────────────────────────────────

    def get_proxy(self) -> Optional[str]:
        """
        Returns the next available (non-cooldown, non-burned) proxy URL.
        If all proxies are cooling, returns None — caller should back off.
        """
        with self._lock:
            now = time.time()
            start_index = self._index
            checked = 0

            while checked < len(self._proxies):
                entry = self._proxies[self._index]
                self._index = (self._index + 1) % len(self._proxies)
                checked += 1

                if entry.is_burned:
                    continue
                if entry.cooldown_until > now:
                    continue

                entry.total_requests += 1
                return entry.url

            # All proxies are cooling or burned.
            # Find the one that will be ready soonest and log it.
            soonest = min(
                (p for p in self._proxies if not p.is_burned),
                key=lambda p: p.cooldown_until,
                default=None,
            )
            if soonest:
                wait = soonest.cooldown_until - now
                print(
                    f"[ProxyRotator] All proxies cooling — next available in "
                    f"{wait:.1f}s ({soonest.url})"
                )
            else:
                print("[ProxyRotator] All proxies are burned — pool exhausted!")
            return None

    def report_429(self, proxy_url: str):
        """
        Mark a proxy as rate-limited. Cooldown is exponential:
        base * 2 ^ (consecutive_429s - 1)
        """
        with self._lock:
            entry = self._find_entry(proxy_url)
            if not entry:
                return

            entry.consecutive_429s += 1
            entry.total_429s += 1

            # Exponential backoff: 30s, 60s, 120s, 240s ...
            cooldown = config.PROXY_COOLDOWN_SECONDS * (
                2 ** (entry.consecutive_429s - 1)
            )
            entry.cooldown_until = time.time() + cooldown

            print(
                f"[ProxyRotator] ⏸  {proxy_url} — 429 (x{entry.consecutive_429s}) "
                f"cooling {cooldown}s"
            )

            # Burn detection: if a proxy hits 429 more than
            # `burn_threshold` times, the TLS fingerprint is
            # likely burned / IP blacklisted.  Permanently
            # remove it from rotation.
            if entry.consecutive_429s >= self._burn_threshold:
                entry.is_burned = True
                print(
                    f"[ProxyRotator] 🔥 {proxy_url} BURNED after "
                    f"{entry.consecutive_429s} consecutive 429s"
                )

    def report_success(self, proxy_url: str):
        """Reset consecutive 429 count on success."""
        with self._lock:
            entry = self._find_entry(proxy_url)
            if entry:
                entry.consecutive_429s = 0

    def get_tls_fingerprint(self) -> str:
        """Return the next TLS fingerprint in rotation."""
        with self._lock:
            fp = self._tls_fingerprints[self._tls_index]
            self._tls_index = (self._tls_index + 1) % len(self._tls_fingerprints)
            return fp

    def get_stats(self) -> dict:
        """Return usage statistics for all proxies."""
        with self._lock:
            return {
                p.url: {
                    "total_requests": p.total_requests,
                    "total_429s": p.total_429s,
                    "is_burned": p.is_burned,
                    "cooling": p.cooldown_until > time.time(),
                    "cooldown_remaining_s": max(
                        0, round(p.cooldown_until - time.time(), 1)
                    ),
                }
                for p in self._proxies
            }

    # ── Internal ──────────────────────────────────────

    def _find_entry(self, url: str) -> Optional[ProxyEntry]:
        for entry in self._proxies:
            if entry.url == url:
                return entry
        return None

    @property
    def active_count(self) -> int:
        with self._lock:
            now = time.time()
            return sum(
                1 for p in self._proxies
                if not p.is_burned and p.cooldown_until <= now
            )

    @property
    def burned_count(self) -> int:
        with self._lock:
            return sum(1 for p in self._proxies if p.is_burned)

    @property
    def cooling_count(self) -> int:
        with self._lock:
            now = time.time()
            return sum(
                1 for p in self._proxies
                if not p.is_burned and p.cooldown_until > now
            )
