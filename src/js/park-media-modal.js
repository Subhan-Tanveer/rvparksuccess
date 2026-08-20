// "Photos & Video" modal for the PARK as a whole (not per-site) — lets
// park staff upload real image/video files (direct browser -> Vercel
// Blob, this app's server never touches the file bytes) and remove them.
// Exposes openParkMediaModal(park), which resolves true if anything
// actually changed (so the caller knows to refresh) or false if the
// owner just closed it without touching anything.
import { upload } from '@vercel/blob/client';
import { alertDialog, confirmDialog } from './ui-dialogs.js';

const MAX_IMAGES = 10;
const MAX_VIDEOS = 1;

export function openParkMediaModal(park) {
  return new Promise((resolve) => {
    let changed = false;
    let mediaList = [...(park.media || [])];

    const backdrop = document.createElement('div');
    backdrop.className = 'pm-backdrop';
    backdrop.innerHTML = `
      <div class="pm-modal">
        <div class="pm-modal-head">
          <h3>Park Photos &amp; Video</h3>
          <button type="button" class="pm-close" aria-label="Close">&times;</button>
        </div>
        <p class="pm-hint">These show guests what the whole park looks like before they book — not tied to any one site.</p>
        <div class="pm-error" id="pmError" style="display:none;"></div>

        <div class="pm-section">
          <div class="pm-section-head">
            <span>Photos (<span id="pmImageCount">0</span>/${MAX_IMAGES})</span>
            <label class="btn btn-ghost btn-sm pm-upload-label">
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
      </div>
    `;
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('is-open'));

    const errorEl = backdrop.querySelector('#pmError');
    const progressEl = backdrop.querySelector('#pmProgress');
    const imageGrid = backdrop.querySelector('#pmImageGrid');
    const videoGrid = backdrop.querySelector('#pmVideoGrid');
    const imageCountEl = backdrop.querySelector('#pmImageCount');
    const videoCountEl = backdrop.querySelector('#pmVideoCount');
    const imageInput = backdrop.querySelector('#pmImageInput');
    const videoInput = backdrop.querySelector('#pmVideoInput');
    const videoUploadWrap = backdrop.querySelector('#pmVideoUploadWrap');

    const showError = (message) => {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    };
    const clearError = () => { errorEl.style.display = 'none'; };
    const showProgress = (text) => {
      progressEl.textContent = text;
      progressEl.style.display = 'block';
    };
    const hideProgress = () => { progressEl.style.display = 'none'; };

    function renderGrids() {
      const images = mediaList.filter((m) => m.type === 'image');
      const videos = mediaList.filter((m) => m.type === 'video');

      imageCountEl.textContent = images.length;
      videoCountEl.textContent = videos.length;
      imageInput.closest('.pm-upload-label').style.display = images.length >= MAX_IMAGES ? 'none' : '';
      videoUploadWrap.style.display = videos.length >= MAX_VIDEOS ? 'none' : '';

      imageGrid.innerHTML = images.map((m) => mediaCellHtml(m)).join('') || '<p class="pm-empty">No photos yet.</p>';
      videoGrid.innerHTML = videos.map((m) => mediaCellHtml(m)).join('') || '<p class="pm-empty">No video yet.</p>';
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
          changed = true;
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

    backdrop.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('[data-delete-media]');
      if (deleteBtn) {
        const mediaId = deleteBtn.dataset.deleteMedia;
        const ok = await confirmDialog({ title: 'Remove this file?', message: 'This deletes it permanently — guests will no longer see it.', confirmLabel: 'Remove', danger: true });
        if (!ok) return;
        try {
          const delRes = await fetch(`/api/admin/ops?resource=park-media&mediaId=${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
          if (!delRes.ok) throw new Error((await delRes.json()).error || 'Could not remove file');
          mediaList = mediaList.filter((m) => m.id !== mediaId);
          changed = true;
          renderGrids();
        } catch (err) {
          alertDialog({ title: 'Error', message: err.message });
        }
        return;
      }

      if (e.target === backdrop || e.target.closest('.pm-close')) {
        close();
      }
    });

    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        close();
      }
    });

    function close() {
      backdrop.classList.remove('is-open');
      setTimeout(() => {
        backdrop.remove();
        resolve(changed);
      }, 250);
    }

    renderGrids();
  });
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
