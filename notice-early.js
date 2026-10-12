/* Hide only the verified PLATO home notice before the page's first paint. */
(() => {
  if (window !== window.top || location.hostname !== 'plato.pusan.ac.kr' ||
      !['/', '/index.php'].includes(location.pathname)) return;

  const style = document.createElement('style');
  style.textContent = '.modal-ubboard-notice { visibility: hidden !important; }';
  document.documentElement.append(style);
  const guard = {
    active: true,
    enabled: false,
    ready: false,
    clicked: false,
    finish() {
      if (!this.active) return;
      this.active = false;
      style.remove();
      clearTimeout(this.timeout);
    },
    settled() {
      return [...document.querySelectorAll('.modal-ubboard-notice')].every(notice =>
        getComputedStyle(notice).display === 'none' || notice.getAttribute('aria-hidden') === 'true');
    },
    onClick() {
      this.clicked = true;
      // The site's handler must dismiss its own notice. If it does not, reveal it.
      setTimeout(() => { if (this.settled()) this.finish(); }, 0);
    }
  };
  window.__platoNoticeEarly = guard;
  guard.timeout = setTimeout(() => guard.finish(), 12000);
  try {
    chrome.storage.local.get(['platoPopupClose'], data => {
      if (chrome.runtime.lastError || data.platoPopupClose !== true) guard.finish();
      else { guard.enabled = true; guard.onEnabled?.(); }
    });
  } catch (_) {
    guard.finish();
  }
})();
