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
import bcrypt from 'bcryptjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'data', 'reservations-db.json');

// Demo login for every seeded park — staff username = the park's id,
// password = "demo1234" for all three. Real parks get their own
// credentials via createPark() (called from the super-admin dashboard).
const DEMO_PASSWORD_HASH = bcrypt.hashSync('demo1234', 10);

const SEED = {
  // Park names/locations reuse the fictional parks already referenced in
  // the homepage marquee ticker, so the demo data feels consistent across
  // the whole site rather than introducing yet more placeholder names.
  parks: [
    { id: 'best-rv-park', name: 'Best RV Park', location: 'Anytown, USA', state: 'USA', timezone: 'America/Chicago', staffUsername: 'best-rv-park', passwordHash: DEMO_PASSWORD_HASH, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'cedar-bend', name: 'Cedar Bend Campground', location: 'Lakeview, TX', state: 'TX', timezone: 'America/Chicago', staffUsername: 'cedar-bend', passwordHash: DEMO_PASSWORD_HASH, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'blue-ridge', name: 'Blue Ridge RV Resort', location: 'Asheville, NC', state: 'NC', timezone: 'America/New_York', staffUsername: 'blue-ridge', passwordHash: DEMO_PASSWORD_HASH, createdAt: '2026-01-01T00:00:00.000Z' },
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

    { id: 'cb-site-1', parkId: 'cedar-bend', name: 'Site A1', type: 'RV — Full Hookup', capacity: 6, nightlyRateCents: 4500 },
    { id: 'cb-site-2', parkId: 'cedar-bend', name: 'Site A2', type: 'RV — Full Hookup', capacity: 6, nightlyRateCents: 4500 },
    { id: 'cb-site-3', parkId: 'cedar-bend', name: 'Site A3', type: 'RV — Full Hookup', capacity: 6, nightlyRateCents: 4500 },
    { id: 'cb-site-4', parkId: 'cedar-bend', name: 'Lakeside 1', type: 'RV — Lakeside', capacity: 6, nightlyRateCents: 5800 },
    { id: 'cb-site-5', parkId: 'cedar-bend', name: 'Cabin 1', type: 'Cabin', capacity: 4, nightlyRateCents: 9500 },
    { id: 'cb-site-6', parkId: 'cedar-bend', name: 'Tent Site 1', type: 'Tent / Primitive', capacity: 4, nightlyRateCents: 3000 },

    { id: 'br-site-1', parkId: 'blue-ridge', name: 'Ridge 1', type: 'RV — Full Hookup', capacity: 8, nightlyRateCents: 7200 },
    { id: 'br-site-2', parkId: 'blue-ridge', name: 'Ridge 2', type: 'RV — Full Hookup', capacity: 8, nightlyRateCents: 7200 },
    { id: 'br-site-3', parkId: 'blue-ridge', name: 'Ridge 3', type: 'RV — Full Hookup', capacity: 8, nightlyRateCents: 7200 },
    { id: 'br-site-4', parkId: 'blue-ridge', name: 'Mountain View Deluxe', type: 'RV — Premium', capacity: 8, nightlyRateCents: 9800 },
    { id: 'br-site-5', parkId: 'blue-ridge', name: 'Glamping Tent 1', type: 'Glamping', capacity: 4, nightlyRateCents: 11500 },
    { id: 'br-site-6', parkId: 'blue-ridge', name: 'Glamping Tent 2', type: 'Glamping', capacity: 4, nightlyRateCents: 11500 },
    { id: 'br-site-7', parkId: 'blue-ridge', name: 'Cabin Overlook', type: 'Cabin', capacity: 6, nightlyRateCents: 15000 },
  ],
  reservations: [],
  guests: [],
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

export function listParks(locationQuery = '') {
  const db = loadDb();
  const q = locationQuery.trim().toLowerCase();
  return db.parks
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.location.toLowerCase().includes(q) || p.state.toLowerCase().includes(q))
    .map((park) => {
      const sites = db.sites.filter((s) => s.parkId === park.id);
      const rates = sites.map((s) => s.nightlyRateCents);
      return {
        ...park,
        siteCount: sites.length,
        siteTypes: [...new Set(sites.map((s) => s.type))],
        minNightlyRateCents: rates.length ? Math.min(...rates) : null,
        maxNightlyRateCents: rates.length ? Math.max(...rates) : null,
      };
    });
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

/* ---------------------------------------------------------------- */
/* Park accounts (super-admin creates these; park staff log in with them) */
/* ---------------------------------------------------------------- */

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function createPark({ name, location, state = '', timezone = 'America/Chicago', staffUsername, staffPassword }) {
  if (!name || !location || !staffUsername || !staffPassword) throw new Error('Missing required park details');
  if (staffPassword.length < 8) throw new Error('Staff password must be at least 8 characters');

  const db = loadDb();
  const username = slugify(staffUsername);
  if (db.parks.some((p) => p.staffUsername === username)) throw new Error('That staff username is already taken');

  let id = slugify(name);
  if (db.parks.some((p) => p.id === id)) id = `${id}-${Date.now().toString(36)}`;

  const park = {
    id, name, location, state, timezone,
    staffUsername: username,
    passwordHash: bcrypt.hashSync(staffPassword, 10),
    createdAt: new Date().toISOString(),
  };
  db.parks.push(park);
  saveDb(db);
  return park;
}

export function verifyParkLogin(staffUsername, password) {
  const db = loadDb();
  const park = db.parks.find((p) => p.staffUsername === slugify(staffUsername));
  if (!park || !bcrypt.compareSync(password || '', park.passwordHash)) return null;
  return park;
}

// Safe for the super-admin dashboard to display — strips the password hash.
export function listParksForAdmin() {
  const db = loadDb();
  return db.parks.map(({ passwordHash, ...rest }) => ({
    ...rest,
    siteCount: db.sites.filter((s) => s.parkId === rest.id).length,
  }));
}

/* ---------------------------------------------------------------- */
/* Site management (park staff manage their own park's inventory)    */
/* ---------------------------------------------------------------- */

export function getSitesForPark(parkId) {
  return loadDb().sites.filter((s) => s.parkId === parkId);
}

export function addSite(parkId, { name, type, capacity, nightlyRateCents }) {
  if (!name || !type || !capacity || !nightlyRateCents) throw new Error('Missing required site details');
  const db = loadDb();
  if (!db.parks.some((p) => p.id === parkId)) throw new Error('Unknown park');

  const site = {
    id: `site-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parkId, name, type,
    capacity: Number(capacity),
    nightlyRateCents: Number(nightlyRateCents),
  };
  db.sites.push(site);
  saveDb(db);
  return site;
}

export function updateSite(siteId, parkId, updates) {
  const db = loadDb();
  const site = db.sites.find((s) => s.id === siteId && s.parkId === parkId);
  if (!site) throw new Error('Unknown site');
  if (updates.name !== undefined) site.name = updates.name;
  if (updates.type !== undefined) site.type = updates.type;
  if (updates.capacity !== undefined) site.capacity = Number(updates.capacity);
  if (updates.nightlyRateCents !== undefined) site.nightlyRateCents = Number(updates.nightlyRateCents);
  saveDb(db);
  return site;
}

export function deleteSite(siteId, parkId) {
  const db = loadDb();
  const idx = db.sites.findIndex((s) => s.id === siteId && s.parkId === parkId);
  if (idx === -1) throw new Error('Unknown site');
  db.sites.splice(idx, 1);
  saveDb(db);
}

/* ---------------------------------------------------------------- */
/* Staff-entered bookings (phone / walk-in) — same underlying data as */
/* guest self-service bookings, so availability never has to "sync". */
/* ---------------------------------------------------------------- */

export function createStaffReservation({ parkId, siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, paymentMethod, notes }) {
  const db = loadDb();
  const site = db.sites.find((s) => s.id === siteId && s.parkId === parkId);
  if (!site) throw new Error('Unknown site');
  if (!guestName) throw new Error('Guest name is required');

  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) throw new Error('Invalid date range');

  const stillAvailable = getAvailableSites(parkId, checkIn, checkOut).some((s) => s.id === siteId);
  if (!stillAvailable) throw new Error('Site is no longer available for those dates');

  const isPayLater = paymentMethod === 'pay-later-link';
  const reservation = {
    id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parkId, siteId, checkIn, checkOut, nights,
    guestName, guestEmail: guestEmail || '', guestPhone: guestPhone || '',
    subtotalCents: site.nightlyRateCents * nights,
    feeCents: BOOKING_FEE_CENTS,
    totalCents: site.nightlyRateCents * nights + BOOKING_FEE_CENTS,
    // Cash/card-in-person bookings are confirmed immediately since the
    // park already collected payment; pay-later holds the site the same
    // way an online guest's pending checkout does, just for longer.
    status: isPayLater ? 'pending' : 'confirmed',
    holdExpiresAt: isPayLater ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
    stripeSessionId: null,
    source: 'staff',
    paymentMethod, // 'cash' | 'card-in-person' | 'pay-later-link'
    notes: notes || '',
    createdAt: new Date().toISOString(),
  };
  db.reservations.push(reservation);
  saveDb(db);
  return reservation;
}

export function getReservationsForPark(parkId) {
  return loadDb().reservations
    .filter((r) => r.parkId === parkId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* ---------------------------------------------------------------- */
/* Guest accounts (self-service — guests sign up on the website to   */
/* track their own bookings across any park; not tied to one park).  */
/* ---------------------------------------------------------------- */

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

export function createGuestAccount({ name, email, password, phone }) {
  if (!name || !email || !password) throw new Error('Name, email, and password are required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const db = loadDb();
  const normalizedEmail = normalizeEmail(email);
  if (db.guests.some((g) => g.email === normalizedEmail)) throw new Error('An account with that email already exists');

  const guest = {
    id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name, email: normalizedEmail, phone: phone || '',
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
  };
  db.guests.push(guest);
  saveDb(db);
  return guest;
}

export function verifyGuestLogin(email, password) {
  const db = loadDb();
  const guest = db.guests.find((g) => g.email === normalizeEmail(email));
  if (!guest || !bcrypt.compareSync(password || '', guest.passwordHash)) return null;
  return guest;
}

export function getGuestByEmail(email) {
  return loadDb().guests.find((g) => g.email === normalizeEmail(email)) || null;
}

export function getBookingsForGuest(email) {
  const db = loadDb();
  const normalizedEmail = normalizeEmail(email);
  return db.reservations
    .filter((r) => normalizeEmail(r.guestEmail) === normalizedEmail)
    .map((r) => ({ ...r, parkName: db.parks.find((p) => p.id === r.parkId)?.name || r.parkId }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
