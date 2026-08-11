# Dynamic Pricing Engine — Deployment & Testing Guide

## Pre-Deployment Checklist

### Code Review
- [x] All new files created (`pricing-engine.js`, `pricing.js`, `pricing-dashboard.js`)
- [x] All modifications applied (`reservations-store.js`, `park-dashboard.html`, `park-dashboard.js`)
- [x] No breaking changes to existing APIs
- [x] Error handling in place
- [x] Input validation on all endpoints
- [x] No hardcoded secrets or credentials
- [x] No console.log statements in production code (use console.error for errors only)

### Database Migrations
- [x] Schema changes are idempotent (using IF NOT EXISTS)
- [x] No destructive ALTER TABLE statements
- [x] New columns have sensible defaults
- [x] Indexes created for performance-critical queries
- [x] Backward compatible with existing code

### Security
- [x] All endpoints require session authentication
- [x] Park-scoped access control (parkId from session)
- [x] SQL injection prevention (parameterized queries)
- [x] Input validation on numeric fields
- [x] Date validation
- [x] Confidence score bounds (0-100)

### Performance
- [x] Stateless calculations (no session state)
- [x] Database queries indexed
- [x] No N+1 query problems
- [x] Batch operations supported

---

## Local Testing

### 1. Setup Environment

```bash
cd "D:\Client's Project\Client Chatting Amazon Q AI\RVPark Website"

# Ensure .env.development.local has DATABASE_URL
# (should be auto-fetched by: vercel env pull .env.development.local)
```

### 2. Start Dev Server

```bash
npm run dev
# or
vercel dev
```

The server should start on `http://localhost:3000`.

### 3. Login to Dashboard

1. Open `http://localhost:3000/admin-login.html`
2. Login with your test park credentials
3. You should see the dashboard with new "Pricing Intelligence" section

### 4. Test Core Features

#### Test A: Toggle Dynamic Pricing

```bash
# In browser console on dashboard:
fetch('/api/admin/pricing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'toggleDynamicPricing' })
})
.then(r => r.json())
.then(console.log)
```

**Expected**: Returns `{ park: { dynamicPricingEnabled: true/false, ... } }`

#### Test B: Calculate Prices

```bash
fetch('/api/admin/pricing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'calculate',
    dateRange: {
      start: '2026-08-15',
      end: '2026-09-15'
    },
    includeRecommendations: true
  })
})
.then(r => r.json())
.then(console.log)
```

**Expected**: Returns array of suggestions with:
- `siteId`, `siteName`, `date`
- `currentRate`, `suggestedRate`, `multiplier`
- `occupancyPercent`, `confidence`
- `reasoning` with breakdown

#### Test C: Update Settings

```bash
fetch('/api/admin/pricing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'updateSettings',
    minPriceCents: 1500,
    maxPriceCents: 25000,
    occupancyTargetPercent: 80
  })
})
.then(r => r.json())
.then(console.log)
```

**Expected**: Returns updated park object with new settings

#### Test D: Apply Price

```bash
fetch('/api/admin/pricing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'applyPrice',
    siteId: 'site-xxx',         // Your test site ID
    dateOfStay: '2026-08-15',
    previousRate: 5000,
    appliedRateCents: 5500
  })
})
.then(r => r.json())
.then(console.log)
```

**Expected**: Returns pricing_log entry with status: 'applied'

#### Test E: Add Peak Range

```bash
fetch('/api/admin/pricing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'addPeakRange',
    label: 'Test Festival',
    startDate: '2026-10-15',
    endDate: '2026-10-22'
  })
})
.then(r => r.json())
.then(console.log)
```

**Expected**: Returns array of peakRanges including new one

### 5. Test UI Interactions

#### Test F: Dashboard Loads

1. Navigate to `http://localhost:3000/park-dashboard.html`
2. Wait for dashboard to load
3. Scroll down to "Pricing Intelligence" section
4. Should see:
   - Toggle switch for "Dynamic Pricing ON/OFF"
   - Cards for Min Rate, Max Rate, Occupancy Target
   - Input fields below cards
   - "Calculate Suggested Prices" button
   - Date range pickers

#### Test G: Toggle UI

1. Click the toggle switch
2. Should see:
   - Background toggle changes color
   - Label changes to "Dynamic Pricing ON" or "Dynamic Pricing OFF"
   - Pricing Calculation section appears/disappears

#### Test H: Settings Input

