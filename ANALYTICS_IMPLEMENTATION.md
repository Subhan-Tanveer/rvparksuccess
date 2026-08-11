# Advanced Analytics Dashboard — Implementation Guide

## Overview

The Advanced Analytics Dashboard provides park staff with sophisticated business intelligence for their RV park operations. It includes revenue metrics, occupancy analysis, guest segmentation, trend comparisons, forecasting, and per-site performance breakdowns.

**Status:** Production-ready
**Files:** 6 new + 2 modified

---

## Architecture

### Three-Layer Design

1. **Analytics Engine** (`api/_lib/analytics-engine.js`)
   - Pure calculation functions operating on already-fetched data
   - No database queries, no I/O, just math
   - Testable, composable, fast
   - ~400 lines

2. **Analytics API** (`api/admin/analytics.js`)
   - Park-scoped REST endpoints
   - Session authentication (park-staff role only)
   - Orchestrates data fetching and engine calls
   - ~350 lines

3. **Analytics Dashboard UI** (`src/js/analytics-dashboard.js`)
   - Vanilla JS component (no framework)
   - Canvas-based charts (no external lib)
   - CSV export
   - Dark mode ready
   - ~500 lines

### Data Flow

```
UI (analytics-dashboard.js)
  ↓
API (/api/admin/analytics?endpoint=X)
  ↓
DB query (getReservationsForParkInRange)
  ↓
Analytics Engine calculations
  ↓
JSON response to UI
  ↓
Render charts, tables, KPIs
```

---

## API Endpoints

All endpoints require park-staff session. Returns park-scoped data only.

### `/api/admin/analytics?endpoint=overview&period=7d|30d|90d`

**Response:**
```json
{
  "period": "30d",
  "dateRange": { "start": "2026-07-12", "end": "2026-08-11" },
  "revenue": {
    "totalRevenueCents": 50000,
    "totalRoomRevenueCents": 48500,
    "totalTaxCents": 1200,
    "totalFeeCents": 300,
    "totalDiscountCents": 0,
    "adrCents": 15000,
    "bookingCount": 10
  },
  "occupancy": {
    "occupancyPercent": 72.5,
    "bookedSiteNights": 435,
    "totalSiteNights": 600
  },
  "guests": {
    "uniqueGuestCount": 8,
    "repeatGuestPercent": 25,
    "avgStayNights": 3.2,
    "cancellationPercent": 2.1
  }
}
```

### `/api/admin/analytics?endpoint=trends&period=7d|30d|90d&metric=revenue`

Compares current period to same-length previous period.

**Response:**
```json
{
  "metric": "revenue",
  "period": "30d",
  "revenueTrendPercent": 12.5,
  "occupancyTrendPercent": 3.2,
  "bookingsTrendPercent": -5,
  "adrTrendPercent": 8.3,
  "currentMetrics": { ... },
  "previousMetrics": { ... }
}
```

### `/api/admin/analytics?endpoint=sites&period=7d|30d|90d`

Per-site revenue, occupancy, and booking metrics.

**Response:**
```json
{
  "period": "30d",
  "dateRange": { "start": "2026-07-12", "end": "2026-08-11" },
  "sites": [
    {
      "siteId": "site-123",
      "siteName": "Waterfront Pull-Thru A",
      "siteType": "pull-thru",
      "bookingCount": 5,
      "totalRevenueCents": 25000,
      "totalNights": 18,
      "adrCents": 13889
    },
    ...
  ]
}
```

### `/api/admin/analytics?endpoint=forecasting&period=30d&days=30|60|90`

Predicts revenue for next N days using recent booking velocity.

**Response:**
```json
{
  "forecastDays": 30,
  "predictedRevenueCents": 48000,
  "lowerBoundCents": 38400,
  "upperBoundCents": 57600,
  "confidencePercent": 85
}
```

### `/api/admin/analytics?endpoint=guests&period=7d|30d|90d|365d`

Guest behavior: repeat rates, avg stay, cancellations.

