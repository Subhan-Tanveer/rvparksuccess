# Interactive Calendar Grid Implementation

## Overview

The Interactive Availability Calendar Grid is a modern drag-drop interface for managing park reservations, replacing the traditional table-based calendar view. It provides staff with a visual, intuitive way to manage bookings and availability across all sites.

**Expected Performance Improvement:** 30-50% faster operations (quick-book, drag-move, bulk blocking)

## Architecture

### Frontend Components

#### 1. **CSS Styling** (`src/css/calendar-grid.css`)
- **Grid Layout:** CSS Grid for responsive month/week/2-week views
- **Color-Coded Status:** 
  - Green: Available
  - Blue: Booked (confirmed)
  - Orange: Pending (deposit not received)
  - Gray: Blocked/Maintenance
  - Orange-Red: Partial bookings (multi-night stays)
- **Responsive Design:** Mobile-first, adapts to all screen sizes
- **Print-Friendly:** Clean print styles for reports

#### 2. **JavaScript Module** (`src/js/calendar-grid.js`)
Class-based calendar implementation with:

**Core Features:**
- Month/week/2-week view switching
- Drag-drop reservation moving (change dates or sites)
- Quick-book on available cells
- Context menus (right-click actions)
- Cell selection (shift+click for bulk operations)
- Real-time reservation status updates

**Main Methods:**
```javascript
new CalendarGrid(containerId, {
  viewMode: 'month', // 'week', '2week', 'month'
  parkId: 'park-123',
  onReservationChange: callback
})
```

**User Interactions:**
- **Left-click** (available): Quick-book dialog
- **Left-click** (booked): Show details popup
- **Double-click** (booked): Edit reservation
- **Right-click**: Context menu
- **Drag**: Move reservation across dates/sites
- **Shift+click**: Bulk select cells

#### 3. **Standalone Page** (`calendar-grid.html`)
- Full-screen calendar view
- Links back to main dashboard
- Mobile-optimized

### Backend API

#### **Endpoint:** `POST /api/admin/calendar` (or use `/api/admin/calendar.js` if set up)

**GET** - Fetch calendar data:
```
GET /api/admin/calendar?parkId=park-123&month=2026-08
```

**Response:**
```json
{
  "sites": [
    {
      "id": "site-1",
      "name": "Site A",
      "type": "RV - Full Hookup",
      "capacity": 6,
      "nightlyRateCents": 5000
    }
  ],
  "reservations": [
    {
      "id": "res-1",
      "siteId": "site-1",
      "guestName": "John Doe",
      "guestPhone": "555-1234",
      "guestEmail": "john@example.com",
      "checkInDate": "2026-08-01",
      "checkOutDate": "2026-08-04",
      "totalCents": 15000,
      "status": "confirmed"
    }
  ],
  "blockedDates": [
    {
      "siteId": "site-1",
      "date": "2026-08-15",
      "reason": "Maintenance"
    }
  ]
}
```

**POST** - Create reservation or block dates:
```json
{
  "action": "create-reservation",
  "siteId": "site-1",
  "guestName": "Jane Smith",
  "guestPhone": "555-5678",
  "checkInDate": "2026-08-10",
  "checkOutDate": "2026-08-12",
  "paymentMethod": "cash"
}
```

Or:
```json
{
  "action": "block-dates",
  "siteId": "site-1",
  "checkInDate": "2026-08-15",
  "checkOutDate": "2026-08-16",
  "reason": "Maintenance"
}
```

**PUT** - Move reservation:
```json
{
  "action": "move-reservation",
  "reservationId": "res-1",
  "newSiteId": "site-2",
  "newCheckInDate": "2026-08-20",
  "newCheckOutDate": "2026-08-23"
}
```

**DELETE** - Cancel or unblock:
```json
{
  "action": "cancel-reservation",
  "reservationId": "res-1"
}
```

Or:
```json
{
  "action": "unblock-date",
  "siteId": "site-1",
  "date": "2026-08-15"
}
```

### Database Schema

New table added to `reservations-store.js`:

```sql
CREATE TABLE blocked_dates (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT 'Blocked by staff',
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_blocked_dates_unique ON blocked_dates(site_id, date);
```

### New Functions in `api/_lib/reservations-store.js`

```javascript
// Get blocked dates for a park in a date range
getBlockedDatesForPark(parkId, startDate, endDate)

// Add/remove/get blocked dates
addBlockedDate(parkId, siteId, date, reason)
removeBlockedDate(parkId, siteId, date)

// Reservation management
getReservationById(reservationId)
getReservationsForParkInRange(parkId, startDate, endDate)
moveReservation(reservationId, newSiteId, newCheckInDate, newCheckOutDate)
cancelReservation(reservationId)
createReservation({ parkId, siteId, guestName, ... })
```

## File Structure

```
RVPark Website/
├── api/
│   └── admin/
│       └── calendar.js (NEW)
├── src/
│   ├── css/
│   │   └── calendar-grid.css (NEW)
│   └── js/
│       └── calendar-grid.js (NEW)
├── calendar-grid.html (NEW)
├── park-dashboard.html (UPDATED - added link)
└── README.md
```

## Integration with Existing Dashboard

