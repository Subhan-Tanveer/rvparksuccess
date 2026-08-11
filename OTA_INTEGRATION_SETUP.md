# OTA Integration Framework - Setup & Configuration Guide

This document covers the complete OTA (Online Travel Agency) integration framework for RVPark, including setup instructions for Airbnb, Booking.com, and Vrbo.

## Overview

The OTA Integration Framework enables automatic syncing of:
- Calendar availability between your system and OTA platforms
- Booking ingestion from OTAs into your reservation system
- Nightly rate updates across all connected platforms
- Listing status monitoring and analytics

## Architecture

### Core Components

1. **OTA Manager** (`api/_lib/ota-manager.js`)
   - Abstraction layer for different OTA platforms
   - Standardized interface for all OTA operations
   - Handles multi-platform sync coordination

2. **OTA Integrations**
   - `api/_lib/integrations/airbnb.js` - Airbnb Partner API
   - `api/_lib/integrations/booking.js` - Booking.com Extranet API
   - `api/_lib/integrations/vrbo.js` - Vrbo Partner API

3. **Availability Sync Engine** (`api/_lib/availability-sync.js`)
   - Bidirectional calendar synchronization
   - Prevents double-booking across platforms
   - Scheduled sync jobs (30-minute intervals recommended)
   - Error handling and retry logic

4. **Webhook Receiver** (`api/ota-webhook.js`)
   - Receives booking notifications from OTAs
   - Validates webhook signatures for security
   - Automatically creates reservations in system
   - Sends confirmation emails

5. **Admin API** (`api/admin/ota.js`)
   - Rate syncing to all OTAs
   - OTA connection management
   - Sync logs and status monitoring

## Database Schema

### New Columns in `parks` Table
```sql
airbnb_listing_id TEXT
booking_listing_id TEXT
vrbo_listing_id TEXT
ota_integration_enabled BOOLEAN DEFAULT false
```

### New Tables

