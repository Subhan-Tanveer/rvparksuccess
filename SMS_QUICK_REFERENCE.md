# SMS System Quick Reference Card

## Installation (2 minutes)

```bash
cd backend
npm install twilio
cp .env.example .env

# Edit .env - Add your Twilio credentials:
# TWILIO_ACCOUNT_SID=ACxxxxxxxx...
# TWILIO_AUTH_TOKEN=your-token...
# TWILIO_PHONE_NUMBER=+1234567890

npm start
```

## Getting Twilio Credentials (5 minutes)

1. Sign up: https://www.twilio.com/console
2. Copy Account SID & Auth Token
3. Buy SMS phone: https://www.twilio.com/console/phone-numbers/incoming
4. Add to .env

**Cost**: ~$1.50/month (phone) + $0.0075/SMS (about $4/month for 100 reservations)

## API Endpoints

### Send SMS Now
```bash
curl -X POST http://localhost:4000/api/sms/send \
  -H "Authorization: Bearer $JWT" \
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

### Schedule SMS Later
```bash
curl -X POST http://localhost:4000/api/sms/schedule \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "reservationId": 1,
    "templateType": "reminder",
    "sendTime": "8:00 AM"
  }'
```

Send Time Options:
- `"immediately"` - Send now
- `"8:00 AM"` - Send at specific time
- `"checkInDate-24h"` - 24h before check-in
- `"checkOutDate+24h"` - 24h after checkout

### Get SMS Logs
```bash
curl http://localhost:4000/api/sms/logs?status=delivered \
  -H "Authorization: Bearer $JWT"
```

### Check SMS Status
```bash
curl http://localhost:4000/api/sms/status \
  -H "Authorization: Bearer $JWT"
```

### Get Single Message Status
```bash
curl http://localhost:4000/api/sms/message-status/SM1234567890abcdef \
  -H "Authorization: Bearer $JWT"
```

### Cancel Scheduled SMS
```bash
curl -X DELETE http://localhost:4000/api/sms/scheduled/sms_1707475200000_abc123 \
  -H "Authorization: Bearer $JWT"
```

## Message Templates

| Type | When | Variables |
|------|------|-----------|
| `confirmation` | Immediately | parkName, checkInDate, siteNumber |
| `reminder` | 24h before | guestName, parkName, checkInTime |
| `checkin` | Check-in day 8am | parkName, siteNumber, wifiSSID, wifiPassword |
| `thankyou` | 24h after checkout | guestName, parkName, reviewLink |
| `payment` | On demand | amount, parkName, paymentLink |
| `cancellation` | Immediately | parkName, checkInDate, refundAmount |
| `checkout` | Checkout day | guestName, parkName, checkOutTime |
| `promotional` | On demand | parkName, offerDescription, bookingLink |
| `alert` | On demand | parkName, alertMessage, contactInfo |
| `wifi` | On demand | wifiSSID, wifiPassword, siteNumber |
| `event` | On demand | eventName, eventTime, eventLocation |
| `custom` | On demand | message |

## Database Tables

### parks
- `twilioPhoneNumber` - Twilio phone (sender ID)
- `smsEnabled` - Enable SMS (1/0)
- `quietHoursStart` - Don't send after (default: 9:00 PM)
- `quietHoursEnd` - Resume at (default: 8:00 AM)
- `wifiSSID`, `wifiPassword` - WiFi to share
- `reviewLink` - Review URL

### guests
- `phoneNumber` - Guest phone (E.164: +1234567890)
- `smsOptIn` - Allow SMS (1/0)
- `smsOptOutDate` - When opted out

### reservations
- `parkId` - Which park
- `guestId` - Which guest
- `checkInDate`, `checkOutDate` - Dates
- `siteNumber` - Which site
- `depositAmount` - Money owed

### sms_logs
- `reservationId`, `guestId` - Who
- `templateType` - Message type
- `status` - queued, sent, delivered, failed
- `messageId` - Twilio SID
- `sentAt`, `errorCode` - When & error details

### sms_scheduled
- `schedule_id` - Unique ID
- `send_time` - When to send
- `status` - pending, sent, failed, cancelled

### sms_inbound
- `from_number` - Guest phone
- `message` - What they said
- `received_at` - When

## Common Tasks

### Send Confirmation SMS
```javascript
// In your reservation creation endpoint
await fetch('http://localhost:4000/api/sms/send', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    reservationId: reservation.id,
    templateType: 'confirmation'
  })
});
```

### Schedule Reminder (24h before)
```javascript
await fetch('http://localhost:4000/api/sms/schedule', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    reservationId: reservation.id,
    templateType: 'reminder',
    sendTime: 'checkInDate-24h'
  })
});
```

### Send Alert to All Guests
```javascript
const activeGuests = db.prepare(`
  SELECT DISTINCT g.* FROM guests g
  JOIN reservations r ON g.id = r.guestId
  WHERE r.parkId = ?
    AND g.smsOptIn = 1
    AND date(r.checkInDate) <= date('now')
    AND date(r.checkOutDate) >= date('now')
`).all(parkId);

