# FlyPool — Moteur de Convergence

Backend engine for airport ride-sharing with real-time matching, atomic booking, and concurrent access control.

**Challenge:** Senior Backend Engineer (NestJS Expert) — 48h technical test  
**Stack:** NestJS 11 · TypeScript · PostgreSQL 16 + PostGIS 3.4 · Redis 7 · Docker  
**Author:** Tetsopguim Kefoueg Frank Parker · kefoueg@gmail.com

---

## Quick Start (3 commands)
```bash
# 1. Start infrastructure
docker compose up postgres redis -d

# 2. Install dependencies and run migrations
npm install && npx prisma migrate dev && npx prisma generate

# 3. Start the API
npm run start:dev
```

API available at `http://localhost:3000/api`

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20 LTS or 22 |
| npm | 10+ |
| Docker Desktop | 26+ |
| Docker Compose | v2+ |
| k6 | latest (stress test only) |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:
```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | 256-bit secret for access tokens |
| `JWT_REFRESH_SECRET` | 256-bit secret for refresh tokens |
| `JWT_ACCESS_EXPIRY` | Access token expiry (e.g. `15m`) |
| `JWT_REFRESH_EXPIRY` | Refresh token expiry (e.g. `7d`) |
| `PORT` | HTTP port (default `3000`) |

---

## API Endpoints

### Auth
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | Public | Register with role PASSENGER / DRIVER / ADMIN |
| POST | `/api/auth/login` | Public | Login — returns JWT + sets HttpOnly RT cookie |
| POST | `/api/auth/refresh` | Public | Rotate refresh token — returns new access token |
| POST | `/api/auth/logout` | Any | Revoke refresh token immediately |

### Trips
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/trips` | DRIVER | Create trip with departure/arrival coordinates |
| GET | `/api/trips/nearby` | Any | PostGIS spatial search within radius (default 5km) |
| GET | `/api/trips/:id` | Any | Get trip by ID |
| PATCH | `/api/trips/:id/delay` | DRIVER (owner only) | Announce delay — triggers buffer recalculation |

### Bookings
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/bookings` | PASSENGER | Book a trip — atomic with SELECT FOR UPDATE |
| GET | `/api/bookings/my` | PASSENGER | List own bookings |
| GET | `/api/bookings/:id` | Any | Get booking by ID |
| PATCH | `/api/bookings/:id/cancel` | PASSENGER | Cancel booking — restores seat |

### Passenger Flights
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/users/flights` | PASSENGER | Register a flight with check-in and buffer constraints |
| GET | `/api/users/flights` | PASSENGER | List own flights |

---

## Running Tests
```bash
# Unit tests
npm run test

# Unit tests with coverage
npm run test:cov

# Stress test (requires running API + seed)
npm run seed:stress
k6 run tests/stress/booking-concurrency.js
```

---

## Stress Test — Overbooking Proof

The stress test proves zero overbooking under maximum concurrency:
```bash
# Step 1 — seed: creates 1 trip (3 seats) + 100 passengers with tokens
npm run seed:stress

# Step 2 — fire 100 simultaneous booking requests
k6 run tests/stress/booking-concurrency.js

# Step 3 — verify the database directly
# Expected: confirmed_bookings = 3, status = FULL, available_seats = 0
```

**Proven result:**
```
confirmed_bookings: 3
rejected_bookings:  97
server_errors:      0
✓ no overbooking
✓ trip correctly marked FULL
```

---

## Architecture Overview
```
CLIENT LAYER
  Passenger App (REST) · Driver Dashboard (WebSocket + REST) · Admin UI (REST)
        │
NESTJS APPLICATION (NestJS 11 · TypeScript)
  AuthModule        → JWT 15min + Refresh Token HttpOnly + RBAC
  TripsModule       → CRUD + PostGIS ST_DWithin + ownership guard
  BookingsModule    → Atomic CTE booking (SELECT FOR UPDATE)
  MatchingModule    → Buffer de Sécurité Voyageur algorithm
  GatewayModule     → WebSocket /trips namespace < 200ms latency
  EventBus          → EventEmitter2 (booking.confirmed, invalidated, cancelled)
        │
INFRASTRUCTURE (Docker Compose)
  PostgreSQL 16 + PostGIS 3.4   Redis 7
```

---

## Key Technical Decisions

See [DECISIONS.md](./DECISIONS.md) for full justification of every architectural choice.

| Decision | Choice |
|----------|--------|
| Concurrency | CTE atomic SQL — single round-trip, no pool exhaustion |
| Geospatial | PostGIS ST_DWithin + GIST indexes |
| Auth | JWT 15min + bcrypt-hashed RT in DB + HttpOnly cookie |
| Event Bus | EventEmitter2 in-process (Redis Pub/Sub documented for scale-out) |
| ORM | Prisma 7 with PrismaPg adapter + $queryRaw for PostGIS |
