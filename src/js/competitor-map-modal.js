// Add Competitor modal — Google Map + Places search (GHL-style), with a
// "manual" fallback form for businesses that don't have a Google listing.
// Exposes openAddCompetitorModal(), which resolves true if a competitor was
// added (so the caller knows to refresh its list) or false if canceled.

import { loadGoogleMaps } from './google-maps-loader.js';

function buildModalShell() {
  const backdrop = document.createElement('div');
  backdrop.className = 'ci-map-backdrop';
  backdrop.innerHTML = `
    <div class="ci-map-modal">
      <div class="ci-map-modal-head">
        <h3>Add Competitor</h3>
        <button type="button" class="ci-map-close" aria-label="Close">&times;</button>
      </div>

      <div class="ci-map-toolbar">
        <div class="ci-map-search-wrap">
          <input type="text" id="ciMapSearchInput" placeholder="Search Business" autocomplete="off">
        </div>
        <button type="button" class="ci-map-link-btn" id="ciMapManualToggle">+ Add a Virtual Business Manually</button>
        <button type="button" class="btn btn-primary btn-sm" id="ciMapAddBtn" disabled><span>Add Competitor</span></button>
      </div>

      <div class="ci-map-error" id="ciMapError" style="display:none;"></div>

      <div class="ci-map-canvas-wrap" id="ciMapCanvasWrap">
        <div id="ciMapCanvas" class="ci-map-canvas"></div>
      </div>

      <div class="ci-map-manual-form" id="ciMapManualForm" style="display:none;">
        <div class="field-float">
          <input id="ciManualName" type="text" required placeholder=" ">
          <label for="ciManualName">Business Name *</label>
        </div>
        <div class="field-float">
          <input id="ciManualAddress" type="text" placeholder=" ">
          <label for="ciManualAddress">Address</label>
        </div>
        <div class="field-float">
          <input id="ciManualWebsite" type="url" placeholder=" ">
          <label for="ciManualWebsite">Website</label>
        </div>
        <div class="field-float">
          <input id="ciManualMapsUrl" type="url" placeholder=" ">
          <label for="ciManualMapsUrl">Google Maps URL</label>
        </div>
        <button type="button" class="ci-map-link-btn" id="ciMapBackToSearch">&larr; Back to map search</button>
      </div>
    </div>
  `;
  return backdrop;
}

