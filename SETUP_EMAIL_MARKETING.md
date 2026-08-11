# Email Marketing Automation System Setup Guide

This guide covers the complete setup of the email marketing automation system for the RVPark Success platform.

## Overview

The system includes:
- **Email Templates** — Pre-arrival, post-stay, abandoned booking recovery, seasonal promotions
- **Automation Rules** — Automatic sends based on reservation status and timing
- **Email Providers** — Support for SendGrid, Mailgun, or SMTP (Nodemailer)
- **Tracking & Analytics** — Open rates, click rates, bounce rates, conversion tracking
- **Dashboard UI** — Park owners manage emails, view metrics, send campaigns
- **Unsubscribe Management** — GDPR/CAN-SPAM compliant unsubscribe handling

## Architecture

### Files Created

**Backend (api/)**
- `api/_lib/email-templates.js` — Template rendering with {{variable}} interpolation
- `api/_lib/email-scheduler.js` — Email queueing, tracking, metrics
- `api/_lib/email-automation.js` — Automation rules engine for auto-sends
- `api/_lib/email-provider.js` — Multi-provider abstraction (SendGrid/Mailgun/SMTP)
- `api/admin/email.js` — Staff dashboard API endpoint
- `api/email-unsubscribe.js` — Public unsubscribe endpoint
- `api/email-tracking.js` — Open/click tracking endpoints

**Frontend (src/)**
- `src/js/email-dashboard.js` — Email marketing dashboard UI
- `src/css/email-dashboard.css` — Styling (optional)

**Database Tables** (auto-created on first use)
- `email_logs` — Individual email send records
- `email_campaigns` — Aggregate campaign statistics
- `email_unsubscribes` — Unsubscribe list management
- New columns on `parks` table for email configuration

## Installation & Configuration

### 1. Environment Variables

Add to your `.env.local` or Vercel deployment settings:

```bash
# Email Provider Selection (at least one required)

# SendGrid (recommended for ease of use)
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxx

# Mailgun
MAILGUN_API_KEY=key-xxxxxxxxxxxxxxxxxxxxxxx
MAILGUN_DOMAIN=mail.example.com

# SMTP / Nodemailer
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=bookings@rvparksuccess.com

# Email Tracking & Security
UNSUBSCRIBE_TOKEN_SECRET=your-secret-key-here
TEST_EMAIL=admin@example.com
```

### 2. Database Setup

The system automatically creates required tables on first use:
- Runs `ensureEmailSchema()` from `email-scheduler.js`
- Adds `emails_enabled`, `email_provider`, `sender_email`, `sender_name` columns to `parks` table
- Adds `email_pre_arrival`, `email_post_stay`, `email_recovery`, `email_promo` boolean flags
- Adds `loyalty_discount_percent` configuration

No manual migrations needed — happens automatically.

### 3. Enable Email Provider

**Option A: SendGrid** (Recommended)
1. Sign up at https://sendgrid.com
2. Create API key in Settings → API Keys
3. Copy API key to `SENDGRID_API_KEY` env var
4. Verify sender email in "Sender Authentication"

**Option B: Mailgun**
1. Sign up at https://mailgun.com
2. Get API key from Account Settings
3. Add domain to Mailgun
4. Set `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` env vars

**Option C: SMTP** (Gmail, Office 365, etc.)
1. Get SMTP credentials from your email provider
2. For Gmail: use App Passwords (2FA required)
3. Set `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`

### 4. Add Email Dashboard to Park Dashboard

In `park-dashboard.html`, add a new tab/section:

```html
<!-- Add to navigation tabs -->
<a href="#" onclick="switchSection('email')" class="nav-tab">Email Marketing</a>

<!-- Add section container -->
<section id="emailSection" style="display:none;">
  <div id="emailDashboard"></div>
</section>
```

Include the JavaScript:
```html
<script src="/src/js/email-dashboard.js"></script>
```

## API Endpoints

### POST /api/admin/email
Requires park-staff session. Actions:

#### Get Configuration & Stats
```
GET /api/admin/email
Response: {
  park: { emailsEnabled, emailProvider, senderEmail, senderName, ... },
  stats: { totalSent, openRate, clickRate, bounceRate },
  recentLogs: [ { id, guestName, templateType, sentAt, status, ... } ]
}
```

