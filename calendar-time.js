/* Shared Seoul-time deadline handling for PLATO and BBITS calendars. */
const CalendarTime = {
  offsetMs: 9 * 60 * 60 * 1000,
  weekdays: ['일', '월', '화', '수', '목', '금', '토'],
  dateTimePattern: /(\d{4})\s*(?:[-/.]|년)\s*(\d{1,2})\s*(?:[-/.]|월)\s*(\d{1,2})\s*일?\s*(?:\([^)]+\)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/g,

  parseAll(text) {
    if (!text) return [];
    const found = [];
    for (const match of String(text).matchAll(this.dateTimePattern)) {
      const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
      const second = match[6] === undefined ? 0 : Number(match[6]);
      const originalDate = new Date(Date.UTC(year, month - 1, day));
      if (year < 1000 || month < 1 || month > 12 || day < 1 ||
          originalDate.getUTCFullYear() !== year || originalDate.getUTCMonth() + 1 !== month || originalDate.getUTCDate() !== day ||
          hour > 24 || minute > 59 || second > 59 || (hour === 24 && (minute !== 0 || second !== 0))) continue;
      const wallTime = Date.UTC(year, month - 1, day, hour, minute, second);
      const normalized = new Date(wallTime);
      found.push({
        at: new Date(wallTime - this.offsetMs).toISOString(),
        precision: match[6] === undefined ? 'minute' : 'second',
        original: match[0].trim(),
        year: normalized.getUTCFullYear(),
        month: normalized.getUTCMonth() + 1,
        day: normalized.getUTCDate()
      });
    }
    return found;
  },

  parse(text) {
    const direct = this.parseAll(text)[0];
    if (direct) return direct;
    const reordered = String(text || '').match(/(\d{1,2})\s*(\d{1,2})월\s*(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!reordered) return null;
    const [, day, month, year, hour, minute, period] = reordered;
    const hour24 = Number(hour) % 12 + (period.toUpperCase() === 'PM' ? 12 : 0);
    if (Number(hour) < 1 || Number(hour) > 12) return null;
    const point = this.parseAll(`${year}-${month}-${day} ${hour24}:${minute}`)[0];
    return point ? { ...point, original: reordered[0] } : null;
  },

  seoulParts(at) {
    const date = new Date(Date.parse(at) + this.offsetMs);
    return {
      year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
      hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(),
      weekday: this.weekdays[date.getUTCDay()]
    };
  },

  todayParts(now = Date.now()) {
    const date = new Date(now + this.offsetMs);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  },

  formatPoint(at, precision = 'minute', showYear = false) {
    const p = this.seoulParts(at);
    const pad = n => String(n).padStart(2, '0');
    const seconds = precision === 'second' ? `:${pad(p.second)}` : '';
    return `${showYear ? `${p.year}년 ` : ''}${p.month}월 ${p.day}일(${p.weekday}) ${pad(p.hour)}:${pad(p.minute)}${seconds}`;
  },

  formatPeriod(item, viewYear, viewMonth) {
    if (item.dueAt) {
      if (item.startAt) {
        const start = this.seoulParts(item.startAt);
        const end = this.seoulParts(item.dueAt);
        const showYear = start.year !== end.year;
        return `수강 기간: ${this.formatPoint(item.startAt, item.startTimePrecision || 'minute', showYear)} ~ ${this.formatPoint(item.dueAt, item.timePrecision || 'minute', showYear)}`;
      }
      return `마감: ${this.formatPoint(item.dueAt, item.timePrecision || 'minute', item.dueYear !== viewYear)}`;
    }
    if (item.dueDay) {
      const year = item.dueYear || viewYear;
      const month = item.dueMonth || viewMonth;
      const weekday = this.weekdays[new Date(Date.UTC(year, month - 1, item.dueDay)).getUTCDay()];
      return `마감: ${month}월 ${item.dueDay}일(${weekday}) · 마감 시각 확인 불가`;
    }
    return '기한 없음';
  },

  applyStatus(item, viewYear, viewMonth, now = Date.now()) {
    if (item.dueAt) {
      const p = this.seoulParts(item.dueAt);
      item.dueYear = p.year; item.dueMonth = p.month; item.dueDay = p.day;
    }
    const today = this.todayParts(now);
    const dueYear = item.dueYear || viewYear;
    const dueMonth = item.dueMonth || viewMonth;
    const dueDay = item.dueDay;
    const diff = dueDay
      ? Math.round((Date.UTC(dueYear, dueMonth - 1, dueDay) - Date.UTC(today.year, today.month - 1, today.day)) / 86400000)
      : null;
    item.dDayDiff = diff;
    if (item.isCompleted) {
      item.statusType = 'done'; item.statusLabel = '완료'; item.dDayText = '';
    } else if (diff !== null && (diff < 0 || (item.dueAt && now >= Date.parse(item.dueAt)))) {
      item.statusType = 'passed'; item.statusLabel = '기한 지남';
      item.dDayText = diff < 0 ? `${Math.abs(diff)}일 전 마감` : '기한 지남';
    } else if (diff === 0) {
      item.statusType = 'pending'; item.statusLabel = '오늘 마감'; item.dDayText = '오늘 마감';
    } else if (diff === 1) {
      item.statusType = 'pending'; item.statusLabel = 'D-1'; item.dDayText = 'D-1';
    } else {
      item.statusType = 'pending'; item.statusLabel = diff === null ? '미완료' : '미완료';
      item.dDayText = diff === null ? '' : `D-${diff}`;
    }
    item.periodText = this.formatPeriod(item, viewYear, viewMonth);
    return item;
  },

  compare(a, b) {
    const rank = { pending: 1, passed: 2, done: 3 };
    const status = (rank[a.statusType] || 4) - (rank[b.statusType] || 4);
    if (status) return status;
    const aTime = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
    const bTime = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    if (a.dueDay !== b.dueDay) return (a.dueDay || 0) - (b.dueDay || 0);
    const typeRank = { '과제': 1, '퀴즈': 2, '강의': 3, '활동': 4 };
    const type = (typeRank[a.type] || 5) - (typeRank[b.type] || 5);
    return type || (a.title || '').localeCompare(b.title || '');
  },

  refreshData(data) {
    if (!data || !Array.isArray(data.activities)) return data;
    const map = {};
    data.activities = data.activities.filter(item => {
      this.applyStatus(item, data.curYear, data.curMonth);
      return !item.dueAt || (item.dueYear === data.curYear && item.dueMonth === data.curMonth);
    });
    data.activities.forEach(item => {
      if (!item.dueDay) return;
      (map[item.dueDay] ||= []).push(item);
    });
    Object.values(map).forEach(items => items.sort(this.compare));
    data.dayDueActivitiesMap = map;
    (data.days || []).forEach(day => { day.events = map[day.day] || []; });
    return data;
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = CalendarTime;
