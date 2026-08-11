# Phase 4: Multi-Property Management Guide

RVPark Success now supports managing multiple RV parks from a single dashboard. This guide covers portfolio management, consolidated analytics, bulk operations, and organizational hierarchies for park chains and property managers.

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Portfolio Management](#portfolio-management)
4. [Consolidated Analytics](#consolidated-analytics)
5. [Bulk Operations](#bulk-operations)
6. [Permission Levels](#permission-levels)
7. [API Reference](#api-reference)
8. [Best Practices](#best-practices)

---

## Overview

### What's New in Phase 4

**Multi-Property Engine:** Orchestrates property portfolio management, cross-property analytics, bulk operations, and white-label branding.

**Core Capabilities:**
- Manage 2-50+ parks from one dashboard
- View consolidated metrics across all properties
- Run bulk operations (rate updates, promotions, maintenance blocking)
- Apply white-label branding per property
- Permission-based access control (admin, manager, staff)
- Audit logging for all bulk operations

**Who Benefits:**
- Park chains managing multiple locations
- Property managers with diverse portfolios
- Operators expanding to new markets
- Franchise owners with branded properties

---

## Getting Started

### Access the Portfolio Dashboard

1. Log in with your park staff credentials
2. If you manage 2+ parks, you'll be directed to the portfolio dashboard
3. If you manage only 1 park, you'll go straight to that park's dashboard

**URL:** `https://app.rvparksuccess.com/portfolio-dashboard.html`

### Initial Setup

1. **Verify Ownership:** Ensure all your parks are linked to your account
   - Contact support if a park is missing from your portfolio
   
2. **Set Permission Levels:** Assign staff members to specific parks
   - Admin: Full access to all properties and bulk operations
   - Manager: Can view all parks, run bulk operations
   - Staff: Can only access assigned park

3. **Configure White-Label Branding:** Set up custom colors and logos per park
   - See [WHITE_LABEL_SETUP.md](./WHITE_LABEL_SETUP.md) for detailed instructions

---

## Portfolio Management

### Portfolio Overview Dashboard

The portfolio overview card displays key metrics at a glance:

```
Total Properties:   5 parks
Total Sites:        24 RV sites
Revenue (YTD):      $156,800
Avg. Occupancy:     73.4%
Total Guests:       1,248
```

### Property Grid

Each property is displayed as a card showing:

- **Property Name** and location
- **Occupancy %** for the last 30 days
- **YTD Revenue** (Jan 1 - today)
- **ADR** (Average Daily Rate)
- **Bookings** count
- **Action Button** to drill into that property's dashboard

**Filtering & Sorting:**
- Click "View Dashboard" to manage a specific property
- Sort by revenue, occupancy, or ADR from the property comparison view
- Filter by location or property type (coming soon)

### Managing Property Groups

Organize your portfolio by location, brand, or operational unit:

```javascript
// Create a property group
POST /api/admin/multi-property/hierarchy
{
  "groupName": "California Properties",
  "groupType": "location",
  "properties": ["park_001", "park_002", "park_003"]
}
```

**Example Groups:**
- By Geographic Region: "Northern California", "Texas", "Southwest"
- By Brand: "Premium RV Parks", "Budget Campgrounds"
- By Function: "Corporate Owned", "Franchised"

---

## Consolidated Analytics

### Key Metrics Across All Parks

The **Performance Metrics** section shows:

**Revenue Analysis:**
- Total revenue across all parks (YTD)
- Top 5 performing properties by revenue
- Revenue contribution percentage per park
- Month-over-month growth trends

**Occupancy Analysis:**
- Average occupancy across all parks
- Occupancy by property (ranked)
- Seasonal trends aggregated across portfolio
- Occupancy vs. target metrics

**Guest Insights:**
- Total unique guests served
- Average booking value across portfolio
- Guest acquisition trends
- Return guest percentage

### Data Range

By default, metrics show the last 30 days. Customize the range:

```
GET /api/admin/multi-property/consolidated-metrics?days=90
```

Supported ranges:
- `days=7` — Last week
- `days=30` — Last 30 days (default)
- `days=90` — Last quarter
- `days=365` — Year-to-date

### Alerts

Active alerts across your portfolio appear in the **Alerts** section:

**Alert Types:**
- 🟡 **Low Occupancy:** Property occupancy below 50%
- 🔵 **Pending Payments:** Reservations with outstanding balances
- 🟠 **Maintenance Due:** Scheduled maintenance approaching
- 🔴 **Critical Issue:** Staff approval needed

---

## Bulk Operations

### Bulk Rate Updates

Apply rate changes to multiple properties and sites simultaneously:

**Steps:**
1. Select properties using the checkboxes in the property grid
2. Click **Update Rates** in the bulk operations panel
3. Enter the new rate (in cents)
4. Choose to apply to:
   - All sites in selected properties
   - Specific site types only
5. Confirm — operation is applied immediately

**Audit Trail:**
Every rate update is logged:
```
Operation: bulk-rate-update
Properties: 3
Status: completed
Success: 3, Failed: 0
Timestamp: 2026-08-11 14:23:45 UTC
```

### Bulk Promotions

Send promotions to guests across multiple parks:

**Steps:**
1. Select properties
2. Click **Send Promotion**
3. Configure promotion:
   - Promo code: `SUMMER20`
   - Discount type: Percentage or fixed amount
   - Duration: Start and end dates
   - Target: All guests or specific segments
4. Confirm — emails/SMS sent to guest lists

**Scope:**
- Promotion applied to all new bookings at selected parks
- Code valid for the specified date range
- Can be combined with seasonal rates

### Bulk Maintenance Blocking

Block dates at multiple sites across properties:

**Steps:**
1. Select properties
2. Click **Schedule Maintenance**
3. Enter date range:
   - Start date (YYYY-MM-DD)
   - End date (YYYY-MM-DD)
4. Choose sites:
   - All sites in selected properties
   - Specific site IDs only
5. Add reason (optional)
6. Confirm — dates blocked across all selected sites

**Effect:**
- Guests cannot book blocked dates
- Staff can still manually override if needed
- Blocked dates visible on calendar as "Maintenance"

### Bulk Promo Code Management

Create promo codes applicable to multiple parks:

```javascript
POST /api/admin/multi-property/bulk-promo-code
{
  "propertyIds": ["park_001", "park_002", "park_003"],
  "code": "MULTIPARK20",
  "type": "percent",
  "value": 20,
  "validFrom": "2026-08-01",
  "validTo": "2026-08-31"
}
```

---

## Permission Levels

### Admin
- Full access to all properties
- Can create/remove properties
- Can assign permission levels to other users
- Can run bulk operations
- Can access white-label branding settings
- Can view operation audit logs

### Manager
- Access to all assigned properties
- Can run bulk operations on assigned properties
- Can update rates, create campaigns
- Cannot create new properties or modify permissions
- Can view consolidated analytics

### Staff
- Access to single assigned property only
- Can update that property's information
- Cannot see other properties
- Cannot run bulk operations

### Assignment

Assign permissions in the Staff Management section:

```
Property: Riverside RV Park
Staff Member: John Doe
Permission Level: [Manager ▼]
```

**API:**
```javascript
PUT /api/admin/multi-property/permissions
{
  "userId": "user_123",
  "parkId": "park_001",
  "permissionLevel": "manager"
}
```

---

## API Reference

### Get Portfolio

```
GET /api/admin/multi-property/portfolio

Response:
{
  "properties": [
    {
      "id": "park_001",
      "name": "Riverside RV Park",
      "location": "California",
      "sitesCount": 45,
      "occupancyPercent": 78.5,
      "revenueCents": 125000,
      "adr": 125.50,
      "permissionLevel": "admin"
    }
  ],
  "count": 5
}
```

### Get Consolidated Metrics

```
GET /api/admin/multi-property/consolidated-metrics?days=30

Response:
{
  "totalRevenueCents": 456789,
  "totalReservations": 142,
  "totalNights": 584,
  "totalGuests": 156,
  "totalProperties": 5,
  "totalSites": 24,
  "averageAdr": 125.75,
  "averageOccupancyPercent": 73.4,
  "propertyMetrics": [
    {
      "parkId": "park_001",
      "parkName": "Riverside RV Park",
      "revenueCents": 125000,
      "reservations": 32,
      "nights": 145,
      "adr": 125.50,
      "occupancyPercent": 78.5,
      "sitesCount": 45
    }
  ],
  "daysBack": 30
}
```

### Get Alerts

```
GET /api/admin/multi-property/alerts

Response:
{
  "alerts": [
    {
      "parkId": "park_003",
      "parkName": "Mountain View Campground",
      "type": "low_occupancy",
      "severity": "warning",
      "message": "Low occupancy: 42%",
      "value": 42
    }
  ],
  "count": 2
}
```

### Bulk Update Rates

```
POST /api/admin/multi-property/bulk-update-rates

Request:
{
  "propertyIds": ["park_001", "park_002"],
  "rateCard": {
    "site_group_1": 12000,
    "site_group_2": 15000
  }
}

Response:
{
  "success": true,
  "operationId": "op_1723385025487_abc123",
  "completed": 2,
  "failed": 0,
  "total": 2
}
```

### Bulk Send Promotion

```
POST /api/admin/multi-property/bulk-campaign

Request:
{
  "propertyIds": ["park_001", "park_002", "park_003"],
  "campaign": {
    "code": "SUMMER20",
    "discount": 20,
    "type": "percent",
    "description": "Summer special - 20% off"
  }
}

Response:
{
  "success": true,
  "operationId": "op_1723385045123_def456",
  "completed": 3,
  "failed": 0,
  "total": 3
}
```

### Bulk Schedule Maintenance

```
POST /api/admin/multi-property/bulk-maintenance

Request:
{
  "propertyIds": ["park_001", "park_002"],
  "siteIds": [],
  "startDate": "2026-09-01",
  "endDate": "2026-09-03",
  "reason": "Annual maintenance"
}

Response:
{
  "success": true,
  "operationId": "op_1723385065789_ghi789",
  "completed": 2,
  "failed": 0,
  "total": 2
}
```

### Get Property Branding

```
GET /api/admin/multi-property/branding?parkId=park_001

Response:
{
  "logo": "data:image/png;base64,iVBORw0KGgo...",
  "logoUrl": "https://...",
  "primaryColor": "#2e9b54",
  "accentColor": "#d97d2e",
  "backgroundColor": "#0a0a0a",
  "companyName": "Riverside RV Parks",
  "domain": "riverside.yourbrand.com",
  "emailBranding": {
    "footerLogo": "...",
    "companyName": "Riverside RV Parks"
  }
}
```

### Apply Branding

```
POST /api/admin/multi-property/branding

Request:
{
  "parkId": "park_001",
  "branding": {
    "primaryColor": "#1b4f72",
    "accentColor": "#157a72",
    "companyName": "Riverside RV Parks",
    "domain": "riverside.yourbrand.com"
  }
}

Response:
{
  "success": true,
  "message": "Branding updated"
}
```

---

## Best Practices

### Portfolio Organization

1. **Group by Geography**
   - Simplifies regional management
   - Easier to compare similar markets
   - Can delegate regional managers

2. **Use Consistent Naming**
   - Include location in park name: "Riverside, CA" not "The Park"
   - Use abbreviations consistently: "RC" for "RV Campground"
   - Makes bulk operations clearer

3. **Maintain Permission Hierarchy**
   - Don't make everyone admin
   - Use manager role for delegation
   - Staff access limits liability

### Bulk Operations

1. **Start Small**
   - Test on 1-2 properties first
   - Verify rates/promotions before full rollout
   - Check audit logs to validate

2. **Plan Timing**
   - Schedule rate updates outside peak booking times
   - Send promotions mid-week (better open rates)
   - Block maintenance during low-occupancy seasons

3. **Monitor Alerts**
   - Set up email notifications for critical alerts
   - Review alerts daily during peak season
   - Address low occupancy immediately

4. **Audit Everything**
   - Every operation is logged with timestamp and user
   - Export audit logs monthly for records
   - Review failed operations to identify patterns

### Rate Management

1. **Dynamic Pricing**
   - Use competitive intelligence to inform rates
   - Adjust rates by property performance
   - Test rate changes on 1 property before bulk applying

2. **Seasonal Rates**
   - Plan seasonal rate calendars in advance
   - Consider local events and holidays
   - Use bulk operations to apply across portfolio

3. **Promo Codes**
   - Use location-specific codes: "RIVERSIDE20" not "DISCOUNT20"
   - Track promo performance per property
   - Limit overlap between active promotions

### White-Label Branding

1. **Brand Consistency**
   - Use same color palette across all customer-facing surfaces
   - Ensure logo works at all sizes
   - Test on mobile and desktop

2. **Domain Setup**
   - Use regional subdomains: "riverside.yourbrands.com"
   - Update DNS records before launch
   - Set up SSL certificates

3. **Email Branding**
   - Match email footer to website design
   - Include company name consistently
   - Add support contact info

---

## Troubleshooting

### Bulk Operation Failed

**Symptom:** Operation shows "completed: 1, failed: 1"

**Solution:**
1. Check audit log for failed property details
2. Verify user has permission for that property
3. Check property configuration (may be incomplete)
4. Retry operation with successful properties only

### Missing Properties

**Symptom:** A park you own doesn't appear in portfolio

**Solution:**
1. Verify park is registered (has name, location, staff username)
2. Check park owner_id matches your user ID
3. Contact support to migrate existing park to your account

### Metrics Not Updating

**Symptom:** Consolidated metrics show stale data

**Solution:**
1. Refresh page (Ctrl+R or Cmd+R)
2. Clear browser cache
3. Check that properties have active reservations
4. Wait up to 1 hour for metric recalculation

---

## Support & Feedback

For issues or questions:

- **Email:** support@rvparksuccess.com
- **Phone:** 1-800-RV-PARK (1-800-787-7275)
- **Chat:** Available in dashboard (Mon-Fri, 9am-5pm PT)

Feature requests:
- Submit via dashboard feedback form
- Vote on requested features in community forum
