# Dynamic Pricing Engine — RVPark Success

## Overview

The Dynamic Pricing Engine is an AI-powered system that automatically calculates optimal nightly rates for RV park sites based on real-time demand, occupancy, seasonality, and booking window. Parks can toggle dynamic pricing on/off and manually review/apply suggestions before they take effect.

**Estimated Revenue Impact**: 15-30% increase in revenue when dynamic pricing is enabled and followed.

---

## Features

### 1. Intelligent Price Calculation
- **Occupancy-based pricing**: Higher occupancy = higher rates
  - ≤50% occupancy: 1.0x baseline
  - 50-80% occupancy: 1.05x
  - 80-90% occupancy: 1.15x
  - >90% occupancy: 1.25x

- **Booking window multiplier**: Incentivizes last-minute bookings
  - 60+ days out: 0.90x (early-bird discount)
  - 30-60 days: 1.0x (baseline)
  - 14-30 days: 1.05x
  - 7-14 days: 1.10x
  - 3-7 days: 1.15x
  - 0-3 days: 1.25x (premium)

- **Seasonality multiplier**: Peak/shoulder/off-season rates
  - Peak (Jul-Aug, holidays): 1.3x
  - Shoulder (Jun, Sep): 1.1x
  - Off-season (Jan-May, Oct-Nov): 0.85x
  - Custom peak date ranges: Configure your own peak seasons

- **Day-of-week premium**: Weekend rates higher than weekdays
  - Friday: 1.1x
  - Saturday: 1.2x
  - Sunday: 1.15x
  - Mon-Thu: 1.0x (baseline)

- **Site-level customization**: Price modifier per site (0.5x - 2.0x)
  - Premium sites: 1.2x modifier
  - Budget sites: 0.8x modifier

### 2. Price Bounds
- Minimum price floor: Never drops below 80% of base rate
- Maximum price ceiling: Never exceeds 150% of base rate
- Configurable per park via dashboard

### 3. Confidence Scoring
- 0-100% confidence score on each suggestion
- Based on:
  - Amount of historical data available
  - Occupancy volatility
  - Proximity to booking date
  - Data quality

### 4. Batch Suggestions
- Calculate prices for date ranges (30/60/90 days)
- Per-site + per-date granularity
- Revenue impact analysis
- Occupancy forecast display

### 5. Safety Guards
- **Manual approval required**: No automatic price changes
- **48-hour grace period**: Don't change prices within 48 hours of arrival
- **30-day cautious period**: Require approval for first 30 days of bookings
- **Audit trail**: Every price change logged with reason + confidence
- **Min/max bounds**: Park can set price floors and ceilings

### 6. Revenue Analytics
- Track suggested vs. actual rates
- Calculate revenue opportunity (what if you followed suggestions?)
- Identify patterns by season/occupancy/day-of-week
- Monthly revenue impact summary

---

## API Endpoints

### `GET /api/admin/pricing`
Fetch all pricing data: settings, current suggestions, logs, and peak date ranges.

**Response:**
```json
{
  "settings": {
    "dynamicPricingEnabled": true,
    "minPriceCents": 2000,
    "maxPriceCents": 50000,
    "occupancyTargetPercent": 85
  },
  "sites": [
    {
      "id": "site-123",
      "name": "Full Hookup A",
      "baseRate": 5000,
      "priceModifier": 1.0
    }
  ],
  "peakRanges": [
    {
      "id": "peak-1",
      "label": "Fourth of July Week",
      "startDate": "2026-07-01",
      "endDate": "2026-07-08"
    }
  ],
  "pricingLog": [
    {
      "id": "plog-1",
      "siteId": "site-123",
      "dateOfStay": "2026-08-15",
      "previousRateCents": 5000,
      "suggestedRateCents": 6250,
      "appliedRateCents": 6250,
      "status": "applied",
      "confidence": 85,
      "appliedAt": "2026-08-10T14:30:00Z"
    }
  ]
}
```

### `POST /api/admin/pricing`

#### Action: `calculate`
Calculate suggested prices for a date range.

**Request:**
```json
{
  "action": "calculate",
  "dateRange": {
    "start": "2026-08-15",
    "end": "2026-09-15"
  },
  "includeRecommendations": true
}
```

**Response:**
```json
{
  "suggestions": [
    {
      "siteId": "site-123",
      "siteName": "Full Hookup A",
      "date": "2026-08-15",
      "occupancyPercent": 78,
      "currentRate": 5000,
      "suggestedRate": 5250,
      "multiplier": 1.05,
      "confidence": 82,
      "reasoning": {
        "baseRate": "$50.00",
        "occupancyFactor": "78% occupancy → 105%",
        "bookingWindow": "6 days out → 115%",
        "seasonality": "peak season → 130%",
        "dayOfWeek": "Fri → 110%",
        "siteModifier": "standard",
        "finalMultiplier": "105%"
      }
    }
  ],
  "potentialImpact": {
    "potentialRevenueCents": 15000,
    "percentageGain": 5.8,
    "currentRevenueTotal": 258000,
    "potentialRevenueTotal": 273000
  }
}
```

