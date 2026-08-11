# RV Park SMS Messaging System

Complete SMS messaging system for RV park reservations using Twilio. Automatically sends booking confirmations, arrival reminders, check-in messages, and thank you notes to guests.

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install twilio
```

### 2. Configure Twilio

1. Sign up at [Twilio Console](https://www.twilio.com/console)
2. Get Account SID and Auth Token
3. Buy a phone number that supports SMS
4. Copy `.env.example` to `.env` and add:

```bash
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

### 3. Start the Server

```bash
npm start
# or for development
npm run dev
```

The SMS system initializes automatically on startup if Twilio credentials are configured.

## System Architecture

### Core Modules

#### 1. **SMS Service** (`src/lib/sms-service.js`)
- Twilio client initialization
- Send SMS with error handling
- Rate limiting (60 SMS/min)
- Message status tracking
- Phone number validation & formatting

```javascript
const TwilioSMSService = require('./lib/sms-service');

const sms = new TwilioSMSService(accountSid, authToken);
const result = await sms.sendSMS(
  '+15551234567',      // To phone
  '+15105551234',      // From phone (Twilio)
  'Your reservation...' // Message
);
```

#### 2. **SMS Templates** (`src/lib/sms-templates.js`)
- 12 pre-built message templates
- Variable substitution with {{var}} syntax
- Template validation
- Customizable messages

```javascript
const { renderTemplate, validateVariables } = require('./lib/sms-templates');

const message = renderTemplate('confirmation', {
  parkName: 'Sunny RV Park',
  checkInDate: '2024-08-15',
  siteNumber: 'A12'
});
```

#### 3. **SMS Scheduler** (`src/lib/sms-scheduler.js`)
- Queue messages for later delivery
- Quiet hours support (no SMS 9pm-8am)
- Automatic retries on failure
- Database persistence

```javascript
const scheduler = new SMSScheduler();

scheduler.scheduleMessage({
  phoneNumber: '+15551234567',
  message: 'Reminder about your reservation...',
  sendTime: 'checkInDate-24h',  // 24h before check-in
  reservationId: 1
});
```

#### 4. **Reservation SMS Service** (`src/lib/reservation-sms-service.js`)
- Lifecycle hooks for reservations
- Automatic message scheduling
- Statistics & analytics
- Guest communication history

```javascript
const ReservationSMSService = require('./lib/reservation-sms-service');

// On new reservation
await ReservationSMSService.handleNewReservation(
  reservation, guest, park, sendSMS
);

// Get stats
const stats = ReservationSMSService.getStatistics(parkId);
// { totalSent: 42, delivered: 41, failed: 1, deliveryRate: '97%' }
```

### API Endpoints

All endpoints require JWT authentication (`Authorization: Bearer <token>`).

#### Send SMS

**POST** `/api/sms/send`

```bash
curl -X POST http://localhost:4000/api/sms/send \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reservationId": 1,
    "templateType": "confirmation",
    "phoneNumber": "+15551234567"
  }'
```

Response:
```json
{
  "status": "queued",
  "messageId": "SM1234567890abcdef",
  "smsLogId": 42,
  "sentAt": "2024-08-11T10:30:00Z"
}
```

#### Schedule SMS

**POST** `/api/sms/schedule`

```bash
curl -X POST http://localhost:4000/api/sms/schedule \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reservationId": 1,
    "templateType": "reminder",
    "sendTime": "8:00 AM"
  }'
```

#### Get SMS Logs

**GET** `/api/sms/logs?status=delivered&limit=50`

```bash
curl http://localhost:4000/api/sms/logs \
  -H "Authorization: Bearer $JWT_TOKEN"
```

#### Check SMS Status

**GET** `/api/sms/status`