**Response:**
```json
{
  "period": "30d",
  "guestMetrics": {
    "uniqueGuestCount": 8,
    "repeatGuestCount": 2,
    "repeatGuestPercent": 25,
    "avgStayNights": 3.2,
    "cancellationPercent": 2.1,
    "totalBookings": 10
  }
}
```

### `/api/admin/analytics?endpoint=sources&period=7d|30d|90d`

Booking source breakdown: direct vs OTA.

**Response:**
```json
{
  "period": "30d",
  "sources": [
    {
      "source": "guest",
      "bookingCount": 7,
      "bookingPercent": 70,
      "totalRevenueCents": 35000
    },
    {
      "source": "staff",
      "bookingCount": 3,
      "bookingPercent": 30,
      "totalRevenueCents": 15000
    }
  ]
}
```

### `/api/admin/analytics?endpoint=heatmap&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

Occupancy heatmap: sites (rows) × dates (columns).

**Response:**
```json
{
  "dateRange": { "start": "2026-07-12", "end": "2026-08-11" },
  "heatmap": [
    {
      "siteId": "site-123",
      "siteName": "Waterfront Pull-Thru A",
      "dates": {
        "2026-07-12": 100,
        "2026-07-13": 100,
        "2026-07-14": 0,
        ...
      }
    },
    ...
  ]
}
```

### `/api/admin/analytics?endpoint=daily-revenue&period=7d|30d|90d`

Daily revenue distributed across check-in dates (for line charts).

**Response:**
```json
{
  "period": "30d",
  "dateRange": { "start": "2026-07-12", "end": "2026-08-11" },
  "data": [
    { "date": "2026-07-12", "revenueCents": 5000 },
    { "date": "2026-07-13", "revenueCents": 3200 },
    ...
  ]
}
```

### `/api/admin/analytics?endpoint=top-guests&period=7d|30d|90d|365d&limit=10`

Top guests by revenue (repeat customer analysis).

**Response:**
```json
{
  "period": "30d",
  "guests": [
    {
      "guestEmail": "john@example.com",
      "guestName": "John Doe",
      "bookingCount": 3,
      "totalNights": 15,
      "totalRevenueCents": 22500,
      "lastBookingDate": "2026-08-01"
    },
    ...
  ]
}
```

---

## Core Calculations

### Revenue Metrics

**Function:** `calculateRevenueMetrics(reservations, park)`

Calculates:
- Total revenue (including room + tax + fees)
- Room revenue (subtotal only)
- Tax collected
- Platform fees collected
- Discounts applied
- Average daily rate (ADR) = room revenue ÷ nights
- Revenue per night (total ÷ nights)

**Key Logic:**
- Only counts confirmed/confirmed-deposit reservations
- Deposit-only bookings: uses depositCents, full bookings: uses totalCents
- ADR excludes tax and fees (standard hospitality metric)

### Occupancy Metrics

**Function:** `calculateOccupancyMetrics(reservations, siteCount, startDate, endDate)`

Calculates:
- Occupancy % = booked site-nights ÷ total possible site-nights
- Booked site-nights (accounting for partial overlaps)
- Total possible site-nights

**Key Logic:**
- Handles multi-day stays crossing date range boundaries
- If a 5-night stay spans 2/7 days in range, counts 2 site-nights
- Ignores canceled reservations

### Guest Metrics

**Function:** `calculateGuestMetrics(reservations)`

Calculates:
- Unique guest count (by email)
- Repeat guest count (booked > 1 time)
- Repeat guest % of total guests
- Average stay length (nights)
- Cancellation rate

**Key Logic:**
- Email is the dedup key (null/empty emails excluded)
- Avg stay = total nights ÷ booking count
- Cancellation rate = canceled ÷ all reservations

### Trends

**Function:** `calculateTrends(current, previous, siteCount, ...dates)`

Compares current period to previous same-length period:
- Revenue change %
- Occupancy change percentage points
- Booking count change %
- ADR change %

