-- ── Verification 1: confirmed bookings must equal initial seat count ──────
SELECT
  COUNT(*) AS confirmed_bookings,
  CASE
    WHEN COUNT(*) = 3 THEN '✅ PASS — no overbooking'
    WHEN COUNT(*) > 3 THEN '❌ FAIL — OVERBOOKING DETECTED'
    ELSE '✅ PASS — under limit'
  END AS result
FROM bookings
WHERE trip_id = :'TRIP_ID'
  AND status = 'CONFIRMED';

-- ── Verification 2: trip final state ─────────────────────────────────────
SELECT
  available_seats,
  status,
  CASE
    WHEN available_seats = 0 AND status = 'FULL'
      THEN '✅ PASS — trip correctly marked FULL'
    ELSE '❌ FAIL — trip state inconsistent'
  END AS result
FROM trips
WHERE id = :'TRIP_ID';
