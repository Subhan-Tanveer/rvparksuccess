/**
 * Generates an on-brand placeholder (as a data-URI SVG) for any hero/photo
 * asset that hasn't been supplied yet, so the site never shows a blank or
 * broken box while real video/photos are pending.
 */
export function placeholderDataUri(label) {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0a1d22"/>
        <stop offset="100%" stop-color="#06090a"/>
      </linearGradient>
      <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.12)"/>
      </pattern>
    </defs>
    <rect width="1600" height="900" fill="url(#g)"/>
    <rect width="1600" height="900" fill="url(#dots)"/>
    <text x="80" y="800" font-family="monospace" font-size="15" letter-spacing="3" fill="rgba(59, 187, 237,0.85)">${escapeXml(label || 'VIDEO / PHOTO COMING SOON')}</text>
  </svg>`.trim();
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** Tests whether an image URL actually loads; calls onFail(placeholder) if it 404s. */
export function checkImageOrFallback(url, label, onFail) {
  const test = new Image();
  test.onerror = () => onFail(placeholderDataUri(label));
  test.src = url;
}

/** Swaps a broken <img> to the generated placeholder exactly once. */
export function withPlaceholderFallback(imgEl, label) {
  imgEl.addEventListener('error', () => { imgEl.src = placeholderDataUri(label); }, { once: true });
}
