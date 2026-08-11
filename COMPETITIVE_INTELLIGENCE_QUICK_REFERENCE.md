# Competitive Intelligence — Quick Reference

## Files Overview

| File | Purpose | Lines | Key Functions |
|------|---------|-------|---|
| `api/_lib/competitor-intelligence.js` | Analysis engine | 400+ | `getPriceComparison()`, `suggestPriceAdjustment()`, `getMarketTrends()`, `identifyPricingOpportunities()` |
| `api/admin/competitive-intelligence.js` | API routes | 300+ | GET: dashboard-summary, market-rates, suggestions, trends, positioning, opportunities |
| `src/js/competitive-intelligence-dashboard.js` | UI renderer | 500+ | `initializeCompetitiveIntelligenceDashboard()`, render functions for each section |
| `src/css/competitive-intelligence.css` | Styling | 250+ | Cards, charts, alerts, responsive design |
| `api/_lib/reservations-store.js` | Database | Modified | New: `addCompetitor()`, `recordCompetitorPricing()`, `recordMarketAnalytics()`, etc. |

---

## Database Tables (4 New)

### `competitors`
Track competitor parks.
```sql
park_id, name, website_url, location, scrape_enabled, last_scraped
```

### `competitor_pricing`
Daily price snapshots from each competitor.
```sql
competitor_id, date, avg_rate_cents, low_rate_cents, high_rate_cents, occupancy_signal
```

### `market_analytics`
Aggregated market benchmarks per day.
```sql
park_id, date, market_avg_rate_cents, market_median_cents, price_percentile, competitor_count
```

### `pricing_suggestions`
AI recommendations for your sites.
```sql
park_id, site_id, suggested_rate_cents, confidence_score, reason
```

---

## Key API Endpoints

### Dashboard Summary (all data at once)
```
GET /api/admin/competitive-intelligence?action=dashboard-summary
```
Returns: positioning, opportunities, trends, summary stats

### Market Rates (by site type)
```
GET /api/admin/competitive-intelligence?action=market-rates&siteType=rv
```
Returns: yourAvgRate, marketAverage, position

### Suggestions (for all sites)
```
GET /api/admin/competitive-intelligence?action=suggestions
```
Returns: array of suggestions sorted by confidence

### Trends (90-day history)
```
GET /api/admin/competitive-intelligence?action=trends&days=90
```
Returns: trend data + direction (upward/downward)

### Opportunities (revenue uplift potential)
```
GET /api/admin/competitive-intelligence?action=opportunities
```
Returns: sorted by monthly revenue impact

### Add Competitor
```
POST /api/admin/competitive-intelligence
{
  "action": "add-competitor",
  "name": "Park Name",
  "websiteUrl": "https://...",
  "location": "City, State"
}
```

### Remove Competitor
```
DELETE /api/admin/competitive-intelligence
{
  "competitorId": "comp-123"
}
```

---

## Recommendation Rules

| Condition | Suggestion | Confidence | Action |
|-----------|-----------|------------|--------|
| Rate < Market × 0.85 | Market × 0.95 | 0.5-0.95 | Raise prices |
| Rate > Market × 1.15 | Market × 1.05 | 0.4-0.95 | Lower prices |
| Within ±15% of market | Market average | 0.7 | Fine-tune |

**Formula**: 
- Underpriced gap size × 0.5 = confidence
- Overpriced gap size × 0.4 = confidence

---

## Dashboard UI Sections

### 1. Risk Alerts
- 🔴 Red: >15% overpriced
- 🟡 Yellow: Market volatility, new competitors
- 🟢 Green: Revenue opportunities available

### 2. Market Overview
- Your avg rate vs market average
- Position badge (Underpriced/Competitive/Overpriced)
- Metrics: competitors tracked, sites managed, opportunities

### 3. Competitor Tracking
- Table: name, avg rate, last updated
- Add/remove competitors via modal form

### 4. Price Comparison Chart
- Bar chart: your rates vs each competitor
- Selector: 7/30/90 days

### 5. Pricing Opportunities
- Cards: current rate, suggested rate, monthly impact
- "Apply Suggestion" button (opens pricing dashboard)

### 6. Market Trends
- Line chart: market average trend
- Overlay: your average rate
- Direction: upward/downward

---

## Metrics & Calculations

### Price Position
```
Position % = ((Your Rate - Market Avg) / Market Avg) × 100

Position Label:
- < -10% → Underpriced
- -5% to +5% → Market-matched
- +5% to +15% → Competitive  
- > +15% → Overpriced
```

### Revenue Impact
```
Monthly Impact = (Suggested Rate - Current Rate) × 30

Example: +$10/night = +$300/month revenue uplift
```

### Confidence Score
```
0.0-0.4: Low (insufficient data)
0.4-0.7: Moderate (limited data or small gap)
0.7-0.9: High (good data, clear gap)
0.9-1.0: Very high (excellent data, large gap)
```

---

## Integration Checklist

