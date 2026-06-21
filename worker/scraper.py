# ──────────────────────────────────────────────────────
# Module: TLS Impersonation Scraper
#
# Uses curl_cffi's `requests` wrapper to make HTTP
# requests with a browser-grade TLS fingerprint.
#
# Design for real airline APIs:
#   Each airline program has a _scrape_XXXX() method that
#   reconstructs the undocumented API call.  Replace the
#   mock endpoints below with real reverse-engineered URLs.
#
# Key concepts demonstrated:
#   ─ curl_cffi.requests with impersonate=chrome120
#   ─ Proxy injection via `proxies` dict
#   ─ Custom headers (User-Agent, Accept, Auth tokens)
#   ─ Rate-limit (429) detection
#   ─ TLS fingerprint rotation between requests
#   ─ Response parsing into uniform FlightResult schema
# ──────────────────────────────────────────────────────
from __future__ import annotations

import time
import json
import random
import logging
from datetime import datetime, timedelta
from typing import Optional

from . import config

logger = logging.getLogger(__name__)

# ── Flight result schema (standardised across airlines) ──
#
# Every airline scraper returns a list of these dicts.
# The frontend renders them without caring which airline
# program they came from.

FLIGHT_SCHEMA = {
    "airline": str,           # "Emirates"
    "program": str,           # "EK"
    "flightNumber": str,      # "EK001"
    "origin": str,            # "JFK"
    "destination": str,       # "LHR"
    "departure": str,         # ISO 8601 datetime
    "arrival": str,           # ISO 8601 datetime
    "durationMin": int,       # 420
    "cabin": str,             # "economy" | "business" | "first"
    "pointsCost": int,        # 62500
    "taxesAndFees": float,    # 125.50
    "availability": str,      # "available" | "waitlist" | "sold_out"
    "stops": int,             # 0 | 1 | 2
}


# ── Airline-specific scrapers ─────────────────────────
# Each function signature: (job_data, proxy_url, tls_fp) -> list[dict]
#
# In production, replace the mock logic with real HTTP calls
# to reverse-engineered internal API endpoints.