for (const guest of activeGuests) {
  await fetch('http://localhost:4000/api/sms/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      reservationId: guest.reservationId,
      templateType: 'alert',
      guestId: guest.id,
      variables: { alertMessage: 'WiFi down, ETA 30min' }
    })
  });
}
```

### Check Delivery Rate
```sql
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
  ROUND(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as rate
FROM sms_logs
WHERE strftime('%Y-%m', sentAt) = strftime('%Y-%m', 'now');
```

### Get Failed SMS
```sql
SELECT * FROM sms_logs
WHERE status = 'failed'
ORDER BY sentAt DESC
LIMIT 10;
```

## Troubleshooting

### SMS Not Sending?
1. Check Twilio credentials: `echo $TWILIO_ACCOUNT_SID`
2. Verify SMS enabled: `SELECT smsEnabled FROM parks WHERE id = 1;`
3. Check guest opted in: `SELECT smsOptIn FROM guests WHERE id = 1;`
4. Verify phone format: Must be +1234567890 (E.164)
5. Check logs: `curl http://localhost:4000/api/sms/logs?status=failed`

### Messages Not Delivered?
1. Check status: `SELECT status FROM sms_logs WHERE id = 42;`
2. Get error: `SELECT errorCode, errorMessage FROM sms_logs WHERE status = 'failed';`
3. Twilio status: `curl http://localhost:4000/api/sms/message-status/SM1234567890`
4. Check Twilio console for account issues

### Scheduled SMS Not Sending?
1. Check database: `SELECT COUNT(*) FROM sms_scheduled WHERE status = 'pending';`
2. Check quiet hours: `SELECT quietHoursStart, quietHoursEnd FROM parks WHERE id = 1;`
3. Server must be running (timers need active process)
4. Check logs for scheduler errors

## Error Codes

| Code | Meaning | Fix |
|------|---------|-----|
| 21600 | Invalid phone | Verify format: +1234567890 |
| 21601 | Wrong format | Use E.164 format |
| 20003 | Account suspended | Check Twilio console |
| 30002 | Unreachable | Number doesn't support SMS |
| 30003 | Message blocked | Try different wording |

## Performance Tips

1. **Batch Operations**: Loop through guests, send individual SMS
2. **Async Await**: Use await to ensure SMS logged before returning
3. **Rate Limit**: System handles 60 SMS/minute (Twilio limit)
4. **Quiet Hours**: Set sensible hours (e.g., 9pm-8am)
5. **Monitoring**: Check SMS logs weekly for failures
6. **Testing**: Test with your own phone first

## Security

- All endpoints require JWT authentication
- Phone numbers validated before sending
- Respects guest opt-in/opt-out status
- Errors logged without exposing numbers
- Rate limiting prevents abuse
- Webhook signatures validated (optional setup)

## Documentation Files

| File | Purpose | Read Time |
|------|---------|-----------|
| SMS_SETUP_GUIDE.md | Twilio setup walkthrough | 20 min |
| SMS_README.md | System reference & architecture | 15 min |
| INTEGRATION_EXAMPLES.md | Code examples for common tasks | 15 min |
| SMS_IMPLEMENTATION_SUMMARY.md | Feature inventory | 10 min |
| SMS_FILES_CHECKLIST.md | Verify files created | 5 min |
| SMS_QUICK_REFERENCE.md | This cheat sheet | 5 min |
| SMS_DASHBOARD.html | Admin UI for SMS management | - |

## Key Files

- **Core**: `src/lib/sms-service.js`, `sms-templates.js`, `sms-scheduler.js`
- **API**: `src/routes/sms.js`
- **Webhooks**: `src/routes/twilio-webhook.js`
- **Database**: `src/db.js` (auto-creates tables)
- **Config**: `.env` (add your credentials here)

## One-Line Commands

```bash
# Install dependencies
npm install twilio

# Check if configured
curl http://localhost:4000/api/sms/status -H "Authorization: Bearer $JWT"

# Get delivery stats
curl http://localhost:4000/api/sms/logs -H "Authorization: Bearer $JWT"

# List pending scheduled messages
sqlite3 grit.sqlite "SELECT COUNT(*) FROM sms_scheduled WHERE status = 'pending';"

# View SMS dashboard
open SMS_DASHBOARD.html
```

## Pricing Breakdown

For 100 reservations with 4 SMS each:
- SMS: 400 × $0.0075 = **$3.00**
- Phone number: **$1.50**
- **Total: ~$4.50/month**

With free $20 trial credit, SMS is free for your first ~3 months.

## Next Steps

1. ✅ Install Twilio SDK
2. ✅ Get Twilio credentials
3. ✅ Update .env file
4. ✅ Start backend server
5. ✅ Test SMS endpoint
6. ✅ Configure parks table
7. ✅ Integrate with reservation endpoints
8. ✅ Set up webhooks (optional)
9. ✅ Monitor SMS logs

## Help & Support

- **Twilio Docs**: https://www.twilio.com/docs/sms
- **Error Reference**: https://www.twilio.com/docs/api/errors
- **Twilio Support**: https://www.twilio.com/support
- **Setup Guide**: See SMS_SETUP_GUIDE.md in this directory
- **Code Examples**: See INTEGRATION_EXAMPLES.md

---

**SMS System Ready to Deploy! 🚀📱**

Print this card or save to your phone for quick reference during implementation.
