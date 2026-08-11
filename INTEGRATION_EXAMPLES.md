# Email Marketing Integration Examples

## Quick Start Examples

### 1. Send Pre-Arrival Email on Demand

```javascript
// From any API route, after a reservation is confirmed
import { sendPreArrivalEmail } from './_lib/email-automation.js';
import { getPark, getReservationsForPark } from './_lib/reservations-store.js';

export default async function handler(req, res) {
  const park = await getPark(parkId);
  const reservation = { /* reservation data */ };
  
  const result = await sendPreArrivalEmail(reservation, park, siteInfo);
  
  if (result.sent) {
    return res.status(200).json({ success: true, messageId: result.messageId });
  } else {
    return res.status(400).json({ error: result.reason });
  }
}
```

### 2. Add Unsubscribe Link to Email Footer

```html
<!-- In email templates -->
<!-- Generate token for security -->
<p style="text-align: center; font-size: 12px; color: #999;">
  <a href="https://yourdomain.com/api/email-unsubscribe?email={{guestEmail}}&park={{parkId}}&token={{unsubToken}}"
     style="color: #999; text-decoration: none;">
    Unsubscribe from all emails
  </a>
</p>
```

### 3. Track Email Opens

```javascript
// In email templates, add tracking pixel
const emailHtml = `
  <img src="/api/email-tracking?type=open&eid=${emailLogId}" 
       alt="" width="1" height="1" style="display:none;">
`;
```

### 4. Track Email Clicks

```javascript
// Wrap links with tracking
const trackingUrl = `/api/email-tracking?type=click&eid=${emailLogId}&url=${encodeURIComponent(destinationUrl)}`;

const html = `<a href="${trackingUrl}">Click here</a>`;
```

### 5. Check if Guest is Unsubscribed

```javascript
import { isUnsubscribed } from './_lib/email-scheduler.js';

const unsubscribed = await isUnsubscribed('guest@example.com', parkId);

if (unsubscribed) {
  console.log('Guest is unsubscribed, skipping email');
  return;
}

// Continue with send
```

### 6. Get Park Email Statistics

```javascript
import { getEmailStats, getEmailLogs } from './_lib/email-scheduler.js';

const stats = await getEmailStats(parkId);
console.log(`Open rate: ${stats.openRate}%`);
console.log(`Click rate: ${stats.clickRate}%`);

const logs = await getEmailLogs(parkId, 20, 0); // 20 most recent
logs.forEach(log => {
  console.log(`${log.guestEmail} - ${log.templateType} - ${log.status}`);
});
```

### 7. Send Custom Email

```javascript
import { sendEmail } from './_lib/email-provider.js';

const result = await sendEmail({
  to: 'guest@example.com',
  subject: 'Welcome to RVPark Success',
  html: '<p>Welcome to our park!</p>',
  from: 'bookings@example.com',
  fromName: 'RVPark Success',
  provider: 'sendgrid' // or 'mailgun', 'nodemailer', 'auto'
});

console.log('Message ID:', result.messageId);
```

### 8. Create Email Log Entry

```javascript
import { createEmailLog } from './_lib/email-scheduler.js';

const logId = await createEmailLog(parkId, {
  reservationId: 'res_123',
  guestEmail: 'guest@example.com',
  guestName: 'John Doe',
  templateType: 'pre-arrival',
  subject: 'Your Check-In Details',
  provider: 'sendgrid',
  providerMessageId: 'sg_xxxx'
});

console.log('Email logged as:', logId);
```

### 9. Process All Pending Automated Emails

```javascript
import { processAutomatedEmails } from './_lib/email-automation.js';

// Run from cron job or manual trigger
const results = await processAutomatedEmails();
console.log(`Processed: ${results.processed}`);
console.log(`Sent: ${results.sent}`);
console.log(`Failed: ${results.failed}`);
```

### 10. Send Promo to All Guests

```javascript
import { sendSeasonalPromoEmail } from './_lib/email-automation.js';

const results = await sendSeasonalPromoEmail(parkId, {
  title: 'Labor Day Weekend Special',
  description: '15% off Friday-Sunday nights',
  code: 'LABORDAY25',
  details: 'Valid Aug 30 - Sep 2. Select sites only.',
  endDate: '2024-09-02'
});

console.log(`Sent: ${results.results.sent}`);
console.log(`Failed: ${results.results.failed}`);
console.log(`Unsubscribed: ${results.results.unsubscribed}`);
```

## Integration Points

### When a Reservation is Created

```javascript
// In api/reservations/create-checkout.js or similar
import { getPark } from '../_lib/reservations-store.js';
import { createEmailLog } from '../_lib/email-scheduler.js';

async function onReservationCreated(reservation, parkId) {
  const park = await getPark(parkId);
  
  if (!park.emailsEnabled) return;
  
  // Log this event (automated emails will be sent by cron)
  console.log(`Reservation ${reservation.id} created, will auto-send pre-arrival in 72 hours`);
  
  // Optional: Create a log entry marking that a pre-arrival *will* be sent
  // (useful for tracking scheduled sends)
}
```

### When a Reservation is Confirmed

```javascript
// After payment confirmation
import { sendPreArrivalEmail } from '../_lib/email-automation.js';

async function onReservationConfirmed(reservation, parkId) {
  const park = await getPark(parkId);
  
  if (park.emailPreArrival) {
    // Optional: send immediately instead of waiting for cron
    const result = await sendPreArrivalEmail(reservation, park, siteInfo);
    console.log('Pre-arrival sent:', result.messageId);
  }
}
```

### In the Webhook Handler

