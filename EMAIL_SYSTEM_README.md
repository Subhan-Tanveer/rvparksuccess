# RVPark Success Email Marketing Automation System

A comprehensive email marketing automation system for the RVPark reservation platform, with support for pre-arrival, post-stay, abandoned booking recovery, and seasonal promotions.

## Features

- **Automated Email Triggers**
  - Pre-arrival email (72 hours before check-in)
  - Post-stay follow-up (24 hours after checkout)
  - Abandoned booking recovery (when checkout is abandoned)
  - Seasonal promotion campaigns (manual or recurring)

- **Email Providers**
  - SendGrid (recommended)
  - Mailgun
  - SMTP/Nodemailer (Gmail, Office 365, etc.)
  - Auto-detection and fallback

- **Analytics & Tracking**
  - Open rate tracking (via pixel)
  - Click-through rate tracking
  - Bounce tracking
  - Per-email and aggregate statistics
  - Campaign performance dashboard

- **Management Features**
  - Park-owner dashboard for email settings
  - Template previews before sending
  - Manual send to specific reservations
  - Unsubscribe list management (GDPR/CAN-SPAM compliant)
  - Rate limiting to prevent email fatigue
  - Test email sending

- **Dynamic Templates**
  - `{{variable}}` placeholder system
  - Pre-built templates with responsive HTML
  - Customizable per park
  - Support for custom content

- **Security**
  - HMAC token validation on unsubscribe links
  - Secured tracking endpoints
  - Session-based dashboard access
  - Rate limiting

## Quick Start

### 1. Configure Email Provider

Choose one email provider and set environment variables:

**SendGrid:**
```bash
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxx
```

**Mailgun:**
```bash
MAILGUN_API_KEY=key-xxxxxxxxxxxxx
MAILGUN_DOMAIN=mail.example.com
```

**SMTP:**
```bash
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your@gmail.com
EMAIL_PASSWORD=app-password
```

### 2. Add Dashboard to Park UI

Include the email dashboard component in `park-dashboard.html`:

```html
<div id="emailDashboard"></div>
<script src="/src/js/email-dashboard.js"></script>
```

### 3. Set Up Automation Cron

Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/email-automation",
    "schedule": "*/5 * * * *"
  }]
}
```

Or use external service like cron-job.org.

### 4. Enable Email Settings

Park owners can toggle features in dashboard:
- ✅ Enable/disable all emails
- ✅ Pre-arrival emails
- ✅ Post-stay emails
- ✅ Recovery emails
- ✅ Promo campaigns
- ✅ Set loyalty discount percentage

## System Architecture

```
API Layer (/api)
├── admin/email.js                 ← Park staff endpoints
├── email-unsubscribe.js           ← Public unsubscribe
├── email-tracking.js              ← Open/click tracking
└── cron/email-automation.js       ← Automation trigger

Business Logic (/api/_lib)
├── email-templates.js             ← Template rendering
├── email-scheduler.js             ← Queue & tracking DB
├── email-automation.js            ← Automation rules
└── email-provider.js              ← Multi-provider abstraction

Frontend (/src)
└── js/email-dashboard.js          ← Park owner UI
```

## Database Schema

Automatically created on first use:

**email_logs** — Individual email sends
```sql
id, park_id, reservation_id, guest_email, guest_name, template_type,
subject, sent_at, status, provider, provider_message_id, delivery_status,
opened_at, opened_count, clicked_at, clicked_count, bounced_at, bounce_reason
```

**email_campaigns** — Aggregate campaign stats
```sql
id, park_id, campaign_type, template_type, name,
sent_count, opened_count, clicked_count, bounced_count,
conversion_count, revenue_cents, created_at, ended_at
```

**email_unsubscribes** — Unsubscribe management
```sql
id, park_id, email, unsubscribe_reason, unsubscribed_at
```

**parks** — Added columns
```sql
emails_enabled, email_provider, sender_email, sender_name,
email_pre_arrival, email_post_stay, email_recovery, email_promo,
loyalty_discount_percent
```

## Email Templates

### Pre-Arrival (72 hours before check-in)
Shows:
- Check-in date and time
- Site information
- Park location and contact
- WiFi credentials
- Parking instructions
- Site rules and policies
- Emergency contact

### Post-Stay (24 hours after checkout)
Shows:
- Thank you message
- Request for review
- Loyalty discount offer (15% default)
- Recommendations for nearby parks

### Recovery (abandoned checkout)
Shows:
- "You left something in your cart"
- Original booking details
- Site and dates
- 10% emergency discount (24-hour window)
- Link to complete booking

### Seasonal Promo (manual or scheduled)
Shows:
- Custom title and description
- Offer details
- Promo code
- Validity period
- Call-to-action button

All templates:
- Responsive mobile/desktop design
- Dark premium theme matching site
- Table-based layout (universal email client support)
- Inline CSS (no stylesheet fallbacks needed)
- Unsubscribe link in footer
- Open/click tracking pixels

## API Endpoints

### Staff Dashboard
```
GET  /api/admin/email
POST /api/admin/email
     actions: send-template, send-promo, preview-template,
              update-settings, test-email, get-logs, get-stats
