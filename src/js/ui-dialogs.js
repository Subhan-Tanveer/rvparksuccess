// Themed confirm/form dialogs + a button loading-state helper — replaces
// window.alert/confirm/prompt everywhere in the dashboards. Browsers
// commonly block those native dialogs inside an iframe (e.g. an embedded
// preview pane), where they silently return null/false and the calling
// code just no-ops — which looks exactly like "nothing happened, and I
// have to reload to see my change" even though the request never fired.
// These are plain DOM, built once and reused, so every page that needs a
// confirm/prompt just imports this instead of rolling its own markup.
let backdrop, titleEl, bodyEl, errorEl, actionsEl;

function ensureDialogRoot() {
  if (backdrop) return;
  backdrop = document.createElement('div');
  backdrop.className = 'dlg-backdrop';
  backdrop.innerHTML = `
    <div class="dlg-modal">
      <div class="dlg-title" data-dlg-title></div>
      <div data-dlg-body></div>
      <div class="dlg-error" data-dlg-error></div>
      <div class="dlg-actions" data-dlg-actions></div>
    </div>`;
  document.body.appendChild(backdrop);
  titleEl = backdrop.querySelector('[data-dlg-title]');
  bodyEl = backdrop.querySelector('[data-dlg-body]');
  errorEl = backdrop.querySelector('[data-dlg-error]');
  actionsEl = backdrop.querySelector('[data-dlg-actions]');
}

function openDialog() { backdrop.classList.add('is-open'); }
function closeDialog() { backdrop.classList.remove('is-open'); }

/** Themed replacement for window.alert() — a single-button notice. Resolves when dismissed. */
export function alertDialog({ title, message, okLabel = 'OK' }) {
  ensureDialogRoot();
  return new Promise((resolve) => {
    titleEl.textContent = title;
    bodyEl.innerHTML = `<p class="dlg-message">${message}</p>`;
    errorEl.classList.remove('is-visible');
    actionsEl.innerHTML = '';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn btn-primary';
    okBtn.textContent = okLabel;
    actionsEl.append(okBtn);

    const cleanup = () => {
      closeDialog();
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') cleanup(); };

    okBtn.onclick = cleanup;
    backdrop.onclick = (e) => { if (e.target === backdrop) cleanup(); };
    document.addEventListener('keydown', onKey);
    openDialog();
    okBtn.focus();
  });
}

/**
 * Read-only detail popup — like alertDialog, but takes pre-built HTML
 * (label/value rows, links, etc.) instead of a single message string, and
 * renders wider to fit that content. Resolves when dismissed.
 */
export function detailDialog({ title, bodyHtml, okLabel = 'Close' }) {
  ensureDialogRoot();
  return new Promise((resolve) => {
    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    errorEl.classList.remove('is-visible');
    actionsEl.innerHTML = '';
    backdrop.querySelector('.dlg-modal').classList.add('is-wide');

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn btn-primary';
    okBtn.textContent = okLabel;
    actionsEl.append(okBtn);

    const cleanup = () => {
      closeDialog();
      backdrop.querySelector('.dlg-modal').classList.remove('is-wide');
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') cleanup(); };

    okBtn.onclick = cleanup;
    backdrop.onclick = (e) => { if (e.target === backdrop) cleanup(); };
    document.addEventListener('keydown', onKey);
    openDialog();
    okBtn.focus();
  });
}

/** Themed replacement for window.confirm(). Resolves true/false. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  ensureDialogRoot();
  return new Promise((resolve) => {
    titleEl.textContent = title;
    bodyEl.innerHTML = `<p class="dlg-message">${message}</p>`;
    errorEl.classList.remove('is-visible');
    actionsEl.innerHTML = '';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary';
    if (danger) confirmBtn.style.cssText = 'background: rgba(217,60,46,0.85); box-shadow:none;';
    confirmBtn.textContent = confirmLabel;

    actionsEl.append(cancelBtn, confirmBtn);

    const cleanup = (result) => {
      closeDialog();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(false); };

    cancelBtn.onclick = () => cleanup(false);
    confirmBtn.onclick = () => cleanup(true);
    backdrop.onclick = (e) => { if (e.target === backdrop) cleanup(false); };
    document.addEventListener('keydown', onKey);
    openDialog();
    confirmBtn.focus();
  });
}

/**
 * Themed replacement for window.prompt(), extended to multiple fields.
 * fields: [{ id, label, type='text', value='', step, min, required=true }]
 * Resolves an object keyed by field id (numbers parsed for type:'number'),
 * or null if canceled.
 */
export function formDialog({ title, fields, submitLabel = 'Save', cancelLabel = 'Cancel' }) {
  ensureDialogRoot();
  return new Promise((resolve) => {
    titleEl.textContent = title;
    errorEl.classList.remove('is-visible');
    bodyEl.innerHTML = fields.map((f) => `
      <div class="field-float" style="text-align:left;">
        <input id="dlg-${f.id}" type="${f.type || 'text'}" ${f.step !== undefined ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} value="${f.value ?? ''}" placeholder=" ">
        <label for="dlg-${f.id}">${f.label}</label>
      </div>`).join('');

    fields.forEach((f) => {
      const el = document.getElementById(`dlg-${f.id}`);
      if (el.value) el.classList.add('has-value');
      el.addEventListener('input', () => el.classList.toggle('has-value', !!el.value));
    });

    actionsEl.innerHTML = '';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = cancelLabel;
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = submitLabel;
    actionsEl.append(cancelBtn, submitBtn);

    const cleanup = (result) => {
      closeDialog();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(null); };

    const submit = () => {
      const values = {};
      for (const f of fields) {
        const el = document.getElementById(`dlg-${f.id}`);
        if (f.required !== false && !el.value) {
          errorEl.textContent = `${f.label} is required.`;
          errorEl.classList.add('is-visible');
          el.focus();
          return;
        }
        values[f.id] = f.type === 'number' ? parseFloat(el.value) : el.value;
      }
      cleanup(values);
    };

    cancelBtn.onclick = () => cleanup(null);
    submitBtn.onclick = submit;
    bodyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    backdrop.onclick = (e) => { if (e.target === backdrop) cleanup(null); };
    document.addEventListener('keydown', onKey);
    openDialog();
    document.getElementById(`dlg-${fields[0].id}`)?.focus();
  });
}

/**
 * Wraps an async action with a button loading state: disables the button
 * and swaps its label for a spinner for the duration, and ignores a second
 * click while one is already in flight. Always restores the button after,
 * success or failure — callers still catch/report errors themselves.
 */
export async function withLoading(btn, fn) {
  // Tolerate withLoading(fn) — called with just the async work and no
  // button to disable. Several dashboard modules call it this way; without
  // this, `btn` silently becomes the function itself and btn.classList
  // throws before `fn` ever runs.
  if (typeof btn === 'function' && fn === undefined) {
    fn = btn;
    btn = null;
  }
  if (!fn) return undefined;
  if (btn) {
    if (btn.classList.contains('is-loading')) return undefined;
    btn.classList.add('is-loading');
    btn.disabled = true;
  }
  try {
    return await fn();
  } finally {
    if (btn) {
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  }
}
