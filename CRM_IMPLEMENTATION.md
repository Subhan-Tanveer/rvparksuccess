# CRM Implementation Guide

## Overview

The RVPark Success CRM module provides guest profile management, communication history tracking, and tagging system for park staff. This document covers the architecture, database schema, API endpoints, and frontend components.

## Architecture

### Components

1. **Database Layer** (`api/_lib/reservations-store.js`)
   - Guest profile management with Postgres persistence
   - Note tracking with timestamps and author attribution
   - Tag system with duplicate prevention
   - Communication log (emails, SMS, calls)
   - Lazy schema creation on first use

2. **API Layer** (`api/admin/crm.js`)
   - RESTful endpoints for guest data
   - Session-based authentication (park-staff only)
   - Park-scoped queries for data isolation
   - Rate limiting and error handling

3. **Frontend** (`src/js/crm-dashboard.js`)
   - Guest list with pagination (50 per page)
   - Guest detail modal with tabbed interface
   - Segmentation view (Loyal, Occasional, At-Risk, Inactive)
   - Communication timeline
   - Real-time tag management

4. **Styling** (`src/css/crm-dashboard.css`)
   - Responsive design (mobile 375px+)
   - Dark mode support via CSS variables
   - Accessibility-focused color scheme
   - Smooth transitions and hover effects

## Database Schema

### guest_profiles Table

Stores enriched guest data and lifetime value calculations.

```sql
CREATE TABLE guest_profiles (
  id TEXT PRIMARY KEY,
  guest_email TEXT NOT NULL UNIQUE,
  park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  lifetime_value_cents INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL DEFAULT 0,
  last_contacted TIMESTAMPTZ,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX idx_guest_profiles_park ON guest_profiles(park_id);
CREATE INDEX idx_guest_profiles_email ON guest_profiles(guest_email);
```

**Fields:**
- `lifetime_value_cents`: Sum of all booking amounts (calculated from reservations)
- `risk_score`: 0-100 score indicating likelihood of cancellation (0=low, 100=high)
- `last_contacted`: Timestamp of last email/SMS/note interaction
- `preferences_json`: Flexible JSON storing dietary needs, accessibility requirements, pet info, etc.

### guest_notes Table

Staff-authored notes attached to guests with full audit trail.

```sql
CREATE TABLE guest_notes (
  id TEXT PRIMARY KEY,
  guest_email TEXT NOT NULL,
  park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  created_by_staff_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Composite index for fast filtering
CREATE INDEX idx_guest_notes_park_email ON guest_notes(park_id, guest_email);
CREATE INDEX idx_guest_notes_created ON guest_notes(created_at DESC);
```

**Validation:**
- Max 1000 characters per note
- Text sanitization to prevent XSS
- Immutable once created (no edit, only view/delete)

### guest_tags Table

Flexible tagging system for guest segmentation and categorization.

```sql
CREATE TABLE guest_tags (
  id TEXT PRIMARY KEY,
  guest_email TEXT NOT NULL,
  park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint prevents duplicate tags per guest
CREATE UNIQUE INDEX idx_guest_tags_unique ON guest_tags(guest_email, park_id, tag_name);
CREATE INDEX idx_guest_tags_park_email ON guest_tags(park_id, guest_email);
CREATE INDEX idx_guest_tags_park_tag ON guest_tags(park_id, tag_name);
```

**Suggested Tags:**
- Segment: `Loyal`, `Frequent`, `Occasional`
- Value: `High-Value`, `VIP`, `Budget`
- Behavior: `Issue-Prone`, `Always-Late`, `Requires-Attention`
- Preferences: `Pet-Friendly`, `Early-Check-In`, `Late-Checkout`

### communication_log Table

Tracks all guest interactions (emails, SMS, phone calls).

```sql
CREATE TABLE communication_log (
  id TEXT PRIMARY KEY,
  guest_email TEXT NOT NULL,
  park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- 'email' | 'sms' | 'call'
  subject TEXT,
  message_preview TEXT,
  status TEXT NOT NULL DEFAULT 'sent',  -- 'sent' | 'delivered' | 'failed'
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_communication_log_park_email ON communication_log(park_id, guest_email);
CREATE INDEX idx_communication_log_timestamp ON communication_log(timestamp DESC);
```

