// Reservation data layer — parks, sites, and reservations.
//
// Backed by Postgres (Neon, connected via Vercel's Storage integration).
// Reads DATABASE_URL / POSTGRES_URL from the environment — Vercel injects
// this automatically in production once a database is connected under the
// project's Storage tab; locally, `vercel env pull .env.development.local`
// (or `vercel dev`) makes it available the same way.
//
// Every exported function here is now async and does a real network round
// trip — every caller in api/**/*.js must `await` these calls.
//
// Double-booking safety: createPendingReservation/createStaffReservation
// wrap their "is it still available" check and the insert in a single
// transaction, serialized per site via a Postgres advisory lock
// (pg_advisory_xact_lock). That's the fix for the exact race condition the
// old JSON-file version could never close: two guests hitting "book" at
// the same instant on the same site now genuinely can't both succeed.
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool, types } = pg;

// Postgres' `date` type (OID 1082) parses to a JS Date by default, which
// silently shifts by timezone when later formatted — the rest of this app
// treats check-in/check-out as plain 'YYYY-MM-DD' strings (used directly
// in URLs, comparisons, and Stripe line-item labels), so keep it a string.
types.setTypeParser(1082, (val) => val);

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const pool = new Pool({
  connectionString,
  max: 5, // small pool — Neon's pooled connection string already multiplexes via pgbouncer
  ssl: connectionString && !/sslmode=/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});

const BOOKING_FEE_CENTS = 150; // the platform fee charged per reservation, per the $1-2/booking model
const PENDING_HOLD_MINUTES = 20; // how long a site is held while a guest is mid-checkout

/* ---------------------------------------------------------------- */
/* Schema — created lazily on first use, memoized so it only runs    */
/* once per warm serverless instance rather than on every request.   */
/* ---------------------------------------------------------------- */

