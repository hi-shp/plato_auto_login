/* Persistent filtering of the verified PLATO front-page notice wrapper. */
(() => {
  if (window !== window.top || location.hostname !== 'plato.pusan.ac.kr' ||
      !['/', '/index.php'].includes(location.pathname)) return;

  const style = document.createElement('style');
  style.id = 'plato-home-notice-filter';
  const selector = '.ubboard-popup .modal-ubboard-notice:not(:has(form, input[type="file"], .moodle-dialogue, [role="alertdialog"]))';
  style.textContent = `${selector}, ${selector} * { visibility: hidden !important; }`;
  let rootObserver;
  const guard = {
    active: false,
    enabled: null,
    ready: false,
    controllerReady: false,
    release() {
      style.remove();
      this.active = false;
    },
    apply(enabled) {
      this.enabled = enabled === true;
      clearTimeout(this.storageTimeout);
      if (this.enabled) mount();
      else this.release();
      this.notify?.();
    }
  };
  const mount = () => {
    if (guard.enabled === false) return;
    if (document.documentElement) {
      if (!style.isConnected) document.documentElement.append(style);
      guard.active = true;
      rootObserver?.disconnect();
    } else if (!rootObserver) {
      rootObserver = new MutationObserver(mount);
      rootObserver.observe(document, { childList: true });
    }
  };
  window.__platoNoticeEarly = guard;
  mount(); // Install before the asynchronous setting read.
  guard.storageTimeout = setTimeout(() => guard.apply(false), 3000);
  try {
    chrome.storage.local.get(['platoPopupClose'], data => {
      guard.apply(!chrome.runtime.lastError && data.platoPopupClose === true);
    });
  } catch (_) { guard.apply(false); }
  const onChange = (changes, area) => {
    if (area === 'local' && changes.platoPopupClose) guard.apply(changes.platoPopupClose.newValue);
  };
  chrome.storage.onChanged?.addListener(onChange);
  // Fail open if the companion script fails to load. A healthy controller
  // filters late notices throughout the home visit, without a 12-second limit.
  const checkCompanion = () => setTimeout(() => {
    if (!guard.controllerReady) guard.release();
  }, 5000);
  if (document.readyState === 'complete') checkCompanion();
  else window.addEventListener('load', checkCompanion, { once: true });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    rootObserver?.disconnect();
    chrome.storage.onChanged?.removeListener(onChange);
    clearTimeout(guard.storageTimeout);
  });
})();