1. Change Min Rate to 1500
2. Change Max Rate to 25000
3. Change Occupancy Target to 80
4. Click "Save Settings"
5. Should see success message
6. Refresh page and values should persist

#### Test I: Calculate Suggestions

1. Set date range (default is next 30 days)
2. Click "Calculate Prices"
3. Wait for suggestions to load
4. Should see table with columns: Date, Site, Current Rate, Suggested Rate, Change, Occupancy, Confidence
5. Should see "Revenue Impact" card at top
6. Should see "Apply" buttons on each row

#### Test J: Apply Single Suggestion

1. In suggestions table, find a row
2. Click "Apply" button
3. Confirm dialog should appear
4. Click "Yes"
5. Row should update showing applied status
6. Pricing log should be created

#### Test K: Apply All Suggestions

1. Click "Apply All Suggestions" button
2. Confirmation dialog appears
3. Click "Yes"
4. All suggestions should be applied
5. Table should refresh

### 6. Database Verification

```sql
-- Check parks table columns added
SELECT dynamic_pricing_enabled, min_price_cents, max_price_cents, occupancy_target_percent
FROM parks
WHERE id = 'your-park-id';

-- Check sites table column
SELECT price_modifier FROM sites WHERE id = 'your-site-id';

-- Check pricing_log created
SELECT * FROM pricing_log ORDER BY created_at DESC LIMIT 5;

-- Check peak_date_ranges created
SELECT * FROM peak_date_ranges ORDER BY created_at DESC LIMIT 5;
```

---

## Integration Testing

### Test Scenario 1: Full Workflow

1. Login to dashboard
2. Enable dynamic pricing
3. Set min $20, max $150, occupancy target 80%
4. Calculate prices for next 30 days
5. Apply 5 suggestions manually
6. Click "Apply All" for remaining
7. Verify pricing_log entries created
8. Refresh page and confirm settings persisted

### Test Scenario 2: Edge Cases

#### High Occupancy (Test Aggressive Pricing)

```javascript
// Create scenario where all dates are 95% booked
// System should suggest high multiplier (1.25x)
fetch('/api/admin/pricing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'calculate',
    dateRange: { start: '2026-08-15', end: '2026-08-22' },
    includeRecommendations: true
  })
})
```

**Verify**: Suggested rates close to maxPrice, confidence >80%

#### Low Occupancy (Test Conservative Pricing)

```javascript
// Create scenario where occupancy is <30%
// System should suggest discount (0.9x window multiplier)
```

**Verify**: Suggested rates don't drop below minPrice, confidence ~60%

#### Far Future Dates (Low Confidence)

```javascript
// Calculate for 200 days out
// Confidence should be lower (~50%)
```

**Verify**: Confidence score reflects data quality

#### Mixed Peak/Off-Season

```javascript
// Calculate across Jul (peak) + Aug (shoulder) + Sep (off-season)
// Should see different multipliers
```

**Verify**: Peak dates have 1.3x, off-season have 0.85x

### Test Scenario 3: Security

#### Access Control

```javascript
// Try to access pricing for different park
// Should get 404 or 403
fetch('/api/admin/pricing?parkId=other-park-id')
// Should fail (session only has your parkId)
```

#### Input Validation

```javascript
// Try invalid date range
fetch('/api/admin/pricing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'calculate',
    dateRange: {
      start: '2026-09-15',
      end: '2026-08-15'  // End before start!
    }
  })
})
// Should get 400 error
```

#### Bounds Enforcement

```javascript
// Try to set max price < min price
fetch('/api/admin/pricing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'updateSettings',
    minPriceCents: 5000,
    maxPriceCents: 2000  // Invalid!
  })
})
// Should get 400 error
```

---

## Load Testing

### Scenario: 20 Sites, 90-Day Calculation

```bash
# Time the request
time curl -X POST http://localhost:3000/api/admin/pricing \
  -H "Content-Type: application/json" \
  -d '{
    "action": "calculate",
    "dateRange": {
      "start": "2026-08-15",
      "end": "2026-11-13"
    }
  }'
```

**Expected**: Completes in <1 second

### Scenario: Batch Apply (100+ Prices)

```bash
# Apply 100 prices in series (realistic usage)
# Should complete in <5 seconds total
```

---

## Deployment to Production

### Step 1: Code Review & Merge

```bash
# Pull latest
git pull origin main

# Create feature branch
git checkout -b feature/dynamic-pricing

# Make commits (already done)
git add .
git commit -m "Add dynamic pricing engine with dashboard UI"

# Create PR for review
git push origin feature/dynamic-pricing
# Open PR on GitHub
```