#### Send Template to Reservation
```
POST /api/admin/email
{
  "action": "send-template",
  "reservationId": "res_123",
  "templateType": "pre-arrival" | "post-stay" | "recovery"
}
Response: { success: true, messageId: "..." }
```

#### Send Seasonal Campaign to All Guests
```
POST /api/admin/email
{
  "action": "send-promo",
  "title": "Labor Day Special",
  "code": "LABORDAY25",
  "description": "15% off Labor Day weekend",
  "details": "Friday-Sunday, select sites",
  "endDate": "2024-09-04"
}
Response: {
  success: true,
  campaignId: "campaign_xxx",
  results: { sent: 45, failed: 2, unsubscribed: 3 }
}
```

#### Update Email Settings
```
POST /api/admin/email
{
  "action": "update-settings",
  "emailsEnabled": true,
  "emailProvider": "sendgrid",
  "senderEmail": "bookings@example.com",
  "emailPreArrival": true,
  "emailPostStay": true,
  "emailRecovery": true,
  "emailPromo": true,
  "loyaltyDiscountPercent": 15
}
Response: { success: true, updates: { ... } }
```

#### Preview Template
```
POST /api/admin/email
{
  "action": "preview-template",
  "templateType": "pre-arrival"
}
Response: { html: "...", templateType: "pre-arrival" }
```

#### Send Test Email
```
POST /api/admin/email
{
  "action": "test-email",
  "testEmail": "admin@example.com"
}
Response: { success: true, result: { messageId, provider, ... } }
```

#### Get Email Logs
```
POST /api/admin/email
{
  "action": "get-logs",
  "limit": 50,
  "offset": 0
}
Response: { logs: [ { id, guestEmail, templateType, sentAt, ... } ] }
```

### GET /api/email-unsubscribe
Public endpoint (no auth required). Usage:

```
GET /api/email-unsubscribe?email=guest@example.com&park=park_123&token=xyz
GET /api/email-unsubscribe?email=guest@example.com&park=park_123

Response: HTML confirmation page (for GET)
         { success: true } (for POST)
```

Used in email footers:
```html
<a href="/api/email-unsubscribe?email={{guestEmail}}&park={{parkId}}&token={{unsubToken}}">
  Unsubscribe
</a>
```

### GET /api/email-tracking/*
Pixel and link tracking (no auth required).

```
<!-- Email open tracking (1x1 pixel) -->
<img src="/api/email-tracking?type=open&eid=log_123" alt="" width="1" height="1">

<!-- Email link click tracking (redirects) -->
<a href="/api/email-tracking?type=click&eid=log_123&url=https://example.com">
  Click Here
</a>
```

## Automation Rules

The system automatically sends emails based on reservation status:

### Pre-Arrival Email
- **When**: 72 hours before check-in
- **Content**: Check-in details, parking instructions, WiFi, site rules
- **Requirements**: Reservation must be "confirmed" or "confirmed-deposit"
- **Can disable**: Per-park toggle in email settings

### Post-Stay Email
- **When**: 24 hours after checkout
- **Content**: Thank you, review request, loyalty discount offer (15% default)
- **Requirements**: Reservation completed without cancellation
- **Can disable**: Per-park toggle

### Recovery Email
- **When**: 30-60 minutes before checkout hold expires
- **Content**: "You left something in your cart", 10% emergency discount
- **Requirements**: Reservation in "pending" status with hold_expires_at
- **Can disable**: Per-park toggle

### Seasonal Promotion Email
- **When**: Manually triggered by park owner via dashboard
- **Content**: Custom offer title, code, description, details
- **Recipients**: All guests in park's reservation history
- **Respects**: Unsubscribe list, per-park enable toggle

## Running Automation Checks

For automatic sends to work, you need a background job runner. Options:

### Option 1: Vercel Cron
Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/email-automation",
    "schedule": "*/5 * * * *"
  }]
}
```

Create `api/cron/email-automation.js`:
```javascript
import { processAutomatedEmails } from '../_lib/email-automation.js';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = await processAutomatedEmails();
    res.status(200).json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
