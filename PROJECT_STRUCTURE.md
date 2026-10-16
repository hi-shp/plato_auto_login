# 프로젝트 구조와 동작

## 파일과 로딩 순서

| 경로 | 역할 |
| --- | --- |
| `manifest.json` | Manifest V3 설정. `storage`·`webNavigation` 권한, 기존 7개 사이트 host 권한, 팝업·아이콘과 서비스 워커 지정. |
| `navigation-worker.js` | HTML 도착 전 탐색 URL과 새 탭 목적지를 탭 ID별 `storage.session`에 보관. SSO 중간 페이지 보호, 정확한 도착 확인, 탭 종료 정리. |
| `navigation.js` | 정규 PLATO 최상위 프레임의 `document_start`에서 목적지·설정을 병렬 조회. 로그인 상태가 확인되면 홈 공지와 캘린더 초기화를 기다리지 않고 이동. 실제 홈 메뉴 클릭은 보존. |
| `notice-early.js` | 정규 PLATO 홈 최상위 프레임의 `document_start`에서 공지 전용 표시 억제. 설정 ON 동안 유지하고 설정 변경·조회 실패·후속 스크립트 로딩 실패를 처리. |
| `calendar-time.js`, `notice.js`, `content.js` | 순서대로 모든 허용 사이트의 모든 프레임에 `document_end`에서 로드. 서울 시간 기준 일정 계산, 확인된 PLATO 홈 공지 처리, 로그인·캘린더 처리. |
| `event.js` | `login.pusan.ac.kr`와 `onestop.pusan.ac.kr`의 MAIN world에 `document_start`에서 로드. 페이지 함수 `ssoOpen`, `changeNextPw` 호출. |
| `calendar.css` | `content.js`와 함께 주입. 두 캘린더 위젯 ID와 공통 `.plato-*` 클래스에 스타일 적용. |
| `popup.html`, `popup.js` | 설정 화면. HTML의 인라인 CSS와 SVG, JS의 입력·체크박스 이벤트 사용. |
| `favicon.png` | 팝업 액션과 확장 아이콘. |
| `images/` | README 설명용 이미지. 확장 실행에는 필요 없음. |
| `scripts/release.py` | 정적 검증과 참조 파일 기반 ZIP 생성·검증. |
| `scripts/verify.py` | 정적 검사, 단위·브라우저 회귀 검사와 선택적 ZIP 생성의 릴리스 품질 게이트. |
| `scripts/benchmark_refresh.js` | 이전 버전과 현재 버전의 캘린더 첫 렌더링을 동일한 모의 응답 지연으로 비교. 실제 LMS에는 접속하지 않음. |
| `scripts/benchmark_login.py`, `LOGIN_PERFORMANCE.md` | 격리 Chrome과 익명 인증 서버로 이전 릴리스·현재 소스의 로그인 이동 시간을 비교하고 측정 조건·한계를 기록. |
| `requirements-test.txt` | Chrome E2E 실행용 Python 패키지. 배포 ZIP에서는 제외. |
| `tests/unit/`, `tests/fixtures/`, `tests/e2e/` | 시각·이동 단위 테스트, 익명화된 로컬 재현 페이지, Selenium Chrome 브라우저 테스트. 배포 ZIP에서는 제외. |
| `TESTING.md` | 실제 사이트에서 확인한 범위와 모의 테스트 결과·한계. |
| `dist/` | 테스트·웹스토어 스크린샷 등 로컬 산출물. Git 제외. |
| `.agents/rules/git-backup.md`, `AGENTS.md` | 로컬 전용 에이전트 작업 규칙. Git 제외. |
| `plato.zip` | 프로젝트 루트의 최종 웹스토어 제출 패키지. Git 제외. |
| `사진/` | 기존 사용자 작업 자료. 배포 ZIP에 포함하지 않음. |

릴리스 도구는 `node --check`로 JavaScript 구문을 검사합니다. `python scripts/verify.py`는 단위 테스트와 Selenium 브라우저 테스트를 함께 실행합니다. Chrome E2E는 임시 프로필에 테스트용 확장 프로그램을 WebDriver BiDi로 설치하고 로컬 LMS Fixture에서 실행합니다.
manifest 버전은 한국 작업 날짜 + 1일의 `YYYY.MM.DD`를 사용합니다. 같은 날의 수정은 같은 버전을 유지하며 월말·연말도 실제 달력으로 계산합니다. 실제 웹스토어 게시 날짜를 보장하는 값은 아닙니다. `release.py`는 임시 ZIP을 먼저 검증한 뒤 프로젝트 루트의 `plato.zip`을 안전하게 교체합니다. 파일명과 무관하게 ZIP 내부 manifest 버전과 현재 소스를 확인합니다.

## 주요 호출 흐름

