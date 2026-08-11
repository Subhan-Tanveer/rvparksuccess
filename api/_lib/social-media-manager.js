/**
 * Social Media Manager — Multi-platform social media automation
 *
 * Handles:
 * - Platform account connection (OAuth, token storage)
 * - Post scheduling and publishing
 * - Auto-posting for availability and promotions
 * - Engagement metrics tracking
 * - Caption generation using AI templates
 */

import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-dev-key-change-in-production';

// Platform-specific API endpoints and limits
const PLATFORM_CONFIG = {
  facebook: {
    name: 'Facebook',
    oauthUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    apiBase: 'https://graph.facebook.com/v18.0',
    charLimit: 63206,
    supportsImage: true,
    supportsScheduling: true,
    color: '#1877F2',
  },
  instagram: {
    name: 'Instagram',
    oauthUrl: 'https://api.instagram.com/oauth/authorize',
    apiBase: 'https://graph.instagram.com/v18.0',
    charLimit: 2200,
    supportsImage: true,
    supportsScheduling: true,
    color: '#E1306C',
  },
  tiktok: {
    name: 'TikTok',
    oauthUrl: 'https://www.tiktok.com/v1/oauth/authorize',
    apiBase: 'https://open-api.tiktok.com/v1',
    charLimit: 2200,
    supportsImage: false,
    supportsScheduling: false,
    color: '#000000',
  },
  twitter: {
    name: 'Twitter/X',
    oauthUrl: 'https://twitter.com/i/oauth2/authorize',
    apiBase: 'https://api.twitter.com/2',
    charLimit: 280,
    supportsImage: true,
    supportsScheduling: false,
    color: '#1DA1F2',
  },
};

// AI-generated caption templates for common RV park marketing scenarios
const CAPTION_TEMPLATES = {
  last_minute_availability: {
    label: 'Last Minute Availability',
    templates: [
      'Hot deal alert! {parkName} has {count} {siteType} site(s) available for {dates}. Book now and save big!',
      'Last-minute opening at {parkName}! {siteType} site available {dates}. Limited time only - reserve yours today!',
      'Don\'t miss out! {siteType} site(s) at {parkName} are open {dates}. Book your RV getaway now!',
    ],
  },
  weekend_special: {
    label: 'Weekend Getaway Special',
    templates: [
      'Weekend warrior special at {parkName}! Get {discount}% off {siteType} sites this weekend. Limited spots available!',
      'Your perfect weekend escape awaits at {parkName}. {siteType} sites now {discount}% off!',
      'Weekend plans? {parkName} has {discount}% off selected {siteType} sites. Book your escape today!',
    ],
  },
  seasonal_discount: {
    label: 'Seasonal Discount',
    templates: [
      '{season} special at {parkName}! Enjoy {discount}% off {siteType} accommodations. Perfect time to visit!',
      'Celebrate {season} with us! {discount}% discount on {siteType} sites at {parkName}. Book now!',
      '{season} savings at {parkName}! Get {discount}% off and experience the perfect getaway.',
    ],
  },
  loyalty_reward: {
    label: 'Loyalty Reward',
    templates: [
      'Thank you for being part of the {parkName} family! Loyal guests enjoy {discount}% off their next stay.',
      'VIP treatment for our regulars! {discount}% off your next reservation at {parkName}. You\'ve earned it!',
      'Coming back to {parkName}? Enjoy {discount}% loyalty discount on your next {siteType} site!',
    ],
  },
  referral_bonus: {
    label: 'Referral Bonus',
    templates: [
      'Know someone who needs an RV escape? Refer them to {parkName} and you both get {discount}% off!',
      'Spread the word about {parkName} and earn {discount}% referral rewards. Share with friends and family!',
      'Love {parkName}? Refer a friend and receive {discount}% discount on your next stay!',
    ],
  },
  new_amenity: {
    label: 'New Amenity Launch',
    templates: [
      'Exciting news! {parkName} now features {amenity}. Experience the upgrade on your next visit!',
      'We\'ve upgraded! {parkName} is proud to introduce {amenity}. Come see what\'s new!',
      'New at {parkName}: {amenity}! Discover enhanced comfort and convenience on your next stay.',
    ],
  },
};

/**
 * Encrypt sensitive data (access tokens)
 */
export function encryptToken(token) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt sensitive data (access tokens)
 */
