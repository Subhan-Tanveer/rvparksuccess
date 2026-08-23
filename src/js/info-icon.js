// Small "?" badge for section headers that explains what that section is
// and what it shows, on hover. Uses the browser's native `title` attribute
// rather than a custom-positioned tooltip element — this app has already
// hit real bugs (clipped tooltips, coordinate-system mismatches, stale
// layout while a tab is hidden) from hand-rolled tooltips living inside
// scroll/overflow-clipped dashboard cards. The native tooltip has none of
// those failure modes: no positioning math, nothing to clip it, nothing to
// keep in sync with a chart's coordinate space.
//
// title-attribute tooltips don't work on touch devices at all, though — no
// hover, and tap-to-show isn't a thing browsers do for `title`. That's not
// a hypothetical: this is a front-desk app real staff use on phones.
// initInfoIconTaps() (called once from initCore()) adds a tap/click
// fallback that shows the exact same text via the app's existing dialog
// system instead of inventing a second, unproven tooltip implementation.
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

let tapListenerAttached = false;

export function initInfoIconTaps() {
  if (tapListenerAttached) return;
  tapListenerAttached = true;

  document.addEventListener('click', (e) => {
    const icon = e.target.closest('.info-icon');
    if (!icon) return;
    const text = icon.getAttribute('title');
    if (!text) return;
    alertDialog({ title: 'What this shows', message: text });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const icon = e.target.closest?.('.info-icon');
    if (!icon) return;
    e.preventDefault();
    const text = icon.getAttribute('title');
    if (!text) return;
    alertDialog({ title: 'What this shows', message: text });
  });
}
