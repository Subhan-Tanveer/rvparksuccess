// Inline "Photos & Video" panel for the PARK as a whole (not per-site) —
// lives directly in Park Settings, not behind a modal, so the separate
// Add Photos / Add Video controls and their caps are immediately visible
// rather than hidden behind one combined launcher button. Real file
// upload straight to Vercel Blob; this app's server never touches the
// file bytes.
import { upload } from '@vercel/blob/client';
import { alertDialog, confirmDialog, withLoading } from './ui-dialogs.js';

const MAX_IMAGES = 10;
const MAX_VIDEOS = 1;

let container = null;
let park = null;
let mediaList = [];

export function initParkMediaPanel(containerId, parkObj) {
  container = document.getElementById(containerId);
  park = parkObj;
  mediaList = [...(park.media || [])];
  if (!container) return;
  renderLayout();
}

function renderLayout() {
  container.innerHTML = `
    <div class="pm-error" id="pmError" style="display:none;"></div>

    <div class="pm-section">
      <div class="pm-section-head">
        <span>Photos (<span id="pmImageCount">0</span>/${MAX_IMAGES})</span>
        <label class="btn btn-ghost btn-sm pm-upload-label" id="pmImageUploadWrap">
          <span>+ Add Photos</span>
          <input type="file" id="pmImageInput" accept="image/*" multiple hidden>
        </label>
      </div>
      <div class="pm-grid" id="pmImageGrid"></div>
    </div>

    <div class="pm-section">
      <div class="pm-section-head">
        <span>Video (<span id="pmVideoCount">0</span>/${MAX_VIDEOS})</span>
        <label class="btn btn-ghost btn-sm pm-upload-label" id="pmVideoUploadWrap">
          <span>+ Add Video</span>
          <input type="file" id="pmVideoInput" accept="video/*" hidden>
        </label>
      </div>
      <div class="pm-grid" id="pmVideoGrid"></div>
    </div>

    <p class="pm-progress" id="pmProgress" style="display:none;"></p>
  `;

  const errorEl = container.querySelector('#pmError');
  const progressEl = container.querySelector('#pmProgress');
  const imageInput = container.querySelector('#pmImageInput');
  const videoInput = container.querySelector('#pmVideoInput');

  const showError = (message) => { errorEl.textContent = message; errorEl.style.display = 'block'; };
  const clearError = () => { errorEl.style.display = 'none'; };
  const showProgress = (text) => { progressEl.textContent = text; progressEl.style.display = 'block'; };
  const hideProgress = () => { progressEl.style.display = 'none'; };

  async function uploadOne(file, type) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = await upload(`parks/${park.id}/${type}-${Date.now()}-${safeName}`, file, {
      access: 'public',
      handleUploadUrl: '/api/admin/ops?resource=park-media&action=upload-token',
      clientPayload: JSON.stringify({ type }),
    });
    const res = await fetch('/api/admin/ops?resource=park-media&action=attach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, url: blob.url, pathname: blob.pathname }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save this file');
    return data.media;
  }

  async function handleFiles(fileList, type) {
    clearError();
    const files = Array.from(fileList);
    if (!files.length) return;
    for (let i = 0; i < files.length; i++) {
      showProgress(`Uploading ${type === 'image' ? 'photo' : 'video'} ${i + 1} of ${files.length}…`);
      try {
        const media = await uploadOne(files[i], type);
        mediaList.push(media);
        renderGrids();
      } catch (err) {
        showError(err.message);
        break; // stop the batch — further uploads would likely hit the same cap/error
      }
    }
    hideProgress();
  }

  imageInput.addEventListener('change', () => {
    handleFiles(imageInput.files, 'image').then(() => { imageInput.value = ''; });
  });
  videoInput.addEventListener('change', () => {
    handleFiles(videoInput.files, 'video').then(() => { videoInput.value = ''; });
  });

  container.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('[data-delete-media]');
    if (!deleteBtn) return;
    const mediaId = deleteBtn.dataset.deleteMedia;
    const ok = await confirmDialog({ title: 'Remove this file?', message: 'This deletes it permanently — guests will no longer see it.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await withLoading(deleteBtn, async () => {
      try {
        const delRes = await fetch(`/api/admin/ops?resource=park-media&mediaId=${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
        if (!delRes.ok) throw new Error((await delRes.json()).error || 'Could not remove file');
        mediaList = mediaList.filter((m) => m.id !== mediaId);
        renderGrids();
      } catch (err) {
        alertDialog({ title: 'Error', message: err.message });
      }
    });
  });

  renderGrids();
}

function renderGrids() {
  const images = mediaList.filter((m) => m.type === 'image');
  const videos = mediaList.filter((m) => m.type === 'video');

  container.querySelector('#pmImageCount').textContent = images.length;
  container.querySelector('#pmVideoCount').textContent = videos.length;
  // The Add button for a given type disappears once its cap is reached,
  // and reappears the moment a delete brings the count back under the
  // cap — renderGrids() re-runs after every add/delete, so this stays in
  // sync automatically rather than needing separate show/hide calls.
  container.querySelector('#pmImageUploadWrap').style.display = images.length >= MAX_IMAGES ? 'none' : '';
  container.querySelector('#pmVideoUploadWrap').style.display = videos.length >= MAX_VIDEOS ? 'none' : '';

  container.querySelector('#pmImageGrid').innerHTML = images.map((m) => mediaCellHtml(m)).join('') || '<p class="pm-empty">No photos yet.</p>';
  container.querySelector('#pmVideoGrid').innerHTML = videos.map((m) => mediaCellHtml(m)).join('') || '<p class="pm-empty">No video yet.</p>';
}

function mediaCellHtml(m) {
  const preview = m.type === 'image'
    ? `<img src="${escapeAttr(m.url)}" alt="" loading="lazy">`
    : `<video src="${escapeAttr(m.url)}" controls preload="metadata"></video>`;
  return `
    <div class="pm-cell" data-media-id="${escapeAttr(m.id)}">
      ${preview}
      <button type="button" class="pm-cell-delete" data-delete-media="${escapeAttr(m.id)}" aria-label="Remove">&times;</button>
    </div>`;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
