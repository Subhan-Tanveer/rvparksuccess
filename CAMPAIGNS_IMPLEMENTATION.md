# Promotional Campaigns Engine — Implementation Guide

## Overview

The Promotional Campaigns Engine (Phase 2) is a comprehensive marketing automation system for RVPark Success. It enables staff to create, execute, and track targeted promotional campaigns via email and SMS, with built-in support for A/B testing, ROI calculation, and guest segmentation.

## Architecture

### Components

1. **Campaign Engine** (`api/_lib/campaign-engine.js`)
   - Business logic for campaign creation, execution, tracking
   - Email/SMS orchestration
   - ROI and performance calculation
   - A/B testing infrastructure

2. **API Layer** (`api/admin/campaigns.js`)
   - REST endpoints for campaign management
   - Parks-scoped (staff sees only their park's campaigns)
   - Full CRUD operations on campaigns, recipients, variants

3. **Data Layer** (`api/_lib/reservations-store.js`)
   - 4 new Postgres tables: `campaigns`, `campaign_recipients`, `campaign_performance`, `campaign_variants`
   - Mapping functions for camelCase conversion
   - Query helpers for campaign retrieval

4. **Frontend UI** (`src/js/campaigns-dashboard.js`)
   - Campaign list view with filtering and search
   - Multi-step campaign builder wizard
   - Campaign detail view with performance metrics
   - A/B test interface
   - Real-time performance tracking

5. **Styling** (`src/css/campaigns-dashboard.css`)
   - Campaign card layouts
   - Modal dialogs and wizard styling
   - Responsive design (mobile-first)
   - Dark mode support

### Database Schema

#### `campaigns` table
```sql
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  park_id TEXT REFERENCES parks(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- seasonal|loyalty|event-driven|behavioral|referral
  status TEXT DEFAULT 'draft',  -- draft|scheduled|active|completed|paused
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  budget_cents INTEGER,
  discount_amount NUMERIC,
  discount_type TEXT,  -- percent|fixed
  promo_code TEXT,
  description TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Indexes:**
- `(park_id, status)` — Fast filtering by status per park
- `(park_id, start_date, end_date)` — Date range queries

#### `campaign_recipients` table
```sql
CREATE TABLE campaign_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id),
  guest_email TEXT NOT NULL,
  guest_phone TEXT,
  guest_id TEXT,
  email_sent BOOLEAN,
  email_sent_at TIMESTAMPTZ,
  email_opened BOOLEAN,
  email_clicked BOOLEAN,
  email_click_count INTEGER,
  sms_sent BOOLEAN,
  sms_sent_at TIMESTAMPTZ,
  sms_delivered BOOLEAN,
  converted BOOLEAN,
  conversion_value_cents INTEGER,
  conversion_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);
