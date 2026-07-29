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

// Starts empty on purpose — no fictional parks/sites. Real parks are
// created by an owner signing up (signupParkOwner, below) or a
// super-admin provisioning one (createPark). Everything the site shows
// (find-a-park results, availability, bookings) now reflects only real
// accounts and real bookings.
const SEED = {
  parks: [],
  sites: [],
  reservations: [],
  guests: [],
  waitlist: [],
};

const BOOKING_FEE_CENTS = 150; // the platform fee charged per reservation, per the $1-2/booking model
const PENDING_HOLD_MINUTES = 20; // how long a site is held while a guest is mid-checkout

// Single source of truth for turning a stay's subtotal into what the guest
// actually owes. Centralized here (rather than duplicated across
// getAvailableSites/createPendingReservation/createStaffReservation) so tax,
// promo discounts, and deposit splitting stay consistent everywhere pricing
// is shown or charged — one bug fix here fixes it in every surface at once.
// Lodging tax applies to the room subtotal only, not the platform booking
// fee (standard treatment; the fee isn't part of the taxable rent) — and to
// what the guest actually pays for the room, i.e. AFTER any promo discount.
// Taxing the pre-discount amount would charge sales tax on rent the guest
// never paid, which is wrong wherever lodging tax is a percentage of the
// amount collected.
function priceStay(park, subtotalCents, promoCode = null) {
  let discountCents = 0;
  let appliedPromoCode = null;
  if (promoCode) {
    const promo = (park.promoCodes || []).find((p) => p.code.toLowerCase() === promoCode.trim().toLowerCase());
    if (promo) {
      appliedPromoCode = promo.code;
      discountCents = promo.type === 'percent'
        ? Math.round(subtotalCents * (promo.value / 100))
        : Math.min(promo.value, subtotalCents);
    }
  }

  const discountedSubtotalCents = Math.max(0, subtotalCents - discountCents);
  const taxRatePercent = park.taxRatePercent || 0;
  const taxCents = Math.round(discountedSubtotalCents * (taxRatePercent / 100));

  const feeCents = BOOKING_FEE_CENTS;
  const totalCents = discountedSubtotalCents + taxCents + feeCents;

  const depositPercent = park.depositPercent || 0;
  const depositCents = depositPercent > 0 ? Math.round(totalCents * (depositPercent / 100)) : totalCents;
  const balanceCents = totalCents - depositCents;

  return { subtotalCents, discountCents, appliedPromoCode, taxCents, taxRatePercent, feeCents, totalCents, depositCents, balanceCents };
}

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

// A seasonal rate applies to a specific night if that night's date falls
// within [startDate, endDate) — half-open the same way check-in/check-out
// ranges are, so a season ending "2026-12-31" doesn't leak into Jan 1.
// First matching season wins; falls back to the site's base rate.
function nightlyRateForDate(site, dateStr) {
  const date = new Date(dateStr);
  const season = (site.seasonalRates || []).find((s) => date >= new Date(s.startDate) && date < new Date(s.endDate));
  return season ? season.nightlyRateCents : site.nightlyRateCents;
}

