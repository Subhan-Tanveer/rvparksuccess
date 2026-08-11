# Occupancy Forecasting Engine — Complete Guide

## Overview

The Occupancy Forecasting Engine predicts park occupancy for the next 90 days using historical data, seasonal patterns, booking trends, and market signals. It helps park managers optimize staffing, plan maintenance, manage inventory, and create targeted promotions.

## Core Features

### 1. 90-Day Occupancy Forecast

Generates daily occupancy percentage forecasts for the next 90 days with confidence intervals.

**Key Metrics:**
- **Forecast Occupancy**: Predicted occupancy % for each day (0-100%)
- **Confidence Interval**: Lower and upper bounds reflecting forecast uncertainty
- **Confidence Margin**: Width of the uncertainty band (typically ±5-35%)
- **Trend**: Direction of change (↑ improving, ↓ declining, → stable)

**How It Works:**
1. Analyzes 365 days of historical occupancy data
2. Decomposes seasonal patterns (identifying peaks and lows)
3. Calculates trend direction via linear regression
4. Measures current booking pace vs. historical average
5. Blends components with weighted formula
6. Widens confidence intervals further into future (less certain)

**Uses:**
- Plan promotional campaigns during predicted low-occupancy periods
- Schedule maintenance during slow periods
- Adjust staffing levels proactively
- Optimize inventory management

---

### 2. Seasonal Calendar

12-month heatmap showing historical and predicted occupancy patterns month-by-month.

**Display:**
- Color intensity: red (low occupancy 0-40%) → yellow (40-60%) → orange (60-80%) → green (high 80-100%)
- Season labels: Peak (May-Sept), Shoulder (April, Oct), Low (Nov-March)
- Monthly average occupancy percentage
- Individual day data on hover

**Uses:**
- Identify seasonal patterns and peak periods
- Plan annual marketing campaigns
- Understand your park's natural demand cycles
- Set realistic occupancy targets by season

**Interpretation Guide:**
- **Peak Season (Green)**: 75%+ occupancy expected. Full staffing, premium pricing.
- **Shoulder Season (Orange)**: 50-75% occupancy. Standard operations.
- **Low Season (Blue)**: <50% occupancy. Minimal staff, heavy discounts, maintenance.

---

### 3. Booking Pace Analysis

Compares current booking rate to historical averages to determine if you're ahead or behind schedule.

**Key Metrics:**
- **Booking Pace Index**: 100 = normal, 120 = 20% faster than normal, 80 = 20% slower
- **Average Lead Time**: Days in advance guests typically book (e.g., 40 days)
- **Recent Anomalies**: Unusual booking patterns (group bookings, high/low rates)

**Interpretation:**
- **Pace > 120%**: Booking faster than usual. Strong demand. Consider raising rates.
- **Pace 80-120%**: Normal pace. No action needed.
- **Pace < 80%**: Booking slower than usual. Launch promotional campaigns.

**Uses:**
- Detect emerging demand trends early
- Respond quickly to market changes
- Time promotional campaigns for maximum impact
- Adjust pricing based on booking velocity

---

### 4. Capacity Utilization Gauge

Shows what percentage of your available capacity you're actually selling.

**Example:**
- Park: 20 sites × 30 days = 600 potential site-nights
- Booked: 490 site-nights
- Utilization: 82%
- Target: 85%
- Gap: +3% needed to reach target

**Components:**
- **Total Capacity**: sites × days available
- **Booked Nights**: confirmed reservations
- **Utilization %**: (booked nights / total capacity) × 100
- **Target**: typically 85% (industry benchmark)
- **Gap**: how many more nights to book to hit target

**Uses:**
- Track overall business health
- Set realistic revenue targets
- Identify capacity constraints
- Plan expansion (if consistently >95%)

---

### 5. Underutilized Dates

Identifies low-occupancy periods and recommends actions (discounts, promotions).

**For Each Period:**
- **Date Range**: Start and end dates
- **Expected Occupancy**: Forecast occupancy % (e.g., 35%)
- **Nights**: Number of low-occupancy nights
- **Potential Loss**: Estimated revenue loss if not filled
- **Recommendation**: Suggested action (discount size, campaign type)

**Recommendation Tiers:**
- **1-10% gap**: Monitor closely
- **11-25% gap**: Light discount (5-10%) or small promotion
- **26-50% gap**: Moderate discount (10-20%) or campaign
- **>50% gap**: Urgent. Deep discount or special offer needed

