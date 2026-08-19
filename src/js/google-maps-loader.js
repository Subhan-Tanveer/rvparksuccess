// Shared Google Maps JS API loader — used by the Park Settings address
// picker and the Add Competitor map modal. A single cached promise means
// whichever feature loads first on a page pays the script-load cost once;
// the other reuses the same window.google.maps instance instead of
// injecting a second <script> tag.
let mapsLoaderPromise = null;

export function loadGoogleMaps() {
  if (mapsLoaderPromise) return mapsLoaderPromise;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  mapsLoaderPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.places) { resolve(window.google.maps); return; }
    if (!apiKey) { reject(new Error('Google Maps is not configured.')); return; }

    window.__gmapsLoaderCallback = () => resolve(window.google.maps);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=__gmapsLoaderCallback`;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps.'));
    document.head.appendChild(script);
  });
  return mapsLoaderPromise;
}