**Key Logic:**
- Each metric normalized as % change: `(current - previous) / previous * 100`
- Occupancy is percentage-point change (not %), e.g., 70% → 75% = +5 trend

### Forecasting

**Function:** `calculateForecast(reservations, adrCents, forecastDays, confidence)`

Simple 30/60/90-day revenue forecast:
- Uses average nightly revenue × days ahead
- Confidence interval ±20% (simplified variance)

**Key Logic:**
- Based on recent booking velocity, not seasonal patterns
- ±20% band represents typical variance
- Higher-fidelity forecast would use seasonal indexes, day-of-week patterns, OTA velocity

### Occupancy Heatmap

**Function:** `calculateOccupancyHeatmap(reservations, sites, startDate, endDate)`

Generates site × date grid:
- Each cell = 100 if site booked on that date, 0 if vacant
- Rendered as color intensity (green = occupied)

### Top Guests

**Function:** `calculateTopGuests(reservations, limit)`

Sorts guests by total revenue (LTV analysis):
- Name, email, booking count, total nights, total revenue, last booking date

---

## Integration with Dashboard

### Adding to park-dashboard.html

1. Import the CSS:
```html
<link rel="stylesheet" href="/src/css/analytics-dashboard.css">
```

2. Add container div:
```html
<div id="analyticsDashboard"></div>
```

3. Import and init the component (in park-dashboard.js):
```javascript
import AnalyticsDashboard from './analytics-dashboard.js';

const dashboard = new AnalyticsDashboard('analyticsDashboard');
await dashboard.init();
```

### Session Validation

All API endpoints call `requireSession(req, res, { role: 'park-staff' })`:
- Validates JWT from httpOnly cookie
- Extracts parkId from session
- Returns 401 if not authenticated
- All queries are park-scoped via session.parkId

### Error Handling

**API Level:**
- Invalid period strings default to 30 days
- Missing startDate/endDate default to last 30 days
- Database errors return 500 with generic message

**UI Level:**
- Failed API calls display error alert
- Chart/table sections show "Loading..." then empty state if no data
- CSV export gracefully skips empty sections

---

## Performance Considerations

### Query Optimization

- `getReservationsForParkInRange(parkId, startDate, endDate)` uses indexed queries:
  - Index on `(park_id, check_in, check_out)` for date range lookups
  - Index on `park_id` for park-scoped queries
- Fetches all matching reservations in one query, then calculates in-memory

### Caching Strategy

**Recommended (not yet implemented):**
- Cache 7/30/90-day summaries daily (Redis or Vercel KV)
- Invalidate on new reservation creation
- Heatmap and daily-revenue can be recalculated on every load (light queries)

**Current:** No caching — every load fetches fresh data

### Large Date Ranges

- 365-day guests query may return large result sets
- Limit to 25 top guests max (hardcoded)
- Consider pagination for date ranges >365 days

---

## Testing the Analytics API

### Test with curl

```bash
# Overview for last 30 days
curl -H "Cookie: rvps_admin_session=YOUR_TOKEN" \
  'http://localhost:3000/api/admin/analytics?endpoint=overview&period=30d'

# Trends
curl -H "Cookie: rvps_admin_session=YOUR_TOKEN" \
  'http://localhost:3000/api/admin/analytics?endpoint=trends&period=30d&metric=revenue'

# Forecast 30 days ahead
curl -H "Cookie: rvps_admin_session=YOUR_TOKEN" \
  'http://localhost:3000/api/admin/analytics?endpoint=forecasting&period=30d&days=30'
```

### Test with Postman

1. Log in to park-dashboard.html as park staff
2. In browser DevTools → Application → Cookies, copy `rvps_admin_session` value
3. In Postman, add Cookie header: `rvps_admin_session=VALUE`
4. GET `https://your-domain/api/admin/analytics?endpoint=overview&period=30d`

### Expected Response Times

