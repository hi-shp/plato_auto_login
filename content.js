/* ==========================================================================
   PLATO CLEAN CALENDAR & DASHBOARD ENGINE (MINIMALIST & FIXED GRID)
   ========================================================================== */
const PlatoCalendar = {
  selectedDay: null,
  cachedData: null,
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth() + 1,
  monthCache: {},
  cachedStatusMap: null,
  cachedNameStatusMap: null,
  cachedCourses: null,
  navRequestId: 0,

  WEEKDAYS_KO: ['일', '월', '화', '수', '목', '금', '토'],

  cleanCourseName(rawName) {
    if (!rawName) return '교과과정';
    let clean = rawName.replace(/^[0-9]+년\s+[0-9]+학기\s+교과과정\s+학부\s*/, '');
    clean = clean.replace(/\[?교과\]?\s*[-–:]?\s*/gi, '');
    clean = clean.replace(/\[?\d{4}[-~_]\d{1,2}학기\]?\s*[-–:]?\s*/g, '');
    clean = clean.replace(/\d{4}년\s*\d{1,2}학기\s*/g, '');
    clean = clean.replace(/\[(교과|학부|전공|교양)\]\s*[-–:]?\s*/gi, '');
    clean = clean.replace(/\bNEW\b/g, '');
    // 성 이름 중복 패턴 해결 (예: "권 권용인" -> "권용인", "신 신윤호" -> "신윤호", "박 박현" -> "박현", "이 이인원" -> "이인원")
    clean = clean.replace(/([가-힣]{1,2})\s+\1([가-힣]+)/g, '$1$2');
    return clean.replace(/\s+/g, ' ').trim();
  },

  getWeekdayStr(year, month, day) {
    if (!day) return '';
    const d = new Date(year, month - 1, day);
    return this.WEEKDAYS_KO[d.getDay()] || '';
  },

  formatPeriodText(parsedPeriod, year, month, startDay, dueDay) {
    if (parsedPeriod) {
      return parsedPeriod.replace(/(\d{1,2})월\s*(\d{1,2})일/g, (match, m, d) => {
        const mNum = parseInt(m, 10);
        const dNum = parseInt(d, 10);
        const w = this.getWeekdayStr(year, mNum, dNum);
        return `${mNum}월 ${dNum}일(${w})`;
      });
    }

    if (startDay && startDay !== dueDay) {
      const startW = this.getWeekdayStr(year, month, startDay);
      const dueW = this.getWeekdayStr(year, month, dueDay);
      return `${month}월 ${startDay}일(${startW}) ~ ${month}월 ${dueDay}일(${dueW})`;
    } else {
      const dueW = this.getWeekdayStr(year, month, dueDay);
      return `${month}월 ${dueDay}일(${dueW}) 마감`;
    }
  },

  checkIsCompleted(statusText, trElement) {
    const text = (statusText || trElement?.innerText || '').trim();
    if (!text) return false;

    // 1. 명백한 미완료/부정 키워드 우선 체크 -> 무조건 false (기존 "미완료".includes("완료") 버그 원천 해결)
    if (/미완료|미제출|미학습|미응시|미수강|결석|진행중|학습전|학습\s*전|미달|부족/.test(text)) {
      return false;
    }

    // 2. 결석/X 표시 체크 (단독 X 또는 결석 X)
    if (/\bX\b|[\u2715\u2716\u274C]/.test(text) && !/[O\u2B55]/.test(text)) {
      return false;
    }

    // 3. 진도율 체크 (예: 0%, 50%, 80% 등 100% 미만이면 미완료)
    const percentMatch = text.match(/(\d{1,3})\s*%/);
    if (percentMatch) {
      const pct = parseInt(percentMatch[1], 10);
      if (pct < 100) return false;
      if (pct >= 100) return true;
    }

    // 4. 완료/출석/제출 긍정 키워드 체크
    if (/제출\s*완료|학습\s*완료|응시\s*완료|출석|출석인정/.test(text)) {
      return true;
    }
    // "미"가 앞에 붙지 않은 순수 "완료"
    if (/(?:^|[^미])완료/.test(text)) {
      return true;
    }
    // 출석 인정 O 표시
    if (/\bO\b|[O⭕]/.test(text)) {
      return true;
    }

    // 5. DOM 클래스 체크 (녹색 성공 클래스 또는 빨간색 실패 클래스)
    if (trElement) {
      if (trElement.querySelector('.text-danger, .label-danger, .badge-danger, .danger')) {
        return false;
      }
      if (trElement.querySelector('.text-success, .label-success, .badge-success, .success, [src*="completion-auto-y"], [src*="completion-manual-y"]')) {
        return true;
      }
    }

    return false;
  },

  init() {
    if (window !== window.top) return;
    const path = window.location.pathname;
    if (!path.includes('/local/ubion/allcourse/regular/index.php') && !path.includes('/local/ubion/allcourse/')) return;

    // 팝업 설정(platoCalendarToggle) 확인 (기본값: true)
    chrome.storage.local.get(['platoCalendarToggle'], (res) => {
      if (res.platoCalendarToggle === false) return; // 캘린더 기능 OFF 설정 시 미표시

      // 중복 삽입 방지
      if (document.querySelector('#plato-calendar-widget')) return;

      this.mountWidgetSkeleton();
      this.loadCachedData();
    });

    // 팝업에서 실시간 온오프 토글 시 즉시 동적 반영
    if (!this._storageListenerRegistered) {
      this._storageListenerRegistered = true;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.platoCalendarToggle) {
          if (changes.platoCalendarToggle.newValue === false) {
            document.querySelector('#plato-calendar-widget')?.remove();
          } else {
            if (!document.querySelector('#plato-calendar-widget')) {
              this.mountWidgetSkeleton();
              this.loadCachedData();
            }
          }
        }
      });
    }
  },

  mountWidgetSkeleton() {
    const target = document.querySelector('.open-content') ||
                   document.querySelector('#region-main .allcourse-list')?.parentElement ||
                   document.querySelector('#region-main') ||
                   document.querySelector('#page-content');
    if (!target) {
      if (!this._mountRetries) this._mountRetries = 0;
      if (this._mountRetries < 30) {
        this._mountRetries++;
        setTimeout(() => {
          if (!document.querySelector('#plato-calendar-widget')) {
            this.mountWidgetSkeleton();
            this.loadCachedData();
          }
        }, 100);
      }
      return;
    }
    this._mountRetries = 0;

    const now = new Date();
    const defaultYear = now.getFullYear();
    const defaultMonth = now.getMonth() + 1;

    const widget = document.createElement('div');
    widget.id = 'plato-calendar-widget';
    widget.innerHTML = `
      <!-- 1. 맨 위 상단 헤더 바 -->
      <div class="plato-cal-top-bar" id="plato-cal-top-bar">
        <div class="plato-top-bar-left">
          <span class="plato-cal-brand-title" id="plato-cal-brand-title" title="달력 접기/펼치기">플라토 캘린더</span>
          <button type="button" class="plato-cal-toggle-btn" id="plato-cal-toggle-btn" title="달력 접기" aria-label="달력 접기/펼치기">
            <svg class="plato-toggle-triangle" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
              <path d="M12 8l6 8H6l6-8z"/>
            </svg>
          </button>
        </div>
        <div class="plato-top-bar-right">
          <button type="button" class="plato-refresh-btn" id="plato-refresh-btn" title="일정 새로고침">
            <svg class="plato-btn-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px;">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span id="plato-refresh-text">새로고침</span>
          </button>
        </div>
      </div>

      <!-- 2. 접히는 전체 영역 (월별 헤더, 그리드, 상세 패널) -->
      <div class="plato-cal-collapsible-body" id="plato-cal-collapsible-body">
        <div class="plato-cal-month-header">
          <div class="plato-cal-month-nav-container">
            <button type="button" class="plato-cal-month-nav-btn prev" id="plato-cal-prev-btn" title="이전 달">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <div class="plato-cal-month-title-wrap">
              <span class="plato-cal-year" id="plato-cal-year-text">${defaultYear}년</span>
              <h2 class="plato-cal-month" id="plato-cal-month-text">${defaultMonth}월</h2>
            </div>
            <button type="button" class="plato-cal-month-nav-btn next" id="plato-cal-next-btn" title="다음 달">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>

        <!-- 고정 7열 대형 월간 캘린더 그리드 -->
        <div class="plato-cal-grid-card" id="plato-cal-grid-card">
          <div class="plato-cal-weekdays">
            <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
          </div>
          <div class="plato-large-days-grid" id="plato-large-days-grid">
            <!-- 일자 셀들이 여기에 렌더링됨 -->
          </div>

          <!-- 갱신/동기화 중 상태 오버레이 (가볍고 미니멀한 인디케이터) -->
          <div class="plato-cal-loading-overlay" id="plato-cal-loading-overlay">
            <div class="plato-loading-bar"></div>
            <div class="plato-loading-dots" title="일정 갱신 중">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>

        <!-- 클릭 시 나타나는 특정 날짜 상세 활동 패널 (기본 숨김: 날짜 클릭 시 노출) -->
        <div class="plato-cal-detail-panel" id="plato-calendar-detail-panel" style="display: none;">
          <div class="plato-detail-header">
            <span class="plato-detail-title" id="plato-detail-title-text">일정 상세</span>
            <button type="button" class="plato-detail-close-btn" id="plato-detail-close-btn">닫기</button>
          </div>
          <div class="plato-detail-cards-grid" id="plato-detail-cards-grid"></div>
        </div>
      </div>
    `;

    target.insertBefore(widget, target.firstChild);

    // 이벤트 바인딩: 새로고침 버튼 (버블링 방지)
    document.querySelector('#plato-refresh-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleManualRefresh();
    });

    // 월 이동 네비게이션 이벤트
    document.querySelector('#plato-cal-prev-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.prevMonth();
    });

    document.querySelector('#plato-cal-next-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.nextMonth();
    });

    // 상세 패널 닫기
    document.querySelector('#plato-detail-close-btn')?.addEventListener('click', () => {
      this.selectedDay = null;
      document.querySelectorAll('.plato-large-day-cell.selected').forEach(c => c.classList.remove('selected'));
      this.renderDetailPanel();
    });

    // 저장된 접기/펼치기 상태 복원
    chrome.storage.local.get(['platoCalendarCollapsed'], (res) => {
      if (res.platoCalendarCollapsed) {
        this.setCollapsed(true);
      }
    });

    // 달력 접기/펼치기 토글 (세모 버튼 및 브랜드명 클릭 시만 작동, 배경 클릭 오작동 방지)
    const toggleCollapse = (e) => {
      e.stopPropagation();
      const widgetEl = document.querySelector('#plato-calendar-widget');
      const isCurrentlyCollapsed = widgetEl?.classList.contains('collapsed');
      this.setCollapsed(!isCurrentlyCollapsed);
    };

    document.querySelector('#plato-cal-toggle-btn')?.addEventListener('click', toggleCollapse);
    document.querySelector('#plato-cal-brand-title')?.addEventListener('click', toggleCollapse);
  },

  setCollapsed(collapsed) {
    const widget = document.querySelector('#plato-calendar-widget');
    const toggleBtn = document.querySelector('#plato-cal-toggle-btn');
    if (!widget) return;

    if (collapsed) {
      widget.classList.add('collapsed');
      if (toggleBtn) toggleBtn.setAttribute('title', '달력 펼치기');
    } else {
      widget.classList.remove('collapsed');
      if (toggleBtn) toggleBtn.setAttribute('title', '달력 접기');
    }

    chrome.storage.local.set({ platoCalendarCollapsed: collapsed });
  },

  setLoading(isLoading) {
    const overlay = document.querySelector('#plato-cal-loading-overlay');
    if (!overlay) return;
    if (isLoading) {
      overlay.classList.add('active');
    } else {
      overlay.classList.remove('active');
    }
  },

  async prevMonth() {
    let y = this.viewYear;
    let m = this.viewMonth - 1;
    if (m < 1) {
      m = 12;
      y--;
    }
    await this.navigateToMonth(y, m);
  },

  async nextMonth() {
    let y = this.viewYear;
    let m = this.viewMonth + 1;
    if (m > 12) {
      m = 1;
      y++;
    }
    await this.navigateToMonth(y, m);
  },

  async navigateToMonth(year, month) {
    this.viewYear = year;
    this.viewMonth = month;
    this.selectedDay = null;

    const yearEl = document.querySelector('#plato-cal-year-text');
    if (yearEl) yearEl.innerText = `${year}년`;

    const monthEl = document.querySelector('#plato-cal-month-text');
    if (monthEl) monthEl.innerText = `${month}월`;

    this.renderDetailPanel();

    const cacheKey = `${year}_${month}`;
    if (this.monthCache[cacheKey]) {
      this.cachedData = this.monthCache[cacheKey];
      this.render();
      return;
    }

    // 캐시가 아직 없으면 해당 월의 기본 날짜 그리드를 즉시 렌더링하고 로딩 오버레이 표시
    this.renderEmptyMonthGrid(year, month);
    this.setLoading(true);

    const reqId = ++this.navRequestId;

    try {
      const data = await this.fetchMonthCalendar(year, month);
      if (reqId === this.navRequestId && data) {
        this.cachedData = data;
        this.monthCache[cacheKey] = data;
        this.render();
        chrome.storage.local.set({
          plato_calendar_months: this.monthCache
        });
      }
    } catch (err) {
      console.error('Failed to load month calendar:', err);
    } finally {
      if (reqId === this.navRequestId) {
        this.setLoading(false);
      }
    }
  },

  renderEmptyMonthGrid(year, month) {
    const totalDays = new Date(year, month, 0).getDate();
    const days = [];
    const now = new Date();
    for (let day = 1; day <= totalDays; day++) {
      const isToday = (year === now.getFullYear() && month === (now.getMonth() + 1) && day === now.getDate());
      const d = new Date(year, month - 1, day);
      const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
      days.push({ day, isToday, isWeekend, events: [] });
    }
    this.cachedData = {
      curYear: year,
      curMonth: month,
      days,
      activities: [],
      dayDueActivitiesMap: {}
    };
    this.render();
  },

  loadCachedData() {
    chrome.storage.local.get(['plato_calendar_data', 'plato_calendar_months'], (res) => {
      if (chrome.runtime.lastError) return;

      if (res.plato_calendar_months) {
        this.monthCache = res.plato_calendar_months;
      }

      const today = new Date();
      const currentMonthKey = `${today.getFullYear()}_${today.getMonth() + 1}`;
      this.viewYear = today.getFullYear();
      this.viewMonth = today.getMonth() + 1;

      // 1. 마지막 기록(캐시)이 있으면 즉시 그대로 렌더링하여 하얀 빈 화면 방지
      if (this.monthCache[currentMonthKey]) {
        this.cachedData = this.monthCache[currentMonthKey];
        this.render();
      } else if (res.plato_calendar_data) {
        this.cachedData = res.plato_calendar_data;
        this.render();
      } else {
        // 캐시 데이터가 전혀 없는 최초 접속 시에만 기본 빈 그리드 표시
        this.renderEmptyMonthGrid(this.viewYear, this.viewMonth);
      }

      // 2. 교과과정 페이지 접속 시 항상 자동으로 1회 새로고침 수행하여 최신 일정 동기화
      sessionStorage.removeItem('plato_need_calendar_refresh');
      this.fetchAndRefreshData();
    });
  },

  handleManualRefresh() {
    this.fetchAndRefreshData();
  },

  cleanHtmlForParsing(html) {
    if (!html) return '';
    return html
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
  },

  async fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, credentials: 'same-origin', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  },

  async fetchAndRefreshData() {
    const btn = document.querySelector('#plato-refresh-btn');
    if (btn) btn.disabled = true;

    // 기존 캐시나 렌더링 데이터가 있다면 화면을 하얗게 비우지 않고 그대로 유지
    // 데이터가 전혀 없을 때만 빈 기본 그리드를 렌더링
    const currentMonthKey = `${this.viewYear}_${this.viewMonth}`;
    if (this.monthCache[currentMonthKey]) {
      this.cachedData = this.monthCache[currentMonthKey];
    } else if (!this.cachedData || !this.cachedData.days || this.cachedData.curMonth !== this.viewMonth || this.cachedData.curYear !== this.viewYear) {
      this.renderEmptyMonthGrid(this.viewYear, this.viewMonth);
    }

    this.setLoading(true);

    try {
      // 병렬 최적화: 강좌별 활동 현황 조회와 월간 캘린더 조회를 동시에 실행(Promise.all)
      // 중복 호출 제거: 기존 2회 연속 실행되던 네트워크 요청을 1회로 통합하여 요청 수 50% 절감
      const [statusMaps, calDoc] = await Promise.all([
        this.fetchCourseStatuses(),
        this.fetchCalendarDoc(this.viewYear, this.viewMonth)
      ]);

      const data = this.parseCalendarDoc(calDoc, this.viewYear, this.viewMonth, statusMaps);
      if (data && data.activities) {
        this.cachedData = data;
        this.monthCache[`${this.viewYear}_${this.viewMonth}`] = data;
        const now = Date.now();
        chrome.storage.local.set({
          plato_calendar_data: data,
          plato_calendar_months: this.monthCache,
          plato_calendar_last_fetch: now
        });
        this.render();
      }
    } catch (e) {
      console.error('Failed to fetch plato calendar data:', e);
    } finally {
      this.setLoading(false);
      if (btn) btn.disabled = false;
    }
  },

  async fetchCourseStatuses() {
    let courseLinks = document.querySelectorAll('a[href*="/course/view.php?id="]');
    if (courseLinks.length === 0) {
      if (this.cachedCourses && this.cachedCourses.length > 0) {
        // 이미 저장된 강좌 목록이 있으면 재요청 없이 즉시 사용
        courseLinks = [];
      } else {
        try {
          const cResp = await this.fetchWithTimeout('https://plato.pusan.ac.kr/local/ubion/allcourse/regular/index.php');
          if (cResp.ok) {
            const cText = await cResp.text();
            const cleanCText = this.cleanHtmlForParsing(cText);
            const cDoc = new DOMParser().parseFromString(cleanCText, 'text/html');
            courseLinks = cDoc.querySelectorAll('a[href*="/course/view.php?id="]');
          }
        } catch (e) {
          console.warn('Failed to fetch fallback course list:', e);
        }
      }
    }

    const coursesMap = new Map();
    if (this.cachedCourses && this.cachedCourses.length > 0) {
      this.cachedCourses.forEach(c => coursesMap.set(c.id, c));
    }
    courseLinks.forEach(a => {
      const m = a.href.match(/id=([0-9]+)/);
      if (m) {
        const id = m[1];
        let name = this.cleanCourseName(a.innerText);
        if (name && !coursesMap.has(id)) {
          coursesMap.set(id, { id, name });
        }
      }
    });
    const courses = Array.from(coursesMap.values());
    this.cachedCourses = courses;

    const statusResults = await Promise.all(courses.map(async (c) => {
      const info = { courseId: c.id, courseName: c.name, items: {} };
      try {
        const [actRes, assignRes] = await Promise.all([
          this.fetchWithTimeout(`https://plato.pusan.ac.kr/report/ublogs/student/activity.php?id=${c.id}`),
          this.fetchWithTimeout(`https://plato.pusan.ac.kr/mod/assign/index.php?id=${c.id}`)
        ]);

        if (actRes.ok) {
          const actText = await actRes.text();
          const cleanActText = this.cleanHtmlForParsing(actText);
          const actDoc = new DOMParser().parseFromString(cleanActText, 'text/html');
          actDoc.querySelectorAll('tr[data-modname], tr').forEach(tr => {
            const link = tr.querySelector('td.td-activity a[href*="id="]') ||
                         tr.querySelector('a[href*="/mod/vod/view.php?id="]') ||
                         tr.querySelector('a[href*="/mod/assign/view.php?id="]') ||
                         tr.querySelector('a[href*="/mod/quiz/view.php?id="]') ||
                         tr.querySelector('a[href*="/mod/"]');
            if (link) {
              const m = link.href.match(/id=([0-9]+)/);
              if (m) {
                const modId = m[1];
                const statusTd = tr.querySelector('td.td-status') || tr.querySelector('td:nth-child(4)') || tr.querySelector('td:last-child');
                const statusText = statusTd ? statusTd.innerText.trim() : tr.innerText;
                const isCompleted = this.checkIsCompleted(statusText, tr);
                const completedAt = tr.querySelector('td.td-date')?.innerText.trim() || '';
                const name = tr.querySelector('.name')?.innerText?.trim() || link.innerText.trim();

                let parsedPeriod = '';
                const text = tr.innerText;
                const rangeMatch = text.match(/(\d{1,2})[./월]\s*(\d{1,2})일?\s*~\s*(\d{1,2})[./월]\s*(\d{1,2})일?/);
                if (rangeMatch) {
                  parsedPeriod = `${parseInt(rangeMatch[1])}월 ${parseInt(rangeMatch[2])}일 ~ ${parseInt(rangeMatch[3])}월 ${parseInt(rangeMatch[4])}일`;
                }

                info.items[modId] = {
                  modId,
                  name,
                  href: link.href,
                  courseName: c.name,
                  isCompleted,
                  completedAt,
                  parsedPeriod
                };
              }
            }
          });
        }

        if (assignRes.ok) {
          const assignText = await assignRes.text();
          const cleanAssignText = this.cleanHtmlForParsing(assignText);
          const assignDoc = new DOMParser().parseFromString(cleanAssignText, 'text/html');
          assignDoc.querySelectorAll('tr').forEach(tr => {
            const link = tr.querySelector('a[href*="/mod/assign/view.php?id="]');
            if (link) {
              const m = link.href.match(/id=([0-9]+)/);
              if (m) {
                const modId = m[1];
                const isCompleted = this.checkIsCompleted(tr.innerText, tr);
                let parsedPeriod = '';
                const text = tr.innerText;
                const rangeMatch = text.match(/(\d{1,2})[./월]\s*(\d{1,2})일?\s*~\s*(\d{1,2})[./월]\s*(\d{1,2})일?/);
                if (rangeMatch) {
                  parsedPeriod = `${parseInt(rangeMatch[1])}월 ${parseInt(rangeMatch[2])}일 ~ ${parseInt(rangeMatch[3])}월 ${parseInt(rangeMatch[4])}일`;
                }

                if (!info.items[modId]) {
                  info.items[modId] = {
                    modId,
                    name: link.innerText.trim(),
                    href: link.href,
                    courseName: c.name,
                    isCompleted,
                    parsedPeriod
                  };
                } else {
                  info.items[modId].isCompleted = isCompleted;
                  if (parsedPeriod && !info.items[modId].parsedPeriod) {
                    info.items[modId].parsedPeriod = parsedPeriod;
                  }
                }
              }
            }
          });
        }
      } catch (err) {
        console.warn('Plato Calendar: course status fetch error for', c.id, err);
      }
      return info;
    }));

    const globalStatusMap = {};
    const nameStatusMap = {};
    statusResults.forEach(sr => {
      Object.assign(globalStatusMap, sr.items);
      Object.values(sr.items).forEach(item => {
        if (item.name) {
          const cleanName = item.name.replace(/\s+/g, '');
          nameStatusMap[`${sr.courseName}_${cleanName}`] = item;
        }
      });
    });

    this.cachedStatusMap = globalStatusMap;
    this.cachedNameStatusMap = nameStatusMap;
    return { globalStatusMap, nameStatusMap };
  },

  async fetchCalendarDoc(year, month) {
    const timestamp = Math.floor(new Date(year, month - 1, 1, 12, 0, 0).getTime() / 1000);
    const calResp = await this.fetchWithTimeout(`https://plato.pusan.ac.kr/calendar/view.php?view=month&time=${timestamp}`);
    const calText = await calResp.text();

    if (calResp.redirected && calResp.url.includes('/login/')) {
      throw new Error('Session expired: redirected to login');
    }
    if ((calText.includes('id="form-login-sso"') || calText.includes('name="username"')) && calText.includes('name="password"')) {
      throw new Error('Session expired: login form detected');
    }

    const cleanHtml = this.cleanHtmlForParsing(calText);
    return new DOMParser().parseFromString(cleanHtml, 'text/html');
  },

  async fetchMonthCalendar(year, month, forceStatusFetch = false) {
    let statusMaps = {
      globalStatusMap: this.cachedStatusMap || {},
      nameStatusMap: this.cachedNameStatusMap || {}
    };

    if (forceStatusFetch || !this.cachedStatusMap) {
      statusMaps = await this.fetchCourseStatuses();
    }

    const calDoc = await this.fetchCalendarDoc(year, month);
    return this.parseCalendarDoc(calDoc, year, month, statusMaps);
  },

  parseCalendarDoc(calDoc, curYear, curMonth, statusMaps) {
    const globalStatusMap = statusMaps?.globalStatusMap || this.cachedStatusMap || {};
    const nameStatusMap = statusMaps?.nameStatusMap || this.cachedNameStatusMap || {};
    const totalDays = new Date(curYear, curMonth, 0).getDate();
    const dayCells = calDoc.querySelectorAll('td.day');

    const rawEvents = [];
    const days = [];
    const now = new Date();

    if (dayCells.length > 0) {
      dayCells.forEach(td => {
        if (td.classList.contains('othermonth') || td.classList.contains('noday')) return;
        const dayNum = td.querySelector('.day-number')?.innerText?.trim() || td.getAttribute('data-day');
        const day = dayNum ? parseInt(dayNum, 10) : null;
        if (!day || day < 1 || day > totalDays) return;

        const isToday = (curYear === now.getFullYear() && curMonth === (now.getMonth() + 1) && day === now.getDate());
        const dObj = new Date(curYear, curMonth - 1, day);
        const isWeekend = (dObj.getDay() === 0 || dObj.getDay() === 6);

        const dayEvents = [];
        td.querySelectorAll('li[data-region="event-item"]').forEach(li => {
          const comp = li.getAttribute('data-event-component') || '';
          const eventId = li.getAttribute('data-event-id') || li.querySelector('a[data-event-id]')?.getAttribute('data-event-id') || '';
          const a = li.querySelector('a[href*="/mod/"]') || li.querySelector('a');
          const href = a ? a.href : '';
          let title = a ? (a.getAttribute('title') || a.innerText) : '';
          title = title.replace(/&nbsp;/g, ' ').replace(/기한$/, '').trim();

          const modIdMatch = href.match(/id=([0-9]+)/);
          let modId = modIdMatch ? modIdMatch[1] : '';
          if (href.includes('/calendar/view.php')) {
            modId = '';
          }

          const courseLink = li.closest('td')?.querySelector('.course-name, a[href*="/course/view.php"]') ||
                             li.querySelector('a[href*="/course/view.php"]');
          let inferredCourseName = courseLink ? this.cleanCourseName(courseLink.innerText) : '';

          let statusInfo = modId ? globalStatusMap[modId] : null;
          if (!statusInfo && title) {
            const cleanT = title.replace(/\s+/g, '');
            if (inferredCourseName && nameStatusMap[`${inferredCourseName}_${cleanT}`]) {
              statusInfo = nameStatusMap[`${inferredCourseName}_${cleanT}`];
            } else {
              const matchedKey = Object.keys(nameStatusMap).find(k => k.endsWith(`_${cleanT}`));
              if (matchedKey) statusInfo = nameStatusMap[matchedKey];
            }
          }

          const isCompleted = statusInfo ? statusInfo.isCompleted : false;
          const courseName = statusInfo ? statusInfo.courseName : (inferredCourseName || '교과과정');
          const parsedPeriod = statusInfo ? statusInfo.parsedPeriod : '';

          const ev = {
            day,
            eventId,
            modId,
            comp,
            type: comp === 'mod_assign' ? '과제' : comp === 'mod_vod' ? '강의' : comp === 'mod_quiz' ? '퀴즈' : '활동',
            title,
            href,
            isCompleted,
            courseName,
            parsedPeriod
          };

          dayEvents.push(ev);
          rawEvents.push(ev);
        });

        days.push({
          day,
          isToday,
          isWeekend,
          events: dayEvents
        });
      });
    }

    if (days.length === 0) {
      for (let day = 1; day <= totalDays; day++) {
        const isToday = (curYear === now.getFullYear() && curMonth === (now.getMonth() + 1) && day === now.getDate());
        const dObj = new Date(curYear, curMonth - 1, day);
        const isWeekend = (dObj.getDay() === 0 || dObj.getDay() === 6);
        days.push({ day, isToday, isWeekend, events: [] });
      }
    }

    // 일자 순 정렬 (1일부터 오름차순)
    days.sort((a, b) => a.day - b.day);

    // 활동별 시작일 및 마감일(기간) 산출 및 유니크 활동 목록 구성
    const uniqueMap = new Map();
    rawEvents.forEach(ev => {
      const key = ev.modId 
        ? `${ev.courseName}_mod_${ev.modId}` 
        : `${ev.courseName}_title_${ev.title}_${ev.day}`;

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          ...ev,
          startDay: ev.day,
          dueDay: ev.day
        });
      } else {
        const existing = uniqueMap.get(key);
        if (ev.day < existing.startDay) {
          existing.startDay = ev.day;
        }
        if (ev.day > existing.dueDay) {
          existing.dueDay = ev.day;
        }
        if (ev.isCompleted !== undefined && !ev.isCompleted) {
          existing.isCompleted = false;
        }
        if (ev.parsedPeriod && !existing.parsedPeriod) {
          existing.parsedPeriod = ev.parsedPeriod;
        }
      }
    });

    // 강좌 활동 현황 중 해당 월에 마감인 항목이 캘린더 HTML에서 누락된 경우 보정
    if (globalStatusMap) {
      Object.values(globalStatusMap).forEach(item => {
        if (!item.parsedPeriod) return;
        const matches = [...item.parsedPeriod.matchAll(/(\d{1,2})월\s*(\d{1,2})일/g)];
        if (matches.length === 0) return;
        const lastMatch = matches[matches.length - 1];
        const dueM = parseInt(lastMatch[1], 10);
        const dueD = parseInt(lastMatch[2], 10);

        if (dueM === curMonth && dueD >= 1 && dueD <= totalDays) {
          const key = `${item.courseName}_mod_${item.modId}`;
          if (!uniqueMap.has(key)) {
            const firstMatch = matches[0];
            const startD = (parseInt(firstMatch[1], 10) === curMonth) ? parseInt(firstMatch[2], 10) : dueD;
            const newAct = {
              day: dueD,
              startDay: startD,
              dueDay: dueD,
              eventId: '',
              modId: item.modId,
              comp: 'mod_activity',
              type: item.name.includes('과제') ? '과제' : item.name.includes('퀴즈') ? '퀴즈' : '활동',
              title: item.name,
              href: item.href || '',
              isCompleted: item.isCompleted,
              courseName: item.courseName,
              parsedPeriod: item.parsedPeriod
            };
            uniqueMap.set(key, newAct);
          } else {
            const existing = uniqueMap.get(key);
            existing.dueDay = dueD;
            existing.day = dueD;
            if (matches.length >= 2) {
              const startD = (parseInt(matches[0][1], 10) === curMonth) ? parseInt(matches[0][2], 10) : dueD;
              existing.startDay = startD;
            }
          }
        }
      });
    }

    const uniqueActivities = Array.from(uniqueMap.values());

    // 정확한 D-Day 계산 (연도/월 차이 반영)
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    uniqueActivities.forEach(item => {
      const dueMidnight = new Date(curYear, curMonth - 1, item.dueDay).getTime();
      const diff = Math.round((dueMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
      item.dDayDiff = diff;

      if (item.isCompleted) {
        item.statusType = 'done';
        item.statusLabel = '완료';
        item.dDayText = '완료';
      } else if (diff < 0) {
        item.statusType = 'passed';
        item.statusLabel = '기한 지남';
        item.dDayText = `${Math.abs(diff)}일 전 마감`;
      } else if (diff === 0) {
        item.statusType = 'pending';
        item.statusLabel = '오늘 마감';
        item.dDayText = '오늘 마감';
      } else if (diff === 1) {
        item.statusType = 'pending';
        item.statusLabel = 'D-1';
        item.dDayText = 'D-1';
      } else {
        item.statusType = 'pending';
        item.statusLabel = '미완료';
        item.dDayText = `D-${diff}`;
      }

      item.periodText = this.formatPeriodText(item.parsedPeriod, curYear, curMonth, item.startDay, item.dueDay);
    });

    const dayDueActivitiesMap = {};
    uniqueActivities.forEach(act => {
      if (!dayDueActivitiesMap[act.dueDay]) {
        dayDueActivitiesMap[act.dueDay] = [];
      }
      dayDueActivitiesMap[act.dueDay].push(act);
    });

    // 각 일자별 이벤트 목록을 마감일 기준 활동 목록으로 정확히 동기화
    days.forEach(dObj => {
      dObj.events = dayDueActivitiesMap[dObj.day] || [];
    });

    uniqueActivities.sort((a, b) => {
      const rank = { pending: 1, passed: 2, done: 3 };
      if (rank[a.statusType] !== rank[b.statusType]) {
        return rank[a.statusType] - rank[b.statusType];
      }
      return a.dueDay - b.dueDay;
    });

    return {
      curYear,
      curMonth,
      days,
      activities: uniqueActivities,
      dayDueActivitiesMap
    };
  },

  render() {
    if (!this.cachedData) return;
    const { curYear, curMonth, days } = this.cachedData;

    const yearEl = document.querySelector('#plato-cal-year-text');
    if (yearEl) yearEl.innerText = `${curYear}년`;

    const monthEl = document.querySelector('#plato-cal-month-text');
    if (monthEl) monthEl.innerText = `${curMonth}월`;

    this.renderLargeDaysGrid(days, curYear, curMonth);
    this.renderDetailPanel();
  },

  renderLargeDaysGrid(days, curYear, curMonth) {
    const grid = document.querySelector('#plato-large-days-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const dayDueMap = this.cachedData?.dayDueActivitiesMap || {};

    // 1일 요일 맞춤 빈 셀
    const firstDay = days[0];
    if (firstDay && firstDay.day === 1) {
      const d = new Date(curYear, curMonth - 1, 1);
      const startDayOfWeek = d.getDay();
      for (let i = 0; i < startDayOfWeek; i++) {
        const empty = document.createElement('div');
        empty.className = 'plato-large-day-cell empty';
        grid.appendChild(empty);
      }
    }

    const now = new Date();

    days.forEach((d) => {
      const cell = document.createElement('div');
      cell.className = 'plato-large-day-cell';
      
      const isToday = (curYear === now.getFullYear() && curMonth === (now.getMonth() + 1) && d.day === now.getDate());
      if (isToday) cell.classList.add('today');
      if (this.selectedDay === d.day) cell.classList.add('selected');

      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const cellMidnight = new Date(curYear, curMonth - 1, d.day).getTime();
      const isPast = cellMidnight < todayMidnight;
      if (isPast) cell.classList.add('is-past');

      const dayOfWeek = new Date(curYear, curMonth - 1, d.day).getDay();
      if (dayOfWeek === 0) cell.classList.add('weekend-sun');
      if (dayOfWeek === 6) cell.classList.add('weekend-sat');

      const dueActs = dayDueMap[d.day] || [];
      const pendingCount = dueActs.filter(a => a.statusType === 'pending').length;
      const doneCount = dueActs.filter(a => a.statusType === 'done').length;
      const passedCount = dueActs.filter(a => a.statusType === 'passed').length;

      // 상태별 셀 하이라이트 (지난 날짜는 무조건 회색 처리하므로 액센트 바 제외)
      if (!isPast) {
        if (pendingCount > 0) {
          cell.classList.add('has-pending');
        } else if (doneCount > 0 && passedCount === 0) {
          cell.classList.add('all-done');
        }
      }

      // 상단 행: 일자 숫자 + 직관적인 큰 색상 뱃지 (지난 날짜는 무조건 회색 뱃지)
      let countBadgeHtml = '';
      if (isPast) {
        if (dueActs.length > 0) {
          countBadgeHtml = `<span class="plato-day-badge badge-passed">${dueActs.length}</span>`;
        }
      } else {
        if (pendingCount > 0) {
          countBadgeHtml = `<span class="plato-day-badge badge-pending">${pendingCount}</span>`;
        } else if (doneCount > 0) {
          countBadgeHtml = `<span class="plato-day-badge badge-done"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg></span>`;
        } else if (passedCount > 0) {
          countBadgeHtml = `<span class="plato-day-badge badge-passed">${passedCount}</span>`;
        }
      }

      // 셀 내부 칩들 (지난 날짜는 했든 안했든 무조건 회색 칩)
      let chipsHtml = '';
      if (dueActs.length > 0) {
        const maxDisplay = 2;
        const visibleActs = dueActs.slice(0, maxDisplay);
        const remainCount = dueActs.length - maxDisplay;

        const chipsList = visibleActs.map(act => {
          const chipClass = isPast ? 'chip-passed' : `chip-${act.statusType}`;
          return `
            <span class="plato-event-chip ${chipClass}" title="[${act.courseName}] ${act.title}">
              ${act.title}
            </span>
          `;
        }).join('');

        const moreBadge = remainCount > 0 ? `<div class="plato-more-chips-badge">+${remainCount}</div>` : '';
        chipsHtml = `<div class="plato-day-events-container">${chipsList}${moreBadge}</div>`;
      } else {
        chipsHtml = `<div class="plato-day-events-container"></div>`;
      }

      const dayTooltip = isToday ? `오늘 (${d.day}일)` : `${d.day}일`;
      cell.innerHTML = `
        <div class="plato-day-top-row">
          <span class="plato-day-num" title="${dayTooltip}">${d.day}</span>
          ${countBadgeHtml}
        </div>
        ${chipsHtml}
      `;

      cell.addEventListener('click', () => {
        if (this.selectedDay === d.day) {
          this.selectedDay = null;
          cell.classList.remove('selected');
        } else {
          document.querySelectorAll('.plato-large-day-cell.selected').forEach(c => c.classList.remove('selected'));
          this.selectedDay = d.day;
          cell.classList.add('selected');
        }
        this.renderDetailPanel();

        const detailPanel = document.querySelector('#plato-calendar-detail-panel');
        if (detailPanel && this.selectedDay !== null) {
          detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      grid.appendChild(cell);
    });
  },

  renderDetailPanel() {
    const panel = document.querySelector('#plato-calendar-detail-panel');
    const grid = document.querySelector('#plato-detail-cards-grid');
    const titleText = document.querySelector('#plato-detail-title-text');
    const closeBtn = document.querySelector('#plato-detail-close-btn');
    if (!panel || !grid) return;

    // 디폴트 상태: 아무 날짜도 클릭되지 않은 경우 상세 패널 숨김 (전체보기 제거)
    if (this.selectedDay === null) {
      panel.style.display = 'none';
      grid.innerHTML = '';
      return;
    }

    // 특정 날짜를 클릭했을 때만 패널 노출
    panel.style.display = 'block';

    if (!this.cachedData) return;

    const items = (this.cachedData.activities || []).filter(a => a.dueDay === this.selectedDay);
    const curYear = this.cachedData.curYear;
    const curMonth = this.cachedData.curMonth;
    const d = new Date(curYear, curMonth - 1, this.selectedDay);
    const dayName = this.WEEKDAYS_KO[d.getDay()] || '';

    if (titleText) {
      titleText.innerText = `${curMonth}월 ${this.selectedDay}일(${dayName}) 마감 일정 (${items.length})`;
    }
    if (closeBtn) {
      closeBtn.innerText = '닫기';
      closeBtn.style.display = 'inline-block';
    }

    if (items.length === 0) {
      grid.innerHTML = `
        <div class="plato-tasks-empty">
          <span>${this.selectedDay}일에 예정된 마감 일정이 없습니다.</span>
        </div>
      `;
      return;
    }

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const selectedMidnight = new Date(curYear, curMonth - 1, this.selectedDay).getTime();
    const isPastSelected = selectedMidnight < todayMidnight;

    // 카드 렌더링: 두꺼운 상태 바(좌측 6px), 큰 상태 뱃지, 기간(몇월몇일 ~ 몇월몇일)
    grid.innerHTML = items.map(item => {
      const cardClass = isPastSelected ? 'card-passed' : `card-${item.statusType}`;
      const badgeClass = isPastSelected ? 'badge-passed' : `badge-${item.statusType}`;
      return `
        <a href="${item.href}" class="plato-task-card ${cardClass}" target="_blank" rel="noopener noreferrer">
          <div class="plato-task-card-header">
            <span class="plato-task-course">[${item.type}] ${item.courseName}</span>
            <span class="plato-task-status-badge ${badgeClass}">${item.statusLabel}</span>
          </div>
          <span class="plato-task-name" title="${item.title}">${item.title}</span>
          <div class="plato-task-meta">
            <span class="plato-task-period">${item.periodText}</span>
            <span class="plato-task-dday dday-${item.statusType}">${item.dDayText}</span>
          </div>
        </a>
      `;
    }).join('');
  }
};

/* ==========================================================================
   BBITS (부산공유대학) SMART CALENDAR & DASHBOARD ENGINE
   ========================================================================== */
const BbitsCalendar = {
  selectedDay: null,
  cachedData: null,
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth() + 1,
  monthCache: {},
  cachedStatusMap: null,
  cachedNameStatusMap: null,
  cachedCourses: null,
  navRequestId: 0,

  WEEKDAYS_KO: ['일', '월', '화', '수', '목', '금', '토'],

  cleanCourseName(rawName) {
    if (!rawName) return '공유대학 강좌';
    let clean = rawName;
    clean = clean.replace(/\[?교과\]?\s*[-–:]?\s*/gi, '');
    clean = clean.replace(/\[?\d{4}[-~_]\d{1,2}학기\]?\s*[-–:]?\s*/g, '');
    clean = clean.replace(/\d{4}년\s*\d{1,2}학기\s*/g, '');
    clean = clean.replace(/\[(교과|학부|전공|교양)\]\s*[-–:]?\s*/gi, '');
    clean = clean.replace(/^[0-9]+년\s+[0-9]+학기\s+교과과정\s+학부\s*/, '');
    clean = clean.replace(/\bNEW\b/g, '');
    clean = clean.replace(/([가-힣]{1,2})\s+\1([가-힣]+)/g, '$1$2');
    return clean.replace(/\s+/g, ' ').trim();
  },

  getWeekdayStr(year, month, day) {
    if (!day) return '';
    const d = new Date(year, month - 1, day);
    return this.WEEKDAYS_KO[d.getDay()] || '';
  },

  formatPeriodText(parsedPeriod, year, month, startDay, dueDay) {
    if (parsedPeriod) {
      return parsedPeriod.replace(/(\d{1,2})월\s*(\d{1,2})일/g, (match, m, d) => {
        const mNum = parseInt(m, 10);
        const dNum = parseInt(d, 10);
        const w = this.getWeekdayStr(year, mNum, dNum);
        return `${mNum}월 ${dNum}일(${w})`;
      });
    }

    if (startDay && startDay !== dueDay) {
      const startW = this.getWeekdayStr(year, month, startDay);
      const dueW = this.getWeekdayStr(year, month, dueDay);
      return `${month}월 ${startDay}일(${startW}) ~ ${month}월 ${dueDay}일(${dueW})`;
    } else {
      const dueW = this.getWeekdayStr(year, month, dueDay);
      return `${month}월 ${dueDay}일(${dueW}) 마감`;
    }
  },

  checkIsCompleted(statusText, trElement) {
    const text = (statusText || trElement?.innerText || '').trim();
    if (!text) return false;

    // 1. 명백한 미완료/부정 키워드 우선 체크
    if (/미완료|미제출|미학습|미응시|미수강|결석|진행중|학습전|학습\s*전|미달|부족/.test(text)) {
      return false;
    }

    // 2. 결석/X 표시 체크
    if (/\bX\b|[\u2715\u2716\u274C]/.test(text) && !/[O\u2B55]/.test(text)) {
      return false;
    }

    // 3. 진도율 체크 (100% 미만이면 미완료)
    const percentMatch = text.match(/(\d{1,3})\s*%/);
    if (percentMatch) {
      const pct = parseInt(percentMatch[1], 10);
      if (pct < 100) return false;
      if (pct >= 100) return true;
    }

    // 4. 완료/출석/제출 긍정 키워드 체크
    if (/제출\s*완료|학습\s*완료|응시\s*완료|출석|출석인정/.test(text)) {
      return true;
    }
    if (/(?:^|[^미])완료/.test(text)) {
      return true;
    }
    if (/\bO\b|[O⭕]/.test(text)) {
      return true;
    }

    // 5. DOM 클래스 체크
    if (trElement) {
      if (trElement.querySelector('.text-danger, .label-danger, .badge-danger, .danger')) {
        return false;
      }
      if (trElement.querySelector('.video_completed, .text-success, .label-success, .badge-success, .success, [src*="completion-auto-y"], [src*="completion-manual-y"]')) {
        return true;
      }
    }

    return false;
  },

  init() {
    if (window !== window.top) return;
    if (window.location.hostname !== 'lms.bbits.ac.kr') return;
    const path = window.location.pathname;
    const isMain = path === '/' || path === '' || path.includes('/index.php');
    if (!isMain) return;

    // 팝업 설정(bbitsCalendarToggle) 확인 (기본값: true)
    chrome.storage.local.get(['bbitsCalendarToggle'], (res) => {
      if (res.bbitsCalendarToggle === false) return;

      // 중복 삽입 방지
      if (document.querySelector('#bbits-calendar-widget')) return;

      this.mountWidgetSkeleton();
      this.loadCachedData();
    });

    // 팝업에서 실시간 온오프 토글 시 동적 반영
    if (!this._storageListenerRegistered) {
      this._storageListenerRegistered = true;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.bbitsCalendarToggle) {
          if (changes.bbitsCalendarToggle.newValue === false) {
            document.querySelector('#bbits-calendar-widget')?.remove();
          } else {
            if (!document.querySelector('#bbits-calendar-widget')) {
              this.mountWidgetSkeleton();
              this.loadCachedData();
            }
          }
        }
      });
    }
  },

  mountWidgetSkeleton() {
    const courseLists = document.querySelector('.course_lists');
    const target = courseLists ? courseLists.parentElement :
                   (document.querySelector('.total_course_lists') ||
                    document.querySelector('#region-main') ||
                    document.querySelector('#page-content'));

    if (!target) {
      if (!this._mountRetries) this._mountRetries = 0;
      if (this._mountRetries < 30) {
        this._mountRetries++;
        setTimeout(() => {
          if (!document.querySelector('#bbits-calendar-widget')) {
            this.mountWidgetSkeleton();
            this.loadCachedData();
          }
        }, 100);
      }
      return;
    }
    this._mountRetries = 0;

    const now = new Date();
    const defaultYear = now.getFullYear();
    const defaultMonth = now.getMonth() + 1;

    const widget = document.createElement('div');
    widget.id = 'bbits-calendar-widget';
    widget.innerHTML = `
      <!-- 1. 맨 위 상단 헤더 바 -->
      <div class="plato-cal-top-bar" id="bbits-cal-top-bar">
        <div class="plato-top-bar-left">
          <span class="plato-cal-brand-title" id="bbits-cal-brand-title" title="달력 접기/펼치기">공유대학 캘린더</span>
          <button type="button" class="plato-cal-toggle-btn" id="bbits-cal-toggle-btn" title="달력 접기" aria-label="달력 접기/펼치기">
            <svg class="plato-toggle-triangle" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
              <path d="M12 8l6 8H6l6-8z"/>
            </svg>
          </button>
        </div>
        <div class="plato-top-bar-right">
          <button type="button" class="plato-refresh-btn" id="bbits-refresh-btn" title="일정 새로고침">
            <svg class="plato-btn-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px;">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span id="bbits-refresh-text">새로고침</span>
          </button>
        </div>
      </div>

      <!-- 2. 접히는 전체 영역 -->
      <div class="plato-cal-collapsible-body" id="bbits-cal-collapsible-body">
        <div class="plato-cal-month-header">
          <div class="plato-cal-month-nav-container">
            <button type="button" class="plato-cal-month-nav-btn prev" id="bbits-cal-prev-btn" title="이전 달">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <div class="plato-cal-month-title-wrap">
              <span class="plato-cal-year" id="bbits-cal-year-text">${defaultYear}년</span>
              <h2 class="plato-cal-month" id="bbits-cal-month-text">${defaultMonth}월</h2>
            </div>
            <button type="button" class="plato-cal-month-nav-btn next" id="bbits-cal-next-btn" title="다음 달">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>

        <!-- 고정 7열 대형 월간 캘린더 그리드 -->
        <div class="plato-cal-grid-card" id="bbits-cal-grid-card">
          <div class="plato-cal-weekdays">
            <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
          </div>
          <div class="plato-large-days-grid" id="bbits-large-days-grid"></div>

          <!-- 갱신/동기화 중 상태 오버레이 -->
          <div class="plato-cal-loading-overlay" id="bbits-cal-loading-overlay">
            <div class="plato-loading-bar"></div>
            <div class="plato-loading-dots" title="일정 갱신 중">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>

        <!-- 클릭 시 나타나는 특정 날짜 상세 활동 패널 -->
        <div class="plato-cal-detail-panel" id="bbits-calendar-detail-panel" style="display: none;">
          <div class="plato-detail-header">
            <span class="plato-detail-title" id="bbits-detail-title-text">일정 상세</span>
            <button type="button" class="plato-detail-close-btn" id="bbits-detail-close-btn">닫기</button>
          </div>
          <div class="plato-detail-cards-grid" id="bbits-detail-cards-grid"></div>
        </div>
      </div>
    `;

    if (courseLists && courseLists.parentElement) {
      courseLists.parentElement.insertBefore(widget, courseLists);
    } else {
      target.insertBefore(widget, target.firstChild);
    }

    // 이벤트 바인딩
    document.querySelector('#bbits-refresh-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleManualRefresh();
    });

    document.querySelector('#bbits-cal-prev-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.prevMonth();
    });

    document.querySelector('#bbits-cal-next-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.nextMonth();
    });

    document.querySelector('#bbits-detail-close-btn')?.addEventListener('click', () => {
      this.selectedDay = null;
      document.querySelectorAll('#bbits-calendar-widget .plato-large-day-cell.selected').forEach(c => c.classList.remove('selected'));
      this.renderDetailPanel();
    });

    // 저장된 접기/펼치기 상태 복원
    chrome.storage.local.get(['bbitsCalendarCollapsed'], (res) => {
      if (res.bbitsCalendarCollapsed) {
        this.setCollapsed(true);
      }
    });

    const toggleCollapse = (e) => {
      e.stopPropagation();
      const widgetEl = document.querySelector('#bbits-calendar-widget');
      const isCurrentlyCollapsed = widgetEl?.classList.contains('collapsed');
      this.setCollapsed(!isCurrentlyCollapsed);
    };

    document.querySelector('#bbits-cal-toggle-btn')?.addEventListener('click', toggleCollapse);
    document.querySelector('#bbits-cal-brand-title')?.addEventListener('click', toggleCollapse);
  },

  setCollapsed(collapsed) {
    const widget = document.querySelector('#bbits-calendar-widget');
    const toggleBtn = document.querySelector('#bbits-cal-toggle-btn');
    if (!widget) return;

    if (collapsed) {
      widget.classList.add('collapsed');
      if (toggleBtn) toggleBtn.setAttribute('title', '달력 펼치기');
    } else {
      widget.classList.remove('collapsed');
      if (toggleBtn) toggleBtn.setAttribute('title', '달력 접기');
    }

    chrome.storage.local.set({ bbitsCalendarCollapsed: collapsed });
  },

  setLoading(isLoading) {
    const overlay = document.querySelector('#bbits-cal-loading-overlay');
    if (!overlay) return;
    if (isLoading) {
      overlay.classList.add('active');
    } else {
      overlay.classList.remove('active');
    }
  },

  async prevMonth() {
    let y = this.viewYear;
    let m = this.viewMonth - 1;
    if (m < 1) {
      m = 12;
      y--;
    }
    await this.navigateToMonth(y, m);
  },

  async nextMonth() {
    let y = this.viewYear;
    let m = this.viewMonth + 1;
    if (m > 12) {
      m = 1;
      y++;
    }
    await this.navigateToMonth(y, m);
  },

  async navigateToMonth(year, month) {
    this.viewYear = year;
    this.viewMonth = month;
    this.selectedDay = null;

    const yearEl = document.querySelector('#bbits-cal-year-text');
    if (yearEl) yearEl.innerText = `${year}년`;

    const monthEl = document.querySelector('#bbits-cal-month-text');
    if (monthEl) monthEl.innerText = `${month}월`;

    this.renderDetailPanel();

    const cacheKey = `${year}_${month}`;
    if (this.monthCache[cacheKey]) {
      this.cachedData = this.monthCache[cacheKey];
      this.render();
      return;
    }

    this.renderEmptyMonthGrid(year, month);
    this.setLoading(true);

    const reqId = ++this.navRequestId;

    try {
      const data = await this.fetchMonthCalendar(year, month);
      if (reqId === this.navRequestId && data) {
        this.cachedData = data;
        this.monthCache[cacheKey] = data;
        this.render();
        chrome.storage.local.set({
          bbits_calendar_months: this.monthCache
        });
      }
    } catch (err) {
      console.error('Failed to load bbits month calendar:', err);
    } finally {
      if (reqId === this.navRequestId) {
        this.setLoading(false);
      }
    }
  },

  renderEmptyMonthGrid(year, month) {
    const totalDays = new Date(year, month, 0).getDate();
    const days = [];
    const now = new Date();
    for (let day = 1; day <= totalDays; day++) {
      const isToday = (year === now.getFullYear() && month === (now.getMonth() + 1) && day === now.getDate());
      const d = new Date(year, month - 1, day);
      const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
      days.push({ day, isToday, isWeekend, events: [] });
    }
    this.cachedData = {
      curYear: year,
      curMonth: month,
      days,
      activities: [],
      dayDueActivitiesMap: {}
    };
    this.render();
  },

  loadCachedData() {
    chrome.storage.local.get(['bbits_calendar_data', 'bbits_calendar_months'], (res) => {
      if (chrome.runtime.lastError) return;

      if (res.bbits_calendar_months) {
        this.monthCache = res.bbits_calendar_months;
      }

      const today = new Date();
      const currentMonthKey = `${today.getFullYear()}_${today.getMonth() + 1}`;
      this.viewYear = today.getFullYear();
      this.viewMonth = today.getMonth() + 1;

      if (this.monthCache[currentMonthKey]) {
        this.cachedData = this.monthCache[currentMonthKey];
        this.render();
      } else if (res.bbits_calendar_data) {
        this.cachedData = res.bbits_calendar_data;
        this.render();
      } else {
        this.renderEmptyMonthGrid(this.viewYear, this.viewMonth);
      }

      // 페이지 접속 시 항상 백그라운드로 1회 새로고침 수행하여 최신 일정 동기화
      this.fetchAndRefreshData();
    });
  },

  handleManualRefresh() {
    this.fetchAndRefreshData();
  },

  cleanHtmlForParsing(html) {
    if (!html) return '';
    return html
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
  },

  async fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, credentials: 'same-origin', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  },

  async fetchAndRefreshData() {
    const btn = document.querySelector('#bbits-refresh-btn');
    if (btn) btn.disabled = true;

    const currentMonthKey = `${this.viewYear}_${this.viewMonth}`;
    if (this.monthCache[currentMonthKey]) {
      this.cachedData = this.monthCache[currentMonthKey];
    } else if (!this.cachedData || !this.cachedData.days || this.cachedData.curMonth !== this.viewMonth || this.cachedData.curYear !== this.viewYear) {
      this.renderEmptyMonthGrid(this.viewYear, this.viewMonth);
    }

    this.setLoading(true);

    try {
      const [statusMaps, calDoc] = await Promise.all([
        this.fetchCourseStatuses(),
        this.fetchCalendarDoc(this.viewYear, this.viewMonth)
      ]);

      const data = this.parseCalendarDoc(calDoc, this.viewYear, this.viewMonth, statusMaps);
      if (data && data.activities) {
        this.cachedData = data;
        this.monthCache[`${this.viewYear}_${this.viewMonth}`] = data;
        const now = Date.now();
        chrome.storage.local.set({
          bbits_calendar_data: data,
          bbits_calendar_months: this.monthCache,
          bbits_calendar_last_fetch: now
        });
        this.render();
      }
    } catch (e) {
      console.error('Failed to fetch bbits calendar data:', e);
    } finally {
      this.setLoading(false);
      if (btn) btn.disabled = false;
    }
  },

  async fetchCourseStatuses() {
    let courseLinks = document.querySelectorAll('.course_box a.course_link, a[href*="/course/view.php?id="]');
    if (courseLinks.length === 0) {
      if (this.cachedCourses && this.cachedCourses.length > 0) {
        courseLinks = [];
      } else {
        try {
          const cResp = await this.fetchWithTimeout('https://lms.bbits.ac.kr/');
          if (cResp.ok) {
            const cText = await cResp.text();
            const cleanCText = this.cleanHtmlForParsing(cText);
            const cDoc = new DOMParser().parseFromString(cleanCText, 'text/html');
            courseLinks = cDoc.querySelectorAll('.course_box a.course_link, a[href*="/course/view.php?id="]');
          }
        } catch (e) {
          console.warn('Failed to fetch fallback bbits course list:', e);
        }
      }
    }

    const coursesMap = new Map();
    if (this.cachedCourses && this.cachedCourses.length > 0) {
      this.cachedCourses.forEach(c => coursesMap.set(c.id, c));
    }

    courseLinks.forEach(a => {
      const m = a.href.match(/id=([0-9]+)/);
      if (m) {
        const id = m[1];
        if (parseInt(id, 10) <= 1) return; // 사이트 기본 강좌 제외
        const box = a.closest('.course_box') || a.parentElement;
        const titleEl = box ? box.querySelector('.course-title h3, h3') : a.querySelector('.course-title h3, h3');
        const profEl = box ? box.querySelector('.prof') : a.querySelector('.prof');

        let rawTitle = titleEl ? titleEl.innerText : (a.innerText || a.getAttribute('title') || '');
        let rawProf = profEl ? profEl.innerText.trim() : '';

        let cleanTitle = this.cleanCourseName(rawTitle);
        let finalName = rawProf ? `${cleanTitle} (${rawProf})` : cleanTitle;
        if (finalName && !coursesMap.has(id)) {
          coursesMap.set(id, { id, name: finalName });
        }
      }
    });

    const courses = Array.from(coursesMap.values());
    this.cachedCourses = courses;

    const statusResults = await Promise.all(courses.map(async (c) => {
      const info = { courseId: c.id, courseName: c.name, items: {} };
      try {
        const [courseRes, assignRes] = await Promise.all([
          this.fetchWithTimeout(`https://lms.bbits.ac.kr/course/view.php?id=${c.id}`),
          this.fetchWithTimeout(`https://lms.bbits.ac.kr/mod/assign/index.php?id=${c.id}`)
        ]);

        if (courseRes.ok) {
          const cText = await courseRes.text();
          const cleanCText = this.cleanHtmlForParsing(cText);
          const cDoc = new DOMParser().parseFromString(cleanCText, 'text/html');

          // VOD 동영상 강의 파싱 (아직 열리지 않은 주차의 module-ID 포함)
          cDoc.querySelectorAll('li.activity.vod').forEach(li => {
            const link = li.querySelector('a[href*="/mod/vod/view.php?id="]');
            const modIdMatch = (link && link.href.match(/id=([0-9]+)/)) || li.id?.match(/module-([0-9]+)/);
            if (!modIdMatch) return;
            const modId = modIdMatch[1];
            const href = link ? link.href : `https://lms.bbits.ac.kr/mod/vod/view.php?id=${modId}`;

            const instanceEl = li.querySelector('.instancename');
            let name = '';
            if (instanceEl) {
              const clone = instanceEl.cloneNode(true);
              clone.querySelectorAll('.accesshide').forEach(el => el.remove());
              name = clone.innerText.replace(/동영상$/, '').trim();
            } else {
              name = (link ? link.innerText : '').replace(/동영상$/, '').trim();
            }

            const rawPeriod = li.querySelector('.text-ubstrap')?.innerText.trim() || '';
            let parsedPeriod = '';
            const periodMatches = rawPeriod.match(/(\d{4})-(\d{1,2})-(\d{1,2})/g);
            let startDay = null;
            let dueDay = null;
            let dueYear = null;
            let dueMonth = null;
            let startYear = null;
            let startMonth = null;

            if (periodMatches && periodMatches.length >= 2) {
              const [sY, sM, sD] = periodMatches[0].split('-').map(Number);
              const [dY, dM, dD] = periodMatches[1].split('-').map(Number);
              startYear = sY; startMonth = sM; startDay = sD;
              dueYear = dY; dueMonth = dM; dueDay = dD;
              parsedPeriod = `${sM}월 ${sD}일 ~ ${dM}월 ${dD}일`;
            } else if (periodMatches && periodMatches.length === 1) {
              const [dY, dM, dD] = periodMatches[0].split('-').map(Number);
              dueYear = dY; dueMonth = dM; dueDay = dD;
              parsedPeriod = `${dM}월 ${dD}일 마감`;
            }

            const progressText = li.querySelector('.modtype_video_info_progress')?.innerText.trim() || '';
            const isCompleted = li.querySelector('.video_completed') !== null || (progressText && progressText.includes('100%'));

            info.items[modId] = {
              modId,
              name,
              href,
              courseName: c.name,
              type: '강의',
              comp: 'mod_vod',
              isCompleted,
              parsedPeriod,
              startYear,
              startMonth,
              startDay,
              dueYear,
              dueMonth,
              dueDay
            };
          });
        }

        if (assignRes.ok) {
          const aText = await assignRes.text();
          const cleanAText = this.cleanHtmlForParsing(aText);
          const aDoc = new DOMParser().parseFromString(cleanAText, 'text/html');

          aDoc.querySelectorAll('table tr').forEach(tr => {
            const link = tr.querySelector('a[href*="/mod/assign/view.php?id="]');
            if (!link) return;
            const m = link.href.match(/id=([0-9]+)/);
            if (!m) return;
            const modId = m[1];

            const name = link.innerText.trim();
            const dueTd = tr.querySelector('td.c2') || tr.querySelector('td:nth-child(3)');
            const statusTd = tr.querySelector('td.c3') || tr.querySelector('td:nth-child(4)');
            const weekTd = tr.querySelector('td.c0') || tr.querySelector('td:first-child');

            const rawDue = dueTd ? dueTd.innerText.trim() : '';
            const statusText = statusTd ? statusTd.innerText.trim() : tr.innerText;
            const isCompleted = this.checkIsCompleted(statusText, tr);

            let dueYear = null;
            let dueMonth = null;
            let dueDay = null;
            let startYear = null;
            let startMonth = null;
            let startDay = null;
            let parsedPeriod = '';

            const dueMatch = rawDue.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (dueMatch) {
              dueYear = parseInt(dueMatch[1], 10);
              dueMonth = parseInt(dueMatch[2], 10);
              dueDay = parseInt(dueMatch[3], 10);
              parsedPeriod = `${dueMonth}월 ${dueDay}일 마감`;
            }

            const weekText = weekTd ? weekTd.innerText.trim() : '';
            const weekMatch = weekText.match(/(\d{1,2})월\s*(\d{1,2})일\s*[-~]\s*(\d{1,2})월\s*(\d{1,2})일/);
            if (weekMatch) {
              startMonth = parseInt(weekMatch[1], 10);
              startDay = parseInt(weekMatch[2], 10);
              const endM = parseInt(weekMatch[3], 10);
              const endD = parseInt(weekMatch[4], 10);
              parsedPeriod = `${startMonth}월 ${startDay}일 ~ ${dueMonth || endM}월 ${dueDay || endD}일`;
            }

            info.items[modId] = {
              modId,
              name,
              href: link.href,
              courseName: c.name,
              type: '과제',
              comp: 'mod_assign',
              isCompleted,
              parsedPeriod,
              startYear,
              startMonth,
              startDay,
              dueYear,
              dueMonth,
              dueDay
            };
          });
        }
      } catch (err) {
        console.warn('BBITS Calendar: course status fetch error for', c.id, err);
      }
      return info;
    }));

    const globalStatusMap = {};
    const nameStatusMap = {};
    statusResults.forEach(sr => {
      Object.assign(globalStatusMap, sr.items);
      Object.values(sr.items).forEach(item => {
        if (item.name) {
          const cleanName = item.name.replace(/\s+/g, '');
          nameStatusMap[`${sr.courseName}_${cleanName}`] = item;
        }
      });
    });

    this.cachedStatusMap = globalStatusMap;
    this.cachedNameStatusMap = nameStatusMap;
    return { globalStatusMap, nameStatusMap };
  },

  async fetchCalendarDoc(year, month) {
    const timestamp = Math.floor(new Date(year, month - 1, 1, 12, 0, 0).getTime() / 1000);
    const calResp = await this.fetchWithTimeout(`https://lms.bbits.ac.kr/calendar/view.php?view=month&time=${timestamp}`);
    const calText = await calResp.text();

    if (calResp.redirected && calResp.url.includes('/login/')) {
      throw new Error('Session expired: redirected to login');
    }
    const cleanHtml = this.cleanHtmlForParsing(calText);
    return new DOMParser().parseFromString(cleanHtml, 'text/html');
  },

  async fetchMonthCalendar(year, month, forceStatusFetch = false) {
    let statusMaps = {
      globalStatusMap: this.cachedStatusMap || {},
      nameStatusMap: this.cachedNameStatusMap || {}
    };

    if (forceStatusFetch || !this.cachedStatusMap) {
      statusMaps = await this.fetchCourseStatuses();
    }

    const calDoc = await this.fetchCalendarDoc(year, month);
    return this.parseCalendarDoc(calDoc, year, month, statusMaps);
  },

  parseCalendarDoc(calDoc, curYear, curMonth, statusMaps) {
    const globalStatusMap = statusMaps?.globalStatusMap || this.cachedStatusMap || {};
    const nameStatusMap = statusMaps?.nameStatusMap || this.cachedNameStatusMap || {};
    const totalDays = new Date(curYear, curMonth, 0).getDate();
    const dayCells = calDoc.querySelectorAll('td.day');

    const uniqueMap = new Map();
    const now = new Date();

    // 1. 강좌 활동 현황(VOD 강의, 과제) 중 해당 월에 마감인 항목을 마감일(dueDay) 기준으로 우선 등록
    if (globalStatusMap) {
      Object.values(globalStatusMap).forEach(item => {
        let itemDueYear = item.dueYear || curYear;
        let itemDueMonth = item.dueMonth;
        let itemDueDay = item.dueDay;
        let itemStartDay = item.startDay;

        if (!itemDueMonth && item.parsedPeriod) {
          const matches = [...item.parsedPeriod.matchAll(/(\d{1,2})월\s*(\d{1,2})일/g)];
          if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            itemDueMonth = parseInt(lastMatch[1], 10);
            itemDueDay = parseInt(lastMatch[2], 10);
            if (matches.length >= 2) {
              itemStartDay = parseInt(matches[0][2], 10);
            }
          }
        }

        if (itemDueYear === curYear && itemDueMonth === curMonth && itemDueDay >= 1 && itemDueDay <= totalDays) {
          const key = `${item.courseName}_mod_${item.modId}`;
          if (!uniqueMap.has(key)) {
            uniqueMap.set(key, {
              day: itemDueDay,
              startDay: itemStartDay || itemDueDay,
              dueDay: itemDueDay,
              modId: item.modId,
              type: item.type || (item.name.includes('과제') ? '과제' : '강의'),
              title: item.name,
              href: item.href || '',
              isCompleted: item.isCompleted,
              courseName: item.courseName,
              parsedPeriod: item.parsedPeriod
            });
          }
        }
      });
    }

    const days = [];

    // 2. Moodle 캘린더 문서(calDoc) 파싱: 일반 학사 일정 보충 및 시작일 알림 필터링
    if (dayCells.length > 0) {
      dayCells.forEach(td => {
        if (td.classList.contains('othermonth') || td.classList.contains('noday')) return;
        const dayDiv = td.querySelector('.day');
        const dayText = dayDiv ? dayDiv.innerText.replace(/[^0-9]/g, '') : '';
        const day = dayText ? parseInt(dayText, 10) : null;
        if (!day || day < 1 || day > totalDays) return;

        const isToday = (curYear === now.getFullYear() && curMonth === (now.getMonth() + 1) && day === now.getDate());
        const dObj = new Date(curYear, curMonth - 1, day);
        const isWeekend = (dObj.getDay() === 0 || dObj.getDay() === 6);

        td.querySelectorAll('ul.events-new li.calendar_event_course a, li[data-region="event-item"] a, ul.events-new li a').forEach(a => {
          const href = a.href || '';
          let title = a.getAttribute('title') || a.innerText || '';
          title = title.replace(/&nbsp;/g, ' ').replace(/기한$/, '').trim();

          // 시작일 알림("N주차 N차시 강의 동영상", "강의 열람", "강의 개시") 필터링 (마감일에만 표시)
          if (/주차.*강의.*동영상|강의\s*열람|강의\s*개시/.test(title)) return;

          // 이미 globalStatusMap 또는 nameStatusMap에 존재하는 활동은 마감일에 이미 등록되어 있으므로 시작일 제외
          const cleanT = title.replace(/\s+/g, '');
          const matchedKey = Object.keys(nameStatusMap).find(k => k.endsWith(`_${cleanT}`));
          if (matchedKey) return;

          const modIdMatch = href.match(/id=([0-9]+)/);
          const modId = (!href.includes('/calendar/view.php') && modIdMatch) ? modIdMatch[1] : '';
          if (modId && globalStatusMap[modId]) return;

          // 강의나 과제 성격의 강좌 이벤트는 시작일 날짜 셀에 등록하지 않음
          if (title.includes('강의') || title.includes('동영상') || title.includes('과제') || title.includes('차시')) {
            return;
          }

          // 일반 학사/공지 일정만 해당 일자에 등록
          const key = `cal_event_${day}_${cleanT}`;
          if (!uniqueMap.has(key)) {
            uniqueMap.set(key, {
              day,
              startDay: day,
              dueDay: day,
              modId: '',
              type: '활동',
              title,
              href,
              isCompleted: false,
              courseName: '공유대학',
              parsedPeriod: `${curMonth}월 ${day}일`
            });
          }
        });

        days.push({
          day,
          isToday,
          isWeekend,
          events: []
        });
      });
    }

    if (days.length === 0) {
      for (let day = 1; day <= totalDays; day++) {
        const isToday = (curYear === now.getFullYear() && curMonth === (now.getMonth() + 1) && day === now.getDate());
        const dObj = new Date(curYear, curMonth - 1, day);
        const isWeekend = (dObj.getDay() === 0 || dObj.getDay() === 6);
        days.push({ day, isToday, isWeekend, events: [] });
      }
    }

    days.sort((a, b) => a.day - b.day);

    const uniqueActivities = Array.from(uniqueMap.values());
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    uniqueActivities.forEach(item => {
      const dueMidnight = new Date(curYear, curMonth - 1, item.dueDay).getTime();
      const diff = Math.round((dueMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
      item.dDayDiff = diff;

      if (item.isCompleted) {
        item.statusType = 'done';
        item.statusLabel = '완료';
        item.dDayText = '완료';
      } else if (diff < 0) {
        item.statusType = 'passed';
        item.statusLabel = '기한 지남';
        item.dDayText = `${Math.abs(diff)}일 전 마감`;
      } else if (diff === 0) {
        item.statusType = 'pending';
        item.statusLabel = '오늘 마감';
        item.dDayText = '오늘 마감';
      } else if (diff === 1) {
        item.statusType = 'pending';
        item.statusLabel = 'D-1';
        item.dDayText = 'D-1';
      } else {
        item.statusType = 'pending';
        item.statusLabel = '미완료';
        item.dDayText = `D-${diff}`;
      }

      item.periodText = this.formatPeriodText(item.parsedPeriod, curYear, curMonth, item.startDay, item.dueDay);
    });

    const dayDueActivitiesMap = {};
    uniqueActivities.forEach(act => {
      if (!dayDueActivitiesMap[act.dueDay]) {
        dayDueActivitiesMap[act.dueDay] = [];
      }
      dayDueActivitiesMap[act.dueDay].push(act);
    });

    // 각 일자별 이벤트 목록을 마감일 기준 활동 목록으로 할당 (시작일 표시 원천 제거)
    days.forEach(dObj => {
      dObj.events = dayDueActivitiesMap[dObj.day] || [];
    });

    uniqueActivities.sort((a, b) => {
      const rank = { pending: 1, passed: 2, done: 3 };
      if (rank[a.statusType] !== rank[b.statusType]) {
        return rank[a.statusType] - rank[b.statusType];
      }
      return a.dueDay - b.dueDay;
    });

    return {
      curYear,
      curMonth,
      days,
      activities: uniqueActivities,
      dayDueActivitiesMap
    };
  },

  render() {
    if (!this.cachedData) return;
    const { curYear, curMonth, days } = this.cachedData;

    const yearEl = document.querySelector('#bbits-cal-year-text');
    if (yearEl) yearEl.innerText = `${curYear}년`;

    const monthEl = document.querySelector('#bbits-cal-month-text');
    if (monthEl) monthEl.innerText = `${curMonth}월`;

    this.renderLargeDaysGrid(days, curYear, curMonth);
    this.renderDetailPanel();
  },

  renderLargeDaysGrid(days, curYear, curMonth) {
    const grid = document.querySelector('#bbits-large-days-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const dayDueMap = this.cachedData?.dayDueActivitiesMap || {};

    const firstDay = days[0];
    if (firstDay && firstDay.day === 1) {
      const d = new Date(curYear, curMonth - 1, 1);
      const startDayOfWeek = d.getDay();
      for (let i = 0; i < startDayOfWeek; i++) {
        const empty = document.createElement('div');
        empty.className = 'plato-large-day-cell empty';
        grid.appendChild(empty);
      }
    }

    const now = new Date();

    days.forEach((d) => {
      const cell = document.createElement('div');
      cell.className = 'plato-large-day-cell';

      const isToday = (curYear === now.getFullYear() && curMonth === (now.getMonth() + 1) && d.day === now.getDate());
      if (isToday) cell.classList.add('today');
      if (this.selectedDay === d.day) cell.classList.add('selected');

      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const cellMidnight = new Date(curYear, curMonth - 1, d.day).getTime();
      const isPast = cellMidnight < todayMidnight;
      if (isPast) cell.classList.add('is-past');

      const dayOfWeek = new Date(curYear, curMonth - 1, d.day).getDay();
      if (dayOfWeek === 0) cell.classList.add('weekend-sun');
      if (dayOfWeek === 6) cell.classList.add('weekend-sat');

      const dueActs = dayDueMap[d.day] || [];
      const pendingCount = dueActs.filter(a => a.statusType === 'pending').length;
      const doneCount = dueActs.filter(a => a.statusType === 'done').length;
      const passedCount = dueActs.filter(a => a.statusType === 'passed').length;

      // 상태별 셀 하이라이트 (지난 날짜는 무조건 회색 처리하므로 액센트 바 제외)
      if (!isPast) {
        if (pendingCount > 0) {
          cell.classList.add('has-pending');
        } else if (doneCount > 0 && passedCount === 0) {
          cell.classList.add('all-done');
        }
      }

      // 상단 행: 일자 숫자 + 직관적인 큰 색상 뱃지 (지난 날짜는 무조건 회색 뱃지)
      let countBadgeHtml = '';
      if (isPast) {
        if (dueActs.length > 0) {
          countBadgeHtml = `<span class="plato-day-badge badge-passed">${dueActs.length}</span>`;
        }
      } else {
        if (pendingCount > 0) {
          countBadgeHtml = `<span class="plato-day-badge badge-pending">${pendingCount}</span>`;
        } else if (doneCount > 0) {
          countBadgeHtml = `<span class="plato-day-badge badge-done"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg></span>`;
        } else if (passedCount > 0) {
          countBadgeHtml = `<span class="plato-day-badge badge-passed">${passedCount}</span>`;
        }
      }

      // 셀 내부 칩들 (지난 날짜는 했든 안했든 무조건 회색 칩)
      let chipsHtml = '';
      if (dueActs.length > 0) {
        const maxDisplay = 2;
        const visibleActs = dueActs.slice(0, maxDisplay);
        const remainCount = dueActs.length - maxDisplay;

        const chipsList = visibleActs.map(act => {
          const chipClass = isPast ? 'chip-passed' : `chip-${act.statusType}`;
          return `
            <span class="plato-event-chip ${chipClass}" title="[${act.courseName}] ${act.title}">
              ${act.title}
            </span>
          `;
        }).join('');

        const moreBadge = remainCount > 0 ? `<div class="plato-more-chips-badge">+${remainCount}</div>` : '';
        chipsHtml = `<div class="plato-day-events-container">${chipsList}${moreBadge}</div>`;
      } else {
        chipsHtml = `<div class="plato-day-events-container"></div>`;
      }

      const dayTooltip = isToday ? `오늘 (${d.day}일)` : `${d.day}일`;
      cell.innerHTML = `
        <div class="plato-day-top-row">
          <span class="plato-day-num" title="${dayTooltip}">${d.day}</span>
          ${countBadgeHtml}
        </div>
        ${chipsHtml}
      `;

      cell.addEventListener('click', () => {
        if (this.selectedDay === d.day) {
          this.selectedDay = null;
          cell.classList.remove('selected');
        } else {
          document.querySelectorAll('#bbits-calendar-widget .plato-large-day-cell.selected').forEach(c => c.classList.remove('selected'));
          this.selectedDay = d.day;
          cell.classList.add('selected');
        }
        this.renderDetailPanel();

        const detailPanel = document.querySelector('#bbits-calendar-detail-panel');
        if (detailPanel && this.selectedDay !== null) {
          detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      grid.appendChild(cell);
    });
  },

  renderDetailPanel() {
    const panel = document.querySelector('#bbits-calendar-detail-panel');
    const grid = document.querySelector('#bbits-detail-cards-grid');
    const titleText = document.querySelector('#bbits-detail-title-text');
    const closeBtn = document.querySelector('#bbits-detail-close-btn');
    if (!panel || !grid) return;

    if (this.selectedDay === null) {
      panel.style.display = 'none';
      grid.innerHTML = '';
      return;
    }

    panel.style.display = 'block';

    if (!this.cachedData) return;

    const items = (this.cachedData.activities || []).filter(a => a.dueDay === this.selectedDay);
    const curYear = this.cachedData.curYear;
    const curMonth = this.cachedData.curMonth;
    const d = new Date(curYear, curMonth - 1, this.selectedDay);
    const dayName = this.WEEKDAYS_KO[d.getDay()] || '';

    if (titleText) {
      titleText.innerText = `${curMonth}월 ${this.selectedDay}일(${dayName}) 마감 일정 (${items.length})`;
    }
    if (closeBtn) {
      closeBtn.innerText = '닫기';
      closeBtn.style.display = 'inline-block';
    }

    if (items.length === 0) {
      grid.innerHTML = `
        <div class="plato-tasks-empty">
          <span>${this.selectedDay}일에 예정된 마감 일정이 없습니다.</span>
        </div>
      `;
      return;
    }

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const selectedMidnight = new Date(curYear, curMonth - 1, this.selectedDay).getTime();
    const isPastSelected = selectedMidnight < todayMidnight;

    grid.innerHTML = items.map(item => {
      const cardClass = isPastSelected ? 'card-passed' : `card-${item.statusType}`;
      const badgeClass = isPastSelected ? 'badge-passed' : `badge-${item.statusType}`;
      return `
        <a href="${item.href}" class="plato-task-card ${cardClass}" target="_blank" rel="noopener noreferrer">
          <div class="plato-task-card-header">
            <span class="plato-task-course">[${item.type}] ${item.courseName}</span>
            <span class="plato-task-status-badge ${badgeClass}">${item.statusLabel}</span>
          </div>
          <span class="plato-task-name" title="${item.title}">${item.title}</span>
          <div class="plato-task-meta">
            <span class="plato-task-period">${item.periodText}</span>
            <span class="plato-task-dday dday-${item.statusType}">${item.dDayText}</span>
          </div>
        </a>
      `;
    }).join('');
  }
};

// 플라토 홈 유지 여부 판별 (교과과정에서 홈 버튼을 직접 눌러 이동해 온 1회성 진입만 홈 유지)
// 홈에서 새로고침(F5)을 하거나 다른 경로로 진입 시에는 무조건 교과과정 페이지로 이동
let allowPlatoHomeThisPage = false;
if (window.location.hostname.includes("plato.pusan.ac.kr")) {
  const isHomePath = window.location.pathname === "/" || 
                     window.location.pathname === "/index.php" || 
                     window.location.pathname === "";
  if (isHomePath) {
    const isReload = (() => {
      try {
        const navEntries = window.performance?.getEntriesByType?.('navigation');
        if (navEntries && navEntries.length > 0) {
          return navEntries[0].type === 'reload';
        }
        if (window.performance?.navigation) {
          return window.performance.navigation.type === 1;
        }
      } catch (e) {}
      return false;
    })();

    const fromCourseClick = sessionStorage.getItem('plato_home_clicked_from_course') === '1';
    sessionStorage.removeItem('plato_home_clicked_from_course');

    // 새로고침이 아니고, 교과과정에서 홈 버튼을 누르고 이동해 온 최초 1회 뷰만 홈 유지
    if (fromCourseClick && !isReload) {
      allowPlatoHomeThisPage = true;
    }
  }
}

const attemptLogin = () => {
  if (!chrome.runtime?.id) return;
  try {
    const host = window.location.hostname;
    const href = window.location.href;
    const path = window.location.pathname;

    chrome.storage.local.get([
      "hjsId", "hjsPw", "hjsToggle", "hjsPopupClose",
      "userId", "userPw", "popupToggle", "platoPopupClose", "platoCalendarToggle",
      "bbitsId", "bbitsPw", "bbitsToggle", "bbitsPopupClose", "bbitsCalendarToggle"
    ], (data) => {
      if (!chrome.runtime?.id || chrome.runtime.lastError) return;
    
    if (host.includes("onestop.pusan.ac.kr") || host.includes("login.pusan.ac.kr")) {
      if (data.hjsPopupClose) {
        document.querySelectorAll('div[id^="popup_"], .modal-backdrop').forEach(el => el.remove());
      }

      const pwBtn = document.querySelector('a[href*="changeNextPw"]');
      if (pwBtn && !pwBtn.dataset.done) {
        pwBtn.dataset.done = "1";
        
        window.dispatchEvent(new CustomEvent("RUN_PNU_FUNC", { 
          detail: { type: "CHANGE_PW" } 
        }));

        const clickEvt = new MouseEvent("click", {
          view: window,
          bubbles: true,
          cancelable: true
        });
        pwBtn.dispatchEvent(clickEvt);
        return;
      }

      if (host.includes("onestop.pusan.ac.kr")) {
        if (!data.hjsToggle) return;
        
        const loginArea = document.querySelector('#global_login');
        if (loginArea && loginArea.innerText.includes("로그아웃")) return;

        if (path.includes("/main") || path.includes("/index.do")) return;
        if (href.includes("/error/entrypoint")) {
          window.location.replace("https://onestop.pusan.ac.kr/login");
          return;
        }
        
        if (loginArea && !loginArea.dataset.done) {
          loginArea.dataset.done = "1";
          window.dispatchEvent(new CustomEvent("RUN_PNU_FUNC", { detail: { type: "ONESTOP_SSO" } }));
        }
      }
    }

    if (host === "login.pusan.ac.kr") {
      if (!data.hjsToggle) return;
      const b = document.querySelector('#btnLogin');
      const u = document.querySelector('#login_id') || document.querySelector('#username');
      const p = document.querySelector('#login_pw') || document.querySelector('#password');
      if (b && u && p && !b.dataset.done) {
        b.dataset.done = "1";
        u.value = data.hjsId || ""; 
        p.value = data.hjsPw || "";
        b.click();
      }
    }

    if (host.includes("bbits.ac.kr")) {
      if (data.bbitsPopupClose) {
        document.querySelectorAll('[data-action="just_close"], .modal .close, .modal .btn-close').forEach(b => b.click());
      }

      const isBbitsLoggedIn = !!document.querySelector('[data-action*="logout"], .logout, a[href*="logout"]');
      if (isBbitsLoggedIn) {
        if (data.bbitsCalendarToggle !== false) {
          BbitsCalendar.init();
        }
        return;
      }

      if (!data.bbitsToggle) return;

      // 1. LMS 페이지 (https://lms.bbits.ac.kr/login.php 등) 로그인 처리
      const lmsUnivSelect = document.querySelector('select#univid, select[name="univid"]');
      const lmsU = document.querySelector('input#username, form.form-login input[name="username"]');
      const lmsP = document.querySelector('input#password, form.form-login input[name="password"]');
      const lmsBtn = document.querySelector('button.main_login_btn, form.form-login button[type="submit"]');

      if (lmsU && lmsP && lmsBtn && !lmsU.dataset.done) {
        lmsU.dataset.done = "1";
        if (lmsUnivSelect) {
          const opt = Array.from(lmsUnivSelect.options).find(o => o.text.includes("부산대"));
          lmsUnivSelect.value = opt ? opt.value : "C1";
          lmsUnivSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        lmsU.value = data.bbitsId || "";
        lmsU.dispatchEvent(new Event('input', { bubbles: true }));
        lmsU.dispatchEvent(new Event('change', { bubbles: true }));

        lmsP.value = data.bbitsPw || "";
        lmsP.dispatchEvent(new Event('input', { bubbles: true }));
        lmsP.dispatchEvent(new Event('change', { bubbles: true }));

        setTimeout(() => {
          lmsBtn.click();
        }, 50);
        return;
      }

      // 2. 통합 포털 (https://www.bbits.ac.kr) 모달 로그인 처리
      const loginModalBtn = document.querySelector('[data-action="coursemos_widgets_unifiedloginbar_templets_default_login2_login"]');
      const loginLayer = document.querySelector('.popup_layer.login');
      if (loginModalBtn && (!loginLayer || loginLayer.style.display === 'none')) {
        loginModalBtn.click();
        return;
      }
      const u = document.querySelector('input[name="userid"]');
      const p = document.querySelector('input[name="password"]');
      const b = document.querySelector('[data-action="coursemos_widgets_loginbar_templets_default_login_login"]');
      const univ = document.querySelector('.login_box[data-name="university"] li[data-value="1"]');
      if (u && p && b && !u.dataset.done) {
        u.dataset.done = "1";
        if (univ) univ.click();
        u.value = data.bbitsId || "";
        p.value = data.bbitsPw || "";
        b.click();
      }
    }

    const isPlato = host === "plato.pusan.ac.kr";
    const isDevPlato = host === "dev-plato.pusan.ac.kr" || host === "dev-plato.ac.kr" || host.includes("dev-plato");

    if (isPlato || isDevPlato) {
      // 1. 실제 공지 팝업/모달 자동 닫기 (배너나 링크 내부 버튼은 절대 클릭하지 않음)
      if (data.platoPopupClose) {
        const closeSelectors = [
          '.modal-dialog .btn-close',
          '.modal-dialog .close',
          '.modal .btn-close',
          '.modal .close',
          '.pop-close',
          '[data-bs-dismiss="modal"]'
        ];
        document.querySelectorAll(closeSelectors.join(', ')).forEach(c => {
          // 배너나 a 링크 내부의 닫기 버튼은 클릭하지 않음 (새 탭/창 열림 방지)
          if (c.closest('a, .banner, [target="_blank"]')) return;
          // 세션 만료/재로그인 모달의 버튼은 절대 닫기 처리하지 않음 (재로그인 로직이 처리하도록 보존)
          const parentModal = c.closest('.modal, [role="dialog"], [role="alertdialog"], [data-region="modal-container"]');
          if (parentModal && /활동이\s*없어\s*로그아웃|세션\s*만료|다시\s*로그인/i.test(parentModal.innerText)) return;

          if (!c.dataset.autoClosed) {
            c.dataset.autoClosed = "1";
            c.click();
          }
        });
      }

      if (!data.popupToggle) return;

      // iframe 내부에서는 최상위 페이지의 로그인을 방해하지 않도록 중단
      if (window !== window.top) return;

      // 2. Moodle 로그인 후 중간 "리다이랙트" 안내 화면 자동 통과
      if (document.title.includes("리다이랙트") || document.querySelector('#region-main h1')?.innerText.includes("리다이랙트")) {
        const continueLink = document.querySelector('#region-main a[href*="plato.pusan.ac.kr"], #region-main a[href*="dev-plato"]');
        if (continueLink) {
          continueLink.click();
          return;
        }
      }

      // 3. 로그인 여부 판단
      const hasUserIndicator = document.body.classList.contains('loggedin') ||
                               !!document.querySelector('.logout, a[href*="/login/logout.php"], a[href*="logout.php"], .usermenu, .userpicture, .userbutton');
      const hasNotLoggedInClass = document.body.classList.contains('notloggedin');
      const loginBtnOnPage = document.querySelector('.usermenu a[href*="login"], header a[href*="login"], .login-btn, .btn-login, #loginbtn');

      const isLoggedIn = hasUserIndicator && !hasNotLoggedInClass;
      const isNotLoggedIn = hasNotLoggedInClass || (!hasUserIndicator && !!loginBtnOnPage);

      // 4. 세션 만료 다이얼로그/모달 감지 및 자동 재로그인 처리
      if (data.userId && data.userPw) {
        // A. 화면에 떠 있는 모든 활성 모달 검사
        const openModals = document.querySelectorAll('.modal.show, div[data-region="modal-container"], .moodle-dialogue, div[role="dialog"], div[role="alertdialog"]');
        for (const modal of openModals) {
          const modalText = (modal.innerText || "").trim();
          if (/활동이\s*없어\s*로그아웃|세션\s*만료|다시\s*로그인해\s*주세요|로그아웃되었습니다/i.test(modalText)) {
            if (!modal.dataset.sessionReLoginTriggered) {
              modal.dataset.sessionReLoginTriggered = "1";

              // "다시 로그인" 버튼 우선 검색 및 클릭
              const reloginBtn = modal.querySelector('button[data-action="save"], button.btn-primary, a[href*="login"]') ||
                                 Array.from(modal.querySelectorAll('button, a')).find(el => /다시\s*로그인|재로그인/i.test(el.innerText));

              if (reloginBtn) {
                if (isPlato) sessionStorage.setItem('plato_need_calendar_refresh', '1');
                reloginBtn.click();
              }

              // 버튼 클릭 이벤트 후 브라우저가 이동하지 않을 경우 대비: 현재 URL을 wantsurl로 보존하여 로그인 페이지로 안전 이동
              const currentUrl = window.location.href;
              setTimeout(() => {
                if (!window.location.pathname.includes('/login/') && !window.location.pathname.includes('login.php')) {
                  if (isPlato) sessionStorage.setItem('plato_need_calendar_refresh', '1');
                  const targetLoginUrl = isDevPlato
                    ? `https://${host}/login.php?wantsurl=${encodeURIComponent(currentUrl)}`
                    : `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(currentUrl)}`;
                  window.location.href = targetLoginUrl;
                }
              }, 500);
              return;
            }
          }
        }

        // B. 모달 래퍼와 관계없이 화면 내의 "다시 로그인" data-action="save" 버튼 직접 감지
        const directSaveBtn = Array.from(document.querySelectorAll('button[data-action="save"], button.btn-primary')).find(b => 
          /다시\s*로그인/i.test(b.innerText) && !b.dataset.sessionClicked
        );
        if (directSaveBtn) {
          directSaveBtn.dataset.sessionClicked = "1";
          if (isPlato) sessionStorage.setItem('plato_need_calendar_refresh', '1');
          directSaveBtn.click();
          const currentUrl = window.location.href;
          setTimeout(() => {
            if (!window.location.pathname.includes('/login/') && !window.location.pathname.includes('login.php')) {
              if (isPlato) sessionStorage.setItem('plato_need_calendar_refresh', '1');
              const targetLoginUrl = isDevPlato
                ? `https://${host}/login.php?wantsurl=${encodeURIComponent(currentUrl)}`
                : `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(currentUrl)}`;
              window.location.href = targetLoginUrl;
            }
          }, 500);
          return;
        }
      }

      // 5. 로그인 페이지인 경우: 자동 로그인 수행
      // 플라토 신규 UI (/login/index.php) 및 구버전/dev-plato (/login.php, /login.php?errorcode=4 등) 모두 지원
      const isLoginPage = path.includes("/login.php") ||
                          path.includes("/login/index.php") ||
                          path.includes("/login/") ||
                          href.includes("login.php");

      if (isLoginPage) {
        // 실제 비밀번호 불일치 오류 메시지 감지 시 무한 루프 방지 (errorcode=4 세션 만료 알림 등은 통과)
        const errText = (document.querySelector('.alert, .loginerrors, #notice, .notifyproblem')?.innerText || "").trim();
        if (/잘못된|불일치|일치하지|아이디 또는 비밀번호|invalid/i.test(errText)) {
          return;
        }

        // SSO 폼(#form-login-sso) 또는 표준 Moodle 로그인 폼(#login, form[action*="login"] 등) 검색
        const loginForm = document.querySelector('#form-login-sso') ||
                          document.querySelector('#login') ||
                          document.querySelector('.tab-pane.active form') ||
                          document.querySelector('form.tab-content-container') ||
                          document.querySelector('form[action*="login"]');

        const u = loginForm?.querySelector('#input-username, input#username, input[name="username"], #login_id') ||
                  document.querySelector('#input-username, input#username, input[name="username"], #login_id');
        const p = loginForm?.querySelector('#input-password, input#password, input[name="password"], #login_pw') ||
                  document.querySelector('#input-password, input#password, input[name="password"], #login_pw');
        const b = loginForm?.querySelector('.btn-login, #loginbtn, button[name="loginbutton"], input[name="loginbutton"], button[type="submit"], input[type="submit"]') ||
                  document.querySelector('.btn-login, #loginbtn, button[name="loginbutton"], input[name="loginbutton"], button[type="submit"], input[type="submit"]');

        const lockTarget = loginForm || u;
        if (lockTarget && !lockTarget.dataset.autoLoggingIn && u && p && b && data.userId && data.userPw) {
          lockTarget.dataset.autoLoggingIn = "1";
          u.dataset.done = "1";
          if (isPlato) {
            sessionStorage.setItem('plato_need_calendar_refresh', '1');
            sessionStorage.removeItem('plato_home_clicked_from_course');
          }

          // 값 주입 및 이벤트 발생
          u.value = data.userId;
          u.dispatchEvent(new Event('input', { bubbles: true }));
          u.dispatchEvent(new Event('change', { bubbles: true }));
          u.dispatchEvent(new Event('blur', { bubbles: true }));

          p.value = data.userPw;
          p.dispatchEvent(new Event('input', { bubbles: true }));
          p.dispatchEvent(new Event('change', { bubbles: true }));
          p.dispatchEvent(new Event('blur', { bubbles: true }));

          // 단 1회 클릭으로 자연스러운 폼 제출 진행 (2차 중복 제출 방지)
          setTimeout(() => {
            if (!b.disabled) {
              b.click();
            }
          }, 80);
          return;
        }
      }

      // 6. 메인 페이지나 일반 페이지에서 비로그인 상태일 때 로그인 페이지로 즉시 자동 전환
      if (!isLoggedIn && isNotLoggedIn && data.userId && data.userPw) {
        if (!isLoginPage) {
          if (!document.body.dataset.loginRedirecting) {
            document.body.dataset.loginRedirecting = "1";
            if (isPlato) sessionStorage.removeItem('plato_home_clicked_from_course');
            let loginUrl;
            if (isDevPlato) {
              loginUrl = `https://${host}/login.php?wantsurl=${encodeURIComponent(href)}`;
            } else {
              const isHome = path === "/" || path === "/index.php" || path === "";
              loginUrl = `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(href)}`;
              if (isHome) {
                if (data.platoCalendarToggle !== false) {
                  const targetUrl = "https://plato.pusan.ac.kr/local/ubion/allcourse/regular/index.php";
                  loginUrl = `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(targetUrl)}`;
                } else {
                  loginUrl = "https://plato.pusan.ac.kr/login/index.php";
                }
              }
            }
            window.location.href = loginUrl;
            return;
          }
        }
      }

      // 7. 로그인 완료 시: 플라토 정규 교과과정 페이지 이동 및 캘린더 초기화 (정규 플라토에만 적용)
      if (isLoggedIn) {
        sessionStorage.removeItem('plato_login_failed');

        if (isPlato) {
          // 플라토 메인 홈(/ 또는 /index.php)인 경우 처리
          // 교과과정 페이지에서 홈 버튼을 직접 누른 1회성 진입만 홈 유지 허용, 그 외(새로고침, 직링크 등)는 교과과정으로 자동 이동
          const isHome = path === "/" || path === "/index.php" || path === "";
          if (isHome) {
            if (allowPlatoHomeThisPage) {
              return;
            }
            if (data.platoCalendarToggle !== false) {
              const now = Date.now();
              const lastRedirect = parseInt(sessionStorage.getItem('plato_last_course_redirect') || '0', 10);
              if (now - lastRedirect > 1500) {
                sessionStorage.setItem('plato_last_course_redirect', now.toString());
                window.location.replace("https://plato.pusan.ac.kr/local/ubion/allcourse/regular/index.php");
                return;
              }
            }
          }

          // 교과과정 페이지인 경우 플라토 스마트 캘린더 위젯 초기화
          if (path.includes("/local/ubion/allcourse/regular/index.php") || path.includes("/local/ubion/allcourse/")) {
            PlatoCalendar.init();
          }
        }
      }
    }
  });
  } catch (err) {
    // 확장 프로그램 새로고침 등으로 컨텍스트가 만료된 경우 안전 종료
    return;
  }
};

const fixVp = () => {
  const m = document.querySelector('meta[name="viewport"]');
  if (m && m.content !== "width=device-width, initial-scale=1") m.content = "width=device-width, initial-scale=1";
};

fixVp();
attemptLogin();
let t;
const observer = new MutationObserver(() => {
  clearTimeout(t);
  t = setTimeout(() => {
    if (!chrome.runtime?.id) {
      observer.disconnect();
      return;
    }
    attemptLogin();
    fixVp();
  }, 300);
});
observer.observe(document.body, { childList: true, subtree: true });

// 세션 만료 모달 및 로그인 상태 실시간 감시 (2초마다 신속 감지)
const checkInterval = setInterval(() => {
  if (!chrome.runtime?.id) {
    clearInterval(checkInterval);
    return;
  }
  attemptLogin();
}, 2000);

// 플라토 홈 버튼 클릭 감지: 교과과정 페이지에서 홈 버튼을 직접 클릭한 경우에만 1회성으로 홈 유지 허용
if (window.location.hostname.includes("plato.pusan.ac.kr")) {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    const isHomeHref = href === '/' ||
                       href === '/index.php' ||
                       href === 'https://plato.pusan.ac.kr/' ||
                       href === 'https://plato.pusan.ac.kr' ||
                       href === 'https://plato.pusan.ac.kr/index.php';
    const isHomeText = link.querySelector('.menuname')?.textContent?.trim() === '홈' ||
                       link.textContent?.trim() === '홈';
    const isHomeMenu = link.classList.contains('btn-channel') ||
                       link.getAttribute('role') === 'menuitem' ||
                       link.classList.contains('navbar-brand');

    const isCoursePage = window.location.pathname.includes('/local/ubion/allcourse/');

    if (isCoursePage && isHomeHref && (isHomeText || isHomeMenu || href === '/')) {
      sessionStorage.setItem('plato_home_clicked_from_course', '1');
    }
  }, true);
}

// 교과과정 페이지 진입 시 지연 없이 캘린더 즉시 초기화
if (window.location.hostname === "plato.pusan.ac.kr" &&
    (window.location.pathname.includes("/local/ubion/allcourse/regular/index.php") || window.location.pathname.includes("/local/ubion/allcourse/"))) {
  PlatoCalendar.init();
}

// 부산공유대학 메인 대시보드 진입 시 캘린더 즉시 초기화
if (window.location.hostname === "lms.bbits.ac.kr") {
  BbitsCalendar.init();
}