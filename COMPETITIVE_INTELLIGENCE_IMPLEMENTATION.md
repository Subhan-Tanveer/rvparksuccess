# Competitive Intelligence Implementation Guide

## Phase 3: Competitive Pricing Intelligence for RVPark Success

This guide explains the Competitive Intelligence feature that enables park owners to monitor competitor pricing, analyze market trends, and receive data-driven pricing recommendations.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Web Scraping](#web-scraping)
6. [Analysis Engine](#analysis-engine)
7. [Dashboard UI](#dashboard-ui)
8. [Integration Points](#integration-points)
9. [Performance Considerations](#performance-considerations)
10. [Future Enhancements](#future-enhancements)

---

## Overview

The Competitive Intelligence feature provides park owners with:

- **Competitor Monitoring**: Track 3-5 competitor RV parks and collect their nightly rates
- **Market Analysis**: Calculate market averages, identify your pricing position (underpriced/competitive/overpriced)
- **Price Recommendations**: AI-driven suggestions to optimize rates based on market data
- **Trend Analysis**: 30/90/365-day historical trend charts showing market movement
- **Revenue Opportunity Identification**: Pinpoint underpriced or overpriced sites with revenue impact estimates

### Key Metrics

| Metric | Description | Calculation |
|--------|-------------|-------------|
| Market Average Daily Rate (ADR) | Mean nightly rate across competitors | Sum of all competitor rates / competitor count |
| Market Median | Middle value of competitor rates | Sorted competitor rates at 50th percentile |
| Price Position | Your rate relative to market average | (Your rate - Market avg) / Market avg * 100% |
| Confidence Score | How reliable the recommendation is | 0.0 - 1.0 (higher = more reliable) |
| Revenue Impact | Estimated monthly revenue change | (Suggested rate - Current rate) * Estimated monthly bookings |

---

## Architecture

### Three-Layer System

```
┌─────────────────────────────────────┐
│  Frontend: Competitive Intelligence │
│  Dashboard (React-like UI)          │
└──────────────────┬──────────────────┘
                   │
┌──────────────────┴──────────────────┐
│  API Layer: /api/admin/             │
│  competitive-intelligence.js         │
└──────────────────┬──────────────────┘
                   │
┌──────────────────┴──────────────────┐
│  Business Logic: competitor-        │
│  intelligence.js (analysis engine)  │
└──────────────────┬──────────────────┘
                   │
┌──────────────────┴──────────────────┐
│  Data Layer: Postgres               │
│  (4 new tables)                     │
└─────────────────────────────────────┘
```

### File Structure

```
RVPark Website/
├── api/
│   ├── _lib/
│   │   ├── competitor-intelligence.js    [400+ lines] Analysis engine
│   │   └── reservations-store.js          [Database functions]
│   └── admin/
│       └── competitive-intelligence.js   [300+ lines] API routes
├── src/
│   ├── css/
│   │   └── competitive-intelligence.css  [250+ lines] Dashboard styling
│   └── js/
│       └── competitive-intelligence-dashboard.js [500+ lines] UI renderer
├── park-dashboard.html                    [Modified] Added dashboard container
├── COMPETITIVE_INTELLIGENCE_IMPLEMENTATION.md
└── COMPETITIVE_INTELLIGENCE_QUICK_REFERENCE.md
```

---

## Database Schema

### New Tables

#### `competitors`
Tracks competitor parks being monitored.

```sql
CREATE TABLE competitors (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website_url TEXT NOT NULL,
  location TEXT,
  scrape_enabled BOOLEAN NOT NULL DEFAULT true,
  last_scraped TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_competitors_unique ON competitors(park_id, website_url);
```

**Usage**: Store competitor URLs and metadata. Staff adds competitors via dashboard form.

#### `competitor_pricing`
Historical pricing snapshots from competitors.

```sql
CREATE TABLE competitor_pricing (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  avg_rate_cents INTEGER,
  low_rate_cents INTEGER,
  high_rate_cents INTEGER,
  occupancy_signal NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_competitor_pricing_competitor ON competitor_pricing(competitor_id);
CREATE INDEX idx_competitor_pricing_date ON competitor_pricing(date DESC);
```

**Usage**: One row per day per competitor. Populated by nightly scheduled scrapes. Stores min/avg/max rates observed.

#### `market_analytics`
Calculated market benchmarks (aggregated from all competitors).

```sql
CREATE TABLE market_analytics (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  market_avg_rate_cents INTEGER,
  market_median_cents INTEGER,
  price_percentile NUMERIC,
  competitor_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_market_analytics_unique ON market_analytics(park_id, date);
```

**Usage**: Daily market snapshot (one row per day per park). Aggregates competitor data into market-wide metrics.

#### `pricing_suggestions`
AI-generated price recommendations for your sites.

```sql
CREATE TABLE pricing_suggestions (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  suggested_rate_cents INTEGER NOT NULL,
  confidence_score NUMERIC NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pricing_suggestions_park ON pricing_suggestions(park_id);
CREATE INDEX idx_pricing_suggestions_site ON pricing_suggestions(site_id);
```

**Usage**: Generated suggestions (one or more per site). Includes confidence score and reasoning.

### Data Flow

```
Daily Scheduled Job:
1. Fetch competitor website URLs
2. Scrape each competitor's pricing page
3. Parse HTML → extract price ranges
4. Insert into competitor_pricing table
5. Calculate market_avg, market_median
6. Insert into market_analytics table
7. Generate suggestions (using pricing-engine rules)
8. Insert into pricing_suggestions table
```

---

## API Endpoints

### GET Endpoints

#### `GET /api/admin/competitive-intelligence?action=dashboard-summary`
Returns complete dashboard data: positioning, opportunities, trends, summary stats.

**Query Parameters**: None

**Response**:
```json
{
  "summary": {
    "competitorsTracked": 3,
    "sitesManaged": 12,
    "opportunitiesIdentified": 2,
    "marketTrendDays": 90
  },
  "positioning": {
    "rv": {
      "yourAvgRate": 10500,
      "marketAverage": 9800,
      "marketMin": 8500,
      "marketMax": 12000,
      "position": {
        "percentageDifference": 7.1,
        "positionLabel": "Competitive"
      },
      "competitorCount": 3
    }
  },
  "opportunities": [
    {
      "siteId": "site-123",
      "suggestedRateCents": 11000,
      "confidenceScore": 0.85,
      "reason": "Underpriced by 12% vs market average...",
      "site": { "id": "site-123", "name": "Premium RV Loop", "type": "rv" },
      "currentRate": 10000,
      "rateDifference": 1000,
      "percentChange": 10.0,
      "estimatedRevenueImpactMonth": 30000
    }
  ],
  "trends": [ /* array of 30 days of trend data */ ],
  "lastUpdated": "2026-08-11T12:34:56Z"
}
```

#### `GET /api/admin/competitive-intelligence?action=competitors`
List all tracked competitors for this park.

**Response**:
```json
{
  "competitors": [
    {
      "id": "comp-123",
      "parkId": "park-1",
      "name": "Desert Oasis RV Park",
      "websiteUrl": "https://desertoasis.com",
      "location": "Phoenix, AZ",
      "scrapeEnabled": true,
      "lastScraped": "2026-08-11T00:00:00Z",
      "createdAt": "2026-08-01T10:23:45Z"
    }
  ]
}
```

#### `GET /api/admin/competitive-intelligence?action=market-rates&siteType=rv`
Price comparison for a specific site type (tenant, rv, cabin).

**Query Parameters**:
- `siteType` (required): `tent`, `rv`, or `cabin`

**Response**:
```json
{
  "siteType": "rv",
  "yourAvgRate": 10500,
  "marketAverage": 9800,
  "marketMin": 8500,
  "marketMax": 12000,
  "position": {
    "percentageDifference": 7.1,
    "positionLabel": "Competitive"
  },
  "competitorCount": 3
}
```

#### `GET /api/admin/competitive-intelligence?action=suggestions`
All price recommendations for this park's sites.

**Response**:
```json
{
  "suggestions": [
    {
      "siteId": "site-123",
      "suggestedRateCents": 11000,
      "confidenceScore": 0.85,
      "reason": "Underpriced by 12% vs market average...",
      "site": { "id": "site-123", "name": "Premium RV Loop", "type": "rv" }
    }
  ],
  "generatedAt": "2026-08-11T12:34:56Z"
}
```

#### `GET /api/admin/competitive-intelligence?action=trends&days=90`
Market trend history (default 90 days, max 365).

**Query Parameters**:
- `days` (optional, default 90): Number of days of history (max 365)

**Response**:
```json
{
  "trends": [
    {
      "date": "2026-06-13",
      "marketAvgRate": 9600,
      "marketMedian": 9500,
      "competitorCount": 3
    }
    // ... 90 more days
  ],
  "periodDays": 90,
  "latestAverage": 9800,
  "trendDirection": "upward"
}
```

#### `GET /api/admin/competitive-intelligence?action=opportunities`
Detailed list of revenue opportunities (underpriced/overpriced sites).

**Response**:
```json
{
  "opportunities": [ /* sorted by revenue impact */ ],
  "opportunityCount": 5,
  "generatedAt": "2026-08-11T12:34:56Z"
}
```

#### `GET /api/admin/competitive-intelligence?action=positioning`
Your pricing position across all site types.

**Response**:
```json
{
  "positioning": {
    "rv": { /* comparison data */ },
    "tent": { /* comparison data */ },
    "cabin": { /* comparison data */ }
  },
  "competitorCount": 3
}
```

### POST Endpoints

#### `POST /api/admin/competitive-intelligence`
Add a new competitor or refresh market data.

**Request Body**:
```json
{
  "action": "add-competitor",
  "name": "Desert Oasis RV Park",
  "websiteUrl": "https://desertoasis.com",
  "location": "Phoenix, AZ"
}
```

**Response**:
```json
{
  "competitor": {
    "id": "comp-123",
    "parkId": "park-1",
    "name": "Desert Oasis RV Park",
    "websiteUrl": "https://desertoasis.com",
    "location": "Phoenix, AZ",
    "scrapeEnabled": true,
    "lastScraped": null,
    "createdAt": "2026-08-11T12:34:56Z"
  },
  "message": "Competitor added successfully"
}
```

#### `POST /api/admin/competitive-intelligence?action=refresh`
Manually trigger competitor data refresh (normally runs nightly).

**Response**:
```json
{
  "message": "Competitor data refreshed",
  "updated": 3,
  "timestamp": "2026-08-11T12:34:56Z"
}
```

### DELETE Endpoints

#### `DELETE /api/admin/competitive-intelligence`
Stop tracking a competitor.

**Request Body**:
```json
{
  "competitorId": "comp-123"
}
```

**Response**:
```json
{
  "message": "Competitor removed successfully",
  "competitorId": "comp-123"
}
```

---

## Web Scraping

### Strategy

The system uses lightweight HTML parsing (cheerio-like) to extract pricing information without heavy dependencies:

1. **Fetch** competitor website (15-second timeout)
2. **Parse** HTML for common price patterns
3. **Extract** numeric values matching price format (`$XX`, `$XX.XX`, etc.)
4. **Calculate** min/avg/max from extracted prices
5. **Store** snapshot in `competitor_pricing` table
6. **Retry** up to 2 times on failure with exponential backoff

### Price Extraction

Pattern matching targets:
- `$50` → 5000 cents
- `$50.00` → 5000 cents
- `$50 per night` → 5000 cents (ignores text context)
- Range detection: `$40-$80` → low=4000, high=8000

### Rate Limiting

- 2-second delay between competitor fetches (respect server resources)
- 1-second retry delay (exponential backoff: 1s, 2s, 4s on retries)
- 15-second timeout per request (abort if stalled)
- User-Agent header identifies bot as "RVParkSuccess/1.0"

### Scheduled Job (Future)

In production, a scheduled background job (Vercel Cron or similar) runs nightly at 2 AM UTC:

```javascript
// Example: cron-refresh-competitors.js
export const config = {
  runtime: 'nodejs',
  regions: ['iad1'], // us-east Vercel region for predictability
};

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parks = await listParks(); // All parks
  for (const park of parks) {
    await refreshCompetitorData(park.id);
  }

  return res.status(200).json({ updated: parks.length });
}
```

---

## Analysis Engine

### Rules-Based Recommendation System

The `generatePriceRecommendations()` function in `competitor-intelligence.js` applies three rules:

#### Rule 1: Underpriced Sites
```
If: Your rate < Market average * 0.85
Then: Suggest = Market average * 0.95
Confidence = min(0.95, (market / your_rate) * 0.5)
Reason: "Underpriced by X%. Recommend increase to $Y/night."
```

Rationale: If you're 15%+ below market, raising rates to 95% of market captures upside with low occupancy risk.

#### Rule 2: Overpriced Sites
```
If: Your rate > Market average * 1.15
Then: Suggest = Market average * 1.05
Confidence = min(0.95, (your_rate / market) * 0.4)
Reason: "Overpriced by X%. Recommend decrease to $Y/night."
```

Rationale: If you're 15%+ above market, lowering to 105% of market improves occupancy without leaving money on table.

#### Rule 3: Market-Matched Sites (Optimization)
```
If: ABS(Your rate - Market) <= Market * 0.15
Then: If variance > 5%:
  Suggest = Market average
  Confidence = 0.7
  Reason: "Current rate is within market range. Suggest adjustment..."
```

Rationale: Fine-tune sites within acceptable range for exact market alignment.

### Confidence Scoring

Confidence reflects how reliable a recommendation is:

- **0.9-1.0 (Very High)**: Clear data, large gap, multiple competitors
- **0.7-0.9 (High)**: Good data, moderate gap
- **0.5-0.7 (Moderate)**: Limited data or small gap
- **<0.5 (Low)**: Insufficient data, very recent market entry

### Revenue Impact Estimation

```
Estimated monthly bookings = 30 (baseline for all site types)
Revenue impact = (Suggested rate - Current rate) * Estimated monthly bookings

Example:
Current rate: $100/night = 10000 cents
Suggested rate: $110/night = 11000 cents
Difference: 1000 cents
Monthly impact: 1000 * 30 = 30000 cents = $300/month
```

---

## Dashboard UI

### Components

#### 1. Market Overview Card
- Your avg rate vs market average vs competitors
- Position badge (Underpriced/Competitive/Overpriced)
- Summary stats (competitors tracked, sites managed, opportunities)

#### 2. Competitor Tracking Section
- Table: Competitor name, avg rate, occupancy signal, last updated
- Add competitor form (URL input)
- Remove competitor button per row

#### 3. Price Comparison Chart
- Bar chart: Your rate vs each competitor (by site type)
- Time period selector (7/30/90 days)
- Color-coded bars for visual comparison

#### 4. Pricing Opportunities Cards
- One card per opportunity (underpriced or overpriced site)
- Current rate vs suggested rate
- Estimated revenue impact
- "Apply Suggestion" button (integrates with pricing engine)

#### 5. Market Trends Chart
- Line chart: market average trend over 90 days
- Overlay your average rate
- Legend: market vs your rates

#### 6. Risk Alerts
- Red banner: Significantly overpriced (>15% above market)
- Yellow banner: New competitors or market volatility
- Green banner: Revenue opportunities identified

### Responsive Design

- **Desktop** (1200px+): Full 4-column grid for opportunities
- **Tablet** (768px): 2-column grid, resized charts
- **Mobile** (375px): Single column, simplified charts

### Dark Mode
All components use CSS variables that respect `prefers-color-scheme: dark`.

---

## Integration Points

### With Pricing Engine (`pricing-engine.js`)

When staff clicks "Apply Suggestion" on an opportunity card:

1. Frontend calls `/api/admin/pricing` with `action: 'updateSiteRate'`
2. Pricing engine validates suggestion
3. If approved, updates site's `nightly_rate_cents`
4. Logs change in `pricing_log` table
5. Refreshes dashboard to show new position

### With Analytics (`analytics-engine.js`)

Market analytics feed the analytics dashboard:
- Market position chart
- Revenue trend overlay (your rates vs market average)
- Seasonal pricing comparison

### With CRM (`crm-engine.js`)

For guest segmentation:
- Loyal guests → show historical booking patterns + price sensitivity
- Occasional guests → may be price-driven, suggest competitive rates
- At-risk guests → market data informs winback campaign pricing

### With OTA Integration (`ota-manager.js`)

When syncing to OTA channels (Airbnb, Booking.com):
- Use suggested rates if available
- Competitor data informs dynamic pricing limits (min/max)
- Market analysis prevents undercutting strategy errors

---

## Performance Considerations

### Caching Strategy

- **Market Analytics**: Cached for 24 hours (one row per day)
- **Competitor Pricing**: Cached for 24 hours (one row per day per competitor)
- **Suggestions**: Regenerated on each dashboard load (quick if data cached)

### Query Optimization

- All tables have indexed foreign keys and date fields
- Unique constraints on `(park_id, website_url)` and `(park_id, date)` prevent duplicates
- `ORDER BY date DESC LIMIT` queries use indexes efficiently

### Scraping Rate Limits

- 2-second delay between competitors (prevents hammering single server)
- 15-second timeout per request (don't hang waiting for slow servers)
- Max 5 competitors per park (15 competitors max across all parks in system)
- Automatic backoff on repeated failures

### API Response Times

Typical response times (Postgres, Vercel):
- Dashboard summary: 200-400ms (parallel queries)
- Competitor list: 50-100ms
- Trends (90 days): 150-300ms
- Suggestions: 100-200ms (calculation based on cached data)

---

## Future Enhancements

### Phase 4 Opportunities

1. **Competitor-to-Competitor Matching**
   - Auto-match competitors by location/size/amenities
   - Suggest "peer group" (3-5 most similar parks) instead of manual selection

2. **Occupancy Signals**
   - Scrape booking calendars (if public)
   - Estimate competitor occupancy % alongside rates
   - Adjust recommendations based on occupancy gaps

3. **Seasonal Analysis**
   - Detect seasonal pricing patterns in competitor data
   - Suggest seasonal rate cards for your sites
   - Historical comparison across summers/winters

4. **Machine Learning**
   - Train model on historical rate changes + revenue outcomes
   - Predict optimal rates with confidence intervals
   - A/B test recommendations with holdout group

5. **Competitor Alerts**
   - Notify staff when competitor rate drops >10%
   - Alert when new competitor enters market
   - Monthly market summary email

6. **Integration with Revenue Manager Tools**
   - Export competitor data to Excel/CSV
   - API for third-party revenue management software
   - Real-time Slack notifications for key changes

7. **Advanced Positioning**
   - Premium vs budget tier comparison (by amenities)
   - Distance-based local market analysis (5-mile radius)
   - Seasonal peer groups (summer tourist season vs winter long-term)

---

## Support & Troubleshooting

### Common Issues

**Competitors not updating**: Check `last_scraped` timestamp. If old, manual refresh may be needed (`POST ?action=refresh`). Verify competitor URL is correct.

**No opportunities shown**: Need at least 3 days of competitor data to generate reliable suggestions. Market data is aggregated daily.

**High confidence scores**: Indicates clear pricing gap or many competitors. High confidence = act quickly.

**Low confidence scores**: Insufficient data or small gap. Wait for more data before adjusting rates.

---

## Contact & Questions

For implementation support, refer to:
- `COMPETITIVE_INTELLIGENCE_QUICK_REFERENCE.md` (quick lookup)
- Codebase comments in `competitor-intelligence.js`
- API route documentation in `api/admin/competitive-intelligence.js`
