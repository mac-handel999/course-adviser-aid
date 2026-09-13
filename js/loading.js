/* =========================================================================
   Advyza — lightweight loading overlay utility

   Usage:
     showLoading('Looking up results…');
     try {
       const data = await fetch('/api/...');
     } finally {
       hideLoading();
     }

   Properties:
     - Hard maximum display: 8 seconds (auto-hides so a hung request never
       leaves the overlay looping forever).
     - Zero artificial minimum — hideLoading() hides instantly whenever the
       underlying request resolves, even if that's near-instant.
     - CSS-based pulse animation (transform/opacity only, no GIFs or
       animation libraries).
   ========================================================================= */

const LOADING_TIMEOUT_MS = 8000;

let loadingTimer = null;

function ensureLoadingOverlay() {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML =
      '<div class="loading-content">' +
        '<img src="assets/advyza-logo.svg" class="loading-logo" alt="Advyza">' +
        '<div class="loading-message">Loading…</div>' +
      '</div>';
    document.body.appendChild(overlay);
  }
  return overlay;
}

function showLoading(message) {
  const overlay = ensureLoadingOverlay();
  const msgEl = overlay.querySelector('.loading-message');
  if (msgEl) msgEl.textContent = message || 'Loading…';
  overlay.style.display = 'flex';

  if (loadingTimer) clearTimeout(loadingTimer);
  loadingTimer = setTimeout(function () {
    hideLoading();
  }, LOADING_TIMEOUT_MS);
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'none';
  if (loadingTimer) {
    clearTimeout(loadingTimer);
    loadingTimer = null;
  }
}

async function withLoading(promise, message) {
  showLoading(message);
  try {
    return await promise;
  } finally {
    hideLoading();
  }
}
