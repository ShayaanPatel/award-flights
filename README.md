# ✈️ Award Flight Search Engine

Real-time, on-demand award flight search across **10 airline loyalty programs** using **TLS fingerprint impersonation** to bypass bot protections (Cloudflare/Akamai) without headless browsers.

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────────────────────┐
│   React      │ ◄──────────────► │  Node.js (Express + Socket.io)    │
│   Frontend   │  streaming JSON  │                                  │
└─────────────┘                   │  ┌──────────┐  ┌─────────────┐  │
                                  │  │ BullMQ   │  │ Redis        │  │
                                  │  │ Producer │  │ Pub/Sub      │  │
                                  │  └────┬─────┘  │ Listener     │  │
                                  │       │        └──────┬───────┘  │
                                  └───────┼───────────────┼──────────┘
                                          │               │
                                    BullMQ Queue    Pub/Sub channel
                                    (job dispatch)  (job:result:<id>)
                                          │               │
                                  ┌───────┴───────────────┴──────────┐
                                  │  Node.js Relay (BullMQ Worker)    │
                                  │     ↓                            │
                                  │  Redis List (scrape:inbound)      │
                                  └──────────────────────────────────┘
                                          │
                                    BLPOP (FIFO)
                                          │
                                  ┌───────┴──────────────────────────┐
                                  │  Python Workers (curl_cffi)       │
                                  │                                  │
                                  │  ┌────────────┐  ┌───────────┐  │
                                  │  │ Proxy      │  │ TLS FP    │  │
                                  │  │ Rotator    │  │ Rotator   │  │
                                  │  └────────────┘  └───────────┘  │
                                  │                                  │
                                  │  scrape → parse → publish        │
                                  └──────────────────────────────────┘
```

### Data Flow

1. **Client** sends `{ from: "JFK", to: "LHR", date: "2026-10-12" }` via Socket.io
2. **Node.js** generates a batch UUID, splits into 10 airline-specific jobs, pushes to BullMQ
3. **BullMQ Relay** pops jobs and relays them to a Redis list (`scrape:inbound`)
4. **Python workers** `BLPOP` from the Redis list, scrape the airline's API using `curl_cffi` with Chrome/Safari TLS impersonation + rotating proxies
5. **Python workers** publish results to `job:result:<batchId>` via Redis Pub/Sub
6. **Node.js** receives the Pub/Sub message, forwards it to the correct Socket.io client
7. **React frontend** renders results as they stream in — each airline section pops in as soon as the Python worker finishes

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) + [Docker Compose](https://docs.docker.com/compose/)
- At least one HTTP proxy (for production scraping)

### 1. Clone & Configure

```bash
git clone <repo> award-flights
cd award-flights

# Copy environment template and add your proxies
cp .env.example .env
# Edit .env with your proxy pool:
#   SCRAPER_PROXY_POOL=http://user:pass@proxy1:8000,http://user:pass@proxy2:8000
```

### 2. Launch Everything

```bash
docker compose up --build
```

This starts:
- **Redis** on `:6379`
- **Backend** (Node.js) on `:4000`
- **Python workers** (1 by default; scale with `--scale worker=4`)
- **Frontend** (Vite/React) on `:5173`

Open [http://localhost:5173](http://localhost:5173).

### 3. Scale Workers

```bash
docker compose up --scale worker=8
```

Each worker runs its own BLPOP loop — they compete for jobs from the same Redis list, giving you horizontal parallelism without coordination.

## Running Without Docker

### Backend (Node.js)

```bash
# Install dependencies
npm install

# Start Redis (must be running locally)
redis-server

# Start the server
cp .env.example .env   # configure your REDIS_HOST etc.
node backend/server.js
```

### Workers (Python)

```bash
cd worker
pip install -r requirements.txt

# Single worker
python -m worker.worker