**Uses:**
- Create targeted promotional campaigns
- Manage seasonal downturn
- Plan inventory and maintenance timing
- Set dynamic pricing thresholds

---

### 6. Staffing Recommendations

Suggests staffing levels for the next 90 days based on forecasted occupancy.

**Three Levels:**
1. **High Occupancy (80%+)**
   - Full staff recommended
   - Add 1-2 seasonal staff for peak periods
   - Prepare for high check-in/check-out volume
   - Stock inventory accordingly

2. **Medium Occupancy (50-80%)**
   - Standard staffing level
   - No changes needed
   - Normal operations

3. **Low Occupancy (<50%)**
   - Minimal staff required
   - Consider temporary layoffs or unpaid leave
   - Focus on maintenance and marketing
   - Reduce supply purchases

**Cost Impact:**
- Each seasonal staff addition: ~$15-20/hour × hours scheduled
- Reducing staff: Save proportionally
- Maintenance during low periods: Better than during peak

**Uses:**
- Plan hiring and layoff timing
- Budget labor costs accurately
- Schedule training and team-building
- Communicate staffing changes in advance

---

### 7. Peak Season Prediction

Identifies when your next high-occupancy period will occur.

**Output:**
- Start and end dates of peak period
- Expected occupancy during peak (e.g., 86%)
- Days until peak (e.g., "45 days away")

**Preparation Checklist:**
- Staff hiring: Post jobs 4-6 weeks before peak
- Supply ordering: Increase 3-4 weeks before
- Marketing: Launch campaigns 6-8 weeks before
- Maintenance: Complete before peak starts
- Pricing: Adjust rates 2-3 weeks before peak

---

### 8. Occupancy Trend (365-Day Analysis)

Measures whether occupancy is improving or declining over the past year.

**Metrics:**
- **Direction**: ↑ improving, ↓ declining, → stable
- **Slope**: % change per day (e.g., +0.05% per day = +18% per year)
- **Change Over 365 Days**: Total % change (e.g., +15% year-over-year)
- **Model Fit (R²)**: How well trend explains variation (0-1, higher is better)

**Interpretation:**
- **↑ Improving**: Business growing. Maintain current strategy.
- **↓ Declining**: Business shrinking. Investigate causes (pricing, competition, quality).
- **→ Stable**: Steady state. Focus on seasonal variations.

**R² Interpretation:**
- **R² > 0.7**: Strong trend, forecasts very reliable
- **R² 0.4-0.7**: Moderate trend, forecasts useful with caveats
- **R² < 0.4**: Weak trend, high volatility, many other factors at play

---

## Dashboard Sections

### Layout

The Occupancy Forecasting Dashboard includes:

1. **Top Section**: 90-day forecast chart with confidence band
2. **Seasonal Calendar**: 12-month heatmap view
3. **Booking Pace**: Current vs. historical comparison
4. **Capacity Gauge**: Overall utilization percentage
5. **Underutilized Dates**: Low-occupancy periods and actions
6. **Staffing Recommendations**: Next 90 days staffing levels
7. **Peak Prediction**: When next peak season arrives
8. **Trend Analysis**: Annual occupancy trajectory

---

## API Endpoints

All endpoints require park-staff authentication and return park-scoped data.

### GET Endpoints

#### `/api/admin/occupancy-forecasting?endpoint=forecast&days=90`
Returns 90-day occupancy forecast with confidence intervals.

**Response:**
```json
{
  "forecast": [
    {
      "date": "2026-09-15",
      "dayNumber": 1,
      "forecastOccupancy": 72.5,
      "confidenceLower": 62.3,
      "confidenceUpper": 82.7,
      "confidenceMargin": 10.2,
      "season": "shoulder",
      "trend": "stable",
      "components": {
        "baseOccupancy": 65.0,
        "seasonalInfluence": 70.0,
        "trendInfluence": 50.2,
        "paceInfluence": 49.8
      }
    },
    ...
  ],
  "cachedAt": "2026-09-14T12:00:00Z",
  "cacheValidFor": 24
}
```

#### `/api/admin/occupancy-forecasting?endpoint=seasonal-calendar&year=2026`
Returns 12-month seasonal analysis with daily occupancy data.

