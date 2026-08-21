// Inline "Park Logo" control in Park Settings — a single dedicated image
// (not part of the 10-photo gallery), shown as the park's own brand mark
// on guest-facing pages. Same direct-to-Blob upload pattern as the media
// panel, reusing the same resource=park-media backend with type='logo'.
import { upload } from '@vercel/blob/client';
import { alertDialog, confirmDialog, withLoading } from './ui-dialogs.js';

let container = null;
let park = null;

export function initParkLogoPanel(containerId, parkObj) {
  container = document.getElementById(containerId);
  park = parkObj;
  if (!container) return;
  renderLayout();
}

function renderLayout() {
  container.innerHTML = `
    <div class="park-logo-row">
      <div class="park-logo-preview" id="parkLogoPreview">
        ${park.logoUrl ? `<img src="${escapeAttr(park.logoUrl)}" alt="Park logo">` : '<span class="park-logo-placeholder">No logo</span>'}
      </div>
      <div class="park-logo-actions">
        <label class="btn btn-ghost btn-sm">
          <span>${park.logoUrl ? 'Change Logo' : '+ Add Logo'}</span>
          <input type="file" id="parkLogoInput" accept="image/*" hidden>
        </label>
        <button type="button" class="btn btn-ghost btn-sm" id="parkLogoRemoveBtn" ${park.logoUrl ? '' : 'style="display:none;"'}>Remove Logo</button>
      </div>
    </div>
    <p class="pm-error" id="parkLogoError" style="display:none;"></p>
  `;

  const errorEl = container.querySelector('#parkLogoError');
  const showError = (message) => { errorEl.textContent = message; errorEl.style.display = 'block'; };
  const clearError = () => { errorEl.style.display = 'none'; };

  container.querySelector('#parkLogoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    clearError();

    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blob = await upload(`parks/${park.id}/logo-${Date.now()}-${safeName}`, file, {
        access: 'public',
        handleUploadUrl: '/api/admin/ops?resource=park-media&action=upload-token',
        clientPayload: JSON.stringify({ type: 'logo' }),
      });
      const res = await fetch('/api/admin/ops?resource=park-media&action=attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'logo', url: blob.url, pathname: blob.pathname }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save logo');
      park = data.park;
      renderLayout();
    } catch (err) {
      showError(err.message);
    }
  });

  const removeBtn = container.querySelector('#parkLogoRemoveBtn');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Remove logo?', message: 'Guests will no longer see a park logo.', confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      await withLoading(removeBtn, async () => {
        try {
          const res = await fetch('/api/admin/ops?resource=park-media&action=remove-logo', { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not remove logo');
          park = data.park;
          renderLayout();
        } catch (err) {
          alertDialog({ title: 'Error', message: err.message });
        }
      });
    });
  }
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