#### Action: `updateSettings`
Update pricing configuration.

**Request:**
```json
{
  "action": "updateSettings",
  "minPriceCents": 2000,
  "maxPriceCents": 50000,
  "occupancyTargetPercent": 85
}
```

#### Action: `applyPrice`
Apply a suggested price to a site/date.

**Request:**
```json
{
  "action": "applyPrice",
  "siteId": "site-123",
  "dateOfStay": "2026-08-15",
  "previousRate": 5000,
  "appliedRateCents": 5250
}
```

#### Action: `toggleDynamicPricing`
Turn dynamic pricing on/off.

**Request:**
```json
{
  "action": "toggleDynamicPricing"
}
```

#### Action: `updateSiteModifier`
Set a site's price modifier (0.5 - 2.0).

**Request:**
```json
{
  "action": "updateSiteModifier",
  "siteId": "site-123",
  "priceModifier": 1.2
}
```

#### Action: `addPeakRange`
Define a custom peak season date range.

**Request:**
```json
{
  "action": "addPeakRange",
  "label": "Fall Festival Week",
  "startDate": "2026-10-15",
  "endDate": "2026-10-22"
}
```

#### Action: `removePeakRange`
Remove a custom peak season.

**Request:**
```json
{
  "action": "removePeakRange",
  "rangeId": "peak-123"
}
```

---

## Database Schema

### Parks Table (additions)
```sql
ALTER TABLE parks ADD COLUMN IF NOT EXISTS dynamic_pricing_enabled BOOLEAN DEFAULT false;
ALTER TABLE parks ADD COLUMN IF NOT EXISTS min_price_cents INTEGER DEFAULT 2000;
ALTER TABLE parks ADD COLUMN IF NOT EXISTS max_price_cents INTEGER DEFAULT 50000;
ALTER TABLE parks ADD COLUMN IF NOT EXISTS occupancy_target_percent INTEGER DEFAULT 85;
```

### Sites Table (additions)
```sql
ALTER TABLE sites ADD COLUMN IF NOT EXISTS price_modifier NUMERIC DEFAULT 1.0;
```

### New Tables
```sql
CREATE TABLE pricing_log (
  id TEXT PRIMARY KEY,
  park_id TEXT REFERENCES parks(id),
  site_id TEXT REFERENCES sites(id),
  date_of_stay DATE,
  previous_rate_cents INTEGER,
  suggested_rate_cents INTEGER,
  applied_rate_cents INTEGER,
  status TEXT DEFAULT 'pending', -- pending, applied, reverted
  applied_by TEXT,
  applied_at TIMESTAMPTZ,
  reservation_id TEXT REFERENCES reservations(id),
  actual_revenue_cents INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE peak_date_ranges (
  id TEXT PRIMARY KEY,
  park_id TEXT REFERENCES parks(id),
  label TEXT,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Dashboard UI

### Pricing Intelligence Section

Located in the park dashboard under "Revenue Optimization" → "Pricing Intelligence"

#### Features:
1. **Toggle Dynamic Pricing**: On/off switch (requires careful decision)
2. **Settings Cards**:
   - Min Rate (e.g., $20)
   - Max Rate (e.g., $500)
   - Occupancy Target (e.g., 85%)
3. **Calculate Suggestions**: Date range picker + calculate button
4. **Suggestions Table**: Shows date, site, current/suggested rate, change, occupancy, confidence
5. **One-Click Apply**: Apply individual suggestions or batch-apply all
6. **Revenue Impact**: Shows potential revenue gain if suggestions are followed

### Pricing Settings

Accessible via the "Park Settings" section for advanced configuration:
- Custom peak date ranges
- Site-level price modifiers
- Min/max bounds
- Historical data review

---

## Implementation Guide

### For Park Owners

1. **Enable Dynamic Pricing**
   - Go to dashboard → Pricing Intelligence
   - Toggle "Dynamic Pricing ON"
   - Review your min/max price bounds

2. **Calculate Suggestions**
   - Pick a date range (e.g., next 30 days)
   - Click "Calculate Prices"
   - Review the suggestions table

3. **Apply Suggestions**
   - Review confidence scores (aim for 70%+)
   - Click "Apply" on individual suggestions OR "Apply All Suggestions"
   - Each applied change is logged for audit trail

4. **Monitor Revenue Impact**
   - Check "Potential Revenue Impact" card
   - Review monthly gains in the stats dashboard
   - Adjust min/max bounds if needed

5. **Customize for Your Park**
   - Add peak date ranges (holidays, festivals)
   - Set site-level modifiers (premium vs. budget sites)
   - Adjust occupancy target based on strategy

### For Developers

#### Using the Pricing Engine in Custom Code

```javascript
import { calculatePrice } from './api/_lib/pricing-engine.js';

