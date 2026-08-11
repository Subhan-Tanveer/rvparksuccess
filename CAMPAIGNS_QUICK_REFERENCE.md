# Campaigns Engine — Quick Reference

## Campaign Types at a Glance

| Type | Use Case | Timing | ROI |
|------|----------|--------|-----|
| **Seasonal** | Holiday/seasonal discounts | 2-4 weeks before | High (planned revenue impact) |
| **Loyalty** | Reward repeat customers | Year-round | Medium (good retention) |
| **Event-Driven** | React to user actions | Immediate | High (intent-based) |
| **Behavioral** | Target at-risk guests | Ongoing | Medium-High |
| **Referral** | Incentivize word-of-mouth | Ongoing | Medium (acquisition cost) |

## Campaign Builder: Step-by-Step

### Step 1: Type Selection
Choose from 5 campaign types (see above)

### Step 2: Campaign Details
- **Name**: e.g., "Labor Day Special 2024"
- **Start Date**: When campaign begins
- **End Date**: When campaign expires
- **Budget** (optional): Max discount spend
- **Description**: Internal notes

### Step 3: Offer Details
- **Discount Type**: Percent off OR Fixed $ off
- **Amount**: 5-100% or dollar amount
- **Promo Code** (optional): Unique code for checkout (uppercase)

Example: LABORDAY15 = 15% off

### Step 4: Recipients
Choose target segment:
- **All Guests** — Everyone
- **Loyal Customers** — 3+ bookings
- **Inactive** — No booking in 60+ days
- **At-Risk** — Pending cancellation

### Step 5: Message Content
- **Email Subject**: max 60 chars, e.g., "Get 15% off this Labor Day!"
- **Email Body**: HTML template with {{variables}}
- **SMS Text**: max 160 chars, no HTML

Template variables:
- `{{name}}` → Guest first name
- `{{discount}}` → Discount amount
- `{{promoCode}}` → Promo code
- `{{discountType}}` → "percent" or "fixed"

### Step 6: A/B Testing (Optional)
Enable to test 2 email variations:
- **Variant A** (Control): Original subject + body
- **Variant B** (Test): Alternative subject + body

Recipients split 50/50 automatically.

### Step 7: Review & Create
Summary of all settings before sending.

## Email Template Example

```html
<h2>{{discount}}% Off Your Next Stay!</h2>
<p>Hi {{name}},</p>
<p>We're celebrating Labor Day with a special offer just for you.</p>
<p style="font-size: 18px; font-weight: bold;">
  {{discount}}% off any RV site through September 5th
</p>
<p>Use promo code: <code style="background: #f0f0f0; padding: 4px 8px;">{{promoCode}}</code></p>
<a href="https://rvparksuccess.com/find-a-park" style="display: inline-block; background: #d98500; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
  Book Your Site
</a>
<p style="color: #999; font-size: 12px; margin-top: 20px;">
  This offer expires {{endDate}}. Some restrictions may apply.
</p>
```

## SMS Template Example

```
Hi {{name}}, get {{discount}}% off with code {{promoCode}}. Valid through Sept 5. Book now: rvparksuccess.com
```

(Exactly 136 chars = fits in 1 SMS)

## Campaign Lifecycle

```
Draft → Scheduled → Active → Completed
   ↑                    ↓
   └─ Pause ←→ Resume ─┘

Delete (draft only)
```

### Status Meanings
- **Draft** — Created, not yet sent
- **Scheduled** — Ready to send (waiting for date)
- **Active** — Currently running, sending messages
- **Paused** — Temporarily stopped
- **Completed** — Campaign ended

## Key Metrics

### Delivery Metrics
- **Emails Sent** — Total emails queued
- **SMS Sent** — Total SMS messages sent

### Engagement Metrics
- **Open Rate** — % of emails opened (email tracking)
- **Click Rate** — % of email links clicked
- **Conversion Rate** — % who booked after campaign

### Revenue Metrics
- **Conversions** — # of bookings from campaign
- **Revenue Generated** — $ total bookings
- **Campaign Cost** — $ spent on sends (~$0.50/email, $1.50/SMS)
- **ROI** — Return on investment % = (Revenue - Cost) / Cost × 100

### A/B Test Metrics
- **Variant A vs B** — Compare conversion rate
- **Winner** — Higher conversion rate variant (declared after 7 days)

## ROI Calculation Formula

```
Cost = (emails_sent × $0.50) + (sms_sent × $1.50)
Revenue = sum of booking amounts from conversions
Profit = Revenue - Cost
ROI % = (Profit / Cost) × 100

Example:
- Sent 1000 emails = $500 cost
- 50 conversions × $200 avg booking = $10,000 revenue
- Profit = $10,000 - $500 = $9,500
- ROI = ($9,500 / $500) × 100 = 1900%
```

## Common Campaign Scenarios

### Scenario 1: Labor Day Promo
```
Type: Seasonal
Start: Aug 20 | End: Sep 5
Discount: 15% | Code: LABORDAY15
Target: All Guests
Email Subject: "Celebrate Labor Day with 15% Off!"
SMS: "Happy Labor Day! Get 15% off with code LABORDAY15 through Sept 5"
Expected ROI: 200-400% (seasonal peak)
```

### Scenario 2: Win Back Inactive Guests
```
Type: Behavioral
Start: Now | End: +30 days
Discount: $50 fixed | Code: COMEBACK50
Target: Inactive (60+ days)
Email Subject: "We miss you! Here's $50 off to come back"
SMS: "Hi {{name}}, we miss you! $50 off your next stay with code COMEBACK50"
Expected ROI: 50-150% (lower engagement, but high LTV if they return)
```