```

**Indexes:**
- `(campaign_id, guest_email)` UNIQUE — One recipient per campaign
- `(campaign_id)` — Fetch all recipients for a campaign

#### `campaign_performance` table
```sql
CREATE TABLE campaign_performance (
  id TEXT PRIMARY KEY,
  campaign_id TEXT UNIQUE REFERENCES campaigns(id),
  emails_sent INTEGER,
  emails_opened INTEGER,
  emails_clicked INTEGER,
  open_rate_percent NUMERIC,
  click_rate_percent NUMERIC,
  conversions INTEGER,
  conversion_rate_percent NUMERIC,
  revenue_generated_cents INTEGER,
  cost_cents INTEGER,
  roi_percent NUMERIC,
  calculated_at TIMESTAMPTZ
);
```

**Calculation:**
- `open_rate_percent = (emails_opened / emails_sent) * 100`
- `click_rate_percent = (emails_clicked / emails_sent) * 100`
- `conversion_rate_percent = (conversions / emails_sent) * 100`
- `cost_cents = (emails_sent * 50) + (sms_sent * 150)` (rough platform costs)
- `roi_percent = ((revenue - cost) / cost) * 100`

#### `campaign_variants` table
```sql
CREATE TABLE campaign_variants (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id),
  variant_name TEXT,
  variant_type TEXT,  -- A|B
  subject TEXT,
  body TEXT,
  sms_body TEXT,
  recipient_count INTEGER,
  emails_sent INTEGER,
  emails_opened INTEGER,
  email_open_rate_percent NUMERIC,
  emails_clicked INTEGER,
  conversions INTEGER,
  revenue_cents INTEGER,
  is_winner BOOLEAN,
  created_at TIMESTAMPTZ
);
```

## Campaign Types

### 1. Seasonal Promotions
**Use Case:** Holiday or seasonal discounts (Labor Day, Winter break, etc.)

**Example:**
- Type: `seasonal`
- Start: 2024-09-01, End: 2024-09-05
- Discount: 15% off
- Promo Code: LABORDAY15
- Recipients: All guests

### 2. Loyalty Rewards
**Use Case:** Reward repeat customers after N bookings

**Example:**
- Type: `loyalty`
- Discount: 20% off
- Target: Guests with 3+ bookings
- Promo Code: LOYAL20

### 3. Event-Driven
**Use Case:** Triggered automatically by booking/cancellation events

**Example:**
- Type: `event-driven`
- Trigger: Abandoned cart (initiated checkout but didn't complete)
- Discount: 10% off to complete booking
- Promo Code: FINISH10

### 4. Behavioral Targeting
**Use Case:** Target specific guest segments by activity

**Example:**
- Type: `behavioral`
- Target: Inactive (60+ days with no bookings)
- Discount: $50 off
- Message: "We miss you!"

### 5. Referral Program
**Use Case:** Incentivize guests to refer friends

**Example:**
- Type: `referral`
- Discount: $25 credit per referral (guest + referred friend)
- Message: "Refer a friend, both get $25 credit"

## API Endpoints

### Campaign Management

#### GET /api/admin/campaigns
List all campaigns for a park
```json
Query params:
- status: draft|scheduled|active|completed|paused (optional)
- limit: 50 (default)
- offset: 0 (default)

Response: Campaign[] with performance metrics
```

#### GET /api/admin/campaigns?campaignId=ID
Get campaign details with recipients and performance
```json
Response: {
  ...campaign,
  recipients: Recipient[],
  recipientCount: number,
  performance: Performance,
  variants: Variant[]
}
```

#### POST /api/admin/campaigns
Create a new campaign
```json
Request body: {
  name: string,
  type: seasonal|loyalty|event-driven|behavioral|referral,
  startDate: YYYY-MM-DD,
  endDate: YYYY-MM-DD,
  budgetCents: number (optional),
  discountAmount: number,
  discountType: percent|fixed,
  promoCode: string (optional),
  description: string (optional)
}

Response: Campaign object
```

#### PATCH /api/admin/campaigns/:campaignId
Update campaign (draft only)
```json
Request body: Partial campaign update
Response: Updated campaign
```

#### DELETE /api/admin/campaigns/:campaignId
Delete campaign (draft only)
```json
Response: { success: true }
```

### Campaign Execution

#### POST /api/admin/campaigns/:campaignId/recipients
Add recipients to campaign
```json
Request body: {
  recipients: [
    { email: string, phone?: string, guestId?: string },
    ...
  ]
}

Response: { added: number, recipients: Recipient[] }
```

#### POST /api/admin/campaigns/:campaignId/execute
Send campaign to all recipients via email/SMS
```json
Request body: {
  sendEmail: boolean (default: true),
  sendSms: boolean (default: true)
}

