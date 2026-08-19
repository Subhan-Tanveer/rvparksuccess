// "Photos & Video" modal for a single site — lets park staff upload real
// image/video files (direct browser -> Vercel Blob, this app's server
// never touches the file bytes) and remove them. Exposes
// openSiteMediaModal(site), which resolves true if anything actually
// changed (so the caller knows to refresh its site list) or false if the
// owner just closed it without touching anything.
import { upload } from '@vercel/blob/client';
import { alertDialog, confirmDialog } from './ui-dialogs.js';

const MAX_IMAGES = 8;
const MAX_VIDEOS = 1;

export function openSiteMediaModal(site) {
  return new Promise((resolve) => {
    let changed = false;
    let mediaList = [...(site.media || [])];

    const backdrop = document.createElement('div');
    backdrop.className = 'sm-backdrop';
    backdrop.innerHTML = `
      <div class="sm-modal">
        <div class="sm-modal-head">
          <h3>Photos &amp; Video — ${escapeHtml(site.name)}</h3>
          <button type="button" class="sm-close" aria-label="Close">&times;</button>
        </div>
        <div class="sm-error" id="smError" style="display:none;"></div>

        <div class="sm-section">
          <div class="sm-section-head">
            <span>Photos (<span id="smImageCount">0</span>/${MAX_IMAGES})</span>
            <label class="btn btn-ghost btn-sm sm-upload-label">
              <span>+ Add Photos</span>
              <input type="file" id="smImageInput" accept="image/*" multiple hidden>
            </label>
          </div>
          <div class="sm-grid" id="smImageGrid"></div>
        </div>

        <div class="sm-section">
          <div class="sm-section-head">
            <span>Video (<span id="smVideoCount">0</span>/${MAX_VIDEOS})</span>
            <label class="btn btn-ghost btn-sm sm-upload-label" id="smVideoUploadWrap">
              <span>+ Add Video</span>
              <input type="file" id="smVideoInput" accept="video/*" hidden>
            </label>
          </div>
          <div class="sm-grid" id="smVideoGrid"></div>
        </div>

        <p class="sm-progress" id="smProgress" style="display:none;"></p>
      </div>
    `;
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('is-open'));

    const errorEl = backdrop.querySelector('#smError');
    const progressEl = backdrop.querySelector('#smProgress');
    const imageGrid = backdrop.querySelector('#smImageGrid');
    const videoGrid = backdrop.querySelector('#smVideoGrid');
    const imageCountEl = backdrop.querySelector('#smImageCount');
    const videoCountEl = backdrop.querySelector('#smVideoCount');
    const imageInput = backdrop.querySelector('#smImageInput');
    const videoInput = backdrop.querySelector('#smVideoInput');
    const videoUploadWrap = backdrop.querySelector('#smVideoUploadWrap');

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
      imageInput.closest('.sm-upload-label').style.display = images.length >= MAX_IMAGES ? 'none' : '';
      videoUploadWrap.style.display = videos.length >= MAX_VIDEOS ? 'none' : '';

      imageGrid.innerHTML = images.map((m) => mediaCellHtml(m)).join('') || '<p class="sm-empty">No photos yet.</p>';
      videoGrid.innerHTML = videos.map((m) => mediaCellHtml(m)).join('') || '<p class="sm-empty">No video yet.</p>';
    }

    function mediaCellHtml(m) {
      const preview = m.type === 'image'
        ? `<img src="${escapeAttr(m.url)}" alt="" loading="lazy">`
        : `<video src="${escapeAttr(m.url)}" controls preload="metadata"></video>`;
      return `
        <div class="sm-cell" data-media-id="${escapeAttr(m.id)}">
          ${preview}
          <button type="button" class="sm-cell-delete" data-delete-media="${escapeAttr(m.id)}" aria-label="Remove">&times;</button>
        </div>`;
    }

    async function uploadOne(file, type) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blob = await upload(`sites/${site.id}/${type}-${Date.now()}-${safeName}`, file, {
        access: 'public',
        handleUploadUrl: '/api/admin/ops?resource=site-media&action=upload-token',
        clientPayload: JSON.stringify({ siteId: site.id, type }),
      });

      const res = await fetch('/api/admin/ops?resource=site-media&action=attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, type, url: blob.url, pathname: blob.pathname }),
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
          const delRes = await fetch(`/api/admin/ops?resource=site-media&mediaId=${encodeURIComponent(mediaId)}&siteId=${encodeURIComponent(site.id)}`, { method: 'DELETE' });
          if (!delRes.ok) throw new Error((await delRes.json()).error || 'Could not remove file');
          mediaList = mediaList.filter((m) => m.id !== mediaId);
          changed = true;
          renderGrids();
        } catch (err) {
          alertDialog({ title: 'Error', message: err.message });
        }
        return;
      }

      if (e.target === backdrop || e.target.closest('.sm-close')) {
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

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
