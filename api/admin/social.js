/**
 * Social Media Management API
 *
 * Endpoints for managing social media accounts, posts, and metrics
 * All endpoints require park staff authentication
 */

import pg from 'pg';
import {
  connectSocialAccount,
  getSocialAccounts,
  disconnectSocialAccount,
  scheduleSocialPost,
  getScheduledPosts,
  publishPost,
  generateCaption,
  autoPostAvailability,
  autoPostPromotion,
  getPostPerformance,
  getSupportedPlatforms,
  getCaptionTemplates,
  deleteSocialPost,
  updateSocialPost,
} from '../_lib/social-media-manager.js';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const pool = new Pool({
  connectionString,
  max: 5,
  ssl: connectionString && !/sslmode=/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});

async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Middleware: Verify park staff authentication and parkId from session
 */
async function verifyParkAccess(req) {
  if (!req.headers.authorization) {
    throw new Error('Unauthorized');
  }

  const parkId = req.headers['x-park-id'];
  if (!parkId) {
    throw new Error('Park ID required');
  }

  // In production, verify JWT token and extract parkId from token
  // For now, just validate park exists
  const res = await query('SELECT id FROM parks WHERE id = $1', [parkId]);
  if (!res.rows[0]) {
    throw new Error('Park not found');
  }

  return parkId;
}

/**
 * GET /api/admin/social/accounts
 * Get all connected social media accounts for a park
 */
async function handleGetAccounts(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const accounts = await getSocialAccounts(pool, parkId);

    // Strip sensitive data before sending to client
    const safe = accounts.map((acc) => ({
      id: acc.id,
      platform: acc.platform,
      username: acc.username,
      status: acc.status,
      lastPosted: acc.last_posted,
      createdAt: acc.created_at,
      platformConfig: {
        name: acc.platform === 'facebook' ? 'Facebook' : acc.platform === 'instagram' ? 'Instagram' : acc.platform === 'tiktok' ? 'TikTok' : 'Twitter/X',
        color: acc.platform === 'facebook' ? '#1877F2' : acc.platform === 'instagram' ? '#E1306C' : acc.platform === 'tiktok' ? '#000000' : '#1DA1F2',
      },
    }));

    res.status(200).json({ accounts: safe });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
}

/**
 * GET /api/admin/social/platforms
 * Get all supported social media platforms
 */
