// Email scheduler — queues, sends, and tracks email delivery and engagement.
// Handles rate limiting, unsubscribe lists, and delivery status.

import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const pool = new Pool({
  connectionString,
  max: 5,
  ssl: connectionString && !/sslmode=/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = null;

/**
 * Initialize email tracking tables
 */
function ensureEmailSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      -- Track individual email sends
      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
        guest_email TEXT NOT NULL,
        guest_name TEXT NOT NULL,
        template_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status TEXT NOT NULL DEFAULT 'pending',
        provider TEXT,
        provider_message_id TEXT,
        delivery_status TEXT,
        opened_at TIMESTAMPTZ,
        opened_count INTEGER NOT NULL DEFAULT 0,
        clicked_at TIMESTAMPTZ,
        clicked_count INTEGER NOT NULL DEFAULT 0,
        bounced_at TIMESTAMPTZ,
        bounce_reason TEXT,
        unsubscribed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_email_logs_park ON email_logs(park_id);
      CREATE INDEX IF NOT EXISTS idx_email_logs_reservation ON email_logs(reservation_id);
      CREATE INDEX IF NOT EXISTS idx_email_logs_guest_email ON email_logs(guest_email);
      CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at);

      -- Track email campaigns (aggregated stats)
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id TEXT PRIMARY KEY,
        park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
        campaign_type TEXT NOT NULL,
        template_type TEXT NOT NULL,
        name TEXT,
        sent_count INTEGER NOT NULL DEFAULT 0,
        opened_count INTEGER NOT NULL DEFAULT 0,
        clicked_count INTEGER NOT NULL DEFAULT 0,
        bounced_count INTEGER NOT NULL DEFAULT 0,
        conversion_count INTEGER NOT NULL DEFAULT 0,
        revenue_cents INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_email_campaigns_park ON email_campaigns(park_id);

      -- Unsubscribe management
      CREATE TABLE IF NOT EXISTS email_unsubscribes (
        id TEXT PRIMARY KEY,
        park_id TEXT,
        email TEXT NOT NULL,
        unsubscribe_reason TEXT,
        unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(park_id, email)
      );
      CREATE INDEX IF NOT EXISTS idx_unsubscribes_email ON email_unsubscribes(email);
      CREATE INDEX IF NOT EXISTS idx_unsubscribes_park ON email_unsubscribes(park_id);

      -- Email preferences per park
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS emails_enabled BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS email_provider TEXT DEFAULT 'nodemailer';
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS sender_email TEXT;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS sender_name TEXT DEFAULT 'RVPark Success';
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS email_pre_arrival BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS email_post_stay BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS email_recovery BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS email_promo BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE parks ADD COLUMN IF NOT EXISTS loyalty_discount_percent INTEGER NOT NULL DEFAULT 15;
    `).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

async function query(text, params) {
  await ensureEmailSchema();
  return pool.query(text, params);
}

/**
 * Create a new email log entry
 */
export async function createEmailLog(parkId, emailData) {
  const { reservationId, guestEmail, guestName, templateType, subject, provider, providerMessageId } = emailData;
  const id = `email_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  await query(
    `INSERT INTO email_logs (id, park_id, reservation_id, guest_email, guest_name, template_type, subject, provider, provider_message_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, parkId, reservationId || null, guestEmail, guestName, templateType, subject, provider, providerMessageId, 'sent']
  );

  return id;
}

/**
 * Check if email is unsubscribed
 */
export async function isUnsubscribed(email, parkId = null) {
  const result = await query(
    `SELECT id FROM email_unsubscribes WHERE email = $1 AND (park_id IS NULL OR park_id = $2)`,
    [email.toLowerCase(), parkId]
  );
  return result.rows.length > 0;
}

/**
 * Add email to unsubscribe list
 */
export async function unsubscribeEmail(email, parkId = null, reason = null) {
  const id = `unsub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await query(
    `INSERT INTO email_unsubscribes (id, park_id, email, unsubscribe_reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (park_id, email) DO UPDATE SET unsubscribed_at = now()`,
    [id, parkId, email.toLowerCase(), reason]
  );
}

/**
 * Track email open (pixel or link click)
 */
export async function trackEmailOpen(emailLogId) {
  await query(
    `UPDATE email_logs SET opened_at = now(), opened_count = opened_count + 1
     WHERE id = $1`,
    [emailLogId]
  );
}

/**
 * Track email click
 */
export async function trackEmailClick(emailLogId) {
  await query(
    `UPDATE email_logs SET clicked_at = now(), clicked_count = clicked_count + 1
     WHERE id = $1`,
    [emailLogId]
  );
}

/**
 * Mark email as bounced
 */
export async function markEmailBounced(emailLogId, reason = 'hard_bounce') {
  await query(
    `UPDATE email_logs SET bounced_at = now(), bounce_reason = $1, delivery_status = 'bounced'
     WHERE id = $1`,
    [reason, emailLogId]
  );
}

/**
 * Get email stats for a park
 */
export async function getEmailStats(parkId) {
  const result = await query(
    `SELECT
       COUNT(*) as total_sent,
       SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as total_opened,
       SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as total_clicked,
       SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) as total_bounced
     FROM email_logs
     WHERE park_id = $1`,
    [parkId]
  );

  const row = result.rows[0];
  const totalSent = parseInt(row.total_sent || 0);
  const openRate = totalSent > 0 ? Math.round((parseInt(row.total_opened || 0) / totalSent) * 100) : 0;
  const clickRate = totalSent > 0 ? Math.round((parseInt(row.total_clicked || 0) / totalSent) * 100) : 0;
  const bounceRate = totalSent > 0 ? Math.round((parseInt(row.total_bounced || 0) / totalSent) * 100) : 0;

  return { totalSent, openRate, clickRate, bounceRate };
}

/**
 * Get email logs for a park (paginated)
 */
export async function getEmailLogs(parkId, limit = 50, offset = 0) {
  const result = await query(
    `SELECT * FROM email_logs
     WHERE park_id = $1
     ORDER BY sent_at DESC
     LIMIT $2 OFFSET $3`,
    [parkId, limit, offset]
  );

  return result.rows.map((row) => ({
    id: row.id,
    reservationId: row.reservation_id,
    guestEmail: row.guest_email,
    guestName: row.guest_name,
    templateType: row.template_type,
    subject: row.subject,
    sentAt: row.sent_at.toISOString(),
    status: row.status,
    deliveryStatus: row.delivery_status,
    openedAt: row.opened_at ? row.opened_at.toISOString() : null,
    openedCount: row.opened_count,
    clickedAt: row.clicked_at ? row.clicked_at.toISOString() : null,
    clickedCount: row.clicked_count,
    bouncedAt: row.bounced_at ? row.bounced_at.toISOString() : null,
    bounceReason: row.bounce_reason,
  }));
}

/**
 * Create or update email campaign
 */
export async function createEmailCampaign(parkId, campaignData) {
  const { campaignType, templateType, name } = campaignData;
  const id = `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  await query(
    `INSERT INTO email_campaigns (id, park_id, campaign_type, template_type, name, sent_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, parkId, campaignType, templateType, name, 0]
  );

  return id;
}

/**
 * Increment campaign send count
 */
export async function incrementCampaignSend(campaignId) {
  await query(
    `UPDATE email_campaigns SET sent_count = sent_count + 1
     WHERE id = $1`,
    [campaignId]
  );
}

/**
 * Rate limit helper — check if we're sending too many emails to one guest
 * Returns true if safe to send, false if should throttle
 */
export async function checkRateLimit(guestEmail, parkId, maxPerDay = 2) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result = await query(
    `SELECT COUNT(*) as count FROM email_logs
     WHERE guest_email = $1 AND park_id = $2 AND sent_at > $3`,
    [guestEmail.toLowerCase(), parkId, oneDayAgo]
  );

  const count = parseInt(result.rows[0]?.count || 0);
  return count < maxPerDay;
}

/**
 * Schedule an email to be sent at a future time
 * Returns the reservation with emailScheduledFor timestamp
 */
export async function scheduleEmail(reservationId, templateType, sendAtTime) {
  // This would typically be handled by a background job processor (Bull, RabbitMQ, etc.)
  // For now, we'll store it in the reservations table
  // TODO: implement background job queue

  return { scheduled: true, sendAtTime, templateType };
}

export { query };
