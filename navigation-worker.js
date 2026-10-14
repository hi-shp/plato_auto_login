/* Tab-scoped navigation only. No credentials, cookies, or page content. */
const PLATO_ORIGIN = 'https://plato.pusan.ac.kr';
const NAV_MAX_AGE = 5 * 60 * 1000;
const NAV_PREFIX = 'plato_navigation_';
const navQueues = new Map();

function safeNavigationTarget(raw, base = PLATO_ORIGIN + '/') {
  if (!raw) return null;
  try {
    const target = new URL(raw, base);
    if (target.origin !== PLATO_ORIGIN || target.username || target.password ||
        /^\/(?:login(?:\/|\.php|$)|auth\/|sso\/)/i.test(target.pathname)) return null;
    // Authentication material is never retained as a navigation destination.
    if ([...target.searchParams.keys(), ...new URLSearchParams(target.hash.slice(1)).keys()]
      .some(key => /^(?:sesskey|token|access_token|id_token|password|ticket|samlresponse|code)$/i.test(key))) return null;
    return target.href;
  } catch (_) { return null; }
}

function isNavigationHome(url) {
  return ['/', '/index.php'].includes(new URL(url).pathname);
}

function freshNavigationState(state, now = Date.now()) {
  if (!state || !Number.isFinite(state.createdAt) || now < state.createdAt || now - state.createdAt > NAV_MAX_AGE) return {};
  const url = safeNavigationTarget(state.url);
  const lastPage = safeNavigationTarget(state.lastPage);
  return { ...state, url, lastPage };
}

function navigationIntent(state, raw, reason, now = Date.now()) {
  const url = safeNavigationTarget(raw);
  if (!url || !['click', 'direct', 'session'].includes(reason)) return state;
  const rank = { click: 3, direct: 2, session: 1 };
  if (state.url && rank[state.reason] > rank[reason]) return state;
  return { ...state, url, reason, createdAt: now, restores: 0, blocked: false };
}

function navigationQueue(tabId, action) {
  const previous = navQueues.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const key = NAV_PREFIX + tabId;
    const stored = await chrome.storage.session.get(key);
    const state = freshNavigationState(stored[key]);
    const result = await action(state);
    if (result === null || !result.createdAt) await chrome.storage.session.remove(key);
    else await chrome.storage.session.set({ [key]: result });
    return result || {};
  });
  navQueues.set(tabId, next);
  next.finally(() => { if (navQueues.get(tabId) === next) navQueues.delete(tabId); }).catch(() => {});
  return next;
}

function isNavigationAuth(raw) {
  try {
    const url = new URL(raw);
    return (url.origin === PLATO_ORIGIN && /^\/(?:login(?:\/|\.php|$)|auth\/|sso\/)/i.test(url.pathname)) ||
      (url.origin === 'https://login.pusan.ac.kr');
  } catch (_) { return false; }
}

function beforeNavigation(details) {
  if (details.frameId !== 0) return;
  const target = safeNavigationTarget(details.url);
  if (!target && !isNavigationAuth(details.url)) return;
  return navigationQueue(details.tabId, state => {
    if (!target) {
      if (new URL(details.url).origin !== PLATO_ORIGIN && !state.createdAt) return state;
      const wants = safeNavigationTarget(new URL(details.url).searchParams.get('wantsurl'));
      if (wants && (!state.url || (!state.pending && state.reason !== 'click'))) state = navigationIntent(state, wants, 'direct');
      if (!state.url && state.lastPage) state = navigationIntent(state, state.lastPage, 'session');
      return { ...state, pending: true, createdAt: state.createdAt || Date.now() };
    }
    if (state.pending || state.restoring) return state;
    if (state.reason === 'click' && state.url === target) return state;
    if (isNavigationHome(target)) return { lastPage: state.lastPage, createdAt: Date.now() };
    return navigationIntent({ lastPage: state.lastPage }, target, 'direct');
  });
}

if (typeof chrome !== 'undefined' && chrome.webNavigation) {
  const filter = { url: [{ hostEquals: new URL(PLATO_ORIGIN).hostname }, { hostEquals: 'login.pusan.ac.kr' }] };
  chrome.webNavigation.onBeforeNavigate.addListener(details => { beforeNavigation(details)?.catch(() => {}); }, filter);
  chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
    const url = safeNavigationTarget(details.url);
    if (!url || isNavigationHome(url)) return;
    navigationQueue(details.tabId, () => navigationIntent({}, url, 'click')).catch(() => {});
  }, filter);
  chrome.webNavigation.onCommitted.addListener(details => {
    if (details.frameId !== 0 || !['typed', 'auto_bookmark'].includes(details.transitionType) ||
        details.transitionQualifiers.includes('server_redirect')) return;
    const url = safeNavigationTarget(details.url);
    if (url && !isNavigationHome(url)) navigationQueue(details.tabId, state =>
      navigationIntent({ lastPage: state.lastPage }, url, 'direct')).catch(() => {});
  }, filter);
  chrome.tabs.onRemoved.addListener(tabId => { navigationQueue(tabId, () => null).catch(() => {}); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'plato-navigation' || sender.frameId !== 0 || !sender.tab ||
        new URL(sender.url).origin !== PLATO_ORIGIN) return;
    navigationQueue(sender.tab.id, state => {
      switch (message.action) {
        case 'get': return state;
        case 'remember': return navigationIntent(state, message.url, message.reason);
        case 'mark': return { ...state, pending: true, createdAt: state.createdAt || Date.now() };
        case 'restore': {
          const url = safeNavigationTarget(message.url);
          if (!url || (state.restores || 0) >= 2) return { ...state, blocked: true };
          return { ...state, url, pending: true, restoring: true, restores: (state.restores || 0) + 1, createdAt: state.createdAt || Date.now() };
        }
        case 'complete':
          if (!safeNavigationTarget(message.url) || safeNavigationTarget(sender.url) !== safeNavigationTarget(message.url) ||
              (state.url && state.url !== safeNavigationTarget(message.url))) return state;
          return { lastPage: safeNavigationTarget(message.url), createdAt: Date.now() };
        default: return state;
      }
    }).then(respond, () => respond({ unavailable: true }));
    return true;
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  safeNavigationTarget, freshNavigationState, navigationIntent, beforeNavigation, navigationQueue
};