async function handleGetPlatforms(req, res) {
  try {
    const platforms = getSupportedPlatforms();
    res.status(200).json({ platforms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/admin/social/connect
 * Connect a social media account (OAuth callback or manual token)
 */
async function handleConnect(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const { platform, accessToken, refreshToken, username } = req.body;

    if (!platform || !accessToken) {
      return res.status(400).json({ error: 'Platform and accessToken required' });
    }

    const account = await connectSocialAccount(pool, parkId, platform, accessToken, refreshToken, username);
    res.status(200).json({ success: true, account });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * POST /api/admin/social/disconnect
 * Disconnect a social media account
 */
async function handleDisconnect(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const { platform } = req.body;

    if (!platform) {
      return res.status(400).json({ error: 'Platform required' });
    }

    await disconnectSocialAccount(pool, parkId, platform);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * GET /api/admin/social/scheduled
 * Get all scheduled posts for a park
 */
async function handleGetScheduled(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const { platform } = req.query;

    const posts = await getScheduledPosts(pool, parkId, platform);
    res.status(200).json({ posts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * POST /api/admin/social/post
 * Manually create a post (draft or immediate)
 */
async function handleCreatePost(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const { platform, content, imageUrl, scheduleTime, publish } = req.body;

    if (!platform || !content) {
      return res.status(400).json({ error: 'Platform and content required' });
    }

    let post = await scheduleSocialPost(pool, parkId, platform, content, imageUrl, scheduleTime);

    if (publish) {
      // Get account for this platform to get access token
      const accounts = await getSocialAccounts(pool, parkId);
      const account = accounts.find((a) => a.platform === platform);
      if (!account) {
        return res.status(400).json({ error: 'No account connected for this platform' });
      }
      post = await publishPost(pool, parkId, post.id, account.accessToken, platform);
    }

    res.status(200).json({ success: true, post });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * POST /api/admin/social/schedule
 * Schedule a post for later publishing
 */
async function handleSchedulePost(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const { platform, content, imageUrl, scheduledTime } = req.body;

    if (!platform || !content || !scheduledTime) {
      return res.status(400).json({ error: 'Platform, content, and scheduledTime required' });
    }

    const post = await scheduleSocialPost(pool, parkId, platform, content, imageUrl, new Date(scheduledTime));
    res.status(200).json({ success: true, post });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * POST /api/admin/social/auto-post
 * Auto-post availability or promotion updates
 */
async function handleAutoPost(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const { type, parkName, availableDates, campaignName, discount, endDate, siteType } = req.body;

    if (!type || !parkName) {
      return res.status(400).json({ error: 'Type and parkName required' });
    }

    let posts = [];

    if (type === 'availability') {
      posts = await autoPostAvailability(pool, parkId, availableDates, parkName, siteType);
    } else if (type === 'promotion') {
      posts = await autoPostPromotion(pool, parkId, campaignName, discount, endDate, parkName);
    } else {
      return res.status(400).json({ error: 'Invalid type (availability or promotion)' });
    }

    res.status(200).json({ success: true, posts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * GET /api/admin/social/performance
 * Get engagement metrics for published posts
 */
async function handleGetPerformance(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const { platform, days } = req.query;

    if (!platform) {
      return res.status(400).json({ error: 'Platform required' });
    }

    const posts = await getPostPerformance(pool, parkId, platform, days ? Number(days) : 30);
    res.status(200).json({ posts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * GET /api/admin/social/captions
 * Get available caption templates
 */
async function handleGetCaptions(req, res) {
  try {
    const templates = getCaptionTemplates();
    res.status(200).json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/admin/social/generate-caption
 * Generate a caption using AI templates
 */
async function handleGenerateCaption(req, res) {
  try {
    const { offerType, parkName, details } = req.body;

    if (!offerType || !parkName) {
      return res.status(400).json({ error: 'OfferType and parkName required' });
    }

    const caption = generateCaption(offerType, parkName, details || {});
    res.status(200).json({ caption });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * DELETE /api/admin/social/post/:postId
 * Delete a draft or scheduled post
 */
async function handleDeletePost(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const { postId } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'PostId required' });
    }

    await deleteSocialPost(pool, parkId, postId);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * PUT /api/admin/social/post/:postId
 * Update a draft or scheduled post
 */
async function handleUpdatePost(req, res) {
  try {
    const parkId = await verifyParkAccess(req);
    const { postId, content, imageUrl, scheduledTime } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'PostId required' });
    }

    const updates = {};
    if (content !== undefined) updates.content = content;
    if (imageUrl !== undefined) updates.image_url = imageUrl;
    if (scheduledTime !== undefined) updates.scheduled_time = new Date(scheduledTime);

    const post = await updateSocialPost(pool, parkId, postId, updates);
    res.status(200).json({ success: true, post });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * Main handler — route requests to appropriate functions
 */
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version,X-Park-Id,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { pathname, query } = req.url;

  try {
    if (pathname === '/api/admin/social/accounts' && req.method === 'GET') {
      return handleGetAccounts(req, res);
    }

    if (pathname === '/api/admin/social/platforms' && req.method === 'GET') {
      return handleGetPlatforms(req, res);
    }

    if (pathname === '/api/admin/social/connect' && req.method === 'POST') {
      return handleConnect(req, res);
    }

    if (pathname === '/api/admin/social/disconnect' && req.method === 'POST') {
      return handleDisconnect(req, res);
    }

    if (pathname === '/api/admin/social/scheduled' && req.method === 'GET') {
      return handleGetScheduled(req, res);
    }

    if (pathname === '/api/admin/social/post' && req.method === 'POST') {
      return handleCreatePost(req, res);
    }

    if (pathname === '/api/admin/social/schedule' && req.method === 'POST') {
      return handleSchedulePost(req, res);
    }

    if (pathname === '/api/admin/social/auto-post' && req.method === 'POST') {
      return handleAutoPost(req, res);
    }

    if (pathname === '/api/admin/social/performance' && req.method === 'GET') {
      return handleGetPerformance(req, res);
    }

    if (pathname === '/api/admin/social/captions' && req.method === 'GET') {
      return handleGetCaptions(req, res);
    }

    if (pathname === '/api/admin/social/generate-caption' && req.method === 'POST') {
      return handleGenerateCaption(req, res);
    }

    if (pathname === '/api/admin/social/post/delete' && req.method === 'POST') {
      return handleDeletePost(req, res);
    }

    if (pathname === '/api/admin/social/post/update' && req.method === 'POST') {
      return handleUpdatePost(req, res);
    }

    res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('Social media API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
