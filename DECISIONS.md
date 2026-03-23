# FlyPool — Architecture Decisions

This document justifies every significant technical choice made in the Moteur de Convergence. Each decision is documented with the alternative considered and the explicit reason it was rejected.

---

## 1. Concurrency Strategy — CTE Atomic SQL vs Prisma Interactive Transaction

**Chosen:** Single CTE (Common Table Expression) executed as one raw SQL statement.

**Rejected:** Prisma `$transaction()` interactive callback.

**Why:**

Prisma's interactive transaction opens a database connection and holds it open for the entire callback duration. Under 100 concurrent requests, this exhausts the connection pool regardless of pool size — each transaction queues waiting for a connection while also holding a `SELECT FOR UPDATE` lock, creating a deadlock-like chain that causes 30-60 second timeouts.

The CTE approach executes lock + decrement + insert in a single PostgreSQL round-trip. PostgreSQL handles the transaction internally. The connection is returned to the pool immediately after the statement completes. Under 100 concurrent VUs this completes in under 5 seconds with zero overbooking.

**Proof:** k6 stress test — 100 VUs, 3 seats, result: confirmed=3, rejected=97, errors=0.

**Trade-off:** Raw SQL is less readable than ORM code. Mitigated with detailed inline comments.

---

## 2. Locking Strategy — Pessimistic vs Optimistic

**Chosen:** Pessimistic locking (`SELECT FOR UPDATE` inside the CTE).

**Rejected:** Optimistic locking via `version` field.

**Why:**

Under high contention for a scarce resource (3 seats, 100 requestors), optimistic locking generates 97 retries per successful booking. Each retry is a full round-trip. Under load this creates a thundering herd — all 97 failed transactions immediately retry, compounding the pressure.

Pessimistic locking serialises access at the PostgreSQL level. The first transaction acquires the lock; all others queue at the DB level (not the application level). No retries needed. The `version` field is retained in the schema as a reserved column for future migration to distributed optimistic locking if needed.

---

## 3. ORM — Prisma 7 with PrismaPg Adapter

**Chosen:** Prisma 7 with `@prisma/adapter-pg` and `$queryRaw` for PostGIS columns.

**Rejected:** TypeORM, Drizzle, raw pg.

**Why:**

Prisma provides end-to-end type safety, versioned migrations, and a clean schema-first API. Prisma 7 introduced the driver adapter pattern (`PrismaPg`) which replaces the Rust query engine binary — cleaner deploys, better cold start performance.

PostGIS `GEOGRAPHY` columns are not natively supported by Prisma's type system, so they are managed via raw SQL migrations (`prisma/migrations/add_postgis_columns.sql`) applied after `prisma migrate`. `$queryRaw` is used for all spatial queries (`ST_DWithin`, `ST_Distance`, `ST_MakePoint`).

---

## 4. Event Bus — EventEmitter2 vs Redis Pub/Sub

**Chosen:** EventEmitter2 in-process for this implementation.

**Rejected (deferred):** Redis Pub/Sub.

**Why:**

EventEmitter2 is sufficient for a single-instance deployment (which this challenge targets). It is synchronous within the Node.js event loop — no network hop between booking commit and WebSocket emission. This is what guarantees the sub-200ms latency on the `seat_update` WebSocket event.

**Documented limitation:** In a multi-instance deployment (multiple NestJS pods behind a load balancer), EventEmitter2 does not propagate events between processes. The `SeatUpdateListener → Gateway` pipe would break because the Socket.IO server that has the connected driver socket may be on a different pod than the one that processed the booking.

**Migration path:** Replace EventEmitter2 with Redis Pub/Sub (infrastructure already present). Add `@socket.io/redis-adapter` to the Gateway. No business logic changes required — only the transport layer changes.

---

## 5. Authentication — JWT + Refresh Token Strategy

**Chosen:** Short-lived JWT (15min) in Authorization header + long-lived opaque refresh token (7 days) in HttpOnly Secure cookie.

