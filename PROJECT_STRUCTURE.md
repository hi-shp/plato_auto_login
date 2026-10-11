# 프로젝트 구조와 동작

## 파일과 로딩 순서

| 경로 | 역할 |
| --- | --- |
| `manifest.json` | Manifest V3 설정. `storage` 권한, 7개 사이트 URL의 host 권한, 팝업과 아이콘 지정. |
| `content.js` | 모든 허용 사이트의 모든 프레임에 `document_end`에서 로드. 로그인, 팝업, 캘린더 처리. |
| `event.js` | `login.pusan.ac.kr`와 `onestop.pusan.ac.kr`의 MAIN world에 `document_start`에서 로드. 페이지 함수 `ssoOpen`, `changeNextPw` 호출. |
| `calendar.css` | `content.js`와 함께 주입. 두 캘린더 위젯 ID와 공통 `.plato-*` 클래스에 스타일 적용. |
| `popup.html`, `popup.js` | 설정 화면. HTML의 인라인 CSS와 SVG, JS의 입력·체크박스 이벤트 사용. |
| `favicon.png` | 팝업 액션과 확장 아이콘. |
| `images/` | README 설명용 이미지. 확장 실행에는 필요 없음. |
| `scripts/release.py` | 정적 검증과 참조 파일 기반 ZIP 생성·검증. |
| `dist/` | 로컬 웹스토어 제출 ZIP. Git 제외. |
| `.agents/rules/git-backup.md`, `AGENTS.md` | 로컬 전용 에이전트 작업 규칙. Git 제외. |
| `사진/`, `plato.zip` | 기존 작업 자료와 이전 ZIP. 새 배포 ZIP에는 포함하지 않음. |

기존 npm/Python 빌드 설정이나 자동 테스트는 없었습니다. `node --check`로 JavaScript 구문을 검사합니다.

## 주요 호출 흐름

- 팝업의 `DOMContentLoaded` → `chrome.storage.local.get`으로 계정·토글 복원 → 입력/변경 이벤트에서 `chrome.storage.local.set`. 캘린더 표시 토글의 기본값은 `true`입니다. 비밀번호 보기, GitHub·웹스토어 링크 클릭도 여기서 처리합니다.
- `content.js` 로드 → `fixVp()`와 `attemptLogin()` 즉시 실행 → DOM 변경을 300ms로 묶는 `MutationObserver` 및 2초 간격 점검이 `attemptLogin()` 재호출. 확장 컨텍스트 무효화 시 중지합니다. 각 로그인 폼에는 `dataset.done`/`autoLoggingIn` 등의 중복 제출 표식을 사용합니다.
- 학생지원시스템: `content.js`의 `RUN_PNU_FUNC` 이벤트 → MAIN world `event.js` → 사이트의 SSO/비밀번호 변경 안내 함수. `login.pusan.ac.kr`의 계정 입력과 `onestop.pusan.ac.kr`의 팝업 제거·SSO 버튼을 별도로 처리합니다.
- PLATO: 일반 및 개발 도메인의 로그인 폼 탐색, 오류 메시지에 따른 재시도 중지, 세션 만료 모달의 재로그인과 `wantsurl` 보존, 공지 팝업 닫기. 정규 PLATO 홈에서는 교과과정으로 이동하되 교과과정의 홈 메뉴를 직접 누른 경우 1회 유지합니다. 이 표식과 캘린더 새로고침 표식은 `sessionStorage`에 둡니다.
- BBITS: `www.bbits.ac.kr` 모달과 `lms.bbits.ac.kr` 로그인 폼을 따로 처리하고 부산대학교 소속을 선택합니다. 로그인 후 LMS 대시보드에서 캘린더를 초기화합니다.

## 캘린더와 데이터

`PlatoCalendar`와 `BbitsCalendar`는 각각 `init` → `mountWidgetSkeleton` → `loadCachedData` → `fetchAndRefreshData` → `fetchCourseStatuses`/`fetchCalendarDoc` → `parseCalendarDoc` → `render` 순서로 동작합니다. 해당 사이트의 최상위 프레임과 대상 페이지인지 확인하고 위젯 ID로 중복 삽입을 막습니다. 토글 변경은 `chrome.storage.onChanged`로 반영합니다. 월 이동은 먼저 캐시를 표시하고 60초가 지난 월은 백그라운드에서 재조회하며, `navRequestId`로 오래된 응답의 화면 반영을 막습니다. 같은 학기의 다른 월도 병렬 조회합니다. 요청은 8초 제한과 `credentials: same-origin`을 사용합니다. 실패하면 기존 화면을 유지하고 콘솔에 오류를 남깁니다.

PLATO는 정규 교과과정, 강좌 활동/과제 및 Moodle 월간 달력 HTML을 파싱합니다. BBITS는 LMS 강좌의 VOD·과제 상태와 월간 달력을 파싱해 마감일에 배치합니다. 두 엔진 모두 완료/미완료/기한 경과를 분류하고 미완료를 우선 표시하며 날짜별 상세 카드를 만듭니다. `calendar.css`의 일부 클래스 선택자는 위젯 ID 밖에서도 일치할 수 있으므로 사이트 DOM 변경 시 충돌을 확인해야 합니다.

| 저장소 키 | 용도 |
| --- | --- |
| `userId`, `userPw`, `popupToggle`, `platoPopupClose`, `platoCalendarToggle` | PLATO 계정과 설정 |
| `hjsId`, `hjsPw`, `hjsToggle`, `hjsPopupClose` | 학생지원시스템 계정과 설정 |
| `bbitsId`, `bbitsPw`, `bbitsToggle`, `bbitsPopupClose`, `bbitsCalendarToggle` | BBITS 계정과 설정 |
| `platoCalendarCollapsed`, `bbitsCalendarCollapsed` | 캘린더 접힘 상태 |
| `plato_calendar_data`, `plato_calendar_months`, `plato_calendar_month_timestamps`, `plato_calendar_last_fetch` | PLATO 일정 캐시 |
| `bbits_calendar_data`, `bbits_calendar_months`, `bbits_calendar_month_timestamps`, `bbits_calendar_last_fetch` | BBITS 일정 캐시 |

실제 로그인과 사이트 HTML 파싱은 인증된 브라우저와 현재 사이트 DOM에서 별도로 확인해야 합니다. 이번 초기 설정에서는 동작 코드를 변경하지 않았습니다.
