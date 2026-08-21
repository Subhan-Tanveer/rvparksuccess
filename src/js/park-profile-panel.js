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

  const navArrowsHtml = images.length > 1
    ? `
      <button type="button" class="park-profile-nav park-profile-nav-prev" data-park-nav="-1" aria-label="Previous photo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <button type="button" class="park-profile-nav park-profile-nav-next" data-park-nav="1" aria-label="Next photo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      </button>`
    : '';
  const coverHtml = images.length
    ? `<div class="park-profile-cover-wrap">
        <img class="park-profile-cover" data-park-cover src="${escapeAttr(images[0].url)}" alt="${escapeAttr(park.name || '')}" loading="lazy">
        ${navArrowsHtml}
      </div>`
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

  const headerHtml = (hasLogo || park.name)
    ? `<div class="park-profile-header">${logoHtml}${park.name ? `<h3 class="park-profile-name">${escapeHtml(park.name)}</h3>` : ''}</div>`
    : '';

  container.innerHTML = `
    <div class="park-profile-media">${coverHtml}${thumbsHtml}${videoHtml}</div>
    <div class="park-profile-body">
      ${headerHtml}
      ${descriptionHtml}
      ${featuresHtml}
    </div>
  `;

  const thumbs = Array.from(container.querySelectorAll('[data-park-thumb]'));
  const cover = container.querySelector('[data-park-cover]');
  let activeIndex = 0;

  function setActiveIndex(index) {
    if (!images.length) return;
    activeIndex = ((index % images.length) + images.length) % images.length;
    if (cover) cover.src = images[activeIndex].url;
    thumbs.forEach((t, i) => t.classList.toggle('is-active', i === activeIndex));
    const activeThumb = thumbs[activeIndex];
    if (activeThumb) activeThumb.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }

  thumbs.forEach((thumb, i) => {
    thumb.addEventListener('click', () => setActiveIndex(i));
  });

  container.querySelectorAll('[data-park-nav]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveIndex(activeIndex + Number(btn.dataset.parkNav)));
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
