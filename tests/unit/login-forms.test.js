const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');

function field() {
  return { value: '', dataset: {}, events: [], dispatchEvent(event) { this.events.push(event.type); } };
}

function button() {
  return { dataset: {}, disabled: false, clicks: 0, click() { this.clicks++; } };
}

function page(url, settings, selectors, classes = []) {
  const target = new URL(url);
  const timers = [];
  const session = new Map();
  const location = { hostname: target.hostname, pathname: target.pathname, href: url,
    origin: target.origin, replace: () => {} };
  const window = { location, performance: { getEntriesByType: () => [] }, dispatchEvent() {} };
  window.top = window;
  const document = {
    title: '', body: { dataset: {}, classList: { contains: value => classes.includes(value) } },
    querySelector: selector => selectors[selector] || null,
    querySelectorAll: () => [], addEventListener() {}
  };
  const context = vm.createContext({ window, location, document, URL, Date,
    Event: class { constructor(type) { this.type = type; } },
    CalendarTime: {}, PlatoNotice: { handle: () => 0 },
    chrome: { runtime: { id: 'fixture' }, storage: { local: {
      get: (_, callback) => callback(settings)
    } } },
    sessionStorage: { getItem: key => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, console: { warn() {} }
  });
  vm.runInContext(source, context, { filename: 'content.js' });
  return { context, timers, session };
}

test('PLATO fills and submits once, while wrong-password notice prevents retry', () => {
  const user = field(), password = field(), submit = button();
  const form = { dataset: {}, querySelector: selector =>
    selector.includes('username') ? user : selector.includes('password') ? password : submit };
  const selectors = { '#form-login-sso': form };
  const state = page('https://plato.pusan.ac.kr/login/index.php',
    { popupToggle: true, userId: 'fixture-user', userPw: 'fixture-password' }, selectors,
    ['notloggedin']);
  assert.equal(user.value, 'fixture-user');
  assert.equal(password.value, 'fixture-password');
  assert.equal(state.session.has('plato_auto_login_pending'), true);
  vm.runInContext('attemptLogin()', state.context);
  state.timers.forEach(fn => fn());
  assert.equal(submit.clicks, 1);
  assert.equal(form.dataset.autoLoggingIn, '1');

  const bad = button();
  const wrong = page('https://plato.pusan.ac.kr/login/index.php',
    { popupToggle: true, userId: 'fixture-user', userPw: 'fixture-password' },
    { '#form-login-sso': { dataset: {}, querySelector: () => bad },
      '.alert, .loginerrors, #notice, .notifyproblem': { innerText: 'invalid password' } },
    ['notloggedin']);
  assert.equal(wrong.timers.length, 0);
  assert.equal(bad.clicks, 0);
});

test('BBITS LMS selects university and submits only once', () => {
  const user = field(), password = field(), submit = button();
  const university = { value: '', options: [{ text: '부산대학교', value: 'PNU' }],
    dispatchEvent() {} };
  const selectors = {
    'select#univid, select[name="univid"]': university,
    'input#username, form.form-login input[name="username"]': user,
    'input#password, form.form-login input[name="password"]': password,
    'button.main_login_btn, form.form-login button[type="submit"]': submit
  };
  const state = page('https://lms.bbits.ac.kr/login.php',
    { bbitsToggle: true, bbitsId: 'fixture-user', bbitsPw: 'fixture-password' }, selectors);
  assert.equal(university.value, 'PNU');
  assert.equal(user.value, 'fixture-user');
  assert.equal(password.value, 'fixture-password');
  vm.runInContext('attemptLogin()', state.context);
  state.timers.forEach(fn => fn());
  assert.equal(submit.clicks, 1);
});

test('student support login uses stored fields once', () => {
  const user = field(), password = field(), submit = button();
  const state = page('https://login.pusan.ac.kr/login',
    { hjsToggle: true, hjsId: 'fixture-user', hjsPw: 'fixture-password' },
    { '#btnLogin': submit, '#login_id': user, '#login_pw': password });
  assert.equal(user.value, 'fixture-user');
  assert.equal(password.value, 'fixture-password');
  vm.runInContext('attemptLogin()', state.context);
  assert.equal(submit.clicks, 1);
});