```bash
curl http://localhost:4000/api/sms/status \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Returns:
```json
{
  "configured": true,
  "hasCredentials": true,
  "accountSid": "ACxxxxxxxx***",
  "phoneNumber": "+1 (510) 555-1234",
  "scheduledMessages": 3,
  "activeTimers": 2
}
```

### Database Schema

#### `parks` Table
```sql
CREATE TABLE parks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  twilioPhoneNumber TEXT,
  smsEnabled INTEGER DEFAULT 0,
  quietHoursStart TEXT DEFAULT '9:00 PM',
  quietHoursEnd TEXT DEFAULT '8:00 AM',
  wifiSSID TEXT,
  wifiPassword TEXT,
  officeLocation TEXT,
  parkingLocation TEXT,
  reviewLink TEXT,
  ...
);
```

#### `guests` Table
```sql
CREATE TABLE guests (
  id INTEGER PRIMARY KEY,
  firstName TEXT NOT NULL,
  phoneNumber TEXT,
  smsOptIn INTEGER DEFAULT 1,
  smsOptOutDate TEXT,
  ...
);
```

#### `reservations` Table
```sql
CREATE TABLE reservations (
  id INTEGER PRIMARY KEY,
  parkId INTEGER REFERENCES parks(id),
  guestId INTEGER REFERENCES guests(id),
  checkInDate TEXT NOT NULL,
  checkOutDate TEXT NOT NULL,
  siteNumber TEXT,
  status TEXT,
  ...
);
```

#### `sms_logs` Table
```sql
CREATE TABLE sms_logs (
  id INTEGER PRIMARY KEY,
  reservationId INTEGER,
  guestId INTEGER,
  templateType TEXT,
  message TEXT,
  status TEXT,  -- queued, sent, delivered, failed
  messageId TEXT,
  phoneNumber TEXT,
  errorCode TEXT,
  sentAt TEXT,
  ...
);
```

#### `sms_scheduled` Table
```sql
CREATE TABLE sms_scheduled (
  id INTEGER PRIMARY KEY,
  schedule_id TEXT UNIQUE,
  reservation_id INTEGER,
  phone_number TEXT,
  template_type TEXT,
  send_time TEXT,  -- 'immediately', '8:00 AM', 'checkInDate-24h', etc
  status TEXT,  -- pending, sent, failed, cancelled
  ...
);
```

#### `sms_inbound` Table
```sql
CREATE TABLE sms_inbound (
  id INTEGER PRIMARY KEY,
  twilio_sid TEXT UNIQUE,
  from_number TEXT,
  to_number TEXT,
  message TEXT,
  received_at TEXT,
  ...
);
```

## Message Templates

### Available Templates

| Type | Event | When Sent |
|------|-------|-----------|
| `confirmation` | Booking confirmed | Immediately |
| `reminder` | Pre-arrival alert | 24h before check-in |
| `checkin` | Check-in day message | 8:00 AM on check-in date |
| `thankyou` | Post-stay thanks | 24h after checkout |
| `payment` | Payment reminder | Immediately (on demand) |
| `cancellation` | Booking cancelled | Immediately |
| `checkout` | Checkout reminder | Day of checkout |
| `promotional` | Special offer | On demand |
| `alert` | Service alert | On demand (all guests) |
| `wifi` | WiFi credentials | On demand |
| `event` | Activity notification | On demand |
| `custom` | Custom message | On demand |

### Template Variables

Each template uses {{variable}} placeholders filled automatically:

- `{{parkName}}` - Park name
- `{{guestName}}` - Guest name
- `{{checkInDate}}` - Check-in date
- `{{checkOutDate}}` - Check-out date
- `{{checkInTime}}` - Check-in time
- `{{checkOutTime}}` - Checkout time
- `{{siteNumber}}` - Site/RV number
- `{{parkPhone}}` - Park contact phone
- `{{parkAddress}}` - Park address
- `{{wifiSSID}}` - WiFi network name
- `{{wifiPassword}}` - WiFi password
- `{{reviewLink}}` - Review URL
- `{{amount}}` - Payment amount
- `{{paymentLink}}` - Payment URL

## Integration with Reservations

### Automatic SMS on Reservation Events

```javascript
// In your reservation creation endpoint
const ReservationSMSService = require('./lib/reservation-sms-service');