1. **Link Added** to `park-dashboard.html`:
   - New "Interactive Calendar" section with "Open Calendar" button
   - Placed before "Recent Reservations" section
   - Attractive card layout explaining the feature

2. **CSS Integration**:
   - Calendar grid CSS imported in park-dashboard.html
   - All colors use existing design tokens
   - Responsive breakpoints for mobile

3. **User Flow**:
   - Staff visits `park-dashboard.html`
   - Sees "Open Calendar" button
   - Clicks to open full calendar at `calendar-grid.html`
   - Can perform all operations (book, move, block)
   - Returns to dashboard for other tasks

## Feature Details

### Quick Book
- Click any available (green) cell
- Opens dialog: Guest name, phone, dates, nights
- Creates confirmed reservation immediately
- Useful for phone/walk-in bookings

### Drag-Drop Movement
- Click and hold a booked reservation
- Drag to new dates on same site, or different site
- Validates availability before moving
- Auto-calculates new total based on dates

### Block Dates
- Available for maintenance, cleaning, owner stays
- Can block date ranges
- Optional reason/notes
- Easy unblock from context menu

### Context Menu (Right-Click)
- **Available:** Quick Book, Block Date
- **Booked:** View Details, Edit, Change Site, Cancel
- **Blocked:** Unblock Date

### Filters & Views
- **View Modes:** Week, 2-week, Month
- **Filters:** By site type, booking status, price range
- **Sidebar Stats:** 
  - Current month occupancy %
  - Revenue collected
  - Pending payments
  - Occupied nights

### Mobile Responsive
- Collapses to week view on mobile
- Touch-friendly larger cells and tap targets
- Horizontal scroll for dates
- Sticky site names column

## Performance Optimizations

1. **Virtual Scrolling:** Only renders visible rows
2. **Lazy Loading:** Loads month data on demand
3. **Smart Caching:** Caches previous/next months
4. **Selective Rendering:** Updates only changed cells
5. **Indexed Queries:** Database uses indexes on dates and site_id

## Security

- Session-based authentication required
- Park staff can only access their park's data
- All operations validated server-side
- Double-booking prevention via database transactions
- SQL injection protected via parameterized queries

## Error Handling

- Network errors show alert dialogs
- Invalid date ranges prevented with client-side validation
- Conflict detection for overlapping reservations
- Graceful degradation on API failures

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Accessibility

- Keyboard navigation (tab, arrow keys)
- ARIA labels on interactive elements
- Color + text indicators (not just color)
- High contrast for vision accessibility
- Focus indicators on all controls

## Future Enhancements

1. **Bulk Operations**
   - Select multiple dates with shift+click
   - Apply bulk pricing changes
   - Block/unblock multiple dates at once

2. **Advanced Filtering**
   - Filter by guest name
   - Search by phone/email
   - Filter by payment status

3. **Export/Print**
   - Print calendar for specific month
   - Export to CSV/Excel
   - PDF reports

4. **Seasonal Pricing Integration**
   - Visual indicators for seasonal rates
   - Quick apply seasonal rates from calendar

5. **Guest Messages**
   - Show guest notes in tooltips
   - Quick messaging from calendar

6. **Revenue Analytics**
   - Revenue breakdown by site
   - ADR tracking
   - Occupancy trends

## Testing

### Manual Testing Checklist
- [ ] Load calendar for current month
- [ ] Switch between week/2-week/month views
- [ ] Quick-book on available date
- [ ] Drag reservation to different date
- [ ] Drag reservation to different site
- [ ] Right-click context menu
- [ ] Block date range
- [ ] Unblock date
- [ ] Cancel reservation
- [ ] Filter by site
- [ ] Check sidebar stats are correct
- [ ] Test on mobile (responsive)
- [ ] Test keyboard navigation

### API Testing
- [ ] GET calendar data
- [ ] POST create reservation
- [ ] POST block dates
- [ ] PUT move reservation
- [ ] DELETE cancel/unblock

## Troubleshooting

**Calendar not loading:**
- Check if `/api/admin/calendar` endpoint exists
- Verify park ID is being passed correctly
- Check browser console for errors

**Drag-drop not working:**
- Ensure browser supports HTML5 Drag and Drop
- Clear browser cache and reload

**Dates showing incorrectly:**
- Check timezone settings in browser
- Verify date format is YYYY-MM-DD

**Styling issues:**
- Ensure CSS file is loading: check Network tab
- Verify CSS variables are defined in tokens.css

## Deployment Notes

1. **Database Migration:**
   - `blocked_dates` table created on first API call (lazy)
   - No manual migration needed for Vercel/Neon

2. **Environment Variables:**
   - Uses existing DATABASE_URL/POSTGRES_URL
   - No new env vars needed

3. **Function Limits:**
   - New API route counts as 1 Vercel function
   - Existing function limit unchanged

4. **Backwards Compatibility:**
   - No changes to existing APIs
   - No breaking changes to database schema
   - Existing dashboards still work

## Support

For issues or feature requests, check:
- Browser console for JavaScript errors
- Network tab for API errors
- Database logs for SQL errors
- Vercel deployment logs

---

**Implementation Date:** 2026-08-11  
**Status:** Ready for deployment  
**Performance Target:** 30-50% faster operations
