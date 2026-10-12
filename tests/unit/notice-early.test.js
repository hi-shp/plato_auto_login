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
  const document = { documentElement: { append: node => appended.push(node) },
    createElement: () => (style = { removed: false, remove() { this.removed = true; } }),
    querySelectorAll: () => [] };
  const location = { hostname: 'plato.pusan.ac.kr', pathname: home ? '/' : '/mod/assign/view.php' };
  const window = {};
  window.top = window;
  const context = { window, document, location,
    chrome: { runtime: {}, storage: { local: { get: (_, cb) => { callback = cb; } } } },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    getComputedStyle: () => ({ display: 'block' }) };
  vm.runInNewContext(source, context);
  return { callback, style, appended, timers, guard: window.__platoNoticeEarly };
}

test('home notice is hidden synchronously before storage resolves', () => {
  const result = run(true);
  assert.equal(result.appended.length, 1);
  assert.match(result.style.textContent, /^\.modal-ubboard-notice/);
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

test('failed or missing notice processing releases the temporary rule', () => {
  const result = run(true);
  result.callback({ platoPopupClose: true });
  result.timers[0]();
  assert.equal(result.guard.active, false);
  assert.equal(result.style.removed, true);
});