**Response:**
```json
{
  "calendar": [
    {
      "month": 1,
      "monthName": "January",
      "year": 2026,
      "averageOccupancy": 42,
      "season": "low",
      "days": [
        {
          "date": "2026-01-01",
          "day": 1,
          "occupancy": 38,
          "season": "low",
          "isWeekend": true
        },
        ...
      ]
    },
    ...
  ],
  "updatedAt": "2026-09-14T12:00:00Z"
}
```

#### `/api/admin/occupancy-forecasting?endpoint=trend&days=365`
Returns occupancy trend analysis (improving/declining/stable).

**Response:**
```json
{
  "trend": "improving",
  "slope": 0.045,
  "r2": 0.687,
  "direction": "↑",
  "changePercent": 16.4
}
```

#### `/api/admin/occupancy-forecasting?endpoint=underutilized`
Returns low-occupancy periods needing attention.

**Response:**
```json
{
  "underutilized": [
    {
      "startDate": "2026-11-15",
      "endDate": "2026-11-20",
      "nights": 5,
      "averageOccupancy": 35,
      "potentialRevenueLoss": 24500,
      "recommendation": "Recommend promotional campaign or strategic discount (10-20%)"
    },
    ...
  ],
  "count": 3,
  "totalPotentialRevenueLoss": 98000
}
```

#### `/api/admin/occupancy-forecasting?endpoint=capacity-utilization`
Returns current capacity utilization metrics.

**Response:**
```json
{
  "utilizationPercent": 82.3,
  "potentialSiteNights": 600,
  "bookedSiteNights": 494,
  "capturedRevenueCents": 1247500,
  "gaps": [
    {
      "startDate": "2026-11-15",
      "endDate": "2026-11-20",
      "nights": 5,
      "averageOccupancy": 35,
      "potentialRevenueLoss": 24500
    }
  ]
}
```

#### `/api/admin/occupancy-forecasting?endpoint=peak-prediction`
Predicts next seasonal peak.

**Response:**
```json
{
  "peak": {
    "startDate": "2026-07-01",
    "endDate": "2026-08-31",
    "expectedOccupancy": 86,
    "daysUntilPeak": 288
  }
}
```

#### `/api/admin/occupancy-forecasting?endpoint=staffing-recommendations`
Suggests staffing levels for next 90 days.

**Response:**
```json
{
  "recommendations": [
    {
      "level": "high",
      "startDate": "2026-09-15",
      "endDate": "2026-09-20",
      "occupancy": 82,
      "recommendation": "Full staff - expected high occupancy",
      "staffAdjustment": "+2 seasonal staff"
    },
    ...
  ]
}
```

### POST Endpoints

#### `/api/admin/occupancy-forecasting?endpoint=refresh`
Manually recalculate all forecasts (normally cached for 24 hours).

**Response:**
```json
{
  "success": true,
  "message": "Forecast refreshed",
  "forecastedDays": 90,
  "lastRefreshed": "2026-09-14T12:00:00Z"
}
```

---

## Forecasting Algorithm Details

### Components

The forecast blends four components:

1. **Base Occupancy (20%)**
   - Current booked sites for that date
   - Immediate, actual data

2. **Seasonal Pattern (50%)**
   - Day-of-year occupancy from past 365 days
   - Captures recurring annual cycles
   - Smoothed across years to reduce noise

3. **Trend Component (30%)**
   - Linear regression on 90-day recent history
   - Captures improving/declining business
   - Small impact to avoid overfitting

4. **Booking Pace (20%)**
   - Compare current bookings at "X days out" vs. history
   - High weighting indicates strong/weak demand
   - Adapts as new bookings come in

**Formula:**
```
Forecast = (Base × 0.2) + (Seasonal × 0.5) + (Trend × 0.3) + (Pace × 0.2)
```

### Confidence Intervals

Confidence bands widen with distance into the future:

- **Days 1-7**: ±5% (high confidence)
- **Days 8-30**: ±10% (good confidence)
- **Days 31-60**: ±18% (moderate confidence)
- **Days 61-90**: ±35% (low confidence)

Wider intervals = higher uncertainty = more reasons to monitor actual bookings.

### Anomaly Detection

Flags unusual patterns:
- Unusually long stays (>2.5× average)
- High-value bookings (>2× average price)
- Low-value bookings (<0.5× average)
- Group booking surges (>3 bookings same check-in)

---

## Using Forecasts in Practice

### Scenario 1: Low Occupancy Predicted (35%)

**Actions:**
1. Launch 10-15% discount campaign 4 weeks before
2. Push social media promotions 2 weeks before
3. Contact past guests directly with special offers
4. Reduce staff to minimal during that period
5. Schedule maintenance work (less guest interference)
6. Lower supply orders for that week