- 팝업의 `DOMContentLoaded` → `chrome.storage.local.get`으로 계정·토글 복원 → 입력/변경 이벤트에서 `chrome.storage.local.set`. 캘린더 표시 토글의 기본값은 `true`입니다. 비밀번호 보기, GitHub·웹스토어 링크 클릭도 여기서 처리합니다.
- `content.js` 로드 → `fixVp()`와 `attemptLogin()` 즉시 실행 → DOM 변경을 300ms로 묶는 `MutationObserver` 및 2초 간격 점검이 `attemptLogin()` 재호출. 확장 컨텍스트 무효화 시 중지합니다. 각 로그인 폼에는 `dataset.done`/`autoLoggingIn` 등의 중복 제출 표식을 사용합니다.
- 학생지원시스템: `content.js`의 `RUN_PNU_FUNC` 이벤트 → MAIN world `event.js` → 사이트의 SSO/비밀번호 변경 안내 함수. `login.pusan.ac.kr`의 계정 입력과 `onestop.pusan.ac.kr`의 팝업 제거·SSO 버튼을 별도로 처리합니다.
- PLATO: 일반 및 개발 도메인의 로그인 폼 탐색, 오류 메시지에 따른 재시도 중지, 세션 만료 재로그인. 정규 도메인은 클릭 URL → 직접 요청 URL → 세션 만료 전 페이지 → 기본 교과과정 순서로 로그인 후 목적지를 정합니다. `plato_login_intent`와 `plato_auto_login_pending`은 탭별 `sessionStorage`에 최대 5분 유지하고 목적지 도착을 확인한 뒤 정리합니다. 목적지는 HTTPS 정규 PLATO 호스트의 로그인·인증 경로 외로 제한하며 `wantsurl`에도 사용합니다. SSO 도메인을 거쳐 돌아와도 같은 탭의 PLATO 저장소를 읽습니다. 홈 클릭 표식과 캘린더 새로고침 표식 역시 `sessionStorage`에 있습니다. 모든 내부 페이지에서 실제 홈 메뉴를 누른 경우 홈을 1회 유지하고 홈 새로고침은 교과과정으로 이동합니다. 개발 도메인의 기존 URL 복원 동작은 유지합니다. `notice-early.js`는 홈 공지만 첫 표시 전에 숨기고, `notice.js`는 `.modal-ubboard-notice #popup-splide` 및 공식 `data-not-show-type="2"` 버튼을 확인해 처리합니다. 설정 ON 동안 표시 억제를 유지하고 Splide 초기화 후 공식 버튼을 실행합니다. 실패한 요청은 간격을 늘려 재시도하며 캐러셀 제거 후에만 완료로 기록합니다. 설정 OFF·설정 조회 실패·후속 스크립트 누락은 표시 억제를 해제합니다.
- BBITS: `www.bbits.ac.kr` 모달과 `lms.bbits.ac.kr` 로그인 폼을 따로 처리하고 부산대학교 소속을 선택합니다. 로그인 후 LMS 대시보드에서 캘린더를 초기화합니다.

## 탭별 로그인 목적지 (2026-10-14)

`webNavigation.onCreatedNavigationTarget`와 `onBeforeNavigate`에서 새 탭·직접 요청 URL을 HTML 도착 전에 포착한다. `onCommitted`의 서버 리다이렉트는 사용자 직접 요청으로 다시 기록하지 않는다. 현재 탭의 실제 클릭은 `navigation.js`가 기록한다. 우선순위는 클릭 → 직접 요청 → 이전 페이지 → 목적지 없는 첫 로그인의 교과과정이다. `noopener noreferrer`와 캘린더 카드 UI는 유지한다.

서비스 워커의 `plato_navigation_[tabId]`에는 URL·의도·생성 시각·로그인/복원 상태와 이전 도착 페이지만 보관한다. 작업을 탭별 큐로 처리하고 5분 이상 지난 의도는 폐기한다. 서비스 워커 중단 이후에도 `storage.session`에서 복원하며 탭 종료 시 제거한다. 이 저장소는 브라우저 종료나 확장 프로그램 재로드·업데이트 때 초기화된다. 기존 `sessionStorage` 키는 호환성·대체 경로로 유지한다. 목적지는 이동 요청 때 지우지 않고 정확한 경로·쿼리·fragment에 도착한 뒤 정리한다. 복원 요청을 최대 2회로 제한해 루프를 방지한다. 외부 origin, 로그인·인증 경로, 인증정보를 담은 쿼리·fragment는 목적지로 허용하지 않는다.

기존 문서 종료 단계 로그인 폼 처리는 유지한다. 로그인 페이지 URL 또는 기존 숨김 필드의 유효한 `wantsurl`을 사용할 수 있으며, 이미 보관한 클릭 의도가 우선한다. 로그인된 홈의 기본 이동은 `document_start`의 DOM 감시에서 시작할 수 있다. 홈 전체를 숨기지 않으며, 실제 홈 방문 시 공지 전용 처리가 계속 동작한다.

