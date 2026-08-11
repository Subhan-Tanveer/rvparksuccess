# Social Media Integration Implementation Guide

## Overview

Phase 3 of RVPark Success adds comprehensive social media management capabilities, allowing park owners to connect their social accounts and auto-post availability and promotional updates to Facebook, Instagram, TikTok, and Twitter/X.

## Architecture

### Backend Components

#### 1. Social Media Manager (`api/_lib/social-media-manager.js`)

Core library handling all social media operations:

**Token Management**
- `encryptToken(token)` - Encrypt access tokens for secure storage
- `decryptToken(encrypted)` - Decrypt stored tokens on retrieval

**Account Management**
- `connectSocialAccount(db, parkId, platform, accessToken, refreshToken, username)` - Store platform credentials
- `getSocialAccounts(db, parkId)` - Retrieve all connected accounts for a park
- `disconnectSocialAccount(db, parkId, platform)` - Remove account connection

**Post Management**
- `scheduleSocialPost(db, parkId, platform, content, imageUrl, scheduledTime)` - Create draft or schedule post
- `getScheduledPosts(db, parkId, platform)` - Retrieve pending posts
- `publishPost(db, parkId, postId, accessToken, platform)` - Publish to platform
- `deleteSocialPost(db, parkId, postId)` - Delete draft/scheduled posts
- `updateSocialPost(db, parkId, postId, updates)` - Edit pending posts

**Auto-Posting**
- `autoPostAvailability(db, parkId, availableDates, parkName, siteType)` - Post availability alerts
- `autoPostPromotion(db, parkId, campaignName, discount, endDate, parkName)` - Post promotional content

**Caption Generation**
- `generateCaption(offerType, parkName, details)` - AI-powered caption templates
- `getCaptionTemplates()` - List available templates

**Analytics**
- `trackEngagementMetrics(db, parkId, platform, postId, metrics)` - Store engagement data
- `getPostPerformance(db, parkId, platform, days)` - Retrieve engagement metrics

**Platform Configuration**
- `getPlatformConfig(platform)` - Get platform-specific settings (char limits, features)
- `getSupportedPlatforms()` - List all supported platforms

#### 2. Social Media API (`api/admin/social.js`)

RESTful API endpoints for dashboard integration:

**Endpoints**

```
GET /api/admin/social/accounts
  - Returns: { accounts: [...] }
  - Parks staff's connected social media accounts
  - Auth: X-Park-Id header required

GET /api/admin/social/platforms
  - Returns: { platforms: [...] }
  - All supported social media platforms with features

POST /api/admin/social/connect
  - Body: { platform, accessToken, refreshToken, username }
  - Connect new social media account
  - Auth: X-Park-Id header required

POST /api/admin/social/disconnect
  - Body: { platform }
  - Disconnect social media account
  - Auth: X-Park-Id header required

GET /api/admin/social/scheduled
  - Query: ?platform=facebook&days=30
  - Returns: { posts: [...] }
  - List pending/scheduled posts
  - Auth: X-Park-Id header required

POST /api/admin/social/post
  - Body: { platform, content, imageUrl, scheduleTime, publish }
  - Create new post (draft or immediate)
  - Auth: X-Park-Id header required

POST /api/admin/social/schedule
  - Body: { platform, content, imageUrl, scheduledTime }
  - Schedule post for future publishing
  - Auth: X-Park-Id header required

POST /api/admin/social/auto-post
  - Body: { type, parkName, availableDates, campaignName, discount, endDate, siteType }
  - Auto-generate and post availability/promo updates
  - Auth: X-Park-Id header required

GET /api/admin/social/performance
  - Query: ?platform=facebook&days=30
  - Returns: { posts: [...] }
  - Get engagement metrics for published posts
  - Auth: X-Park-Id header required

POST /api/admin/social/generate-caption
  - Body: { offerType, parkName, details }
  - Returns: { caption: "..." }
  - Generate AI-powered caption
  - Auth: X-Park-Id header required

GET /api/admin/social/captions
  - Returns: { templates: [...] }
  - List available caption templates

POST /api/admin/social/post/delete
  - Body: { postId }
  - Delete draft or scheduled post
  - Auth: X-Park-Id header required

POST /api/admin/social/post/update
  - Body: { postId, content, imageUrl, scheduledTime }
  - Update pending post
  - Auth: X-Park-Id header required
```

### Frontend Components

#### 3. Social Dashboard UI (`src/js/social-dashboard.js`)

Interactive dashboard for managing social media:

**Sections**

