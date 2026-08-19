// Guest-facing "Get Directions" panel — a map + directions link to the
// park, plus an opt-in live arrival greeting. Built from what Marie asked
// for: "can the person making a reservation see a map from where they
// are to the campground, and hear 'welcome to [park]' when they arrive."
//
// Directions: handed off entirely to Google/Apple Maps via a destination-
// only maps URL — those apps already know how to route from "wherever the
// guest currently is," so this never needs the guest's location itself.
//
// Arrival greeting: genuinely live (not a manual "I've arrived" button),
// which means it can only work while this page stays open with location
// permission granted — a website has no access to true OS-level
// background geofencing the way a native app would. It uses the
// standards-based Geolocation + Web Speech APIs, so it needs no server
// round-trip and no third-party service.
import { loadGoogleMaps } from './google-maps-loader.js';

const ARRIVAL_RADIUS_MILES = 0.3;

function milesBetween(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Renders into `container` if the park has a precise pinpoint set (Park
// Settings > Park Address); otherwise leaves the container empty rather
// than showing a broken/pointless map, since a park that's never set a
// real address has nothing to route to.
//
// showArrivalGreeting controls whether the live "You've Arrived" toggle
// appears. The map + Get Directions link are useful the moment a guest is
// looking at a park — even before booking, "how far is this from me" is
// part of deciding whether to book at all. The arrival greeting only
// makes sense once there's an actual reservation to arrive at; showing it
// (and its location-permission prompt) to someone who hasn't booked
// anything yet is a pointless, slightly creepy ask.
export function renderDirectionsPanel(container, park, { showArrivalGreeting = false } = {}) {
  if (!container || !park || park.latitude == null || park.longitude == null) {
    if (container) container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div class="res-directions-head">
      <h3>Getting to ${escapeHtml(park.name || 'the park')}</h3>
      <p class="sub">${escapeHtml(park.address || '')}</p>
    </div>
    <div class="res-directions-map" id="resDirectionsMap" style="height:260px; border-radius:12px; overflow:hidden;"></div>
    <div class="res-directions-actions">
      <a class="btn btn-primary btn-sm" id="resGetDirectionsBtn" target="_blank" rel="noopener"
         href="https://www.google.com/maps/dir/?api=1&destination=${park.latitude},${park.longitude}">
        <span>Get Directions</span>
      </a>
      ${showArrivalGreeting ? `
      <button type="button" class="btn btn-ghost btn-sm" id="resArrivalToggleBtn">
        <span>Get a "You've Arrived" greeting</span>
      </button>` : ''}
    </div>
    ${showArrivalGreeting ? '<p class="form-note" id="resArrivalStatus" style="display:none;"></p>' : ''}
  `;

  loadGoogleMaps()
    .then((maps) => {
      const mapEl = document.getElementById('resDirectionsMap');
      if (!mapEl) return;
      const position = { lat: park.latitude, lng: park.longitude };
      const map = new maps.Map(mapEl, { center: position, zoom: 13, disableDefaultUI: true, zoomControl: true });
      new maps.Marker({ position, map, title: park.name || '' });
    })
    .catch((err) => {
      console.error('Directions map unavailable:', err.message);
      const mapEl = document.getElementById('resDirectionsMap');
      if (mapEl) mapEl.style.display = 'none';
    });

  if (showArrivalGreeting) wireArrivalGreeting(park);
}

function wireArrivalGreeting(park) {
  const toggleBtn = document.getElementById('resArrivalToggleBtn');
  const statusEl = document.getElementById('resArrivalStatus');
  if (!toggleBtn || !statusEl) return;

  let watchId = null;
  let hasGreeted = false;

  const showStatus = (text) => {
    statusEl.textContent = text;
    statusEl.style.display = 'block';
  };

  const speakWelcome = () => {
    if (hasGreeted) return;
    hasGreeted = true;
    showStatus(`You're close! Welcoming you to ${park.name || 'the park'}...`);
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(`Welcome to ${park.name || 'the park'}!`);
      window.speechSynthesis.speak(utterance);
    }
    stopWatching();
    toggleBtn.textContent = "You've arrived!";
    toggleBtn.disabled = true;
  };

  const stopWatching = () => {
    if (watchId !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };

  toggleBtn.addEventListener('click', () => {
    if (watchId !== null) {
      stopWatching();
      showStatus('Arrival greeting turned off.');
      toggleBtn.querySelector('span').textContent = 'Get a "You\'ve Arrived" greeting';
      return;
    }

    if (!('geolocation' in navigator)) {
      showStatus("This browser doesn't support live location — use Get Directions instead.");
      return;
    }

    // This only works while this tab stays open — a website can't get
    // true background location access the way a native app can, so
    // closing the tab or locking the phone stops the check.
    showStatus('Watching your location — keep this tab open during your drive. This stops automatically once you arrive.');
    toggleBtn.querySelector('span').textContent = 'Stop watching';

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const distance = milesBetween(
          position.coords.latitude,
          position.coords.longitude,
          park.latitude,
          park.longitude
        );
        if (distance <= ARRIVAL_RADIUS_MILES) speakWelcome();
      },
      (err) => {
        showStatus(`Couldn't access your location (${err.message}). Use Get Directions instead.`);
        stopWatching();
        toggleBtn.querySelector('span').textContent = 'Get a "You\'ve Arrived" greeting';
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
    );
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
