# OTA Integration - Quick Reference Guide

## File Locations & Purposes

### Core Framework Files
| File | Purpose | Key Export |
|------|---------|-----------|
| `api/_lib/ota-manager.js` | Abstraction layer for all OTAs | `OTAManager` class |
| `api/_lib/integrations/airbnb.js` | Airbnb API connector | `AirbnbIntegration` class |
| `api/_lib/integrations/booking.js` | Booking.com API connector | `BookingIntegration` class |
| `api/_lib/integrations/vrbo.js` | Vrbo API connector | `VrboIntegration` class |
| `api/_lib/availability-sync.js` | Bidirectional sync engine | `AvailabilitySyncEngine` class |

### Endpoints
| File | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| `api/ota-webhook.js` | `/api/ota-webhook` | POST | Receive booking notifications |
| `api/admin/ota.js` | `/api/admin/ota` | GET/PUT/POST/DELETE | Manage OTA connections |

### Database & UI
| File | Purpose |
|------|---------|
| `api/_lib/reservations-store.js` | Schema extensions (ota_* tables) |
| `OTA_DASHBOARD_SECTION.html` | Park dashboard UI component |

### Documentation
| File | Content |
|------|---------|
| `OTA_INTEGRATION_SETUP.md` | Complete setup & configuration guide (400+ lines) |
| `OTA_FRAMEWORK_SUMMARY.md` | Architecture & design decisions (500+ lines) |
| `OTA_QUICK_REFERENCE.md` | This file - quick lookups |

---

## Environment Variables Required

```bash
# Webhook signature verification
AIRBNB_WEBHOOK_SECRET=your_secret_from_airbnb
BOOKING_WEBHOOK_SECRET=your_secret_from_booking
VRBO_WEBHOOK_SECRET=your_secret_from_vrbo

# Optional - customize API URLs if needed
AIRBNB_API_URL=https://api.airbnb.com/partner/
BOOKING_API_URL=https://secure-supply-api.booking.com/api/
VRBO_API_URL=https://api.vrbo.com/partner/
```

---

## Database Schema Summary

### New Columns in `parks` Table
```sql
airbnb_listing_id TEXT           -- Airbnb property ID
booking_listing_id TEXT          -- Booking.com property ID
vrbo_listing_id TEXT             -- Vrbo rental ID
ota_integration_enabled BOOLEAN  -- Master enable/disable switch
```

### New Tables
```sql
-- Track OTA bookings ingested into your system
ota_bookings (
  id, park_id, ota_name, ota_booking_id, 
  guest_id, linked_reservation_id, pulled_at
)

-- Audit trail of all sync attempts
ota_sync_logs (
  id, park_id, ota_name, sync_type, status, 
  error_msg, synced_at
)

-- Secure credential storage
ota_credentials (
  id, park_id, ota_name, credentials, 
  created_at, updated_at
)
```

**Migration Command** (Postgres):
```sql
-- Run the schema creation from reservations-store.js
-- or manually execute the SQL in OTA_INTEGRATION_SETUP.md
```

---

## API Quick Reference

### Webhook Endpoint
```
POST /api/ota-webhook
Content-Type: application/json

{
  "otaName": "airbnb|booking|vrbo",
  "booking": {
    "parkId": "park-id",
    "otaBookingId": "unique-id-from-ota",
    "guestName": "John Doe",
    "guestEmail": "john@example.com",
    "guestPhone": "+1-555-0100",
    "checkIn": "2026-08-15",
    "checkOut": "2026-08-20",
    "totalPriceCents": 50000,
    "currency": "USD",
    "status": "confirmed"
  },
  "signature": "sha256_hex_of_booking"
}

Response: 200 OK
{
  "success": true,
  "reservationId": "res-xxx",
  "timestamp": "2026-08-11T12:00:00Z"
}
```

### Admin: Sync Rates
```
PUT /api/admin/ota?action=rates
Content-Type: application/json
Authorization: Bearer <staff_token>

{
  "rates": [
    { "date": "2026-08-15", "nightlyRateCents": 15000 },
    { "date": "2026-08-16", "nightlyRateCents": 15500 }
  ],
  "otasToSync": ["airbnb", "booking"],
  "siteId": "site-123"
}

Response: 200 OK
{
  "success": true,
  "ratesCount": 2,
  "otaResults": {
    "airbnb": { "success": true, "datesUpdated": 2 },
    "booking": { "success": true, "datesUpdated": 2 }
  }
}
```

### Admin: Get OTA Status
```
GET /api/admin/ota?action=status
Authorization: Bearer <staff_token>

Response: 200 OK
{
  "success": true,
  "listings": {
    "airbnb": {
      "connected": true,
      "listingId": "123456",
      "status": "active",
      "rating": 4.85,
      "reviewCount": 42,
      "responseRate": 98,
      "photoCount": 25,
      "instantBooking": true,
      "superhost": true,
      "checkedAt": "2026-08-11T12:30:00Z"
    },
    "booking": { "connected": false },
    "vrbo": { "connected": false }
  },
  "lastSyncs": { /* sync history */ }
}
```

