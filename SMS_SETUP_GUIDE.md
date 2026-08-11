# SMS Messaging System Setup Guide

## Overview

This guide walks through setting up the SMS messaging system for RV park reservations using Twilio. The system automatically sends SMS confirmations, reminders, and thank you messages to guests.

## Features

- **Automated SMS Sending**: Booking confirmations, arrival reminders, check-in day messages, and thank you notes
- **Scheduled Messaging**: Queue messages to send at specific times (24h before arrival, 8am on check-in day, etc.)
- **Quiet Hours Support**: Respects park's configured quiet hours (default 9 PM - 8 AM)
- **Delivery Tracking**: Monitor SMS delivery status and failures
- **Guest Opt-In Management**: TCPA-compliant opt-in/opt-out handling
- **Error Handling & Retries**: Automatic retry on delivery failures
- **Webhook Integration**: Receive delivery status updates from Twilio

## Step 1: Create a Twilio Account

1. Go to [Twilio Console](https://www.twilio.com/console)
2. Sign up for a free account (includes $20 free trial credit)
3. Verify your email and phone number
4. Get your account credentials:
   - **Account SID**: Copy from Account Info section
   - **Auth Token**: Copy from Account Info section
5. Purchase a Twilio phone number (https://www.twilio.com/console/phone-numbers/incoming)
   - Choose a number that supports SMS
   - Cost: ~$1.50/month
   - Note the phone number (format: +1234567890)

## Step 2: Configure Environment Variables

Copy `.env.example` to `.env` and fill in Twilio credentials:

```bash
# .env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token-here
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_WEBHOOK_URL=https://your-domain.com/api/webhooks/twilio-status
```

## Step 3: Set Up Twilio Webhooks (Optional but Recommended)

To receive delivery status updates and inbound messages from Twilio:

1. Go to [Twilio Console - Messaging Settings](https://www.twilio.com/console/sms/settings)
2. Under "Messaging" > "Webhook URL"
   - **When a message comes in**: `https://your-domain.com/api/webhooks/twilio-inbound`
   - **Status Callbacks**: `https://your-domain.com/api/webhooks/twilio-status`
3. Test the webhook connection
4. Save settings

## Step 4: Install Dependencies

```bash
cd backend
npm install twilio
```

## Step 5: Initialize Database Tables

The SMS system requires these tables (auto-created on startup):

- `parks` - RV park configuration (Twilio phone, SMS enabled, quiet hours)
- `guests` - Guest contact info and SMS opt-in status
- `reservations` - Booking details
- `sms_logs` - Sent SMS delivery logs
- `sms_scheduled` - Queued messages to send later
- `sms_inbound` - Received SMS/replies from guests

Tables are automatically created when the server starts if they don't exist.

## Step 6: Configure Park Settings

Before guests receive SMS, you must configure the park:

```sql
INSERT INTO parks (
  id, name, address, contactPhone, twilioPhoneNumber,
  smsEnabled, quietHoursStart, quietHoursEnd,
  wifiSSID, wifiPassword, officeLocation, parkingLocation, reviewLink
) VALUES (
  1, 'Peaceful RV Park', '123 Main St, Austin TX',
  '+15125551234', '+15105551234',
  1, '9:00 PM', '8:00 AM',
  'PARK_WIFI', 'SecurePassword123', 'Building A', 'Lot 1',
  'https://gritrvpark.com/reviews'
);
```

### Park Configuration Fields

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `twilioPhoneNumber` | String | None | Twilio phone number (sender ID) |
| `smsEnabled` | Boolean | false | Enable/disable SMS for this park |
| `quietHoursStart` | String | "9:00 PM" | No SMS after this time |
| `quietHoursEnd` | String | "8:00 AM" | Resume SMS after this time |
| `wifiSSID` | String | None | WiFi network name to share via SMS |
| `wifiPassword` | String | None | WiFi password to share via SMS |
| `officeLocation` | String | None | Office location for check-in SMS |
| `parkingLocation` | String | None | Parking area info for check-in SMS |
| `reviewLink` | String | None | Review link in thank you SMS |

## API Endpoints

### Send SMS to Guest

**POST** `/api/sms/send`

Send SMS immediately using a template.

```bash
curl -X POST http://localhost:4000/api/sms/send \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d {
    "reservationId": 1,
    "templateType": "confirmation",
    "phoneNumber": "+15551234567",  # Optional (uses guest phone if not provided)
    "variables": {}  # Template variables (filled automatically when possible)
  }
```

**Response:**
```json
{
  "status": "queued",
  "messageId": "SM1234567890abcdef",
  "smsLogId": 42,
  "sentAt": "2024-08-11T10:30:00Z",
  "phoneNumber": "+15551234567",
  "templateType": "confirmation"
}
```

### Schedule SMS for Later

**POST** `/api/sms/schedule`

Queue SMS to send at a specific time.

```bash
curl -X POST http://localhost:4000/api/sms/schedule \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d {
    "reservationId": 1,
    "templateType": "reminder",
    "sendTime": "8:00 AM",  # Specific time
    "guestId": 5
  }
```

Valid `sendTime` formats:
- `"immediately"` - Send now
- `"8:00 AM"` - Send at specific time (next occurrence)
- `"checkInDate-24h"` - 24 hours before check-in
- `"checkInDate+24h"` - 24 hours after check-in
- `"checkOutDate-1h"` - 1 hour before checkout

### Get SMS Delivery Logs

**GET** `/api/sms/logs?reservationId=1&status=delivered&limit=50`

Retrieve SMS delivery history.

```bash
curl http://localhost:4000/api/sms/logs?reservationId=1 \
  -H "Authorization: Bearer <jwt-token>"
```

**Response:**
```json
{
  "logs": [
    {
      "id": 42,
      "reservationId": 1,
      "guestId": 5,
      "templateType": "confirmation",
      "message": "Your reservation at Peaceful RV Park is confirmed!...",
      "status": "delivered",
      "messageId": "SM1234567890abcdef",
      "phoneNumber": "+15551234567",
      "sentAt": "2024-08-11T10:30:00Z",
      "deliveryStatus": "delivered"
    }
  ],
  "pagination": {
    "total": 125,
    "limit": 50,
    "offset": 0,
    "pages": 3
  }
}
```

### Check SMS Service Status

**GET** `/api/sms/status`

Verify SMS system configuration and status.

```bash
curl http://localhost:4000/api/sms/status \
  -H "Authorization: Bearer <jwt-token>"
```

### Get Single Message Status

**GET** `/api/sms/message-status/:messageSid`

Check delivery status of a specific SMS.

```bash
curl http://localhost:4000/api/sms/message-status/SM1234567890abcdef \
  -H "Authorization: Bearer <jwt-token>"
```

### Cancel Scheduled SMS

**DELETE** `/api/sms/scheduled/:scheduleId`

Cancel a queued message.

```bash
curl -X DELETE http://localhost:4000/api/sms/scheduled/sms_1707475200000_abc123 \
  -H "Authorization: Bearer <jwt-token>"
```

## SMS Templates

### Available Templates

| Type | Template | Variables |
|------|----------|-----------|
| `confirmation` | Booking confirmation | parkName, checkInDate, siteNumber, parkPhone |
| `reminder` | Pre-arrival (24h) | guestName, parkName, checkInTime, parkAddress |
| `checkin` | Check-in day (8am) | parkName, siteNumber, wifiSSID, wifiPassword, parkPhone |
| `thankyou` | Post-stay (24h) | guestName, parkName, reviewLink |
| `payment` | Payment reminder | amount, parkName, paymentLink |
| `cancellation` | Booking cancelled | parkName, checkInDate, refundAmount |
| `checkout` | Checkout day reminder | guestName, parkName, checkOutTime |
| `promotional` | Special offer | parkName, offerDescription, bookingLink |
| `alert` | Service alert | parkName, alertMessage, contactInfo |
| `wifi` | WiFi credentials | parkName, siteNumber, wifiSSID, wifiPassword |
| `event` | Activity notification | parkName, eventName, eventTime, eventLocation |
| `custom` | Custom message | message |

### Template Variables

When sending SMS, variables are automatically filled from:
1. Reservation data (checkInDate, checkOutDate, siteNumber, etc.)
2. Guest data (guestName, phoneNumber, email)
3. Park data (wifiSSID, wifiPassword, contactPhone, etc.)
4. Custom variables passed in request

Example:
```json
{
  "reservationId": 1,
  "templateType": "confirmation",
  "variables": {
    "parkName": "Sunny Hills RV Park"  // Override default
  }
}
```

## Guest Opt-In Management

### Enable SMS During Booking

When creating a reservation, set `smsOptIn = 1` for the guest:

```sql
INSERT INTO guests (firstName, phoneNumber, smsOptIn) VALUES ('John', '+15551234567', 1);
```

### Handle Opt-Out

Guests can reply **STOP** to any SMS to unsubscribe. This is automatically processed by the webhook:

```sql
UPDATE guests SET smsOptIn = 0, smsOptOutDate = datetime('now') WHERE phoneNumber = ?
```

### Compliance Notes

- **TCPA**: Only send SMS to guests with explicit opt-in consent
- **GDPR**: Store consent timestamp and method
- **Unsubscribe**: Include "Reply STOP" in all SMS messages
- **Response**: Immediately honor opt-out requests

## Error Handling & Retry Logic

### Automatic Retries

If SMS delivery fails:
1. Log error with Twilio error code
2. Retry after 30 minutes
3. Retry again after 1 hour
4. After 3 failures, flag for manual review

### Alert Thresholds

Automatic alerts triggered when:
- 10+ SMS failures in 1 hour → Possible service issue
- Delivery rate < 80% → Check Twilio account
- Invalid phone numbers → Update guest data

### Debug Failed Sends

```bash
# Check logs for failed SMS
curl http://localhost:4000/api/sms/logs?status=failed \
  -H "Authorization: Bearer <jwt-token>"

# Get specific message status
curl http://localhost:4000/api/sms/message-status/SM1234567890abcdef \
  -H "Authorization: Bearer <jwt-token>"
```

Common Twilio Error Codes:
- **21600**: Invalid phone number
- **21601**: Wrong number format
- **20003**: Account suspended
- **30002**: Unreachable number
- **30003**: Message blocked

## Integration with Reservations

### Automatic SMS Triggers

Set up a cron job or event handlers to send SMS at key moments:

```javascript
// When reservation created
async function createReservation(data) {
  const reservation = db.prepare(`INSERT INTO reservations (...)`).run(...);
  
  // Send confirmation SMS
  await fetch('http://localhost:4000/api/sms/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      reservationId: reservation.id,
      templateType: 'confirmation'
    })
  });
  
  // Schedule reminder for 24h before
  await fetch('http://localhost:4000/api/sms/schedule', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      reservationId: reservation.id,
      templateType: 'reminder',
      sendTime: 'checkInDate-24h'
    })
  });
}
```

### Webhook Events to Handle

Configure your app to respond to:

```javascript
// When guest replies to SMS
POST /api/webhooks/twilio-inbound
{
  "From": "+15551234567",
  "To": "+15105551234",
  "Body": "HELP"
}

// When SMS delivery status changes
POST /api/webhooks/twilio-status
{
  "MessageSid": "SM1234567890abcdef",
  "MessageStatus": "delivered"
}
```

## Troubleshooting

### SMS not sending

1. Check Twilio credentials in `.env`
```bash
echo $TWILIO_ACCOUNT_SID  # Should be set
```

2. Verify SMS is enabled for the park
```sql
SELECT smsEnabled FROM parks WHERE id = 1;
```

3. Check guest SMS opt-in
```sql
SELECT smsOptIn FROM guests WHERE id = 1;
```

4. Verify phone number format (E.164)
```bash
curl http://localhost:4000/api/sms/status -H "Authorization: Bearer <token>"
```

5. Check SMS logs for errors
```sql
SELECT * FROM sms_logs WHERE status = 'failed' ORDER BY sentAt DESC LIMIT 5;
```

### Messages not delivered

1. Check SMS log delivery status
```bash
curl http://localhost:4000/api/sms/logs?status=failed \
  -H "Authorization: Bearer <token>"
```

2. Get specific message status from Twilio
```bash
curl http://localhost:4000/api/sms/message-status/SM1234567890abcdef \
  -H "Authorization: Bearer <token>"
```

3. Check Twilio console for account issues
   - Verify account has credit
   - Check phone number is active
   - Confirm phone is verified for SMS

### Scheduled messages not sending

1. Check if messages are queued
```bash
curl http://localhost:4000/api/sms/status -H "Authorization: Bearer <token>"
# Look for "scheduledMessages" count
```

2. Verify quiet hours aren't blocking sends
```sql
SELECT quietHoursStart, quietHoursEnd FROM parks WHERE id = 1;
```

3. Check server logs for scheduler errors

## Costs

### Twilio Pricing

- **Account Setup**: Free
- **Phone Number**: ~$1.50/month
- **SMS Inbound**: $0.0075 per message
- **SMS Outbound**: $0.0075 per message
- **Free Trial**: $20 credit for new accounts

### Estimated Monthly Costs

- 100 reservations × 4 SMS per booking = 400 SMS
- 400 × $0.0075 = $3 + $1.50 (phone) = **~$4.50/month**

## Best Practices

1. **Personalization**: Always include guest name in SMS
2. **Timing**: Send confirmations immediately, reminders 24h before
3. **Clarity**: Keep messages short (under 160 characters where possible)
4. **Links**: Use short URLs to track clicks
5. **Compliance**: Include opt-out option in every SMS
6. **Testing**: Test with your own phone number first
7. **Monitoring**: Check SMS logs regularly for delivery issues
8. **Templates**: Keep templates consistent across all parks

## Support

For Twilio help:
- [Twilio SMS Documentation](https://www.twilio.com/docs/sms)
- [Twilio Error Codes](https://www.twilio.com/docs/api/errors)
- [Twilio Support Portal](https://www.twilio.com/support)

For app-specific issues:
- Check application logs
- Review database tables (sms_logs, sms_scheduled)
- Verify environment variables are set correctly