```

### Option 2: External Cron Service
Use https://cron-job.org or similar to POST to:
```
POST https://yourdomain.com/api/cron/email-automation
Authorization: Bearer your-secret-key
```

### Option 3: Node.js Worker
Use Bull, RabbitMQ, or similar message queue with a separate worker process.

## Testing

### Test Email Configuration
```bash
curl -X POST http://localhost:5173/api/admin/email \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your-token" \
  -d '{
    "action": "test-email",
    "testEmail": "test@example.com"
  }'
```

### Preview Templates
Open the Email Dashboard and click "Preview" on each template type.

### Verify Tracking
1. Send a test email to yourself
2. Open the email (should track as "opened")
3. Click a link in the email (should track as "clicked")
4. Check `/api/admin/email` GET endpoint to see stats updated

## Email Variables (Placeholders)

Templates support these variables via `{{variable}}` syntax:

**Reservation Data**
- `{{guestName}}` — Guest's first/last name
- `{{guestEmail}}` — Guest's email
- `{{checkInDate}}` — Formatted check-in date
- `{{checkOutDate}}` — Formatted check-out date
- `{{siteNumber}}` — Reservation site ID or name
- `{{totalPrice}}` — Formatted reservation total

**Park Data**
- `{{parkName}}` — Park name
- `{{address}}` — Park location
- `{{parkPhone}}` — Park phone number
- `{{parkEmail}}` — Park email

**Dynamic**
- `{{wifiSsid}}` — WiFi network name
- `{{wifiPassword}}` — WiFi password
- `{{parkingInstructions}}` — Parking/arrival instructions
- `{{siteRules}}` — Guest rules/policies
- `{{emergencyPhone}}` — Emergency contact number
- `{{loyaltyDiscountPercent}}` — Discount percentage

## Metrics & Reporting

Dashboard shows:
- **Total Sent** — All emails sent this month
- **Open Rate** — % of emails opened (tracked via pixel)
- **Click Rate** — % of emails with link clicks
- **Bounce Rate** — % of hard/soft bounces

Email Logs table shows per-email:
- Guest name and email
- Template type
- Send date
- Delivery status (sent, bounced)
- Opens and clicks
- Last interaction date

## Best Practices

1. **Sender Email**: Use a dedicated domain email (not no-reply) to avoid spam filters
2. **Frequency**: Don't send more than 2 emails per guest per day
3. **Unsubscribe**: Always include unsubscribe link in footer (legal requirement)
4. **Timing**: Pre-arrival at 72h, post-stay at 24h (test optimal timing)
5. **Content**: Keep emails short, mobile-friendly, scannable
6. **Personalization**: Use guest name and stay details for better engagement
7. **Testing**: Send test emails to yourself before enabling automation

## Troubleshooting

**Emails Not Sending**
- Check environment variables are set
- Verify email provider credentials in their dashboard
- Check Vercel/server logs for errors
- Test with POST /api/admin/email action: test-email

**Sender Name Shows as Email Address**
- Verify `senderName` is set in park settings
- Some providers require sender domain verification

**Emails Going to Spam**
- Add park domain to SPF/DKIM/DMARC records
- Use consistent sender address
- Include unsubscribe link
- Keep HTML clean, avoid spam words

**Open/Click Tracking Not Working**
- Check email HTML includes tracking pixel/links
- Verify email provider supports tracking
- Some email clients block pixel tracking (Gmail, Outlook)

**Recovery Emails Not Sending**
- Verify reservation has hold_expires_at timestamp
- Check emailRecovery is enabled in park settings
- Cron job must be running to process automation

## Migration from Legacy System

If you have existing email logs or preferences:
1. Map guest emails to new `email_unsubscribes` table
2. Copy campaign metrics to `email_campaigns` table
3. Set `emails_enabled = false` during migration
4. Test with subset of guests first
5. Gradually enable per-template types

## Support

For issues or questions:
1. Check logs in `/api/admin/email` GET endpoint
2. Review error messages in browser console
3. Test email provider connectivity
4. Verify database tables were created (check Vercel Storage tab)
