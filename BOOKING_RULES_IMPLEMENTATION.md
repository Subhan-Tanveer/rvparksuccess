# Booking Rules Implementation Guide

## Overview

The Booking Rules Engine is a comprehensive system for managing granular booking control in the RVPark Success platform. Park owners can define complex rules around minimum/maximum stays, booking windows, group sizes, blackout dates, cancellation policies, and seasonal pricing.

## Architecture

### Core Components

1. **booking-rules-engine.js** - Core business logic
   - Rule validation
   - Cost calculation
   - Cancellation policy enforcement
   - Date availability checking
   - Conflict detection

2. **booking-rules.js** - API endpoints
   - CRUD operations for rules
   - Booking validation testing
   - Blackout date management
   - Cancellation policy testing

3. **booking-rules-dashboard.js** - Frontend UI
   - Rule management interface
   - Validation tester
   - Blackout date manager
   - Real-time feedback

4. **booking-rules.css** - Styling
   - Responsive layout
   - Dark mode support
   - Modal dialogs
   - Form components

## Rule Types

### 1. Minimum Stay
Enforces minimum number of consecutive nights for bookings.

**Configuration:**
```json
{
  "nights": 2
}
```

**Use Cases:**
- "Minimum 2 nights on weekdays"
- "Minimum 3 nights during peak season"
- "Minimum 7 nights for winter bookings"

### 2. Maximum Stay
Enforces maximum length of a single booking.

**Configuration:**
```json
{
  "nights": 14
}
```

**Use Cases:**
- "Maximum 14 consecutive nights"
- "No bookings longer than 1 month"

### 3. Booking Window
Controls how far in advance guests can book.

**Configuration:**
```json
{
  "days_in_advance": 180,
  "min_days_before": 0
}
```

**Use Cases:**
- "Can only book up to 6 months ahead"
- "Must book at least 7 days in advance"
- "Booking window: 14 to 90 days ahead"

### 4. Group Size
Limits the number of people per booking.

**Configuration:**
```json
{
  "min_people": 2,
  "max_people": 8
}
```

**Use Cases:**
- "Maximum 8 people per site"
- "Minimum 4 people for group discounts"

### 5. Cancellation Policy
Defines refund tiers based on cancellation timing.

**Configuration:**
```json
{
  "tiers": [
    { "days_before_checkin": 30, "refund_percent": 100 },
    { "days_before_checkin": 14, "refund_percent": 75 },
    { "days_before_checkin": 7, "refund_percent": 50 },
    { "days_before_checkin": 0, "refund_percent": 0 }
  ]
}
```

**Use Cases:**
- "Full refund up to 30 days before"
- "50% charge if canceled within 7 days"
- "No refund for last-minute cancellations"

### 6. Seasonal Rules
Applies different restrictions and pricing by season.

**Configuration:**
```json
{
  "season": "summer",
  "multiplier": 1.5,
  "weekends_only": false
}
```

**Use Cases:**
- "50% higher price in summer"
- "Winter bookings only on weekends"
- "20% discount for shoulder season"

## Database Schema

