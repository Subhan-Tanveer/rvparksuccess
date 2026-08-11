# Occupancy Forecasting — Quick Reference

## At a Glance

The Occupancy Forecasting Engine predicts occupancy for the next 90 days and recommends actions.

---

## Key Sections of the Dashboard

### 1. 90-Day Forecast Chart
- Line chart showing predicted occupancy % for next 90 days
- Shaded area = confidence interval (±uncertainty)
- Higher = high confidence, Lower = low confidence

**Key Numbers:**
- **30-Day Avg**: Average occupancy next 30 days
- **90-Day Avg**: Average occupancy next 90 days
- **Trend**: ↑ improving, ↓ declining, → stable

### 2. Seasonal Calendar
- 12-month heatmap (red = low, green = high occupancy)
- See patterns by month
- Click month to drill down into daily view

**Seasons:**
- Peak (May-Sept): 75%+ occupancy
- Shoulder (Apr, Oct): 50-75% occupancy
- Low (Nov-Mar): <50% occupancy

### 3. Booking Pace
- **Pace Index**: 100 = normal, 120 = 20% faster, 80 = 20% slower
- **Lead Days**: How far in advance guests are booking
- **Anomalies**: Count of unusual bookings

**Action:**
- Pace > 120%? Strong demand → Raise rates
- Pace < 80%? Weak demand → Launch promotions

### 4. Capacity Gauge
- Shows % of available capacity being sold
- Target: 85%
- Green = healthy, Red = underutilized

**Calculation:** (booked nights / total available nights) × 100

### 5. Underutilized Dates
- Lists low-occupancy periods (forecast <50%)
- Potential revenue loss for each period
- Recommended action (discount size, campaign)

### 6. Staffing Recommendations
- High occupancy (80%+) → Full staff + 1-2 seasonal
- Medium (50-80%) → Standard staffing
- Low (<50%) → Minimal staff

### 7. Peak Season Prediction
- When is your next peak?
- Expected occupancy during peak
- Days until peak arrives

**Example:** "Next Peak Season: July 1-Aug 31, 86% occupancy, 288 days away"

### 8. Trend Analysis (365 Days)
- Is occupancy improving or declining?
- Slope: % change per day
- R²: How reliable the trend is (0-1)

**Interpretation:**
- Improving: Business growing
- Declining: Investigate why
- Stable: Predictable patterns

---

## Confidence Intervals Explained

Forecast confidence decreases further into future:

```
Days 1-7:    ±5%   (very high confidence)
Days 8-30:   ±10%  (high confidence)
Days 31-60:  ±18%  (moderate confidence)
Days 61-90:  ±35%  (low confidence)
```

**Example:** Day 30 forecast of 70% means: likely 60-80% occupancy.

---

## Common Scenarios & Actions

### Scenario: Low Occupancy Predicted (35%)

1. Launch 10-15% discount 4 weeks before
2. Push social media 2 weeks before
3. Reduce staff to minimal level
4. Schedule maintenance during that week
5. Lower supply orders

**Success:** Increase to 50%+

---

### Scenario: Peak Season Predicted (85%+)

1. Post seasonal staff jobs 6 weeks before
2. Increase supply orders 4 weeks before
3. Raise rates 10-20% three weeks before
4. Book all maintenance before peak
5. Plan team vacation outside of peak

**Success:** Hit 85%+ occupancy at premium rates

---

### Scenario: Declining Trend (↓ -2% per month)

1. Investigate root cause
2. Read guest reviews for pain points
3. Check competitor rates
4. Try 2-5% rate reduction, measure impact
5. Increase promotional spend 15-20%

**Success:** Reverse trend to stable or improving

---

## API Endpoints (For Developers)

All endpoints return JSON and require park-staff authentication.

### Get Forecast (90 days)
```
GET /api/admin/occupancy-forecasting?endpoint=forecast&days=90
```

### Get Seasonal Calendar (12 months)
```
GET /api/admin/occupancy-forecasting?endpoint=seasonal-calendar&year=2026
```

### Get Booking Pace
```
GET /api/admin/occupancy-forecasting?endpoint=booking-pace
```

### Get Occupancy Trend (365 days)
```
GET /api/admin/occupancy-forecasting?endpoint=trend&days=365
```