app.post('/api/reservations', async (req, res) => {
  // Create reservation...
  const reservation = createReservation(req.body);
  const guest = getGuest(reservation.guestId);
  const park = getPark(reservation.parkId);

  // Send confirmation and schedule reminders
  await ReservationSMSService.handleNewReservation(
    reservation, guest, park, sendSMS
  );

  res.json(reservation);
});
```

### On Cancellation

```javascript
app.delete('/api/reservations/:id', async (req, res) => {
  const reservation = getReservation(req.params.id);
  const guest = getGuest(reservation.guestId);
  const park = getPark(reservation.parkId);

  // Send cancellation notice and cancel scheduled reminders
  await ReservationSMSService.handleCancellation(
    reservation, guest, park, sendSMS
  );

  deleteReservation(reservation.id);
  res.json({ deleted: true });
});
```

## Webhook Configuration

### Twilio Webhooks

Configure Twilio to send delivery status and inbound messages back to your app:

1. Go to [Twilio Console > Messaging](https://www.twilio.com/console/sms/settings)
2. Set webhooks:
   - **When a message comes in**: `https://yourdomain.com/api/webhooks/twilio-inbound`
   - **Status Callbacks**: `https://yourdomain.com/api/webhooks/twilio-status`

### Delivery Status Webhook

Twilio POSTs to `/api/webhooks/twilio-status` with:
```json
{
  "MessageSid": "SM1234567890abcdef",
  "MessageStatus": "delivered"  // delivered, failed, undelivered, sent, etc
}
```

Webhook handler updates `sms_logs` table and triggers alerts on failures.

### Inbound Message Webhook

Twilio POSTs to `/api/webhooks/twilio-inbound` when guests reply:
```json
{
  "From": "+15551234567",
  "To": "+15105551234",
  "Body": "STOP"  // SMS reply from guest
}
```

If guest replies **STOP**, automatically opt them out of SMS.

## Guest Opt-In Management

### Enable SMS During Booking

```sql
INSERT INTO guests (firstName, phoneNumber, smsOptIn)
VALUES ('John', '+15551234567', 1);
```

### Guest Opts Out

Guest replies "STOP" to any SMS → webhook processes → `smsOptIn` set to 0

```sql
UPDATE guests SET smsOptIn = 0, smsOptOutDate = datetime('now')
WHERE phoneNumber = '+15551234567';
```

### API to Check/Change Opt-In Status

```bash
# Check if guest opted in
SELECT smsOptIn FROM guests WHERE id = 5;

# Manually opt out guest
UPDATE guests SET smsOptIn = 0 WHERE id = 5;
```

## Error Handling & Retries

### Automatic Retries

Failed SMS are automatically retried:
1. Immediate retry if network error
2. Retry after 30 minutes if Twilio error
3. Retry after 1 hour if still failing
4. Alert owner if 10+ failures in 1 hour

### Common Error Codes

| Code | Meaning | Fix |
|------|---------|-----|
| 21600 | Invalid phone number | Verify phone format |
| 21601 | Wrong number format | Use E.164 format (+1234567890) |
| 20003 | Account suspended | Check Twilio account status |
| 30002 | Unreachable number | Number doesn't support SMS |
| 30003 | Message blocked | Carrier filtering (try different wording) |

### Debug Failed SMS

```bash
# Get failed SMS
curl http://localhost:4000/api/sms/logs?status=failed \
  -H "Authorization: Bearer $TOKEN"

# Get specific message status from Twilio
curl http://localhost:4000/api/sms/message-status/SM1234567890abcdef \
  -H "Authorization: Bearer $TOKEN"
```

## Performance & Monitoring

### SMS Dashboard

Open `SMS_DASHBOARD.html` to view:
- SMS sent this month
- Delivery rate
- Failed SMS count
- Scheduled pending messages
- Recent activity log
- Service status

### Metrics to Track

```javascript
const stats = ReservationSMSService.getStatistics(parkId);
// {
//   totalSent: 342,
//   delivered: 335,
//   failed: 7,
//   thisMonth: 45,
//   deliveryRate: '97%',
//   templateTypes: 11
// }
```

### Database Queries for Monitoring

```sql
-- SMS sent this month
SELECT COUNT(*) FROM sms_logs
WHERE strftime('%Y-%m', sentAt) = strftime('%Y-%m', 'now')
AND status = 'sent';

-- Delivery rate
SELECT 
  SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as rate
FROM sms_logs;

-- Failed SMS requiring attention
SELECT * FROM sms_logs
WHERE status = 'failed'
ORDER BY sentAt DESC
LIMIT 10;

-- Guest opt-in rate
SELECT 
  SUM(CASE WHEN smsOptIn = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as rate
FROM guests;
```