- ✅ Database: 4 tables added to `reservations-store.js`
- ✅ Data layer: CRUD functions for all tables
- ✅ API: GET/POST/DELETE routes
- ✅ Analysis: Competitor intelligence engine
- ✅ Frontend: Dashboard UI with charts
- ✅ Styling: CSS with dark mode support
- ✅ Integration: Added to park-dashboard.html & .js
- ⏳ Scheduled job: Nightly competitor refresh (future)

---

## Testing Checklist

- [ ] Add competitor via form
- [ ] View competitors in table
- [ ] Remove competitor
- [ ] Check dashboard summary loads
- [ ] Verify positioning calculations correct
- [ ] Test bar chart rendering (7/30/90 days)
- [ ] Test trend line chart (if data exists)
- [ ] Verify opportunity cards show correct estimates
- [ ] Click "Apply Suggestion" (routes to pricing dashboard)
- [ ] Test mobile responsive (375px, 768px, 1200px)
- [ ] Dark mode rendering

---

## Performance Tips

### For Dashboard Load
- All data fetched in parallel (Promise.all)
- Market analytics cached at database level
- Suggestions regenerated fresh (fast calculation)

### For Scraping
- 2-second delay between competitors (rate limit)
- 15-second timeout per request
- Up to 2 retries with exponential backoff
- Max 5 competitors per park

### For Database
- All indexes in place on foreign keys & dates
- Unique constraints prevent duplicates
- Partitioning by date available if >1M rows

---

## Debugging

### Check Competitor Data
```sql
SELECT * FROM competitors WHERE park_id = $1;
SELECT * FROM competitor_pricing ORDER BY date DESC LIMIT 10;
SELECT * FROM market_analytics WHERE park_id = $1 ORDER BY date DESC LIMIT 10;
SELECT * FROM pricing_suggestions WHERE park_id = $1;
```

### Verify Scraping
```javascript
// In browser console:
fetch('/api/admin/competitive-intelligence?action=dashboard-summary')
  .then(r => r.json())
  .then(d => console.log(d));
```

### Test API
```bash
# View competitors
curl -H "Cookie: auth=..." https://app.rvparksuccess.com/api/admin/competitive-intelligence?action=competitors

# Add competitor
curl -X POST -H "Content-Type: application/json" \
  -d '{"action":"add-competitor","name":"Test","websiteUrl":"https://test.com"}' \
  https://app.rvparksuccess.com/api/admin/competitive-intelligence
```

---

## Common Tasks

### Add a Competitor
1. Dashboard → Competitive Pricing Intelligence
2. Click "Add Competitor"
3. Enter name, URL, location (optional)
4. Click "Add"
5. Wait for first scrape (manual or nightly scheduled job)

### View Market Positioning
1. Dashboard → Market Overview card
2. Check position badge and percentages
3. Compare your rate vs market average

### Get Price Recommendations
1. Dashboard → Pricing Opportunities section
2. Cards show suggested rates + revenue impact
3. Click "Apply Suggestion" to update site rate

### Analyze Trends
1. Dashboard → Market Trends chart
2. See 90-day history of market average
3. Overlay shows your average rate

### Remove a Competitor
1. Dashboard → Competitors section
2. Find competitor in table
3. Click "Remove"
4. Confirm deletion

---

## API Response Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Data returned |
| 201 | Created | Competitor added |
| 400 | Bad request | Check parameters |
| 404 | Not found | Park/site not found |
| 405 | Method not allowed | Use correct HTTP method |

---

## Environment Variables

No new env vars required. Existing:
- `DATABASE_URL` or `POSTGRES_URL` (Postgres connection)
- Session auth (inherited from existing auth system)

Optional for future (nightly jobs):
- `CRON_SECRET` (Vercel Cron authorization)

---

## Dependencies

**Zero new packages required!**

Uses existing:
- `pg` (Postgres)
- `bcryptjs` (auth)
- Node.js `fetch` API (web scraping)

---

## Rate Limiting

Competitor scraping:
- Max 5 competitors per park
- 2-second delay between scrapes
- 15-second timeout per request
- Up to 2 retries (exponential backoff)

API:
- No specific rate limit (inherits from park auth)
- Suitable for staff dashboard access

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| No opportunities shown | <3 days data or rates in market range | Wait for more data, add more competitors |
| High confidence but wrong suggestion | Market outlier | Add more competitors or review data |
| Competitors not scraping | Wrong URL or site layout changed | Verify URL, try manual refresh |
| Dashboard slow to load | Many competitors or large trend range | Reduce competitor count or date range |
| Mobile chart hard to read | Small viewport | Responsive design handles, zoom browser |

---

## Next Steps (Phase 4)

- [ ] Occupancy signal extraction
- [ ] Seasonal rate analysis
- [ ] Machine learning confidence predictions
- [ ] Competitor alerts (Slack, email)
- [ ] Historical performance tracking (did rate change work?)
- [ ] Peer group auto-matching
- [ ] Export to CSV/PDF

---

## Questions?

Refer to:
- **Full guide**: `COMPETITIVE_INTELLIGENCE_IMPLEMENTATION.md`
- **Code comments**: `api/_lib/competitor-intelligence.js`
- **API docs**: `api/admin/competitive-intelligence.js` route comments
- **UI code**: `src/js/competitive-intelligence-dashboard.js`
