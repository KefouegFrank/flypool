import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter } as any);

const BASE_URL = 'http://localhost:3000/api';
const PASSENGER_PASSWORD = 'StressTest123!';
const BCRYPT_ROUNDS = 12;

// Trip: Douala Centre -> Airport
// Departure: 2026-06-01 08:00 UTC
// Flight: 2026-06-01 14:00 UTC
// checkin: 90min, buffer: 30min
// deadline: 12:00 — eta: 08:00 + 90min transit = 09:30 — VALID
const TRIP_DEPARTURE = new Date('2026-06-01T08:00:00.000Z');
const FLIGHT_TIME = new Date('2026-06-01T14:00:00.000Z');
const TOTAL_SEATS = 3;
const TOTAL_PASSENGERS = 100;

async function main() {
  console.log('Starting stress test seed...\n');

  // ── 1. Clean previous stress test data ──────────────────────────────────
  console.log('Cleaning previous stress test data...');
  await prisma.booking.deleteMany({
    where: { passenger: { email: { contains: 'stress-' } } },
  });
  await prisma.passengerFlight.deleteMany({
    where: { user: { email: { contains: 'stress-' } } },
  });
  await prisma.trip.deleteMany({
    where: { driver: { email: 'stress-driver@flypool.test' } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: 'stress-' } },
  });
  console.log('✅ Cleaned\n');

  // ── 2. Create the stress test driver ────────────────────────────────────
  console.log('Creating stress test driver...');
  const driverPasswordHash = await bcrypt.hash(PASSENGER_PASSWORD, BCRYPT_ROUNDS);
  const driver = await prisma.user.create({
    data: {
      email: 'stress-driver@flypool.test',
      passwordHash: driverPasswordHash,
      role: 'DRIVER',
    },
  });
  console.log(`✅ Driver created: ${driver.id}\n`);

  // ── 3. Create the trip with exactly 3 seats ──────────────────────────────
  console.log(`Creating trip with ${TOTAL_SEATS} seats...`);
  const trip = await prisma.trip.create({
    data: {
      driverId: driver.id,
      departureTime: TRIP_DEPARTURE,
      availableSeats: TOTAL_SEATS,
      status: 'ACTIVE',
    },
  });

  // Set geography points via raw SQL
  await prisma.$executeRaw`
    UPDATE trips
    SET
      departure_point = ST_SetSRID(ST_MakePoint(9.7085, 4.0511), 4326)::geography,
      arrival_point   = ST_SetSRID(ST_MakePoint(9.7195, 3.9742), 4326)::geography
    WHERE id = ${trip.id}
  `;
  console.log(`✅ Trip created: ${trip.id}\n`);

  // ── 4. Create 100 passengers + flights + JWT tokens ──────────────────────
  console.log(`👥 Creating ${TOTAL_PASSENGERS} passengers...`);
  const tokens: Array<{
    passengerIndex: number;
    passengerId: string;
    flightId: string;
    jwt: string;
  }> = [];

  for (let i = 1; i <= TOTAL_PASSENGERS; i++) {
    const email = `stress-passenger-${i}@flypool.test`;
    const passwordHash = await bcrypt.hash(PASSENGER_PASSWORD, BCRYPT_ROUNDS);

    const passenger = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'PASSENGER',
      },
    });

    const flight = await prisma.passengerFlight.create({
      data: {
        userId: passenger.id,
        flightNumber: `CM${400 + i}`,
        terminal: 'A',
        flightTime: FLIGHT_TIME,
        checkinDurationMins: 90,
        safetyBufferMins: 30,
      },
    });

    // Get JWT token via login endpoint
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSENGER_PASSWORD }),
    });

    const loginData = await loginRes.json() as any;

    if (!loginData.accessToken) {
      throw new Error(`Failed to get token for passenger ${i}: ${JSON.stringify(loginData)}`);
    }

    tokens.push({
      passengerIndex: i,
      passengerId: passenger.id,
      flightId: flight.id,
      jwt: loginData.accessToken,
    });

    if (i % 10 === 0) {
      process.stdout.write(`  ${i}/${TOTAL_PASSENGERS} passengers created\n`);
    }
  }

  console.log(`✅ All ${TOTAL_PASSENGERS} passengers created\n`);

  // ── 5. Write output file for k6 ─────────────────────────────────────────
  const outputDir = path.join(process.cwd(), 'scripts');
  const outputPath = path.join(outputDir, 'stress-test-data.json');

  const output = {
    tripId: trip.id,
    totalSeats: TOTAL_SEATS,
    tokens,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log('stress-test-data.json written\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Trip ID     : ${trip.id}`);
  console.log(`  Total seats : ${TOTAL_SEATS}`);
  console.log(`  Passengers  : ${TOTAL_PASSENGERS}`);
  console.log(`  Output      : ${outputPath}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ Seed complete. Ready to run k6 stress test.\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
