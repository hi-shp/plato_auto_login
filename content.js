/* ==========================================================================
   PLATO CLEAN CALENDAR & DASHBOARD ENGINE (MINIMALIST & FIXED GRID)
   ========================================================================== */
const PlatoCalendar = {
  cooldownSeconds: 5,
  timerId: null,
  selectedDay: null,
  cachedData: null,

  WEEKDAYS_KO: ['일', '월', '화', '수', '목', '금', '토'],

  cleanCourseName(rawName) {
    if (!rawName) return '교과과정';
    let clean = rawName.replace(/^[0-9]+년\s+[0-9]+학기\s+교과과정\s+학부\s*/, '');
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
    if (/\bX\b|[✕✖❌]/.test(text) && !/[O⭕]/.test(text)) {
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
          <span class="plato-cal-year" id="plato-cal-year-text">${defaultYear}년</span>
          <h2 class="plato-cal-month" id="plato-cal-month-text">${defaultMonth}월</h2>
        </div>

        <!-- 고정 7열 대형 월간 캘린더 그리드 -->
        <div class="plato-cal-grid-card">
          <div class="plato-cal-weekdays">
            <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
          </div>
          <div class="plato-large-days-grid" id="plato-large-days-grid">
            <!-- 일자 셀들이 여기에 렌더링됨 -->
          </div>
        </div>

        <!-- 클릭 시 나타나는 특정 날짜 상세 활동 패널 -->
        <div class="plato-cal-detail-panel" id="plato-calendar-detail-panel">
          <div class="plato-detail-header">
            <span class="plato-detail-title" id="plato-detail-title-text">일정 상세</span>
            <button type="button" class="plato-detail-close-btn" id="plato-detail-close-btn">전체 보기</button>
          </div>
          <div class="plato-detail-cards-grid" id="plato-detail-cards-grid">
            <div class="plato-tasks-empty">
              <span>데이터를 불러오는 중입니다...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    target.insertBefore(widget, target.firstChild);

    // 이벤트 바인딩: 새로고침 버튼 (버블링 방지)
    document.querySelector('#plato-refresh-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleManualRefresh();
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

  loadCachedData() {
    chrome.storage.local.get(['plato_calendar_data', 'plato_calendar_last_fetch'], (res) => {
      if (chrome.runtime.lastError) return;
      const now = Date.now();
      const lastFetch = res.plato_calendar_last_fetch || 0;
      const elapsed = now - lastFetch;

      const hasValidData = res.plato_calendar_data &&
                           res.plato_calendar_data.activities &&
                           res.plato_calendar_data.activities.length > 0;

      if (hasValidData) {
        this.cachedData = res.plato_calendar_data;
        this.render();
      }

      // 재로그인 직후이거나, 유효한 데이터가 없거나, 쿨다운(5초)이 경과한 경우 즉시 새로고침
      const needForceRefresh = sessionStorage.getItem('plato_need_calendar_refresh') === '1' || !hasValidData;
      if (needForceRefresh) {
        sessionStorage.removeItem('plato_need_calendar_refresh');
        this.fetchAndRefreshData();
      } else if (elapsed < this.cooldownSeconds * 1000) {
        this.startCooldownTimer(Math.ceil((this.cooldownSeconds * 1000 - elapsed) / 1000));
      } else {
        this.fetchAndRefreshData();
      }
    });
  },

  handleManualRefresh() {
    chrome.storage.local.get(['plato_calendar_last_fetch'], (res) => {
      const now = Date.now();
      const lastFetch = res.plato_calendar_last_fetch || 0;
      const remaining = Math.ceil((this.cooldownSeconds * 1000 - (now - lastFetch)) / 1000);

      if (remaining > 0) {
        this.startCooldownTimer(remaining);
        return;
      }

      this.fetchAndRefreshData();
    });
  },

  startCooldownTimer(seconds) {
    clearInterval(this.timerId);
    let remaining = seconds;
    const btn = document.querySelector('#plato-refresh-btn');
    const txt = document.querySelector('#plato-refresh-text');

    if (btn) btn.disabled = true;
    if (txt) txt.innerText = `새로고침 (${remaining}초)`;

    this.timerId = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(this.timerId);
        if (btn) btn.disabled = false;
        if (txt) txt.innerText = '새로고침';
      } else {
        if (txt) txt.innerText = `새로고침 (${remaining}초)`;
      }
    }, 1000);
  },

  async fetchAndRefreshData() {
    const btn = document.querySelector('#plato-refresh-btn');
    const txt = document.querySelector('#plato-refresh-text');
    if (btn) btn.disabled = true;
    if (txt) txt.innerText = '갱신 중...';

    try {
      const data = await this.scrapeAllData();
      // 유효한 데이터(날짜나 과제가 정상 존재하는 캘린더)인 경우에만 캐시 갱신
      if (data && data.activities && data.activities.length > 0) {
        this.cachedData = data;
        const now = Date.now();
        chrome.storage.local.set({
          plato_calendar_data: data,
          plato_calendar_last_fetch: now
        });
        this.render();
        this.startCooldownTimer(this.cooldownSeconds);
      } else if (this.cachedData) {
        // 스크랩 데이터가 비어있고 이전 정상 캐시가 있다면 이전 캐시 유지
        console.warn('Plato Calendar: Scraped activities empty, keeping existing cache');
        this.render();
        if (btn) btn.disabled = false;
        if (txt) txt.innerText = '새로고침';
      } else {
        if (btn) btn.disabled = false;
        if (txt) txt.innerText = '새로고침';
      }
    } catch (e) {
      console.error('Failed to fetch plato calendar data:', e);
      if (btn) btn.disabled = false;
      if (txt) txt.innerText = '새로고침 실패';
    }
  },

  async scrapeAllData() {
    // 1. Moodle 월별 캘린더 View Fetch
    const calResp = await fetch('https://plato.pusan.ac.kr/calendar/view.php?view=month', { credentials: 'same-origin' });
    const calText = await calResp.text();

    // 세션 만료 상태 감지 시 기존 정상 캐시 보존을 위해 즉시 중단
    if (calResp.redirected && calResp.url.includes('/login/')) {
      throw new Error('Session expired: redirected to login');
    }
    if ((calText.includes('id="form-login-sso"') || calText.includes('name="username"')) && calText.includes('name="password"')) {
      throw new Error('Session expired: login form detected');
    }

    const calDoc = new DOMParser().parseFromString(calText, 'text/html');
    const dayCells = calDoc.querySelectorAll('td.day');
    if (dayCells.length === 0) {
      throw new Error('Calendar days not found in response');
    }

    const monthTitle = calDoc.querySelector('h2.current, h2')?.innerText?.trim() || '이번 달 일정';
    let curYear = new Date().getFullYear();
    let curMonth = new Date().getMonth() + 1;

    const yMatch = monthTitle.match(/([0-9]{4})\s*년?/);
    if (yMatch) curYear = parseInt(yMatch[1], 10);

    const mMatch = monthTitle.match(/([0-9]{1,2})\s*월/);
    if (mMatch) curMonth = parseInt(mMatch[1], 10);

    // 2. 교과과정 페이지 DOM에서 수강 강좌 ID 및 이름 추출 (부족할 경우 정규 교과과정 페이지 fetch 보완)
    let courseLinks = document.querySelectorAll('a[href*="/course/view.php?id="]');
    if (courseLinks.length === 0) {
      try {
        const cResp = await fetch('https://plato.pusan.ac.kr/local/ubion/allcourse/regular/index.php', { credentials: 'same-origin' });
        if (cResp.ok) {
          const cText = await cResp.text();
          const cDoc = new DOMParser().parseFromString(cText, 'text/html');
          courseLinks = cDoc.querySelectorAll('a[href*="/course/view.php?id="]');
        }
      } catch (e) {
        console.warn('Failed to fetch fallback course list:', e);
      }
    }

    const coursesMap = new Map();
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

    // 3. 각 강좌별 활동 현황 및 과제 현황 병렬 Fetch
    const statusResults = await Promise.all(courses.map(async (c) => {
      const info = { courseId: c.id, courseName: c.name, items: {} };
      try {
        const [actRes, assignRes] = await Promise.all([
          fetch(`https://plato.pusan.ac.kr/report/ublogs/student/activity.php?id=${c.id}`, { credentials: 'same-origin' }),
          fetch(`https://plato.pusan.ac.kr/mod/assign/index.php?id=${c.id}`, { credentials: 'same-origin' })
        ]);

        if (actRes.ok) {
          const actText = await actRes.text();
          const actDoc = new DOMParser().parseFromString(actText, 'text/html');
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
          const assignDoc = new DOMParser().parseFromString(assignText, 'text/html');
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

    // 4. 캘린더 날짜별 이벤트 파싱
    const rawEvents = [];
    const days = [];

    dayCells.forEach(td => {
      const dayNum = td.querySelector('.day-number')?.innerText?.trim() || td.getAttribute('data-day');
      const day = dayNum ? parseInt(dayNum, 10) : null;
      if (!day) return;

      const isToday = td.classList.contains('today');
      const isWeekend = td.classList.contains('weekend');

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
          modId = ''; // 캘린더 링크 ID는 이벤트 ID이므로 cmid로 오인 방지
        }

        // 강좌명 추론: 캘린더 이벤트 DOM의 강좌 링크 또는 텍스트
        const courseLink = li.closest('td')?.querySelector('.course-name, a[href*="/course/view.php"]') ||
                           li.querySelector('a[href*="/course/view.php"]');
        let inferredCourseName = courseLink ? this.cleanCourseName(courseLink.innerText) : '';

        // modId 및 강좌명+제목 매핑으로 정확한 활동 상태 획득
        let statusInfo = modId ? globalStatusMap[modId] : null;
        if (!statusInfo && title) {
          const cleanT = title.replace(/\s+/g, '');
          // 우선 추론된 강좌명으로 탐색
          if (inferredCourseName && nameStatusMap[`${inferredCourseName}_${cleanT}`]) {
            statusInfo = nameStatusMap[`${inferredCourseName}_${cleanT}`];
          } else {
            // 전체 강좌 중 타이틀이 일치하는 활동 탐색
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

    // 5. 활동별 시작일 및 마감일(기간) 산출 및 유니크 활동 목록 구성 (강좌별 독립 키 적용으로 오염 방지)
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
        // 둘 중 하나라도 완료 상태가 아니면 미완료로 정확히 유지 (오탐 방지)
        if (ev.isCompleted !== undefined && !ev.isCompleted) {
          existing.isCompleted = false;
        }
        if (ev.parsedPeriod && !existing.parsedPeriod) {
          existing.parsedPeriod = ev.parsedPeriod;
        }
      }
    });

    const uniqueActivities = Array.from(uniqueMap.values());

    // 오늘 날짜 기준 D-Day 및 기간/상태(완료: 초록, 지난것: 회색, 안된것: 빨강) 계산
    const todayDate = new Date();
    const currentDay = todayDate.getDate();

    uniqueActivities.forEach(item => {
      const diff = item.dueDay - currentDay;
      item.dDayDiff = diff;

      // 상태 분류:
      // 1. 완료: 초록색 ('done')
      // 2. 지난 것 (마감 지남 & 미완료): 회색 ('passed')
      // 3. 안된 것 (미완료 & 마감 전/당일): 빨간색 ('pending')
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

      // 기간 텍스트: 몇월 며칠(요일)부터 몇월 며칠(요일)까지
      item.periodText = this.formatPeriodText(item.parsedPeriod, curYear, curMonth, item.startDay, item.dueDay);
    });

    // 각 날짜(day)별 최종 마감 활동 매핑
    const dayDueActivitiesMap = {};
    uniqueActivities.forEach(act => {
      if (!dayDueActivitiesMap[act.dueDay]) {
        dayDueActivitiesMap[act.dueDay] = [];
      }
      dayDueActivitiesMap[act.dueDay].push(act);
    });

    // 정렬: 안된 것(빨강) -> 지난 것(회색) -> 완료(초록), 마감 임박 순
    uniqueActivities.sort((a, b) => {
      const rank = { pending: 1, passed: 2, done: 3 };
      if (rank[a.statusType] !== rank[b.statusType]) {
        return rank[a.statusType] - rank[b.statusType];
      }
      return a.dueDay - b.dueDay;
    });

    return {
      monthTitle,
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

    // 1. 헤더 업데이트 (2026년 위에, 9월 크게 중앙)
    const yearEl = document.querySelector('#plato-cal-year-text');
    if (yearEl) yearEl.innerText = `${curYear}년`;

    const monthEl = document.querySelector('#plato-cal-month-text');
    if (monthEl) monthEl.innerText = `${curMonth}월`;

    // 2. 대형 캘린더 그리드 렌더링
    this.renderLargeDaysGrid(days);

    // 3. 상세 패널 렌더링
    this.renderDetailPanel();
  },

  renderLargeDaysGrid(days) {
    const grid = document.querySelector('#plato-large-days-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const dayDueMap = this.cachedData?.dayDueActivitiesMap || {};

    // 1일 요일 맞춤 빈 셀
    const firstDay = days[0];
    if (firstDay && firstDay.day === 1) {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      const startDayOfWeek = d.getDay();
      for (let i = 0; i < startDayOfWeek; i++) {
        const empty = document.createElement('div');
        empty.className = 'plato-large-day-cell empty';
        grid.appendChild(empty);
      }
    }

    days.forEach((d) => {
      const cell = document.createElement('div');
      cell.className = 'plato-large-day-cell';
      if (d.isToday) cell.classList.add('today');
      if (this.selectedDay === d.day) cell.classList.add('selected');

      const now = new Date();
      const dayOfWeek = new Date(now.getFullYear(), now.getMonth(), d.day).getDay();
      if (dayOfWeek === 0) cell.classList.add('weekend-sun');
      if (dayOfWeek === 6) cell.classList.add('weekend-sat');

      const dueActs = dayDueMap[d.day] || [];
      const pendingCount = dueActs.filter(a => a.statusType === 'pending').length;
      const doneCount = dueActs.filter(a => a.statusType === 'done').length;
      const passedCount = dueActs.filter(a => a.statusType === 'passed').length;

      // 상태별 셀 하이라이트 (안된 것 있으면 빨간 액센트, 전부 완료면 초록 액센트)
      if (pendingCount > 0) {
        cell.classList.add('has-pending');
      } else if (doneCount > 0 && passedCount === 0) {
        cell.classList.add('all-done');
      }

      // 상단 행: 일자 숫자 + 직관적인 큰 색상 뱃지
      let countBadgeHtml = '';
      if (pendingCount > 0) {
        countBadgeHtml = `<span class="plato-day-badge badge-pending">${pendingCount}</span>`;
      } else if (doneCount > 0) {
        countBadgeHtml = `<span class="plato-day-badge badge-done">✓</span>`;
      } else if (passedCount > 0) {
        countBadgeHtml = `<span class="plato-day-badge badge-passed">${passedCount}</span>`;
      }

      // 셀 내부 칩들: 색상이 크고 직관적으로 드러남 (안된것: 빨강, 지난것: 회색, 완료: 초록)
      let chipsHtml = '';
      if (dueActs.length > 0) {
        const maxDisplay = 2;
        const visibleActs = dueActs.slice(0, maxDisplay);
        const remainCount = dueActs.length - maxDisplay;

        const chipsList = visibleActs.map(act => {
          return `
            <span class="plato-event-chip chip-${act.statusType}" title="[${act.courseName}] ${act.title}">
              [${act.type}] ${act.title}
            </span>
          `;
        }).join('');

        const moreBadge = remainCount > 0 ? `<div class="plato-more-chips-badge">+${remainCount}</div>` : '';
        chipsHtml = `<div class="plato-day-events-container">${chipsList}${moreBadge}</div>`;
      } else {
        chipsHtml = `<div class="plato-day-events-container"></div>`;
      }

      const dayTooltip = d.isToday ? `오늘 (${d.day}일)` : `${d.day}일`;
      cell.innerHTML = `
        <div class="plato-day-top-row">
          <span class="plato-day-num" title="${dayTooltip}">${d.day}</span>
          ${countBadgeHtml}
        </div>
        ${chipsHtml}
      `;

      // 클릭 시 선택/토글 및 상세 패널 갱신
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
    const grid = document.querySelector('#plato-detail-cards-grid');
    const titleText = document.querySelector('#plato-detail-title-text');
    const closeBtn = document.querySelector('#plato-detail-close-btn');
    if (!grid || !this.cachedData) return;

    let items = this.cachedData.activities || [];

    if (this.selectedDay !== null) {
      items = items.filter(a => a.dueDay === this.selectedDay);
      const curYear = this.cachedData.curYear;
      const curMonth = this.cachedData.curMonth;
      const d = new Date(curYear, curMonth - 1, this.selectedDay);
      const dayName = this.WEEKDAYS_KO[d.getDay()] || '';
      if (titleText) titleText.innerText = `${curMonth}월 ${this.selectedDay}일 (${dayName}) 마감 일정 (${items.length})`;
      if (closeBtn) closeBtn.style.display = 'inline-block';
    } else {
      if (titleText) titleText.innerText = `전체 마감 일정 (${items.length})`;
      if (closeBtn) closeBtn.style.display = 'none';
    }

    if (items.length === 0) {
      grid.innerHTML = `
        <div class="plato-tasks-empty">
          <span>${this.selectedDay !== null ? `${this.selectedDay}일에 예정된 마감 일정이 없습니다.` : '등록된 마감 일정이 없습니다.'}</span>
        </div>
      `;
      return;
    }

    // 카드 렌더링: 두꺼운 상태 바(좌측 6px), 큰 상태 뱃지, 기간(몇월몇일 ~ 몇월몇일)
    grid.innerHTML = items.map(item => {
      return `
        <a href="${item.href}" class="plato-task-card card-${item.statusType}" target="_blank" rel="noopener noreferrer">
          <div class="plato-task-card-header">
            <span class="plato-task-course">[${item.type}] ${item.courseName}</span>
            <span class="plato-task-status-badge badge-${item.statusType}">${item.statusLabel}</span>
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

const attemptLogin = () => {
  if (!chrome.runtime?.id) return;
  try {
    const host = window.location.hostname;
    const href = window.location.href;
    const path = window.location.pathname;

    chrome.storage.local.get([
      "hjsId", "hjsPw", "hjsToggle", "hjsPopupClose",
      "userId", "userPw", "popupToggle", "platoPopupClose", "platoCalendarToggle",
      "bbitsId", "bbitsPw", "bbitsToggle", "bbitsPopupClose"
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
      if (!data.bbitsToggle) return;
      if (document.querySelector('[data-action*="logout"], .logout, a[href*="logout"]')) return;

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

    if (host === "plato.pusan.ac.kr") {
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
        const continueLink = document.querySelector('#region-main a[href*="plato.pusan.ac.kr"]');
        if (continueLink) {
          continueLink.click();
          return;
        }
      }

      // 3. 로그인 여부 판단
      const hasUserIndicator = document.body.classList.contains('loggedin') ||
                               !!document.querySelector('.logout, a[href*="/login/logout.php"], .usermenu, .userpicture, .userbutton');
      const hasNotLoggedInClass = document.body.classList.contains('notloggedin');
      const loginBtnOnPage = document.querySelector('.usermenu a[href*="/login/index.php"], header a[href*="/login/index.php"], .login-btn, .btn-login');

      const isLoggedIn = hasUserIndicator && !hasNotLoggedInClass;
      const isNotLoggedIn = hasNotLoggedInClass || (!hasUserIndicator && !!loginBtnOnPage);

      // 4. 세션 만료 다이얼로그/모달 감지 및 자동 재로그인 처리
      // Moodle Coursemos 공식 세션 만료 모달 구조:
      // <div class="modal moodle-has-zindex show" data-region="modal-container" role="dialog" ...>
      //   <div class="modal-body" data-region="body">일정 시간 동안 활동이 없어 로그아웃되었습니다. 다시 로그인해 주세요.</div>
      //   <div class="modal-footer" data-region="footer">
      //     <button type="button" class="btn btn-primary" data-action="save">다시 로그인</button>
      //   </div>
      // </div>
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
                sessionStorage.setItem('plato_need_calendar_refresh', '1');
                reloginBtn.click();
              }

              // 버튼 클릭 이벤트 후 브라우저가 이동하지 않을 경우 대비: 현재 URL을 wantsurl로 보존하여 로그인 페이지로 안전 이동
              const currentUrl = window.location.href;
              setTimeout(() => {
                if (!window.location.pathname.includes('/login/')) {
                  sessionStorage.setItem('plato_need_calendar_refresh', '1');
                  window.location.href = `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(currentUrl)}`;
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
          sessionStorage.setItem('plato_need_calendar_refresh', '1');
          directSaveBtn.click();
          const currentUrl = window.location.href;
          setTimeout(() => {
            if (!window.location.pathname.includes('/login/')) {
              sessionStorage.setItem('plato_need_calendar_refresh', '1');
              window.location.href = `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(currentUrl)}`;
            }
          }, 500);
          return;
        }
      }

      // 5. 로그인 페이지(https://plato.pusan.ac.kr/login/index.php)인 경우: 자동 로그인 수행
      if (path.includes("/login/index.php") || path.includes("/login/")) {
        // 실제 비밀번호 불일치 오류 메시지 감지 시 무한 루프 방지
        const errText = (document.querySelector('.alert, .loginerrors')?.innerText || "").trim();
        if (/잘못된|불일치|일치하지|아이디 또는 비밀번호|invalid/i.test(errText)) {
          return;
        }

        // 기본 활성 탭(교내 구성원 SSO 폼 #form-login-sso) 타겟팅
        const loginForm = document.querySelector('#form-login-sso') ||
                          document.querySelector('.tab-pane.active form') ||
                          document.querySelector('form.tab-content-container') ||
                          document.querySelector('form[action*="login"]');

        if (loginForm && !loginForm.dataset.autoLoggingIn) {
          const u = loginForm.querySelector('#input-username') || loginForm.querySelector('input[name="username"]');
          const p = loginForm.querySelector('#input-password') || loginForm.querySelector('input[name="password"]');
          const b = loginForm.querySelector('.btn-login') ||
                    loginForm.querySelector('button[name="loginbutton"]') ||
                    loginForm.querySelector('button[type="submit"]');

          if (u && p && b && data.userId && data.userPw) {
            loginForm.dataset.autoLoggingIn = "1";
            sessionStorage.setItem('plato_need_calendar_refresh', '1');

            // 값 주입 및 Bouncer 유효성 검사기 통과용 이벤트 발생
            u.value = data.userId;
            u.dispatchEvent(new Event('input', { bubbles: true }));
            u.dispatchEvent(new Event('change', { bubbles: true }));
            u.dispatchEvent(new Event('blur', { bubbles: true }));

            p.value = data.userPw;
            p.dispatchEvent(new Event('input', { bubbles: true }));
            p.dispatchEvent(new Event('change', { bubbles: true }));
            p.dispatchEvent(new Event('blur', { bubbles: true }));

            // 단 1회 클릭으로 자연스러운 폼 제출 진행 (2차 중복 제출 절대 금지)
            setTimeout(() => {
              if (!b.disabled) {
                b.click();
              }
            }, 80);
            return;
          }
        }
      }

      // 6. 메인 페이지나 일반 페이지에서 비로그인 상태일 때 로그인 페이지로 즉시 자동 전환
      if (!isLoggedIn && isNotLoggedIn && data.userId && data.userPw) {
        if (!path.includes("/login/index.php") && !path.includes("/login/")) {
          if (!document.body.dataset.loginRedirecting) {
            document.body.dataset.loginRedirecting = "1";
            const isHome = path === "/" || path === "/index.php" || path === "";
            let loginUrl = `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(href)}`;
            if (isHome) {
              if (data.platoCalendarToggle !== false) {
                const targetUrl = "https://plato.pusan.ac.kr/local/ubion/allcourse/regular/index.php";
                loginUrl = `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(targetUrl)}`;
              } else {
                loginUrl = "https://plato.pusan.ac.kr/login/index.php";
              }
            }
            window.location.href = loginUrl;
            return;
          }
        }
      }

      // 7. 로그인 완료 시: 홈 화면 진입 감지 시 교과과정 페이지로 자동 이동 및 캘린더 초기화
      if (isLoggedIn) {
        sessionStorage.removeItem('plato_login_failed');

        // 플라토 메인 홈(/ 또는 /index.php)인 경우 자동으로 교과과정 페이지로 이동
        // 캘린더 기능이 OFF인 경우 홈→교과과정 리다이렉트도 비활성화
        const isHome = path === "/" || path === "/index.php" || path === "";
        if (isHome && data.platoCalendarToggle !== false) {
          const now = Date.now();
          const lastRedirect = parseInt(sessionStorage.getItem('plato_last_course_redirect') || '0', 10);
          // 무한 루프 방지: 3초 이내 중복 리다이렉트 방지
          if (now - lastRedirect > 3000) {
            sessionStorage.setItem('plato_last_course_redirect', now.toString());
            window.location.replace("https://plato.pusan.ac.kr/local/ubion/allcourse/regular/index.php");
            return;
          }
        }

        // 교과과정 페이지인 경우 플라토 스마트 캘린더 위젯 초기화
        if (path.includes("/local/ubion/allcourse/regular/index.php") || path.includes("/local/ubion/allcourse/")) {
          PlatoCalendar.init();
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

// 교과과정 페이지 진입 시 지연 없이 캘린더 즉시 초기화
if (window.location.hostname === "plato.pusan.ac.kr" &&
    (window.location.pathname.includes("/local/ubion/allcourse/regular/index.php") || window.location.pathname.includes("/local/ubion/allcourse/"))) {
  PlatoCalendar.init();
}