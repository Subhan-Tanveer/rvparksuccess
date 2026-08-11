/**
 * Social Media Dashboard — Interactive UI for social media management
 * Handles account connection, post creation/scheduling, and performance metrics
 */

import { confirmDialog, formDialog, alertDialog, withLoading } from './ui-dialogs.js';

let currentPark = null;
let socialAccounts = [];
let scheduledPosts = [];

/**
 * Initialize the social dashboard
 */
export async function initSocialDashboard(park) {
  currentPark = park;
  const container = document.getElementById('socialDashboard');

  if (!container) {
    console.error('Social dashboard container not found');
    return;
  }

  container.innerHTML = `
    <div class="admin-section glass" data-reveal>
      <div class="section-head" style="margin-bottom: var(--sp-3);">
        <p class="eyebrow">Marketing Automation</p>
        <h2 style="font-size: 1.375rem;">Social Media Manager</h2>
      </div>

      <!-- Platform connection cards -->
      <div style="margin-bottom: var(--sp-5);">
        <p class="eyebrow" style="margin-bottom: var(--sp-2);">Connected Accounts</p>
        <div class="social-platforms-grid" id="platformsGrid"></div>
      </div>

      <!-- Post composer -->
      <div style="margin-bottom: var(--sp-5); border-top: 1px solid var(--border-glass); padding-top: var(--sp-4);">
        <p class="eyebrow" style="margin-bottom: var(--sp-3);">Create Post</p>
        <form id="socialPostForm" style="display: grid; gap: var(--sp-3);">
          <div class="field-row-2">
            <div class="field-float">
              <select id="socialPostPlatform" required>
                <option value="">Select Platform</option>
              </select>
              <label for="socialPostPlatform">Post To</label>
            </div>
            <div class="field-float">
              <select id="socialPostTemplate">
                <option value="">No Template</option>
              </select>
              <label for="socialPostTemplate">Use Template</label>
            </div>
          </div>

          <div class="field-float">
            <textarea id="socialPostContent" required placeholder=" " style="min-height: 100px; font-family: var(--font-mono);"></textarea>
            <label for="socialPostContent">Post Content</label>
            <div style="font-size: 0.75rem; color: var(--cream-dim); margin-top: 4px; display: flex; justify-content: space-between;">
              <span>Paste or type your message</span>
              <span id="charCount" style="font-weight: 600;">0/280</span>
            </div>
          </div>

          <div class="field-float">
            <input type="file" id="socialPostImage" accept="image/*">
            <label for="socialPostImage">Image (Optional)</label>
            <div style="font-size: 0.75rem; color: var(--cream-dim); margin-top: 4px;">Max 5MB, PNG/JPG recommended</div>
          </div>

          <div class="field-row-2">
            <div class="field-float">
              <input type="datetime-local" id="socialPostScheduleTime">
              <label for="socialPostScheduleTime">Schedule For (Leave blank to publish now)</label>
            </div>
            <div class="field-float">
              <select id="socialPostRecurrence">
                <option value="">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
              <label for="socialPostRecurrence">Recurrence</label>
            </div>
          </div>

          <div style="display: flex; gap: var(--sp-2); flex-wrap: wrap;">
            <button type="button" class="btn btn-ghost" id="generateCaptionBtn"><span>Generate Caption</span></button>
            <button type="submit" class="btn btn-primary magnetic" id="socialPostBtn"><span>Post Now</span></button>
          </div>

          <div class="admin-alert" id="socialPostAlert"></div>
        </form>
      </div>

      <!-- Scheduled posts -->
      <div style="margin-bottom: var(--sp-5); border-top: 1px solid var(--border-glass); padding-top: var(--sp-4);">
        <p class="eyebrow" style="margin-bottom: var(--sp-3);">Scheduled Posts</p>
        <div class="table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Content</th>
                <th>Scheduled</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="scheduledPostsBody"></tbody>
          </table>
        </div>
        <div class="admin-empty" id="scheduledPostsEmpty" style="display: none;">No scheduled posts yet.</div>
      </div>

      <!-- Performance metrics -->
      <div style="border-top: 1px solid var(--border-glass); padding-top: var(--sp-4);">
        <p class="eyebrow" style="margin-bottom: var(--sp-3);">Performance</p>
        <div class="field-row-2" style="margin-bottom: var(--sp-3);">
          <div class="field-float">
            <select id="performancePlatform">
              <option value="">All Platforms</option>
            </select>
            <label for="performancePlatform">Platform</label>
          </div>
          <div class="field-float">
            <select id="performanceDays">
              <option value="7">Last 7 Days</option>
              <option value="30" selected>Last 30 Days</option>
              <option value="90">Last 90 Days</option>
            </select>
            <label for="performanceDays">Period</label>
          </div>
        </div>

        <div id="performanceMetrics" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--sp-2); margin-bottom: var(--sp-3);">
          <div class="stat-card glass">
            <div class="label">Total Posts</div>
            <div class="value" id="metricPosts">0</div>
          </div>
          <div class="stat-card glass">
            <div class="label">Likes</div>
            <div class="value" id="metricLikes">0</div>
          </div>
          <div class="stat-card glass">
            <div class="label">Shares</div>
            <div class="value" id="metricShares">0</div>
          </div>
          <div class="stat-card glass">
            <div class="label">Comments</div>
            <div class="value" id="metricComments">0</div>
          </div>
        </div>

        <div id="topPostsContainer" style="background: var(--surface-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: var(--sp-3);">
          <p style="font-size: 0.875rem; font-weight: 600; margin-bottom: var(--sp-2);">Top Performing Posts</p>
          <div id="topPostsList" style="display: grid; gap: var(--sp-2);"></div>
        </div>
      </div>
    </div>
  `;

  // Load data
  await loadPlatforms();
  await loadTemplates();
  await loadPlatformOptions();
  await loadScheduledPosts();
  await loadPerformanceMetrics();

  // Setup event listeners
  setupEventListeners();
}