1. **Connected Accounts**
   - Platform status cards (Facebook, Instagram, TikTok, Twitter)
   - Connect/disconnect buttons with OAuth flow
   - Last posted timestamp
   - Platform-specific styling

2. **Post Composer**
   - Multi-platform selector
   - Rich text editor with character counter
   - Platform-specific character limits
   - Image upload (optional)
   - Schedule picker (now, date/time, or draft)
   - Template selector for AI caption generation
   - Preview before posting

3. **Scheduled Posts**
   - List of pending posts (chronological)
   - Edit button (for drafts only)
   - Delete button (for drafts/scheduled only)
   - Status badge (draft, scheduled, published)
   - Published posts are immutable

4. **Performance Analytics**
   - Engagement metrics (likes, shares, comments)
   - Platform and date range filters
   - Top performing posts display
   - Historical trend visualization

**Functions**

- `initSocialDashboard(park)` - Initialize dashboard
- `loadPlatforms()` - Load connected accounts
- `renderPlatformCards()` - Render account cards UI
- `handleConnectPlatform(platform)` - OAuth connection flow
- `handleDisconnectPlatform(platform)` - Account disconnection
- `loadScheduledPosts()` - Fetch pending posts
- `renderScheduledPosts()` - Render posts table
- `loadPerformanceMetrics()` - Fetch engagement data
- `setupEventListeners()` - Wire up form handlers
- `handleEditPost(postId)` - Edit pending post
- `handleDeletePost(postId)` - Delete post

#### 4. Social Dashboard Styling (`src/css/social-dashboard.css`)

Comprehensive styling including:

- Platform-specific colors (Facebook blue, Instagram pink, TikTok black, Twitter blue)
- Platform card grid layout (responsive)
- Post composer form styling
- Character counter with limits
- Scheduled posts table styling
- Performance metrics cards
- Top posts list
- Status chips and badges
- Form field styling with float labels
- Loading states and animations
- Dark mode support

### Database Schema

#### New Tables

**social_accounts**
```sql
CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  platform TEXT NOT NULL,
  username TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  last_posted TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(park_id, platform)
);
```

**social_posts**
```sql
CREATE TABLE social_posts (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  platform TEXT NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  scheduled_time TIMESTAMPTZ,
  published_time TIMESTAMPTZ,
  platform_post_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  engagement_json TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**social_metrics**
```sql
CREATE TABLE social_metrics (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  platform TEXT NOT NULL,
  date_collected DATE NOT NULL,
  likes INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  engagement_rate NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(park_id, platform, date_collected)
);
```

## Platform Support

### Facebook Pages
- **Auth**: OAuth 2.0
- **Char Limit**: 63,206 characters
- **Features**: Images, scheduling, reactions tracking
- **API Base**: `https://graph.facebook.com/v18.0`

### Instagram
- **Auth**: OAuth 2.0 (via Facebook)
- **Char Limit**: 2,200 characters
- **Features**: Images, hashtags, scheduling, engagement metrics
- **API Base**: `https://graph.instagram.com/v18.0`

### TikTok
- **Auth**: OAuth 2.0
- **Char Limit**: 2,200 characters
- **Features**: Video (primary), captions
- **API Base**: `https://open-api.tiktok.com/v1`

### Twitter/X
- **Auth**: OAuth 2.0
- **Char Limit**: 280 characters
- **Features**: Images, threading, real-time engagement
- **API Base**: `https://api.twitter.com/2`

## Caption Templates

**Available Templates**

1. **Last Minute Availability**
   - Alerts guests to unexpected openings
   - Includes site type, count, and dates
   - Example: "Hot deal alert! [Park Name] has 1 RV Full Hookup site(s) available for [Dates]. Book now and save big!"

2. **Weekend Special**
   - Targets weekend getaway seekers
   - Highlights discount percentage
   - Example: "Weekend warrior special at [Park Name]! Get 10% off RV sites this weekend. Limited spots available!"

3. **Seasonal Discount**
   - Promotes seasonal pricing
   - Includes season name
   - Example: "Summer special at [Park Name]! Enjoy 10% off RV accommodations. Perfect time to visit!"

4. **Loyalty Reward**
   - Thanks repeat guests
   - Encourages return visits
   - Example: "Thank you for being part of the [Park Name] family! Loyal guests enjoy 10% off their next stay."

5. **Referral Bonus**
   - Grows customer base through referrals
   - Offers dual incentive
   - Example: "Know someone who needs an RV escape? Refer them to [Park Name] and you both get 10% off!"

6. **New Amenity Launch**
   - Announces facility improvements
   - Includes amenity description
   - Example: "Exciting news! [Park Name] now features full WiFi coverage. Experience the upgrade on your next visit!"

