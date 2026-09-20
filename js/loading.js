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
let loadingTimeoutDuration = LOADING_TIMEOUT_MS;

function ensureLoadingOverlay() {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML =
      '<div class="loading-content">' +
        '<img src="/assets/advyza-logo.svg" class="loading-logo" alt="Advyza">' +
        '<div class="loading-message">Loading…</div>' +
      '</div>';
    document.body.appendChild(overlay);
  }
  return overlay;
}

function showLoading(message, timeoutMs) {
  const overlay = ensureLoadingOverlay();
  const msgEl = overlay.querySelector('.loading-message');
  if (msgEl) msgEl.textContent = message || 'Loading…';
  overlay.style.display = 'flex';

  if (loadingTimer) clearTimeout(loadingTimer);
  loadingTimeoutDuration = timeoutMs || LOADING_TIMEOUT_MS;
  loadingTimer = setTimeout(function () {
    hideLoading();
  }, loadingTimeoutDuration);
}

function updateLoadingMessage(message) {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  const msgEl = overlay.querySelector('.loading-message');
  if (msgEl) msgEl.textContent = message;
}

function clearLoadingTimer() {
  if (loadingTimer) {
    clearTimeout(loadingTimer);
    loadingTimer = null;
  }
}

function showLoadingLong(message) {
  showLoading(message, 120000);
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

/* ===================== SCROLL TO TOP ===================== */
let scrollToTopEl = null;
const SCROLL_THRESHOLD = 400;

function ensureScrollToTopBtn() {
  if (scrollToTopEl) return scrollToTopEl;
  const btn = document.createElement('button');
  btn.id = 'scrollToTopBtn';
  btn.className = 'scroll-to-top';
  btn.setAttribute('aria-label', 'Scroll to top');
   btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 4l-8 8h5v8h6v-8h5z"/></svg>';
  document.body.appendChild(btn);
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  scrollToTopEl = btn;
  return btn;
}

function initScrollToTop() {
  const btn = ensureScrollToTopBtn();
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const scrolled = window.scrollY > SCROLL_THRESHOLD;
      btn.style.opacity = scrolled ? '1' : '0';
      btn.style.visibility = scrolled ? 'visible' : 'hidden';
      btn.style.transform = scrolled ? 'translateY(0)' : 'translateY(20px)';
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

document.addEventListener('DOMContentLoaded', initScrollToTop);
