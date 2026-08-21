// Guest-facing "About this park" panel — photos/video, description, and
// amenities for the PARK as a whole (not any one site). Shown while a
// guest is still deciding whether to book, not just after checkout.
export function renderParkProfilePanel(container, park) {
  if (!container || !park) {
    if (container) container.style.display = 'none';
    return;
  }

  const images = (park.media || []).filter((m) => m.type === 'image');
  const video = (park.media || []).find((m) => m.type === 'video');
  const hasDescription = !!(park.description && park.description.trim());
  const hasFeatures = !!(park.features && park.features.length);
  const hasLogo = !!park.logoUrl;

  if (!images.length && !video && !hasDescription && !hasFeatures && !hasLogo) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  const coverHtml = images.length
    ? `<img class="park-profile-cover" data-park-cover src="${escapeAttr(images[0].url)}" alt="${escapeAttr(park.name || '')}" loading="lazy">`
    : '';
  const thumbsHtml = images.length > 1
    ? `<div class="park-profile-thumbs">${images.map((m, i) => `<button type="button" class="park-profile-thumb${i === 0 ? ' is-active' : ''}" data-park-thumb="${escapeAttr(m.url)}"><img src="${escapeAttr(m.url)}" alt="" loading="lazy"></button>`).join('')}</div>`
    : '';
  const videoHtml = video
    ? `<video class="park-profile-video" src="${escapeAttr(video.url)}" controls preload="metadata"></video>`
    : '';
  const logoHtml = hasLogo
    ? `<img class="park-profile-logo" src="${escapeAttr(park.logoUrl)}" alt="${escapeAttr(park.name || '')} logo">`
    : '';
  const descriptionHtml = hasDescription
    ? `<p class="park-profile-description">${escapeHtml(park.description)}</p>`
    : '';
  const featuresHtml = hasFeatures
    ? `<div class="park-profile-features">${park.features.map((f) => `<span class="park-profile-feature">${escapeHtml(f)}</span>`).join('')}</div>`
    : '';

  container.innerHTML = `
    <div class="park-profile-media">${coverHtml}${thumbsHtml}${videoHtml}</div>
    <div class="park-profile-body">
      ${logoHtml}
      ${descriptionHtml}
      ${featuresHtml}
    </div>
  `;

  container.querySelectorAll('[data-park-thumb]').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      const cover = container.querySelector('[data-park-cover]');
      if (cover) cover.src = thumb.dataset.parkThumb;
      container.querySelectorAll('[data-park-thumb]').forEach((t) => t.classList.toggle('is-active', t === thumb));
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