**Rejected:** Simple long-lived JWT / session tokens.

**Why:**

A long-lived JWT cannot be revoked — if stolen, it is valid until expiry. The chosen pattern eliminates this:

- **Access token** (15min): stateless, validated by signature alone, no DB lookup per request.
- **Refresh token**: opaque UUID stored as a bcrypt hash in the database. Validated by `bcrypt.compare`. Rotated on every use — a stolen RT can only be used once before it is invalidated. Cleared on logout — immediate revocation.
- **HttpOnly cookie**: the refresh token cookie cannot be read by JavaScript — eliminates XSS as an attack vector.

---

## 6. RBAC — Role + Ownership Validation

**Chosen:** Two-layer guard: `RolesGuard` (role check) + explicit ownership validation in service layer.

**Rejected:** Role-only guard.

**Why:**

Role-only RBAC allows any DRIVER to call `PATCH /trips/:id/delay` on any trip. The ownership check (`trip.driverId === req.user.id`) ensures only the driver who created the trip can announce a delay. This is a real security requirement — without it, any driver could sabotage another driver's passengers.

The ownership check is in the service layer (not a guard) because it requires a database read — guards should be stateless where possible.

---

## 7. Matching Algorithm — Buffer de Sécurité Voyageur

**Formula:**
```
deadline  = flight_time - checkin_duration_mins - safety_buffer_mins
eta       = departure_time + delay_minutes + ESTIMATED_TRANSIT_MINS (90)
VALID iff eta <= deadline
```

**Design choices:**

- `ESTIMATED_TRANSIT_MINS` is a constant (90 minutes). In production this would be replaced by a routing API call (Google Maps Distance Matrix). The constant is intentional for the challenge scope — the architecture supports replacing it without touching the matching logic.
- The buffer check runs **twice** for a booking: once before the transaction (early rejection, avoids lock acquisition for obviously invalid requests) and once inside the CTE (against the locked, consistent trip data — catches delays announced between the pre-check and the lock).
- On delay announcement, `recalculateOnDelay()` re-runs the formula against every `CONFIRMED` booking using the `passenger_flight_id` FK — deterministic, no heuristics.

---

## 8. WebSocket Latency Guarantee

**Claim:** `seat_update` event delivered to driver dashboard in < 200ms.

**How:**

The chain is entirely in-process:
```
DB commit → EventEmitter2.emit() → SeatUpdateListener → Gateway.server.to(room).emit()
```

No network hop between the booking commit and the WebSocket emission. Measured latency in testing: 5ms.

**Caveat:** This guarantee holds under normal load (< 20 concurrent transactions). Under the stress test (100 concurrent), PostgreSQL commit latency increases due to lock queue — the < 200ms applies to the emit latency, not the total time from request to WebSocket delivery under extreme load.

---

## 9. PostGIS Migrations — Manual SQL vs Prisma Native

**Chosen:** Manual SQL migration applied after `prisma migrate`.

**Rejected:** Waiting for Prisma native PostGIS support.

**Why:**

Prisma does not support `GEOGRAPHY` column types natively. The workaround is:
1. `prisma migrate dev` creates all standard columns.
2. `prisma/migrations/add_postgis_columns.sql` adds `departure_point` and `arrival_point` as `GEOGRAPHY(POINT, 4326)` with GIST indexes.

This is applied once during setup. All spatial queries use `$queryRaw` with Prisma tagged template literals (parameterised — no SQL injection risk).

---

## 10. Schema — passenger_flight_id on bookings

**Chosen:** Explicit FK from `bookings.passenger_flight_id` to `passenger_flights.id`.

**Rejected:** Inferring the flight from the passenger's "next upcoming flight".

**Why:**

A passenger may have multiple upcoming flights. Without an explicit FK, the matching algorithm must guess which flight the booking is for — introducing ambiguity and potential bugs. The FK makes the relationship deterministic: each booking is unambiguously tied to one specific flight. The `recalculateOnDelay` function uses this FK to re-validate each booking against its exact target flight.
