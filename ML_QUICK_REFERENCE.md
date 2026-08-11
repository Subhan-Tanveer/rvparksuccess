# ML Rate Optimization — Quick Reference

## Dashboard Sections at a Glance

### 1. Model Health
**Shows:** Training status, accuracy, last trained date

| Status | Meaning | Action |
|--------|---------|--------|
| ✓ Ready | Model trained, use recommendations | Start applying suggestions |
| Training | Collecting data | Wait 3-5 more days |
| Untrained | No model yet | Click "Retrain Model" |

**Accuracy (MAE):** Lower = better. ±$15/night is "good." >±$50 means collect more data.

---

### 2. Rate Elasticity Curve
**Shows:** How occupancy changes at different prices

**How to read it:**
1. Find your current rate on X-axis (bottom)
2. Move up to curve → that's predicted occupancy
3. Green dot = your current rate
4. Gold star = AI's recommended rate

**Steep curve** = price-sensitive (small rate changes swing occupancy)  
**Flat curve** = price-insensitive (raise rates confidently)

---

### 3. 30-Day Calendar
**Shows:** Suggested rates for each day

**Color intensity:** Light = low rate, Dark = high rate

**Click a day** to see:
- Predicted occupancy
- Revenue estimate ($)
- Confidence %

**Pattern meanings:**
- Weekends darker than weekdays? → Charge premium weekends
- Flat across month? → Demand is stable, optimize price once
- Spikes mid-month? → Holiday or event detected

---

### 4. Elasticity Analysis
**Shows:** Price sensitivity in plain English

| Elasticity | Interpretation | Action |
|------------|-----------------|--------|
| < -1.0 | Highly price-sensitive | Raise rates gradually (test $5 increments) |
| -1.0 to -0.5 | Moderately sensitive | Room for 10-15% rate increases |
| > -0.5 | Price-insensitive | Raise rates confidently (test $20+ increments) |

---

### 5. AI Recommendations Feed
**Shows:** Actionable suggestions with confidence %

**Accept** a suggestion by:
1. Read the card (title, expected occupancy, revenue)
2. Check confidence (>80% = highly reliable)
3. Compare to your current rate
4. Manually update your rate in the system

⚠️ **Warning:** Model doesn't know about local events. Double-check the calendar before big changes.

---

### 6. Performance Dashboard
**Shows:** How accurate recommendations have been

| Metric | Good | Needs Attention |
|--------|------|-----------------|
| Accuracy | ±10% or better | >±20% |
| Adoption | 50%+ | <30% |
| Avg Revenue/Night | Growing month-over-month | Flat or declining |
| Sample Size | 20+ nights | <10 nights |

---

## Common Tasks

### "Should I raise my rate?"
1. Open **Occupancy Forecast Curve**
2. Find your rate on bottom axis
3. Move up to curve
4. Read the predicted occupancy on left axis
5. If ≥75%, you can safely raise $5-10
6. Check **Elasticity Analysis** for confidence level

### "I want to fill more nights"
1. Check **AI Recommendations** for "Fill Slow Weekdays"
2. Look at **Rate Calendar** — which dates are light-colored (low rates)?
3. Lower rate $10-20 on slow dates only
4. Check back in 2 weeks to see if occupancy improved

### "When should I apply recommendations?"
- **Confidence 80%+** → Apply immediately
- **Confidence 60-79%** → Test on 1-2 dates first
- **Confidence <60%** → Wait for more data or validate manually

### "The rate suggestion seems wrong"
1. Check **Elasticity Analysis** confidence
2. Look at **Performance Dashboard** accuracy
3. Is there a local event? (Model might not know)
4. Check your **Model Health** — do you have enough data?
5. If MAE >$30, wait for more historical data

---

## Elasticity Coefficient Quick Lookup

**What does the number mean?**

Elasticity = (% occupancy change) / (% price change)

**Examples:**

| Coefficient | Scenario | Best Strategy |
|------------|----------|---------------|
| -0.2 | Price ↑10% → Occupancy ↓2% | Raise rates aggressively |
| -0.5 | Price ↑10% → Occupancy ↓5% | Raise rates gradually (test $10) |
| -0.8 | Price ↑10% → Occupancy ↓8% | Raise rates conservatively (test $5) |
| -1.2 | Price ↑10% → Occupancy ↓12% | Demand very sensitive, lower rates to fill |

**General rule:** More negative = more price-sensitive. Less negative = less price-sensitive.

---

## Troubleshooting

### Model says "Untrained"
→ Click **"Retrain Model"** button. Need 3+ historical bookings.

### Accuracy is ±$50 (very high error)
→ Not enough data variation. Try different rates over next 2-4 weeks.

### Curve is flat / no elasticity detected
→ All your bookings at same rate. Intentionally test new rates to train model.

### Recommendation confidence is 50% (low)
→ Wait a few weeks for more data OR validate manually against market research.

### Should I trust a $30 rate increase?
→ Check confidence. If <80%, start with $10. Test occupancy. Repeat.

---

## Settings Reference

Park settings control model behavior:

| Setting | Default | Purpose |
|---------|---------|---------|
| Min Price | $20.00 | Floor (model won't suggest lower) |
| Max Price | $500.00 | Ceiling (model won't suggest higher) |
| Occupancy Target | 85% | Threshold for "good" occupancy |

**Tip:** Set Min to your break-even cost + cleaning. Set Max to your "never raise above this" ceiling.

---

## Key Numbers to Watch

### Daily
- **Current rate** vs **Suggested rate** (from calendar)
- **Predicted occupancy** (if rate is applied)

### Weekly
- **Model accuracy** (from Performance dashboard)
- **Adoption rate** (are you using recommendations?)

### Monthly
- **MAE trend** (should decrease as more data arrives)
- **Revenue trend** (should increase if recommendations are good)
- **Confidence scores** (should increase as data accumulates)

---

## Model Accuracy Benchmarks

**MAE ±$5-10/night:** Excellent  
→ Very confident, follow suggestions 90%+

**MAE ±$10-20/night:** Good  
→ Confident, follow suggestions 75-85%

**MAE ±$20-35/night:** Fair  
→ Moderate confidence, validate before applying

**MAE ±$35-50/night:** Poor  
→ Low confidence, collect more data or use sparingly

**MAE >$50/night:** Unreliable  
→ Insufficient data, skip recommendations until accuracy improves

---

## When to Retrain Model

| Trigger | Action |
|---------|--------|
| Added 20+ new reservations | Retrain manually |
| Changed rate strategy significantly | Retrain manually |
| Haven't retrained in 2 weeks | Retrain manually |
| Automatic (weekly) | No action needed |
| Accuracy dropping (MAE increasing) | Check data quality, retrain |

**Button location:** Top of dashboard, next to site selector.

---

## Rate Change Impact Calculator

Use the **Occupancy Forecast Curve** as a calculator:

**Scenario:** Current rate $150, want to test $165 (+10%)

1. Find $165 on X-axis
2. Go up to curve
3. Read occupancy on Y-axis (e.g., 70%)
4. Calculate revenue: $165 × 70% = $115.50/night
5. Compare to current: $150 × 85% = $127.50/night
6. Current is higher → Don't raise yet (or raise less)

---

## Support

**Data needed for debugging:**
- Park ID & site ID
- Date range (which dates you tested)
- Model accuracy (MAE) from dashboard
- Confidence scores for suggestions
- What happened when you applied the recommendation

---

**Dashboard v1.0** | Linear Regression + Time Series  
**Last Updated:** August 2026