**Types:** `email`, `sms`, `call`, `note`
**Status:** `sent`, `delivered`, `failed`, `read`

## API Endpoints

### Authentication

All endpoints require `parkId` from session and role: `park-staff`

```javascript
const session = requireSession(req, res, { role: 'park-staff' });
```

### GET Endpoints

#### List Guests with Pagination

```
GET /api/admin/crm?action=guests&page=0
```

**Response:**
```json
{
  "guests": [
    {
      "id": "profile-...",
      "guestEmail": "guest@example.com",
      "parkId": "park-id",
      "lifetimeValueCents": 45000,
      "riskScore": 25,
      "lastContacted": "2026-08-10T14:30:00Z",
      "preferences": { "petFriendly": true },
      "tags": [
        { "id": "tag-...", "tagName": "VIP", "createdAt": "2026-08-10T..." }
      ],
      "bookingCount": 3,
      "createdAt": "2026-01-15T...",
      "updatedAt": "2026-08-10T..."
    }
  ],
  "total": 156,
  "page": 0,
  "limit": 50,
  "hasMore": true
}
```

#### Get Full Guest Profile

```
GET /api/admin/crm?action=guest&guestEmail=guest@example.com
```

**Response:**
```json
{
  "history": {
    "profile": { /* guest_profiles row */ },
    "notes": [ /* guest_notes rows */ ],
    "tags": [ /* guest_tags rows */ ],
    "communications": [ /* last 20 communication_log entries */ ],
    "reservations": [ /* last 10 reservation entries */ ]
  }
}
```

#### Get Guest Segmentation

```
GET /api/admin/crm?action=segments
```

**Response:**
```json
{
  "segments": {
    "loyal": {
      "count": 42,
      "avgLifetimeValue": 8500  // in cents
    },
    "occasional": {
      "count": 28,
      "avgLifetimeValue": 3200
    },
    "atRisk": {
      "count": 15,
      "avgLifetimeValue": 2100
    },
    "inactive": {
      "count": 71,
      "avgLifetimeValue": 1500
    }
  }
}
```

**Segmentation Logic:**
- **Loyal**: `risk_score < 30` (highly engaged, low cancellation risk)
- **Occasional**: `risk_score 30-60` (moderate engagement)
- **At-Risk**: `risk_score > 60` (high cancellation/complaint risk)
- **Inactive**: `last_contacted IS NULL OR < 90 days ago`

#### Get At-Risk Guests

```
GET /api/admin/crm?action=at-risk&limit=10
```

Returns guests sorted by `risk_score DESC`.

### POST Endpoints

#### Add Staff Note

```
POST /api/admin/crm?action=note
Content-Type: application/json

{
  "guestEmail": "guest@example.com",
  "noteText": "Mentioned preferred late checkout time",
  "staffId": "staff-member-id"  // optional
}
```

**Validation:**
- `noteText` required, max 1000 chars
- Creates guest profile if doesn't exist
- Returns created note object

#### Add Tag to Guest

```
POST /api/admin/crm?action=tag
Content-Type: application/json

{
  "guestEmail": "guest@example.com",
  "tagName": "VIP"
}
```

**Behavior:**
- Returns 400 if tag already exists on guest
- Creates guest profile if doesn't exist
- Case-sensitive tag names

#### Update Guest Preferences

```
POST /api/admin/crm?action=preferences
Content-Type: application/json

{
  "guestEmail": "guest@example.com",
  "preferences": {
    "petFriendly": true,
    "dietaryRestrictions": "vegetarian",
    "earlyCheckInPreferred": true
  }
}
```

**Behavior:**
- Merges with existing preferences (non-destructive update)
- Stores as JSON blob for flexibility
- No schema enforcement (free-form key/value)

#### Log Communication Event

```
POST /api/admin/crm?action=communication
Content-Type: application/json

{
  "guestEmail": "guest@example.com",
  "type": "email",
  "subject": "Booking Confirmation",
  "messagePreview": "Your reservation is confirmed...",
  "status": "sent"
}
```