## Costs & Pricing

### Twilio SMS Pricing

- **Account Setup**: Free
- **Phone Number**: ~$1.50/month
- **Inbound SMS**: $0.0075 per message
- **Outbound SMS**: $0.0075 per message
- **Free Trial**: $20 credit

### Estimated Monthly Cost

For 100 reservations with 4 SMS each:
- 400 SMS × $0.0075 = $3.00
- Phone number = $1.50
- **Total: ~$4.50/month**

## Best Practices

1. **Test First**: Send test SMS to your phone before production
2. **Personalize**: Always include guest name in messages
3. **Timing**: Send confirmations immediately, reminders 24h before
4. **Length**: Keep SMS under 160 characters when possible
5. **Compliance**: Never send during quiet hours; include opt-out in every SMS
6. **Monitoring**: Check SMS logs weekly for delivery issues
7. **Updates**: Update templates if park info changes (WiFi, phone, hours)
8. **Links**: Use short URLs to track engagement

## Troubleshooting

### SMS Not Sending

1. Check Twilio credentials are set in `.env`
2. Verify SMS is enabled for the park: `SELECT smsEnabled FROM parks WHERE id = 1;`
3. Confirm guest opted in: `SELECT smsOptIn FROM guests WHERE id = 1;`
4. Check phone number format (must be E.164: +1234567890)
5. Review SMS logs for error details: `/api/sms/logs?status=failed`

### Messages Not Delivered

```bash
# Check delivery status
curl http://localhost:4000/api/sms/logs?status=delivered \
  -H "Authorization: Bearer $TOKEN"

# Get message details from Twilio
curl http://localhost:4000/api/sms/message-status/SM1234567890abcdef \
  -H "Authorization: Bearer $TOKEN"
```

### Scheduled SMS Not Sending

1. Check if quiet hours are active (not between 9 PM - 8 AM by default)
2. Verify message is in pending status: `SELECT * FROM sms_scheduled WHERE status = 'pending';`
3. Check server is running (timers need active process)
4. Review server logs for scheduler errors

## Files Created

```
backend/
├── src/
│   ├── lib/
│   │   ├── sms-service.js              # Twilio client & SMS sending
│   │   ├── sms-templates.js            # Message templates
│   │   ├── sms-scheduler.js            # Schedule messages for later
│   │   └── reservation-sms-service.js  # Reservation lifecycle integration
│   ├── routes/
│   │   ├── sms.js                      # SMS API endpoints
│   │   └── twilio-webhook.js           # Twilio webhook handlers
│   ├── db.js                           # (Updated) Database schema
│   └── server.js                       # (Updated) SMS route integration
├── .env.example                        # (Updated) Twilio config
├── package.json                        # (Updated) Added Twilio dependency
├── SMS_SETUP_GUIDE.md                  # Detailed setup instructions
├── SMS_README.md                       # This file
└── SMS_DASHBOARD.html                  # Park owner management UI
```

## Next Steps

1. **Configure Twilio**: Follow SMS_SETUP_GUIDE.md
2. **Install Dependencies**: `npm install twilio`
3. **Update .env**: Add Twilio credentials
4. **Test Sending**: Call POST /api/sms/send with test reservation
5. **Configure Parks**: Set SMS phone, quiet hours, WiFi info in database
6. **Integrate Hooks**: Add SMS calls in reservation create/cancel endpoints
7. **Set Up Webhooks**: Configure Twilio webhooks for delivery status
8. **Monitor**: Check SMS_DASHBOARD.html and SMS logs regularly

## Support

- **Twilio Docs**: https://www.twilio.com/docs/sms
- **Setup Guide**: See SMS_SETUP_GUIDE.md
- **API Reference**: See endpoint docs in this file
- **Dashboard**: Open SMS_DASHBOARD.html in browser

---

**SMS System Ready!** Your RV park guests will now receive automated confirmations, reminders, and thank you messages. 🚐📱