### Admin: Connect OTA
```
POST /api/admin/ota?action=connect
Authorization: Bearer <staff_token>

{
  "otaName": "airbnb",
  "listingId": "123456",
  "credentials": {
    "apiKey": "your_api_key",
    "apiUrl": "https://api.airbnb.com/partner/"
  }
}

Response: 200 OK
{
  "success": true,
  "message": "Airbnb connected successfully",
  "listingId": "123456"
}
```

### Admin: Disconnect OTA
```
DELETE /api/admin/ota?action=disconnect
Authorization: Bearer <staff_token>

{
  "otaName": "airbnb"
}

Response: 200 OK
{
  "success": true,
  "message": "Airbnb disconnected successfully"
}
```

### Admin: Get Sync Logs
```
GET /api/admin/ota?action=sync-logs?limit=50&otaName=airbnb&syncType=availability&status=success
Authorization: Bearer <staff_token>

Response: 200 OK
{
  "success": true,
  "count": 5,
  "logs": [
    {
      "id": "log-123",
      "otaName": "airbnb",
      "syncType": "availability",
      "status": "success",
      "errorMsg": null,
      "syncedAt": "2026-08-11T12:30:00Z"
    }
  ]
}
```

---

## Class Usage Examples

### Initialize OTA Manager
```javascript
import OTAManager from 'api/_lib/ota-manager.js';

const otaManager = new OTAManager();

// Initialize Airbnb
await otaManager.initializeOTA('airbnb', {
  apiKey: 'your_airbnb_api_key',
  apiUrl: 'https://api.airbnb.com/partner/'
});

// Check if connected
const isConnected = otaManager.isOTAConnected('airbnb');

// Get all connected OTAs
const connected = otaManager.getConnectedOTAs(); // ['airbnb', 'booking']
```

### Use Sync Engine
```javascript
import { AvailabilitySyncEngine } from 'api/_lib/availability-sync.js';
import { OTAManager } from 'api/_lib/ota-manager.js';

const engine = new AvailabilitySyncEngine(db, otaManager, console);

// Sync availability for a park
const result = await engine.syncParkAvailability('park-123');

// Pull new bookings
const bookingResult = await engine.pullBookingsForPark('park-123');

// Push updated rates
const rateResult = await engine.pushRatesToOTAs('park-123', rates, ['airbnb']);

// Handle new reservation
await engine.handleNewReservation(reservationObject);
```

### Setup Background Jobs
```javascript
import { AvailabilitySyncEngine } from './availability-sync.js';
import { OTAManager } from './ota-manager.js';

const engine = new AvailabilitySyncEngine(db, otaManager);

// Run every 30 minutes
setInterval(async () => {
  const parks = await db.listParks();
  for (const park of parks) {
    if (park.otaIntegrationEnabled) {
      try {
        await engine.syncParkAvailability(park.id);
      } catch (error) {
        console.error(`Sync failed for park ${park.id}:`, error);
        // Send alert to owner
      }
    }
  }
}, 30 * 60 * 1000);

// Run every 15 minutes
setInterval(async () => {
  const parks = await db.listParks();
  for (const park of parks) {
    if (park.otaIntegrationEnabled) {
      try {
        await engine.pullBookingsForPark(park.id);
      } catch (error) {
        console.error(`Booking pull failed for park ${park.id}:`, error);
      }
    }
  }
}, 15 * 60 * 1000);
```

---

## Common Tasks

### Task: Test OTA Connection
```javascript
const integration = otaManager.getIntegration('airbnb');
try {
  const result = await integration.validateCredentials();
  console.log('Connection OK:', result);
} catch (error) {
  console.error('Connection failed:', error.message);
}
```

### Task: Get Listing Status
```javascript
const status = await otaManager.getListingStatus('airbnb', 'listing-123');
console.log(`Rating: ${status.rating}, Reviews: ${status.reviewCount}`);
```

### Task: Query Sync Logs
```javascript
// Get all failed syncs in last 24 hours
const logs = await db.query(`
  SELECT * FROM ota_sync_logs
  WHERE park_id = $1 AND status = 'error'
    AND created_at > now() - interval '24 hours'
  ORDER BY created_at DESC
`, [parkId]);
```

### Task: Check OTA Booking Links
```javascript
// Find OTA booking linked to our reservation
const otaLink = await db.query(`
  SELECT * FROM ota_bookings
  WHERE linked_reservation_id = $1
`, [reservationId]);

if (otaLink.rows[0]) {
  console.log(`Booked via ${otaLink.rows[0].ota_name}`);
}
```