Response: {
  totalRecipients: number,
  emailsSent: number,
  emailsFailed: number,
  smsSent: number,
  smsFailed: number,
  errors: string[]
}
```

### Performance Tracking

#### GET /api/admin/campaigns/:campaignId/performance
Get detailed performance metrics
```json
Response: {
  performance: Performance,
  roi: {
    revenueGeneratedCents: number,
    costCents: number,
    roiPercent: number,
    profitCents: number
  }
}
```

#### POST /api/admin/campaigns/:campaignId/track-performance
Recalculate performance metrics
```json
Response: Updated performance object
```

### A/B Testing

#### POST /api/admin/campaigns/:campaignId/ab-test
Create A/B test variants
```json
Request body: {
  variantA: {
    name: string,
    subject: string,
    body: string,
    smsBody: string (optional)
  },
  variantB: {
    name: string,
    subject: string,
    body: string
  }
}

Response: { variantA: Variant, variantB: Variant }
```

Recipients are split 50/50 automatically during execution.

#### POST /api/admin/campaigns/:campaignId/ab-test/winner
Declare A/B test winner based on conversion rate
```json
Response: {
  winner: A|B,
  winnerConversionRate: number,
  variants: {
    A: { conversions: number, rate: string },
    B: { conversions: number, rate: string }
  }
}
```

### Campaign Status

#### POST /api/admin/campaigns/:campaignId/pause
Pause an active campaign
```json
Response: Updated campaign (status: paused)
```

#### POST /api/admin/campaigns/:campaignId/resume
Resume a paused campaign
```json
Response: Updated campaign (status: active)
```

## Email & SMS Templates

### Email Template Variables
Available in campaign message templates:
- `{{name}}` — Guest first name
- `{{discount}}` — Discount amount
- `{{discountType}}` — "percent" or "fixed"
- `{{promoCode}}` — Promo code if applicable

### Example Email
```html
<h2>You're getting {{discount}}% off!</h2>
<p>Hi {{name}},</p>
<p>We're offering you {{discount}}% off your next RV park stay.</p>
<p>Use promo code: <strong>{{promoCode}}</strong></p>
<p>This offer expires on September 5th.</p>
<a href="https://rvparksuccess.com/book">Book Now</a>
```

### SMS Template
Limited to 160 characters (160 GSM chars). Example:
```
{{name}}, get {{discount}}% off with code {{promoCode}}. Book now: rvparksuccess.com/book
```

## Security & Permissions

### Park Scoping
- Staff can only view/manage campaigns for their park
- Session validation on all endpoints
- Park ID verified from auth token

### Input Validation
- Date range: `startDate < endDate`
- Discount validation: 0-100% for percent, 0+ for fixed
- Email format validation on recipients
- Promo code uniqueness (per park)

### Rate Limiting
- SMS: 60 requests/minute (Twilio rate limit)
- Email: No platform limit (unlimited via Sendgrid/Mailgun)

## Performance Monitoring

### Email Tracking
When emails are sent via Sendgrid/Mailgun:
- Opens tracked automatically via pixel tracking
- Clicks tracked via wrapped URLs
- Status updates via webhooks (if configured)

### Conversion Tracking
- Conversions marked manually via API or automatically when:
  - Booking made by guest with same email as campaign recipient
  - Promo code used at checkout

### Metrics Calculated
- **Open Rate** = (emails_opened / emails_sent) × 100
- **Click Rate** = (emails_clicked / emails_sent) × 100
- **Conversion Rate** = (conversions / emails_sent) × 100
- **ROI** = ((revenue - cost) / cost) × 100
- **Cost Estimate** = (emails_sent × $0.50) + (sms_sent × $1.50)

## Error Handling

### Validation Errors (400)
```json
{
  "error": "Invalid campaign type: xyz",
  "code": 400
}
```

### Not Found (404)
```json
{
  "error": "Campaign not found",
  "code": 404
}
```

### Rate Limit (429)
```json
{
  "error": "Rate limit exceeded. Please retry in 5s",
  "code": 429
}
```

### Server Error (500)
```json
{
  "error": "Failed to send emails",
  "code": 500
}
```

## Configuration

### Required Environment Variables
```bash
# Email provider (choose one: sendgrid, mailgun, nodemailer)
SENDGRID_API_KEY=sg_...
# or
MAILGUN_API_KEY=key-...
MAILGUN_DOMAIN=mg.example.com
# or
EMAIL_HOST=smtp.example.com
EMAIL_USER=user@example.com
EMAIL_PASSWORD=password
EMAIL_PORT=587