export function decryptToken(encrypted) {
  try {
    const [ivHex, authTagHex, encryptedHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Token decryption failed:', err.message);
    return null;
  }
}

/**
 * Connect a social media account to a park
 * Stores encrypted access token and platform details
 */
export async function connectSocialAccount(db, parkId, platform, accessToken, refreshToken = null, username = null) {
  if (!PLATFORM_CONFIG[platform]) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const encryptedToken = encryptToken(accessToken);
  const encryptedRefresh = refreshToken ? encryptToken(refreshToken) : null;
  const id = `social-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const query = `
    INSERT INTO social_accounts (id, park_id, platform, username, access_token_encrypted, refresh_token_encrypted, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'connected')
    ON CONFLICT (park_id, platform) DO UPDATE
    SET access_token_encrypted = $5, refresh_token_encrypted = $6, status = 'connected', updated_at = now()
    RETURNING *
  `;

  const result = await db.query(query, [id, parkId, platform, username || `${platform}-user`, encryptedToken, encryptedRefresh]);
  return result.rows[0];
}

/**
 * Get connected social accounts for a park
 */
export async function getSocialAccounts(db, parkId) {
  const query = 'SELECT * FROM social_accounts WHERE park_id = $1 ORDER BY platform';
  const result = await db.query(query, [parkId]);
  return result.rows.map((row) => ({
    ...row,
    accessToken: decryptToken(row.access_token_encrypted),
    refreshToken: row.refresh_token_encrypted ? decryptToken(row.refresh_token_encrypted) : null,
  }));
}

/**
 * Disconnect a social media account
 */
export async function disconnectSocialAccount(db, parkId, platform) {
  const query = 'DELETE FROM social_accounts WHERE park_id = $1 AND platform = $2';
  await db.query(query, [parkId, platform]);
}

/**
 * Schedule a social media post for later publishing
 */
export async function scheduleSocialPost(db, parkId, platform, content, imageUrl = null, scheduledTime = null) {
  if (!PLATFORM_CONFIG[platform]) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const platformConfig = PLATFORM_CONFIG[platform];
  if (content.length > platformConfig.charLimit) {
    throw new Error(`Content exceeds ${platform} character limit of ${platformConfig.charLimit}`);
  }

  const id = `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const status = scheduledTime ? 'scheduled' : 'draft';

  const query = `
    INSERT INTO social_posts (id, park_id, platform, content, image_url, scheduled_time, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;

  const result = await db.query(query, [id, parkId, platform, content, imageUrl, scheduledTime, status]);
  return result.rows[0];
}

/**
 * Get scheduled posts for a park
 */
export async function getScheduledPosts(db, parkId, platform = null) {
  let query = 'SELECT * FROM social_posts WHERE park_id = $1 AND status IN (\'draft\', \'scheduled\')';
  const params = [parkId];

  if (platform) {
    query += ' AND platform = $2';
    params.push(platform);
  }

  query += ' ORDER BY scheduled_time IS NULL, scheduled_time ASC';
  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Publish a post to social media (immediately or scheduled)
 * This is a stub that would integrate with actual platform APIs
 */
export async function publishPost(db, parkId, postId, accessToken, platform) {
  const query = 'SELECT * FROM social_posts WHERE id = $1 AND park_id = $2';
  const result = await db.query(query, [postId, parkId]);

  if (!result.rows[0]) {
    throw new Error('Post not found');
  }

  const post = result.rows[0];

  // In production, this would call the actual platform API
  // For now, mark as published
  const updateQuery = `
    UPDATE social_posts
    SET status = 'published', published_time = now(), updated_at = now()
    WHERE id = $1
    RETURNING *
  `;

  const updated = await db.query(updateQuery, [postId]);
  return updated.rows[0];
}

/**
 * Auto-generate a caption based on offer type and park details
 */
export function generateCaption(offerType, parkName, details = {}) {
  const templateGroup = CAPTION_TEMPLATES[offerType];
  if (!templateGroup) {
    throw new Error(`Unknown offer type: ${offerType}`);
  }

  const templates = templateGroup.templates;
  const randomTemplate = templates[Math.floor(Math.random() * templates.length)];

  let caption = randomTemplate
    .replace('{parkName}', parkName)
    .replace('{siteType}', details.siteType || 'RV')
    .replace('{count}', details.count || '1')
    .replace('{dates}', details.dates || 'this weekend')
    .replace('{discount}', details.discount || '10')
    .replace('{season}', details.season || 'the upcoming season')
    .replace('{amenity}', details.amenity || 'new amenities');

  return caption;
}

/**
 * Auto-post availability alert
 */
export async function autoPostAvailability(db, parkId, availableDates, parkName, siteType = 'RV') {
  const caption = generateCaption('last_minute_availability', parkName, {
    siteType,
    count: availableDates.length,
    dates: formatDateRange(availableDates),
  });

  // Post to all connected platforms
  const accounts = await getSocialAccounts(db, parkId);
  const posts = [];

  for (const account of accounts) {
    try {
      const post = await scheduleSocialPost(db, parkId, account.platform, caption, null, new Date());
      posts.push(post);
    } catch (err) {
      console.error(`Failed to post to ${account.platform}:`, err.message);
    }
  }

  return posts;
}

/**
 * Auto-post promotion
 */
export async function autoPostPromotion(db, parkId, campaignName, discount, endDate, parkName) {
  const caption = generateCaption('seasonal_discount', parkName, {
    discount,
    season: campaignName,
  });

  const accounts = await getSocialAccounts(db, parkId);
  const posts = [];

  for (const account of accounts) {
    try {
      const post = await scheduleSocialPost(db, parkId, account.platform, caption, null, new Date());
      posts.push(post);
    } catch (err) {
      console.error(`Failed to post to ${account.platform}:`, err.message);
    }
  }

  return posts;
}

/**
 * Track engagement metrics for published posts
 */
export async function trackEngagementMetrics(db, parkId, platform, postId, metrics) {
  const query = `
    UPDATE social_posts
    SET engagement_json = $1, updated_at = now()
    WHERE id = $2 AND park_id = $3
    RETURNING *
  `;

  const result = await db.query(query, [JSON.stringify(metrics), postId, parkId]);
  return result.rows[0];
}

/**
 * Get post performance data
 */
export async function getPostPerformance(db, parkId, platform, days = 30) {
  const dateThreshold = new Date();
  dateThreshold.setDate(dateThreshold.getDate() - days);

  const query = `
    SELECT * FROM social_posts
    WHERE park_id = $1 AND platform = $2 AND status = 'published' AND published_time > $3
    ORDER BY published_time DESC
  `;

  const result = await db.query(query, [parkId, platform, dateThreshold]);
  return result.rows.map((row) => ({
    ...row,
    engagement: JSON.parse(row.engagement_json || '{}'),
  }));
}

/**
 * Get platform configuration
 */
export function getPlatformConfig(platform) {
  return PLATFORM_CONFIG[platform];
}

/**
 * Get all supported platforms
 */
export function getSupportedPlatforms() {
  return Object.entries(PLATFORM_CONFIG).map(([key, config]) => ({
    id: key,
    ...config,
  }));
}

/**
 * Get available caption templates
 */
export function getCaptionTemplates() {
  return Object.entries(CAPTION_TEMPLATES).map(([key, value]) => ({
    id: key,
    label: value.label,
  }));
}

/**
 * Helper: Format date range for display
 */
function formatDateRange(dates) {
  if (!dates || dates.length === 0) return 'upcoming dates';
  if (dates.length === 1) return dates[0];
  return `${dates[0]} to ${dates[dates.length - 1]}`;
}

/**
 * Delete a social post (draft or scheduled only)
 */
export async function deleteSocialPost(db, parkId, postId) {
  const query = `
    DELETE FROM social_posts
    WHERE id = $1 AND park_id = $2 AND status IN ('draft', 'scheduled')
    RETURNING *
  `;

  const result = await db.query(query, [postId, parkId]);
  if (!result.rows[0]) {
    throw new Error('Post not found or cannot be deleted (published posts are immutable)');
  }

  return result.rows[0];
}

/**
 * Update a social post (draft or scheduled only)
 */
export async function updateSocialPost(db, parkId, postId, updates) {
  const allowedFields = ['content', 'image_url', 'scheduled_time'];
  const sets = [];
  const params = [postId, parkId];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      params.push(updates[field]);
      sets.push(`${field} = $${params.length}`);
    }
  }

  if (!sets.length) {
    throw new Error('No valid fields to update');
  }

  params.push('published');
  const query = `
    UPDATE social_posts
    SET ${sets.join(', ')}, updated_at = now()
    WHERE id = $1 AND park_id = $2 AND status != $${params.length}
    RETURNING *
  `;

  const result = await db.query(query, params);
  if (!result.rows[0]) {
    throw new Error('Post not found or cannot be updated (published posts are immutable)');
  }

  return result.rows[0];
}
