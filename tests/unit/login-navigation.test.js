const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CalendarTime = require('../../calendar-time.js');

const source = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');
const course = 'https://plato.pusan.ac.kr/local/ubion/allcourse/regular/index.php';

function runPage(url, values = {}, storage = new Map(), navigationType = 'navigate') {
  const target = new URL(url);
  const redirects = [];
  const listeners = {};
  const location = { hostname: target.hostname, pathname: target.pathname,
    href: url, origin: target.origin, replace: value => redirects.push(value) };
  const window = { location, performance: { getEntriesByType: () => [{ type: navigationType }] } };
  window.top = window;
  const body = { classList: { contains: value => value === 'loggedin' }, dataset: {} };
  const document = { body, title: '', querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (type, callback) => { listeners[type] = callback; } };
  const context = { window, document, location, CalendarTime,
    PlatoNotice: { handle: () => 0 }, sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    chrome: { runtime: { id: 'fixture' }, storage: { local: { get: (_, callback) => callback({
      popupToggle: true, platoCalendarToggle: false, ...values
    }) } } },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {},
    console: { warn: () => {} }, Date, URL
  };
  vm.runInNewContext(source, context, { filename: 'content.js' });
  return { redirects, listeners, storage };
}

test('successful auto login leaves a message page for the course page', () => {
  const state = new Map([['plato_auto_login_pending', String(Date.now())]]);
  const page = runPage('https://plato.pusan.ac.kr/message/index.php', {}, state);
  assert.deepEqual(page.redirects, [course]);
});

test('explicit Home click from the course is respected once', () => {
  const state = new Map();
  const origin = runPage(course, {}, state);
  origin.listeners.click({ target: { closest: () => ({getAttribute: () => '/',
    querySelector: () => null, textContent: '홈', classList: {contains: () => true}}) } });
  assert.equal(state.get('plato_home_clicked_from_course'), '1');
  const home = runPage('https://plato.pusan.ac.kr/', {platoCalendarToggle: true}, state);
  assert.equal(home.redirects.length, 0);
  assert.equal(state.has('plato_home_clicked_from_course'), false);
  const reload = runPage('https://plato.pusan.ac.kr/', {platoCalendarToggle: true}, state, 'reload');
  assert.deepEqual(reload.redirects, [course]);
});

test('expired login marker is discarded', () => {
  const state = new Map([['plato_auto_login_pending', String(Date.now() - 6 * 60 * 1000)]]);
  const page = runPage('https://plato.pusan.ac.kr/message/index.php', {}, state);
  assert.equal(page.redirects.length, 0);
  assert.equal(state.has('plato_auto_login_pending'), false);
});