### Step 2: Staging Deployment

```bash
# Deploy to staging first
vercel --prod --scope=rvpark-success-staging
# Test all endpoints on staging
```

### Step 3: Production Deployment

```bash
# Merge PR
git merge --squash feature/dynamic-pricing
git push origin main

# Vercel auto-deploys on main push
# Monitor deployment at https://vercel.com/rvpark-success
```

### Step 4: Post-Deployment Verification

1. **Health Check**: Dashboard loads, no console errors
2. **API Test**: Calculate endpoint returns suggestions
3. **Database Check**: Schema migrations ran, no conflicts
4. **Performance**: Response time <500ms
5. **Security**: 401 error if not authenticated

```bash
# Test production endpoint
curl https://rvparksuccess.com/api/admin/pricing \
  -H "Cookie: session=your-session-id"
```

---

## Rollback Plan

If something goes wrong in production:

### Option 1: Quick Revert
```bash
git revert HEAD
git push origin main
# Vercel re-deploys previous version
```

### Option 2: Feature Flag (If Available)
```javascript
// In pricing.js
if (!process.env.PRICING_ENGINE_ENABLED) {
  return res.status(503).json({ error: 'Feature not yet available' });
}
```

### Option 3: Manual Disable
In database, set all parks' `dynamic_pricing_enabled = false` until issue is fixed.

---

## Monitoring

### Key Metrics to Track

1. **API Response Times**
   - Target: <200ms for single calculation
   - Target: <500ms for 30-day batch

2. **Error Rates**
   - Target: <0.1% (1 error per 1000 requests)
   - Alert if > 1%

3. **Database Queries**
   - Monitor pricing_log inserts
   - Monitor slow queries (>100ms)

4. **UI Errors**
   - Monitor browser console errors
   - Track failed price applications

5. **Business Metrics**
   - Track % of parks with dynamic pricing enabled
   - Track avg revenue impact vs baseline
   - Track confidence scores improving over time

---

## Support Resources

### For Users
- PRICING_ENGINE.md — Full user guide
- Dashboard help text — Hover over fields
- Email support: support@rvparksuccess.com

### For Developers
- Code comments throughout implementation
- Test cases in this guide
- API endpoint documentation in PRICING_ENGINE.md

### Common Issues & Fixes

**Issue**: "No pricing suggestions generated"
**Fix**: Ensure park has at least one site with 0 < base rate ≤ maxPrice

**Issue**: "Confidence score is always 50%"
**Fix**: System needs historical reservation data. Wait a few weeks.

**Issue**: "Prices not changing within 48 hours"
**Fix**: This is by design! Safety feature prevents last-minute changes.

**Issue**: "Dashboard section not appearing"
**Fix**: Clear browser cache, hard-refresh (Ctrl+Shift+R)

---

## Testing Checklist (Final)

Before declaring deployment complete:

- [ ] Dashboard loads without errors
- [ ] Dynamic pricing toggle works
- [ ] Settings save and persist
- [ ] Date picker works on mobile
- [ ] Calculate button triggers suggestions
- [ ] Apply buttons work (single and batch)
- [ ] Revenue impact shows reasonable numbers
- [ ] Pricing log populated correctly
- [ ] Peak ranges can be added/removed
- [ ] Min/max bounds enforced
- [ ] Park cannot exceed 150% or go below 80%
- [ ] Occupancy percentages look correct
- [ ] Confidence scores make sense
- [ ] No 401 errors for authenticated users
- [ ] SQL injection attempts blocked
- [ ] XSS attempts blocked
- [ ] Performance acceptable (< 500ms)
- [ ] Mobile responsive
- [ ] Dark mode works
- [ ] Accessibility: tab navigation works
- [ ] No console errors in browser

✓ All items checked = Safe to release!

---

## Go-Live Day

### Communication
1. Send email to active park owners: "New feature available"
2. Highlight revenue opportunity (15-30% gain)
3. Link to documentation
4. Offer to enable manually first 30 days
5. Support team on alert for questions

### Monitoring
- Real-time error tracking enabled
- Dashboards set up for metrics
- On-call support available
- Slack alerts for anomalies

### First Week
- Daily check-in on usage stats
- Monitor for bugs/edge cases
- Gather user feedback
- Fine-tune algorithm if needed

Congratulations on launching! 🎉
