const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CalendarTime = require('../../calendar-time.js');

const source = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function calendar() {
  const button = { disabled: false };
  const location = { hostname: 'fixture.invalid', pathname: '/', origin: 'https://fixture.invalid', href: 'https://fixture.invalid/' };
  const window = { location, performance: { getEntriesByType: () => [] } };
  window.top = window;
  const document = { body: { classList: { contains: () => false }, dataset: {} }, title: '',
    querySelector: selector => selector === '#plato-refresh-btn' ? button : null,
    querySelectorAll: () => [], addEventListener: () => {} };
  const context = { window, document, location, CalendarTime, Date, URL,
    chrome: { runtime: { id: null }, storage: { local: { set: () => {}, get: (_, callback) => callback({}) } } },
    sessionStorage: { getItem: () => null, removeItem: () => {} },
    PlatoNotice: { handle: () => 0 },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout,
    console: { warn: () => {}, error: () => {} },
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [], querySelector: () => null }; } }
  };
  vm.runInNewContext(source, context, { filename: 'content.js' });
  const cal = vm.runInNewContext('PlatoCalendar', context);
  cal.viewYear = 2026;
  cal.viewMonth = 10;
  cal.monthCache = {};
  cal.renderEmptyMonthGrid = () => {};
  cal.setLoading = () => {};
  cal.syncSemesterMonthsInBackground = () => {};
  return { cal, button };
}

test('core calendar renders before slow precise-time requests finish', async () => {
  const { cal, button } = calendar();
  const renders = [];
  let finishDetails;
  cal.fetchCourseStatuses = async () => { await delay(15); return { globalStatusMap: {}, nameStatusMap: {} }; };
  cal.fetchCalendarDoc = async () => { await delay(20); return {}; };
  cal.fetchPreciseTimes = () => new Promise(resolve => { finishDetails = () => {
    cal.timeCache['1'] = { dueAt: '2026-10-12T14:59:00.000Z', fetchedAt: Date.now() };
    resolve(cal.timeCache);
  }; });
  cal.parseCalendarDoc = () => ({ activities: [], days: [], curYear: 2026, curMonth: 10 });
  cal.render = () => renders.push({ enriched: cal.cachedData.timeEnriched, month: cal.cachedData.curMonth });
  const refresh = cal.fetchAndRefreshData();
  await delay(50);
  assert.deepEqual(renders, [{ enriched: false, month: 10 }]);
  assert.equal(button.disabled, false);
  finishDetails();
  await refresh;
  assert.deepEqual(renders.map(item => item.enriched), [false, true]);
});

test('late detail result cannot replace a newly selected month', async () => {
  const { cal } = calendar();
  let finishDetails;
  const renders = [];
  cal.fetchCourseStatuses = async () => ({ globalStatusMap: {}, nameStatusMap: {} });
  cal.fetchCalendarDoc = async () => ({});
  cal.fetchPreciseTimes = () => new Promise(resolve => { finishDetails = () => resolve({}); });
  cal.parseCalendarDoc = (_, year, month) => ({ activities: [], days: [], curYear: year, curMonth: month });
  cal.render = () => renders.push(cal.cachedData.curMonth);
  const refresh = cal.fetchAndRefreshData();
  await delay(10);
  cal.navRequestId++;
  cal.viewMonth = 11;
  finishDetails();
  await refresh;
  assert.deepEqual(renders, [10]);
  assert.equal(cal.viewMonth, 11);
});

test('cached precise times do not cause an unnecessary second render', async () => {
  const { cal } = calendar();
  let renders = 0;
  cal.timeCache['1'] = { dueAt: '2026-10-12T14:59:00.000Z', fetchedAt: Date.now() };
  cal.fetchCourseStatuses = async () => ({ globalStatusMap: {}, nameStatusMap: {} });
  cal.fetchCalendarDoc = async () => ({});
  cal.fetchPreciseTimes = async () => cal.timeCache;
  cal.parseCalendarDoc = () => ({ activities: [], days: [], curYear: 2026, curMonth: 10 });
  cal.render = () => { renders++; };
  await cal.fetchAndRefreshData();
  assert.equal(renders, 1);
  assert.equal(cal.cachedData.timeEnriched, true);
});