export function openAddCompetitorModal() {
  return new Promise((resolve) => {
    const backdrop = buildModalShell();
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('is-open'));

    const closeBtn = backdrop.querySelector('.ci-map-close');
    const searchInput = backdrop.querySelector('#ciMapSearchInput');
    const manualToggle = backdrop.querySelector('#ciMapManualToggle');
    const backToSearch = backdrop.querySelector('#ciMapBackToSearch');
    const addBtn = backdrop.querySelector('#ciMapAddBtn');
    const canvasWrap = backdrop.querySelector('#ciMapCanvasWrap');
    const manualForm = backdrop.querySelector('#ciMapManualForm');
    const errorEl = backdrop.querySelector('#ciMapError');

    let selectedPlace = null;
    let map = null;
    let marker = null;
    let isManualMode = false;
    let settled = false;

    const showError = (msg) => { errorEl.textContent = msg; errorEl.style.display = 'block'; };
    const clearError = () => { errorEl.style.display = 'none'; };

    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      backdrop.classList.remove('is-open');
      setTimeout(() => backdrop.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(false); };
    document.addEventListener('keydown', onKey);

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cleanup(false); });
    closeBtn.addEventListener('click', () => cleanup(false));

    const setManualMode = (on) => {
      isManualMode = on;
      manualForm.style.display = on ? 'flex' : 'none';
      canvasWrap.style.display = on ? 'none' : 'block';
      manualToggle.style.display = on ? 'none' : 'inline';
      addBtn.disabled = on ? false : !selectedPlace;
      clearError();
    };
    manualToggle.addEventListener('click', () => setManualMode(true));
    backToSearch.addEventListener('click', () => setManualMode(false));

    addBtn.addEventListener('click', async () => {
      clearError();
      let payload;
      if (isManualMode) {
        const name = document.getElementById('ciManualName').value.trim();
        const address = document.getElementById('ciManualAddress').value.trim();
        const websiteUrl = document.getElementById('ciManualWebsite').value.trim();
        const googleMapsUrl = document.getElementById('ciManualMapsUrl').value.trim();
        if (!name) { showError('Business name is required.'); return; }
        payload = { name, address, location: address, websiteUrl, googleMapsUrl };
      } else {
        if (!selectedPlace) { showError('Search for and select a business first.'); return; }
        payload = selectedPlace;
      }

      addBtn.disabled = true;
      try {
        const response = await fetch('/api/admin/ops?resource=competitive-intelligence&action=add-competitor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add-competitor', ...payload }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${response.status}`);
        }
        cleanup(true);
      } catch (err) {
        console.error('Failed to add competitor:', err);
        showError('Failed to add competitor. Please try again.');
        addBtn.disabled = false;
      }
    });

    // Load the map + wire up Places search. Falls back to manual-only mode
    // if Maps can't load (no key configured, network blocked, etc.).
    loadGoogleMaps()
      .then(async (maps) => {
        const defaultCenter = { lat: 39.8283, lng: -98.5795 }; // continental US centroid
        map = new maps.Map(document.getElementById('ciMapCanvas'), {
          center: defaultCenter,
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });

        // Plot already-tracked competitors that have coordinates, for context.
        try {
          const res = await fetch('/api/admin/ops?resource=competitive-intelligence&action=competitors');
          if (res.ok) {
            const data = await res.json();
            const withCoords = (data.competitors || []).filter((c) => c.lat != null && c.lng != null);
            withCoords.forEach((c) => {
              new maps.Marker({
                position: { lat: c.lat, lng: c.lng },
                map,
                title: c.name,
                icon: { url: 'https://maps.google.com/mapfiles/ms/icons/purple-dot.png' },
              });
            });
            if (withCoords.length) {
              const bounds = new maps.LatLngBounds();
              withCoords.forEach((c) => bounds.extend({ lat: c.lat, lng: c.lng }));
              map.fitBounds(bounds);
            }
          }
        } catch (err) {
          console.error('Failed to plot existing competitors:', err);
        }

        const autocomplete = new maps.places.Autocomplete(searchInput, {
          // Basic Data only (name/address/location/place_id) — available on every
          // Places billing tier. Contact Data (website/url) is requested
          // separately below so an unprovisioned tier can't blank out the
          // whole result (Google fails the *entire* Details call, not just
          // the unsupported field, when a requested field isn't authorized).
          fields: ['name', 'formatted_address', 'geometry', 'place_id'],
        });
        autocomplete.bindTo('bounds', map);
        const placesService = new maps.places.PlacesService(map);

        autocomplete.addListener('place_changed', () => {
          clearError();
          const place = autocomplete.getPlace();
          if (!place.geometry || !place.geometry.location) {
            showError('No details available for that search — try another business.');
            return;
          }

          map.setCenter(place.geometry.location);
          map.setZoom(15);
          if (marker) marker.setMap(null);
          marker = new maps.Marker({ position: place.geometry.location, map, title: place.name });

          selectedPlace = {
            name: place.name,
            address: place.formatted_address || '',
            location: place.formatted_address || '',
            websiteUrl: '',
            googleMapsUrl: '',
            placeId: place.place_id || '',
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
          };
          addBtn.disabled = false;

          // Best-effort: fill in website/Google Maps URL if this project's
          // Places tier supports Contact Data. Failure here doesn't block
          // adding the competitor — those fields just stay blank.
          if (place.place_id) {
            placesService.getDetails({ placeId: place.place_id, fields: ['website', 'url'] }, (details, status) => {
              if (status === maps.places.PlacesServiceStatus.OK && details && selectedPlace?.placeId === place.place_id) {
                selectedPlace.websiteUrl = details.website || '';
                selectedPlace.googleMapsUrl = details.url || '';
              }
            });
          }
        });
      })
      .catch((err) => {
        console.error('Google Maps unavailable, falling back to manual entry:', err);
        setManualMode(true);
        manualToggle.style.display = 'none';
        showError('Map search is unavailable right now — you can still add a competitor manually below.');
      });
  });
}
