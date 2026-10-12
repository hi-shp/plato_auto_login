/* Only the verified PLATO home notice carousel is eligible for automatic dismissal. */
const PlatoNotice = {
  handled: new WeakSet(),

  isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  },

  isRendered(element) {
    if (!element || !element.isConnected) return false;
    return getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0;
  },

  handle(enabled, doc = document) {
    if (!enabled) return 0;
    let clicked = 0;
    const notices = doc.querySelectorAll('.modal-ubboard-notice');
    for (const notice of notices) {
      const guard = typeof window !== 'undefined' ? window.__platoNoticeEarly : null;
      if (this.handled.has(notice) ||
          !(guard?.active ? guard.ready && this.isRendered(notice) : this.isVisible(notice))) continue;
      const carousel = notice.querySelector('#popup-splide');
      if (!carousel || !carousel.querySelector('.popup-footer')) continue;
      // An upload, action form, or another active dialog makes the notice ambiguous.
      if (notice.querySelector('form, input[type="file"], .moodle-dialogue, [role="alertdialog"]')) continue;
      const otherDialog = [...doc.querySelectorAll('.modal.show, .moodle-dialogue:not(.moodle-dialogue-hidden), [role="alertdialog"]')]
        .some(dialog => {
          if (dialog === notice || notice.contains(dialog) || !this.isVisible(dialog)) return false;
          const anotherNotice = dialog.matches('.modal-ubboard-notice') &&
            dialog.querySelector('#popup-splide .popup-footer') &&
            !dialog.querySelector('form, input[type="file"], [role="alertdialog"]');
          return !anotherNotice;
        });
      if (otherDialog) continue;

      const permanent = [...carousel.querySelectorAll('.popup-footer .btn-not-show-again[data-not-show-type="2"]')]
        .find(button => /더\s*이상\s*보지\s*않음/.test(button.textContent || '') &&
          (guard?.active ? this.isRendered(button) : this.isVisible(button)));
      const safeClose = carousel.querySelector('.splide__slide .btn-close[data-bs-dismiss="modal"]');
      const target = permanent || (!guard?.active && this.isVisible(safeClose) ? safeClose : null);
      if (!target) continue;
      this.handled.add(notice);
      target.click(); // PLATO's own click handler saves popupNotShow or removes the carousel.
      guard?.onClick();
      clicked++;
    }
    return clicked;
  }
};

// Site handlers may be registered after the notice DOM appears. Wait until the
// document is ready, then observe late notices while the early guard is active.
if (typeof window !== 'undefined' && window.__platoNoticeEarly?.active) {
  const guard = window.__platoNoticeEarly;
  let observer;
  let queued = false;
  const check = () => {
    if (!guard.active) { observer?.disconnect(); return; }
    if (!guard.enabled) return;
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      if (!guard.active) { observer?.disconnect(); return; }
      PlatoNotice.handle(true);
      if (guard.clicked && guard.settled()) guard.finish();
    }, 50);
  };
  const start = () => {
    guard.ready = true;
    guard.onEnabled = check;
    observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['class', 'style'] });
    check();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else setTimeout(start, 0);
}

if (typeof module !== 'undefined' && module.exports) module.exports = PlatoNotice;