test('detail workers fill free slots and overlapping month refreshes share requests', async () => {
  const { cal } = calendar();
  let unblockSlow;
  let active = 0;
  let peak = 0;
  const seen = [];
  let allStarted;
  const started = new Promise(resolve => { allStarted = resolve; });
  const links = Array.from({ length: 9 }, (_, index) => ({ href: `https://plato.pusan.ac.kr/mod/assign/view.php?id=${index + 1}` }));
  const doc = { querySelectorAll: () => links };
  cal.fetchWithTimeout = async href => {
    const id = new URL(href).searchParams.get('id');
    seen.push(id);
    if (seen.length === 9) allStarted();
    peak = Math.max(peak, ++active);
    if (id === '1') await new Promise(resolve => { unblockSlow = resolve; });
    else await delay(5);
    active--;
    return { ok: true, redirected: false, text: async () => '<main></main>' };
  };
  const first = cal.fetchPreciseTimes(doc, { globalStatusMap: {} }, 2026, 10);
  const second = cal.fetchPreciseTimes(doc, { globalStatusMap: {} }, 2026, 10);
  let timer;
  try {
    await Promise.race([started, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('detail workers stalled')), 2000);
    })]);
  } finally { clearTimeout(timer); }
  assert.equal(seen.length, 9);
  assert.equal(peak, 4);
  unblockSlow();
  await Promise.all([first, second]);
  assert.equal(seen.length, 9);
});

test('changed deadline invalidates a fresh detailed-time cache entry', () => {
  const { cal } = calendar();
  cal.timeCache['12'] = { dueAt: '2026-10-12T14:59:00.000Z', fetchedAt: Date.now() };
  cal.invalidateChangedTimes({ globalStatusMap: { '12': { dueAt: '2026-10-13T14:59:00.000Z' } } });
  assert.equal(cal.timeCache['12'], undefined);
});

test('a recent unchanged deadline avoids another detail request', async () => {
  const { cal } = calendar();
  const href = 'https://plato.pusan.ac.kr/mod/assign/view.php?id=12';
  const dueAt = '2026-10-12T14:59:00.000Z';
  cal.timeCache['12'] = { dueAt, fetchedAt: Date.now() };
  let requests = 0;
  cal.fetchWithTimeout = async () => { requests++; throw new Error('should not fetch'); };
  const doc = { querySelectorAll: () => [{ href }] };
  await cal.fetchPreciseTimes(doc, { globalStatusMap: { '12': { dueAt, href } } }, 2026, 10);
  assert.equal(requests, 0);
});

test('one timed-out detail does not prevent the remaining details', async () => {
  const { cal } = calendar();
  const seen = [];
  cal.fetchWithTimeout = async href => {
    const id = new URL(href).searchParams.get('id');
    seen.push(id);
    if (id === '1') throw new Error('AbortError');
    return { ok: true, redirected: false, text: async () => '<main></main>' };
  };
  const doc = { querySelectorAll: () => [1, 2, 3].map(id =>
    ({ href: `https://plato.pusan.ac.kr/mod/assign/view.php?id=${id}` })) };
  await cal.fetchPreciseTimes(doc, { globalStatusMap: {} }, 2026, 10);
  assert.deepEqual(seen.sort(), ['1', '2', '3']);
});

test('an overlapping refresh with a changed deadline starts a new detail request', async () => {
  const { cal } = calendar();
  const href = 'https://plato.pusan.ac.kr/mod/assign/view.php?id=12';
  const doc = { querySelectorAll: () => [{ href }] };
  let releaseFirst;
  let requests = 0;
  cal.fetchWithTimeout = async () => {
    requests++;
    if (requests === 1) await new Promise(resolve => { releaseFirst = resolve; });
    return { ok: true, redirected: false, text: async () => '<main></main>' };
  };
  const first = cal.fetchPreciseTimes(doc, { globalStatusMap: {
    '12': { dueAt: '2026-10-12T14:59:00.000Z', href }
  } }, 2026, 10);
  const second = cal.fetchPreciseTimes(doc, { globalStatusMap: {
    '12': { dueAt: '2026-10-13T14:59:00.000Z', href }
  } }, 2026, 10);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(requests, 2);
});