# SMS provider (Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1234567890

# Database
DATABASE_URL=postgresql://user:pass@host/db
```

### Optional Configuration
```bash
# Email defaults
EMAIL_FROM=campaigns@rvparksuccess.com

# SMS defaults
SMS_FROM_NAME=RVPark Success
```

## Frontend Integration

### Initialization
```javascript
import { initCampaignsDashboard } from './campaigns-dashboard.js';

// In park-dashboard.js
await initCampaignsDashboard(currentPark);
```

### Campaign Creator Flow
1. **Type Selection** — Choose campaign type
2. **Campaign Details** — Name, dates, description
3. **Offer Details** — Discount type and amount
4. **Recipients** — Target segment
5. **Message Content** — Email subject, body, SMS text
6. **A/B Testing** — Optional variant creation
7. **Review** — Summary before creating

### Campaign Detail View
- Metrics cards: recipients, emails sent, opens, clicks, conversions, ROI
- Action buttons: send, pause, resume, duplicate, export
- A/B test results display
- Performance chart (if data available)

## Best Practices

### Campaign Strategy

1. **Timing**
   - Send seasonal campaigns 2-4 weeks before season starts
   - A/B test with small segment first (10% of list)
   - Allow at least 7 days for A/B test to complete

2. **Messaging**
   - Keep email subject lines under 50 chars
   - SMS must be under 160 chars
   - Use first names in greeting for personalization
   - Clear call-to-action ("Book Now", "Claim Offer")

3. **Targeting**
   - Loyalty rewards: 3+ bookings = engaged customers
   - Behavioral: Inactive 60+ days = good re-engagement target
   - Event-driven: Cart abandonment = immediate follow-up (24-48h)
   - Referral: Target loyal customers only (likelihood to refer)

4. **ROI Optimization**
   - Track conversion value (not just count)
   - Compare A/B variants on conversion rate, not just opens
   - Segment by guest LTV (don't discount best customers)
   - Cap discount budget per campaign

### Testing Checklist

Before executing campaign:
- [ ] All recipients have email or phone
- [ ] Dates are valid (start < end)
- [ ] Email template is renderable (no missing variables)
- [ ] SMS text is under 160 chars
- [ ] Promo code works at checkout
- [ ] A/B test has sufficient recipients (minimum 100 per variant)

## Troubleshooting

### "Campaign has no recipients"
- Run POST `/api/admin/campaigns/:campaignId/recipients` first
- Verify guest list has email addresses

### "Rate limit exceeded"
- SMS only. Wait 60 seconds before retrying
- Consider spacing out large SMS sends

### "Email provider not configured"
- Set SENDGRID_API_KEY, MAILGUN_API_KEY, or SMTP env vars
- Check .env file in deployment environment

### "Conversion rate is 0%"
- Allow time for guests to receive email and book
- Verify promo code is configured correctly
- Check if email provider supports open/click tracking

## Performance Tuning

### Large Recipient Lists (10k+)
- Use batch processing (split into 1000-recipient chunks)
- Execute campaign in background job
- Progress tracking via `/performance` endpoint

### Dashboard Performance
- Campaigns dashboard loads 50 campaigns by default
- Use pagination for large campaign histories
- Cache performance data (refreshed hourly)

## Future Enhancements

Planned features for Phase 3:
- Scheduled campaign send times (timezone-aware)
- Guest event triggers (booking anniversary, check-out follow-up)
- Multi-variant testing (more than 2 variants)
- Advanced segmentation (RFM analysis, clustering)
- Campaign templates (pre-built seasonal/loyalty campaigns)
- Detailed engagement funnel (view → click → book journey)
- Mobile push notifications (in addition to email/SMS)
- Webhook support for external CRM/analytics integration