### booking_rules Table
```sql
CREATE TABLE booking_rules (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  site_id TEXT REFERENCES sites(id),
  rule_type TEXT NOT NULL,
  rule_config_json TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### blackout_dates Table
```sql
CREATE TABLE blackout_dates (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### seasonal_periods Table (Future Enhancement)
```sql
CREATE TABLE seasonal_periods (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  season_name TEXT NOT NULL,
  start_month INTEGER NOT NULL,
  end_month INTEGER NOT NULL,
  rules_config_json TEXT NOT NULL
);
```

### cancellation_policies Table (Future Enhancement)
```sql
CREATE TABLE cancellation_policies (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  policy_name TEXT NOT NULL,
  tiers_json TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false
);
```

## API Endpoints

### Rules Management

#### GET /api/admin/booking-rules
Get all rules for a park

**Query Parameters:**
- `parkId` (required): Park ID

**Response:**
```json
[
  {
    "id": "rule-123",
    "park_id": "park-1",
    "site_id": "site-1",
    "rule_type": "min_stay",
    "rule_config_json": "{\"nights\": 2}",
    "is_active": true,
    "priority": 0,
    "created_at": "2026-08-11T00:00:00Z"
  }
]
```

#### POST /api/admin/booking-rules
Create a new rule

**Request Body:**
```json
{
  "parkId": "park-1",
  "siteId": "site-1",
  "ruleType": "min_stay",
  "ruleConfig": { "nights": 2 },
  "isActive": true,
  "priority": 0
}
```

**Response:**
```json
{ "id": "rule-123" }
```

#### PATCH /api/admin/booking-rules/:ruleId
Update an existing rule

**Request Body:**
```json
{
  "isActive": false,
  "ruleConfig": { "nights": 3 },
  "priority": 1
}
```

#### DELETE /api/admin/booking-rules/:ruleId
Delete a rule

### Validation & Testing

#### POST /api/admin/booking-rules/validate
Test if a booking is valid

**Request Body:**
```json
{
  "parkId": "park-1",
  "siteId": "site-1",
  "checkIn": "2026-09-01",
  "checkOut": "2026-09-05",
  "guestCount": 4
}
```

**Response:**
```json
{
  "allowed": true,
  "reasons": [],
  "warnings": ["Summer season applies 50% price increase"],
  "cost": {
    "nightly_rate": 10000,
    "total_cost": 40000,
    "breakdown": [
      { "date": "2026-09-01", "rate": 10000 },
      { "date": "2026-09-02", "rate": 10000 },
      { "date": "2026-09-03", "rate": 10000 },
      { "date": "2026-09-04", "rate": 10000 }
    ]
  }
}
```

#### POST /api/admin/booking-rules/cancellation-test
Test cancellation policy

**Request Body:**
```json
{
  "parkId": "park-1",
  "reservationId": "res-123",
  "cancellationDate": "2026-08-20"
}
```

**Response:**
```json
{
  "refund_cents": 7500,
  "charge_cents": 2500,
  "reason": "75% refund (20 days before check-in)"
}
```

### Blackout Dates

#### GET /api/admin/booking-rules/blackout-dates
Get blackout dates for a site

**Query Parameters:**
- `parkId` (required)
- `siteId` (optional)

#### POST /api/admin/booking-rules/blackout-dates
Create a blackout period

**Request Body:**
```json
{
  "parkId": "park-1",
  "siteId": "site-1",
  "startDate": "2026-12-24",
  "endDate": "2026-12-26",
  "reason": "Holiday closure"
}
```

#### DELETE /api/admin/booking-rules/blackout-dates/:blackoutId
Delete a blackout period

## Validation Logic

### Booking Validation Flow

1. **Check Minimum Stay** - Ensure booking duration meets minimums
2. **Check Maximum Stay** - Ensure booking duration doesn't exceed maximum
3. **Check Booking Window** - Verify check-in is within allowed advance booking period
4. **Check Group Size** - Validate guest count is within limits
5. **Check Blackout Dates** - Ensure no dates are blocked
6. **Check Seasonal Rules** - Apply seasonal restrictions
7. **Return Result** - List all blocking reasons or allow booking

### Conflict Detection

When creating/updating rules, the system checks for logical conflicts:
- Min stay > Max stay
- Contradictory restrictions
- Overlapping seasonal rules

## Integration Points

### In Reservation Creation

```javascript
// Check rules before confirming booking
const validation = await validateBooking({
  checkIn, checkOut, siteId, parkId, guestCount
}, store);

if (!validation.allowed) {
  throw new Error(`Booking blocked: ${validation.reasons.join(', ')}`);
}

// Calculate cost with rules applied
const costData = await calculateBookingCost(
  { checkIn, checkOut }, site, store, parkId
);
```

### In Cancellation Processing

```javascript
// Enforce cancellation policy
const refund = await enforceCancellationPolicy(
  reservation, cancellationDate, store
);

// Process refund
const chargeAmount = reservation.total_cents - refund.refund_cents;
```

## Dashboard Features

### Rule List
- View all rules for park
- Filter by rule type
- Filter by site
- Toggle enable/disable
- Edit or delete rules
- Status indicators

### Rule Editor
- Type-specific configuration forms
- Real-time validation
- Conflict warnings
- Save/cancel actions

### Validation Tester
- Test booking against all rules
- Shows blocking reasons
- Displays warnings
- Calculates estimated cost
- Night-by-night breakdown

### Blackout Manager
- Create/edit/delete blackout periods
- Set reason for each blackout
- View all blackouts for site
- Date range selection

## Best Practices

1. **Test Before Enabling**
   - Always use the validation tester
   - Test edge cases (bookings at min/max length, etc.)
   - Verify cost calculations

2. **Clear Rule Descriptions**
   - Use meaningful rule names
   - Document reason for each rule
   - Update blackout reasons regularly

3. **Seasonal Planning**
   - Define seasons well in advance
   - Set consistent multipliers
   - Review annually

4. **Cancellation Policies**
   - Clearly communicate to guests
   - Follow industry standards
   - Document policy changes

5. **Monitoring**
   - Check rule conflicts monthly
   - Review blocked bookings
   - Analyze cancellation data

## Common Scenarios

### Family-Friendly Park
```
- Min: 2 nights
- Max: 30 nights
- Group size: 2-8 people
- Booking window: 6 months
- Summer (50% premium): Jun-Aug, weekends only
- Holidays: Dec 24-26 blackout
```

### Peak Season Only
```
- Min: 3 nights
- Max: 14 nights
- Booking window: 90 days only
- Off-season: Weekends only, closed Mon-Thu
- High demand: 30-day advance booking only
```

### Long-Term Rentals
```
- Min: 28 nights
- Max: 180 nights
- Group size: 4-6 people
- Booking window: 12 months
- Monthly pricing: Different rates by month
```

## Performance Considerations

- Rules are fetched per park/site (cached in memory)
- Validation is O(n) where n = number of rules
- Blackout dates indexed by site and date
- Pre-calculate seasonal modifiers on booking creation
- Consider pagination for large rule sets (100+)

## Future Enhancements

1. **Rule Templates** - Pre-built rule sets for common scenarios
2. **Bulk Rule Management** - Apply rules to multiple sites at once
3. **ML-Based Pricing** - Suggest pricing multipliers based on demand
4. **Guest Preferences** - Track preferred check-in/check-out days
5. **Dynamic Rules** - Rules that change based on occupancy
6. **Rule Analytics** - Dashboard showing impact of each rule
7. **A/B Testing** - Compare rule effectiveness
8. **Integration with OTAs** - Sync rules to Airbnb, VRBO, etc.

## Troubleshooting

### Rules Not Being Applied
- Verify `is_active` is true
- Check `site_id` matches booking site
- Review validation response for specific reasons

### Unexpected Price Increases
- Check for multiple seasonal rules
- Verify multiplier values
- Review booking date in seasonal calendar

### Bookings Being Blocked Unexpectedly
- Use validation tester to identify rule
- Check blackout dates
- Review min/max stay settings

## Security

- All endpoints require authentication
- Park-scoped data (staff only sees their park)
- No sensitive data in JSON configs
- Validation done server-side, not client-side