// Sums the actual per-night rate (base or seasonal) across the whole stay,
// rather than assuming every night costs the same — the naive
// `nightlyRateCents * nights` shortcut breaks the moment a stay crosses
// into (or out of) a holiday/seasonal rate window.
function computeSubtotalCents(site, checkIn, checkOut) {
  let total = 0;
  const cursor = new Date(checkIn);
  const end = new Date(checkOut);
  while (cursor < end) {
    total += nightlyRateForDate(site, cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  // Checkout day doesn't count as occupied — a guest leaving on the 10th
  // doesn't block a new guest checking in on the 10th.
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

function isReservationActive(r) {
  // 'confirmed-deposit' still holds the site — only the balance is unpaid,
  // not the reservation itself.
  if (r.status === 'confirmed' || r.status === 'confirmed-deposit') return true;
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

export function getAvailableSites(parkId, checkIn, checkOut, promoCode = null) {
  if (!checkIn || !checkOut || new Date(checkOut) <= new Date(checkIn)) return [];
  const db = loadDb();
  const park = db.parks.find((p) => p.id === parkId);
  if (!park) return [];
  const nights = nightsBetween(checkIn, checkOut);
  const sites = db.sites.filter((s) => s.parkId === parkId);
  const activeReservations = db.reservations.filter((r) => r.parkId === parkId && isReservationActive(r));

  return sites
    .filter((site) => !activeReservations.some((r) => r.siteId === site.id && rangesOverlap(checkIn, checkOut, r.checkIn, r.checkOut)))
    .map((site) => {
      const subtotalCents = computeSubtotalCents(site, checkIn, checkOut);
      return { ...site, nights, ...priceStay(park, subtotalCents, promoCode) };
    });
}

export function getSite(siteId) {
  return loadDb().sites.find((s) => s.id === siteId) || null;
}

/* ---------------------------------------------------------------- */
/* Waitlist — a guest joins when a park has nothing open for their   */
/* dates; staff work the list manually (there's no auto-rebooking).  */
/* ---------------------------------------------------------------- */

export function joinWaitlist({ parkId, checkIn, checkOut, name, email, phone, notes }) {
  if (!name || !email) throw new Error('Name and email are required');
  const db = loadDb();
  if (!db.parks.some((p) => p.id === parkId)) throw new Error('Unknown park');

  const entry = {
    id: `wait-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parkId, checkIn, checkOut, name, email, phone: phone || '', notes: notes || '',
    createdAt: new Date().toISOString(),
  };
  db.waitlist.push(entry);
  saveDb(db);
  return entry;
}

export function getWaitlistForPark(parkId) {
  return loadDb().waitlist
    .filter((w) => w.parkId === parkId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); // oldest request first — first come, first served
}

export function removeWaitlistEntry(entryId, parkId) {
  const db = loadDb();
  const idx = db.waitlist.findIndex((w) => w.id === entryId && w.parkId === parkId);
  if (idx === -1) throw new Error('Unknown waitlist entry');
  db.waitlist.splice(idx, 1);
  saveDb(db);
}

export function createPendingReservation({ parkId, siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, promoCode = null }) {
  const db = loadDb();
  const park = db.parks.find((p) => p.id === parkId);
  const site = db.sites.find((s) => s.id === siteId && s.parkId === parkId);
  if (!park || !site) throw new Error('Unknown park or site');

  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) throw new Error('Invalid date range');

  const stillAvailable = getAvailableSites(parkId, checkIn, checkOut).some((s) => s.id === siteId);
  if (!stillAvailable) throw new Error('Site is no longer available for those dates');

  const subtotalCents = computeSubtotalCents(site, checkIn, checkOut);
  const pricing = priceStay(park, subtotalCents, promoCode);

  const reservation = {
    id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parkId, siteId, checkIn, checkOut, nights,
    guestName, guestEmail, guestPhone,
    ...pricing,
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
  // A deposit-only checkout still leaves a balance due — that gets its own
  // status so guest/staff dashboards can show "balance due" instead of
  // implying the stay is fully paid for.
  r.status = r.balanceCents > 0 ? 'confirmed-deposit' : 'confirmed';
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

// Self-service signup for RVPark owners — unlike createPark() (which a
// super-admin uses to provision a park on someone else's behalf), this is
// what runs when an owner signs themselves up from the public site. The
// owner's email doubles as their staff login username so they don't have
// to invent a separate one.
export function signupParkOwner({ parkName, location, ownerName, email, phone, password }) {
  if (!parkName || !location || !ownerName || !email || !password) throw new Error('All fields are required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const db = loadDb();
  // verifyParkLogin() slugifies whatever username it's given before
  // comparing, so the stored staffUsername must be pre-slugified too —
  // otherwise "jane@example.com" would never match "jane-example-com".
  const username = slugify(email);
  if (db.parks.some((p) => p.staffUsername === username)) throw new Error('An account with that email already exists');

  let id = slugify(parkName);
  if (db.parks.some((p) => p.id === id)) id = `${id}-${Date.now().toString(36)}`;

  const park = {
    id, name: parkName, location, state: '', timezone: 'America/Chicago',
    ownerName, ownerEmail: normalizeEmail(email), ownerPhone: phone || '',
    staffUsername: username,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
  };
  db.parks.push(park);
  saveDb(db);
  return park;
}

// Owner-editable park settings — tax rate today, deposit % and promo codes
// once those features land. Scoped by parkId from the session, same as
// site management, so a staff member can only ever edit their own park.
export function updateParkSettings(parkId, { taxRatePercent, depositPercent } = {}) {
  const db = loadDb();
  const park = db.parks.find((p) => p.id === parkId);
  if (!park) throw new Error('Unknown park');

  if (taxRatePercent !== undefined) {
    const rate = Number(taxRatePercent);
    if (isNaN(rate) || rate < 0 || rate > 30) throw new Error('Tax rate must be between 0 and 30%');
    park.taxRatePercent = rate;
  }
  if (depositPercent !== undefined) {
    const rate = Number(depositPercent);
    if (isNaN(rate) || rate < 0 || rate > 100) throw new Error('Deposit percent must be between 0 and 100');
    park.depositPercent = rate;
  }
  saveDb(db);
  return park;
}

// Stores the park's Stripe Connect account id once they start onboarding.
// The actual Stripe API calls (creating the account, generating the
// onboarding link, checking payouts_enabled) live in api/admin/dashboard.js
// and api/reservations/create-checkout.js — this file stays Stripe-agnostic
// like the rest of the data layer, just persisting the id Stripe hands back.
export function setParkStripeAccount(parkId, stripeAccountId) {
  const db = loadDb();
  const park = db.parks.find((p) => p.id === parkId);
  if (!park) throw new Error('Unknown park');
  park.stripeAccountId = stripeAccountId;
  saveDb(db);
  return park;
}

// Promo codes — park-level, applied against the room subtotal at checkout
// (see priceStay()). Codes are stored uppercased so lookups are
// case-insensitive without guests having to match capitalization exactly.
// `value` units depend on `type`: 'percent' is a plain number (10 = 10%);
// 'flat' is CENTS, same convention as every other *Cents field — the
// caller (park-dashboard.js) converts the dollar input before sending it.
export function addPromoCode(parkId, { code, type, value }) {
  if (!code || !type || !value) throw new Error('Code, type, and value are required');
  if (type !== 'percent' && type !== 'flat') throw new Error('Type must be percent or flat');
  const numericValue = Number(value);
  if (isNaN(numericValue) || numericValue <= 0) throw new Error('Value must be a positive number');
  if (type === 'percent' && numericValue > 100) throw new Error('Percent discount cannot exceed 100');

  const db = loadDb();
  const park = db.parks.find((p) => p.id === parkId);
  if (!park) throw new Error('Unknown park');

  const normalizedCode = code.trim().toUpperCase();
  if (!park.promoCodes) park.promoCodes = [];
  if (park.promoCodes.some((p) => p.code === normalizedCode)) throw new Error('That code already exists');

  const promo = { id: `promo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, code: normalizedCode, type, value: numericValue };
  park.promoCodes.push(promo);
  saveDb(db);
  return park;
}

export function removePromoCode(parkId, promoId) {
  const db = loadDb();
  const park = db.parks.find((p) => p.id === parkId);
  if (!park) throw new Error('Unknown park');
  park.promoCodes = (park.promoCodes || []).filter((p) => p.id !== promoId);
  saveDb(db);
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

// Seasonal/holiday rate overrides — a date range that replaces a site's
// base nightly rate for any night that falls inside it (see
// nightlyRateForDate above). Scoped by parkId the same way site edits are,
// so staff can only add seasons to their own park's sites.
export function addSeasonalRate(siteId, parkId, { label, startDate, endDate, nightlyRateCents }) {
  if (!startDate || !endDate || !nightlyRateCents) throw new Error('Start date, end date, and rate are required');
  if (new Date(endDate) <= new Date(startDate)) throw new Error('End date must be after start date');

  const db = loadDb();
  const site = db.sites.find((s) => s.id === siteId && s.parkId === parkId);
  if (!site) throw new Error('Unknown site');

  if (!site.seasonalRates) site.seasonalRates = [];
  const season = {
    id: `season-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: label || 'Seasonal Rate',
    startDate, endDate,
    nightlyRateCents: Number(nightlyRateCents),
  };
  site.seasonalRates.push(season);
  saveDb(db);
  return site;
}

export function removeSeasonalRate(siteId, parkId, seasonId) {
  const db = loadDb();
  const site = db.sites.find((s) => s.id === siteId && s.parkId === parkId);
  if (!site) throw new Error('Unknown site');
  site.seasonalRates = (site.seasonalRates || []).filter((s) => s.id !== seasonId);
  saveDb(db);
  return site;
}

/* ---------------------------------------------------------------- */
/* Staff-entered bookings (phone / walk-in) — same underlying data as */
/* guest self-service bookings, so availability never has to "sync". */
/* ---------------------------------------------------------------- */

export function createStaffReservation({ parkId, siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, paymentMethod, notes }) {
  const db = loadDb();
  const park = db.parks.find((p) => p.id === parkId);
  const site = db.sites.find((s) => s.id === siteId && s.parkId === parkId);
  if (!park || !site) throw new Error('Unknown park or site');
  if (!guestName) throw new Error('Guest name is required');

  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) throw new Error('Invalid date range');

  const stillAvailable = getAvailableSites(parkId, checkIn, checkOut).some((s) => s.id === siteId);
  if (!stillAvailable) throw new Error('Site is no longer available for those dates');

  const subtotalCents = computeSubtotalCents(site, checkIn, checkOut);
  // Staff bookings always price the full stay — front desk collects the
  // whole amount (or holds it via pay-later-link at full price), so the
  // online deposit split doesn't apply here.
  const pricing = priceStay({ ...park, depositPercent: 0 }, subtotalCents);

  const isPayLater = paymentMethod === 'pay-later-link';
  const reservation = {
    id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parkId, siteId, checkIn, checkOut, nights,
    guestName, guestEmail: guestEmail || '', guestPhone: guestPhone || '',
    ...pricing,
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

function overlapNights(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(new Date(aStart), new Date(bStart));
  const end = Math.min(new Date(aEnd), new Date(bEnd));
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

// Owner dashboard summary: money actually collected so far, the balance
// still owed on deposit-only bookings, average daily rate, and occupancy
// over the next `windowDays` (upcoming, not historical — what an owner
// checking their dashboard today actually wants to know is how full the
// weeks ahead are).
export function getParkStats(parkId, { windowDays = 30 } = {}) {
  const db = loadDb();
  const siteCount = db.sites.filter((s) => s.parkId === parkId).length;
  const reservations = db.reservations.filter((r) => r.parkId === parkId && (r.status === 'confirmed' || r.status === 'confirmed-deposit'));

  const totalRevenueCents = reservations.reduce((sum, r) => sum + (r.status === 'confirmed-deposit' ? r.depositCents : r.totalCents), 0);
  const outstandingBalanceCents = reservations.reduce((sum, r) => sum + (r.status === 'confirmed-deposit' ? r.balanceCents : 0), 0);

  const totalNights = reservations.reduce((sum, r) => sum + r.nights, 0);
  const totalSubtotalCents = reservations.reduce((sum, r) => sum + r.subtotalCents, 0);
  const adrCents = totalNights > 0 ? Math.round(totalSubtotalCents / totalNights) : 0;

  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const bookedSiteNights = reservations.reduce((sum, r) => sum + overlapNights(r.checkIn, r.checkOut, windowStart, windowEnd), 0);
  const totalSiteNights = siteCount * windowDays;
  const occupancyPercent = totalSiteNights > 0 ? Math.round((bookedSiteNights / totalSiteNights) * 1000) / 10 : 0;

  return {
    totalRevenueCents, outstandingBalanceCents, adrCents, occupancyPercent,
    totalReservations: reservations.length, windowDays,
  };
}

// What the park is actually owed vs. what RVPark Success keeps, from money
// that's already been collected. NOTE: this is a calculation only — there
// is no live money movement here. All Stripe charges currently land in one
// platform Stripe account; paying each park their share requires either
// Stripe Connect (so each park has its own connected account and gets
// paid automatically) or a manual transfer based on this number. Wiring
// real Connect payouts needs a live Stripe Connect platform account and
// each park's onboarding — that can't be set up or tested without those
// real credentials, so this stays a dashboard figure until that exists.
export function getPayoutSummary(parkId) {
  const db = loadDb();
  const reservations = db.reservations.filter((r) => r.parkId === parkId && (r.status === 'confirmed' || r.status === 'confirmed-deposit'));

  let grossCollectedCents = 0;
  let platformFeeCollectedCents = 0;

  for (const r of reservations) {
    const collectedCents = r.status === 'confirmed-deposit' ? r.depositCents : r.totalCents;
    // The deposit is a proportional slice of subtotal+tax+fee (see
    // create-checkout.js's chargeRatio), so the fee portion actually
    // collected scales down the same way for a deposit-only booking.
    const chargeRatio = r.totalCents > 0 ? collectedCents / r.totalCents : 1;
    grossCollectedCents += collectedCents;
    platformFeeCollectedCents += Math.round(r.feeCents * chargeRatio);
  }

  return {
    grossCollectedCents,
    platformFeeCollectedCents,
    netOwedToParkCents: grossCollectedCents - platformFeeCollectedCents,
  };
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

// Self-service cancellation — scoped to the guest's own email so a guest
// can never cancel someone else's booking even if they guessed a
// reservation id. Setting status to 'canceled' is enough to free the site:
// isReservationActive() already treats any non-confirmed/non-pending
// status as inactive, so the availability check just works.
export function cancelReservationForGuest(reservationId, guestEmail) {
  const db = loadDb();
  const r = db.reservations.find((x) => x.id === reservationId);
  if (!r) throw new Error('Reservation not found');
  if (normalizeEmail(r.guestEmail) !== normalizeEmail(guestEmail)) throw new Error('Reservation not found');
  if (r.status === 'canceled') throw new Error('Already canceled');
  if (new Date(r.checkIn) <= new Date()) throw new Error("Can't cancel a stay that's already started");

  r.status = 'canceled';
  r.canceledAt = new Date().toISOString();
  saveDb(db);
  return r;
}
