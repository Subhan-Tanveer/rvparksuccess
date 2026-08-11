# AI-Powered Rate Optimization Engine

## Overview

The RVPark Success ML Rate Optimization Engine automatically learns from your historical booking data, occupancy patterns, and market conditions to recommend optimal nightly rates. This guide explains how the system works, how to interpret results, and how to maximize revenue.

## How It Works

### Three Core ML Models

The system combines three statistical models to make rate recommendations:

#### 1. **Rate Elasticity Model (Linear Regression)**
Learns the relationship between price and occupancy.

**What it measures:**
- How much occupancy changes when you adjust your nightly rate
- Example: "A 10% price increase reduces occupancy by 8%"

**How it works:**
- Analyzes historical bookings across different price points
- Fits a line through price/occupancy data
- Slope = elasticity coefficient (always negative)

**Elasticity Coefficient:**
- **-1.0 to -1.5**: Highly elastic (very price-sensitive demand)
  - Raising rates significantly reduces bookings
  - Lower your rates to fill more nights
- **-0.5 to -1.0**: Moderately elastic
  - Good room for strategic rate increases
  - Balance revenue vs. occupancy
- **-0.2 to -0.5**: Low elasticity (price-insensitive)
  - Demand is stable regardless of price
  - Confidently raise rates for more revenue

#### 2. **Time Series Seasonality Model**
Detects occupancy patterns by day of week and season.

**What it captures:**
- Weekend vs. weekday variations
- Holiday effects (Thanksgiving, July 4th, etc.)
- Monthly/seasonal trends

**Components:**
- **Trend**: 7-day moving average of historical occupancy
- **Seasonal Factors**: Per-day-of-week adjustment (e.g., "Fridays get +15% occupancy")
- **Residual Std Dev**: Noise/unpredictability in your data

#### 3. **Blended Revenue Optimizer**
Combines elasticity + seasonality to find the rate that maximizes:
- **Revenue Mode** (default): rate × occupancy = daily revenue
- **Occupancy Mode**: maximize total bookings regardless of rate

### Data Requirements

| Metric | Minimum | Ideal | Used For |
|--------|---------|-------|----------|
| Historical Bookings | 3 | 30+ | Elasticity model |
| Occupancy History | 14 days | 90+ days | Seasonality model |
| Training Frequency | Manual | Weekly (automatic) | Model accuracy |