const result = calculatePrice({
  baseRateCents: 5000,           // $50.00
  checkInDate: '2026-08-15',
  siteOccupancyPercent: 78,      // Currently 78% booked
  siteModifier: 1.0,             // Standard site
  peakDateRanges: [],            // No custom peaks
});

console.log(result.suggestedCents); // 5250 ($52.50)
console.log(result.confidence);     // 82
console.log(result.reasoning);      // Breakdown of multipliers
```

#### Batch Calculation

```javascript
import { calculatePricesForDateRange } from './api/_lib/pricing-engine.js';

const prices = calculatePricesForDateRange({
  baseRateCents: 5000,
  checkInDate: '2026-08-15',
  checkOutDate: '2026-09-15',
  dailyOccupancyPercents: {
    '2026-08-15': 78,
    '2026-08-16': 92,
    // ... more dates
  },
  siteModifier: 1.0,
  peakDateRanges: [],
});

// Returns array of { date, occupancyPercent, suggestedCents, multiplier, confidence }
```

#### Revenue Impact Analysis

```javascript
import { analyzePricingImpact } from './api/_lib/pricing-engine.js';

const impact = analyzePricingImpact(reservations, suggestedPrices);
console.log(impact.potentialRevenueCents); // Extra revenue if suggestions followed
console.log(impact.percentageGain);        // 5.8% more revenue
```

---

## Configuration Examples

### Conservative Strategy (Risk-Averse)
```json
{
  "dynamicPricingEnabled": true,
  "minPriceCents": 4500,        // Don't drop below $45
  "maxPriceCents": 7500,        // Don't exceed $75
  "occupancyTargetPercent": 90  // Target high occupancy
}
```

### Aggressive Strategy (Revenue-Focused)
```json
{
  "dynamicPricingEnabled": true,
  "minPriceCents": 2500,        // Allow discounts to $25
  "maxPriceCents": 15000,       // Allow premiums up to $150
  "occupancyTargetPercent": 75  // Accept lower occupancy for higher rates
}
```

### Seasonal Park
```json
{
  "dynamicPricingEnabled": true,
  "minPriceCents": 1500,
  "maxPriceCents": 20000,
  "occupancyTargetPercent": 85,
  "peakDateRanges": [
    { "label": "Summer", "startDate": "2026-06-01", "endDate": "2026-08-31" },
    { "label": "Holidays", "startDate": "2026-12-20", "endDate": "2027-01-05" }
  ]
}
```

---

## Monitoring & Optimization

### Key Metrics to Track
1. **Adoption Rate**: % of dates using dynamic pricing
2. **Revenue Gain**: Actual vs. baseline revenue
3. **Occupancy**: Does pricing push bookings up/down?
4. **Average Daily Rate (ADR)**: Track movement over time
5. **Confidence Trend**: Are suggestions getting more accurate?

### When to Adjust Settings
- **Revenue not improving?** → Increase max price ceiling
- **Occupancy dropping?** → Lower min price floor or reduce aggressiveness
- **Specific season underperforming?** → Add custom peak date range
- **Premium sites not booked?** → Increase site modifier, reduce base rate

---

## Safety & Compliance

### Price Change Restrictions
- ✗ Cannot change prices within 48 hours of arrival
- ✗ Cannot override park-set min/max bounds
- ✗ Requires manual approval (no auto-apply)

### Audit Trail
All pricing changes are logged with:
- Previous rate, suggested rate, applied rate
- Date and time of change
- User who applied the change
- Confidence score and reasoning
- Resulting occupancy/revenue

### Refund & Dispute Prevention
- Guests see the agreed-upon rate at booking
- No retroactive changes to confirmed reservations
- Dynamic pricing affects future bookings only
- Clear communication in booking confirmation

---

## Troubleshooting

### Suggestions Too Aggressive
→ Lower the `maxPriceCents` or set higher `occupancyTargetPercent`

### Suggestions Too Conservative
→ Raise the `maxPriceCents` or lower `occupancyTargetPercent`

### Low Confidence Scores
→ More historical data = higher confidence. Wait for more bookings.

### No Availability Data
→ System needs at least some past bookings to calculate occupancy. Suggestions improve over time.

### Prices Not Changing
→ Check if dynamic pricing is enabled. Check min/max bounds. Verify occupancy on target dates.

---

## Future Enhancements

- [ ] Competitor pricing integration (scrape market rates)
- [ ] Machine learning: learn from your past booking patterns
- [ ] Demand forecasting: predict bookings before they happen
- [ ] A/B testing: test different pricing strategies
- [ ] Custom rules engine: "if occupancy >90%, add 20%" rules
- [ ] Email alerts: daily digest of major price changes
- [ ] Mobile app: approve prices on the go
- [ ] Channel integration: sync rates to Airbnb, VRBO, etc.

---

## Support

For questions or feature requests, contact RVPark Success support at `support@rvparksuccess.com`.

**Documentation Last Updated**: August 2026
**Pricing Engine Version**: 1.0.0
