// Reservation data layer — parks, sites, and reservations.
//
// IMPORTANT — this is a JSON-file-backed store meant for local development
// and demos only (`npm run dev` / `vercel dev` on your own machine, where
// the filesystem is real and persists between requests).
//
// It will NOT work correctly once deployed to Vercel: production Vercel
// functions run in ephemeral, isolated instances with a read-only
// filesystem (except /tmp, which isn't shared between instances and can be
// wiped at any time). That means two guests could both see the same site
// as "available" and both get charged for it — a real double-booking bug.
//
// Before taking real reservations in production, replace the read/write
// functions at the bottom of this file with calls to a real database
// (Vercel Postgres, Supabase, PlanetScale, etc.) — the functions exported
// above them (getAvailableSites, createPendingReservation, etc.) are the
// stable interface the API routes call, so the swap is contained to this
// one file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'data', 'reservations-db.json');

const SEED = {
  parks: [
    { id: 'best-rv-park', name: 'Best RV Park', location: 'Anytown, USA', timezone: 'America/Chicago' },
  ],
  sites: [
    { id: 'site-1', parkId: 'best-rv-park', name: 'Site 1', type: 'RV — Full Hookup', capacity: 6, nightlyRateCents: 5200 },
    { id: 'site-2', parkId: 'best-rv-park', name: 'Site 2', type: 'RV — Full Hookup', capacity: 6, nightlyRateCents: 5200 },
    { id: 'site-3', parkId: 'best-rv-park', name: 'Site 3', type: 'RV — Full Hookup', capacity: 6, nightlyRateCents: 5200 },
    { id: 'site-4', parkId: 'best-rv-park', name: 'Site 4', type: 'RV — Full Hookup', capacity: 6, nightlyRateCents: 5200 },
    { id: 'site-5', parkId: 'best-rv-park', name: 'Site 5', type: 'RV — Full Hookup', capacity: 6, nightlyRateCents: 5200 },
    { id: 'site-6', parkId: 'best-rv-park', name: 'Site 6', type: 'Pull-Through Premium', capacity: 8, nightlyRateCents: 6500 },
    { id: 'site-7', parkId: 'best-rv-park', name: 'Site 7', type: 'Pull-Through Premium', capacity: 8, nightlyRateCents: 6500 },
    { id: 'site-8', parkId: 'best-rv-park', name: 'Site 8', type: 'Tent / Primitive', capacity: 4, nightlyRateCents: 3500 },
    { id: 'site-9', parkId: 'best-rv-park', name: 'Site 9', type: 'Tent / Primitive', capacity: 4, nightlyRateCents: 3500 },
  ],
  reservations: [],
};

const BOOKING_FEE_CENTS = 150; // the platform fee charged per reservation, per the $1-2/booking model
const PENDING_HOLD_MINUTES = 20; // how long a site is held while a guest is mid-checkout

function loadDb() {
  try {
    if (!existsSync(DB_PATH)) {
      mkdirSync(dirname(DB_PATH), { recursive: true });
      writeFileSync(DB_PATH, JSON.stringify(SEED, null, 2));
      return structuredClone(SEED);
    }
    return JSON.parse(readFileSync(DB_PATH, 'utf-8'));
  } catch {
    // Read-only filesystem (production Vercel) — fall back to in-memory seed data
    // for this single invocation rather than crashing. See file header.
    return structuredClone(SEED);
  }
}

function saveDb(db) {
  try {
    writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch {
    // Read-only filesystem — nothing we can do here without a real database.
    // See file header.
  }
}

function nightsBetween(checkIn, checkOut) {
  const ms = new Date(checkOut) - new Date(checkIn);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  // Checkout day doesn't count as occupied — a guest leaving on the 10th
  // doesn't block a new guest checking in on the 10th.
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

function isReservationActive(r) {
  if (r.status === 'confirmed') return true;
  if (r.status === 'pending') return new Date(r.holdExpiresAt) > new Date();
  return false;
}

export function getPark(parkId) {
  return loadDb().parks.find((p) => p.id === parkId) || null;
}

export function getAvailableSites(parkId, checkIn, checkOut) {
  if (!checkIn || !checkOut || new Date(checkOut) <= new Date(checkIn)) return [];
  const db = loadDb();
  const nights = nightsBetween(checkIn, checkOut);
  const sites = db.sites.filter((s) => s.parkId === parkId);
  const activeReservations = db.reservations.filter((r) => r.parkId === parkId && isReservationActive(r));

  return sites
    .filter((site) => !activeReservations.some((r) => r.siteId === site.id && rangesOverlap(checkIn, checkOut, r.checkIn, r.checkOut)))
    .map((site) => ({ ...site, nights, subtotalCents: site.nightlyRateCents * nights, feeCents: BOOKING_FEE_CENTS, totalCents: site.nightlyRateCents * nights + BOOKING_FEE_CENTS }));
}

export function getSite(siteId) {
  return loadDb().sites.find((s) => s.id === siteId) || null;
}

export function createPendingReservation({ parkId, siteId, checkIn, checkOut, guestName, guestEmail, guestPhone }) {
  const db = loadDb();
  const site = db.sites.find((s) => s.id === siteId && s.parkId === parkId);
  if (!site) throw new Error('Unknown site');

  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) throw new Error('Invalid date range');

  const stillAvailable = getAvailableSites(parkId, checkIn, checkOut).some((s) => s.id === siteId);
  if (!stillAvailable) throw new Error('Site is no longer available for those dates');

  const reservation = {
    id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parkId, siteId, checkIn, checkOut, nights,
    guestName, guestEmail, guestPhone,
    subtotalCents: site.nightlyRateCents * nights,
    feeCents: BOOKING_FEE_CENTS,
    totalCents: site.nightlyRateCents * nights + BOOKING_FEE_CENTS,
    status: 'pending',
    holdExpiresAt: new Date(Date.now() + PENDING_HOLD_MINUTES * 60 * 1000).toISOString(),
    stripeSessionId: null,
    createdAt: new Date().toISOString(),
  };
  db.reservations.push(reservation);
  saveDb(db);
  return reservation;
}

export function attachStripeSession(reservationId, stripeSessionId) {
  const db = loadDb();
  const r = db.reservations.find((x) => x.id === reservationId);
  if (!r) return null;
  r.stripeSessionId = stripeSessionId;
  saveDb(db);
  return r;
}

export function confirmReservationBySessionId(stripeSessionId) {
  const db = loadDb();
  const r = db.reservations.find((x) => x.stripeSessionId === stripeSessionId);
  if (!r) return null;
  r.status = 'confirmed';
  saveDb(db);
  return r;
}

export function getReservation(reservationId) {
  return loadDb().reservations.find((r) => r.id === reservationId) || null;
}
