# Booking Rules Quick Reference

## Essential Concepts

### What are Booking Rules?
Rules that automatically restrict or modify bookings based on your park's policies. Examples:
- "No bookings shorter than 2 nights"
- "Closed December 24-26"
- "50% price increase in summer"

### Rule Types at a Glance

| Type | Purpose | Example |
|------|---------|---------|
| **Min Stay** | Minimum nights required | "Min 2 nights" |
| **Max Stay** | Longest allowed booking | "Max 14 nights" |
| **Booking Window** | How far ahead to book | "Book 6 months ahead" |
| **Group Size** | People limits | "Max 8 people" |
| **Cancellation** | Refund policy | "50% refund if 7+ days" |
| **Seasonal** | Season-specific rules | "Summer (Jun-Aug): +50%" |
| **Blackout** | Closed dates | "Dec 24-26 closed" |

## Quick Setup

### Step 1: Open Booking Rules Dashboard
Go to **Booking Rules** tab in your park dashboard.

### Step 2: Create Your First Rule
Click **+ New Rule**:
1. Select rule type
2. Set configuration
3. Choose if park-wide or per-site
4. Click **Save Rule**

### Step 3: Test It Works
Click **Test Booking**:
1. Pick site, check-in/out dates
2. Enter guest count
3. See if booking allowed + cost

## Common Setups

### Weekend-Only Winter
```
Rule Type: Seasonal
Season: Winter
Weekends only: ✓
Price multiplier: 1.0 (no change)
```
→ Winter bookings restricted to Fri-Sat-Sun

### Minimum 3-Night Stay
```
Rule Type: Minimum Stay
Minimum nights: 3
```
→ All bookings must be 3+ nights

### Holiday Blackout (Dec 24-26)
```
Rule Type: Blackout Dates
Start: 2026-12-24
End: 2026-12-26
Reason: Holiday closure
```
→ Site completely unavailable those dates

### Summer Premium Pricing
```
Rule Type: Seasonal
Season: Summer (Jun-Aug)
Price multiplier: 1.5
```
→ 50% higher rates Jun-Aug

### Flexible Cancellation
```
Rule Type: Cancellation
30+ days before: 100% refund
14-29 days: 75% refund
7-13 days: 50% refund
0-6 days: 0% refund
```

## Testing a Rule

**Before going live:**
1. Click **Test Booking**
2. Enter a test date range
3. See if booking allowed
4. Check calculated cost
5. Verify warning messages

**Fix if blocked unexpectedly:**
- Check min/max stay settings
- Review blackout dates
- Test different date ranges

## When Rules Apply

Rules check automatically when guests:
- Browse availability
- Try to book a site
- Request price quote

Rules also prevent:
- Bookings that violate minimums/maximums
- Bookings during blackout dates
- Bookings outside your booking window
- Groups larger than limits

## Editing Rules

1. Find rule in table
2. Click **Edit**
3. Change configuration
4. Click **Save Rule**
5. Test with **Test Booking**

## Disabling Without Deleting

- Click **Edit**
- Uncheck "Active"
- Save

Rule won't apply, but settings preserved if needed later.

## Rule Priority (Conflict)

If two rules overlap:
- Most restrictive applies
- E.g., min 2 nights + min 3 nights on weekends = enforces whichever is more restrictive

## Cancellation Policy Tiers

Always list from longest to shortest time:
```
✓ Correct order:
  30 days: 100% refund
  14 days: 75% refund
  7 days: 50% refund
  0 days: 0% refund

✗ Wrong order:
  0 days: 0% refund
  7 days: 50% refund
  ...
```

## Price Multipliers

- `1.0` = no change
- `1.5` = 50% increase
- `2.0` = 100% increase (double)
- `0.8` = 20% discount

## Seasonal Definitions

- **Spring:** March-May
- **Summer:** June-August
- **Fall:** September-November
- **Winter:** December-February

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Min stay > Max stay | Make min smaller or max larger |
| Overlapping blackouts | Delete duplicate |
| Multiplier of 0 | Set to at least 0.1 |
| Wrong date format | Use YYYY-MM-DD |
| Price too low | Check multiplier isn't 0.01 |

## Real-World Examples

### Family Park (30-40 sites)
```
Min stay: 2 nights
Max stay: 30 nights
Booking window: 6 months
Group size: 2-8 people
Blackout: Dec 24-26, Jul 4
Seasonal: +50% Jul-Aug
```

### RV Resort (100+ sites)
```
Min stay: 1 night (flexible)
Max stay: None (180+ nights allowed)
Booking window: 12 months
Weekday discount: -20% (Mon-Thu)
Weekend premium: +25% (Fri-Sun)
Holiday blackouts: 10 dates/year
```

### Rural Retreat (10-15 sites)
```
Min stay: 3 nights
Max stay: 21 nights
Booking window: 3 months
Season 1 (Winter): Closed (0 price)
Season 2 (Spring): Standard rate
Season 3 (Summer): +100%
Season 4 (Fall): -10%
```

## Performance Impact

- **Few rules** (< 5): No noticeable impact
- **Normal** (5-20): Fast validation
- **Many** (50+): May need optimization

If you have 50+ rules, contact support.

## Data Backup

Rules are stored in database. They're backed up automatically.
Export important configs to a text file manually if needed.

## Reverting Changes

Can't undo rule changes automatically. To revert:
1. Click **Edit** on the rule
2. Manually change values back
3. Save

Consider creating "test rules" before major changes.

## Questions?

**Common Issues:**
- Bookings blocked? → Run **Test Booking** to see why
- Wrong price? → Check seasonal rules, multipliers
- Blackout not working? → Verify date range is correct

**Support:**
- Check BOOKING_RULES_IMPLEMENTATION.md for detailed docs
- Review rule configurations in dashboard
- Test thoroughly before enabling
