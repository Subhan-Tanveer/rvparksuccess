# Analytics Dashboard — Quick Reference

## At a Glance

| Component | File | Purpose |
|-----------|------|---------|
| Engine | `api/_lib/analytics-engine.js` | Pure calculation functions (400 lines) |
| API | `api/admin/analytics.js` | REST endpoints + orchestration (350 lines) |
| UI | `src/js/analytics-dashboard.js` | Dashboard component + charts (500 lines) |
| CSS | `src/css/analytics-dashboard.css` | Responsive styling (300 lines) |

**Total:** ~1,500 lines of production-ready code.

---

## 9 Analytics Endpoints

All require park-staff session. All return park-scoped data.

| Endpoint | Query Params | Returns |
|----------|--------------|---------|
| `overview` | `period=7d/30d/90d` | KPI summary: revenue, occupancy, ADR, guests |
| `trends` | `period=7d/30d/90d&metric=revenue` | YoY/period comparison (% change) |
| `sites` | `period=7d/30d/90d` | Per-site revenue, ADR, booking count |
| `forecasting` | `days=30/60/90` | Revenue prediction ± confidence band |
| `guests` | `period=7d/30d/90d/365d` | Repeat %, avg stay, cancellation rate |
| `sources` | `period=7d/30d/90d` | Booking breakdown by source (direct/staff/OTA) |
| `heatmap` | `startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` | Occupancy grid (sites × dates) |
| `daily-revenue` | `period=7d/30d/90d` | Daily revenue for line chart |
| `top-guests` | `period=7d/30d/90d/365d&limit=10` | Top revenue guests (LTV analysis) |

---

## Dashboard UI Components

### KPI Cards (Top)
- **Total Revenue:** All confirmed bookings + deposits collected
- **Occupancy %:** Booked site-nights ÷ total possible site-nights
- **Average Daily Rate:** Room revenue ÷ total nights (excludes tax/fees)
- **Repeat Guest %:** % of unique guests with >1 booking

Each card shows trend (±% vs previous period).

### Charts
- **Revenue Trend:** 30-day line chart, dates × daily revenue
- **Booking Sources:** Pie chart breakdown (direct, staff, OTA, etc.)
- **Occupancy Heatmap:** Sites (rows) × last 30 days (columns), green = booked

### Tables
- **Revenue by Site:** Per-site metrics (bookings, revenue, ADR)
- **Top Guests:** Name, email, booking count, total nights, LTV
- **Guest Metrics:** Avg stay length, unique count, cancellation %, repeat %

### Controls
- **Period Selector:** Last 7/30/90 days
- **Export CSV:** Downloads all metrics for the period

---

## Key Formulas

### Revenue Metrics
```
Total Revenue = SUM(confirmed bookings' totalCents or depositCents)
ADR = Room Revenue ÷ Total Nights
Room Revenue = SUM(subtotalCents) for confirmed bookings
```

### Occupancy %
```
Occupancy = (Booked Site-Nights ÷ Total Possible Site-Nights) × 100

Example: 10 sites, 30-day period
  Total Possible = 10 sites × 30 days = 300 site-nights
  Booked = 220 site-nights (sum of all reservations' overlap with period)
  Occupancy = (220 ÷ 300) × 100 = 73.3%
```

### Trends (% Change)
```
Trend = ((Current Period - Previous Period) ÷ Previous Period) × 100

Example: Revenue $5,000 → $5,500
  Trend = ((5,500 - 5,000) ÷ 5,000) × 100 = +10%
```

### Forecast (Simple)
```
Avg Nightly Revenue = SUM(booking subtotals) ÷ total nights
Predicted Revenue = Avg Nightly Revenue × forecast days
Confidence Band = ±20%
```

### Repeat Guest %
```
Repeat Guest % = (Guest count with >1 booking ÷ Total unique guests) × 100

Example: 10 unique guests, 2 booked twice
  Repeat % = (2 ÷ 10) × 100 = 20%
```

---

## Common Queries

### Revenue YTD
```javascript
// Load overview for 365d, sum all revenue
const { revenue } = await fetch(
  '/api/admin/analytics?endpoint=overview&period=90d'
).then(r => r.json());

// Can use 3× 90d calls and sum them for ~365d data
```

### Occupancy Trend Week-over-Week
```javascript
// Load trends for 7d
const { occupancyTrendPercent } = await fetch(
  '/api/admin/analytics?endpoint=trends&period=7d'
).then(r => r.json());

// Positive = improving, negative = declining
```

### Identify Low-Performing Site
```javascript
// Load sites
const { sites } = await fetch(
  '/api/admin/analytics?endpoint=sites&period=30d'
).then(r => r.json());

// Sort by revenue (ascending)
sites.sort((a, b) => a.totalRevenueCents - b.totalRevenueCents);
const worstPerformer = sites[0];
```

### Top 3 Guests by LTV
```javascript
// Load top guests (default limit 10)
const { guests } = await fetch(
  '/api/admin/analytics?endpoint=top-guests&period=365d&limit=10'
).then(r => r.json());

// Already sorted by totalRevenueCents (descending)
const top3 = guests.slice(0, 3);
```

### Forecast Next Quarter
```javascript
// Q3 is ~90 days
const { predictedRevenueCents } = await fetch(
  '/api/admin/analytics?endpoint=forecasting&days=90'
).then(r => r.json());

console.log(`Q3 forecast: $${(predictedRevenueCents / 100).toFixed(2)}`);
```

---

## CSV Export Format

When exporting analytics to CSV, the file includes:

