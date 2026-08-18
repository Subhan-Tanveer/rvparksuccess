// Small "?" badge for section headers that explains what that section is
// and what it shows, on hover. Deliberately uses the browser's native
// `title` attribute rather than a custom-positioned tooltip element — this
// app has already hit real bugs (clipped tooltips, coordinate-system
// mismatches, stale layout while a tab is hidden) from hand-rolled tooltips
// living inside scroll/overflow-clipped dashboard cards. The native
// tooltip has none of those failure modes: no positioning math, nothing to
// clip it, nothing to keep in sync with a chart's coordinate space.
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
