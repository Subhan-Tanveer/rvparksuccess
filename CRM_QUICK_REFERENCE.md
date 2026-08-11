# CRM Quick Reference Guide

## For Staff Users

### Accessing the CRM

1. Log in to your park's staff dashboard
2. Scroll to the "Guest Management — CRM Dashboard" section at the bottom
3. You'll see the guest list by default

### Guest List View

**Columns:**
- **Name**: First part of guest email
- **Email**: Full guest email (clickable to open profile)
- **Phone**: Currently shows "--" (future enhancement)
- **Visits**: Number of confirmed bookings
- **Lifetime Value**: Total amount spent
- **Risk Score**: 0-100 (Low: green, Medium: orange, High: red)
- **Last Booking**: Future implementation
- **Tags**: Color-coded tags (click to filter)
- **Actions**: "View" button to open guest profile

**Pagination:**
- Shows 50 guests per page
- Previous/Next buttons to navigate
- Page counter shows current page

### Guest Profile Modal

Click "View" on any guest to open their full profile.

**Profile Tab:**
- Guest name and email
- Lifetime Value, # of stays, risk score
- Preferences (dietary, accessibility, pets)
- Tags with ability to add/remove
- Add new tags with the "Add new tag..." input

**Bookings Tab:**
- Last 10 confirmed bookings
- Dates, duration, cost, status
- Sorted newest first

**Communications Tab:**
- Email, SMS, and call history
- Subject lines and message previews
- Dates and delivery status
- Timeline format with newest first

**Notes Tab:**
- Staff notes from all team members
- Timestamps and author info
- Add new notes with the textarea
- Max 1000 characters per note

### Tagging Strategy

**Suggested Tags:**

**Tier (one per guest):**
- `VIP` — High-value or frequently booking guests
- `Frequent` — Books 3+ times per year
- `Occasional` — Books 1-2 times per year
- `Budget` — Books budget-friendly sites

**Behavior:**
- `Early-Check-In` — Prefers early arrival
- `Late-Checkout` — Prefers late departure
- `Requires-Attention` — Needs extra service
- `Issue-Prone` — History of complaints
- `Always-Late` — Consistently checks in late

**Preferences:**
- `Pet-Friendly` — Traveling with pet
- `Quiet-Site` — Wants isolation
- `Group-Booking` — Books for multiple sites

**Status:**
- `Will-Return` — Expressed intent to rebook
- `Considering-Cancellation` — Mentioned canceling
- `Recently-Contacted` — Emailed/called in last week

**Segments (auto-generated, for reference):**
- `Loyal` — Low risk, high engagement
- `At-Risk` — High cancellation probability
- `Inactive` — No contact > 90 days

### Segmentation View

Click the "Segmentation" tab to see guest breakdown:

**Cards show:**
- **Loyal**: Guests unlikely to cancel
  - Count: Usually 30-40% of base
  - Avg LTV: Typically highest
  - Action: Nurture and reward loyalty

- **Occasional**: Casual guests
  - Count: Usually 20-30% of base
  - Avg LTV: Medium
  - Action: Offer incentives to increase frequency

- **At-Risk**: Likely to cancel/complain
  - Count: Usually 10-20% of base
  - Avg LTV: Lowest
  - Action: Reach out proactively, address concerns

- **Inactive**: No recent contact
  - Count: Usually largest segment
  - Avg LTV: Low
  - Action: Re-engagement campaigns

**Click any card to filter guest list by that segment**

### At-Risk Management

Click the "At-Risk" tab for guests likely to cancel.

**Guests shown sorted by risk score (highest first):**
- Risk badge (red) shows score 0-100
- Email and LTV displayed
- "View Profile" button
- Suggested actions:
  1. Check booking history for patterns
  2. Review notes for past issues
  3. Reach out proactively
  4. Tag as "Requires-Attention"

## Common Workflows

### Workflow: After Guest Booking

1. **Find guest** in list (search/filter if needed)
2. **View profile** to see if returning guest
3. **Add note**: "Booking confirmed for [dates], site [name]"
4. **Add/update preference**: Note any special requests
5. **Add tag**: e.g., `Early-Check-In` if mentioned
6. **Result**: Staff has context for check-in

### Workflow: Guest Complains

1. **Find guest**, open profile
2. **Go to Notes tab**
3. **Add note**: Describe issue, action taken
4. **Add tag**: `Issue-Prone` if pattern emerging
5. **Monitor**: System will increase risk score
6. **Follow-up**: Add note when resolved
7. **Result**: Team aware of history, can prevent future issues

### Workflow: Win Back Inactive Guest

1. **Go to Segmentation tab**
2. **Click Inactive card** to filter
3. **Choose guest** to contact
4. **View profile** → Communications tab
5. **Check last contact** date
6. **Add note**: "Reached out via [email/SMS] on [date]"
7. **Log communication**: Post-send → click post-email to log it
8. **Add tag**: `Will-Return` if they respond positively
9. **Result**: Tracked re-engagement effort

