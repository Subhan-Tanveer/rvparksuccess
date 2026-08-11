# Social Media Integration Quick Reference

## Quick Start

### For Park Owners/Staff

#### Connect Social Account
1. Go to Park Dashboard → Social Media Manager
2. Click "Connect" on desired platform (Facebook, Instagram, TikTok, Twitter)
3. Log in with platform credentials when prompted
4. Approve access permissions
5. Account appears as "Connected" in the platform card

#### Create a Post
1. Fill in "Create Post" form:
   - Select platform
   - Write content or select template
   - Optionally add image
   - Schedule for later or publish now
2. Click "Post Now" or use schedule picker
3. Post appears in "Scheduled Posts" until published
4. Check "Performance" section after publishing for engagement

#### Use Caption Templates
1. Select a template from "Use Template" dropdown:
   - Last Minute Availability
   - Weekend Getaway Special
   - Seasonal Discount
   - Loyalty Reward
   - Referral Bonus
   - New Amenity Launch
2. Fill in template variables (park name, discount %, etc.)
3. Click "Generate Caption"
4. Edit if needed and post

#### Track Performance
1. Go to Performance section
2. Select platform and date range
3. View metrics:
   - Total posts published
   - Likes, shares, comments
   - Top performing posts
4. Use data to guide future content

---

## API Reference for Developers

### Authentication
All endpoints require:
- Header: `X-Park-Id: {parkId}`
- Header: `Authorization: Bearer {token}`

### Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/social/accounts` | List connected accounts |
| GET | `/api/admin/social/platforms` | Get supported platforms |
| POST | `/api/admin/social/connect` | Connect new account |
| POST | `/api/admin/social/disconnect` | Disconnect account |
| GET | `/api/admin/social/scheduled` | List pending posts |
| POST | `/api/admin/social/post` | Create post |
| POST | `/api/admin/social/schedule` | Schedule post |
| POST | `/api/admin/social/auto-post` | Auto-generate post |
| GET | `/api/admin/social/performance` | Get metrics |
| POST | `/api/admin/social/generate-caption` | Generate caption |
| GET | `/api/admin/social/captions` | List templates |
| POST | `/api/admin/social/post/delete` | Delete post |
| POST | `/api/admin/social/post/update` | Update post |

### Code Examples

#### Get Connected Accounts
```javascript
const res = await fetch('/api/admin/social/accounts', {
  headers: {
    'X-Park-Id': 'park-123',
    'Authorization': 'Bearer token'
  }
});
const { accounts } = await res.json();
```

#### Create a Post
```javascript
const res = await fetch('/api/admin/social/post', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Park-Id': 'park-123',
    'Authorization': 'Bearer token'
  },
  body: JSON.stringify({
    platform: 'facebook',
    content: 'Join us this weekend!',
    publish: true
  })
});
const { post } = await res.json();
```

#### Schedule a Post
```javascript
const res = await fetch('/api/admin/social/schedule', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Park-Id': 'park-123',
    'Authorization': 'Bearer token'
  },
  body: JSON.stringify({
    platform: 'instagram',
    content: 'Limited time offer!',
    scheduledTime: '2026-08-15T14:00:00Z'
  })
});
const { post } = await res.json();
```

#### Generate Caption
```javascript
const res = await fetch('/api/admin/social/generate-caption', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Park-Id': 'park-123'
  },
  body: JSON.stringify({
    offerType: 'last_minute_availability',
    parkName: 'Sunny Acres RV Park',
    details: {
      siteType: 'Full Hookup',
      count: 2,
      dates: '2026-08-15'
    }
  })
});
const { caption } = await res.json();
```

#### Get Performance Metrics
```javascript
const res = await fetch('/api/admin/social/performance?platform=facebook&days=30', {
  headers: {
    'X-Park-Id': 'park-123',
    'Authorization': 'Bearer token'
  }
});
const { posts } = await res.json();
```

---

## Platform Limits & Features

| Platform | Char Limit | Images | Scheduling | Key Feature |
|----------|-----------|--------|-----------|------------|
| Facebook | 63,206 | Yes | Yes | Reactions, shares |
| Instagram | 2,200 | Yes | Yes | Hashtags, stories |
| TikTok | 2,200 | No* | No | Videos, trending sounds |
| Twitter/X | 280 | Yes | No | Threads, retweets |