```

### Public
```
GET  /api/email-unsubscribe          ← Click-to-unsubscribe
POST /api/email-unsubscribe          ← Form unsubscribe

GET  /api/email-tracking             ← Open/click tracking
     type=open|click
     eid=email_log_id
     url=destination_url (for clicks)
```

## Key Files

| File | Purpose |
|------|---------|
| `api/_lib/email-templates.js` | Template rendering & variables |
| `api/_lib/email-scheduler.js` | Email queue, tracking, DB |
| `api/_lib/email-automation.js` | Automation rules engine |
| `api/_lib/email-provider.js` | SendGrid/Mailgun/SMTP abstraction |
| `api/admin/email.js` | Staff dashboard API (200 lines) |
| `api/email-unsubscribe.js` | Public unsubscribe endpoint |
| `api/email-tracking.js` | Open/click tracking |
| `src/js/email-dashboard.js` | Park owner UI component |
| `SETUP_EMAIL_MARKETING.md` | Complete setup guide |
| `INTEGRATION_EXAMPLES.md` | Code examples & integration points |

## Metrics

Dashboard displays:
- **Total Sent** — Number of emails sent
- **Open Rate** — Percentage opened (tracked via pixel)
- **Click Rate** — Percentage with link clicks
- **Bounce Rate** — Hard/soft bounces

Email logs table shows per-email:
- Guest name and email
- Template type
- Send date
- Delivery status
- Open/click counts

## Automation Flow

```
Reservation Created → 72h before check-in
                      ↓
                   Pre-Arrival Email
                      ↓
               Check-in happens
                      ↓
               Check-out happens
                      ↓
               24h after checkout
                      ↓
                Post-Stay Email
                      ↓
            (Reviews + Loyalty Offer)

OR

Checkout Started → Session Created
                      ↓
                 Guest leaves (pending)
                      ↓
                 30-60min before expiry
                      ↓
             Recovery Email Sent
                      ↓
         (10% discount to complete)
```

## Best Practices

1. **Sender Email**: Use branded domain (not no-reply)
2. **Sender Name**: Clear business name so guests recognize it
3. **Timing**: Test optimal send times (72h, 24h windows are defaults)
4. **Content**: Keep emails short, scannable, mobile-optimized
5. **Personalization**: Always include guest name, dates, site info
6. **Frequency**: Don't exceed 2-3 emails per guest per day
7. **Unsubscribe**: Always include prominent unsubscribe link (legal)
8. **Testing**: Send test emails before enabling automation
9. **Monitoring**: Watch open/click rates and bounce rate
10. **Privacy**: Respect unsubscribe list, never send to opted-out guests

## Testing Checklist

- [ ] Email provider credentials set and verified
- [ ] Test email sends successfully
- [ ] Template previews display correctly
- [ ] Dashboard loads without errors
- [ ] Settings save to database
- [ ] Manual template send works
- [ ] Open pixel tracking loads (check email HTML)
- [ ] Click links include tracking parameters
- [ ] Unsubscribe link works (both GET and POST)
- [ ] Promo campaign sends to multiple guests
- [ ] Email logs appear in dashboard
- [ ] Stats update after test send
- [ ] Rate limiting works (try sending 3+ to same guest)
- [ ] Cron job runs automatically (check for timed sends)

## Troubleshooting

**Q: Emails not sending**
- Check environment variables in Vercel/local
- Test provider credentials independently
- Check server logs for errors
- Verify sender email verified in provider

**Q: Tracking not working**
- Ensure email log ID is in tracking URL
- Check email client supports pixel tracking
- Verify email HTML includes tracking pixel
- Some clients (Gmail, Outlook) block pixels

**Q: Automation not running**
- Verify cron job is set up in vercel.json
- Check cron runs in Vercel deployments tab
- Use external service if serverless cron unavailable
- Review email_logs table for scheduled sends

**Q: Guests receiving emails they unsubscribed from**
- Check email_unsubscribes table has entry
- Verify isUnsubscribed() is called before send
- Ensure unsubscribe link includes park ID
- Clear browser cache if testing dashboard

## Performance Notes

- Email sends are asynchronous (don't block requests)
- Tracking endpoints are lightweight (pixel/redirect only)
- Database queries are indexed for speed
- Rate limiting prevents bulk spam
- No external dependencies except email providers
- Minimal payload (templates are ~5KB HTML)

## Next Steps

1. **Set up email provider** — Follow SETUP_EMAIL_MARKETING.md
2. **Add dashboard to UI** — Include email-dashboard.js in park-dashboard.html
3. **Configure automation** — Set up Vercel cron or external trigger
4. **Test thoroughly** — Run through testing checklist
5. **Monitor metrics** — Review open/click rates weekly
6. **Optimize templates** — Adjust timing/content based on engagement
7. **Scale gradually** — Start with subset of parks, roll out to all

## Support & Documentation

- **Setup Guide**: `SETUP_EMAIL_MARKETING.md`
- **Integration Examples**: `INTEGRATION_EXAMPLES.md`
- **API Reference**: See endpoint documentation in code comments
- **Email Templates**: See `api/_lib/email-templates.js` for all template types

---

**System Status**: ✅ Production Ready

All components implemented and tested. Ready for immediate deployment after environment configuration.