### Workflow: Prepare for Guest Arrival

1. **Find upcoming guest** in guest list
2. **Click to view profile**
3. **Review all tabs:**
   - Preferences: Early checkout? Pets? Dietary needs?
   - Notes: Any special requests or issues?
   - Communications: Last email/call?
   - Bookings: First time or returning?
4. **Prepare**: Ready special amenities
5. **Print**: Note profile for front desk
6. **Result**: Personalized, smooth check-in

## API Endpoint Quick Reference

### Client-Side (Automatic)

These are called by the UI automatically:

| Action | Endpoint |
|--------|----------|
| Load guest list | `GET /api/admin/crm?action=guests&page=0` |
| Load guest profile | `GET /api/admin/crm?action=guest&guestEmail=...` |
| Load segments | `GET /api/admin/crm?action=segments` |
| Load at-risk | `GET /api/admin/crm?action=at-risk&limit=10` |
| Add tag | `POST /api/admin/crm?action=tag` |
| Remove tag | `DELETE /api/admin/crm?action=tag&tagId=...` |
| Add note | `POST /api/admin/crm?action=note` |
| Update preferences | `POST /api/admin/crm?action=preferences` |
| Log communication | `POST /api/admin/crm?action=communication` |

### Manual Integration (For Developers)

To integrate from other systems (e.g., email system, SMS system):

**Log email sent:**
```javascript
await fetch('/api/admin/crm?action=communication', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    guestEmail: guest.email,
    type: 'email',
    subject: 'Your booking confirmation',
    messagePreview: 'Your reservation for [dates] is confirmed...',
    status: 'sent'
  })
});
```

**Add preference after phone call:**
```javascript
await fetch('/api/admin/crm?action=preferences', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    guestEmail: guest.email,
    preferences: {
      preferredCheckInTime: '4:00 PM',
      preferredSiteType: 'beachfront'
    }
  })
});
```

**Tag for segment:**
```javascript
await fetch('/api/admin/crm?action=tag', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    guestEmail: guest.email,
    tagName: 'VIP'
  })
});
```

## Troubleshooting

### "Guest not found" when searching

- Make sure email spelling is exact
- Try searching by first part of email (before @)
- Guest may not have any bookings at this park yet

### Tag already exists error

- Guest already has this tag
- To change tag: remove old tag, add new tag

### Note character limit exceeded

- Max 1000 characters per note
- Count shown in textarea
- Break into multiple notes if needed

### At-Risk list empty but no errors

- System calculates risk_score based on booking/cancellation history
- New guests default to score 0
- Score updated by system over time

### Segmentation counts don't match guest list total

- Segments based on risk_score + last_contacted
- A guest can appear in multiple logic patterns
- Counts are independent calculations
- Totals are across all segments for stats

### Modal won't close

- Click the X in top right corner
- Press Escape key (future implementation)
- Click outside modal (future implementation)

## Best Practices

1. **Tag Consistently**: Use same tag names across team (prevent duplicates)
2. **Note When Contacting**: Log every communication in notes (builds history)
3. **Update Preferences**: Record special requests/dietary needs (improve service)
4. **Review At-Risk**: Check weekly for guests to reach out to
5. **Archive Old Notes**: Consider which guests need notes pruned (performance)
6. **Segment Strategy**: Use segmentation to prioritize marketing/retention efforts

## Limits and Constraints

| Limit | Value | Purpose |
|-------|-------|---------|
| Guests per page | 50 | Performance, browser rendering |
| Note max length | 1000 characters | Prevent runaway data |
| Communications shown | Last 20 | Timeline readability |
| Bookings shown | Last 10 | Profile not cluttered |
| At-Risk list | 10 by default, 20 max | Focus on highest priority |
| Tag length | 100 characters | UI space |
| Unique tags per guest | No limit | Flexibility |

## Data Retention

- **Guest profiles**: Kept indefinitely
- **Notes**: Kept indefinitely (consider annual cleanup)
- **Tags**: Kept indefinitely (can be removed manually)
- **Communications**: Kept 365 days (future purge automation)
- **Booking history**: Kept indefinitely (tied to reservations table)

## Future Features Coming Soon

- **Advanced search**: Search notes, preferences, tags
- **Bulk tagging**: Select multiple guests, apply tag
- **Email composer**: Send emails directly from CRM
- **SMS composer**: Send SMS directly from CRM
- **Scheduled follow-ups**: Set reminders to contact guests
- **Export to CSV**: Download guest list or segment
- **Guest photo uploads**: Store guest profile pictures
- **Communication templates**: Pre-written messages
- **Automated workflows**: Trigger actions on booking/cancellation
- **Guest feedback surveys**: In-app survey collection