let schemaReady = null;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS parks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT '',
        timezone TEXT NOT NULL DEFAULT 'America/Chicago',
        tax_rate_percent NUMERIC NOT NULL DEFAULT 0,
        deposit_percent NUMERIC NOT NULL DEFAULT 0,
        owner_name TEXT,
        owner_email TEXT,
        owner_phone TEXT,
        staff_username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        stripe_account_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        nightly_rate_cents INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sites_park ON sites(park_id);

      CREATE TABLE IF NOT EXISTS seasonal_rates (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        label TEXT NOT NULL DEFAULT 'Seasonal Rate',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        nightly_rate_cents INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_seasonal_rates_site ON seasonal_rates(site_id);

      CREATE TABLE IF NOT EXISTS promo_codes (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        type TEXT NOT NULL,
        value NUMERIC NOT NULL,
        UNIQUE(park_id, code)
      );

      CREATE TABLE IF NOT EXISTS guests (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id),
        site_id TEXT NOT NULL REFERENCES sites(id),
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        nights INTEGER NOT NULL,
        guest_name TEXT NOT NULL,
        guest_email TEXT NOT NULL DEFAULT '',
        guest_phone TEXT NOT NULL DEFAULT '',
        subtotal_cents INTEGER NOT NULL,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        applied_promo_code TEXT,
        tax_cents INTEGER NOT NULL DEFAULT 0,
        tax_rate_percent NUMERIC NOT NULL DEFAULT 0,
        fee_cents INTEGER NOT NULL DEFAULT 0,
        total_cents INTEGER NOT NULL,
        deposit_cents INTEGER NOT NULL,
        balance_cents INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        hold_expires_at TIMESTAMPTZ,
        stripe_session_id TEXT,
        source TEXT NOT NULL DEFAULT 'guest',
        payment_method TEXT,
        notes TEXT NOT NULL DEFAULT '',
        canceled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_reservations_park ON reservations(park_id);
      CREATE INDEX IF NOT EXISTS idx_reservations_site_dates ON reservations(site_id, check_in, check_out);
      CREATE INDEX IF NOT EXISTS idx_reservations_guest_email ON reservations(guest_email);
      CREATE INDEX IF NOT EXISTS idx_reservations_stripe_session ON reservations(stripe_session_id);

      CREATE TABLE IF NOT EXISTS waitlist (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        check_in DATE,
        check_out DATE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_waitlist_park ON waitlist(park_id);
    `).catch((err) => { schemaReady = null; throw err; }); // don't cache a failed init — next call retries
  }
  return schemaReady;
}

async function query(text, params) {
  await ensureSchema();
  return pool.query(text, params);
}

/* ---------------------------------------------------------------- */
/* Row <-> JS shape mapping — DB stays snake_case, the rest of the   */
/* app (API routes, frontend) keeps using the camelCase field names  */
/* it already expects, so this file is the only thing that changed.  */
/* ---------------------------------------------------------------- */

function mapPark(row, promoCodes = []) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, location: row.location, state: row.state, timezone: row.timezone,
    taxRatePercent: Number(row.tax_rate_percent), depositPercent: Number(row.deposit_percent),
    ownerName: row.owner_name, ownerEmail: row.owner_email, ownerPhone: row.owner_phone,
    staffUsername: row.staff_username, passwordHash: row.password_hash,
    stripeAccountId: row.stripe_account_id,
    createdAt: row.created_at.toISOString(),
    promoCodes: promoCodes.map(mapPromo),
  };
}

function mapPromo(row) {
  return { id: row.id, code: row.code, type: row.type, value: Number(row.value) };
}

function mapSite(row, seasonalRates = []) {
  return {
    id: row.id, parkId: row.park_id, name: row.name, type: row.type,
    capacity: row.capacity, nightlyRateCents: row.nightly_rate_cents,
    seasonalRates: seasonalRates.map(mapSeason),
  };
}

function mapSeason(row) {
  return { id: row.id, label: row.label, startDate: row.start_date, endDate: row.end_date, nightlyRateCents: row.nightly_rate_cents };
}

function mapReservation(row) {
  return {
    id: row.id, parkId: row.park_id, siteId: row.site_id,
    checkIn: row.check_in, checkOut: row.check_out, nights: row.nights,
    guestName: row.guest_name, guestEmail: row.guest_email, guestPhone: row.guest_phone,
    subtotalCents: row.subtotal_cents, discountCents: row.discount_cents, appliedPromoCode: row.applied_promo_code,
    taxCents: row.tax_cents, taxRatePercent: Number(row.tax_rate_percent), feeCents: row.fee_cents,
    totalCents: row.total_cents, depositCents: row.deposit_cents, balanceCents: row.balance_cents,
    status: row.status,
    holdExpiresAt: row.hold_expires_at ? row.hold_expires_at.toISOString() : null,
    stripeSessionId: row.stripe_session_id, source: row.source, paymentMethod: row.payment_method,
    notes: row.notes,
    canceledAt: row.canceled_at ? row.canceled_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapGuest(row) {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, passwordHash: row.password_hash, createdAt: row.created_at.toISOString() };
}

function mapWaitlist(row) {
  return {
    id: row.id, parkId: row.park_id, checkIn: row.check_in, checkOut: row.check_out,
    name: row.name, email: row.email, phone: row.phone, notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

/* ---------------------------------------------------------------- */
/* Pure pricing/date helpers — unchanged from the JSON-file version, */
/* they only operate on plain JS objects already loaded from the DB. */
/* ---------------------------------------------------------------- */

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

function overlapNights(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(new Date(aStart), new Date(bStart));
  const end = Math.min(new Date(aEnd), new Date(bEnd));
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

const ACTIVE_STATUSES = ['pending', 'confirmed', 'confirmed-deposit'];

/* ---------------------------------------------------------------- */
/* Parks / availability                                              */
/* ---------------------------------------------------------------- */

export async function getPark(parkId) {
  const parkRes = await query('SELECT * FROM parks WHERE id = $1', [parkId]);
  if (!parkRes.rows[0]) return null;
  const promoRes = await query('SELECT * FROM promo_codes WHERE park_id = $1', [parkId]);
  return mapPark(parkRes.rows[0], promoRes.rows);
}

export async function listParks(locationQuery = '') {
  const q = locationQuery.trim();
  const parksRes = q
    ? await query(`SELECT * FROM parks WHERE name ILIKE $1 OR location ILIKE $1 OR state ILIKE $1`, [`%${q}%`])
    : await query('SELECT * FROM parks');
  const sitesRes = await query('SELECT * FROM sites');

  return parksRes.rows.map((row) => {
    const sites = sitesRes.rows.filter((s) => s.park_id === row.id);
    const rates = sites.map((s) => s.nightly_rate_cents);
    const park = mapPark(row);
    return {
      ...park,
      siteCount: sites.length,
      siteTypes: [...new Set(sites.map((s) => s.type))],
      minNightlyRateCents: rates.length ? Math.min(...rates) : null,
      maxNightlyRateCents: rates.length ? Math.max(...rates) : null,
    };
  });
}

async function loadSitesWithSeasons(whereClause, params) {
  const sitesRes = await query(`SELECT * FROM sites WHERE ${whereClause}`, params);
  if (!sitesRes.rows.length) return [];
  const ids = sitesRes.rows.map((s) => s.id);
  const seasonsRes = await query('SELECT * FROM seasonal_rates WHERE site_id = ANY($1::text[])', [ids]);
  return sitesRes.rows.map((row) => mapSite(row, seasonsRes.rows.filter((s) => s.site_id === row.id)));
}

export async function getAvailableSites(parkId, checkIn, checkOut, promoCode = null) {
  if (!checkIn || !checkOut || new Date(checkOut) <= new Date(checkIn)) return [];
  const park = await getPark(parkId);
  if (!park) return [];
  const nights = nightsBetween(checkIn, checkOut);
  const sites = await loadSitesWithSeasons('park_id = $1', [parkId]);

  const activeRes = await query(
    `SELECT site_id, check_in, check_out FROM reservations
     WHERE park_id = $1 AND status = ANY($2::text[]) AND check_in < $4 AND check_out > $3`,
    [parkId, ACTIVE_STATUSES, checkIn, checkOut]
  );
  const blockedSiteIds = new Set(activeRes.rows.map((r) => r.site_id));

  return sites
    .filter((site) => !blockedSiteIds.has(site.id))
    .map((site) => {
      const subtotalCents = computeSubtotalCents(site, checkIn, checkOut);
      return { ...site, nights, ...priceStay(park, subtotalCents, promoCode) };
    });
}

export async function getSite(siteId) {
  const [site] = await loadSitesWithSeasons('id = $1', [siteId]);
  return site || null;
}

/* ---------------------------------------------------------------- */
/* Waitlist — a guest joins when a park has nothing open for their   */
/* dates; staff work the list manually (there's no auto-rebooking).  */
/* ---------------------------------------------------------------- */

export async function joinWaitlist({ parkId, checkIn, checkOut, name, email, phone, notes }) {
  if (!name || !email) throw new Error('Name and email are required');
  const parkRes = await query('SELECT id FROM parks WHERE id = $1', [parkId]);
  if (!parkRes.rows[0]) throw new Error('Unknown park');

  const id = `wait-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await query(
    `INSERT INTO waitlist (id, park_id, check_in, check_out, name, email, phone, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, parkId, checkIn, checkOut, name, email, phone || '', notes || '']
  );
  return mapWaitlist(res.rows[0]);
}

export async function getWaitlistForPark(parkId) {
  const res = await query('SELECT * FROM waitlist WHERE park_id = $1 ORDER BY created_at ASC', [parkId]);
  return res.rows.map(mapWaitlist);
}

export async function removeWaitlistEntry(entryId, parkId) {
  const res = await query('DELETE FROM waitlist WHERE id = $1 AND park_id = $2', [entryId, parkId]);
  if (res.rowCount === 0) throw new Error('Unknown waitlist entry');
}

/* ---------------------------------------------------------------- */
/* Bookings — both wrap the availability re-check and the insert in  */
/* one transaction, serialized per site via an advisory lock, so two  */
/* concurrent bookings for the same site/dates can't both succeed.    */
/* ---------------------------------------------------------------- */

async function withSiteLock(siteId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [siteId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function siteIsStillAvailable(client, siteId, checkIn, checkOut) {
  // Opportunistically expire stale pending holds for this site before
  // checking — otherwise a hold nobody ever paid for would block the site
  // forever, the same "expired holds don't count" behavior the in-memory
  // version had, just persisted instead of recomputed on every read.
  await client.query(
    `UPDATE reservations SET status = 'canceled' WHERE site_id = $1 AND status = 'pending' AND hold_expires_at < now()`,
    [siteId]
  );
  const overlap = await client.query(
    `SELECT 1 FROM reservations WHERE site_id = $1 AND status = ANY($2::text[]) AND check_in < $4 AND check_out > $3 LIMIT 1`,
    [siteId, ACTIVE_STATUSES, checkIn, checkOut]
  );
  return overlap.rows.length === 0;
}

export async function createPendingReservation({ parkId, siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, promoCode = null }) {
  const park = await getPark(parkId);
  const site = await getSite(siteId);
  if (!park || !site || site.parkId !== parkId) throw new Error('Unknown park or site');

  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) throw new Error('Invalid date range');

  return withSiteLock(siteId, async (client) => {
    if (!(await siteIsStillAvailable(client, siteId, checkIn, checkOut))) {
      throw new Error('Site is no longer available for those dates');
    }

    const subtotalCents = computeSubtotalCents(site, checkIn, checkOut);
    const pricing = priceStay(park, subtotalCents, promoCode);
    const id = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const holdExpiresAt = new Date(Date.now() + PENDING_HOLD_MINUTES * 60 * 1000);

    const res = await client.query(
      `INSERT INTO reservations
        (id, park_id, site_id, check_in, check_out, nights, guest_name, guest_email, guest_phone,
         subtotal_cents, discount_cents, applied_promo_code, tax_cents, tax_rate_percent, fee_cents,
         total_cents, deposit_cents, balance_cents, status, hold_expires_at, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending',$19,'guest')
       RETURNING *`,
      [id, parkId, siteId, checkIn, checkOut, nights, guestName, guestEmail, guestPhone,
        pricing.subtotalCents, pricing.discountCents, pricing.appliedPromoCode, pricing.taxCents, pricing.taxRatePercent, pricing.feeCents,
        pricing.totalCents, pricing.depositCents, pricing.balanceCents, holdExpiresAt]
    );
    return mapReservation(res.rows[0]);
  });
}

export async function createStaffReservation({ parkId, siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, paymentMethod, notes }) {
  const park = await getPark(parkId);
  const site = await getSite(siteId);
  if (!park || !site || site.parkId !== parkId) throw new Error('Unknown park or site');
  if (!guestName) throw new Error('Guest name is required');

  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) throw new Error('Invalid date range');

  return withSiteLock(siteId, async (client) => {
    if (!(await siteIsStillAvailable(client, siteId, checkIn, checkOut))) {
      throw new Error('Site is no longer available for those dates');
    }

    const subtotalCents = computeSubtotalCents(site, checkIn, checkOut);
    // Staff bookings always price the full stay — front desk collects the
    // whole amount (or holds it via pay-later-link at full price), so the
    // online deposit split doesn't apply here.
    const pricing = priceStay({ ...park, depositPercent: 0 }, subtotalCents);

    const isPayLater = paymentMethod === 'pay-later-link';
    const id = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Cash/card-in-person bookings are confirmed immediately since the
    // park already collected payment; pay-later holds the site the same
    // way an online guest's pending checkout does, just for longer.
    const status = isPayLater ? 'pending' : 'confirmed';
    const holdExpiresAt = isPayLater ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;

    const res = await client.query(
      `INSERT INTO reservations
        (id, park_id, site_id, check_in, check_out, nights, guest_name, guest_email, guest_phone,
         subtotal_cents, discount_cents, applied_promo_code, tax_cents, tax_rate_percent, fee_cents,
         total_cents, deposit_cents, balance_cents, status, hold_expires_at, source, payment_method, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'staff',$21,$22)
       RETURNING *`,
      [id, parkId, siteId, checkIn, checkOut, nights, guestName, guestEmail || '', guestPhone || '',
        pricing.subtotalCents, pricing.discountCents, pricing.appliedPromoCode, pricing.taxCents, pricing.taxRatePercent, pricing.feeCents,
        pricing.totalCents, pricing.depositCents, pricing.balanceCents, status, holdExpiresAt, paymentMethod, notes || '']
    );
    return mapReservation(res.rows[0]);
  });
}

export async function attachStripeSession(reservationId, stripeSessionId) {
  const res = await query('UPDATE reservations SET stripe_session_id = $2 WHERE id = $1 RETURNING *', [reservationId, stripeSessionId]);
  return res.rows[0] ? mapReservation(res.rows[0]) : null;
}

export async function confirmReservationBySessionId(stripeSessionId) {
  // A deposit-only checkout still leaves a balance due — that gets its own
  // status so guest/staff dashboards can show "balance due" instead of
  // implying the stay is fully paid for.
  const res = await query(
    `UPDATE reservations
     SET status = CASE WHEN balance_cents > 0 THEN 'confirmed-deposit' ELSE 'confirmed' END
     WHERE stripe_session_id = $1 RETURNING *`,
    [stripeSessionId]
  );
  return res.rows[0] ? mapReservation(res.rows[0]) : null;
}

export async function getReservation(reservationId) {
  const res = await query('SELECT * FROM reservations WHERE id = $1', [reservationId]);
  return res.rows[0] ? mapReservation(res.rows[0]) : null;
}

/* ---------------------------------------------------------------- */
/* Park accounts (super-admin creates these; park staff log in with them) */
/* ---------------------------------------------------------------- */

export async function createPark({ name, location, state = '', timezone = 'America/Chicago', staffUsername, staffPassword }) {
  if (!name || !location || !staffUsername || !staffPassword) throw new Error('Missing required park details');
  if (staffPassword.length < 8) throw new Error('Staff password must be at least 8 characters');

  const username = slugify(staffUsername);
  const existing = await query('SELECT 1 FROM parks WHERE staff_username = $1', [username]);
  if (existing.rows.length) throw new Error('That staff username is already taken');

  let id = slugify(name);
  const idTaken = await query('SELECT 1 FROM parks WHERE id = $1', [id]);
  if (idTaken.rows.length) id = `${id}-${Date.now().toString(36)}`;

  const passwordHash = bcrypt.hashSync(staffPassword, 10);
  const res = await query(
    `INSERT INTO parks (id, name, location, state, timezone, staff_username, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, name, location, state, timezone, username, passwordHash]
  );
  return mapPark(res.rows[0]);
}

export async function verifyParkLogin(staffUsername, password) {
  const res = await query('SELECT * FROM parks WHERE staff_username = $1', [slugify(staffUsername)]);
  const row = res.rows[0];
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) return null;
  return mapPark(row);
}

// Self-service signup for RVPark owners — unlike createPark() (which a
// super-admin uses to provision a park on someone else's behalf), this is
// what runs when an owner signs themselves up from the public site. The
// owner's email doubles as their staff login username so they don't have
// to invent a separate one.
export async function signupParkOwner({ parkName, location, ownerName, email, phone, password }) {
  if (!parkName || !location || !ownerName || !email || !password) throw new Error('All fields are required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  // verifyParkLogin() slugifies whatever username it's given before
  // comparing, so the stored staffUsername must be pre-slugified too —
  // otherwise "jane@example.com" would never match "jane-example-com".
  const username = slugify(email);
  const existing = await query('SELECT 1 FROM parks WHERE staff_username = $1', [username]);
  if (existing.rows.length) throw new Error('An account with that email already exists');

  let id = slugify(parkName);
  const idTaken = await query('SELECT 1 FROM parks WHERE id = $1', [id]);
  if (idTaken.rows.length) id = `${id}-${Date.now().toString(36)}`;

  const passwordHash = bcrypt.hashSync(password, 10);
  const res = await query(
    `INSERT INTO parks (id, name, location, owner_name, owner_email, owner_phone, staff_username, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, parkName, location, ownerName, normalizeEmail(email), phone || '', username, passwordHash]
  );
  return mapPark(res.rows[0]);
}

// Owner-editable park settings — tax rate and deposit %. Scoped by parkId
// from the session, same as site management, so a staff member can only
// ever edit their own park.
export async function updateParkSettings(parkId, { taxRatePercent, depositPercent } = {}) {
  const sets = [];
  const params = [parkId];
  if (taxRatePercent !== undefined) {
    const rate = Number(taxRatePercent);
    if (isNaN(rate) || rate < 0 || rate > 30) throw new Error('Tax rate must be between 0 and 30%');
    params.push(rate);
    sets.push(`tax_rate_percent = $${params.length}`);
  }
  if (depositPercent !== undefined) {
    const rate = Number(depositPercent);
    if (isNaN(rate) || rate < 0 || rate > 100) throw new Error('Deposit percent must be between 0 and 100');
    params.push(rate);
    sets.push(`deposit_percent = $${params.length}`);
  }
  if (!sets.length) {
    const park = await getPark(parkId);
    if (!park) throw new Error('Unknown park');
    return park;
  }
  const res = await query(`UPDATE parks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (!res.rows[0]) throw new Error('Unknown park');
  return getPark(parkId);
}

// Stores the park's Stripe Connect account id once they start onboarding.
export async function setParkStripeAccount(parkId, stripeAccountId) {
  const res = await query('UPDATE parks SET stripe_account_id = $2 WHERE id = $1 RETURNING *', [parkId, stripeAccountId]);
  if (!res.rows[0]) throw new Error('Unknown park');
  return mapPark(res.rows[0]);
}

// Promo codes — park-level, applied against the room subtotal at checkout
// (see priceStay()). Codes are stored uppercased so lookups are
// case-insensitive without guests having to match capitalization exactly.
// `value` units depend on `type`: 'percent' is a plain number (10 = 10%);
// 'flat' is CENTS, same convention as every other *Cents field — the
// caller (park-dashboard.js) converts the dollar input before sending it.
export async function addPromoCode(parkId, { code, type, value }) {
  if (!code || !type || !value) throw new Error('Code, type, and value are required');
  if (type !== 'percent' && type !== 'flat') throw new Error('Type must be percent or flat');
  const numericValue = Number(value);
  if (isNaN(numericValue) || numericValue <= 0) throw new Error('Value must be a positive number');
  if (type === 'percent' && numericValue > 100) throw new Error('Percent discount cannot exceed 100');

  const parkExists = await query('SELECT 1 FROM parks WHERE id = $1', [parkId]);
  if (!parkExists.rows.length) throw new Error('Unknown park');

  const normalizedCode = code.trim().toUpperCase();
  const dup = await query('SELECT 1 FROM promo_codes WHERE park_id = $1 AND code = $2', [parkId, normalizedCode]);
  if (dup.rows.length) throw new Error('That code already exists');

  const id = `promo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await query('INSERT INTO promo_codes (id, park_id, code, type, value) VALUES ($1,$2,$3,$4,$5)', [id, parkId, normalizedCode, type, numericValue]);
  return getPark(parkId);
}

export async function removePromoCode(parkId, promoId) {
  const parkExists = await query('SELECT 1 FROM parks WHERE id = $1', [parkId]);
  if (!parkExists.rows.length) throw new Error('Unknown park');
  await query('DELETE FROM promo_codes WHERE id = $1 AND park_id = $2', [promoId, parkId]);
  return getPark(parkId);
}

// Safe for the super-admin dashboard to display — strips the password hash.
export async function listParksForAdmin() {
  const parksRes = await query('SELECT * FROM parks');
  const sitesRes = await query('SELECT park_id FROM sites');
  return parksRes.rows.map((row) => {
    const { passwordHash, ...rest } = mapPark(row);
    return { ...rest, siteCount: sitesRes.rows.filter((s) => s.park_id === row.id).length };
  });
}

/* ---------------------------------------------------------------- */
/* Site management (park staff manage their own park's inventory)    */
/* ---------------------------------------------------------------- */

export async function getSitesForPark(parkId) {
  return loadSitesWithSeasons('park_id = $1', [parkId]);
}

export async function addSite(parkId, { name, type, capacity, nightlyRateCents }) {
  if (!name || !type || !capacity || !nightlyRateCents) throw new Error('Missing required site details');
  const parkExists = await query('SELECT 1 FROM parks WHERE id = $1', [parkId]);
  if (!parkExists.rows.length) throw new Error('Unknown park');

  const id = `site-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await query(
    'INSERT INTO sites (id, park_id, name, type, capacity, nightly_rate_cents) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [id, parkId, name, type, Number(capacity), Number(nightlyRateCents)]
  );
  return mapSite(res.rows[0]);
}

export async function updateSite(siteId, parkId, updates) {
  const sets = [];
  const params = [siteId, parkId];
  if (updates.name !== undefined) { params.push(updates.name); sets.push(`name = $${params.length}`); }
  if (updates.type !== undefined) { params.push(updates.type); sets.push(`type = $${params.length}`); }
  if (updates.capacity !== undefined) { params.push(Number(updates.capacity)); sets.push(`capacity = $${params.length}`); }
  if (updates.nightlyRateCents !== undefined) { params.push(Number(updates.nightlyRateCents)); sets.push(`nightly_rate_cents = $${params.length}`); }
  if (!sets.length) {
    const site = await getSite(siteId);
    if (!site || site.parkId !== parkId) throw new Error('Unknown site');
    return site;
  }
  const res = await query(`UPDATE sites SET ${sets.join(', ')} WHERE id = $1 AND park_id = $2 RETURNING *`, params);
  if (!res.rows[0]) throw new Error('Unknown site');
  return getSite(siteId);
}

export async function deleteSite(siteId, parkId) {
  const res = await query('DELETE FROM sites WHERE id = $1 AND park_id = $2', [siteId, parkId]);
  if (res.rowCount === 0) throw new Error('Unknown site');
}

// Seasonal/holiday rate overrides — a date range that replaces a site's
// base nightly rate for any night that falls inside it (see
// nightlyRateForDate above). Scoped by parkId the same way site edits are,
// so staff can only add seasons to their own park's sites.
export async function addSeasonalRate(siteId, parkId, { label, startDate, endDate, nightlyRateCents }) {
  if (!startDate || !endDate || !nightlyRateCents) throw new Error('Start date, end date, and rate are required');
  if (new Date(endDate) <= new Date(startDate)) throw new Error('End date must be after start date');

  const siteExists = await query('SELECT 1 FROM sites WHERE id = $1 AND park_id = $2', [siteId, parkId]);
  if (!siteExists.rows.length) throw new Error('Unknown site');

  const id = `season-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await query(
    'INSERT INTO seasonal_rates (id, site_id, label, start_date, end_date, nightly_rate_cents) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, siteId, label || 'Seasonal Rate', startDate, endDate, Number(nightlyRateCents)]
  );
  return getSite(siteId);
}

export async function removeSeasonalRate(siteId, parkId, seasonId) {
  const siteExists = await query('SELECT 1 FROM sites WHERE id = $1 AND park_id = $2', [siteId, parkId]);
  if (!siteExists.rows.length) throw new Error('Unknown site');
  await query('DELETE FROM seasonal_rates WHERE id = $1 AND site_id = $2', [seasonId, siteId]);
  return getSite(siteId);
}

export async function getReservationsForPark(parkId) {
  const res = await query('SELECT * FROM reservations WHERE park_id = $1 ORDER BY created_at DESC', [parkId]);
  return res.rows.map(mapReservation);
}

// Owner dashboard summary: money actually collected so far, the balance
// still owed on deposit-only bookings, average daily rate, and occupancy
// over the next `windowDays` (upcoming, not historical — what an owner
// checking their dashboard today actually wants to know is how full the
// weeks ahead are).
export async function getParkStats(parkId, { windowDays = 30 } = {}) {
  const siteCountRes = await query('SELECT COUNT(*)::int AS count FROM sites WHERE park_id = $1', [parkId]);
  const siteCount = siteCountRes.rows[0].count;

  const resRes = await query(`SELECT * FROM reservations WHERE park_id = $1 AND status IN ('confirmed','confirmed-deposit')`, [parkId]);
  const reservations = resRes.rows.map(mapReservation);

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
// that's already been collected. This is a calculation only — see
// api/admin/dashboard.js and api/reservations/create-checkout.js for the
// actual Stripe Connect logic that automates payouts once a park connects.
export async function getPayoutSummary(parkId) {
  const resRes = await query(`SELECT * FROM reservations WHERE park_id = $1 AND status IN ('confirmed','confirmed-deposit')`, [parkId]);
  const reservations = resRes.rows.map(mapReservation);

  let grossCollectedCents = 0;
  let platformFeeCollectedCents = 0;

  for (const r of reservations) {
    const collectedCents = r.status === 'confirmed-deposit' ? r.depositCents : r.totalCents;
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

export async function createGuestAccount({ name, email, password, phone }) {
  if (!name || !email || !password) throw new Error('Name, email, and password are required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const normalizedEmail = normalizeEmail(email);
  const existing = await query('SELECT 1 FROM guests WHERE email = $1', [normalizedEmail]);
  if (existing.rows.length) throw new Error('An account with that email already exists');

  const id = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = bcrypt.hashSync(password, 10);
  const res = await query(
    'INSERT INTO guests (id, name, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [id, name, normalizedEmail, phone || '', passwordHash]
  );
  return mapGuest(res.rows[0]);
}

export async function verifyGuestLogin(email, password) {
  const res = await query('SELECT * FROM guests WHERE email = $1', [normalizeEmail(email)]);
  const row = res.rows[0];
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) return null;
  return mapGuest(row);
}

export async function getGuestByEmail(email) {
  const res = await query('SELECT * FROM guests WHERE email = $1', [normalizeEmail(email)]);
  return res.rows[0] ? mapGuest(res.rows[0]) : null;
}

export async function getBookingsForGuest(email) {
  const normalizedEmail = normalizeEmail(email);
  const res = await query(
    `SELECT r.*, p.name AS park_name FROM reservations r
     JOIN parks p ON p.id = r.park_id
     WHERE r.guest_email = $1 ORDER BY r.created_at DESC`,
    [normalizedEmail]
  );
  return res.rows.map((row) => ({ ...mapReservation(row), parkName: row.park_name }));
}

// Self-service cancellation — scoped to the guest's own email so a guest
// can never cancel someone else's booking even if they guessed a
// reservation id.
export async function cancelReservationForGuest(reservationId, guestEmail) {
  const res = await query('SELECT * FROM reservations WHERE id = $1', [reservationId]);
  const row = res.rows[0];
  if (!row || normalizeEmail(row.guest_email) !== normalizeEmail(guestEmail)) throw new Error('Reservation not found');
  if (row.status === 'canceled') throw new Error('Already canceled');
  if (new Date(row.check_in) <= new Date()) throw new Error("Can't cancel a stay that's already started");

  const updated = await query(`UPDATE reservations SET status = 'canceled', canceled_at = now() WHERE id = $1 RETURNING *`, [reservationId]);
  return mapReservation(updated.rows[0]);
}
