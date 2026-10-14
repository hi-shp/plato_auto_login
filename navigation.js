/* Restore top-frame intent before nonessential home features are initialized. */
(() => {
  if (window !== window.top || location.hostname !== 'plato.pusan.ac.kr') return;
  const course = 'https://plato.pusan.ac.kr/local/ubion/allcourse/regular/index.php';
  const measure = name => {
    if (!performance.getEntriesByName('plato-' + name).length) performance.mark?.('plato-' + name);
  };
  const send = (action, values = {}) => new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: 'plato-navigation', action, ...values }, result => {
        resolve(chrome.runtime.lastError ? { unavailable: true } : result || {});
      });
    } catch (_) { resolve({ unavailable: true }); }
  });
  const isHome = url => ['/', '/index.php'].includes(new URL(url).pathname);
  const isReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  const fromHomeClick = sessionStorage.getItem('plato_home_clicked_from_course') === '1';
  if (isHome(location.href)) sessionStorage.removeItem('plato_home_clicked_from_course');
  const api = window.__platoNavigation = {
    isReady: false, redirecting: false, allowHome: fromHomeClick && !isReload,
    state: {}, measure,
    remember(url, reason) { return send('remember', { url, reason }); },
    mark() { this.state.pending = true; return send('mark'); },
    complete(url) { return send('complete', { url }); },
    restore(url) { return send('restore', { url }); }
  };
  measure('early-start');
  const settings = new Promise(resolve => {
    try {
      chrome.storage.local.get(['popupToggle', 'platoCalendarToggle'], data => {
        measure('settings-ready');
        resolve(chrome.runtime.lastError ? {} : data);
      });
    } catch (_) { resolve({}); }
  });
  let checking = false;
  const check = async () => {
    if (!api.isReady || checking || api.redirecting || !api.settings.popupToggle ||
        !document.body?.classList.contains('loggedin') || document.body.classList.contains('notloggedin') ||
        /^\/(?:login(?:\/|\.php|$)|auth\/|sso\/)/i.test(location.pathname)) return;
    checking = true;
    try {
      const state = api.state;
      let destination;
      if (state.pending) destination = state.url || course;
      else if (isHome(location.href) && !api.allowHome && api.settings.platoCalendarToggle !== false) destination = course;
      if (destination && destination !== location.href && !state.blocked) {
        api.routing = true;
        const confirmed = await api.restore(destination);
        if (confirmed.unavailable || confirmed.blocked) { api.routing = false; return; }
        api.redirecting = true;
        measure('destination-decided');
        measure('redirect-request');
        location.replace(destination);
      } else if (destination === location.href || (!destination && (!state.url || state.url === location.href))) {
        if (state.pending && isHome(location.href)) api.allowHome = true;
        api.state = await api.complete(location.href);
        sessionStorage.removeItem('plato_auto_login_pending');
        sessionStorage.removeItem('plato_login_intent');
        observer.disconnect();
      }
    } finally { checking = false; }
  };
  api.check = check;
  api.ready = Promise.all([send('get'), settings]).then(async ([state, data]) => {
    // Migrate a still-active attempt when an extension update starts a new worker.
    if (!state.unavailable && !state.url) {
      try {
        const legacy = JSON.parse(sessionStorage.getItem('plato_login_intent') || 'null');
        const started = Number(sessionStorage.getItem('plato_auto_login_pending'));
        const recent = stamp => Number.isFinite(stamp) && Date.now() - stamp >= 0 && Date.now() - stamp <= 300000;
        if (legacy && recent(legacy.createdAt) && ['click', 'direct', 'session'].includes(legacy.reason) &&
            (state.pending || (started && recent(started)))) {
          const migrated = await api.remember(legacy.url, legacy.reason);
          if (migrated.url) state = await send('mark');
        }
      } catch (_) {}
    }
    api.state = state;
    api.settings = data;
    if (!isReload && isHome(location.href) && state.reason === 'click' && state.url === location.href) api.allowHome = true;
    if (!state.unavailable) {
      // Preserve the existing keys for content.js and already in-flight sessions.
      if (state.url) sessionStorage.setItem('plato_login_intent', JSON.stringify({
        url: state.url, reason: state.reason || 'direct', createdAt: state.createdAt
      }));
      if (state.pending) sessionStorage.setItem('plato_auto_login_pending', String(state.createdAt));
    }
    measure('intent-ready');
    api.isReady = true;
    check();
  });
  const observer = new MutationObserver(check);
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('click', event => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
        event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    let url;
    try { url = new URL(link.href); } catch (_) { return; }
    if (url.origin !== location.origin || !link.getAttribute('href') || link.getAttribute('href').startsWith('#')) return;
    const homeMenu = isHome(url) && (link.textContent.trim() === '홈' || link.querySelector('.menuname')?.textContent.trim() === '홈' ||
      link.classList.contains('btn-channel') || link.classList.contains('navbar-brand') || link.getAttribute('role') === 'menuitem');
    if (isHome(url) && !homeMenu) return;
    if (homeMenu) sessionStorage.setItem('plato_home_clicked_from_course', '1');
    api.remember(url.href, 'click');
  }, true);
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
