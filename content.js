/* ==========================================================================
   PLATO SMART CALENDAR & DASHBOARD ENGINE
   ========================================================================== */
const PlatoCalendar = {
  cooldownSeconds: 60,
  timerId: null,
  selectedDay: null,
  showOnlyPending: false,
  cachedData: null,

  init() {
    if (window !== window.top) return;
    const path = window.location.pathname;
    if (!path.includes('/local/ubion/allcourse/regular/index.php') && !path.includes('/local/ubion/allcourse/')) return;

    // 중복 삽입 방지
    if (document.querySelector('#plato-calendar-widget')) return;

    this.mountWidgetSkeleton();
    this.loadCachedData();
  },

  mountWidgetSkeleton() {
    // 위젯 삽입 대상 컨테이너 탐색
    const target = document.querySelector('.open-content') ||
                   document.querySelector('#region-main .allcourse-list')?.parentElement ||
                   document.querySelector('#region-main') ||
                   document.querySelector('#page-content');
    if (!target) return;

    const widget = document.createElement('div');
    widget.id = 'plato-calendar-widget';
    widget.innerHTML = `
      <div class="plato-cal-header">
        <div class="plato-cal-title-area">
          <span class="plato-cal-badge">PLATO SMART CALENDAR</span>
          <h2 class="plato-cal-title">🎓 <span id="plato-cal-month-text">학업 캘린더</span></h2>
          <div class="plato-cal-stats">
            <span class="plato-stat-chip plato-stat-total" id="plato-stat-total">총 0건</span>
            <span class="plato-stat-chip plato-stat-done" id="plato-stat-done">✓ 0건 완료</span>
            <span class="plato-stat-chip plato-stat-pending" id="plato-stat-pending">⏳ 0건 미완료</span>
          </div>
        </div>
        <div class="plato-cal-controls">
          <button type="button" class="plato-filter-btn" id="plato-filter-toggle">
            <span id="plato-filter-icon">⚡</span> <span id="plato-filter-text">미완료만 보기</span>
          </button>
          <button type="button" class="plato-refresh-btn" id="plato-refresh-btn">
            <span class="plato-refresh-icon">🔄</span> <span id="plato-refresh-text">새로고침</span>
          </button>
        </div>
      </div>
      <div class="plato-cal-body">
        <div class="plato-cal-grid-card">
          <div class="plato-cal-grid-header">
            <span class="plato-cal-month-label" id="plato-grid-month-label">달력 불러오는 중...</span>
            <button type="button" class="plato-cal-today-btn" id="plato-today-btn">전체 보기</button>
          </div>
          <div class="plato-cal-weekdays">
            <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
          </div>
          <div class="plato-cal-days-grid" id="plato-days-grid">
            <!-- 일자 셀이 여기에 렌더링됨 -->
          </div>
        </div>
        <div class="plato-cal-tasks-area">
          <div class="plato-tasks-header">
            <span class="plato-tasks-title">📌 <span id="plato-tasks-title-text">마감 예정 과제 및 강의</span></span>
            <span class="plato-tasks-count" id="plato-tasks-count">0개 항목</span>
          </div>
          <div class="plato-tasks-list" id="plato-tasks-list">
            <div class="plato-tasks-empty">
              <span class="plato-empty-icon">⏳</span>
              <span>데이터를 불러오는 중입니다...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    target.insertBefore(widget, target.firstChild);

    // 이벤트 바인딩
    document.querySelector('#plato-refresh-btn')?.addEventListener('click', () => {
      this.handleManualRefresh();
    });

    document.querySelector('#plato-filter-toggle')?.addEventListener('click', () => {
      this.showOnlyPending = !this.showOnlyPending;
      const btn = document.querySelector('#plato-filter-toggle');
      if (this.showOnlyPending) {
        btn?.classList.add('active');
        const txt = document.querySelector('#plato-filter-text');
        if (txt) txt.innerText = '전체 보기';
      } else {
        btn?.classList.remove('active');
        const txt = document.querySelector('#plato-filter-text');
        if (txt) txt.innerText = '미완료만 보기';
      }
      this.render();
    });

    document.querySelector('#plato-today-btn')?.addEventListener('click', () => {
      this.selectedDay = null;
      document.querySelectorAll('.plato-cal-day-cell.selected').forEach(c => c.classList.remove('selected'));
      this.renderTasks();
    });
  },

  loadCachedData() {
    chrome.storage.local.get(['plato_calendar_data', 'plato_calendar_last_fetch'], (res) => {
      if (chrome.runtime.lastError) return;
      const now = Date.now();
      const lastFetch = res.plato_calendar_last_fetch || 0;
      const elapsed = now - lastFetch;

      if (res.plato_calendar_data && res.plato_calendar_data.activities) {
        this.cachedData = res.plato_calendar_data;
        this.render();
      }

      // 쿨다운 타이머 시작 (60초 이내인 경우)
      if (elapsed < this.cooldownSeconds * 1000) {
        this.startCooldownTimer(Math.ceil((this.cooldownSeconds * 1000 - elapsed) / 1000));
      } else {
        // 1분 이상 지났거나 캐시가 없으면 자동 새로고침 1회 수행
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
    if (btn) {
      btn.classList.add('loading');
      btn.disabled = true;
    }
    if (txt) txt.innerText = '갱신 중...';

    try {
      const data = await this.scrapeAllData();
      this.cachedData = data;
      const now = Date.now();
      chrome.storage.local.set({
        plato_calendar_data: data,
        plato_calendar_last_fetch: now
      });
      this.render();
      this.startCooldownTimer(this.cooldownSeconds);
    } catch (e) {
      console.error('Failed to fetch plato calendar data:', e);
      if (btn) btn.disabled = false;
      if (txt) txt.innerText = '새로고침 실패 (재시도)';
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  },

  async scrapeAllData() {
    // 1. Moodle 월별 캘린더 View Fetch
    const calResp = await fetch('https://plato.pusan.ac.kr/calendar/view.php?view=month', { credentials: 'same-origin' });
    const calText = await calResp.text();
    const calDoc = new DOMParser().parseFromString(calText, 'text/html');

    const monthTitle = calDoc.querySelector('h2.current, h2')?.innerText?.trim() || '이번 달 일정';

    // 2. 현재 페이지(교과과정 페이지) DOM에서 수강 강좌 ID 및 이름 추출
    const courseLinks = document.querySelectorAll('a[href*="/course/view.php?id="]');
    const coursesMap = new Map();
    courseLinks.forEach(a => {
      const m = a.href.match(/id=([0-9]+)/);
      if (m) {
        const id = m[1];
        let name = a.innerText.replace(/^[0-9]+년\s+[0-9]+학기\s+교과과정\s+학부\s*/, '').trim();
        name = name.replace(/\s+/g, ' ');
        if (name && !coursesMap.has(id)) {
          coursesMap.set(id, { id, name });
        }
      }
    });
    const courses = Array.from(coursesMap.values());

    // 3. 각 강좌별 활동 현황(/report/ublogs/student/activity.php) 및 과제(/mod/assign/index.php) 병렬 Fetch
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
          actDoc.querySelectorAll('tr[data-modname]').forEach(tr => {
            const link = tr.querySelector('td.td-activity a[href*="id="]');
            if (link) {
              const m = link.href.match(/id=([0-9]+)/);
              if (m) {
                const modId = m[1];
                const isCompleted = tr.querySelector('td.td-status')?.innerText.includes('완료') || false;
                const completedAt = tr.querySelector('td.td-date')?.innerText.trim() || '';
                const name = tr.querySelector('.name')?.innerText?.trim() || link.innerText.trim();
                info.items[modId] = {
                  modId,
                  name,
                  courseName: c.name,
                  isCompleted,
                  completedAt
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
                const isCompleted = tr.innerText.includes('제출 완료');
                if (!info.items[modId]) {
                  info.items[modId] = {
                    modId,
                    name: link.innerText.trim(),
                    courseName: c.name,
                    isCompleted
                  };
                } else {
                  info.items[modId].isCompleted = isCompleted;
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

    // 전체 상태 맵 구성
    const globalStatusMap = {};
    statusResults.forEach(sr => {
      Object.assign(globalStatusMap, sr.items);
    });

    // 4. 캘린더 날짜별 이벤트 파싱
    const rawEvents = [];
    const days = [];
    const dayCells = calDoc.querySelectorAll('td.day');

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
        const a = li.querySelector('a[href*="/mod/"]');
        const href = a ? a.href : '';
        let title = a ? (a.getAttribute('title') || a.innerText) : '';
        title = title.replace(/&nbsp;/g, ' ').replace(/기한$/, '').trim();

        const modIdMatch = href.match(/id=([0-9]+)/);
        const modId = modIdMatch ? modIdMatch[1] : '';

        const statusInfo = globalStatusMap[modId];
        const isCompleted = statusInfo ? statusInfo.isCompleted : false;
        const courseName = statusInfo ? statusInfo.courseName : '교과과정';

        const ev = {
          day,
          eventId,
          modId,
          comp,
          type: comp === 'mod_assign' ? '과제' : comp === 'mod_vod' ? '동영상' : comp === 'mod_quiz' ? '퀴즈' : '활동',
          title,
          href,
          isCompleted,
          courseName
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

    // 5. 마감 일정 목록을 위한 유니크 활동 목록 구성 (중복 날짜 제거 및 최종 마감일 산출)
    const uniqueMap = new Map();
    rawEvents.forEach(ev => {
      const key = ev.modId || ev.eventId || ev.title;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { ...ev, dueDay: ev.day });
      } else {
        const existing = uniqueMap.get(key);
        if (ev.day > existing.dueDay) {
          existing.dueDay = ev.day;
        }
        if (ev.isCompleted) {
          existing.isCompleted = true;
        }
      }
    });

    const uniqueActivities = Array.from(uniqueMap.values());

    // 오늘 날짜 기준 D-Day 계산
    const todayDate = new Date();
    const currentDay = todayDate.getDate();

    uniqueActivities.forEach(item => {
      const diff = item.dueDay - currentDay;
      item.dDayDiff = diff;
      if (diff === 0) {
        item.dDayText = 'D-Day (오늘 마감)';
        item.dDayClass = 'urgent';
      } else if (diff === 1) {
        item.dDayText = 'D-1 (내일 마감)';
        item.dDayClass = 'urgent';
      } else if (diff > 1 && diff <= 3) {
        item.dDayText = `D-${diff}`;
        item.dDayClass = 'soon';
      } else if (diff > 3) {
        item.dDayText = `D-${diff}`;
        item.dDayClass = 'normal';
      } else {
        item.dDayText = '기한 지남';
        item.dDayClass = 'passed';
      }
    });

    // 정렬: 미완료 우선, 마감 임박 순
    uniqueActivities.sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
      return a.dueDay - b.dueDay;
    });

    return {
      monthTitle,
      days,
      activities: uniqueActivities
    };
  },

  render() {
    if (!this.cachedData) return;
    const { monthTitle, days, activities } = this.cachedData;

    const monthEl = document.querySelector('#plato-cal-month-text');
    if (monthEl) monthEl.innerText = monthTitle || '학업 캘린더';

    const gridMonthLabel = document.querySelector('#plato-grid-month-label');
    if (gridMonthLabel) gridMonthLabel.innerText = monthTitle || '월간 달력';

    const totalCount = activities.length;
    const doneCount = activities.filter(a => a.isCompleted).length;
    const pendingCount = totalCount - doneCount;

    const totalEl = document.querySelector('#plato-stat-total');
    if (totalEl) totalEl.innerText = `총 ${totalCount}건`;

    const doneEl = document.querySelector('#plato-stat-done');
    if (doneEl) doneEl.innerText = `✓ ${doneCount}건 완료`;

    const pendingEl = document.querySelector('#plato-stat-pending');
    if (pendingEl) pendingEl.innerText = `⏳ ${pendingCount}건 미완료`;

    this.renderDaysGrid(days);
    this.renderTasks();
  },

  renderDaysGrid(days) {
    const grid = document.querySelector('#plato-days-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDay = days[0];
    if (firstDay && firstDay.day === 1) {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      const startDayOfWeek = d.getDay(); // 0(Sun) ~ 6(Sat)
      for (let i = 0; i < startDayOfWeek; i++) {
        const empty = document.createElement('div');
        empty.className = 'plato-cal-day-cell empty';
        grid.appendChild(empty);
      }
    }

    days.forEach(d => {
      const cell = document.createElement('div');
      cell.className = 'plato-cal-day-cell';
      if (d.isToday) cell.classList.add('today');
      if (this.selectedDay === d.day) cell.classList.add('selected');

      const hasEvents = d.events && d.events.length > 0;
      if (hasEvents) cell.classList.add('has-event');

      let dotsHtml = '';
      if (hasEvents) {
        const hasPending = d.events.some(e => !e.isCompleted);
        const hasDone = d.events.some(e => e.isCompleted);
        dotsHtml = `
          <div class="plato-cal-dots">
            ${hasPending ? '<span class="plato-cal-dot pending"></span>' : ''}
            ${hasDone ? '<span class="plato-cal-dot done"></span>' : ''}
          </div>
        `;
      }

      cell.innerHTML = `<span>${d.day}</span>${dotsHtml}`;

      cell.addEventListener('click', () => {
        if (this.selectedDay === d.day) {
          this.selectedDay = null;
          cell.classList.remove('selected');
        } else {
          document.querySelectorAll('.plato-cal-day-cell.selected').forEach(c => c.classList.remove('selected'));
          this.selectedDay = d.day;
          cell.classList.add('selected');
        }
        this.renderTasks();
      });

      grid.appendChild(cell);
    });
  },

  renderTasks() {
    const list = document.querySelector('#plato-tasks-list');
    const countEl = document.querySelector('#plato-tasks-count');
    const titleText = document.querySelector('#plato-tasks-title-text');
    if (!list || !this.cachedData) return;

    let items = this.cachedData.activities || [];

    if (this.selectedDay !== null) {
      items = items.filter(a => a.dueDay === this.selectedDay);
      if (titleText) titleText.innerText = `${this.selectedDay}일 마감 과제 및 강의`;
    } else {
      if (titleText) titleText.innerText = '마감 예정 과제 및 강의';
    }

    if (this.showOnlyPending) {
      items = items.filter(a => !a.isCompleted);
    }

    if (countEl) countEl.innerText = `${items.length}개 항목`;

    if (items.length === 0) {
      list.innerHTML = `
        <div class="plato-tasks-empty">
          <span class="plato-empty-icon">🎉</span>
          <span>해당 조건의 마감 일정이 없습니다.</span>
        </div>
      `;
      return;
    }

    list.innerHTML = items.map(item => {
      const icon = item.type === '과제' ? '📝' : item.type === '동영상' ? '🎬' : '📋';
      const iconClass = item.type === '과제' ? 'assign' : item.type === '동영상' ? 'vod' : 'quiz';
      const statusClass = item.isCompleted ? 'done' : 'pending';
      const statusText = item.isCompleted ? '✓ 완료됨' : '⏳ 미완료';

      return `
        <a href="${item.href}" class="plato-task-card" target="_blank" rel="noopener noreferrer">
          <div class="plato-task-left">
            <div class="plato-task-icon-box ${iconClass}">
              ${icon}
            </div>
            <div class="plato-task-details">
              <span class="plato-task-course">${item.courseName}</span>
              <span class="plato-task-name" title="${item.title}">${item.title}</span>
              <div class="plato-task-meta">
                <span class="plato-task-date">📅 ${item.dueDay}일 마감</span>
                <span class="plato-task-dday ${item.dDayClass}">${item.dDayText}</span>
              </div>
            </div>
          </div>
          <div class="plato-task-status-badge ${statusClass}">
            ${statusText}
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
      "userId", "userPw", "popupToggle", "platoPopupClose",
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
      const loginBtnOnPage = document.querySelector('a[href*="/login/index.php"]');
      const isNotLoggedIn = document.body.classList.contains('notloggedin') || !!loginBtnOnPage;
      const isLoggedIn = !isNotLoggedIn && (
        document.body.classList.contains('loggedin') ||
        !!document.querySelector('.logout, a[href*="/login/logout.php"], .usermenu, .userpicture')
      );

      // 4. 세션 만료 다이얼로그/모달 감지 및 재로그인 처리
      const sessionModal = document.querySelector('.moodle-dialogue, .modal.show, div[role="alertdialog"], div[role="dialog"]');
      if (sessionModal && !sessionModal.dataset.sessionHandled) {
        const modalText = sessionModal.innerText || "";
        if (/세션|만료|timeout|로그아웃|다시\s*로그인/i.test(modalText)) {
          sessionModal.dataset.sessionHandled = "1";
          const loginBtn = sessionModal.querySelector('a[href*="login"], button.btn-primary');
          if (loginBtn) {
            loginBtn.click();
            return;
          } else {
            window.location.href = "https://plato.pusan.ac.kr/login/index.php";
            return;
          }
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
            const targetUrl = "https://plato.pusan.ac.kr/local/ubion/allcourse/regular/index.php";
            const loginUrl = (path === "/" || path === "/index.php" || path === "")
              ? `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(targetUrl)}`
              : `https://plato.pusan.ac.kr/login/index.php?wantsurl=${encodeURIComponent(href)}`;
            window.location.href = loginUrl;
            return;
          }
        }
      }

      // 7. 로그인 완료 시: 홈 화면 진입 감지 시 교과과정 페이지로 자동 이동 및 캘린더 초기화
      if (isLoggedIn) {
        sessionStorage.removeItem('plato_login_failed');

        // 플라토 메인 홈(/ 또는 /index.php)인 경우 자동으로 교과과정 페이지로 이동
        const isHome = path === "/" || path === "/index.php" || path === "";
        if (isHome) {
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

// 세션 만료 감시를 위한 주기적 체크 (30초마다)
const checkInterval = setInterval(() => {
  if (!chrome.runtime?.id) {
    clearInterval(checkInterval);
    return;
  }
  attemptLogin();
}, 30000);

// 교과과정 페이지 진입 시 지연 없이 캘린더 즉시 초기화
if (window.location.hostname === "plato.pusan.ac.kr" &&
    (window.location.pathname.includes("/local/ubion/allcourse/regular/index.php") || window.location.pathname.includes("/local/ubion/allcourse/"))) {
  PlatoCalendar.init();
}