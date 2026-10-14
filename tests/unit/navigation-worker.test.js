const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { safeNavigationTarget, navigationIntent, freshNavigationState } = require('../../navigation-worker.js');
const base = 'https://plato.pusan.ac.kr';
const task = base + '/mod/assign/view.php?id=42&action=view#intro';

test('navigation targets preserve activity queries and fragments without accepting credentials or authentication URLs', () => {
  assert.equal(safeNavigationTarget(task), task);
  for (const url of ['https://evil.example/a', 'http://plato.pusan.ac.kr/', base + ':8443/',
    'https://user:password@plato.pusan.ac.kr/', base + '/login/index.php', base + '/sso/bridge',
    task + '&token=secret', base + '/course/view.php?sesskey=secret', base + '/auth/relay?code=secret']) {
    // A fragment is not transmitted to the server; use a real query for the token case.
    const candidate = url.includes('#intro&token') ? url.replace('#intro&token', '&token') : url;
    assert.equal(safeNavigationTarget(candidate), null, candidate);
  }
});

test('click outranks direct URL; direct URL outranks session fallback; expired/future intent is discarded', () => {
  const direct = navigationIntent({}, task, 'direct');
  assert.equal(navigationIntent(direct, base + '/course/view.php?id=3', 'session').url, task);
  const click = navigationIntent(direct, base + '/mod/quiz/view.php?id=9', 'click');
  assert.equal(navigationIntent(click, task, 'direct').url, click.url);
  assert.deepEqual(freshNavigationState({ ...click, createdAt: Date.now() - 360000 }), {});
  assert.deepEqual(freshNavigationState({ ...click, createdAt: Date.now() + 60000 }), {});
});

function worker(storage = {}) {
  const callbacks = {};
  const event = name => ({ addListener: callback => { callbacks[name] = callback; } });
  const chrome = { storage: { session: {
    get: async key => ({ [key]: storage[key] }),
    set: async values => Object.assign(storage, values),
    remove: async key => { delete storage[key]; }
  } }, webNavigation: { onBeforeNavigate: event('before'), onCreatedNavigationTarget: event('created'),
    onCommitted: event('committed') }, tabs: { onRemoved: event('removed') }, runtime: { onMessage: event('message') } };
  const context = { chrome, URL, URLSearchParams, Date, Map, Promise, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../navigation-worker.js'), 'utf8'), context);
  const api = context.module.exports;
  const send = (tabId, action, values = {}, senderUrl = base + '/login/index.php') => new Promise(resolve => {
    callbacks.message({ type: 'plato-navigation', action, ...values }, { tab: { id: tabId }, frameId: 0, url: senderUrl }, resolve);
  });
  return { api, send, callbacks, storage };
}

test('pre-HTML redirects and cross-origin SSO retain independent tab targets across worker restart', async () => {
  const storage = {};
  let w = worker(storage);
  const other = base + '/mod/vod/view.php?id=43';
  await Promise.all([w.api.beforeNavigation({ tabId: 1, frameId: 0, url: task }),
    w.api.beforeNavigation({ tabId: 2, frameId: 0, url: other })]);
  await Promise.all([w.api.beforeNavigation({ tabId: 1, frameId: 0, url: base + '/login/index.php' }),
    w.api.beforeNavigation({ tabId: 2, frameId: 0, url: 'https://login.pusan.ac.kr/sso/login' })]);
  w = worker(storage);
  assert.equal((await w.send(1, 'get')).url, task);
  assert.equal((await w.send(2, 'get')).url, other);
  assert.equal((await w.send(1, 'get')).pending, true);
  await w.api.beforeNavigation({ tabId: 1, frameId: 0, url: base + '/message/index.php' });
  assert.equal((await w.send(1, 'get')).url, task);
});

test('redirect initiation retains intent; only exact arrival clears it; retries stop a loop', async () => {
  const w = worker();
  await w.send(1, 'remember', { url: task, reason: 'click' });
  await w.send(1, 'mark');
  await w.send(1, 'restore', { url: task });
  assert.equal((await w.send(1, 'complete', { url: base + '/' }, base + '/')).url, task);
  assert.equal((await w.send(1, 'get')).pending, true);
  await w.send(1, 'restore', { url: task });
  assert.equal((await w.send(1, 'restore', { url: task })).blocked, true);
  const newIntent = await w.send(1, 'remember', { url: task, reason: 'click' });
  assert.equal(newIntent.blocked, false);
  assert.equal(newIntent.restores, 0);
  assert.equal((await w.send(1, 'restore', { url: task })).blocked, false);
  const final = await w.send(1, 'complete', { url: task }, task);
  assert.equal(final.url, undefined);
  assert.equal(final.pending, undefined);
  assert.equal(final.lastPage, task);
});

test('tab close removes navigation state and subframes cannot overwrite it', async () => {
  const w = worker();
  await w.api.beforeNavigation({ tabId: 1, frameId: 0, url: task });
  await w.api.beforeNavigation({ tabId: 1, frameId: 3, url: base + '/course/view.php?id=9' });
  assert.equal((await w.send(1, 'get')).url, task);
  w.callbacks.removed(1);
  await w.api.navigationQueue(1, state => state);
  assert.equal(w.storage.plato_navigation_1, undefined);
});

test('student support SSO without a PLATO navigation does not create an intent', async () => {
  const w = worker();
  await w.api.beforeNavigation({tabId:1,frameId:0,url:'https://login.pusan.ac.kr/sso/login'});
  assert.equal(w.storage.plato_navigation_1, undefined);
});
