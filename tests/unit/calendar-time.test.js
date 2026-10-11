const test = require('node:test');
const assert = require('node:assert/strict');
const CalendarTime = require('../../calendar-time.js');

const parse = text => CalendarTime.parse(text);
const item = (text, completed = false) => {
  const point = parse(text);
  return { title: text, type: '과제', isCompleted: completed,
    dueAt: point?.at || null, timePrecision: point?.precision || null,
    dueYear: point?.year, dueMonth: point?.month, dueDay: point?.day };
};

test('minute and second precision stay distinct at the same date', () => {
  const a = item('2026-10-12 23:55');
  const b = item('2026-10-12 23:59');
  const c = item('2026-10-12 23:59:59');
  assert.deepEqual([a, b, c].sort(CalendarTime.compare), [a, b, c]);
  assert.match(CalendarTime.formatPeriod(a, 2026, 10), /23:55$/);
  assert.match(CalendarTime.formatPeriod(b, 2026, 10), /23:59$/);
  assert.match(CalendarTime.formatPeriod(c, 2026, 10), /23:59:59$/);
});

test('00:00 and 24:00 normalize to the following day', () => {
  const a = parse('2026-10-12 24:00');
  const b = parse('2026-10-13 00:00');
  assert.equal(a.at, b.at);
  assert.deepEqual([a.year, a.month, a.day], [2026, 10, 13]);
  assert.equal(parse('2026-10-12 24:01'), null);
  assert.equal(parse('2026-10-12 24:00:01'), null);
});

test('month and year boundary, leap day, invalid dates', () => {
  assert.deepEqual(CalendarTime.seoulParts(parse('2026-10-31 24:00').at).month, 11);
  assert.deepEqual(CalendarTime.seoulParts(parse('2026-12-31 24:00').at).year, 2027);
  assert.equal(parse('2028-02-29 23:59:59')?.day, 29);
  assert.equal(parse('2027-02-29 23:59:59'), null);
});

test('a course period crossing midnight keeps both endpoints', () => {
  const points = CalendarTime.parseAll('2026-10-12 23:55:00 ~ 2026-10-13 00:00:00');
  assert.equal(points.length, 2);
  const course = { startAt: points[0].at, dueAt: points[1].at,
    startTimePrecision: points[0].precision, timePrecision: points[1].precision };
  assert.match(CalendarTime.formatPeriod(course, 2026, 10), /12일\(월\) 23:55:00 ~ 10월 13일\(화\) 00:00:00/);
});

test('actual instant determines overdue, while completed stays completed', () => {
  const now = Date.parse('2026-10-12T14:56:00Z'); // Seoul 23:56
  const passed = CalendarTime.applyStatus(item('2026-10-12 23:55'), 2026, 10, now);
  const pending = CalendarTime.applyStatus(item('2026-10-12 23:59'), 2026, 10, now);
  const tomorrow = CalendarTime.applyStatus(item('2026-10-13 00:00'), 2026, 10, now);
  const done = CalendarTime.applyStatus(item('2026-10-12 23:55', true), 2026, 10, now);
  assert.equal(passed.statusType, 'passed');
  assert.equal(pending.statusType, 'pending');
  assert.equal(tomorrow.dDayText, 'D-1');
  assert.equal(done.statusType, 'done');
  assert.equal(done.dDayText, '');
});

test('date-only cache does not invent a deadline time', () => {
  const cached = { curYear: 2026, curMonth: 10, days: [{ day: 12, events: [] }],
    activities: [{ title: 'old cache', dueDay: 12, isCompleted: false }] };
  CalendarTime.refreshData(cached);
  assert.match(cached.activities[0].periodText, /마감 시각 확인 불가/);
  assert.equal(cached.dayDueActivitiesMap[12].length, 1);
  assert.equal(cached.days[0].events.length, 1);
  const restored = JSON.parse(JSON.stringify(cached));
  CalendarTime.refreshData(restored);
  assert.match(restored.activities[0].periodText, /마감 시각 확인 불가/);
});

test('no date is reported as no deadline', () => {
  assert.equal(CalendarTime.formatPeriod({}, 2026, 10), '기한 없음');
});

test('Seoul conversion is independent of host local time', () => {
  assert.equal(parse('2026/10/12 23:59').at, '2026-10-12T14:59:00.000Z');
  assert.equal(parse('2026년 10월 12일 23:59:59').precision, 'second');
  assert.equal(parse('수요일, 14 10월 2026, 11:59 PM').at, '2026-10-14T14:59:00.000Z');
});
