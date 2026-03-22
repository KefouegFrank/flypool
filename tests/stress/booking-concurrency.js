import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────
const confirmedBookings = new Counter('confirmed_bookings');
const rejectedBookings  = new Counter('rejected_bookings');
const serverErrors      = new Counter('server_errors');

// ── Test configuration ────────────────────────────────────────────────────
export const options = {
  scenarios: {
    concurrent_booking: {
      executor: 'shared-iterations',
      vus: 100,          // 100 virtual users firing simultaneously
      iterations: 100,   // exactly 100 booking attempts total
      maxDuration: '60s',
    },
  },
  thresholds: {
    // Every request must be either 201 (confirmed) or 409 (conflict)
    // Any 500 means overbooking or unhandled error — test fails
    'checks{scenario:concurrent_booking}': ['rate==1.0'],
    'server_errors':      ['count==0'],
    'confirmed_bookings': ['count<=3'],  // never more than 3 confirmed
  },
};

// ── Load test data written by seed script ─────────────────────────────────
const testData = JSON.parse(open('../../scripts/stress-test-data.json'));

export default function () {
  // Each VU uses its own passenger token — __VU is 1-indexed
  const vuIndex  = __VU - 1;
  const passenger = testData.tokens[vuIndex];

  if (!passenger) {
    console.error(`No token found for VU ${__VU}`);
    return;
  }

  const payload = JSON.stringify({
    tripId: testData.tripId,
    passengerFlightId: passenger.flightId,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${passenger.jwt}`,
    },
  };

  const res = http.post(
    'http://localhost:3000/api/bookings',
    payload,
    params,
  );

  // ── Assertions ────────────────────────────────────────────────────────
  const isAcceptable = check(res, {
    'no overbooking — status is 201 or 409': (r) =>
      r.status === 201 || r.status === 409,
    'no server errors — status is not 500': (r) =>
      r.status !== 500,
  });

  // Track custom counters
  if (res.status === 201) {
    confirmedBookings.add(1);
  } else if (res.status === 409) {
    rejectedBookings.add(1);
  } else {
    serverErrors.add(1);
    console.error(
      `Unexpected status ${res.status} for VU ${__VU}: ${res.body}`,
    );
  }
}
