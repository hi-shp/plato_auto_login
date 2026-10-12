/* Anonymous, deterministic network-delay comparison. No LMS requests are made. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const CalendarTime = require('../calendar-time.js');

const root = path.join(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const references = [
  ['2026.10.11', 'd5f3a6c'],
  ['2026.10.12 이전', '0da5a627'],
  ['작업본', null]
];

async function measure(label, source) {
  const count = { courses: 0, calendar: 0, details: 0 };
  const renders = [];
  const phases = { loadingMs: null, statusMs: null, calendarMs: null,
    detailMeanMs: null, detailMaxMs: null, parseMs: [], cacheWrites: 0,
    peakDetailRequests: 0, timeouts: 0, background: 'excluded' };
  const detailLatencies = [];
  const detailUrls = [];
  let activeDetails = 0;
  const location = { hostname: 'fixture.invalid', pathname: '/', origin: 'https://fixture.invalid', href: 'https://fixture.invalid/' };
  const window = { location, performance: { getEntriesByType: () => [] } };
  window.top = window;
  const document = { body: { classList: { contains: () => false }, dataset: {} }, title: '',
    querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
  const context = { window, document, location, CalendarTime, Date, URL,
    chrome: { runtime: { id: null }, storage: { local: { set: () => { phases.cacheWrites++; }, get: (_, cb) => cb({}) } } },
    sessionStorage: { getItem: () => null, removeItem: () => {} },
    PlatoNotice: { handle: () => 0 },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout,
    console: { warn: () => {}, error: () => {} },
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [],
      querySelector: selector => selector === '.timeclose' ? { textContent: '2026-10-12 23:59' } : null }; } }
  };
  vm.runInNewContext(source, context, { filename: label + '/content.js' });
  const cal = vm.runInNewContext('PlatoCalendar', context);
  cal.viewYear = 2026;
  cal.viewMonth = 10;
  cal.monthCache = {};
  cal.renderEmptyMonthGrid = () => {};
  cal.setLoading = active => { if (active && phases.loadingMs === null) phases.loadingMs = Math.round(performance.now() - start); };
  cal.syncSemesterMonthsInBackground = () => {};
  const links = Array.from({ length: 12 }, (_, index) =>
    ({ href: `https://plato.pusan.ac.kr/mod/assign/view.php?id=${index + 1}` }));
  cal.fetchCourseStatuses = async () => {
    const begin = performance.now();
    count.courses += 2;
    await delay(80);
    phases.statusMs = Math.round(performance.now() - begin);
    return { globalStatusMap: {}, nameStatusMap: {} };
  };
  cal.fetchCalendarDoc = async () => {
    const begin = performance.now();
    count.calendar++;
    await delay(60);
    phases.calendarMs = Math.round(performance.now() - begin);
    return { querySelectorAll: () => links };
  };
  cal.fetchWithTimeout = async href => {
    const begin = performance.now();
    count.details++;
    detailUrls.push(href);
    phases.peakDetailRequests = Math.max(phases.peakDetailRequests, ++activeDetails);
    await delay(80);
    activeDetails--;
    detailLatencies.push(Math.round(performance.now() - begin));
    return { ok: true, redirected: false, text: async () => '<main></main>' };
  };
  cal.parseCalendarDoc = () => {
    const begin = performance.now();
    const data = { curYear: 2026, curMonth: 10, days: [], activities: [] };
    phases.parseMs.push(Math.round(performance.now() - begin));
    return data;
  };
  let start = performance.now();
  cal.render = () => renders.push(Math.round(performance.now() - start));
  await cal.fetchAndRefreshData();
  const firstRenders = [...renders];
  const firstFinalMs = Math.round(performance.now() - start);
  const firstRequests = { ...count };
  const originalRefresh = cal.fetchAndRefreshData;
  cal.fetchAndRefreshData = function () {
    this.benchmarkRefresh = originalRefresh.call(this);
    return this.benchmarkRefresh;
  };
  renders.length = 0;
  start = performance.now();
  cal.handleManualRefresh();
  await cal.benchmarkRefresh;
  const repeatFinalMs = Math.round(performance.now() - start);
  const repeatRequests = Object.fromEntries(Object.entries(count).map(([key, value]) => [key, value - firstRequests[key]]));
  phases.detailMeanMs = detailLatencies.length ? Math.round(detailLatencies.reduce((a, b) => a + b, 0) / detailLatencies.length) : 0;
  phases.detailMaxMs = Math.max(0, ...detailLatencies);
  return { label, firstRenderMs: firstRenders[0] ?? null, finalMs: firstFinalMs,
    renderTimesMs: firstRenders, requests: firstRequests,
    totalRequests: Object.values(firstRequests).reduce((a, b) => a + b, 0),
    repeatFirstRenderMs: renders[0] ?? null, repeatFinalMs, repeatRequests,
    duplicateDetailRequests: detailUrls.length - new Set(detailUrls).size, phases };
}

(async () => {
  for (const [label, ref] of references) {
    let source;
    try {
      source = ref ? execFileSync('git', ['show', `${ref}:content.js`], { cwd: root, encoding: 'utf8' })
        : fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    } catch (error) {
      console.log(JSON.stringify({ label, skipped: 'Git reference unavailable' }));
      continue;
    }
    const trials = [];
    for (let i = 0; i < 3; i++) trials.push(await measure(label, source));
    const middle = values => values.sort((a, b) => a - b)[1];
    console.log(JSON.stringify({ ...trials[0], firstRenderMs: middle(trials.map(t => t.firstRenderMs)),
      finalMs: middle(trials.map(t => t.finalMs)),
      repeatFirstRenderMs: middle(trials.map(t => t.repeatFirstRenderMs)),
      repeatFinalMs: middle(trials.map(t => t.repeatFinalMs)),
      model: '2 status requests at 80 ms, 1 calendar at 60 ms, 12 detail pages at 80 ms each; network mocked, background months excluded' }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