### Get Underutilized Dates
```
GET /api/admin/occupancy-forecasting?endpoint=underutilized
```

### Get Capacity Utilization
```
GET /api/admin/occupancy-forecasting?endpoint=capacity-utilization
```

### Get Peak Prediction
```
GET /api/admin/occupancy-forecasting?endpoint=peak-prediction
```

### Get Staffing Recommendations
```
GET /api/admin/occupancy-forecasting?endpoint=staffing-recommendations
```

### Refresh Forecasts (Manual)
```
POST /api/admin/occupancy-forecasting?endpoint=refresh
```

---

## Forecast Accuracy

### How Accurate Is It?

- **Days 1-14**: Very accurate (actual bookings lock in)
- **Days 15-45**: Good accuracy (based on booking pace)
- **Days 46-90**: Moderate accuracy (heavily based on seasonal patterns)

### What Affects Accuracy?

Improves with:
- More historical data (1+ years)
- Consistent business model
- Stable market conditions

Decreases with:
- Brand new park (<1 year data)
- Major pricing changes
- Economic shifts
- Unexpected events (pandemic, natural disaster)

### If Forecast Seems Wrong

1. Check you have 365+ days of data
2. Verify dates in system are correct
3. Note actual vs. forecast difference
4. Investigate what caused variance

---

## Quick Tips

- **Review Weekly**: Compare actual vs. forecast, adjust tactics
- **Plan 6 Weeks Ahead**: Use peak prediction for hiring/marketing
- **Combine with Market Data**: Forecasts are stats, add market knowledge
- **Test Promotions**: A/B test discounts during low-occupancy periods
- **Communicate Early**: Tell team staffing changes 3+ weeks in advance
- **Balance Pricing**: Use forecasts to test rate strategies

---

## Common Questions

**Q: Can I forecast beyond 90 days?**
A: No, use past-year seasonal data for planning beyond 90 days.

**Q: Why is confidence so wide on day 90?**
A: Unknowns multiply further out. Too many variables change.

**Q: Can I export forecasts?**
A: Use API endpoints to pull JSON data for Excel/Tableau.

**Q: How often does the system update?**
A: Every 24 hours automatically. Manually refresh anytime after major changes.

**Q: What if actual occupancy differs a lot?**
A: System learns from variances. Note what caused it and monitor trend.

---

## Contacts & Support

- **Questions?** Email support@rvpark-success.com
- **Found a bug?** Report in dashboard settings
- **Feature request?** Tell us what would help

---

## Dashboard Location

**Path:** Staff Dashboard → Occupancy Forecasting Engine
**Access:** Park staff role required
**Mobile:** Fully responsive, works on mobile

---

## Quick Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Forecast all 50% | <365 days data | Wait for full year of history |
| Confidence too wide | High volatility | Stabilize business, consistent marketing |
| Trend unclear (R²<0.4) | Too many external factors | Extend analysis to 2+ years |
| Forecast seems wrong | Pricing change/competition | Note variance, investigate cause |
| Page won't load | API error | Refresh page or check internet |

---

## Metric Definitions

| Metric | Meaning | Range |
|--------|---------|-------|
| Occupancy % | Sites booked / total sites | 0-100% |
| Confidence Margin | ± uncertainty band | Wider = less certain |
| Season | Time of year category | Peak/Shoulder/Low |
| Trend | Direction of change | ↑/→/↓ |
| Pace Index | vs. historical average | 50-150+ |
| R² (Trend) | Quality of trend fit | 0-1 (higher = better) |
| Capacity Util % | Revenue opportunity captured | 0-100% |
| Lead Days | Booking advance days | 10-60+ |

---

## Next Steps

1. **Review the 90-day forecast** — what's the occupancy outlook?
2. **Identify underutilized dates** — when do you need promotions?
3. **Check staffing recommendations** — do you need to hire/lay off?
4. **Note the peak prediction** — when should you prepare?
5. **Monitor the trend** — is your business improving or declining?
6. **Create a promotion calendar** — plan campaigns for low periods
7. **Share with team** — communicate forecasted occupancy
8. **Review weekly** — compare actual vs. forecast, learn

---

## Version

Occupancy Forecasting Engine v1.0
Last updated: September 2026