def _scrape_aeroplan(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    Air Canada Aeroplan — undocumented API
    Reverse-engineered endpoint example:
      POST https://api.aircanada.com/aeroplan/v1/award/search
      Headers: {
        "x-api-key": "<extracted from app bundle>",
        "apollographql-client-name": "aeroplan-web"
      }
    """
    return _mock_flights(job, "Air Canada", "AC", proxy_used=proxy_url)


def _scrape_aadvantage(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    American Airlines AAdvantage — undocumented GraphQL
    Reverse-engineered endpoint example:
      POST https://api.aa.com/award/v2/search
      Body: {"query": "…"}
    """
    return _mock_flights(job, "American Airlines", "AA", proxy_used=proxy_url)


def _scrape_mileageplus(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    United MileagePlus — undocumented REST
    Reverse-engineered endpoint example:
      GET https://api.united.com/ual/v1/award/calendar?…
      Headers: { "user-agent": "United/4.24.1 (Android)" }
    """
    return _mock_flights(job, "United", "UA", proxy_used=proxy_url)


def _scrape_skywards(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    Emirates Skywards — undocumented JSON API.
    Actual endpoint confirmed at:
      GET https://api.emirates.com/v1/skywards/award/search
      Params: origin, destination, date, cabin
      Headers: { "Authorization": "Bearer <token>" }
    """
    return _mock_flights(job, "Emirates", "EK", proxy_used=proxy_url)


def _scrape_krisflyer(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    Singapore KrisFlyer — undocumented GraphQL
    """
    return _mock_flights(job, "Singapore Airlines", "SQ", proxy_used=proxy_url)


def _scrape_avios(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    British Airways Avios — undocumented API
    """
    return _mock_flights(job, "British Airways", "BA", proxy_used=proxy_url)


def _scrape_etihad(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    Etihad Guest — undocumented REST API.
    """
    return _mock_flights(job, "Etihad", "EY", proxy_used=proxy_url)


def _scrape_qatar(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    Qatar Privilege Club — undocumented GraphQL.
    """
    return _mock_flights(job, "Qatar Airways", "QR", proxy_used=proxy_url)


def _scrape_cathay(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    Cathay Pacific Asia Miles — undocumented REST.
    """
    return _mock_flights(job, "Cathay Pacific", "CX", proxy_used=proxy_url)


def _scrape_ana(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    ANA Mileage Club — undocumented API.
    """
    return _mock_flights(job, "ANA", "NH", proxy_used=proxy_url)


# ── Router ────────────────────────────────────────────

SCRAPER_DISPATCH = {
    "AC": _scrape_aeroplan,
    "AA": _scrape_aadvantage,
    "UA": _scrape_mileageplus,
    "EK": _scrape_skywards,
    "SQ": _scrape_krisflyer,
    "BA": _scrape_avios,
    "EY": _scrape_etihad,
    "QR": _scrape_qatar,
    "CX": _scrape_cathay,
    "NH": _scrape_ana,
}


def scrape(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
    """
    High-level entry point.
    1. Looks up the scraper for the requested program.
    2. Injects proxy + TLS fingerprint.
    3. Returns a list of FlightResult dicts.

    Raises:
      ValueError — if program is unknown.
      RuntimeError — wrapped transport/timeout errors.
    """
    program = job["program"]
    scraper_fn = SCRAPER_DISPATCH.get(program)
    if not scraper_fn:
        raise ValueError(f"Unknown airline program: {program}")

    logger.info(
        "Scraping %s | %s → %s | %s | proxy=%s tls=%s",
        program, job["origin"], job["destination"], job["date"],
        proxy_url, tls_fp,
    )

    # ── Real curl_cffi usage example (commented out) ──
    #
    #   import curl_cffi.requests as curlreqs
    #
    #   session = curlreqs.Session(impersonate=tls_fp)
    #
    #   headers = {
    #       "User-Agent": user_agent_for(tls_fp),
    #       "Accept": "application/json, text/plain, */*",
    #       "Accept-Language": "en-US,en;q=0.9",
    #       "Origin": "https://www.emirates.com",
    #       "Referer": "https://www.emirates.com/",
    #       # Auth token extracted from mobile app binary
    #       "Authorization": f"Bearer {_get_token(program)}",
    #       "x-api-key": _get_api_key(program),
    #   }
    #
    #   proxies = {"https": proxy_url, "http": proxy_url}
    #
    #   resp = session.get(
    #       _get_endpoint(program),
    #       params={"origin": job["origin"], ...},
    #       headers=headers,
    #       proxies=proxies,
    #       timeout=config.REQUEST_TIMEOUT,
    #       # curl_cffi-specific: allow Ja3 to be overridden
    #       ja3=_get_ja3_for(tls_fp),
    #   )
    #
    #   if resp.status_code == 429:
    #       raise RateLimitError(proxy_url, resp)
    #   if resp.status_code == 403:
    #       raise BlockedError(proxy_url, resp)
    #
    #   resp.raise_for_status()
    #   data = resp.json()
    #
    # ── End of real example ────────────────────────────

    return scraper_fn(job, proxy_url, tls_fp)


# ── Error types ───────────────────────────────────────

class RateLimitError(Exception):
    """HTTP 429 — proxy is being rate limited."""
    def __init__(self, proxy_url: str, response=None):
        self.proxy_url = proxy_url
        self.response = response
        super().__init__(f"Rate limited (429) on proxy {proxy_url}")


class BlockedError(Exception):
    """HTTP 403/503 — IP/tls fingerprint is blocked."""
    def __init__(self, proxy_url: str, response=None):
        self.proxy_url = proxy_url
        self.response = response
        super().__init__(f"Blocked ({response.status_code}) on proxy {proxy_url}")


# ── Mock data layer (replace with real HTTP calls) ────

# Cabin-class points tables for realistic mock data
# Format: (origin_region, dest_region) -> { cabin: points }
_AWARD_CHART = {
    ("NA", "EU"): {"economy": 30000, "business": 60000, "first": 85000},
    ("NA", "AS"): {"economy": 35000, "business": 75000, "first": 110000},
    ("NA", "ME"): {"economy": 40000, "business": 85000, "first": 125000},
    ("EU", "AS"): {"economy": 25000, "business": 55000, "first": 80000},
    ("EU", "ME"): {"economy": 15000, "business": 35000, "first": 55000},
    ("AS", "AS"): {"economy": 10000, "business": 20000, "first": 30000},
}

def _region(code: str) -> str:
    if code in ("JFK", "LHR", "CDG", "FRA", "AMS"):
        return "EU"
    if code in ("DXB", "AUH", "DOH"):
        return "ME"
    if code in ("NRT", "HND", "SIN", "HKG", "NRT", "ICN"):
        return "AS"
    return "NA"  # default

def _mock_flights(job: dict, airline: str, program: str, **kwargs) -> list[dict]:
    """Generate realistic-ish mock award flights."""
    origin = job["origin"]
    destination = job["destination"]
    date_str = job["date"]
    passengers = job.get("passengers", 1)

    ori_reg = _region(origin)
    dst_reg = _region(destination)
    chart = _AWARD_CHART.get((ori_reg, dst_reg), _AWARD_CHART.get(("NA", "EU")))

    results = []
    # Generate 2-5 random flight options
    for i in range(random.randint(2, 5)):
        dep_hour = random.randint(0, 23)
        dep_min = random.choice([0, 15, 30, 45])
        duration = random.randint(360, 600)  # 6-10 hours
        arr_hour = (dep_hour + duration // 60) % 24
        arr_min = dep_min

        cabin = random.choice(["economy", "business", "economy", "business", "first"])
        points = chart[cabin] + random.randint(-5000, 5000)
        taxes = round(random.uniform(50, 300), 2)
        stops = 0 if random.random() > 0.3 else 1

        dep_dt = f"{date_str}T{dep_hour:02d}:{dep_min:02d}:00"
        arr_dt = f"{date_str}T{arr_hour:02d}:{arr_min:02d}:00"

        results.append({
            "airline": airline,
            "program": program,
            "flightNumber": f"{program}{random.randint(100, 999)}",
            "origin": origin,
            "destination": destination,
            "departure": dep_dt,
            "arrival": arr_dt,
            "durationMin": duration + stops * 90,
            "cabin": cabin,
            "pointsCost": max(5000, points),
            "taxesAndFees": taxes,
            "availability": random.choices(
                ["available", "available", "available", "waitlist", "sold_out"],
                weights=[40, 30, 20, 8, 2],
            )[0],
            "stops": stops,
        })

    return results


def _mock_flights_factory(airline: str, program: str):
    """Return a bound _mock_flights function for the given airline."""
    def _scrape(job: dict, proxy_url: str, tls_fp: str) -> list[dict]:
        return _mock_flights(job, airline, program)
    return _scrape


# ── Helper: User-Agent strings per TLS fingerprint ────
_USER_AGENTS = {
    "chrome120": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "chrome123": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "safari17_0": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/17.0 Safari/605.1.15"
    ),
    "edge99": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36 Edg/99.0.1150.30"
    ),
}


def user_agent_for(tls_fp: str) -> str:
    return _USER_AGENTS.get(tls_fp, _USER_AGENTS["chrome120"])