- **overview:** ~200ms (single date-range query + calculations)
- **trends:** ~300ms (two date-range queries)
- **sites:** ~250ms (one query, multi-site calculations)
- **forecasting:** ~200ms
- **heatmap:** ~400ms (all sites + all dates)

---

## Future Enhancements

### Phase 3 Ideas

1. **Seasonal Analysis**
   - Identify peak/off-season patterns
   - Recommend pricing adjustments

2. **Competitor Pricing**
   - If OTA integrations enabled, benchmark against competitors

3. **Cohort Analysis**
   - Group guests by acquisition source, season, length of stay
   - LTV by cohort

4. **Predictive Analytics**
   - ML-powered demand forecasting (Vercel Functions + Edge ML)
   - Churn prediction for repeat guests

5. **Automated Reports**
   - Email weekly/monthly PDF analytics summaries
   - Scheduled exports to Google Sheets

6. **Real-Time Dashboards**
   - WebSocket updates for live occupancy
   - Booking notifications with metrics

---

## File Checklist

**New Files:**
- ✓ `api/_lib/analytics-engine.js` — Pure calculations
- ✓ `api/admin/analytics.js` — API endpoints
- ✓ `src/js/analytics-dashboard.js` — UI component
- ✓ `src/css/analytics-dashboard.css` — Styling
- ✓ `ANALYTICS_IMPLEMENTATION.md` — This file
- ✓ `ANALYTICS_QUICK_REFERENCE.md` — Quick reference

**Modified Files:**
- `park-dashboard.html` — Add `<div id="analyticsDashboard">` and CSS import
- `src/js/park-dashboard.js` — Import and init AnalyticsDashboard

**No Changes Needed:**
- `api/_lib/reservations-store.js` — Already has all necessary query functions
- Database schema — Reuses existing tables

---

## Debugging

### Enable Verbose Logging

In `api/admin/analytics.js`, add before each calculation:
```javascript
console.log(`Calculating ${endpoint} for park ${parkId}, period ${period}`, { 
  reservationCount: reservations.length 
});
```

### Check Session Auth

If getting 401 errors:
```javascript
// In browser console while logged in
fetch('/api/admin/analytics?endpoint=overview&period=30d')
  .then(r => r.json())
  .then(console.log);
// Should return data, not { error: 'Not signed in' }
```

### Monitor Date Range Calculations

The heatmap can be slow for large date ranges. Log query times:
```javascript
const startTime = Date.now();
const reservations = await getReservationsForParkInRange(...);
console.log(`Query took ${Date.now() - startTime}ms`);
```

---

## Deployment Checklist

- [ ] All 6 files created
- [ ] Both modified files updated
- [ ] `npm run build` passes (no errors)
- [ ] Park staff can access park-dashboard.html
- [ ] Analytics dashboard section appears and loads
- [ ] Period selector buttons change period
- [ ] CSV export downloads file
- [ ] Dark mode looks correct
- [ ] Mobile (375px) layout responsive
- [ ] All KPI cards display data
- [ ] Revenue chart renders without errors
- [ ] Console has no 401/403 errors
- [ ] Git committed and pushed

---

## Support & Maintenance

### Common Issues

**Q: Analytics not loading**
- A: Check browser console for API errors. Verify session cookie exists.

**Q: Charts look squished/distorted**
- A: Canvas sizing issue. Check `chart-container` height and canvas scaling.

**Q: Forecast numbers seem wrong**
- A: Forecast uses recent bookings only. Not seasonal. For a park with 1 booking in the last 30 days, forecast will be very low.

**Q: CSV export missing data**
- A: Check that API endpoints are returning data. CSV only includes what's in `this.data`.

---

## License & Credits

Built for RVPark Success Phase 2. Uses vanilla JS (no external charting library) to keep bundle size minimal and API calls fast.

**Calculation Methodology References:**
- ADR: [STR Analytics definition](https://www.str.com/article/average-daily-rate)
- RevPAR: (RevPAR = Occupancy × ADR)
- Occupancy: Standard hospitality metric (booked nights / available nights)