**Used by:**
- Email marketing system (after send)
- SMS system (after delivery)
- Manual call/email logging

### DELETE Endpoints

#### Remove Tag from Guest

```
DELETE /api/admin/crm?action=tag&tagId=tag-...
```

**Response:**
```json
{ "success": true }
```

## Frontend Integration

### Initialization

In `park-dashboard.js`:

```javascript
import { initCrmDashboard } from './crm-dashboard.js';

async function loadDashboard() {
  // ... existing code ...
  await initCrmDashboard(currentPark);
}
```

### HTML Structure

In `park-dashboard.html`:

```html
<!-- CRM Dashboard Section -->
<div class="admin-section glass" data-reveal>
  <div class="section-head">
    <p class="eyebrow">Guest Management</p>
    <h2>CRM Dashboard</h2>
  </div>
  <div id="crmDashboard"></div>
</div>

<!-- Include CSS -->
<link rel="stylesheet" href="/src/css/crm-dashboard.css">
```

### Module Exports

The CRM dashboard exports:

```javascript
export async function initCrmDashboard(park)
```

**Parameters:**
- `park`: Current park object from `/api/admin/dashboard`

**Side Effects:**
- Renders full CRM UI into `#crmDashboard`
- Initializes event listeners
- Loads initial guest list
- Exposes globals: `window.crmViewGuest()`, `window.crmRemoveTag()`

## Performance Considerations

### Database Optimization

1. **Indexes**
   - `guest_profiles(park_id, guest_email)` for fast lookups
   - `guest_tags(park_id, tag_name)` for segment filtering
   - `communication_log(timestamp DESC)` for timeline queries
   - Unique constraint on `(guest_email, park_id, tag_name)` to prevent duplicates

2. **Query Patterns**
   - All queries scoped by `park_id` (park-level isolation)
   - Pagination: 50 guests per page, lazy-load detail
   - Guest detail queries fetch: profile + notes + tags + last 20 comms + last 10 reservations

### Frontend Optimization

1. **Lazy Loading**
   - Guest list loads paginated (50 per page)
   - Guest detail modal loads on demand
   - At-risk list loads only when tab selected

2. **Caching**
   - Segments cached in memory until page reload
   - No persistent cache (always fresh from API)

## Security

### Park Isolation

All queries filter by `park_id` from session:

```javascript
export async function getGuestsForPark(parkId, limit = 50, offset = 0) {
  const res = await query(
    `SELECT * FROM guest_profiles WHERE park_id = $1 ...`,
    [parkId]  // Scoped by session parkId
  );
}
```

A staff member can ONLY see guests from their own park, enforced at the database query level.

### Input Validation

1. **Notes**
   - Max 1000 characters
   - Text-only (no HTML/JS)
   - Trimmed before storage

2. **Tags**
   - Max 100 characters
   - Alphanumeric + spaces + hyphens
   - Unique per guest per park

3. **Preferences**
   - Free-form JSON (no schema validation)
   - Merged on update (non-destructive)
   - No sensitive data stored

## Deployment Checklist

- [x] Database schema applied (4 new tables + indexes)
- [x] API endpoint created and tested
- [x] Frontend components integrated
- [x] CSS included in dashboard HTML
- [x] Session auth enforced on all endpoints
- [x] Park-scoped queries verified
- [x] Error messages user-friendly
- [x] Mobile responsive design tested
- [x] Dark mode CSS variables used
- [x] Git commit with all files

## Future Enhancements

1. **Advanced Segmentation**
   - ML-based churn prediction
   - RFM (Recency, Frequency, Monetary) analysis
   - Behavior clustering

2. **Communication**
   - Built-in email/SMS composer
   - Bulk messaging campaigns
   - Scheduled communications

3. **Automation**
   - Auto-tag on booking patterns
   - Auto-update risk_score based on history
   - Trigger workflows on tag changes

4. **Analytics**
   - Guest lifetime value trends
   - Segment performance metrics
   - Communication effectiveness tracking

5. **Integrations**
   - Export guests to Mailchimp/ActiveCampaign
   - Webhook events for external systems
   - Zapier/IFTTT automation
