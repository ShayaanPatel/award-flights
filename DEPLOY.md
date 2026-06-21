# ───────────────────────────────────────────────────
# Award Flight Search Engine
# ───────────────────────────────────────────────────
#
# Architecture:
#   React Frontend (Vercel)  ←──WebSocket──→ Node.js Backend (Railway/VPS)
#                                              ↓ Bull Queue
#                                         Redis Pub/Sub
#                                              ↓
#                                     Python Workers (curl_cffi)
#
# Deployments:
#   Frontend: https://award-flights-frontend.vercel.app
#
# Backend deployment options:
#   ● Railway.app  — quickest, supports Node + Redis
#   ● Render.com   — WebSockets supported on paid plans
#   ● Fly.io       — best for WebSocket + long-running processes
#   ● VPS (DO/AWS) — full control, run docker-compose.yml