```javascript
// api/reservations/webhook.js or payment confirmation
import { sendPostStayEmail } from '../_lib/email-automation.js';
import { createEmailLog } from '../_lib/email-scheduler.js';

async function onCheckoutCompleted(reservationId, parkId) {
  const reservation = await getReservation(reservationId);
  const park = await getPark(parkId);
  
  if (park.emailsEnabled && park.emailPostStay) {
    // Schedule post-stay email for 24h after checkout
    // (Or send immediately if testing)
    console.log('Post-stay email scheduled for:', reservation.checkOut);
  }
}
```

## Dashboard Integration

### Add Email Section to Staff Dashboard

```html
<!-- In park-dashboard.html -->
<div class="dashboard-tabs">
  <button onclick="showSection('reservations')" class="tab-btn active">
    Reservations
  </button>
  <button onclick="showSection('email')" class="tab-btn">
    Email Marketing
  </button>
  <button onclick="showSection('settings')" class="tab-btn">
    Settings
  </button>
</div>

<!-- Email section -->
<div id="emailSection" style="display: none;">
  <div id="emailDashboard"></div>
</div>

<!-- Include script -->
<script src="/src/js/email-dashboard.js"></script>
```

## Email Template Customization

### Modify Pre-Arrival Template

```javascript
// In api/_lib/email-templates.js, getPreArrivalTemplate()

export function getPreArrivalTemplate(data = {}) {
  const { 
    guestName,
    checkInDate,
    checkInTime,
    // ... add custom fields here
    customWelcomeMessage,
    amenitiesHighlight
  } = data;

  // Add custom content to details
  const details = [
    ['Check-in Date', checkInDate],
    ['Check-in Time', checkInTime],
    // ... add custom rows
    ['Featured Amenity', amenitiesHighlight],
  ];

  return renderEmail({
    eyebrow: 'Get Ready for Your Stay',
    title: `Welcome to ${data.parkName}!`,
    intro: customWelcomeMessage || `Your reservation is confirmed for ${checkInDate}...`,
    details,
    // ... rest of template
  });
}
```

### Add New Template Type

```javascript
// In api/_lib/email-templates.js

const TEMPLATE_TYPES = {
  PRE_ARRIVAL: 'pre-arrival',
  POST_STAY: 'post-stay',
  RECOVERY: 'recovery',
  SEASONAL_PROMO: 'seasonal-promo',
  UPGRADE_OFFER: 'upgrade-offer', // NEW
};

export function getUpgradeOfferTemplate(data = {}) {
  const { guestName, parkName, currentSite, upgradeSite, upgradePrice } = data;
  
  return renderEmail({
    eyebrow: 'Upgrade Available',
    title: `Upgrade Your Site at ${parkName}`,
    intro: `Hi ${guestName}, would you like to upgrade to a premium site?`,
    details: [
      ['Your Current Site', currentSite],
      ['Upgrade Option', upgradeSite],
      ['Additional Cost', upgradePrice],
    ],
    cta: { label: 'Upgrade Now', href: `https://...` },
  });
}
```

### Register New Template

```javascript
// In api/admin/email.js

if (action === 'send-template') {
  const { reservationId, templateType } = req.body;
  
  switch (templateType) {
    // ... existing cases ...
    case 'upgrade-offer':
      result = await sendUpgradeOfferEmail(reservation, park);
      break;
  }
}
```

## Rate Limiting

### Adjust Rate Limits

```javascript
// In email-scheduler.js
const rateLimitOk = await checkRateLimit(
  guestEmail,
  parkId,
  5  // Max 5 emails per day (default is 2)
);
```

### Implement Custom Rate Limiting

```javascript
import { query } from './_lib/email-scheduler.js';

async function customRateLimit(guestEmail, parkId) {
  // Only send if guest hasn't received email in past 48 hours
  const oneDayAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  
  const result = await query(
    `SELECT COUNT(*) as count FROM email_logs
     WHERE guest_email = $1 AND park_id = $2 AND sent_at > $3`,
    [guestEmail.toLowerCase(), parkId, oneDayAgo]
  );
  
  return result.rows[0]?.count === 0;
}
```

## Error Handling

### Graceful Degradation

```javascript
import { sendEmail } from './_lib/email-provider.js';

async function sendEmailSafely(options) {
  try {
    const result = await sendEmail(options);
    return { success: true, result };
  } catch (err) {
    console.error('Email send failed:', err.message);
    
    // Log to monitoring service
    await logError({
      service: 'email',
      error: err.message,
      recipient: options.to,
      timestamp: new Date()
    });
    
    // Don't fail the whole request
    return { success: false, error: err.message };
  }
}
```

### Retry Logic

```javascript
async function sendEmailWithRetry(options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await sendEmail(options);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

## Monitoring & Logging

### Log All Email Events

```javascript
import { createEmailLog, getEmailStats } from './_lib/email-scheduler.js';

async function monitorEmailHealth(parkId) {
  const stats = await getEmailStats(parkId);
  
  if (stats.bounceRate > 5) {
    console.warn(`High bounce rate (${stats.bounceRate}%) for park ${parkId}`);
    // Alert admin
  }
  
  if (stats.openRate < 15) {
    console.warn(`Low open rate (${stats.openRate}%) for park ${parkId}`);
    // Consider template improvement
  }
}
```

### Export Email Data

```javascript
// Get all email logs for reporting
async function exportEmailData(parkId, format = 'csv') {
  const logs = await getEmailLogs(parkId, 1000, 0);
  
  if (format === 'csv') {
    const csv = [
      ['Guest Name', 'Email', 'Template', 'Sent Date', 'Opens', 'Clicks'],
      ...logs.map(l => [
        l.guestName,
        l.guestEmail,
        l.templateType,
        new Date(l.sentAt).toLocaleDateString(),
        l.openedCount,
        l.clickedCount
      ])
    ].map(row => row.join(',')).join('\n');
    
    return csv;
  }
  
  return logs;
}
```