#### `ota_bookings`
Tracks bookings ingested from OTA platforms
```sql
CREATE TABLE ota_bookings (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL,
  ota_name TEXT NOT NULL,
  ota_booking_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  linked_reservation_id TEXT,
  pulled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `ota_sync_logs`
Logs all OTA synchronization attempts
```sql
CREATE TABLE ota_sync_logs (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL,
  ota_name TEXT NOT NULL,
  sync_type TEXT NOT NULL, -- 'availability', 'booking-pull', 'rate-push'
  status TEXT NOT NULL, -- 'success', 'error'
  error_msg TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `ota_credentials`
Stores encrypted OTA API credentials
```sql
CREATE TABLE ota_credentials (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL,
  ota_name TEXT NOT NULL,
  credentials TEXT NOT NULL, -- Encrypted JSON
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Setup Instructions

### Prerequisites

1. Park owner account created and verified
2. Access to park dashboard
3. OTA partner account(s) created

### Step 1: Set Up Airbnb Integration

#### Create Airbnb Partner Account

1. Visit [Airbnb for Business](https://www.airbnb.com/business)
2. Create a Partner account
3. Go to Account Settings → API Credentials
4. Request API access:
   - Application: "RVPark Booking Integration"
   - Scope: calendar, listings, reservations
5. Save your API key and Account ID

#### Configure in Dashboard

1. Go to Park Dashboard → Marketplace Connections
2. Click "Connect Airbnb"
3. OAuth flow will open
   - Click "Authorize App"
   - Grant permission to access your listings
4. Select the Airbnb listing ID you want to link:
   - List ID format: `12345678` (numeric)
   - Verify the listing name matches your site

5. Paste API credentials:
```json
{
  "apiKey": "your_airbnb_api_key",
  "apiUrl": "https://api.airbnb.com/partner/"
}
```

6. Click "Test Connection" to verify
7. Click "Save and Enable"

#### Webhook Setup for Airbnb

1. In Airbnb Partner Dashboard, go to Webhooks
2. Add new webhook endpoint:
   - URL: `https://yoursite.com/api/ota-webhook`
   - Events: Reservation created, updated, cancelled
3. Copy the webhook secret
4. Add to `.env`:
   ```
   AIRBNB_WEBHOOK_SECRET=your_secret_here
   ```

### Step 2: Set Up Booking.com Integration

#### Create Booking.com Account

1. Visit [Booking.com for Business](https://partner.booking.com)
2. Create Partner account (if not existing)
3. Go to Settings → Extranet API
4. Request API access:
   - Account ID: Your Booking.com property account ID
   - API Key: Request from support@booking.com
5. Note your credentials

#### Configure in Dashboard

1. Go to Park Dashboard → Marketplace Connections
2. Click "Connect Booking.com"
3. Enter credentials:
   - Account ID (numeric)
   - API Key (from email)
   - Hotel ID / Property ID

4. Test connection
5. Select property listing to link
6. Save and enable

#### Webhook Setup for Booking.com

1. In Booking.com Extranet, go to Settings → API Notifications
2. Configure webhook:
   - Endpoint: `https://yoursite.com/api/ota-webhook`
   - Events: New booking, cancellation
3. Save webhook secret in `.env`:
   ```
   BOOKING_WEBHOOK_SECRET=your_secret_here
   ```

### Step 3: Set Up Vrbo Integration

#### Create Vrbo Account

1. Visit [Vrbo for Owners](https://www.vrbo.com/seller/en-us/become-an-owner)
2. Create property listing
3. Go to Account Settings → API Access
4. Request Partner credentials:
   - Partner ID
   - API Key
   - Redirect URIs: `https://yoursite.com/api/oauth/vrbo/callback`

#### Configure in Dashboard

1. Go to Park Dashboard → Marketplace Connections
2. Click "Connect Vrbo"
3. OAuth redirect will occur
4. Grant permission to access property
5. Enter Rental ID from Vrbo
6. Save credentials
7. Test connection
8. Enable sync

#### Webhook Setup for Vrbo

1. In Vrbo Partner Dashboard, set webhooks:
   - Endpoint: `https://yoursite.com/api/ota-webhook`
   - Events: Booking notifications
2. Save secret in `.env`:
   ```
   VRBO_WEBHOOK_SECRET=your_secret_here
   ```

## API Endpoints

### OTA Webhook
```
POST /api/ota-webhook
```

Receives booking notifications from OTA platforms. Validates webhook signature and creates reservations.

**Example Payload:**
```json
{
  "otaName": "airbnb",
  "booking": {
    "parkId": "park-123",
    "otaBookingId": "airbnb-res-456",
    "guestName": "John Doe",
    "guestEmail": "john@example.com",
    "guestPhone": "+1-555-0100",
    "checkIn": "2026-08-15",
    "checkOut": "2026-08-20",
    "totalPriceCents": 50000,
    "currency": "USD",
    "status": "confirmed"
  },
  "signature": "sha256_hex_signature"
}
```

### Admin OTA Management

#### Sync Rates
```
PUT /api/admin/ota?action=rates
```

Pushes updated rates to connected OTAs.

**Request:**
```json
{
  "rates": [
    { "date": "2026-08-15", "nightlyRateCents": 15000 },
    { "date": "2026-08-16", "nightlyRateCents": 15500 }
  ],
  "otasToSync": ["airbnb", "booking"],
  "siteId": "site-123"
}
```

#### Get OTA Status
```
GET /api/admin/ota?action=status
```

Returns connection status and health of all OTA listings.

**Response:**
```json
{
  "success": true,
  "listings": {
    "airbnb": {
      "connected": true,
      "listingId": "123456",
      "status": "active",
      "rating": 4.85,
      "reviewCount": 42,
      "lastSyncAt": "2026-08-11T12:30:00Z"
    },
    "booking": {
      "connected": false
    }
  }
}
```

#### Get Sync Logs
```
GET /api/admin/ota?action=sync-logs&limit=50&otaName=airbnb
```

Returns synchronization history for debugging.

#### Connect OTA
```
POST /api/admin/ota?action=connect
```

**Request:**
```json
{
  "otaName": "airbnb",
  "listingId": "123456",
  "credentials": {
    "apiKey": "your_api_key",
    "apiUrl": "https://api.airbnb.com/partner/"
  }
}
```

#### Disconnect OTA
```
DELETE /api/admin/ota?action=disconnect
```

**Request:**
```json
{
  "otaName": "airbnb"
}
```

## Automatic Sync Configuration

### Scheduled Availability Sync

Add this to your background job scheduler (e.g., node-cron, AWS Lambda, etc.):

```javascript
// Sync every 30 minutes
const syncEngine = new AvailabilitySyncEngine(db, otaManager);

setInterval(async () => {
  const parks = await db.listParks();
  for (const park of parks) {
    if (park.otaIntegrationEnabled) {
      try {
        await syncEngine.syncParkAvailability(park.id);
      } catch (error) {
        console.error(`Sync failed for park ${park.id}:`, error);
        // Send alert to owner
      }
    }
  }
}, 30 * 60 * 1000);
```

### Scheduled Booking Pull

Pull new bookings every 15 minutes:

```javascript
setInterval(async () => {
  const parks = await db.listParks();
  for (const park of parks) {
    if (park.otaIntegrationEnabled) {
      try {
        await syncEngine.pullBookingsForPark(park.id);
      } catch (error) {
        console.error(`Booking pull failed for park ${park.id}:`, error);
      }
    }
  }
}, 15 * 60 * 1000);
```

## Error Handling & Retries

### Retry Strategy

The framework uses exponential backoff for failed OTA API calls:
- Attempt 1: Immediate
- Attempt 2: 1 second delay
- Attempt 3: 2 second delay
- Attempt 4: 4 second delay (default max)

### Alert Owner on Failures

If sync fails 3 times in a row, send email alert:

```javascript
async function alertOwnerOnSyncFailure(park, otaName, error) {
  const subject = `OTA Sync Failed: ${otaName}`;
  const body = `
    Synchronization with ${otaName} failed for your park "${park.name}".
    Error: ${error.message}
    
    Please check your API credentials in the dashboard and try again.
  `;
  await sendEmail(park.ownerEmail, subject, body);
}
```

## Security Considerations

### API Credential Storage

1. **Encrypt at Rest**: Store credentials in `ota_credentials` table as encrypted JSON
2. **Encrypt in Transit**: Always use HTTPS for all OTA API calls
3. **Rotate Regularly**: Recommend owners rotate API keys every 90 days
4. **Scope Minimally**: Request only necessary API permissions

### Webhook Security

1. **Verify Signatures**: All webhooks must have valid SHA-256 signatures
2. **Rate Limiting**: Webhook endpoint enforces 100 requests/minute
3. **Validate Data**: All booking data is validated before processing
4. **Log All Events**: All webhook events logged to `ota_sync_logs`

### Rate Limiting

OTA API calls include built-in rate limiting:
- Airbnb: 100 requests/minute (built-in retry with backoff)
- Booking.com: 1000 requests/hour (implement hourly bucket)
- Vrbo: 50 requests/minute (implement sliding window)

## Troubleshooting

### Sync Not Running

1. Check if OTA is connected:
   ```
   GET /api/admin/ota?action=status
   ```
2. Verify credentials haven't expired
3. Check `ota_sync_logs` table for error messages
4. Review background job logs

### Webhooks Not Received

1. Verify webhook URL is accessible from internet
2. Check firewall/security group allows inbound HTTPS
3. Verify webhook signature secret in `.env`
4. Test with OTA partner's webhook testing tool

### Double Bookings

1. OTA sync failed to mark dates unavailable
2. Check `ota_sync_logs` for sync errors
3. Manually sync availability from dashboard
4. Contact OTA support if persistent

### Rate Sync Not Working

1. Verify park has OTA connected
2. Check `ota_sync_logs` for errors
3. Verify rate amounts are valid (positive integers)
4. Confirm dates are in future

## Monitoring & Analytics

### Dashboard Metrics

The OTA Marketplace Connections section shows:
- Connection status for each OTA
- Total bookings from each OTA (this month/year)
- Revenue attribution (% of bookings from each platform)
- Last sync time and status
- Listing health metrics (rating, reviews, response rate)

### Sync Logs Analysis

Query sync logs for troubleshooting:

```javascript
// Get all failed syncs in last 24 hours
await db.query(`
  SELECT * FROM ota_sync_logs
  WHERE park_id = $1
    AND status = 'error'
    AND created_at > now() - interval '24 hours'
  ORDER BY created_at DESC
`, [parkId]);

// Get sync performance by OTA
await db.query(`
  SELECT
    ota_name,
    COUNT(*) as total_syncs,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
    ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*)) as success_rate
  FROM ota_sync_logs
  WHERE park_id = $1
    AND created_at > now() - interval '7 days'
  GROUP BY ota_name
`, [parkId]);
```

## Support & Resources

### Airbnb
- [Partner API Docs](https://docs.airbnb.com/)
- [Webhook Events](https://docs.airbnb.com/webhooks)
- Support: partner-support@airbnb.com

### Booking.com
- [Extranet API](https://partner.booking.com/en-us/help/article/api)
- [XML Feed API](https://www.booking.com/affiliate/api/)
- Support: iconnect@booking.com

### Vrbo
- [Partner API](https://www.vrbo.com/seller/en-us/developer-api)
- [Documentation](https://vrbo-developer-docs.herokuapp.com/)
- Support: partners@vrbo.com

## Future Enhancements

1. **Channel Manager Integration**: Connect to platforms like Hostaway, Airbnb Channel Manager
2. **Message Sync**: Sync guest messages across platforms
3. **Dynamic Pricing**: Auto-adjust rates based on demand/occupancy
4. **Revenue Optimization**: ML-based pricing recommendations
5. **Multi-Currency**: Support for bookings in different currencies
6. **Guest Preferences**: Track guest feedback and ratings per OTA
