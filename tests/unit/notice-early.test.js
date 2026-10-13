const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../notice-early.js'), 'utf8');

function run(enabled, home = true) {
  let callback;
  let style;
  const appended = [];
  const timers = [];
  const events = {};
  let onChange;
  const document = { readyState: 'loading', documentElement: { append: node => { node.isConnected = true; appended.push(node); } },
    createElement: () => (style = { isConnected: false, removed: false, remove() { this.removed = true; this.isConnected = false; } }),
    querySelectorAll: () => [] };
  const location = { hostname: 'plato.pusan.ac.kr', pathname: home ? '/' : '/mod/assign/view.php' };
  const window = { addEventListener: (name, callback) => { events[name] = callback; } };
  window.top = window;
  const context = { window, document, location,
    chrome: { runtime: {}, storage: { local: { get: (_, cb) => { callback = cb; } },
      onChanged: { addListener: cb => { onChange = cb; }, removeListener: () => {} } } },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    getComputedStyle: () => ({ display: 'block' }) };
  vm.runInNewContext(source, context);
  return { callback, style, appended, timers, events, onChange, guard: window.__platoNoticeEarly };
}

test('home notice is hidden synchronously before storage resolves', () => {
  const result = run(true);
  assert.equal(result.appended.length, 1);
  assert.match(result.style.textContent, /^\.ubboard-popup \.modal-ubboard-notice/);
  assert.match(result.style.textContent, /:not\(:has\(form/);
  assert.doesNotMatch(result.style.textContent, /(?:^|\s)\.modal\s*\{/);
  assert.equal(result.guard.active, true);
  result.callback({ platoPopupClose: true });
  assert.equal(result.guard.enabled, true);
});

test('disabled setting and non-home pages do not retain a hiding rule', () => {
  const disabled = run(false);
  disabled.callback({ platoPopupClose: false });
  assert.equal(disabled.style.removed, true);
  const otherPage = run(true, false);
  assert.equal(otherPage.appended.length, 0);
});

test('healthy controller retains filtering after load and after the old 12-second limit', () => {
  const result = run(true);
  result.callback({ platoPopupClose: true });
  result.guard.controllerReady = true;
  result.events.load();
  result.timers.at(-1)();
  assert.equal(result.guard.active, true);
});

test('missing companion fails open after load; setting toggles restore and release filtering', () => {
  const result = run(true);
  result.callback({ platoPopupClose: true });
  result.events.load();
  result.timers.at(-1)();
  assert.equal(result.guard.active, false);
  assert.equal(result.style.removed, true);
  result.onChange({ platoPopupClose: { newValue: true } }, 'local');
  assert.equal(result.guard.active, true);
  result.onChange({ platoPopupClose: { newValue: false } }, 'local');
  assert.equal(result.guard.active, false);
});

test('unavailable settings fail open', () => {
  const result = run(true);
  result.timers[0]();
  assert.equal(result.guard.active, false);
});
