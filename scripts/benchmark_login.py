"""Compare v2026.10.13 with working sources in real isolated Chrome.

python scripts/benchmark_login.py --rounds 3
Only localhost mock authentication is used. P95 of three samples is the maximum;
this is reproducible engineering evidence, not live LMS performance.
"""
import argparse
import json
import math
from pathlib import Path
import statistics
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import time
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests' / 'e2e'))
from test_navigation_extension import LoginHandler, navigation_extension, COURSE, ROOT
from test_extension import launch_chrome
from selenium.webdriver.support.ui import WebDriverWait


def summarize(values):
    values = sorted(values)
    return {'median': round(statistics.median(values), 1),
            'p95': round(values[max(0, math.ceil(.95 * len(values)) - 1)], 1)} if values else None


def write_report(data):
    def key(row):
        return tuple(row[k] for k in ('browser', 'session_expired', 'notice_enabled', 'notice_exists'))
    before = {key(row): row for row in data['rows'] if row['version'] == '2026.10.13'}
    after = {key(row): row for row in data['rows'] if row['version'] == 'working'}
    representative = ('warm', True, True, True)
    old, new = before[representative], after[representative]
    def internal_delay(row):
        delays = []
        for sample in row['samples']:
            home = [page for page in sample['page_metrics'] if page['path'] == '/'][-1]
            first = {}
            for mark in home['marks']:
                first.setdefault(mark['name'], mark['at'])
            start = first.get('plato-early-start', first.get('plato-content-start'))
            delays.append(sample['home_to_redirect_ms'] - start)
        return statistics.median(delays)
    internal_old, internal_new = internal_delay(old), internal_delay(new)
    frames_old, frames_new = old['home_frames'], new['home_frames']
    lines = ['# PLATO 로그인 이동 성능 측정 (2026-10-14)', '',
             '## 조건과 재현', '',
             '- `python scripts/benchmark_login.py --rounds 3`으로 이전 커밋 `7fecf0c`과 현재 소스를 비교한다.',
             '- 실제 Chrome headless에 임시 확장 프로그램을 설치한다. 호스트·HTTP 조건만 익명 로컬 서버로 바꾸고, 관측용 Performance mark와 메트릭 수집을 추가한다. 로그인·이동 알고리즘은 원본을 사용한다.',
             '- 인증 POST와 SSO 응답은 각각 50ms, 홈의 파서 차단 스크립트는 250ms로 지연한다. 공식 공지 모의 버튼은 120ms 뒤 캐러셀을 제거한다. 실제 PLATO 서버 속도와 동일한 조건이라고 가정하지 않는다.',
             '- 새 Chrome 2조건과 기존 Chrome 8조건, 버전별 각 3회로 총 60회 측정한다. cold는 새 프로필·새 프로세스이며, warm도 각 회차 익명 로그인 목적지 상태를 초기화한다. warm의 세션 유효/만료는 서버 모의 상태다.',
             '- P95는 nearest-rank를 사용한다. 조건별 표본 3개에서 P95는 최댓값이므로 통계적 신뢰 구간을 뜻하지 않는다.',
             '- 원시 단계별 자료는 Git 제외 `dist/e2e/login-performance.json`에 저장한다. `--report-only`는 그 자료로 이 문서를 다시 만든다.', '',
             '## 측정 결과', '',
             '단위는 ms, 각 셀은 중앙값 / P95다. 홈 시간은 **로그인된 중간 홈의 탐색 시작부터 이동 요청까지**이며 전체 로그인 시간이 아니다. 교과과정 표시 시간은 해당 홈 탐색 시작부터 교과과정의 first-contentful-paint까지다.', '',
             '| Chrome | 세션 | 공지 설정 | 공지 | 기존 홈 이동 | 수정 홈 이동 | 기존 교과과정 표시 | 수정 교과과정 표시 |',
             '| --- | --- | --- | --- | ---: | ---: | ---: | ---: |']
    def cell(row, metric):
        values = row[metric]
        return f"{values['median']:.1f} / {values['p95']:.1f}"
    for identity, old in before.items():
        new = after[identity]
        browser, expired, enabled, notice = identity
        lines.append(f"| {browser} | {'만료' if expired else '정상'} | {'ON' if enabled else 'OFF'} | {'있음' if notice else '없음'} | {cell(old, 'home_to_redirect_ms')} | {cell(new, 'home_to_redirect_ms')} | {cell(old, 'course_fcp_after_home_ms')} | {cell(new, 'course_fcp_after_home_ms')} |")
    lines += ['', '## 단계 구분과 한계', '',
              '- 원시 자료에는 홈 탐색 시작(timeOrigin), document_start/content 실행, 설정 읽기, 목적지 읽기, DOM 준비, 로그인 폼 제출, 인증 상태 감지, 목적지 결정·이동 요청, 홈 FCP, 교과과정 FCP가 들어 있다. 단계가 실행되지 않거나 관측되지 않았으면 null/누락으로 유지한다.',
              '- 서버의 인증 POST부터 교과과정 요청까지는 별도 monotonic 시계로 기록한다. WebDriver 전체 탐색·대기 시간도 별도 항목이며 FCP와 동일하지 않다. 중간 SSO는 실제 자격증명 전송 없이 HTTP 리다이렉트로 모의한다.',
              f'- 공지 ON·공지 있음·warm·세션 만료에서 스크립트 시작 → 이동 요청 중앙값은 {internal_old:.1f} → {internal_new:.1f}ms다. 파서 대기와 공지 클릭 뒤 호출 중단·DOM 디바운스가 기존 지연에 포함됐음을 모의 환경에서 확인했다. 사용자 보고 약 0.5초의 실사이트 원인을 동일 수치로 확정하지 않는다.',
              f'- 같은 조건의 홈 requestAnimationFrame 콜백은 기존 {frames_old}, 수정 {frames_new}회였다. 이는 headless 프레임 관측이며 실모니터 화면 녹화가 아니다. 수정본에서도 중간 홈 프레임이 남았다. 모든 조건에서 첫 화면 노출이 없어졌다고 주장하지 않는다.',
              '- 2026.10.11 소스는 document_end, 저장소 조회, 300ms DOM 감시와 2초 점검을 이미 사용했다. 2026.10.12~13은 공지 버튼을 실행하면 로그인 처리를 반환하는 경로를 추가했다. 이번 수치 비교 대상은 2026.10.13이며 2026.10.11 수치를 측정한 것은 아니다.',
              '- 실제 사용자 Chrome 연결은 CDP focus 응답과 별도 브라우저 연결에서 시간 초과가 발생했다. 수정본의 실제 Moodle wantsurl/SSO, 설치 버전, 실제 첫 프레임과 인증 성능은 이번에 확인하지 못했다. 로그아웃·실제 제출·시험 응시는 하지 않았다.', '']
    final_path = ROOT / 'dist/e2e/login-performance-final.json'
    if final_path.is_file():
        final = json.loads(final_path.read_text(encoding='utf-8'))
        latest = lambda values: max(page['origin'] for row in values['rows'] for sample in row['samples'] for page in sample['page_metrics'])
        if latest(final) >= latest(data):
            old_final = next(row for row in final['rows'] if row['version'] == '2026.10.13')
            new_final = next(row for row in final['rows'] if row['version'] == 'working')
            lines += ['## 최종 빌드 추가 확인', '',
                      '`python scripts/benchmark_login.py --scenario representative --rounds 3`으로 최종 소스를 다시 확인한다. 전체 조건 60회 이후 대표 조건(warm·세션 만료·공지 ON·공지 있음)을 버전별 3회 추가 측정했다. 원시는 `dist/e2e/login-performance-final.json`이다. 위 전체 표는 주요 이동 변경 빌드이며, 이 추가 확인은 구버전 의도 이전·숨김 wantsurl·중계 URL 검증까지 반영한 빌드다.', '',
                      '| 항목 | 기존 중앙값 / P95 | 최종 빌드 중앙값 / P95 |',
                      '| --- | ---: | ---: |',
                      f"| 홈 탐색 → 이동 요청 (ms) | {cell(old_final, 'home_to_redirect_ms')} | {cell(new_final, 'home_to_redirect_ms')} |",
                      f"| 홈 탐색 → 교과과정 FCP (ms) | {cell(old_final, 'course_fcp_after_home_ms')} | {cell(new_final, 'course_fcp_after_home_ms')} |", '',
                      f"스크립트 시작 → 이동 요청 중앙값은 {internal_delay(old_final):.1f} → {internal_delay(new_final):.1f}ms다. 홈 rAF 콜백은 {old_final['home_frames']} → {new_final['home_frames']}회이며 완전 무노출은 아니다. 실제 LMS 인증·서버 속도·물리 화면 첫 프레임은 미검증이다.", '']
    (ROOT / 'LOGIN_PERFORMANCE.md').write_text('\n'.join(lines), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--report-only', action='store_true', help='write public summary from existing anonymous metrics')
    parser.add_argument('--scenario', choices=['all', 'representative'], default='all',
                        help='representative rechecks the final build with warm, expired session, notice ON and present')
    args = parser.parse_args()
    if args.report_only:
        write_report(json.loads((ROOT / 'dist/e2e/login-performance.json').read_text(encoding='utf-8')))
        return
    if args.rounds < 1:
        parser.error('rounds must be positive')
    server = ThreadingHTTPServer(('127.0.0.1', 0), LoginHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    LoginHandler.auth_delay = .05
    LoginHandler.auth_slow = '1'
    rows = []
    try:
        with TemporaryDirectory() as temp:
            base = Path(temp)
            for baseline in (True, False):
                version = '2026.10.13' if baseline else 'working'
                ext = base / version
                navigation_extension(ext, origin, baseline=baseline)
                warm = launch_chrome(ext, base / (version + '-warm'))
                try:
                    cases = [('cold', True, True, True), ('cold', True, False, False)]
                    cases += [('warm', expired, enabled, notice) for expired in (False, True) for enabled in (False, True) for notice in (False, True)]
                    if args.scenario == 'representative':
                        cases = [('warm', True, True, True)]
                    for condition, expired, enabled, notice in cases:
                        group = []
                        for trial in range(args.rounds):
                            driver = launch_chrome(ext, base / f'{version}-{len(rows)}-{trial}') if condition == 'cold' else warm
                            try:
                                wait = WebDriverWait(driver, 15)
                                driver.get(origin + '/fixture-seed?on=' + str(int(enabled)))
                                wait.until(lambda d: d.execute_script("return document.documentElement.dataset.seeded==='1'"))
                                case = f'bench-{version}-{len(rows)}-{trial}'
                                LoginHandler.auth_notice = str(int(notice))
                                LoginHandler.metrics.clear()
                                LoginHandler.events.clear()
                                start = time.perf_counter()
                                driver.get(origin + f'/?case={case}&expired={int(expired)}&notice={int(notice)}&slow=1')
                                wait.until(lambda d: d.current_url == origin + COURSE)
                                wait.until(lambda d: d.execute_script("return document.readyState==='complete' && performance.getEntriesByType('paint').some(e=>e.name==='first-contentful-paint')"))
                                end = time.perf_counter()
                                final = driver.execute_script("return {origin:performance.timeOrigin,paint:performance.getEntriesByType('paint').find(e=>e.name==='first-contentful-paint').startTime}")
                                home = [m for m in LoginHandler.metrics if m['path'] == '/'][-1]
                                marks = {m['name']: m['at'] for m in home['marks']}
                                request = marks['plato-redirect-request']
                                events = LoginHandler.events[:]
                                auth = [e for e in events if e['path'] == '/authenticate']
                                group.append({
                                    'home_to_redirect_ms': round(request, 2),
                                    'home_content_start_ms': marks.get('plato-content-start'),
                                    'early_start_ms': marks.get('plato-early-start'),
                                    'settings_ready_ms': marks.get('plato-settings-ready', marks.get('plato-settings-loaded')),
                                    'intent_ready_ms': marks.get('plato-intent-ready'),
                                    'home_dom_ready_ms': home['domReady'],
                                    'home_fcp_ms': next((p['at'] for p in home['paints'] if p['name'] == 'first-contentful-paint'), None),
                                    'home_frames': home['homeFrames'],
                                    'course_fcp_after_home_ms': round(final['origin'] + final['paint'] - home['origin'], 2),
                                    'redirect_to_course_fcp_ms': round(final['origin'] + final['paint'] - home['origin'] - request, 2),
                                    'navigation_to_ready_ms': round((end - start) * 1000, 2),
                                    'auth_post_to_course_request_ms': round((next(e['at'] for e in events if e['path'].startswith(COURSE)) - auth[0]['at']) * 1000, 2) if auth else None,
                                    'page_metrics': LoginHandler.metrics[:],
                                })
                            finally:
                                if condition == 'cold':
                                    driver.quit()
                        row = {'version': version, 'browser': condition, 'session_expired': expired,
                               'notice_enabled': enabled, 'notice_exists': notice, 'samples': group,
                               'home_to_redirect_ms': summarize([s['home_to_redirect_ms'] for s in group]),
                               'course_fcp_after_home_ms': summarize([s['course_fcp_after_home_ms'] for s in group]),
                               'home_frames': [s['home_frames'] for s in group]}
                        rows.append(row)
                        print(json.dumps({k: v for k, v in row.items() if k != 'samples'}), flush=True)
                finally:
                    warm.quit()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    output = ROOT / 'dist' / 'e2e' / ('login-performance.json' if args.scenario == 'all' else 'login-performance-final.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    data = {'rounds': args.rounds, 'mock_auth_delay_ms': 50,
            'mock_sso_delay_ms': 50, 'home_parser_delay_ms': 250, 'rows': rows}
    output.write_text(json.dumps(data, indent=2), encoding='utf-8')
    if args.scenario == 'all':
        write_report(data)
    print('Saved:', output)


if __name__ == '__main__':
    main()