*TikTok is video-first; include caption in video description

---

## Database Schema Quick Reference

### social_accounts
Stores platform credentials (encrypted)
```sql
- id: unique identifier
- park_id: which park owns this account
- platform: 'facebook', 'instagram', 'tiktok', 'twitter'
- username: platform username
- access_token_encrypted: encrypted OAuth token
- status: 'connected' or 'disconnected'
- last_posted: when account last posted
```

### social_posts
Tracks all social media posts
```sql
- id: unique identifier
- park_id: which park created this
- platform: target platform
- content: post text
- status: 'draft', 'scheduled', or 'published'
- scheduled_time: when to publish (null = now)
- published_time: when actually published
- engagement_json: likes, shares, comments data
```

### social_metrics
Historical engagement data
```sql
- id: unique identifier
- park_id: which park
- platform: platform name
- date_collected: date of metrics
- likes, shares, comments, reach: engagement counts
- engagement_rate: percent of followers engaged
```

---

## Caption Templates Reference

### Template Variables
Every template accepts these replacements:
- `{parkName}` - Your RV park name
- `{siteType}` - Type of site (RV, Glamping, etc.)
- `{count}` - Number of available sites
- `{dates}` - Date range
- `{discount}` - Discount percentage
- `{season}` - Season/campaign name
- `{amenity}` - New amenity name

### Template Examples

**Last Minute Availability**
```
"Hot deal alert! {parkName} has {count} {siteType} site(s) available for {dates}. Book now and save big!"
```

**Seasonal Discount**
```
"{season} special at {parkName}! Enjoy {discount}% off {siteType} accommodations. Perfect time to visit!"
```

**Loyalty Reward**
```
"Thank you for being part of the {parkName} family! Loyal guests enjoy {discount}% off their next stay."
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Post won't publish | Check platform account connected, token valid, content length |
| Character count shows wrong | Different platforms count unicode/emojis differently |
| Metrics not updating | Wait 15+ minutes, verify scheduled time was past |
| Can't disconnect account | Ensure authorized with correct park ID |
| Encryption errors | Check ENCRYPTION_KEY env var set in production |

---

## Environment Variables

```bash
# Required for production
ENCRYPTION_KEY=your-32-char-encryption-key-here

# Database connection
DATABASE_URL=postgresql://user:pass@host/db
POSTGRES_URL=postgresql://user:pass@host/db

# Optional for webhook (future)
SOCIAL_WEBHOOK_SECRET=webhook-signing-key
```

---

## Rate Limits & Best Practices

### Posting
- Facebook: 200 posts/day
- Instagram: 200 posts/day
- TikTok: 50 posts/day
- Twitter: Depends on account type

### Guidelines
1. Post during peak hours (8am-10pm)
2. Use relevant hashtags (Instagram, TikTok)
3. Keep captions 30-80% of platform limit
4. Post 3-5 times per week max
5. Engage with comments within 2 hours
6. Test new templates on 1 platform first

---

## Common Responses

```javascript
// Success response
{
  success: true,
  account: {
    id: "social-...",
    platform: "facebook",
    username: "@parkname",
    status: "connected",
    lastPosted: "2026-08-10T14:30:00Z"
  }
}

// Error response
{
  error: "Platform not supported"
}

// Posts list response
{
  posts: [{
    id: "post-...",
    platform: "facebook",
    content: "Join us this weekend!",
    status: "scheduled",
    scheduled_time: "2026-08-15T14:00:00Z",
    engagement: {
      likes: 42,
      shares: 8,
      comments: 15
    }
  }]
}
```

---

## Support Resources

- **Full Implementation Guide**: See `SOCIAL_MEDIA_IMPLEMENTATION.md`
- **API Docs**: Each endpoint has detailed parameters/responses
- **Platform APIs**:
  - Facebook Graph API: https://developers.facebook.com/docs/graph-api
  - Instagram Graph API: https://developers.instagram.com/docs/instagram-api
  - Twitter API v2: https://developer.twitter.com/en/docs
  - TikTok API: https://developers.tiktok.com/doc/

## Version Info

- Implementation: Phase 3, RVPark Success Platform
- Updated: August 2026
- Supported Platforms: Facebook, Instagram, TikTok, Twitter/X
- Database: PostgreSQL with Neon
- Encryption: AES-256-GCM