### Scenario 3: Loyalty Reward
```
Type: Loyalty
Start: Now | End: 12 months
Discount: 20% | Code: LOYAL20
Target: Loyal Customers (3+ bookings)
Email Subject: "Exclusive: 20% off for our valued guests"
SMS: "Thank you for staying with us! Exclusive 20% off with code LOYAL20"
Expected ROI: 300-500% (high engagement, retention value)
```

### Scenario 4: Referral Program
```
Type: Referral
Start: Now | End: 12 months
Discount: $25 credit (both parties) | Code: REFER25
Target: Loyal Customers
Email Subject: "Refer a friend, both get $25 credit!"
SMS: "Refer a friend, both get $25 credit! Share your code: REFER25"
Expected ROI: Variable (acquisition depends on referral volume)
```

### Scenario 5: Abandoned Cart Recovery
```
Type: Event-Driven
Start: Immediate | End: 7 days
Discount: 10% | Code: FINISH10
Target: Cart abandoners
Email Subject: "You're just one click away..."
SMS: "Forgot your booking? Use code FINISH10 for 10% off!"
Expected ROI: 400-800% (high intent, time-sensitive)
```

## Command Reference

### Creating a Campaign (Programmatic)
```bash
curl -X POST https://rvparksuccess.com/api/admin/campaigns \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Labor Day Sale",
    "type": "seasonal",
    "startDate": "2024-09-01",
    "endDate": "2024-09-05",
    "discountAmount": 15,
    "discountType": "percent",
    "promoCode": "LABORDAY15"
  }'
```

### Adding Recipients
```bash
curl -X POST https://rvparksuccess.com/api/admin/campaigns/:campaignId/recipients \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": [
      { "email": "guest1@example.com", "phone": "+12125551234" },
      { "email": "guest2@example.com" }
    ]
  }'
```

### Sending Campaign
```bash
curl -X POST https://rvparksuccess.com/api/admin/campaigns/:campaignId/execute \
  -H "Content-Type: application/json" \
  -d '{ "sendEmail": true, "sendSms": true }'
```

### Getting Performance
```bash
curl https://rvparksuccess.com/api/admin/campaigns/:campaignId/performance \
  -H "Authorization: Bearer $TOKEN"
```

## Troubleshooting Checklist

| Problem | Solution |
|---------|----------|
| "Campaign has no recipients" | Use `/recipients` endpoint to add guest list first |
| Campaign not sending | Check: dates valid, recipients have email/phone, SMS provider configured |
| 0% open rate | Email tracking requires Sendgrid/Mailgun, not Nodemailer |
| Promo code not working | Verify code exists in park's promo codes list |
| A/B test not splitting | Ensure both variant A and B created, minimum 100 recipients |
| High bounce rate | Validate email addresses in recipient list |
| SMS delivery failures | Verify phone numbers in E.164 format (+1234567890) |

## Performance Tips

### For High Open Rates (20-30%)
1. Send to engaged segment (loyal customers, recent bookers)
2. Use personalization ({{name}})
3. Clear, benefit-focused subject line
4. Mobile-friendly HTML (test on phone)
5. Send at 10am-2pm on weekdays

### For High Click Rates (5-15%)
1. Single, obvious CTA button ("Book Now")
2. Make offer compelling and urgent ("Expires tonight")
3. A/B test subject lines and CTAs
4. Use mobile preview before sending

### For High Conversion Rates (2-10%)
1. Offer relevant to guest segment (seasonal timing)
2. Easy promo code entry at checkout
3. No "fine print" surprises (clear restrictions)
4. Follow up with SMS reminder 48h before expiry
5. Loyalty rewards convert better than seasonal

## Batch Operations

For campaigns with 10k+ recipients:
1. Split recipients into segments (1000 each)
2. Schedule sends 1 hour apart
3. Monitor delivery rates in real-time
4. Adjust next batch if early batches underperform

Example: 50k recipients = 50 batches × 1 hour = 50-hour rollout

## Data Retention

Campaigns and their data are kept indefinitely for:
- Historical ROI analysis
- Trend reporting year-over-year
- Promo code usage tracking

Delete campaigns manually only if needed for GDPR compliance.

## Security Notes

- Campaign data is park-scoped (isolation)
- Guest emails never exposed to other parks
- Promo codes validated before discount applies
- Discount amount capped at 100% for safety
- All campaign changes logged with timestamp

## Support & Limits

| Feature | Limit | Notes |
|---------|-------|-------|
| Campaign recipients | Unlimited | Subject to email provider limits |
| Email sends/day | Unlimited | Sendgrid/Mailgun limits apply |
| SMS sends/day | 60/minute | Twilio rate limit |
| A/B test variants | 2 | 50/50 split only |
| Promo codes | Unlimited | Per-park unique |
| Campaign storage | Unlimited | Archived after 12 months |
| Email template size | 10MB | Includes images, HTML |

## Next Steps

1. **For Your First Campaign:**
   - Review scenarios above
   - Plan timing and targeting
   - Write email copy with templates
   - Create in dashboard
   - Test with small segment (100 recipients)
   - Monitor metrics for 7 days

2. **For Best Results:**
   - Run 2-3 A/B tests before scaling
   - Segment guests by booking history/LTV
   - Track ROI on each campaign type
   - Refine based on data

3. **Advanced:**
   - Automate behavioral campaigns (post-cancellation)
   - Combine with dynamic pricing for seasonal revenue optimization
   - Integrate with CRM for sophisticated segmentation