```
RVPark Analytics Export,30d

REVENUE SUMMARY
Total Revenue,$50,000.00
ADR,$1,500.00
Bookings,10

OCCUPANCY SUMMARY
Occupancy %,72.5%
Booked Site-Nights,435

GUEST METRICS
Unique Guests,8
Repeat Guest %,25%
Avg Stay,3.2 nights

SITE PERFORMANCE
Site,Bookings,Revenue,ADR
Waterfront Pull-Thru A,5,"$25,000.00","$1,389.00"
Shade Site B,3,"$18,000.00","$1,200.00"
...
```

Downloaded as: `rvpark-analytics-30d-2026-08-11.csv`

---

## Integration Checklist

### park-dashboard.html
```html
<head>
  <!-- Add this line -->
  <link rel="stylesheet" href="/src/css/analytics-dashboard.css">
</head>

<body>
  <!-- Add this div after pricing dashboard -->
  <div id="analyticsDashboard"></div>
</body>
```

### src/js/park-dashboard.js
```javascript
// Add at top
import AnalyticsDashboard from './analytics-dashboard.js';

// In init function, after other dashboards load
const analyticsDashboard = new AnalyticsDashboard('analyticsDashboard');
await analyticsDashboard.init();
```

---

## Debugging Checklist

### Dashboard not loading?
1. Check browser console for errors
2. Verify park-staff session cookie exists (`rvps_admin_session`)
3. Open DevTools → Network → filter "admin/analytics", check API responses

### Charts not rendering?
1. Canvas element exists: `document.getElementById('revenueChart')` should return the element
2. Check browser console for canvas errors
3. Verify data returned from API (should have `dailyRevenue.data` array)

### Trending numbers wrong?
1. Trends compare current vs previous SAME-LENGTH period
2. E.g., "last 30 days" compares to "30 days before that"
3. First 30 days of data = no previous period, trend shows 0%

### Empty tables?
1. Check if reservation data exists for selected period
2. Use `/api/admin/analytics?endpoint=overview` to verify data
3. If no bookings in period, tables correctly show "No data available"

---

## Performance Tips

### Reduce Load Times
- Use 7d/30d periods instead of 365d when possible (faster queries)
- Heatmap auto-limits to 20 sites (prevents massive grid rendering)
- CSV export runs in main thread (~100ms for typical park)

### Optimize for Mobile
- Charts are responsive, scale down on small screens
- Period buttons wrap to new line below 768px
- Tables scroll horizontally if needed
- KPI grid becomes 2 columns below 768px

---

## Metrics Glossary

| Metric | Definition | Calculation |
|--------|-----------|------------|
| **Total Revenue** | Money collected from confirmed bookings | SUM(totalCents or depositCents) |
| **ADR** | Average nightly room rate | Room Revenue ÷ Total Nights |
| **Occupancy %** | % of available site-nights that were booked | Booked Site-Nights ÷ Total Possible × 100 |
| **Repeat Guest %** | % of unique guests with >1 booking | Repeat Guests ÷ Unique Guests × 100 |
| **Avg Stay** | Average nights per booking | Total Nights ÷ Booking Count |
| **Cancellation %** | % of bookings that were canceled | Canceled ÷ Total Bookings × 100 |
| **LTV** | Lifetime value of a guest | Total Revenue from Guest across all bookings |
| **Forecast** | Predicted revenue next N days | Avg Daily Revenue × N Days |

---

## Error Responses

If API returns error:

```json
{ "error": "Not signed in" } // 401
{ "error": "Park not found" } // 404
{ "error": "Failed to calculate analytics" } // 500
```

**Causes:**
- 401: Session cookie missing or expired. Re-login to park-dashboard.html.
- 404: Park ID in session doesn't exist. Re-signup or contact support.
- 500: Database query error. Check server logs. Likely timeout on very large date range.

---

## Customization

### Add Custom Period
In `analytics-dashboard.js`, `renderLayout()`:
```html
<button class="period-btn" data-period="180d">Last 6 months</button>
```

### Change Forecast Confidence
In `analytics-engine.js`, `calculateForecast()`:
```javascript
// Default is 0.85 (85% confidence)
// Change to 0.95 for tighter band
export function calculateForecast(reservations, parkAdrCents, forecastDays = 30, confidence = 0.95)
```

### Adjust Heatmap Rows
In `analytics-dashboard.js`, `buildHeatmapHtml()`:
```javascript
// Default: heatmapData.slice(0, 20) shows first 20 sites
// Change to 0, 30 to show more/fewer sites
```

---

## FAQ

**Q: Why is ADR different from what I calculated?**
- A: ADR excludes tax and fees (hospitality standard). It's room revenue ÷ nights, not total revenue ÷ nights.

**Q: Why does occupancy look low?**
- A: Occupancy includes all sites, all days. If you have 20 sites and only 4 booked on a given day, that's 80% vacant. Total occupancy will naturally be lower.

**Q: Can I compare across parks?**
- A: No. Each park staff sees only their park's data (session-scoped). Super-admins can't see analytics (role: 'park-staff' required).

**Q: Why is forecast sometimes very high/low?**
- A: Forecast uses recent booking velocity only. No seasonal adjustment. A park with low recent bookings will show low forecast. Not predictive of actual demand.

**Q: Does the dashboard update in real-time?**
- A: No. Manual refresh required. Future: WebSocket for live updates.

**Q: Can I export to Google Sheets?**
- A: Download CSV and import to Sheets manually. Future: direct Google Sheets API integration.

---

## Support

**Bug reports:** Check browser console for stack traces. Provide park ID (from URL) and reproduction steps.

**Feature requests:** Analytics Phase 3 roadmap includes cohort analysis, seasonal patterns, competitor pricing, ML forecasting.