/**
 * Load available social media platforms
 */
async function loadPlatforms() {
  try {
    const res = await fetch('/api/admin/social/accounts', {
      headers: {
        'X-Park-Id': currentPark.id,
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
      },
    });

    if (res.status === 401) {
      window.location.href = 'login.html';
      return;
    }

    const data = await res.json();
    socialAccounts = data.accounts || [];
    renderPlatformCards();
  } catch (err) {
    console.error('Failed to load social accounts:', err);
  }
}

/**
 * Render platform connection cards
 */
function renderPlatformCards() {
  const grid = document.getElementById('platformsGrid');
  const allPlatforms = [
    { id: 'facebook', name: 'Facebook', color: '#1877F2', icon: '📘' },
    { id: 'instagram', name: 'Instagram', color: '#E1306C', icon: '📷' },
    { id: 'tiktok', name: 'TikTok', color: '#000000', icon: '🎵' },
    { id: 'twitter', name: 'Twitter/X', color: '#1DA1F2', icon: '𝕏' },
  ];

  grid.innerHTML = allPlatforms.map((platform) => {
    const connected = socialAccounts.find((a) => a.platform === platform.id);
    return `
      <div class="social-platform-card glass" style="padding: var(--sp-3); border-radius: var(--radius-md); border-left: 3px solid ${platform.color}; display: flex; flex-direction: column; gap: var(--sp-2);">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 1.5rem;">${platform.icon}</div>
          <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 600; color: var(--cream-dim);">${connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div style="font-weight: 600;">${platform.name}</div>
        ${connected ? `
          <div style="font-size: 0.8125rem; color: var(--cream-dim);">@${connected.username}</div>
          <div style="font-size: 0.75rem; color: var(--cream-dim);">
            ${connected.lastPosted ? `Last post: ${new Date(connected.lastPosted).toLocaleDateString()}` : 'Never posted'}
          </div>
          <div style="display: flex; gap: var(--sp-1);">
            <button type="button" class="btn btn-ghost btn-sm" data-disconnect="${platform.id}"><span>Disconnect</span></button>
          </div>
        ` : `
          <button type="button" class="btn btn-primary btn-sm" data-connect="${platform.id}"><span>Connect</span></button>
        `}
      </div>
    `;
  }).join('');

  // Add event listeners for connect/disconnect
  grid.addEventListener('click', (e) => {
    const connectBtn = e.target.closest('[data-connect]');
    const disconnectBtn = e.target.closest('[data-disconnect]');

    if (connectBtn) {
      handleConnectPlatform(connectBtn.dataset.connect);
    }
    if (disconnectBtn) {
      handleDisconnectPlatform(disconnectBtn.dataset.disconnect);
    }
  });
}

/**
 * Handle platform connection (OAuth flow)
 */
async function handleConnectPlatform(platform) {
  // In production, this would initiate OAuth flow
  // For demo, prompt for access token
  const token = await formDialog({
    title: `Connect ${platform}`,
    fields: [
      { name: 'accessToken', label: 'Access Token (for demo)', required: true },
      { name: 'username', label: 'Username', required: false },
    ],
  });

  if (!token) return;

  try {
    await withLoading(async () => {
      const res = await fetch('/api/admin/social/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Park-Id': currentPark.id,
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({
          platform,
          accessToken: token.accessToken,
          username: token.username || `${platform}-user`,
        }),
      });

      if (!res.ok) throw new Error('Failed to connect account');

      await alertDialog('Success', 'Social media account connected!');
      await loadPlatforms();
    });
  } catch (err) {
    await alertDialog('Error', err.message);
  }
}