# Multiple workers (terminal 1, 2, 3...)
WORKER_ID=1 python -m worker.worker &
WORKER_ID=2 python -m worker.worker &
```

### Frontend (React)

```bash
cd frontend
npm install
npx vite
```

## Module Deep-Dive

### Step 1: WebSocket Backend (`backend/server.js`)
- Accepts Socket.io connections from clients
- `search:flights` event → validates → calls `dispatchSearch()` → pushes to BullMQ
- Subscribes to Redis Pub/Sub channels per batch ID → forwards `result:segment` events to the correct socket
- Cleanup on disconnect: unsubscribes from all Redis channels

### Step 2: TLS Impersonation Worker (`worker/worker.py` + `worker/scraper.py`)
- **`worker.py`** — Main loop: `BLPOP` from Redis list → call `scrape()` → publish result
- **`scraper.py`** — Ten airline-specific scraper functions + mock data layer
- Uses `curl_cffi`'s `requests.Session(impersonate="chrome120")` to spoof browser TLS fingerprints
- Supports: Chrome 120, Chrome 123, Safari 17.0, Edge 99, Firefox 109 (rotated automatically)

### Step 3: Proxy Rotation (`worker/proxy_rotator.py`)
- Round-robin proxy selection with thread-safe locking
- **429 handling**: Exponential cooldown per proxy (30s → 60s → 120s → ...)
- **Burn detection**: After 3 consecutive 429s, permanently removes proxy from rotation (TLS fingerprint is burned / IP blacklisted)
- When all proxies are cooling, returns `None` and the worker backs off

### Step 4: React Frontend (`frontend/`)
- `useFlightSearch` hook: Socket.io connection management, streaming result accumulation
- `SearchForm`: Origin/destination/date inputs + airline program selector
- `ResultsStream`: Per-program collapsible sections that appear as data streams in
- Real-time progress bar, connection status indicator, error handling

## Rate-Limit & Proxy Rotation Strategy

The Python worker implements an **exponential backoff + burn detection** strategy:

```
429 on proxy-A →
  proxy-A cools for 30s × 2^(consecutive_429s - 1)
  next request uses proxy-B (round-robin)
  if proxy-A hits 3 consecutive 429s → permanently BURNED

All proxies cooling →
  worker logs warning, sleeps 5s, tries again
  once any proxy's cooldown expires, resumes work
```

To add a new proxy at runtime, the Rotator's proxy list is read from `SCRAPER_PROXY_POOL` at startup. In production, you'd externalise this to Redis or a config service and hot-reload.

## Adding a Real Airline Scraper

1. **Reverse-engineer** the mobile app or web frontend to find the undocumented API endpoint
2. **Add a scraper function** in `worker/scraper.py` (e.g., `_scrape_jetblue()`)
3. **Register it** in the `SCRAPER_DISPATCH` dict
4. **Replace mock data** with real `curl_cffi` HTTP calls (commented example in `scrape()` function)

The `curl_cffi` real usage pattern:

```python
import curl_cffi.requests as curlreqs

session = curlreqs.Session(impersonate="chrome120")
resp = session.get(
    "https://api.airline.com/v1/award/search",
    params={"origin": "JFK", "destination": "LHR", "date": "2026-10-12"},
    headers={
        "User-Agent": "Mozilla/5.0 ... Chrome/120.0.0.0 Safari/537.36",
        "Authorization": "Bearer <token_from_app>",
        "x-api-key": "<extracted_key>",
        "Origin": "https://www.airline.com",
    },
    proxies={"https": "http://user:pass@proxy:8000"},
    timeout=30,
)
```

## Scaling Considerations

| Component | Scaling Strategy |
|-----------|-----------------|
| **Redis** | Single instance (bottleneck for BLPOP at ~100K ops/s). For higher: Redis Cluster + sharded queues |
| **Node.js** | Stateless — run behind nginx/wrr. Use `@socket.io/redis-adapter` for cross-instance room broadcast |
| **Python Workers** | Stateless — `docker compose up --scale worker=N`. Each BLPOPs independently |
| **Proxy Pool** | Rate-limiting is per-proxy. More proxies = more throughput. 1 proxy ≈ 5-15 RPM per airline |

## Monitoring

- **Health check**: `GET /health` returns queue metrics
- **Queue metrics**: `GET /metrics` shows waiting/active/completed/failed counts
- **Worker stats**: Python workers log proxy usage, 429s, burn events to stdout
- **Socket.io events**: Enable `DEBUG=socket.io:*` on the backend for wire-level tracing

## Licence

MIT
