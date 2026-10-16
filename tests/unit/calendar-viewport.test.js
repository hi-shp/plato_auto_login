const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../content.js'), 'utf8').split('const ensureMonthGridData')[0];

function fixture({ type = 'reload', saved, hash = '', search = '', discarded = false } = {}) {
  const frames = [], timers = new Map(), listeners = new Map();
  const store = new Map();
  if (saved !== undefined) store.set('plato_calendar_viewport', typeof saved === 'string' ? saved : JSON.stringify(saved));
  const listen = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
  const unlisten = (name, fn) => listeners.get(name)?.delete(fn);
  const window = { scrollX: 0, scrollY: 100, addEventListener: listen, removeEventListener: unlisten,
    scrollTo({left, top}) { this.scrollX = left; this.scrollY = top; } };
  const document = { readyState: 'complete', wasDiscarded: discarded, hidden: false,
    addEventListener: listen, removeEventListener: unlisten };
  const context = { window, document, Date, Map, URLSearchParams,
    performance: { getEntriesByType: () => [{ type }] }, location: { pathname: '/course', search, hash },
    sessionStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
    requestAnimationFrame: fn => frames.push(fn), setTimeout: fn => { const key = {}; timers.set(key, fn); return key; },
    clearTimeout: key => timers.delete(key) };
  vm.createContext(context);
  vm.runInContext(source, context);
  const mount = () => vm.runInContext("prepareCalendarViewport('plato')", context);
  const emit = (type, fields = {}) => [...(listeners.get(type) || [])].forEach(fn => fn({ type, ...fields }));
  const flush = () => { while (frames.length) frames.shift()(); };
  return { window, document, store, mount, emit, flush, listeners };
}
const checkpoint = (fields = {}) => ({ page: '/course', x: 0, y: 2500, at: Date.now(), ...fields });

test('same-page reload and discarded tab restore once after the initial layout', () => {
  for (const options of [{type:'reload'}, {type:'back_forward'}, {type:'navigate',discarded:true}]) {
    const f = fixture({ ...options, saved: checkpoint() });
    f.mount()();
    assert.equal(f.window.scrollY, 100);
    f.flush();
    assert.equal(f.window.scrollY, 2500);
    f.window.scrollY = 700;
    f.emit('pagehide');
    assert.equal(JSON.parse(f.store.get('plato_calendar_viewport')).y, 700);
  }
});

test('new requests, different query, stale/corrupt checkpoints and fragments are not restored', () => {
  for (const options of [
    {type:'navigate',saved:checkpoint()}, {saved:checkpoint({page:'/other'})},
    {search:'?id=2',saved:checkpoint()}, {saved:checkpoint({at:Date.now()-86400001})},
    {saved:checkpoint({at:Date.now()+60000})}, {saved:checkpoint({y:-1})},
    {saved:'bad json'}, {saved:checkpoint(),hash:'#intro'},
    {saved:checkpoint(),search:'?sesskey=fixture-only'}
  ]) {
    const f = fixture(options);
    f.mount()?.();
    f.flush();
    assert.equal(f.window.scrollY, 100);
  }
});

test('trusted scroll input cancels deferred restoration; unrelated key does not', () => {
  for (const type of ['wheel','touchstart','pointerdown','keydown']) {
    const f = fixture({ saved: checkpoint() });
    f.mount()();
    f.emit(type, { isTrusted: true, key: 'PageDown' });
    f.window.scrollY = 800;
    f.flush();
    assert.equal(f.window.scrollY, 800);
  }
  const f = fixture({ saved: checkpoint() });
  f.mount()(); f.emit('keydown', {isTrusted:true,key:'a'}); f.flush();
  assert.equal(f.window.scrollY, 2500);
});

test('remount removes previous viewport listeners', () => {
  const f = fixture();
  f.mount()(); f.flush();
  f.mount()(); f.flush();
  assert.equal(f.listeners.get('scroll').size, 1);
  assert.equal(f.listeners.get('pagehide').size, 1);
  assert.equal(f.listeners.get('visibilitychange').size, 1);
});
