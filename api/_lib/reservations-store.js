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
import dns from 'dns';

const { Pool, types } = pg;

// Some networks' DNS servers intermittently refuse lookups for Neon's
// hostnames (observed repeatedly in local dev on at least one ISP router)
// even though the hostname is valid — routing through public resolvers
// avoids that flakiness. Harmless in production too.
//
// dns.setServers() alone isn't enough: it only affects dns.resolve*(), but
// `pg` connects via net.connect(), which calls dns.lookup() — a *different*
// code path that always defers to the OS resolver regardless of
// setServers(). Patching dns.lookup() itself to go through resolve4()
// first (falling back to the normal OS lookup for anything that fails,
// e.g. genuinely local hostnames) is what actually reaches pg's connection.
dns.setServers(['1.1.1.1', '8.8.8.8']);
const osLookup = dns.lookup;
dns.lookup = function patchedLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dns.resolve4(hostname, (err, addresses) => {
    if (err || !addresses?.length) return osLookup.call(dns, hostname, options, callback);
    if (options && options.all) return callback(null, addresses.map((address) => ({ address, family: 4 })));
    callback(null, addresses[0], 4);
  });
};

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

// Exposed so route handlers that need the raw pool (e.g. to hand it to
// api/_lib/social-media-manager.js functions, which take `pool` as their
// first argument) can reuse this single connection pool instead of
// opening a second one.
export function getPool() {
  return pool;
}

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
        name TEXT,
        location TEXT,
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
        plan_key TEXT,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      -- name/location used to be NOT NULL; an owner account can now exist
      -- before their park is registered (signup -> pick a plan -> pay ->
      -- THEN register the park), so both must be nullable. Also backfills
      -- the plan/Stripe columns onto a table that already existed before
      -- this feature. All of these are no-ops once already applied.
      ALTER TABLE parks ALTER COLUMN name DROP NOT NULL;
      ALTER TABLE parks ALTER COLUMN location DROP NOT NULL;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS plan_key TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS dynamic_pricing_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS min_price_cents INTEGER NOT NULL DEFAULT 2000;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS max_price_cents INTEGER NOT NULL DEFAULT 50000;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS occupancy_target_percent INTEGER NOT NULL DEFAULT 85;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS airbnb_listing_id TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS booking_listing_id TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS vrbo_listing_id TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS ota_integration_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS ghl_crm_url TEXT;

      -- Named platform-admin accounts. Alongside SUPER_ADMIN_PASSWORD (kept
      -- as a bootstrap/recovery login), this lets more than one real person
      -- have their own super-admin credentials instead of sharing one secret.
      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(lower(email));

      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        nightly_rate_cents INTEGER NOT NULL,
        price_modifier NUMERIC NOT NULL DEFAULT 1.0
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

      CREATE TABLE IF NOT EXISTS pricing_log (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        date_of_stay DATE NOT NULL,
        previous_rate_cents INTEGER NOT NULL,
        suggested_rate_cents INTEGER NOT NULL,
        applied_rate_cents INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        applied_by TEXT,
        applied_at TIMESTAMPTZ,
        reservation_id TEXT REFERENCES reservations(id),
        actual_revenue_cents INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_pricing_log_park ON pricing_log(park_id);
      CREATE INDEX IF NOT EXISTS idx_pricing_log_date ON pricing_log(date_of_stay);

      CREATE TABLE IF NOT EXISTS peak_date_ranges (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_peak_ranges_park ON peak_date_ranges(park_id);

      -- OTA Integration tables
      CREATE TABLE IF NOT EXISTS ota_bookings (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        ota_name TEXT NOT NULL,
        ota_booking_id TEXT NOT NULL,
        guest_id TEXT NOT NULL REFERENCES guests(id),
        linked_reservation_id TEXT REFERENCES reservations(id),
        pulled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(park_id, ota_name, ota_booking_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ota_bookings_park ON ota_bookings(park_id);
      CREATE INDEX IF NOT EXISTS idx_ota_bookings_ota ON ota_bookings(ota_name);
      CREATE INDEX IF NOT EXISTS idx_ota_bookings_guest ON ota_bookings(guest_id);

      CREATE TABLE IF NOT EXISTS ota_sync_logs (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        ota_name TEXT NOT NULL,
        sync_type TEXT NOT NULL,
        status TEXT NOT NULL,
        error_msg TEXT,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_ota_sync_logs_park ON ota_sync_logs(park_id);
      CREATE INDEX IF NOT EXISTS idx_ota_sync_logs_ota ON ota_sync_logs(ota_name);
      CREATE INDEX IF NOT EXISTS idx_ota_sync_logs_synced_at ON ota_sync_logs(synced_at DESC);

      CREATE TABLE IF NOT EXISTS ota_credentials (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        ota_name TEXT NOT NULL,
        credentials TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(park_id, ota_name)
      );
      CREATE INDEX IF NOT EXISTS idx_ota_credentials_park ON ota_credentials(park_id);

      CREATE TABLE IF NOT EXISTS blocked_dates (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        reason TEXT NOT NULL DEFAULT 'Blocked by staff',
        blocked_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_blocked_dates_park_site ON blocked_dates(park_id, site_id);
      CREATE INDEX IF NOT EXISTS idx_blocked_dates_date ON blocked_dates(date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_dates_unique ON blocked_dates(site_id, date);

      -- CRM Integration tables
      CREATE TABLE IF NOT EXISTS guest_profiles (
        id TEXT PRIMARY KEY,
        guest_email TEXT NOT NULL UNIQUE,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        lifetime_value_cents INTEGER NOT NULL DEFAULT 0,
        risk_score INTEGER NOT NULL DEFAULT 0,
        last_contacted TIMESTAMPTZ,
        preferences_json TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_guest_profiles_park ON guest_profiles(park_id);
      CREATE INDEX IF NOT EXISTS idx_guest_profiles_email ON guest_profiles(guest_email);

      CREATE TABLE IF NOT EXISTS guest_notes (
        id TEXT PRIMARY KEY,
        guest_email TEXT NOT NULL,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        note_text TEXT NOT NULL,
        created_by_staff_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_guest_notes_park_email ON guest_notes(park_id, guest_email);
      CREATE INDEX IF NOT EXISTS idx_guest_notes_created ON guest_notes(created_at DESC);

      CREATE TABLE IF NOT EXISTS guest_tags (
        id TEXT PRIMARY KEY,
        guest_email TEXT NOT NULL,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        tag_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_guest_tags_park_email ON guest_tags(park_id, guest_email);
      CREATE INDEX IF NOT EXISTS idx_guest_tags_park_tag ON guest_tags(park_id, tag_name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_tags_unique ON guest_tags(guest_email, park_id, tag_name);

      CREATE TABLE IF NOT EXISTS communication_log (
        id TEXT PRIMARY KEY,
        guest_email TEXT NOT NULL,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        subject TEXT,
        message_preview TEXT,
        status TEXT NOT NULL DEFAULT 'sent',
        timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_communication_log_park_email ON communication_log(park_id, guest_email);
      CREATE INDEX IF NOT EXISTS idx_communication_log_timestamp ON communication_log(timestamp DESC);

      -- Campaign Management tables
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        budget_cents INTEGER,
        discount_amount NUMERIC NOT NULL DEFAULT 0,
        discount_type TEXT NOT NULL DEFAULT 'percent',
        promo_code TEXT,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_campaigns_park_status ON campaigns(park_id, status);
      CREATE INDEX IF NOT EXISTS idx_campaigns_park_dates ON campaigns(park_id, start_date, end_date);

      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        guest_email TEXT NOT NULL,
        guest_phone TEXT,
        guest_id TEXT,
        email_sent BOOLEAN DEFAULT false,
        email_sent_at TIMESTAMPTZ,
        email_opened BOOLEAN DEFAULT false,
        email_clicked BOOLEAN DEFAULT false,
        email_click_count INTEGER DEFAULT 0,
        sms_sent BOOLEAN DEFAULT false,
        sms_sent_at TIMESTAMPTZ,
        sms_delivered BOOLEAN DEFAULT false,
        converted BOOLEAN DEFAULT false,
        conversion_value_cents INTEGER DEFAULT 0,
        conversion_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_guest_email ON campaign_recipients(guest_email);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_recipients_unique ON campaign_recipients(campaign_id, guest_email);

      CREATE TABLE IF NOT EXISTS campaign_performance (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        emails_sent INTEGER DEFAULT 0,
        emails_opened INTEGER DEFAULT 0,
        emails_clicked INTEGER DEFAULT 0,
        open_rate_percent NUMERIC DEFAULT 0,
        click_rate_percent NUMERIC DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        conversion_rate_percent NUMERIC DEFAULT 0,
        revenue_generated_cents INTEGER DEFAULT 0,
        cost_cents INTEGER DEFAULT 0,
        roi_percent NUMERIC DEFAULT 0,
        calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_performance_campaign ON campaign_performance(campaign_id);

      CREATE TABLE IF NOT EXISTS campaign_variants (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        variant_name TEXT NOT NULL,
        variant_type TEXT NOT NULL DEFAULT 'A',
        subject TEXT,
        body TEXT,
        sms_body TEXT,
        recipient_count INTEGER DEFAULT 0,
        emails_sent INTEGER DEFAULT 0,
        emails_opened INTEGER DEFAULT 0,
        email_open_rate_percent NUMERIC DEFAULT 0,
        emails_clicked INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        revenue_cents INTEGER DEFAULT 0,
        is_winner BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_variants_campaign ON campaign_variants(campaign_id);

      -- Social Media Integration tables
      CREATE TABLE IF NOT EXISTS social_accounts (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        access_token_encrypted TEXT NOT NULL,
        refresh_token_encrypted TEXT,
        status TEXT NOT NULL DEFAULT 'connected',
        last_posted TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(park_id, platform)
      );
      CREATE INDEX IF NOT EXISTS idx_social_accounts_park ON social_accounts(park_id);
      CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);

      CREATE TABLE IF NOT EXISTS social_posts (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        content TEXT NOT NULL,
        image_url TEXT,
        scheduled_time TIMESTAMPTZ,
        published_time TIMESTAMPTZ,
        platform_post_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        engagement_json TEXT DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_social_posts_park ON social_posts(park_id);
      CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
      CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_time);

      CREATE TABLE IF NOT EXISTS social_metrics (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        date_collected DATE NOT NULL,
        likes INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        reach INTEGER DEFAULT 0,
        engagement_rate NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(park_id, platform, date_collected)
      );
      CREATE INDEX IF NOT EXISTS idx_social_metrics_park ON social_metrics(park_id);
      CREATE INDEX IF NOT EXISTS idx_social_metrics_date ON social_metrics(date_collected);

      -- Competitive Intelligence tables
      CREATE TABLE IF NOT EXISTS competitors (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        website_url TEXT,
        location TEXT,
        scrape_enabled BOOLEAN NOT NULL DEFAULT true,
        last_scraped TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_competitors_park ON competitors(park_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_competitors_unique ON competitors(park_id, website_url);
      ALTER TABLE competitors ALTER COLUMN website_url DROP NOT NULL;
      ALTER TABLE competitors ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE competitors ADD COLUMN IF NOT EXISTS google_maps_url TEXT;
      ALTER TABLE competitors ADD COLUMN IF NOT EXISTS place_id TEXT;
      ALTER TABLE competitors ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
      ALTER TABLE competitors ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

      CREATE TABLE IF NOT EXISTS competitor_pricing (
        id TEXT PRIMARY KEY,
        competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        avg_rate_cents INTEGER,
        low_rate_cents INTEGER,
        high_rate_cents INTEGER,
        occupancy_signal NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_competitor_pricing_competitor ON competitor_pricing(competitor_id);
      CREATE INDEX IF NOT EXISTS idx_competitor_pricing_date ON competitor_pricing(date DESC);

      CREATE TABLE IF NOT EXISTS market_analytics (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        market_avg_rate_cents INTEGER,
        market_median_cents INTEGER,
        price_percentile NUMERIC,
        competitor_count INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_market_analytics_park ON market_analytics(park_id);
      CREATE INDEX IF NOT EXISTS idx_market_analytics_date ON market_analytics(date DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_market_analytics_unique ON market_analytics(park_id, date);

      CREATE TABLE IF NOT EXISTS pricing_suggestions (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        suggested_rate_cents INTEGER NOT NULL,
        confidence_score NUMERIC NOT NULL,
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_pricing_suggestions_park ON pricing_suggestions(park_id);
      CREATE INDEX IF NOT EXISTS idx_pricing_suggestions_site ON pricing_suggestions(site_id);

      -- Booking Rules Engine tables
      CREATE TABLE IF NOT EXISTS booking_rules (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
        rule_type TEXT NOT NULL,
        rule_config_json TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_booking_rules_park ON booking_rules(park_id);
      CREATE INDEX IF NOT EXISTS idx_booking_rules_site ON booking_rules(site_id);
      CREATE INDEX IF NOT EXISTS idx_booking_rules_active ON booking_rules(is_active);

      CREATE TABLE IF NOT EXISTS blackout_dates (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason TEXT NOT NULL DEFAULT 'Blocked by staff',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_blackout_dates_park_site ON blackout_dates(park_id, site_id);
      CREATE INDEX IF NOT EXISTS idx_blackout_dates_date_range ON blackout_dates(start_date, end_date);

      -- Phase 4: Multi-Property Management tables
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS owner_id TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS display_name TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS website_url TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS branding_json TEXT DEFAULT '{}';
      CREATE INDEX IF NOT EXISTS idx_parks_owner_id ON parks(owner_id);

      CREATE TABLE IF NOT EXISTS user_permissions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        permission_level TEXT NOT NULL DEFAULT 'staff',
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, park_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_permissions_park ON user_permissions(park_id);
      CREATE INDEX IF NOT EXISTS idx_user_permissions_level ON user_permissions(permission_level);

      CREATE TABLE IF NOT EXISTS property_groups (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        group_type TEXT NOT NULL DEFAULT 'brand',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_property_groups_owner ON property_groups(owner_id);

      CREATE TABLE IF NOT EXISTS property_group_members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES property_groups(id) ON DELETE CASCADE,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(group_id, park_id)
      );
      CREATE INDEX IF NOT EXISTS idx_property_group_members_group ON property_group_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_property_group_members_park ON property_group_members(park_id);

      CREATE TABLE IF NOT EXISTS bulk_operations (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        properties_count INTEGER,
        completed_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        operation_data TEXT NOT NULL,
        error_log TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_bulk_operations_owner ON bulk_operations(owner_id);
      CREATE INDEX IF NOT EXISTS idx_bulk_operations_status ON bulk_operations(status);

      CREATE TABLE IF NOT EXISTS operation_audit_log (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES bulk_operations(id) ON DELETE CASCADE,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        result TEXT NOT NULL,
        details TEXT,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_operation_audit_log_operation ON operation_audit_log(operation_id);
      CREATE INDEX IF NOT EXISTS idx_operation_audit_log_park ON operation_audit_log(park_id);

      -- Phase 4: ML Rate Optimization Engine tables
      CREATE TABLE IF NOT EXISTS ml_models (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        model_version TEXT NOT NULL DEFAULT '1.0',
        model_json TEXT NOT NULL,
        accuracy_mae NUMERIC,
        last_trained TIMESTAMPTZ NOT NULL DEFAULT now(),
        data_points_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_ml_models_site ON ml_models(site_id);
      CREATE INDEX IF NOT EXISTS idx_ml_models_park ON ml_models(park_id);
      CREATE INDEX IF NOT EXISTS idx_ml_models_trained ON ml_models(last_trained DESC);

      CREATE TABLE IF NOT EXISTS rate_suggestions (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        suggested_rate NUMERIC NOT NULL,
        confidence NUMERIC NOT NULL DEFAULT 0.8,
        predicted_occupancy NUMERIC,
        revenue_estimate NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_rate_suggestions_site_date ON rate_suggestions(site_id, date);
      CREATE INDEX IF NOT EXISTS idx_rate_suggestions_park ON rate_suggestions(park_id);
      CREATE INDEX IF NOT EXISTS idx_rate_suggestions_created ON rate_suggestions(created_at DESC);

      CREATE TABLE IF NOT EXISTS rate_performance (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        date_of_stay DATE NOT NULL,
        set_rate NUMERIC,
        actual_occupancy NUMERIC,
        actual_revenue_cents INTEGER,
        ai_suggested_rate NUMERIC,
        accuracy_error NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_rate_performance_site_date ON rate_performance(site_id, date_of_stay);
      CREATE INDEX IF NOT EXISTS idx_rate_performance_park ON rate_performance(park_id);
      CREATE INDEX IF NOT EXISTS idx_rate_performance_created ON rate_performance(created_at DESC);

      -- Occupancy Forecasting tables
      CREATE TABLE IF NOT EXISTS occupancy_forecasts (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        forecast_date DATE NOT NULL,
        forecast_occupancy NUMERIC NOT NULL,
        confidence_lower NUMERIC NOT NULL,
        confidence_upper NUMERIC NOT NULL,
        confidence_margin NUMERIC NOT NULL,
        season TEXT NOT NULL DEFAULT 'unknown',
        trend TEXT NOT NULL DEFAULT 'stable',
        components_json TEXT DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(park_id, forecast_date)
      );
      CREATE INDEX IF NOT EXISTS idx_occupancy_forecasts_park ON occupancy_forecasts(park_id);
      CREATE INDEX IF NOT EXISTS idx_occupancy_forecasts_date ON occupancy_forecasts(forecast_date);
      CREATE INDEX IF NOT EXISTS idx_occupancy_forecasts_created ON occupancy_forecasts(created_at DESC);

      CREATE TABLE IF NOT EXISTS seasonal_analysis (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        month INTEGER NOT NULL,
        month_name TEXT NOT NULL,
        average_occupancy NUMERIC NOT NULL,
        season TEXT NOT NULL,
        calendar_json TEXT DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(park_id, month)
      );
      CREATE INDEX IF NOT EXISTS idx_seasonal_analysis_park ON seasonal_analysis(park_id);
      CREATE INDEX IF NOT EXISTS idx_seasonal_analysis_updated ON seasonal_analysis(updated_at DESC);

      CREATE TABLE IF NOT EXISTS booking_pace_metrics (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        metric_date DATE NOT NULL,
        days_ahead_booked INTEGER NOT NULL,
        pace_index INTEGER NOT NULL,
        lead_time_avg_days INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(site_id, metric_date)
      );
      CREATE INDEX IF NOT EXISTS idx_booking_pace_site ON booking_pace_metrics(site_id);
      CREATE INDEX IF NOT EXISTS idx_booking_pace_park ON booking_pace_metrics(park_id);
      CREATE INDEX IF NOT EXISTS idx_booking_pace_date ON booking_pace_metrics(metric_date DESC);
    `).catch((err) => { schemaReady = null; throw err; }); // don't cache a failed init — next call retries
  }
  return schemaReady;
}

export async function query(text, params) {
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
    planKey: row.plan_key, stripeCustomerId: row.stripe_customer_id, stripeSubscriptionId: row.stripe_subscription_id,
    dynamicPricingEnabled: row.dynamic_pricing_enabled || false,
    minPriceCents: Number(row.min_price_cents) || 2000,
    maxPriceCents: Number(row.max_price_cents) || 50000,
    occupancyTargetPercent: Number(row.occupancy_target_percent) || 85,
    airbnbListingId: row.airbnb_listing_id,
    bookingListingId: row.booking_listing_id,
    vrboListingId: row.vrbo_listing_id,
    otaIntegrationEnabled: row.ota_integration_enabled || false,
    ghlCrmUrl: row.ghl_crm_url,
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
    priceModifier: Number(row.price_modifier) || 1.0,
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

function mapPricingLog(row) {
  return {
    id: row.id,
    parkId: row.park_id,
    siteId: row.site_id,
    dateOfStay: row.date_of_stay,
    previousRateCents: Number(row.previous_rate_cents),
    suggestedRateCents: Number(row.suggested_rate_cents),
    appliedRateCents: row.applied_rate_cents ? Number(row.applied_rate_cents) : null,
    status: row.status,
    appliedBy: row.applied_by,
    appliedAt: row.applied_at ? row.applied_at.toISOString() : null,
    reservationId: row.reservation_id,
    actualRevenueCents: row.actual_revenue_cents ? Number(row.actual_revenue_cents) : null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapPeakDateRange(row) {
  return {
    id: row.id,
    parkId: row.park_id,
    label: row.label,
    startDate: row.start_date,
    endDate: row.end_date,
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
  // name IS NOT NULL excludes owner accounts that haven't registered their
  // park yet (signed up, maybe even paid, but never finished step 2) —
  // those must never be bookable or show up in public search.
  const parksRes = q
    ? await query(`SELECT * FROM parks WHERE name IS NOT NULL AND (name ILIKE $1 OR location ILIKE $1 OR state ILIKE $1)`, [`%${q}%`])
    : await query('SELECT * FROM parks WHERE name IS NOT NULL');
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

  // Release abandoned checkouts back into availability — siteIsStillAvailable()
  // only runs this cleanup for one site during an actual booking attempt, so a
  // guest who abandons Stripe mid-checkout left a 'pending' row that a plain
  // search would otherwise treat as blocking forever, well past its 20-minute
  // hold window.
  await query(
    `UPDATE reservations SET status = 'canceled' WHERE park_id = $1 AND status = 'pending' AND hold_expires_at < now()`,
    [parkId]
  );

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
// what runs when an owner signs themselves up from the public site. This
// only creates the owner's login identity — no park yet. The intended
// flow is signup -> pick a plan -> pay -> registerPark() (below), so the
// row's id is derived from the owner's email (like staffUsername already
// was) rather than a park name that doesn't exist yet.
export async function signupOwnerAccount({ ownerName, email, phone, password }) {
  if (!ownerName || !email || !phone || !password) throw new Error('All fields are required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  // verifyParkLogin() slugifies whatever username it's given before
  // comparing, so the stored staffUsername must be pre-slugified too —
  // otherwise "jane@example.com" would never match "jane-example-com".
  const username = slugify(email);
  const existing = await query('SELECT 1 FROM parks WHERE staff_username = $1', [username]);
  if (existing.rows.length) throw new Error('An account with that email already exists');

  const passwordHash = bcrypt.hashSync(password, 10);
  const res = await query(
    `INSERT INTO parks (id, owner_name, owner_email, owner_phone, staff_username, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [username, ownerName, normalizeEmail(email), phone, username, passwordHash]
  );
  return mapPark(res.rows[0]);
}

// Step 2 of owner onboarding — fills in the real park name/location once
// the owner has picked and paid for a plan. Keeps the same row/id from
// signupOwnerAccount(), so every session/site/reservation reference made
// afterward is unaffected by this update.
export async function registerPark(parkId, { parkName, location }) {
  if (!parkName || !location) throw new Error('Park name and location are required');
  const res = await query('UPDATE parks SET name = $2, location = $3 WHERE id = $1 RETURNING *', [parkId, parkName, location]);
  if (!res.rows[0]) throw new Error('Unknown park');
  return mapPark(res.rows[0]);
}

// Records which subscription plan an owner is on — called from the Stripe
// webhook once their subscription checkout completes (see
// api/reservations/webhook.js's 'subscription' mode branch).
export async function setParkPlan(parkId, { planKey, stripeCustomerId, stripeSubscriptionId }) {
  const res = await query(
    'UPDATE parks SET plan_key = $2, stripe_customer_id = $3, stripe_subscription_id = $4 WHERE id = $1 RETURNING *',
    [parkId, planKey, stripeCustomerId, stripeSubscriptionId]
  );
  if (!res.rows[0]) throw new Error('Unknown park');
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
function mapAdminUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, createdAt: row.created_at.toISOString() };
}

export async function createAdminUser({ name, email, phone, password }) {
  if (!name || !email || !password) throw new Error('Name, email, and password are required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const existing = await query('SELECT 1 FROM admin_users WHERE lower(email) = lower($1)', [email]);
  if (existing.rows.length) throw new Error('An admin account with that email already exists');

  const id = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = bcrypt.hashSync(password, 10);
  const res = await query(
    'INSERT INTO admin_users (id, name, email, phone, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, name, email, phone || null, passwordHash]
  );
  return mapAdminUser(res.rows[0]);
}

export async function verifyAdminLogin(email, password) {
  const res = await query('SELECT * FROM admin_users WHERE lower(email) = lower($1)', [email || '']);
  const row = res.rows[0];
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) return null;
  return mapAdminUser(row);
}

export async function listAdminUsers() {
  const res = await query('SELECT * FROM admin_users ORDER BY created_at ASC');
  return res.rows.map(mapAdminUser);
}

export async function removeAdminUser(adminId) {
  const res = await query('DELETE FROM admin_users WHERE id = $1', [adminId]);
  if (res.rowCount === 0) throw new Error('Unknown admin account');
}

export async function setParkGhlCrmUrl(parkId, ghlCrmUrl) {
  const res = await query('UPDATE parks SET ghl_crm_url = $2 WHERE id = $1 RETURNING *', [parkId, ghlCrmUrl || null]);
  if (!res.rows.length) throw new Error('Unknown park');
  return mapPark(res.rows[0]);
}

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

// Applying a dynamic-pricing suggestion for a single date needs to actually
// change what a guest pays that day — the only mechanism the booking flow
// consults for a date-specific rate is a seasonal_rates row (see
// rateForDate below). Upserts a one-day range for [dateOfStay, dateOfStay+1)
// rather than inserting a duplicate every time the same date gets
// re-applied.
export async function applyDynamicPriceOverride(siteId, parkId, dateOfStay, nightlyRateCents) {
  const siteExists = await query('SELECT 1 FROM sites WHERE id = $1 AND park_id = $2', [siteId, parkId]);
  if (!siteExists.rows.length) throw new Error('Unknown site');

  const startDate = dateOfStay;
  const endDate = new Date(new Date(dateOfStay).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const existing = await query(
    `SELECT id FROM seasonal_rates WHERE site_id = $1 AND start_date = $2 AND end_date = $3 AND label = 'Dynamic Pricing'`,
    [siteId, startDate, endDate]
  );

  if (existing.rows.length) {
    await query('UPDATE seasonal_rates SET nightly_rate_cents = $2 WHERE id = $1', [existing.rows[0].id, Number(nightlyRateCents)]);
  } else {
    const id = `season-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await query(
      'INSERT INTO seasonal_rates (id, site_id, label, start_date, end_date, nightly_rate_cents) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, siteId, 'Dynamic Pricing', startDate, endDate, Number(nightlyRateCents)]
    );
  }
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
  if (!name || !email || !password || !phone) throw new Error('Name, email, phone, and password are required');
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

/* ---------------------------------------------------------------- */
/* Dynamic pricing configuration                                    */
/* ---------------------------------------------------------------- */

export async function updatePricingSettings(parkId, settings = {}) {
  const sets = [];
  const params = [parkId];

  if (settings.dynamicPricingEnabled !== undefined) {
    params.push(settings.dynamicPricingEnabled);
    sets.push(`dynamic_pricing_enabled = $${params.length}`);
  }
  if (settings.minPriceCents !== undefined) {
    const minPrice = Number(settings.minPriceCents);
    if (isNaN(minPrice) || minPrice < 0) throw new Error('Min price must be non-negative');
    params.push(minPrice);
    sets.push(`min_price_cents = $${params.length}`);
  }
  if (settings.maxPriceCents !== undefined) {
    const maxPrice = Number(settings.maxPriceCents);
    if (isNaN(maxPrice) || maxPrice < 0) throw new Error('Max price must be non-negative');
    params.push(maxPrice);
    sets.push(`max_price_cents = $${params.length}`);
  }
  if (settings.occupancyTargetPercent !== undefined) {
    const target = Number(settings.occupancyTargetPercent);
    if (isNaN(target) || target < 0 || target > 100) throw new Error('Occupancy target must be between 0 and 100');
    params.push(target);
    sets.push(`occupancy_target_percent = $${params.length}`);
  }

  if (!sets.length) {
    return getPark(parkId);
  }

  const res = await query(`UPDATE parks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (!res.rows[0]) throw new Error('Unknown park');
  return getPark(parkId);
}

export async function updateSiteModifier(siteId, parkId, priceModifier) {
  const modifier = Number(priceModifier);
  if (isNaN(modifier) || modifier < 0.5 || modifier > 2.0) {
    throw new Error('Site modifier must be between 0.5 and 2.0');
  }

  const res = await query(
    'UPDATE sites SET price_modifier = $1 WHERE id = $2 AND park_id = $3 RETURNING *',
    [modifier, siteId, parkId]
  );
  if (!res.rows[0]) throw new Error('Unknown site');
  return getSite(siteId);
}

export async function getPeakDateRanges(parkId) {
  const res = await query(
    'SELECT * FROM peak_date_ranges WHERE park_id = $1 ORDER BY start_date ASC',
    [parkId]
  );
  return res.rows.map(mapPeakDateRange);
}

export async function addPeakDateRange(parkId, { label, startDate, endDate }) {
  if (!startDate || !endDate) throw new Error('Start and end dates are required');
  if (new Date(endDate) <= new Date(startDate)) throw new Error('End date must be after start date');

  const parkExists = await query('SELECT 1 FROM parks WHERE id = $1', [parkId]);
  if (!parkExists.rows.length) throw new Error('Unknown park');

  const id = `peak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await query(
    'INSERT INTO peak_date_ranges (id, park_id, label, start_date, end_date) VALUES ($1,$2,$3,$4,$5)',
    [id, parkId, label || 'Peak Season', startDate, endDate]
  );
  return getPeakDateRanges(parkId);
}

export async function removePeakDateRange(parkId, rangeId) {
  const parkExists = await query('SELECT 1 FROM parks WHERE id = $1', [parkId]);
  if (!parkExists.rows.length) throw new Error('Unknown park');
  await query('DELETE FROM peak_date_ranges WHERE id = $1 AND park_id = $2', [rangeId, parkId]);
  return getPeakDateRanges(parkId);
}

export async function logPricingChange(parkId, siteId, dateOfStay, previousRateCents, suggestedRateCents) {
  const id = `plog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await query(
    `INSERT INTO pricing_log
      (id, park_id, site_id, date_of_stay, previous_rate_cents, suggested_rate_cents, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending')
     RETURNING *`,
    [id, parkId, siteId, dateOfStay, previousRateCents, suggestedRateCents]
  );
  return mapPricingLog(res.rows[0]);
}

export async function applyPricingChange(logId, appliedRateCents, appliedByUser) {
  const res = await query(
    `UPDATE pricing_log
     SET status = 'applied', applied_rate_cents = $2, applied_by = $3, applied_at = now()
     WHERE id = $1 RETURNING *`,
    [logId, appliedRateCents, appliedByUser]
  );
  if (!res.rows[0]) throw new Error('Unknown pricing log entry');
  return mapPricingLog(res.rows[0]);
}

export async function getPricingLog(parkId, fromDate = null, toDate = null) {
  let whereClause = 'park_id = $1';
  const params = [parkId];

  if (fromDate) {
    params.push(fromDate);
    whereClause += ` AND date_of_stay >= $${params.length}`;
  }
  if (toDate) {
    params.push(toDate);
    whereClause += ` AND date_of_stay <= $${params.length}`;
  }

  const res = await query(
    `SELECT * FROM pricing_log WHERE ${whereClause} ORDER BY date_of_stay DESC`,
    params
  );
  return res.rows.map(mapPricingLog);
}

/* ---------------------------------------------------------------- */
/* Calendar Grid Functions — blocked dates, reservation management  */
/* ---------------------------------------------------------------- */

function mapBlockedDate(row) {
  if (!row) return null;
  return {
    id: row.id,
    parkId: row.park_id,
    siteId: row.site_id,
    date: row.date instanceof Date ? row.date : new Date(row.date + 'T00:00:00Z'),
    reason: row.reason,
    blockedAt: new Date(row.blocked_at),
  };
}

/* Campaign mapping functions */
function mapCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    parkId: row.park_id,
    name: row.name,
    type: row.type,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    budgetCents: row.budget_cents ? Number(row.budget_cents) : null,
    discountAmount: Number(row.discount_amount),
    discountType: row.discount_type,
    promoCode: row.promo_code,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapCampaignRecipient(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    guestId: row.guest_id,
    emailSent: row.email_sent,
    emailSentAt: row.email_sent_at ? row.email_sent_at.toISOString() : null,
    emailOpened: row.email_opened,
    emailClicked: row.email_clicked,
    emailClickCount: row.email_click_count || 0,
    smsSent: row.sms_sent,
    smsSentAt: row.sms_sent_at ? row.sms_sent_at.toISOString() : null,
    smsDelivered: row.sms_delivered,
    converted: row.converted,
    conversionValueCents: row.conversion_value_cents || 0,
    conversionDate: row.conversion_date ? row.conversion_date.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapCampaignPerformance(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    emailsSent: row.emails_sent || 0,
    emailsOpened: row.emails_opened || 0,
    emailsClicked: row.emails_clicked || 0,
    openRatePercent: Number(row.open_rate_percent) || 0,
    clickRatePercent: Number(row.click_rate_percent) || 0,
    conversions: row.conversions || 0,
    conversionRatePercent: Number(row.conversion_rate_percent) || 0,
    revenueGeneratedCents: row.revenue_generated_cents || 0,
    costCents: row.cost_cents || 0,
    roiPercent: Number(row.roi_percent) || 0,
    calculatedAt: row.calculated_at.toISOString(),
  };
}

function mapCampaignVariant(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    variantName: row.variant_name,
    variantType: row.variant_type,
    subject: row.subject,
    body: row.body,
    smsBody: row.sms_body,
    recipientCount: row.recipient_count || 0,
    emailsSent: row.emails_sent || 0,
    emailsOpened: row.emails_opened || 0,
    emailOpenRatePercent: Number(row.email_open_rate_percent) || 0,
    emailsClicked: row.emails_clicked || 0,
    conversions: row.conversions || 0,
    revenueCents: row.revenue_cents || 0,
    isWinner: row.is_winner || false,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getBlockedDatesForPark(parkId, startDate = null, endDate = null) {
  let whereClause = 'park_id = $1';
  const params = [parkId];

  if (startDate) {
    params.push(startDate instanceof Date ? startDate.toISOString().split('T')[0] : startDate);
    whereClause += ` AND date >= $${params.length}`;
  }
  if (endDate) {
    params.push(endDate instanceof Date ? endDate.toISOString().split('T')[0] : endDate);
    whereClause += ` AND date <= $${params.length}`;
  }

  const res = await query(
    `SELECT * FROM blocked_dates WHERE ${whereClause} ORDER BY date ASC`,
    params
  );
  return res.rows.map(mapBlockedDate);
}

export async function addBlockedDate(parkId, siteId, date, reason = 'Blocked by staff') {
  const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date;
  const id = `block-${siteId}-${dateStr}`;

  try {
    const res = await query(
      `INSERT INTO blocked_dates (id, park_id, site_id, date, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (site_id, date) DO UPDATE SET reason = $5
       RETURNING *`,
      [id, parkId, siteId, dateStr, reason]
    );
    return mapBlockedDate(res.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      // Unique constraint violation — already blocked
      const existing = await query(
        'SELECT * FROM blocked_dates WHERE site_id = $1 AND date = $2',
        [siteId, dateStr]
      );
      return mapBlockedDate(existing.rows[0]);
    }
    throw err;
  }
}

export async function removeBlockedDate(parkId, siteId, date) {
  const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date;
  const res = await query(
    'DELETE FROM blocked_dates WHERE park_id = $1 AND site_id = $2 AND date = $3 RETURNING *',
    [parkId, siteId, dateStr]
  );
  return res.rowCount > 0;
}

export async function getReservationById(reservationId) {
  const res = await query('SELECT * FROM reservations WHERE id = $1', [reservationId]);
  return res.rows[0] ? mapReservation(res.rows[0]) : null;
}

export async function getReservationsForParkInRange(parkId, startDate, endDate) {
  const startStr = startDate instanceof Date ? startDate.toISOString().split('T')[0] : startDate;
  const endStr = endDate instanceof Date ? endDate.toISOString().split('T')[0] : endDate;

  const res = await query(
    `SELECT * FROM reservations
     WHERE park_id = $1
       AND check_in <= $3
       AND check_out > $2
       AND canceled_at IS NULL
     ORDER BY check_in ASC`,
    [parkId, startStr, endStr]
  );
  return res.rows.map(mapReservation);
}

export async function moveReservation(reservationId, newSiteId, newCheckInDate, newCheckOutDate) {
  const checkInStr = newCheckInDate instanceof Date ? newCheckInDate.toISOString().split('T')[0] : newCheckInDate;
  const checkOutStr = newCheckOutDate instanceof Date ? newCheckOutDate.toISOString().split('T')[0] : newCheckOutDate;

  // Get the reservation to calculate new nights
  const existing = await getReservationById(reservationId);
  if (!existing) throw new Error('Reservation not found');

  const nights = Math.ceil((new Date(checkOutStr) - new Date(checkInStr)) / (1000 * 60 * 60 * 24));

  const res = await query(
    `UPDATE reservations
     SET site_id = $2,
         check_in = $3,
         check_out = $4,
         nights = $5
     WHERE id = $1
     RETURNING *`,
    [reservationId, newSiteId, checkInStr, checkOutStr, nights]
  );

  if (!res.rows[0]) throw new Error('Failed to move reservation');
  return mapReservation(res.rows[0]);
}

export async function cancelReservation(reservationId) {
  const res = await query(
    `UPDATE reservations
     SET status = 'canceled',
         canceled_at = now()
     WHERE id = $1
     RETURNING *`,
    [reservationId]
  );

  if (!res.rows[0]) throw new Error('Reservation not found');
  return mapReservation(res.rows[0]);
}

export async function createReservation({ parkId, siteId, guestName, guestPhone, guestEmail, checkInDate, checkOutDate, source = 'staff', status = 'confirmed', paymentMethod = 'cash' }) {
  const checkInStr = checkInDate instanceof Date ? checkInDate.toISOString().split('T')[0] : checkInDate;
  const checkOutStr = checkOutDate instanceof Date ? checkOutDate.toISOString().split('T')[0] : checkOutDate;

  const nights = Math.ceil((new Date(checkOutStr) - new Date(checkInStr)) / (1000 * 60 * 60 * 24));

  // Get site rate
  const siteRes = await query('SELECT nightly_rate_cents FROM sites WHERE id = $1', [siteId]);
  if (!siteRes.rows[0]) throw new Error('Site not found');
  const nightlyRateCents = siteRes.rows[0].nightly_rate_cents;

  const subtotalCents = nightlyRateCents * nights;
  const feeCents = BOOKING_FEE_CENTS;
  const taxCents = 0; // TODO: Calculate based on park tax rate
  const totalCents = subtotalCents + feeCents + taxCents;

  const id = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const res = await query(
    `INSERT INTO reservations (
       id, park_id, site_id, check_in, check_out, nights,
       guest_name, guest_email, guest_phone,
       subtotal_cents, fee_cents, total_cents,
       tax_cents, deposit_cents, status,
       source, payment_method
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      id, parkId, siteId, checkInStr, checkOutStr, nights,
      guestName, guestEmail || '', guestPhone || '',
      subtotalCents, feeCents, totalCents,
      taxCents, 0, status,
      source, paymentMethod,
    ]
  );

  return mapReservation(res.rows[0]);
}

/* ================================================================ */
/* Campaign Management — Promotional campaigns, A/B testing, ROI     */
/* ================================================================ */

export async function createCampaign(parkId, campaign) {
  const {
    name, type, startDate, endDate, budgetCents, discountAmount, discountType = 'percent', promoCode, description,
  } = campaign;

  if (!name || !type || !startDate || !endDate) {
    throw new Error('Campaign requires name, type, startDate, endDate');
  }

  // Validate date range
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start >= end) {
    throw new Error('startDate must be before endDate');
  }

  // Validate discount (prevent 100%+ discounts)
  if (discountType === 'percent' && discountAmount > 100) {
    throw new Error('Percent discount cannot exceed 100%');
  }

  const id = `camp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const res = await query(
    `INSERT INTO campaigns (
       id, park_id, name, type, status, start_date, end_date,
       budget_cents, discount_amount, discount_type, promo_code, description
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      id, parkId, name, type, 'draft', startDate, endDate,
      budgetCents, discountAmount, discountType, promoCode, description,
    ]
  );

  return mapCampaign(res.rows[0]);
}

export async function getCampaign(campaignId) {
  const res = await query(
    'SELECT * FROM campaigns WHERE id = $1',
    [campaignId]
  );
  return res.rows[0] ? mapCampaign(res.rows[0]) : null;
}

export async function getCampaignsByPark(parkId, status = null, limit = 50, offset = 0) {
  let whereClause = 'park_id = $1';
  const params = [parkId];

  if (status) {
    params.push(status);
    whereClause += ` AND status = $${params.length}`;
  }

  const res = await query(
    `SELECT * FROM campaigns
     WHERE ${whereClause}
     ORDER BY start_date DESC, created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return res.rows.map(mapCampaign);
}

export async function updateCampaign(campaignId, updates) {
  const {
    name, status, startDate, endDate, budgetCents, discountAmount, discountType, promoCode, description,
  } = updates;

  const setClauses = [];
  const values = [campaignId];

  if (name !== undefined) {
    values.push(name);
    setClauses.push(`name = $${values.length}`);
  }
  if (status !== undefined) {
    values.push(status);
    setClauses.push(`status = $${values.length}`);
  }
  if (startDate !== undefined) {
    values.push(startDate);
    setClauses.push(`start_date = $${values.length}`);
  }
  if (endDate !== undefined) {
    values.push(endDate);
    setClauses.push(`end_date = $${values.length}`);
  }
  if (budgetCents !== undefined) {
    values.push(budgetCents);
    setClauses.push(`budget_cents = $${values.length}`);
  }
  if (discountAmount !== undefined) {
    values.push(discountAmount);
    setClauses.push(`discount_amount = $${values.length}`);
  }
  if (discountType !== undefined) {
    values.push(discountType);
    setClauses.push(`discount_type = $${values.length}`);
  }
  if (promoCode !== undefined) {
    values.push(promoCode);
    setClauses.push(`promo_code = $${values.length}`);
  }
  if (description !== undefined) {
    values.push(description);
    setClauses.push(`description = $${values.length}`);
  }

  if (setClauses.length === 0) return getCampaign(campaignId);

  values.push(new Date().toISOString());
  setClauses.push(`updated_at = $${values.length}`);

  const res = await query(
    `UPDATE campaigns
     SET ${setClauses.join(', ')}
     WHERE id = $1
     RETURNING *`,
    values
  );

  return mapCampaign(res.rows[0]);
}

export async function deleteCampaign(campaignId) {
  await query('DELETE FROM campaign_recipients WHERE campaign_id = $1', [campaignId]);
  await query('DELETE FROM campaign_variants WHERE campaign_id = $1', [campaignId]);
  await query('DELETE FROM campaign_performance WHERE campaign_id = $1', [campaignId]);
  const res = await query('DELETE FROM campaigns WHERE id = $1 RETURNING *', [campaignId]);
  return res.rows[0] ? mapCampaign(res.rows[0]) : null;
}

export async function addCampaignRecipient(campaignId, guestEmail, guestPhone = null, guestId = null) {
  if (!guestEmail) {
    throw new Error('Guest email is required');
  }

  const id = `crecip-${campaignId}-${guestEmail}`.replace(/[^a-zA-Z0-9-]/g, '_');

  try {
    const res = await query(
      `INSERT INTO campaign_recipients (id, campaign_id, guest_email, guest_phone, guest_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (campaign_id, guest_email) DO UPDATE SET guest_phone = $4, guest_id = $5
       RETURNING *`,
      [id, campaignId, guestEmail, guestPhone, guestId]
    );
    return mapCampaignRecipient(res.rows[0]);
  } catch (err) {
    throw new Error(`Failed to add recipient: ${err.message}`);
  }
}

export async function getCampaignRecipients(campaignId, limit = 100, offset = 0) {
  const res = await query(
    `SELECT * FROM campaign_recipients
     WHERE campaign_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [campaignId, limit, offset]
  );
  return res.rows.map(mapCampaignRecipient);
}

export async function updateCampaignRecipient(recipientId, updates) {
  const {
    emailSent, emailSentAt, emailOpened, emailClicked, emailClickCount,
    smsSent, smsSentAt, smsDelivered,
    converted, conversionValueCents, conversionDate,
  } = updates;

  const setClauses = [];
  const values = [recipientId];

  if (emailSent !== undefined) {
    values.push(emailSent);
    setClauses.push(`email_sent = $${values.length}`);
  }
  if (emailSentAt !== undefined) {
    values.push(emailSentAt);
    setClauses.push(`email_sent_at = $${values.length}`);
  }
  if (emailOpened !== undefined) {
    values.push(emailOpened);
    setClauses.push(`email_opened = $${values.length}`);
  }
  if (emailClicked !== undefined) {
    values.push(emailClicked);
    setClauses.push(`email_clicked = $${values.length}`);
  }
  if (emailClickCount !== undefined) {
    values.push(emailClickCount);
    setClauses.push(`email_click_count = $${values.length}`);
  }
  if (smsSent !== undefined) {
    values.push(smsSent);
    setClauses.push(`sms_sent = $${values.length}`);
  }
  if (smsSentAt !== undefined) {
    values.push(smsSentAt);
    setClauses.push(`sms_sent_at = $${values.length}`);
  }
  if (smsDelivered !== undefined) {
    values.push(smsDelivered);
    setClauses.push(`sms_delivered = $${values.length}`);
  }
  if (converted !== undefined) {
    values.push(converted);
    setClauses.push(`converted = $${values.length}`);
  }
  if (conversionValueCents !== undefined) {
    values.push(conversionValueCents);
    setClauses.push(`conversion_value_cents = $${values.length}`);
  }
  if (conversionDate !== undefined) {
    values.push(conversionDate);
    setClauses.push(`conversion_date = $${values.length}`);
  }

  if (setClauses.length === 0) {
    const res = await query('SELECT * FROM campaign_recipients WHERE id = $1', [recipientId]);
    return res.rows[0] ? mapCampaignRecipient(res.rows[0]) : null;
  }

  const res = await query(
    `UPDATE campaign_recipients
     SET ${setClauses.join(', ')}
     WHERE id = $1
     RETURNING *`,
    values
  );

  return res.rows[0] ? mapCampaignRecipient(res.rows[0]) : null;
}

export async function getCampaignPerformance(campaignId) {
  const res = await query(
    'SELECT * FROM campaign_performance WHERE campaign_id = $1',
    [campaignId]
  );
  return res.rows[0] ? mapCampaignPerformance(res.rows[0]) : null;
}

export async function updateCampaignPerformance(campaignId, performance) {
  const {
    emailsSent, emailsOpened, emailsClicked, openRatePercent, clickRatePercent,
    conversions, conversionRatePercent, revenueGeneratedCents, costCents, roiPercent,
  } = performance;

  const id = `cperf-${campaignId}`;

  try {
    const res = await query(
      `INSERT INTO campaign_performance (
         id, campaign_id, emails_sent, emails_opened, emails_clicked,
         open_rate_percent, click_rate_percent, conversions, conversion_rate_percent,
         revenue_generated_cents, cost_cents, roi_percent
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (campaign_id) DO UPDATE SET
         emails_sent = $3, emails_opened = $4, emails_clicked = $5,
         open_rate_percent = $6, click_rate_percent = $7, conversions = $8,
         conversion_rate_percent = $9, revenue_generated_cents = $10,
         cost_cents = $11, roi_percent = $12, calculated_at = now()
       RETURNING *`,
      [
        id, campaignId, emailsSent, emailsOpened, emailsClicked,
        openRatePercent, clickRatePercent, conversions, conversionRatePercent,
        revenueGeneratedCents, costCents, roiPercent,
      ]
    );
    return mapCampaignPerformance(res.rows[0]);
  } catch (err) {
    throw new Error(`Failed to update campaign performance: ${err.message}`);
  }
}

export async function createCampaignVariant(campaignId, variant) {
  const {
    variantName, variantType = 'A', subject, body, smsBody, recipientCount = 0,
  } = variant;

  const id = `cvar-${campaignId}-${variantType}`;

  const res = await query(
    `INSERT INTO campaign_variants (
       id, campaign_id, variant_name, variant_type, subject, body, sms_body, recipient_count
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (campaign_id) WHERE campaign_id = $2 AND variant_type = $4
     DO UPDATE SET variant_name = $3, subject = $5, body = $6, sms_body = $7, recipient_count = $8
     RETURNING *`,
    [id, campaignId, variantName, variantType, subject, body, smsBody, recipientCount]
  );

  return mapCampaignVariant(res.rows[0]);
}

export async function getCampaignVariants(campaignId) {
  const res = await query(
    `SELECT * FROM campaign_variants
     WHERE campaign_id = $1
     ORDER BY created_at ASC`,
    [campaignId]
  );
  return res.rows.map(mapCampaignVariant);
}

export async function updateCampaignVariant(variantId, updates) {
  const {
    emailsSent, emailsOpened, emailOpenRatePercent, emailsClicked,
    conversions, revenueCents, isWinner,
  } = updates;

  const setClauses = [];
  const values = [variantId];

  if (emailsSent !== undefined) {
    values.push(emailsSent);
    setClauses.push(`emails_sent = $${values.length}`);
  }
  if (emailsOpened !== undefined) {
    values.push(emailsOpened);
    setClauses.push(`emails_opened = $${values.length}`);
  }
  if (emailOpenRatePercent !== undefined) {
    values.push(emailOpenRatePercent);
    setClauses.push(`email_open_rate_percent = $${values.length}`);
  }
  if (emailsClicked !== undefined) {
    values.push(emailsClicked);
    setClauses.push(`emails_clicked = $${values.length}`);
  }
  if (conversions !== undefined) {
    values.push(conversions);
    setClauses.push(`conversions = $${values.length}`);
  }
  if (revenueCents !== undefined) {
    values.push(revenueCents);
    setClauses.push(`revenue_cents = $${values.length}`);
  }
  if (isWinner !== undefined) {
    values.push(isWinner);
    setClauses.push(`is_winner = $${values.length}`);
  }

  if (setClauses.length === 0) {
    const res = await query('SELECT * FROM campaign_variants WHERE id = $1', [variantId]);
    return res.rows[0] ? mapCampaignVariant(res.rows[0]) : null;
  }

  const res = await query(
    `UPDATE campaign_variants
     SET ${setClauses.join(', ')}
     WHERE id = $1
     RETURNING *`,
    values
  );

  return res.rows[0] ? mapCampaignVariant(res.rows[0]) : null;
}

/* ---------------------------------------------------------------- */
/* CRM Functions — guest profiles, notes, tags, communication log  */
/* ---------------------------------------------------------------- */

function mapGuestProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    guestEmail: row.guest_email,
    parkId: row.park_id,
    lifetimeValueCents: Number(row.lifetime_value_cents) || 0,
    riskScore: Number(row.risk_score) || 0,
    lastContacted: row.last_contacted ? row.last_contacted.toISOString() : null,
    preferences: row.preferences_json ? JSON.parse(row.preferences_json) : {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapGuestNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    guestEmail: row.guest_email,
    parkId: row.park_id,
    noteText: row.note_text,
    createdByStaffId: row.created_by_staff_id,
    createdAt: row.created_at.toISOString(),
  };
}

function mapGuestTag(row) {
  if (!row) return null;
  return {
    id: row.id,
    guestEmail: row.guest_email,
    parkId: row.park_id,
    tagName: row.tag_name,
    createdAt: row.created_at.toISOString(),
  };
}

function mapCommunication(row) {
  if (!row) return null;
  return {
    id: row.id,
    guestEmail: row.guest_email,
    parkId: row.park_id,
    type: row.type,
    subject: row.subject,
    messagePreview: row.message_preview,
    status: row.status,
    timestamp: row.timestamp.toISOString(),
  };
}

export async function getOrCreateGuestProfile(parkId, guestEmail) {
  const normalizedEmail = normalizeEmail(guestEmail);
  let res = await query('SELECT * FROM guest_profiles WHERE guest_email = $1 AND park_id = $2', [normalizedEmail, parkId]);

  if (res.rows.length === 0) {
    const id = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    res = await query(
      `INSERT INTO guest_profiles (id, guest_email, park_id, preferences_json)
       VALUES ($1,$2,$3,'{}') RETURNING *`,
      [id, normalizedEmail, parkId]
    );
  }

  return mapGuestProfile(res.rows[0]);
}

export async function addGuestNote(parkId, guestEmail, noteText, staffId = null) {
  if (!noteText || noteText.trim().length === 0) throw new Error('Note text is required');
  if (noteText.length > 1000) throw new Error('Note must be 1000 characters or less');

  const normalizedEmail = normalizeEmail(guestEmail);
  const profileExists = await query('SELECT 1 FROM guest_profiles WHERE guest_email = $1 AND park_id = $2', [normalizedEmail, parkId]);

  if (!profileExists.rows.length) {
    await getOrCreateGuestProfile(parkId, normalizedEmail);
  }

  const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await query(
    `INSERT INTO guest_notes (id, guest_email, park_id, note_text, created_by_staff_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, normalizedEmail, parkId, noteText.trim(), staffId || null]
  );

  return mapGuestNote(res.rows[0]);
}

export async function tagGuest(parkId, guestEmail, tagName) {
  if (!tagName || tagName.trim().length === 0) throw new Error('Tag name is required');

  const normalizedEmail = normalizeEmail(guestEmail);
  const profileExists = await query('SELECT 1 FROM guest_profiles WHERE guest_email = $1 AND park_id = $2', [normalizedEmail, parkId]);

  if (!profileExists.rows.length) {
    await getOrCreateGuestProfile(parkId, normalizedEmail);
  }

  const cleanTag = tagName.trim();
  const existing = await query(
    'SELECT 1 FROM guest_tags WHERE guest_email = $1 AND park_id = $2 AND tag_name = $3',
    [normalizedEmail, parkId, cleanTag]
  );

  if (existing.rows.length) {
    return null;
  }

  const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await query(
    `INSERT INTO guest_tags (id, guest_email, park_id, tag_name)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, normalizedEmail, parkId, cleanTag]
  );

  return mapGuestTag(res.rows[0]);
}

export async function removeTag(parkId, tagId) {
  const res = await query('DELETE FROM guest_tags WHERE id = $1 AND park_id = $2 RETURNING *', [tagId, parkId]);
  return res.rowCount > 0;
}

export async function updateGuestPreferences(parkId, guestEmail, preferences) {
  const normalizedEmail = normalizeEmail(guestEmail);
  const profile = await getOrCreateGuestProfile(parkId, normalizedEmail);

  const updatedPrefs = { ...profile.preferences, ...preferences };
  const res = await query(
    `UPDATE guest_profiles SET preferences_json = $1, updated_at = now()
     WHERE guest_email = $2 AND park_id = $3 RETURNING *`,
    [JSON.stringify(updatedPrefs), normalizedEmail, parkId]
  );

  return mapGuestProfile(res.rows[0]);
}

export async function logCommunication(parkId, guestEmail, { type, subject, messagePreview, status = 'sent' }) {
  const normalizedEmail = normalizeEmail(guestEmail);
  const profileExists = await query('SELECT 1 FROM guest_profiles WHERE guest_email = $1 AND park_id = $2', [normalizedEmail, parkId]);

  if (!profileExists.rows.length) {
    await getOrCreateGuestProfile(parkId, normalizedEmail);
  }

  const id = `comm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await query(
    `INSERT INTO communication_log (id, guest_email, park_id, type, subject, message_preview, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, normalizedEmail, parkId, type, subject || null, messagePreview || null, status]
  );

  return mapCommunication(res.rows[0]);
}

export async function getGuestHistory(parkId, guestEmail) {
  const normalizedEmail = normalizeEmail(guestEmail);

  const profileRes = await query(
    'SELECT * FROM guest_profiles WHERE guest_email = $1 AND park_id = $2',
    [normalizedEmail, parkId]
  );

  const notesRes = await query(
    'SELECT * FROM guest_notes WHERE guest_email = $1 AND park_id = $2 ORDER BY created_at DESC',
    [normalizedEmail, parkId]
  );

  const tagsRes = await query(
    'SELECT * FROM guest_tags WHERE guest_email = $1 AND park_id = $2 ORDER BY created_at DESC',
    [normalizedEmail, parkId]
  );

  const commRes = await query(
    'SELECT * FROM communication_log WHERE guest_email = $1 AND park_id = $2 ORDER BY timestamp DESC LIMIT 20',
    [normalizedEmail, parkId]
  );

  const reservationsRes = await query(
    'SELECT * FROM reservations WHERE guest_email = $1 AND park_id = $2 ORDER BY created_at DESC LIMIT 10',
    [normalizedEmail, parkId]
  );

  return {
    profile: profileRes.rows.length ? mapGuestProfile(profileRes.rows[0]) : null,
    notes: notesRes.rows.map(mapGuestNote),
    tags: tagsRes.rows.map(mapGuestTag),
    communications: commRes.rows.map(mapCommunication),
    reservations: reservationsRes.rows.map(mapReservation),
  };
}

export async function getGuestsForPark(parkId, limit = 50, offset = 0) {
  const countRes = await query('SELECT COUNT(*) as count FROM guest_profiles WHERE park_id = $1', [parkId]);
  const totalCount = Number(countRes.rows[0]?.count || 0);

  const res = await query(
    `SELECT * FROM guest_profiles WHERE park_id = $1
     ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
    [parkId, limit, offset]
  );

  const profiles = res.rows.map(mapGuestProfile);

  const guestsWithData = await Promise.all(profiles.map(async (profile) => {
    const tagsRes = await query(
      'SELECT * FROM guest_tags WHERE guest_email = $1 AND park_id = $2',
      [profile.guestEmail, parkId]
    );

    const bookingsRes = await query(
      'SELECT COUNT(*) as count FROM reservations WHERE guest_email = $1 AND park_id = $2 AND status IN ($3, $4)',
      [profile.guestEmail, parkId, 'confirmed', 'confirmed-deposit']
    );

    return {
      ...profile,
      tags: tagsRes.rows.map(mapGuestTag),
      bookingCount: Number(bookingsRes.rows[0]?.count || 0),
    };
  }));

  return { guests: guestsWithData, total: totalCount };
}

export async function identifyAtRiskGuests(parkId, limit = 10) {
  const res = await query(
    `SELECT * FROM guest_profiles
     WHERE park_id = $1 AND risk_score > 50
     ORDER BY risk_score DESC LIMIT $2`,
    [parkId, limit]
  );

  return res.rows.map(mapGuestProfile);
}

export async function getGuestSegments(parkId) {
  const loyalRes = await query(
    `SELECT COUNT(DISTINCT guest_email) as count, AVG(lifetime_value_cents) as avg_ltv
     FROM guest_profiles
     WHERE park_id = $1 AND risk_score < 30`,
    [parkId]
  );

  const occasionalRes = await query(
    `SELECT COUNT(DISTINCT guest_email) as count, AVG(lifetime_value_cents) as avg_ltv
     FROM guest_profiles
     WHERE park_id = $1 AND risk_score BETWEEN 30 AND 60`,
    [parkId]
  );

  const atRiskRes = await query(
    `SELECT COUNT(DISTINCT guest_email) as count, AVG(lifetime_value_cents) as avg_ltv
     FROM guest_profiles
     WHERE park_id = $1 AND risk_score > 60`,
    [parkId]
  );

  const inactiveRes = await query(
    `SELECT COUNT(DISTINCT guest_email) as count, AVG(lifetime_value_cents) as avg_ltv
     FROM guest_profiles
     WHERE park_id = $1 AND (last_contacted IS NULL OR last_contacted < now() - interval '90 days')`,
    [parkId]
  );

  return {
    loyal: { count: Number(loyalRes.rows[0]?.count || 0), avgLifetimeValue: Number(loyalRes.rows[0]?.avg_ltv || 0) },
    occasional: { count: Number(occasionalRes.rows[0]?.count || 0), avgLifetimeValue: Number(occasionalRes.rows[0]?.avg_ltv || 0) },
    atRisk: { count: Number(atRiskRes.rows[0]?.count || 0), avgLifetimeValue: Number(atRiskRes.rows[0]?.avg_ltv || 0) },
    inactive: { count: Number(inactiveRes.rows[0]?.count || 0), avgLifetimeValue: Number(inactiveRes.rows[0]?.avg_ltv || 0) },
  };
}

/* ================================================================ */
/* Competitive Intelligence — competitor tracking and market analysis */
/* ================================================================ */

function mapCompetitor(row) {
  if (!row) return null;
  return {
    id: row.id,
    parkId: row.park_id,
    name: row.name,
    websiteUrl: row.website_url,
    location: row.location,
    address: row.address,
    googleMapsUrl: row.google_maps_url,
    placeId: row.place_id,
    lat: row.lat !== null && row.lat !== undefined ? Number(row.lat) : null,
    lng: row.lng !== null && row.lng !== undefined ? Number(row.lng) : null,
    scrapeEnabled: row.scrape_enabled,
    lastScraped: row.last_scraped ? row.last_scraped.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapCompetitorPricing(row) {
  if (!row) return null;
  return {
    id: row.id,
    competitorId: row.competitor_id,
    date: row.date,
    avgRateCents: row.avg_rate_cents ? Number(row.avg_rate_cents) : null,
    lowRateCents: row.low_rate_cents ? Number(row.low_rate_cents) : null,
    highRateCents: row.high_rate_cents ? Number(row.high_rate_cents) : null,
    occupancySignal: row.occupancy_signal ? Number(row.occupancy_signal) : null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapMarketAnalytics(row) {
  if (!row) return null;
  return {
    id: row.id,
    parkId: row.park_id,
    date: row.date,
    marketAvgRateCents: row.market_avg_rate_cents ? Number(row.market_avg_rate_cents) : null,
    marketMedianCents: row.market_median_cents ? Number(row.market_median_cents) : null,
    pricePercentile: row.price_percentile ? Number(row.price_percentile) : null,
    competitorCount: row.competitor_count || 0,
    createdAt: row.created_at.toISOString(),
  };
}

function mapPricingSuggestion(row) {
  if (!row) return null;
  return {
    id: row.id,
    parkId: row.park_id,
    siteId: row.site_id,
    suggestedRateCents: row.suggested_rate_cents ? Number(row.suggested_rate_cents) : null,
    confidenceScore: row.confidence_score ? Number(row.confidence_score) : null,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
}

export async function addCompetitor(parkId, { name, websiteUrl, location, address, googleMapsUrl, placeId, lat, lng }) {
  if (!name) throw new Error('Competitor name is required');
  const parkExists = await query('SELECT 1 FROM parks WHERE id = $1', [parkId]);
  if (!parkExists.rows.length) throw new Error('Unknown park');

  const id = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await query(
    `INSERT INTO competitors (id, park_id, name, website_url, location, address, google_maps_url, place_id, lat, lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [id, parkId, name, websiteUrl || null, location || null, address || null, googleMapsUrl || null, placeId || null, lat ?? null, lng ?? null]
  );
  return mapCompetitor(res.rows[0]);
}

export async function getCompetitorsForPark(parkId) {
  const res = await query('SELECT * FROM competitors WHERE park_id = $1 ORDER BY created_at DESC', [parkId]);
  return res.rows.map(mapCompetitor);
}

export async function removeCompetitor(competitorId, parkId) {
  const res = await query('DELETE FROM competitors WHERE id = $1 AND park_id = $2', [competitorId, parkId]);
  if (res.rowCount === 0) throw new Error('Unknown competitor');
}

export async function recordCompetitorPricing(competitorId, { date, avgRateCents, lowRateCents, highRateCents, occupancySignal }) {
  const id = `cprice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await query(
    `INSERT INTO competitor_pricing (id, competitor_id, date, avg_rate_cents, low_rate_cents, high_rate_cents, occupancy_signal)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, competitorId, date, avgRateCents || null, lowRateCents || null, highRateCents || null, occupancySignal || null]
  );
  return mapCompetitorPricing(res.rows[0]);
}

export async function getCompetitorPricingHistory(competitorId, days = 90) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const res = await query(
    `SELECT * FROM competitor_pricing WHERE competitor_id = $1 AND date >= $2 ORDER BY date DESC`,
    [competitorId, startDate.toISOString().split('T')[0]]
  );
  return res.rows.map(mapCompetitorPricing);
}

export async function recordMarketAnalytics(parkId, { date, marketAvgRateCents, marketMedianCents, pricePercentile, competitorCount }) {
  const id = `mkt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await query(
      `INSERT INTO market_analytics (id, park_id, date, market_avg_rate_cents, market_median_cents, price_percentile, competitor_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, parkId, date, marketAvgRateCents || null, marketMedianCents || null, pricePercentile || null, competitorCount || 0]
    );
    return mapMarketAnalytics(res.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      const updateRes = await query(
        `UPDATE market_analytics SET market_avg_rate_cents = $3, market_median_cents = $4, price_percentile = $5, competitor_count = $6
         WHERE park_id = $1 AND date = $2 RETURNING *`,
        [parkId, date, marketAvgRateCents || null, marketMedianCents || null, pricePercentile || null, competitorCount || 0]
      );
      return mapMarketAnalytics(updateRes.rows[0]);
    }
    throw err;
  }
}

export async function getMarketAnalytics(parkId, days = 90) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const res = await query(
    `SELECT * FROM market_analytics WHERE park_id = $1 AND date >= $2 ORDER BY date DESC`,
    [parkId, startDate.toISOString().split('T')[0]]
  );
  return res.rows.map(mapMarketAnalytics);
}

export async function createPricingSuggestion(parkId, siteId, { suggestedRateCents, confidenceScore, reason }) {
  if (!suggestedRateCents) throw new Error('Suggested rate is required');
  const siteExists = await query('SELECT 1 FROM sites WHERE id = $1 AND park_id = $2', [siteId, parkId]);
  if (!siteExists.rows.length) throw new Error('Unknown site');

  const id = `sug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await query(
    `INSERT INTO pricing_suggestions (id, park_id, site_id, suggested_rate_cents, confidence_score, reason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, parkId, siteId, suggestedRateCents, confidenceScore || 0.5, reason || '']
  );
  return mapPricingSuggestion(res.rows[0]);
}

export async function getPricingSuggestionsForSite(siteId, parkId) {
  const res = await query(
    `SELECT * FROM pricing_suggestions WHERE site_id = $1 AND park_id = $2 ORDER BY created_at DESC`,
    [siteId, parkId]
  );
  return res.rows.map(mapPricingSuggestion);
}

export async function getPricingSuggestionsForPark(parkId) {
  const res = await query(
    `SELECT * FROM pricing_suggestions WHERE park_id = $1 ORDER BY confidence_score DESC, created_at DESC`,
    [parkId]
  );
  return res.rows.map(mapPricingSuggestion);
}

/* ========== Booking Rules Engine ========== */

export async function getBookingRules(parkId, siteId = null) {
  let query_text = 'SELECT * FROM booking_rules WHERE park_id = $1';
  let params = [parkId];
  
  if (siteId) {
    query_text += ' AND (site_id = $2 OR site_id IS NULL)';
    params.push(siteId);
  }
  
  query_text += ' ORDER BY priority DESC, created_at ASC';
  const res = await query(query_text, params);
  return res.rows.map(mapBookingRule);
}

export async function getBookingRulesBySite(siteId) {
  const res = await query(
    'SELECT * FROM booking_rules WHERE site_id = $1 ORDER BY priority DESC',
    [siteId]
  );
  return res.rows.map(mapBookingRule);
}

export async function createBookingRule(rule) {
  const res = await query(
    `INSERT INTO booking_rules (id, park_id, site_id, rule_type, rule_config_json, is_active, priority, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [rule.id, rule.park_id, rule.site_id || null, rule.rule_type, rule.rule_config_json, rule.is_active, rule.priority, rule.created_at]
  );
  return mapBookingRule(res.rows[0]);
}

export async function updateBookingRule(ruleId, updates) {
  const sets = [];
  const params = [];
  let paramIndex = 1;

  if (updates.is_active !== undefined) {
    sets.push(`is_active = $${paramIndex}`);
    params.push(updates.is_active);
    paramIndex++;
  }
  if (updates.rule_config_json !== undefined) {
    sets.push(`rule_config_json = $${paramIndex}`);
    params.push(updates.rule_config_json);
    paramIndex++;
  }
  if (updates.priority !== undefined) {
    sets.push(`priority = $${paramIndex}`);
    params.push(updates.priority);
    paramIndex++;
  }

  if (!sets.length) return null;

  params.push(ruleId);
  const res = await query(
    `UPDATE booking_rules SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
  return mapBookingRule(res.rows[0]);
}

export async function deleteBookingRule(ruleId) {
  await query('DELETE FROM booking_rules WHERE id = $1', [ruleId]);
}

export async function getBlackoutDates(parkId, siteId = null) {
  let query_text = 'SELECT * FROM blackout_dates WHERE park_id = $1';
  const params = [parkId];
  
  if (siteId) {
    query_text += ' AND site_id = $2';
    params.push(siteId);
  }
  
  query_text += ' ORDER BY start_date ASC';
  const res = await query(query_text, params);
  return res.rows.map(mapBlackoutDate);
}

export async function getBlackoutDatesByDateRange(siteId, startDate, endDate) {
  const res = await query(
    `SELECT * FROM blackout_dates WHERE site_id = $1 AND start_date <= $2 AND end_date >= $3 ORDER BY start_date ASC`,
    [siteId, endDate, startDate]
  );
  return res.rows.map(mapBlackoutDate);
}

export async function createBlackoutDate(blackout) {
  const res = await query(
    `INSERT INTO blackout_dates (id, park_id, site_id, start_date, end_date, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [blackout.id, blackout.park_id, blackout.site_id, blackout.start_date, blackout.end_date, blackout.reason, blackout.created_at]
  );
  return mapBlackoutDate(res.rows[0]);
}

export async function deleteBlackoutDate(blackoutId) {
  await query('DELETE FROM blackout_dates WHERE id = $1', [blackoutId]);
}

function mapBookingRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    park_id: row.park_id,
    site_id: row.site_id,
    rule_type: row.rule_type,
    rule_config_json: row.rule_config_json,
    is_active: row.is_active,
    priority: row.priority,
    created_at: row.created_at.toISOString(),
  };
}

function mapBlackoutDate(row) {
  if (!row) return null;
  return {
    id: row.id,
    park_id: row.park_id,
    site_id: row.site_id,
    start_date: row.start_date,
    end_date: row.end_date,
    reason: row.reason,
    created_at: row.created_at.toISOString(),
  };
}

export async function getReservationsBySiteInRange(siteId, startDate, endDate) {
  const startStr = startDate instanceof Date ? startDate.toISOString().split('T')[0] : startDate;
  const endStr = endDate instanceof Date ? endDate.toISOString().split('T')[0] : endDate;

  const res = await query(
    `SELECT * FROM reservations
     WHERE site_id = $1
       AND check_in <= $3
       AND check_out > $2
       AND canceled_at IS NULL
     ORDER BY check_in ASC`,
    [siteId, startStr, endStr]
  );
  return res.rows.map(mapReservation);
}

/* ================================================================ */
/* Phase 4: Multi-Property Management Functions                   */
/* ================================================================ */

export async function setParksOwner(parkIds, ownerId) {
  if (!parkIds || parkIds.length === 0) return;
  const placeholders = parkIds.map((_, i) => `$${i + 1}`).join(',');
  const params = [...parkIds, ownerId];
  await query(
    `UPDATE parks SET owner_id = $${parkIds.length + 1} WHERE id IN (${placeholders})`,
    params
  );
}

export async function getPropertiesForUser(userId) {
  const res = await query(
    `SELECT p.*, COALESCE(up.permission_level, 'manager') as permission_level
     FROM parks p
     LEFT JOIN user_permissions up ON p.id = up.park_id AND up.user_id = $1
     WHERE p.owner_id = $1 OR up.user_id = $1
     ORDER BY p.name ASC`,
    [userId]
  );
  return res.rows.map(row => {
    const park = mapPark(row);
    return { ...park, permissionLevel: row.permission_level };
  });
}

export async function getUserRole(userId, parkId) {
  const res = await query(
    `SELECT permission_level FROM user_permissions WHERE user_id = $1 AND park_id = $2`,
    [userId, parkId]
  );
  if (res.rows[0]) return res.rows[0].permission_level;

  // Check if user is owner
  const parkRes = await query('SELECT owner_id FROM parks WHERE id = $1', [parkId]);
  if (parkRes.rows[0]?.owner_id === userId) return 'admin';

  return null; // user has no access
}

export async function updatePropertyBranding(parkId, branding) {
  const brandingJson = typeof branding === 'string' ? branding : JSON.stringify(branding);
  await query(
    `UPDATE parks SET branding_json = $1, display_name = COALESCE(display_name, name) WHERE id = $2`,
    [brandingJson, parkId]
  );
}

export async function getPropertyBranding(parkId) {
  const res = await query('SELECT branding_json FROM parks WHERE id = $1', [parkId]);
  if (!res.rows[0]) return null;
  try {
    return JSON.parse(res.rows[0].branding_json || '{}');
  } catch {
    return {};
  }
}

export async function createPropertyGroup(ownerId, name, description, groupType = 'brand') {
  const id = `group_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await query(
    `INSERT INTO property_groups (id, owner_id, name, description, group_type)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, ownerId, name, description, groupType]
  );
  return id;
}

export async function addPropertyToGroup(groupId, parkId) {
  const id = `pgm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await query(
    `INSERT INTO property_group_members (id, group_id, park_id)
     VALUES ($1, $2, $3)`,
    [id, groupId, parkId]
  );
}

export async function removePropertyFromGroup(groupId, parkId) {
  await query(
    `DELETE FROM property_group_members WHERE group_id = $1 AND park_id = $2`,
    [groupId, parkId]
  );
}

export async function getPropertyGroupsForUser(userId) {
  const res = await query(
    `SELECT * FROM property_groups WHERE owner_id = $1 ORDER BY name ASC`,
    [userId]
  );
  return res.rows.map(row => ({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    groupType: row.group_type,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function getPropertiesInGroup(groupId) {
  const res = await query(
    `SELECT p.* FROM parks p
     JOIN property_group_members pgm ON p.id = pgm.park_id
     WHERE pgm.group_id = $1
     ORDER BY p.name ASC`,
    [groupId]
  );
  return res.rows.map(mapPark);
}

export async function createBulkOperation(ownerId, operationType, propertyIds, operationData) {
  const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const dataJson = typeof operationData === 'string' ? operationData : JSON.stringify(operationData);
  await query(
    `INSERT INTO bulk_operations (id, owner_id, operation_type, properties_count, operation_data)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, ownerId, operationType, propertyIds.length, dataJson]
  );
  return id;
}

export async function getBulkOperation(operationId) {
  const res = await query('SELECT * FROM bulk_operations WHERE id = $1', [operationId]);
  if (!res.rows[0]) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    ownerId: row.owner_id,
    operationType: row.operation_type,
    status: row.status,
    propertiesCount: row.properties_count,
    completedCount: row.completed_count,
    failedCount: row.failed_count,
    operationData: JSON.parse(row.operation_data || '{}'),
    errorLog: row.error_log,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function completeBulkOperation(operationId, completedCount, failedCount) {
  await query(
    `UPDATE bulk_operations SET status = 'completed', completed_count = $1, failed_count = $2, completed_at = now() WHERE id = $3`,
    [completedCount, failedCount, operationId]
  );
}

export async function failBulkOperation(operationId, errorLog) {
  await query(
    `UPDATE bulk_operations SET status = 'failed', error_log = $1, completed_at = now() WHERE id = $2`,
    [errorLog, operationId]
  );
}

export async function logOperationAudit(operationId, parkId, action, result, details = null) {
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await query(
    `INSERT INTO operation_audit_log (id, operation_id, park_id, action, result, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, operationId, parkId, action, result, details]
  );
}

/* ================================================================ */
/* Occupancy Forecasting                                             */
/* ================================================================ */

export async function saveOccupancyForecast(parkId, forecastData) {
  const forecasts = Array.isArray(forecastData) ? forecastData : [forecastData];

  for (const day of forecasts) {
    await query(
      `INSERT INTO occupancy_forecasts (id, park_id, forecast_date, forecast_occupancy, confidence_lower, confidence_upper, confidence_margin, season, trend, components_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (park_id, forecast_date) DO UPDATE SET
       forecast_occupancy = EXCLUDED.forecast_occupancy,
       confidence_lower = EXCLUDED.confidence_lower,
       confidence_upper = EXCLUDED.confidence_upper,
       confidence_margin = EXCLUDED.confidence_margin,
       season = EXCLUDED.season,
       trend = EXCLUDED.trend,
       components_json = EXCLUDED.components_json,
       created_at = now()`,
      [
        `forecast_${parkId}_${day.date}`,
        parkId,
        day.date,
        day.forecastOccupancy,
        day.confidenceLower,
        day.confidenceUpper,
        day.confidenceMargin,
        day.season || 'unknown',
        day.trend || 'stable',
        JSON.stringify(day.components || {})
      ]
    );
  }
}

export async function getOccupancyForecastCache(parkId) {
  const res = await query(
    `SELECT forecast_date, forecast_occupancy, confidence_lower, confidence_upper,
            confidence_margin, season, trend, components_json, created_at
     FROM occupancy_forecasts
     WHERE park_id = $1
     ORDER BY forecast_date ASC
     LIMIT 90`,
    [parkId]
  );

  if (res.rows.length === 0) return null;

  const forecastData = res.rows.map(row => ({
    date: row.forecast_date,
    forecastOccupancy: Number(row.forecast_occupancy),
    confidenceLower: Number(row.confidence_lower),
    confidenceUpper: Number(row.confidence_upper),
    confidenceMargin: Number(row.confidence_margin),
    season: row.season,
    trend: row.trend,
    components: JSON.parse(row.components_json || '{}')
  }));

  return {
    parkId,
    forecastData,
    createdAt: res.rows[0].created_at.toISOString()
  };
}

export async function saveSeasonalAnalysis(parkId, calendarData) {
  for (const month of calendarData) {
    await query(
      `INSERT INTO seasonal_analysis (id, park_id, month, month_name, average_occupancy, season, calendar_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (park_id, month) DO UPDATE SET
       average_occupancy = EXCLUDED.average_occupancy,
       season = EXCLUDED.season,
       calendar_json = EXCLUDED.calendar_json,
       updated_at = now()`,
      [
        `seasonal_${parkId}_${month.month}`,
        parkId,
        month.month,
        month.monthName,
        month.averageOccupancy,
        month.season,
        JSON.stringify(month.days || [])
      ]
    );
  }
}

export async function getSeasonalAnalysis(parkId) {
  const res = await query(
    `SELECT month, month_name, average_occupancy, season, calendar_json, updated_at
     FROM seasonal_analysis
     WHERE park_id = $1
     ORDER BY month ASC`,
    [parkId]
  );

  if (res.rows.length === 0) return null;

  const calendar = res.rows.map(row => ({
    month: row.month,
    monthName: row.month_name,
    averageOccupancy: Number(row.average_occupancy),
    season: row.season,
    days: JSON.parse(row.calendar_json || '[]')
  }));

  return {
    parkId,
    calendar,
    updatedAt: res.rows[0].updated_at.toISOString()
  };
}

export async function saveBookingPaceMetric(siteId, parkId, date, daysAheadBooked, paceIndex) {
  const id = `pace_${siteId}_${date}`;
  await query(
    `INSERT INTO booking_pace_metrics (id, site_id, park_id, metric_date, days_ahead_booked, pace_index)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (site_id, metric_date) DO UPDATE SET
     days_ahead_booked = EXCLUDED.days_ahead_booked,
     pace_index = EXCLUDED.pace_index`,
    [id, siteId, parkId, date, daysAheadBooked, paceIndex]
  );
}