**Success Metric:** Increase forecast occupancy from 35% to 50%+

---

### Scenario 2: Peak Season Predicted (85%+ occupancy)

**Actions:**
1. Post seasonal staff jobs 6 weeks before
2. Increase supply orders 4 weeks before
3. Set rates 10-20% higher 3 weeks before
4. Halt maintenance during peak period
5. Ensure full team availability (no vacation)
6. Create upsell offers (longer stays, add-ons)

**Success Metric:** Achieve 85%+ occupancy + premium rates

---

### Scenario 3: Declining Trend Detected (↓ -2% per month)

**Actions:**
1. Investigate root cause (pricing too high? competition? reviews?)
2. Audit guest reviews for pain points
3. Check competitor rates and offerings
4. Implement improvements (marketing, amenities, service)
5. Trial rate reduction (2-5%) and measure impact
6. Increase promotional spend 15-20%

**Success Metric:** Reverse trend to stable or improving

---

## Best Practices

### 1. Review Forecasts Weekly
- Check if actual occupancy matches predictions
- Note variances (feedback loop improves model)
- Adjust tactics based on unexpected changes

### 2. Combine with Market Intelligence
- Forecasts are statistical. Combine with:
  - Competitor rate monitoring
  - Seasonal event calendars (holidays, festivals)
  - Economic indicators (recession, travel trends)
  - Weather patterns (hurricanes, snow)

### 3. Communicate with Team
- Share staffing recommendations 3+ weeks in advance
- Brief team on upcoming high/low occupancy periods
- Align marketing efforts with forecasted peaks

### 4. Test Promotional Campaigns
- Run A/B tests during low-occupancy periods
- Measure ROI of discounts vs. organic demand
- Track which messaging resonates best

### 5. Balance Pricing and Occupancy
- Higher prices → lower occupancy (trade-off)
- Sweet spot varies by season and market
- Use forecasts to test price points

---

## Troubleshooting

### Forecast Seems Off

**Check:**
1. Do you have 365+ days of historical data?
   - Early-stage parks need 1 year minimum
   - Forecasts improve after 2+ years of data

2. Are dates/times correct in your system?
   - Timezone mismatches cause errors
   - Check check-in/check-out date accuracy

3. Is actual occupancy significantly different from forecast?
   - Note the variance (actual vs. forecast)
   - Investigate why (pricing change, event, competition)
   - Feedback helps model improve

### Confidence Intervals Too Wide

- Wider bands = lower confidence = more volatility in your data
- Suggests occupancy is unpredictable
- Action: Stabilize business (consistent marketing, pricing)

### Trend Not Clear (R² < 0.4)

- High business volatility masks trend
- Too many external factors affecting occupancy
- Action: Extend analysis to 2+ years if possible

---

## FAQ

**Q: How far ahead can I forecast?**
A: System forecasts 90 days with declining confidence. Beyond 90 days becomes unreliable. For planning beyond 90 days, use seasonal patterns and past year data.

**Q: Why is confidence interval so wide on day 90?**
A: More unknowns further away. Weather, economy, competitor actions, and new bookings change the picture. By day 90, the forecast is directional, not precise.

**Q: Can I export forecasts for external analysis?**
A: Yes. Use the API endpoints to pull JSON data and import into Excel, Tableau, etc. Future updates may add direct export.

**Q: How often should I refresh forecasts?**
A: System auto-refreshes every 24 hours. Manually refresh after major business changes (rate cut, new marketing campaign, competitor news).

**Q: What if actual occupancy differs significantly from forecast?**
A: This is valuable feedback. Note the difference and what caused it (your action, market event, etc.). System learns from variances over time.

---

## Support & Resources

- **API Documentation**: See endpoints section above
- **Dashboard Guide**: Interactive tooltips on each section
- **Email Support**: support@rvpark-success.com
- **Feedback**: Report forecast errors or feature requests in dashboard

---

## Version History

**v1.0 (Current)**
- 90-day forecast with confidence intervals
- Seasonal decomposition
- Booking pace analysis
- Capacity utilization tracking
- Staffing recommendations
- Peak season prediction
- Trend analysis (365 days)
- Anomaly detection

**Future (v1.1 Planned)**
- Custom confidence interval width
- Weather impact modeling
- Competitor rate integration
- Multi-location forecasting
- Machine learning model refinement