/**
 * Handle platform disconnection
 */
async function handleDisconnectPlatform(platform) {
  const confirm = await confirmDialog(`Disconnect ${platform}?`, 'This cannot be undone.');
  if (!confirm) return;

  try {
    await withLoading(async () => {
      const res = await fetch('/api/admin/social/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Park-Id': currentPark.id,
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({ platform }),
      });

      if (!res.ok) throw new Error('Failed to disconnect account');

      await alertDialog('Success', 'Account disconnected');
      await loadPlatforms();
    });
  } catch (err) {
    await alertDialog('Error', err.message);
  }
}

/**
 * Load caption templates
 */
async function loadTemplates() {
  try {
    const res = await fetch('/api/admin/social/captions', {
      headers: {
        'X-Park-Id': currentPark.id,
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
      },
    });

    const data = await res.json();
    const select = document.getElementById('socialPostTemplate');

    select.innerHTML = '<option value="">No Template</option>' + (data.templates || [])
      .map((t) => `<option value="${t.id}">${t.label}</option>`)
      .join('');
  } catch (err) {
    console.error('Failed to load templates:', err);
  }
}

/**
 * Load platform options for platform selector
 */
async function loadPlatformOptions() {
  const select = document.getElementById('socialPostPlatform');
  select.innerHTML = '<option value="">Select Platform</option>' + socialAccounts
    .map((a) => `<option value="${a.platform}">${a.platform.charAt(0).toUpperCase() + a.platform.slice(1)}</option>`)
    .join('');

  const perfSelect = document.getElementById('performancePlatform');
  perfSelect.innerHTML = '<option value="">All Platforms</option>' + socialAccounts
    .map((a) => `<option value="${a.platform}">${a.platform.charAt(0).toUpperCase() + a.platform.slice(1)}</option>`)
    .join('');
}

/**
 * Load scheduled posts
 */
async function loadScheduledPosts() {
  try {
    const res = await fetch('/api/admin/social/scheduled', {
      headers: {
        'X-Park-Id': currentPark.id,
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
      },
    });

    const data = await res.json();
    scheduledPosts = data.posts || [];
    renderScheduledPosts();
  } catch (err) {
    console.error('Failed to load scheduled posts:', err);
  }
}

/**
 * Render scheduled posts table
 */
function renderScheduledPosts() {
  const tbody = document.getElementById('scheduledPostsBody');
  const empty = document.getElementById('scheduledPostsEmpty');

  if (!scheduledPosts.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  tbody.innerHTML = scheduledPosts.map((post) => `
    <tr>
      <td style="font-weight: 500; text-transform: capitalize;">${post.platform}</td>
      <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cream-dim);">${post.content}</td>
      <td style="font-size: 0.875rem; color: var(--cream-dim);">
        ${post.scheduled_time ? new Date(post.scheduled_time).toLocaleString() : 'Draft'}
      </td>
      <td>
        <span class="status-chip ${post.status === 'published' ? 'is-confirmed' : 'is-pending'}">
          ${post.status}
        </span>
      </td>
      <td style="text-align: right; white-space: nowrap;">
        ${post.status !== 'published' ? `
          <button type="button" class="btn btn-ghost btn-sm" data-edit-post="${post.id}"><span>Edit</span></button>
          <button type="button" class="btn btn-ghost btn-sm" data-delete-post="${post.id}" style="color: #f0a89a;"><span>Delete</span></button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  // Add event listeners
  tbody.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-post]');
    const deleteBtn = e.target.closest('[data-delete-post]');

    if (editBtn) handleEditPost(editBtn.dataset.editPost);
    if (deleteBtn) handleDeletePost(deleteBtn.dataset.deletePost);
  });
}

/**
 * Load performance metrics
 */