**When model is "ready":**
- ✓ At least 5 rate/occupancy data points
- ✓ At least 2 weeks of occupancy history
- ✓ Sufficient variation in historical rates (model can't work if you never change rates)

## Understanding Results

### Model Health Indicators

#### Status Badges

| Badge | Meaning | Action |
|-------|---------|--------|
| **Ready** ✓ | Model is trained and confident | Use recommendations immediately |
| **Training** | Collecting more data | Check again in a few days |
| **Untrained** | No model exists | Click "Retrain Model" to build one |

#### Accuracy (MAE)

MAE = Mean Absolute Error (how far off predictions typically are).

**Example:** MAE ±$12/night means:
- If model predicts 70% occupancy at $150, actual could be 58-82%
- If model predicts $120 optimal rate, actual might be $108-$132

**Interpreting accuracy:**
- **±$5-10/night**: Very confident (use immediately)
- **±$10-20/night**: Confident (follow recommendations 80% of the time)
- **±$20-50/night**: Moderate confidence (validate recommendations)
- **>±$50/night**: Low confidence (collect more data)

#### Data Points

Number of historical bookings used to train the model.
- **5-10**: Minimum viable (fragile, easily swayed)
- **20-50**: Solid foundation
- **100+**: Highly reliable

### Occupancy Forecast Curve

The interactive chart shows predicted occupancy at different rate points.

**Reading the curve:**
- X-axis: Your nightly rate ($50-250 range)
- Y-axis: Predicted occupancy (0-100%)
- Green dot: Your current rate and its predicted occupancy
- Gold star: AI's recommended optimal rate
- Curve slope = elasticity (steeper = more price-sensitive)

**Use cases:**
1. Planning a rate change: Find your new rate on the X-axis, see expected occupancy on the Y-axis
2. Sensitivity testing: "What if I raise rates by $20?" → Point to $170, read occupancy
3. Revenue optimization: Find where curve is steepest before flattening (maximum revenue point)

### 30-Day Rate Calendar

AI-generated rate suggestions for each day of the month.

**Color intensity:**
- Light colors = lower suggested rate
- Dark colors = higher suggested rate

**Per-day details:**
- Suggested rate (e.g., $145)
- Predicted occupancy (e.g., 82%)
- Confidence score (e.g., 87%)
- Revenue estimate (e.g., $119/night)

**When rates differ drastically by day:**
- **High variation** = strong day-of-week or holiday effects
- Example: Weekends $180, weekdays $120 (elastic demand, weekend seekers pay premium)

**When rates are flat:**
- Demand is stable across the month
- Could be off-season, or your rate is already optimal

### Price Elasticity Analysis

Plain-English interpretation of coefficient.

**Example outputs:**

**High Elasticity (-0.9):**
> "Demand is very sensitive to price. Moderate rate increases could improve revenue."
> 
> Strategy: Only raise $5-10 at a time, monitor bookings for 2 weeks.

**Moderate Elasticity (-0.6):**
> "Demand responds moderately to price. Room for strategic rate increases."
>
> Strategy: Raise $10-15, expect 6-9% occupancy drop. If revenue increases, repeat.

**Low Elasticity (-0.3):**
> "Demand relatively stable. Can raise rates with confidence."
>
> Strategy: Aggressively raise rates (test $20-30 increments). Customers aren't price-sensitive.

### AI Recommendations Feed

Actionable suggestions in card format.

**Example cards:**

1. **"Optimal Daily Rate"**
   - Current: $150 / Suggested: $165 (+10%)
   - Expected occupancy: 78% (down 3%)
   - Expected daily revenue: $129 (up $7)
   - Confidence: 84%

2. **"Holiday Rate Surge"**
   - Thanksgiving week detected
   - Raise rates 20-25%
   - Expected occupancy: 92% (seasonal peak)
   - Confidence: 91%

3. **"Fill Slow Weekdays"**
   - Mid-week occupancy predicted at 35%
   - Try lowering $20 to $130
   - Expected occupancy: 58%
   - Confidence: 71%

### Performance Dashboard

Tracks how accurate AI recommendations have been.

**Metrics:**

| Metric | What It Means |
|--------|---------------|
| **Accuracy (Last 30 days)** | Average error between predicted and actual occupancy |
| **Adoption Rate** | Percentage of suggestions you've implemented |
| **Avg Revenue/Night** | Your actual nightly revenue (result of pricing decisions) |
| **Sample Size** | Number of nights with data in the 30-day window |

**What's "good"?**
- Accuracy ±10%: Excellent
- Adoption 50%+: Strong implementation
- Revenue increasing month-over-month: Recommendations are working

## Best Practices

### 1. Start Conservative
- First week: Test 1-2 recommendations on low-season dates
- Monitor actual occupancy vs. prediction
- Adjust your rates based on real results

### 2. Respect Seasonality
- Holidays: Trust model predictions (high confidence)
- Off-season: Lower rates to fill nights (accept lower revenue/night)
- Peak season: Raise rates to maximize revenue (demand sustains bookings)

### 3. Manual Validation
- 🚨 **Never blindly apply** a rate increase >$25 without review
- 📊 Check calendar: Is there an event (concert, festival, convention) the model doesn't know about?
- 👥 Check waitlist: If waitlist is growing, you're under-pricing

### 4. Set Guardrails
Park settings include min/max nightly rate bounds.

**Example:**
- Min rate: $80 (floor, never go below)
- Max rate: $200 (ceiling, don't price too high)
- Model will never suggest outside these bounds

### 5. Update Regularly
- Retrain model weekly (automatic or manual)
- As more bookings occur, accuracy improves
- Seasonal patterns become clearer over months

## Troubleshooting

### "Model Status: Untrained"
**Cause:** Less than 3 historical bookings or first time running.

**Fix:**
1. Ensure you have at least 3 confirmed bookings in your system
2. Click "Retrain Model"
3. Wait ~10 seconds for training to complete

### "Insufficient Data" / MAE >$50
**Cause:** Not enough variation in historical pricing or occupancy patterns.

**Fix:**
- Try different rates (don't keep rate fixed; test $150, then $165, then $135)
- Wait 2-4 weeks for more bookings to accumulate
- Check occupancy history is populated (performance tracking turned on?)

### "Curve looks flat" (No elasticity)
**Cause 1:** All bookings at same rate = no price variation to learn from.

**Fix:** Intentionally test different rates over next month.

**Cause 2:** Market is perfectly inelastic (demand same at all prices within your range).

**Fix:** This is rare but possible (resort town, unique property). Optimize occupancy instead of revenue.

### "Recommendations feel wrong"
**Cause:** Model hasn't learned your market dynamics yet.

**Questions to ask:**
1. Is there a local event next week the model doesn't know? (Add it as seasonal rate)
2. Is your property unique in ways bookings don't reflect? (Renovations pending, new amenity?)
3. Are you in an unusual market? (Business travel only, destination wedding venue, etc.)

**Fix:** Add manual seasonal rates for known peak dates. Model improves as more data accumulates.

## Advanced Topics

### Confidence Scoring

Confidence reflects model certainty, computed from:

1. **Data quality** (are predictions consistent?)
   - High residual std dev = low confidence
   - Low residual std dev = high confidence

2. **Historical fit** (does model match past data?)
   - R² close to 1.0 = high confidence
   - R² close to 0 = low confidence

3. **Seasonality clarity** (do patterns repeat?)
   - Consistent weekday/weekend differences = high confidence
   - Random variation = low confidence

### Elasticity Beyond Linear Regression

Real elasticity often curves (not perfectly linear):
- At very low prices: occupancy maxes out (can't exceed 100%)
- At very high prices: demand disappears (diminishing returns)

Model uses linear regression for simplicity, but clamping predictions to 0-100% captures non-linearity.

### Why Revenue Optimization by Default?

Occupancy mode (maximize bookings) is useful only if:
- You're new and need to build reviews
- You're in slow season and cash flow is critical
- You want to hit an occupancy milestone

Revenue mode wins for established parks: a $150 rate at 60% occupancy ($90/night) beats $100 at 90% occupancy ($90/night) — equal revenue, half the guest turnover/cleaning.

## API Reference

### Endpoints Used by Dashboard

All require session authentication. See `/api/admin/ml-optimization.js` for full specs.

```
GET  /api/admin/ml-optimization/model-status
GET  /api/admin/ml-optimization/rate-prediction
GET  /api/admin/ml-optimization/occupancy-forecast
GET  /api/admin/ml-optimization/elasticity
GET  /api/admin/ml-optimization/seasonal-rates
GET  /api/admin/ml-optimization/performance
POST /api/admin/ml-optimization/train
POST /api/admin/ml-optimization/apply-suggestion
```

## Support & Feedback

Found a bug? Recommendations not working?

1. Export your booking data (Settings → Export Reservations)
2. Note the dates when you tested recommendations
3. Check confidence scores and accuracy metrics
4. Contact support with: park ID, date range, model accuracy MAE

---

**Last updated:** August 2026  
**ML Engine Version:** 1.0 (Linear Regression + Time Series)  
**Retrain Frequency:** Weekly (automatic)