API 동작 근거: [Chrome webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), [Chrome storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage). 추가 권한은 `webNavigation` 하나다. `tabs`·`webRequest` 권한과 외부 공개 메시지 인터페이스는 추가하지 않는다.

## 캘린더와 데이터

캘린더가 직접 삽입된 부모 영역에만 CSS `overflow-anchor: none`을 적용합니다. 비동기 삽입 높이가 Chrome의 재로딩 복원 위치에 더해지는 것을 막고, 위젯이 제거되면 자동 해제합니다. `prepareCalendarViewport()`는 탭별 `sessionStorage`에 마지막 스크롤 좌표를 보관합니다. 같은 경로·쿼리의 재로딩·discard 복원·history 탐색에서만 첫 렌더링 뒤 한 번 위치를 보정합니다. 24시간이 지난 기록, fragment 이동, 인증 파라미터가 있는 URL과 새 탐색은 제외하며, 사용자의 스크롤 입력은 지연된 복원을 취소합니다. 일반 렌더링이나 로그인 목적지 복원에서 저장 좌표를 강제로 적용하지 않습니다. 탭 전환·freeze/resume만으로 새로고침이나 재로그인을 유발하지 않습니다.

`PlatoCalendar`와 `BbitsCalendar`는 각각 `init` → `mountWidgetSkeleton` → `loadCachedData` → `fetchAndRefreshData` → `fetchCourseStatuses`/`fetchCalendarDoc` → `parseCalendarDoc` → `render` 순서로 동작합니다. PLATO는 이 기본 렌더링 뒤 `fetchPreciseTimes`로 정확한 시각을 보강하여 다시 렌더링합니다. 상세 요청은 최대 4개씩 빈 슬롯을 채우고 60초 이내의 시각 캐시를 재사용하며, 강좌 목록의 마감일이 달라지면 해당 캐시를 무효화합니다. 다른 학기 월은 현재 월의 상세 보강 이후 동기화합니다. 해당 사이트의 최상위 프레임과 대상 페이지인지 확인하고 위젯 ID로 중복 삽입을 막습니다. 토글 변경은 `chrome.storage.onChanged`로 반영합니다. 월 이동은 먼저 캐시를 표시하고 60초가 지난 월은 백그라운드에서 재조회하며, `navRequestId`로 오래된 응답의 화면 반영을 막습니다. 요청은 8초 제한과 `credentials: same-origin`을 사용합니다. 실패하면 기존 화면을 유지하고 콘솔에 오류를 남깁니다.

`render()`는 캐시의 월별 날짜 배열을 먼저 보정하고, `CalendarTime`이 로드된 경우에 시각·상태 정보를 갱신합니다. 이전 manifest를 유지한 브라우저에서 새 `content.js`를 읽어도 기본 날짜와 캐시 일정이 남습니다. PLATO는 정규 교과과정, 강좌 활동/과제, Moodle 월간 달력 HTML과 해당 월 활동 상세 페이지의 종료 시각을 파싱합니다. BBITS는 LMS 강좌 VOD의 초 단위 기간과 과제 목록의 분 단위 마감 및 월간 달력을 파싱합니다. `CalendarTime`은 확인된 시각을 서울 시간의 ISO 타임스탬프로 저장하고 날짜별 배치·기한 경과·표시를 계산합니다. 이전 캐시의 날짜만 있는 일정은 시각을 추정하지 않고 `마감 시각 확인 불가`로 표시한 뒤 접속 시 재조회합니다. 완료 항목은 상세 카드에 D-Day 배지를 만들지 않습니다. `calendar.css`의 일부 클래스 선택자는 위젯 ID 밖에서도 일치할 수 있으므로 사이트 DOM 변경 시 충돌을 확인해야 합니다.

| 저장소 키 | 용도 |
| --- | --- |
| `userId`, `userPw`, `popupToggle`, `platoPopupClose`, `platoCalendarToggle` | PLATO 계정과 설정 |
| `hjsId`, `hjsPw`, `hjsToggle`, `hjsPopupClose` | 학생지원시스템 계정과 설정 |
| `bbitsId`, `bbitsPw`, `bbitsToggle`, `bbitsPopupClose`, `bbitsCalendarToggle` | BBITS 계정과 설정 |
| `platoCalendarCollapsed`, `bbitsCalendarCollapsed` | 캘린더 접힘 상태 |
| `plato_calendar_data`, `plato_calendar_months`, `plato_calendar_month_timestamps`, `plato_calendar_last_fetch` | PLATO 일정 캐시 |
| `bbits_calendar_data`, `bbits_calendar_months`, `bbits_calendar_month_timestamps`, `bbits_calendar_last_fetch` | BBITS 일정 캐시 |

실제 사이트 DOM 확인 및 과제 제출의 안전한 중간 단계, 로컬 브라우저 테스트 결과와 추가 확인 항목은 [TESTING.md](./TESTING.md)를 참고하세요.