## Encryption

All social media access tokens are encrypted before storage using AES-256-GCM:

```javascript
// Encryption
const encrypted = encryptToken(accessToken);
// Format: {iv_hex}:{authTag_hex}:{encrypted_hex}

// Decryption
const token = decryptToken(encrypted);
```

The encryption key is read from `ENCRYPTION_KEY` environment variable. Change this in production!

## Error Handling

**Common Errors**

- **Unauthorized**: Missing X-Park-Id header or invalid auth
- **Invalid Platform**: Platform not in supported list
- **Character Limit Exceeded**: Content exceeds platform limit
- **Post Not Found**: Invalid postId or already published
- **Account Not Connected**: Platform account not linked to park
- **Token Decryption Failed**: Corrupted or tampered token

## Security Considerations

1. **Token Encryption**: All access tokens encrypted with AES-256-GCM
2. **Park-Scoped Access**: Staff can only access their own park's data
3. **Immutable Published Posts**: Cannot edit posts after publishing
4. **Rate Limiting**: Platform API rate limits should be respected (future)
5. **Input Validation**: All content validated before posting

## Performance Optimizations

1. **Token Caching**: Decrypted tokens cached in memory during request
2. **Lazy Loading**: Engagement metrics loaded on demand
3. **Batch Operations**: Multiple posts can be created in single request
4. **Database Indexing**: Indexes on park_id, platform, status, scheduled_time
5. **Query Optimization**: Minimal SELECT queries, efficient joins

## Future Enhancements

1. **Webhook Integration**: Real-time engagement notifications
2. **Analytics Dashboard**: Visual trend charts and heatmaps
3. **A/B Testing**: Variant content comparison
4. **Sentiment Analysis**: AI-powered comment sentiment tracking
5. **Competitor Monitoring**: Track competitor social presence
6. **Auto-Renewal**: Automatic token refresh before expiry
7. **Multi-Account Posting**: Post to multiple parks simultaneously
8. **Content Calendar**: Monthly/yearly planning view
9. **Audience Insights**: Demographic and behavioral analytics
10. **Influencer Detection**: Identify high-value followers

## Testing

### Unit Tests (social-media-manager.js)

```javascript
// Token encryption/decryption
encryptToken('test-token') → encrypted string
decryptToken(encrypted) → 'test-token'

// Caption generation
generateCaption('last_minute_availability', 'Park Name', {...}) → caption string

// Auto-posting
autoPostAvailability(db, 'park-1', ['2026-08-15'], 'Park Name', 'RV') → array of posts
```

### Integration Tests (social API endpoints)

```javascript
// Connect account
POST /api/admin/social/connect
{ platform: 'facebook', accessToken: 'token', username: '@parkname' }
→ 200 { success: true, account: {...} }

// Get scheduled posts
GET /api/admin/social/scheduled?platform=facebook
→ 200 { posts: [...] }

// Auto-post
POST /api/admin/social/auto-post
{ type: 'availability', parkName: 'Park Name', availableDates: [...] }
→ 200 { success: true, posts: [...] }
```

### Manual Testing

1. Connect to Facebook, Instagram, TikTok
2. Create and schedule posts
3. Publish immediately to each platform
4. Verify character counter enforcement
5. Check performance metrics tracking
6. Test template caption generation
7. Confirm edit/delete restrictions

## Troubleshooting

**Posts not publishing?**
- Verify platform account is connected
- Check access token hasn't expired
- Ensure content doesn't exceed character limit
- Check scheduled time is in future

**Engagement metrics not updating?**
- Wait 15+ minutes after publishing (platform propagation delay)
- Verify performance endpoint is called after publication
- Check platform API rate limits aren't exceeded

**Character count incorrect?**
- Different platforms count unicode differently
- Some emojis count as multiple characters
- URL shortening affects count differently per platform

**Encryption errors?**
- Verify ENCRYPTION_KEY environment variable is set
- Check key length (should be 32+ characters)
- Confirm tokens not corrupted in database

## Deployment Checklist

- [ ] Database schema migrations applied
- [ ] ENCRYPTION_KEY environment variable set in production
- [ ] API endpoints tested with real platform credentials
- [ ] Park staff training on social media features
- [ ] OAuth callback URLs configured for each platform
- [ ] Rate limiting implemented for API endpoints
- [ ] Error monitoring and alerting configured
- [ ] Backup and disaster recovery tested

## Support & Maintenance

For issues or enhancements:
1. Check troubleshooting section above
2. Review error logs in platform API responses
3. Verify park staff has proper permissions
4. Contact platform-specific support for OAuth/API issues
