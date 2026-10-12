const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CalendarTime = require('../../calendar-time.js');

const source = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');
const base = 'https://plato.pusan.ac.kr';
const course = `${base}/local/ubion/allcourse/regular/index.php`;
const task = `${base}/mod/assign/view.php?id=42&action=view`;

function runPage(url, values = {}, storage = new Map(), options = {}) {
  const target = new URL(url);
  const redirects = [];
  const listeners = {};
  const location = { hostname: target.hostname, pathname: target.pathname,
    origin: target.origin, replace: value => redirects.push(value) };
  Object.defineProperty(location, 'href', {
    get: () => url, set: value => redirects.push(value)
  });
  const window = { location, performance: { getEntriesByType: () => [{ type: options.navigationType || 'navigate' }] } };
  window.top = window;
  const body = { classList: { contains: value => value === (options.loggedIn === false ? 'notloggedin' : 'loggedin') }, dataset: {} };
  const modal = options.sessionModal ? { innerText: '세션 만료', dataset: {},
    querySelector: () => ({ click: () => {} }), querySelectorAll: () => [] } : null;
  const document = { body, title: '',
    querySelector: selector => selector.includes('.alert, .loginerrors') && options.loginError ? { innerText: '아이디 또는 비밀번호가 일치하지 않습니다' } : null,
    querySelectorAll: selector => selector.startsWith('.modal.show') && modal ? [modal] : [],
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

function click(page, href, extra = {}) {
  const link = {
    getAttribute: key => key === 'href' ? href : null,
    hasAttribute: () => false,
    querySelector: () => null, textContent: href === '/' ? '홈' : '활동',
    classList: { contains: () => true }
  };
  page.listeners.click({ isTrusted: true, button: 0, target: { closest: () => link }, ...extra });
}

test('first automatic login without a destination goes to the course page', () => {
  const state = new Map([['plato_auto_login_pending', String(Date.now())]]);
  const page = runPage(`${base}/message/index.php`, {}, state);
  assert.deepEqual(page.redirects, [course]);
  assert.equal(state.has('plato_auto_login_pending'), false);
});

for (const [name, destination] of Object.entries({
  assignment: task,
  VOD: `${base}/mod/vod/view.php?id=8`,
  quiz: `${base}/mod/quiz/view.php?id=9`,
  course: `${base}/course/view.php?id=10`,
  message: `${base}/message/index.php?id=11`
})) {
  test(`explicit ${name} click survives login and an intermediate message page`, () => {
    const state = new Map();
    click(runPage(course, {}, state), destination);
    assert.equal(JSON.parse(state.get('plato_login_intent')).url, destination);
    const login = runPage(destination, { userId: 'fixture', userPw: 'fixture' }, state, { loggedIn: false });
    assert.equal(new URL(login.redirects[0]).searchParams.get('wantsurl'), destination);
    const intermediate = runPage(`${base}/message/index.php`, {}, state);
    assert.deepEqual(intermediate.redirects, [destination]);
    assert.equal(state.has('plato_login_intent'), false);
    assert.deepEqual(runPage(destination, {}, state).redirects, []);
  });
}

test('direct assignment URL is retained through unauthenticated redirect', () => {
  const state = new Map();
  const login = runPage(task, { userId: 'fixture', userPw: 'fixture' }, state, { loggedIn: false });
  assert.equal(new URL(login.redirects[0]).searchParams.get('wantsurl'), task);
  assert.deepEqual(runPage(`${base}/message/index.php`, {}, state).redirects, [task]);
});

test('a relative activity link is resolved against the current page', () => {
  const state = new Map();
  const page = runPage(`${base}/mod/assign/view.php?id=40`, {}, state);
  click(page, '?id=42');
  assert.equal(JSON.parse(state.get('plato_login_intent')).url, `${base}/mod/assign/view.php?id=42`);
});

test('wantsurl from a direct login page is accepted only for PLATO', () => {
  const state = new Map([['plato_auto_login_pending', String(Date.now())]]);
  runPage(`${base}/login/index.php?wantsurl=${encodeURIComponent(task)}`, {}, state, { loggedIn: false });
  assert.deepEqual(runPage(`${base}/message/index.php`, {}, state).redirects, [task]);
});

test('two tabs retain different assignment destinations', () => {
  const first = new Map();
  const second = new Map();
  const other = `${base}/mod/assign/view.php?id=43`;
  click(runPage(course, {}, first), task);
  click(runPage(course, {}, second), other);
  first.set('plato_auto_login_pending', String(Date.now()));
  second.set('plato_auto_login_pending', String(Date.now()));
  assert.deepEqual(runPage(`${base}/message/index.php`, {}, first).redirects, [task]);
  assert.deepEqual(runPage(`${base}/message/index.php`, {}, second).redirects, [other]);
});

test('existing page is restored after session expiry', () => {
  const state = new Map();
  runPage(task, { userId: 'fixture', userPw: 'fixture' }, state, { sessionModal: true });
  assert.equal(JSON.parse(state.get('plato_login_intent')).reason, 'session');
  assert.deepEqual(runPage(`${base}/message/index.php`, {}, state).redirects, [task]);
});

test('a clicked destination outranks the page displaying the session modal', () => {
  const state = new Map();
  click(runPage(course, {}, state), task);
  runPage(`${base}/message/index.php`, { userId: 'fixture', userPw: 'fixture' }, state,
    { sessionModal: true });
  assert.equal(JSON.parse(state.get('plato_login_intent')).url, task);
  assert.deepEqual(runPage(`${base}/message/index.php`, {}, state).redirects, [task]);
});

test('explicit Home click is respected after login and reload returns to course', () => {
  const state = new Map();
  click(runPage(course, {}, state), '/');
  state.set('plato_auto_login_pending', String(Date.now()));
  const intermediate = runPage(`${base}/message/index.php`, {}, state);
  assert.deepEqual(intermediate.redirects, [`${base}/`]);
  assert.equal(state.get('plato_home_clicked_from_course'), '1');
  const home = runPage(`${base}/`, { platoCalendarToggle: true }, state);
  assert.equal(home.redirects.length, 0);
  const reload = runPage(`${base}/`, { platoCalendarToggle: true }, state, { navigationType: 'reload' });
  assert.deepEqual(reload.redirects, [course]);
});

test('normal Home click and normal course navigation are left alone', () => {
  const state = new Map();
  click(runPage(course, {}, state), '/');
  assert.deepEqual(runPage(`${base}/`, { platoCalendarToggle: true }, state).redirects, []);
  assert.deepEqual(runPage(`${base}/course/view.php?id=10`, {}, state).redirects, []);
});

test('login failure does not redirect or consume the destination', () => {
  const state = new Map([['plato_auto_login_pending', String(Date.now())],
    ['plato_login_intent', JSON.stringify({ url: task, reason: 'click', createdAt: Date.now() })]]);
  const page = runPage(`${base}/login/index.php?errorcode=1`, { userId: 'fixture', userPw: 'fixture' }, state,
    { loggedIn: false, loginError: true });
  assert.deepEqual(page.redirects, []);
  assert.equal(JSON.parse(state.get('plato_login_intent')).url, task);
});

test('expired state and external redirect are discarded', () => {
  const expired = new Map([['plato_auto_login_pending', String(Date.now() - 6 * 60 * 1000)],
    ['plato_login_intent', JSON.stringify({ url: task, reason: 'click', createdAt: Date.now() - 6 * 60 * 1000 })]]);
  assert.deepEqual(runPage(`${base}/message/index.php`, {}, expired).redirects, []);
  assert.equal(expired.has('plato_login_intent'), false);
  const unsafe = new Map([['plato_auto_login_pending', String(Date.now())],
    ['plato_login_intent', JSON.stringify({ url: 'https://evil.example/target', reason: 'click', createdAt: Date.now() })]]);
  assert.deepEqual(runPage(`${base}/message/index.php`, {}, unsafe).redirects, [course]);
  const viaWantsurl = new Map([['plato_auto_login_pending', String(Date.now())]]);
  runPage(`${base}/login/index.php?wantsurl=${encodeURIComponent('https://evil.example/target')}`, {}, viaWantsurl,
    { loggedIn: false });
  assert.deepEqual(runPage(`${base}/message/index.php`, {}, viaWantsurl).redirects, [course]);
});

test('modified or background click does not alter this tab intent', () => {
  const state = new Map();
  const page = runPage(course, {}, state);
  click(page, task, { ctrlKey: true });
  assert.equal(state.has('plato_login_intent'), false);
});