### Task: Force Sync for One Park
```javascript
const engine = new AvailabilitySyncEngine(db, otaManager);
const result = await engine.syncParkAvailability(parkId);
console.log(result);
```

### Task: Get Revenue by OTA
```javascript
const revenue = await db.query(`
  SELECT 
    ob.ota_name,
    COUNT(*) as booking_count,
    COALESCE(SUM(r.total_cents), 0) as total_cents
  FROM ota_bookings ob
  LEFT JOIN reservations r ON ob.linked_reservation_id = r.id
  WHERE ob.park_id = $1
    AND ob.created_at > now() - interval '30 days'
  GROUP BY ob.ota_name
  ORDER BY total_cents DESC
`, [parkId]);
```

---

## Troubleshooting Checklist

### Sync Not Running
- [ ] Check `ota_integration_enabled` is true for park
- [ ] Verify background jobs are running
- [ ] Check logs for errors
- [ ] Verify credentials haven't expired

### Webhooks Not Received
- [ ] Verify endpoint URL is publicly accessible
- [ ] Check firewall allows HTTPS
- [ ] Verify webhook secrets in `.env`
- [ ] Test with OTA's webhook testing tool

### Double Bookings
- [ ] Check last sync time
- [ ] Manually trigger sync
- [ ] Verify no transactional errors
- [ ] Contact OTA support if persistent

### Rate Sync Failing
- [ ] Verify park has OTA connected
- [ ] Check rates are valid (positive integers)
- [ ] Verify dates are in future
- [ ] Review error in `ota_sync_logs`

### Guest Not Found
- [ ] Check guest email in system
- [ ] Verify guest creation in webhook handler
- [ ] Check guest table isn't full
- [ ] Review database error logs

---

## Performance Targets

| Operation | Target Time | Priority |
|-----------|------------|----------|
| Webhook signature verification | <1ms | Critical |
| Webhook booking ingestion | <100ms | High |
| Sync availability for 90 days | <3 seconds per OTA | Medium |
| Pull bookings from past 24h | <2 seconds per OTA | Medium |
| Push rates for 100 dates | <2 seconds per OTA | Medium |
| Status check all OTAs | <5 seconds | Low |

---

## Rate Limiting

### Webhook Endpoint
- **Limit**: 100 requests per minute per OTA
- **Implementation**: In-memory counter (Redis in production)
- **Response**: 429 Too Many Requests

### OTA APIs
- **Airbnb**: 100 requests/minute (built-in retry)
- **Booking.com**: 1000 requests/hour (hourly bucket)
- **Vrbo**: 50 requests/minute (sliding window)

### Retry Strategy
- **Attempts**: 3-4 maximum
- **Backoff**: Exponential (1s, 2s, 4s, 8s)
- **Skip Retries**: On 4xx errors (auth, validation)

---

## Security Checklist

- [ ] Store OTA credentials in `ota_credentials` table (encrypted)
- [ ] Verify webhook signatures (SHA-256 HMAC)
- [ ] Use environment variables for secrets
- [ ] Rate limit webhook endpoint
- [ ] Validate all booking data
- [ ] Never log API credentials
- [ ] Use HTTPS for all API calls
- [ ] Rotate API keys every 90 days
- [ ] Audit all sync operations

---

## Monitoring Dashboard Metrics

Create dashboards to track:

1. **Sync Health**
   - Success rate (target: >99%)
   - Average sync duration
   - Errors per platform

2. **Booking Metrics**
   - Bookings by OTA (count)
   - Revenue by OTA (dollars)
   - Booking volume trends

3. **API Performance**
   - Request latency per platform
   - Error rate by endpoint
   - Rate limit usage

4. **System Health**
   - Webhook delivery latency
   - Database connection pool usage
   - Background job execution time

---

## Support Resources

### Airbnb
- Docs: https://docs.airbnb.com/
- Support: partner-support@airbnb.com
- Webhooks: https://docs.airbnb.com/webhooks

### Booking.com
- Docs: https://partner.booking.com/en-us/help/article/api
- Support: iconnect@booking.com
- Extranet: https://secure-extranet.booking.com/

### Vrbo
- Docs: https://vrbo-developer-docs.herokuapp.com/
- Support: partners@vrbo.com
- Partner: https://www.vrbo.com/seller/en-us/developer-api

---

## Next Steps

1. **Read** `OTA_INTEGRATION_SETUP.md` for complete setup
2. **Create** Airbnb Partner account and get API key
3. **Create** Booking.com account and get credentials
4. **Create** Vrbo account and get credentials
5. **Deploy** framework to staging
6. **Test** each OTA individually
7. **Monitor** sync logs for first week
8. **Document** any customizations for your use case
9. **Train** staff on OTA dashboard
10. **Monitor** revenue attribution weekly

---

**Last Updated**: 2026-08-11  
**Framework Version**: 1.0  
**Status**: Production Ready
