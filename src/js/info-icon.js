// Small "?" badge for section headers that explains what that section is
// and what it shows. Originally relied purely on the browser's native
// `title` attribute — deliberately avoiding a custom-positioned tooltip,
// since this app had already hit real bugs (clipped tooltips, coordinate-
// system mismatches, stale layout) from hand-rolled tooltips living inside
// scroll/overflow-clipped dashboard cards.
//
// In practice `title` tooltips turned out unreliable here too: they need
// the mouse to sit still for ~1s with no re-render in between (this app
// re-renders whole sections on every data refresh), and touch browsers
// don't show them at all. Real user report: "when I hover over it it
// shows me the question mark not the info."
//
// Replaced with a small custom tooltip that shows immediately on
// hover/focus and on tap — but positioned with `position: fixed`,
// computed fresh from the icon's on-screen rect every time it's shown,
// which sidesteps the specific failure modes above: fixed positioning
// escapes any ancestor's overflow:hidden clipping, and recomputing the
// position on every show means it can never go stale between renders.
// The native `title` is temporarily removed while our own tooltip is
// visible (restored after) so the two never show at once, and it's kept
// as a fallback/accessibility attribute the rest of the time.
import { alertDialog } from './ui-dialogs.js';

export function infoIcon(text) {
  return `<span class="info-icon" tabindex="0" role="img" aria-label="What this section shows" title="${escapeAttr(text)}">?</span>`;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let listenersAttached = false;
let tooltipEl = null;

function ensureTooltipEl() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'info-icon-tooltip';
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function iconText(icon) {
  return icon.dataset.tipText || icon.getAttribute('title') || '';
}

function showTooltip(icon) {
  const text = iconText(icon);
  if (!text) return;
  // Stash the real text and strip `title` so the native tooltip can never
  // fire while ours is showing (it would otherwise still be "live" and
  // pop up on top of this one after its own dwell delay).
  if (icon.hasAttribute('title')) {
    icon.dataset.tipText = text;
    icon.removeAttribute('title');
  }

  const tip = ensureTooltipEl();
  tip.textContent = text;
  tip.style.display = 'block';
  // Measure after making it visible-but-unpositioned, then place it —
  // avoids using a stale size from the last tooltip shown.
  const rect = icon.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();

  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

  let top = rect.top - tipRect.height - 8;
  let placement = 'above';
  if (top < 8) {
    top = rect.bottom + 8; // not enough room above — flip below instead
    placement = 'below';
  }

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tip.classList.toggle('is-below', placement === 'below');
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// Restores `title` on whichever icon we most recently stripped it from,
// so it still works as a fallback/for screen readers between shows.
function restoreTitle(icon) {
  if (icon && icon.dataset.tipText) icon.setAttribute('title', icon.dataset.tipText);
}

export function initInfoIconTaps() {
  if (listenersAttached) return;
  listenersAttached = true;

  document.addEventListener('mouseover', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) showTooltip(icon);
  });
  document.addEventListener('mouseout', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) { hideTooltip(); restoreTitle(icon); }
  });
  document.addEventListener('focusin', (e) => {
    const icon = e.target.closest?.('.info-icon');
    if (icon) showTooltip(icon);
  });
  document.addEventListener('focusout', (e) => {
    const icon = e.target.closest?.('.info-icon');
    if (icon) { hideTooltip(); restoreTitle(icon); }
  });

  // Tap/click also opens the full text in a dialog — useful on touch
  // devices where "hover" never really happens, and as a way to keep the
  // explanation open (rather than it disappearing the moment focus moves).
  document.addEventListener('click', (e) => {
    const icon = e.target.closest('.info-icon');
    if (!icon) return;
    const text = iconText(icon);
    if (!text) return;
    alertDialog({ title: 'What this shows', message: text });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const icon = e.target.closest?.('.info-icon');
    if (!icon) return;
    e.preventDefault();
    const text = iconText(icon);
    if (!text) return;
    alertDialog({ title: 'What this shows', message: text });
  });
}
