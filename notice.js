/* Only the verified PLATO home notice carousel is eligible for automatic dismissal. */
const PlatoNotice = {
  states: new WeakMap(),
  pending: new Set(),

  isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  },

  isRendered(element) {
    if (!element || !element.isConnected) return false;
    return getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0;
  },

  isSafe(notice) {
    return !!notice.querySelector('#popup-splide .popup-footer') &&
      !notice.querySelector('form, input[type="file"], .moodle-dialogue, [role="alertdialog"]');
  },

  isDismissed(carousel) {
    // Our visibility rule is not evidence of a successful site request.
    return !carousel.isConnected || getComputedStyle(carousel).display === 'none' ||
      carousel.getAttribute('aria-hidden') === 'true';
  },

  handle(enabled, doc = document) {
    for (const state of this.pending) {
      if (this.isDismissed(state.carousel)) state.completed = true;
      if (state.completed || Date.now() >= state.nextTry) this.pending.delete(state);
    }
    const guard = typeof window !== 'undefined' ? window.__platoNoticeEarly : null;
    if (!enabled || (guard && guard.enabled !== true)) return 0;
    let clicked = 0;
    const notices = doc.querySelectorAll('.modal-ubboard-notice');
    for (const notice of notices) {
      if (!this.isSafe(notice)) continue;
      const carousel = notice.querySelector('#popup-splide');
      if (guard) {
        if (!guard.ready || !notice.closest('.ubboard-popup') || !this.isRendered(notice) ||
            !carousel.classList.contains('is-initialized')) continue;
      } else if (!this.isVisible(notice)) continue;
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

      let state = this.states.get(carousel);
      if (state && this.isDismissed(carousel)) { state.completed = true; continue; }
      if (state?.completed || (state && Date.now() < state.nextTry)) continue;
      const permanent = [...carousel.querySelectorAll('.popup-footer .btn-not-show-again[data-not-show-type="2"]')]
        .find(button => /더\s*이상\s*보지\s*않음/.test(button.textContent || '') &&
          this.isRendered(button));
      const safeClose = carousel.querySelector('.splide__slide .btn-close[data-bs-dismiss="modal"]');
      const target = permanent || (!guard && this.isVisible(safeClose) ? safeClose : null);
      if (!target) continue;
      state ||= { carousel, attempts: 0, completed: false, nextTry: 0 };
      state.attempts++;
      state.nextTry = Date.now() + [5000, 15000, 60000, 300000][Math.min(state.attempts - 1, 3)];
      this.states.set(carousel, state);
      target.click(); // PLATO's own click handler saves popupNotShow or removes the carousel.
      state.completed = this.isDismissed(carousel);
      if (!state.completed) this.pending.add(state);
      clicked++;
    }
    return clicked;
  }
};

// Site handlers may be registered after the notice DOM appears. Wait until the
// document is ready, then observe late notices while the early guard is active.
if (typeof window !== 'undefined' && window.__platoNoticeEarly) {
  const guard = window.__platoNoticeEarly;
  guard.controllerReady = true;
  if (guard.enabled === true) guard.apply(true);
  let observer;
  let timer;
  let queued = false;
  const check = () => {
    if (!guard.ready || guard.enabled !== true) return;
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      if (guard.enabled === true) PlatoNotice.handle(true);
    }, 50);
  };
  const start = () => {
    guard.ready = true;
    observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
    timer = setInterval(check, 1000);
    check();
  };
  guard.notify = check;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    observer?.disconnect();
    clearInterval(timer);
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = PlatoNotice;