async function loadPerformanceMetrics() {
  try {
    const platform = document.getElementById('performancePlatform').value || 'facebook';
    const days = document.getElementById('performanceDays').value || '30';

    const res = await fetch(`/api/admin/social/performance?platform=${platform}&days=${days}`, {
      headers: {
        'X-Park-Id': currentPark.id,
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
      },
    });

    const data = await res.json();
    const posts = data.posts || [];

    // Calculate aggregated metrics
    let totalLikes = 0, totalShares = 0, totalComments = 0;
    posts.forEach((post) => {
      const engagement = post.engagement || {};
      totalLikes += engagement.likes || 0;
      totalShares += engagement.shares || 0;
      totalComments += engagement.comments || 0;
    });

    document.getElementById('metricPosts').textContent = posts.length;
    document.getElementById('metricLikes').textContent = totalLikes;
    document.getElementById('metricShares').textContent = totalShares;
    document.getElementById('metricComments').textContent = totalComments;

    // Render top posts
    const topPosts = posts.sort((a, b) => {
      const aEngagement = (a.engagement?.likes || 0) + (a.engagement?.shares || 0);
      const bEngagement = (b.engagement?.likes || 0) + (b.engagement?.shares || 0);
      return bEngagement - aEngagement;
    }).slice(0, 3);

    const topPostsList = document.getElementById('topPostsList');
    topPostsList.innerHTML = topPosts.length ? topPosts.map((post) => `
      <div style="background: var(--surface-glass-strong); padding: var(--sp-2); border-radius: var(--radius-md); font-size: 0.875rem;">
        <div style="color: var(--cream-dim); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${post.content}</div>
        <div style="display: flex; justify-content: space-between; color: var(--amber-light); font-size: 0.75rem;">
          <span>❤ ${post.engagement?.likes || 0} likes</span>
          <span>📤 ${post.engagement?.shares || 0} shares</span>
          <span>💬 ${post.engagement?.comments || 0} comments</span>
        </div>
      </div>
    `).join('') : '<div style="color: var(--cream-dim);">No posts yet</div>';
  } catch (err) {
    console.error('Failed to load performance metrics:', err);
  }
}

/**
 * Setup event listeners for form and buttons
 */
function setupEventListeners() {
  const form = document.getElementById('socialPostForm');
  const contentField = document.getElementById('socialPostContent');
  const charCount = document.getElementById('charCount');
  const generateBtn = document.getElementById('generateCaptionBtn');
  const perfPlatform = document.getElementById('performancePlatform');
  const perfDays = document.getElementById('performanceDays');

  // Character counter
  contentField.addEventListener('input', () => {
    const platform = document.getElementById('socialPostPlatform').value || 'facebook';
    const limits = {
      facebook: 63206,
      instagram: 2200,
      tiktok: 2200,
      twitter: 280,
    };
    const limit = limits[platform] || 280;
    charCount.textContent = `${contentField.value.length}/${limit}`;
    charCount.style.color = contentField.value.length > limit ? '#f0a89a' : 'var(--cream-dim)';
  });

  // Update char limit on platform change
  document.getElementById('socialPostPlatform').addEventListener('change', () => {
    contentField.dispatchEvent(new Event('input'));
  });

  // Generate caption button
  generateBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const template = document.getElementById('socialPostTemplate').value;
    if (!template) {
      await alertDialog('Error', 'Please select a caption template first');
      return;
    }

    try {
      const res = await fetch('/api/admin/social/generate-caption', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Park-Id': currentPark.id,
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({
          offerType: template,
          parkName: currentPark.name,
          details: {
            discount: 10,
            siteType: 'RV Full Hookup',
            dates: 'This weekend',
          },
        }),
      });

      const data = await res.json();
      contentField.value = data.caption;
      contentField.dispatchEvent(new Event('input'));
    } catch (err) {
      await alertDialog('Error', err.message);
    }
  });

  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const platform = document.getElementById('socialPostPlatform').value;
    const content = contentField.value;
    const scheduledTime = document.getElementById('socialPostScheduleTime').value;

    if (!platform || !content) {
      return alertDialog('Error', 'Platform and content are required');
    }

    try {
      await withLoading(async () => {
        const res = await fetch('/api/admin/social/post', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Park-Id': currentPark.id,
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
          },
          body: JSON.stringify({
            platform,
            content,
            scheduledTime: scheduledTime || null,
            publish: !scheduledTime,
          }),
        });

        if (!res.ok) throw new Error('Failed to create post');

        form.reset();
        charCount.textContent = '0/280';
        await alertDialog('Success', 'Post created!');
        await loadScheduledPosts();
        await loadPerformanceMetrics();
      });
    } catch (err) {
      await alertDialog('Error', err.message);
    }
  });

  // Performance metrics filters
  perfPlatform.addEventListener('change', loadPerformanceMetrics);
  perfDays.addEventListener('change', loadPerformanceMetrics);
}

/**
 * Handle edit post
 */
async function handleEditPost(postId) {
  // Implement edit UI
  await alertDialog('Edit Post', 'Edit functionality coming soon');
}

/**
 * Handle delete post
 */
async function handleDeletePost(postId) {
  const confirm = await confirmDialog('Delete Post?', 'Scheduled posts can be deleted, but published posts cannot.');
  if (!confirm) return;

  try {
    await withLoading(async () => {
      const res = await fetch('/api/admin/social/post/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Park-Id': currentPark.id,
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({ postId }),
      });

      if (!res.ok) throw new Error('Failed to delete post');

      await alertDialog('Success', 'Post deleted');
      await loadScheduledPosts();
    });
  } catch (err) {
    await alertDialog('Error', err.message);
  }
}
