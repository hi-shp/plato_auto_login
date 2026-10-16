"""Anonymous real Chrome extension tests for month-spanning self-course VODs."""
import json
import os
import subprocess
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import time
from urllib.parse import parse_qs, urlparse
import unittest

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from test_extension import ROOT, launch_chrome


class SelfCourseHandler(BaseHTTPRequestHandler):
    requests = []
    deadline = '2026-11-29 23:59'
    fail_details = True
    fail_course = False
    fail_list = False
    calendar_limit = 8
    fail_status = False

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        cls = type(self)
        cls.requests.append(self.path)
        status = 200
        if url.path == '/fixture':
            body = '<div id="region-main"><div class="open-content"><div class="course_lists" style="height:1800px"></div></div></div>'
        elif url.path == '/local/ubeclass/my.php':
            body = '<div class="course-info"><h5 class="coursename"><a href="/course/view.php?id=900">익명 자율강좌</a></h5><span>2026-10-12 ~ 2026-12-05</span></div>'
            body += '<div class="course-info"><h5 class="coursename"><a href="/course/view.php?id=901">이전 학기 강좌</a></h5><span>2026-04-01 ~ 2026-06-30</span></div>'
            if cls.fail_list:
                status = 503
        elif url.path == '/report/ublogs/student/activity.php':
            body = '<table>' + ''.join(
                f'<tr><td class="td-activity"><a href="/mod/vod/view.php?id={i}">예시 영상 {i}</a></td><td class="td-status">{"완료" if i == 8 else "미완료"}</td></tr>'
                for i in range(1, 9)) + '</table>'
            if cls.fail_status:
                status = 503
        elif url.path == '/mod/assign/index.php':
            body = '<table></table>'
        elif url.path == '/course/view.php':
            body = ''.join(f'<div class="grid-row"><div class="cell-activity"><a href="/mod/vod/view.php?id={i}">예시 영상 {i}</a></div>'
                           f'<div class="cell-period"><span class="csms-text-period">2026-10-12 00:00</span><span class="csms-text-period"> ~ {cls.deadline}</span></div></div>'
                           for i in range(1, 9))
            if cls.fail_course:
                status = 503
        elif url.path == '/calendar/view.php':
            stamp = int(query.get('time', ['0'])[0])
            month = datetime.fromtimestamp(stamp).month
            end = 31 if month == 10 else 29 if month == 11 else 0
            start = 12 if month == 10 else 1
            body = '<table>' + ''.join(f'<tr><td class="day" data-day="{day}"><span class="day-number">{day}</span><ul>'
                + ''.join(f'<li data-region="event-item" data-event-component="mod_vod" data-event-eventtype="due"><a data-event-id="{i}" href="/mod/vod/view.php?id={i}">예시 영상 {i}</a></li>' for i in range(1, cls.calendar_limit + 1))
                + '</ul></td></tr>' for day in range(start, end + 1)) + '</table>'
        elif url.path == '/mod/vod/view.php':
            if cls.fail_details:
                status, body = 503, 'Anonymous detail failure'
            else:
                body = '<span class="timeopen">2026-10-12 00:00:00</span><span class="timeclose">' + cls.deadline + ':00</span>'
        else:
            body = ''
        data = ('<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>').encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


BOOTSTRAP = '''
if(location.pathname==='/fixture'){
 const c=PlatoCalendar;
 let refresh;
 const fetchData=c.fetchAndRefreshData;
 c.fetchAndRefreshData=function(){return refresh=fetchData.call(this)};
 const summary=()=>({month:c.cachedData.curMonth,unresolved:!!c.cachedData.hasUnresolvedDeadlines,
  items:c.cachedData.activities.map(a=>({id:a.modId,course:a.courseName,due:a.dueAt,month:a.dueMonth,day:a.dueDay,done:a.isCompleted,period:a.periodText})),
  grid:document.querySelectorAll('#plato-large-days-grid .plato-day-num').length});
 const render=c.render;
 c.render=function(){render.call(this);document.documentElement.dataset.calendarResult=JSON.stringify(summary())};
 const run=async(action)=>{
  if(action==='init'){
   c.viewYear=2026;c.viewMonth=10;
   c.mountWidgetSkeleton();
   c.loadCachedData=()=>{};
  }
  if(action==='legacy-cache'){
   c.cachedData={curYear:2026,curMonth:10,days:[],activities:Array.from({length:8},(_,n)=>({
    modId:String(n+1),title:'익명 이전 영상',type:'강의',courseName:'교과과정',startDay:12,dueDay:31,
    href:location.origin+'/mod/vod/view.php?id='+(n+1)}))};
   c.render();
  } else if(action==='november')await c.navigateToMonth(2026,11);
  else if(action==='refresh'){c.handleManualRefresh();await refresh;}
  else await c.fetchAndRefreshData();
  document.documentElement.dataset.calendarResult=JSON.stringify(summary());
  document.documentElement.dataset.calendarDone='1';
 };
 document.addEventListener('self-fixture',e=>{
  delete document.documentElement.dataset.calendarDone;
  run(e.detail.action).catch(error=>document.documentElement.dataset.fixtureError=error.message);
 });
 chrome.storage.local.clear(()=>run('init'));
}
'''


class SelfCourseCalendarTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        cls.base = Path(cls.temp.name)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), SelfCourseHandler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        extension = cls.base / 'extension'
        extension.mkdir()
        manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
        # The test changes only transport/host validation; all actual parsers,
        # fetches, caches, request limits and render paths run from this build.
        for name in ['content.js','calendar-time.js','notice.js','calendar.css']:
            baseline = os.environ.get('SELF_COURSE_BASELINE')
            raw = subprocess.check_output(['git','show',f'{baseline}:{name}'],cwd=ROOT).decode('utf-8') if baseline else (ROOT / name).read_text(encoding='utf-8')
            source = raw.replace('https://plato.pusan.ac.kr', cls.origin).replace('plato.pusan.ac.kr', '127.0.0.1')
            (extension / name).write_text(source, encoding='utf-8')
        (extension / 'fixture.js').write_text(BOOTSTRAP, encoding='utf-8')
        manifest.pop('background', None)
        manifest.pop('action', None)
        manifest.pop('icons', None)
        manifest['host_permissions'] = ['http://127.0.0.1/*']
        manifest['content_scripts'] = [{'matches':['http://127.0.0.1/*'],'run_at':'document_end',
            'js':['calendar-time.js','notice.js','content.js','fixture.js'],'css':['calendar.css']}]
        (extension / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        cls.driver = launch_chrome(extension, cls.base / 'profile')
        cls.wait = WebDriverWait(cls.driver, 15)

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def setUp(self):
        SelfCourseHandler.deadline = '2026-11-29 23:59'
        SelfCourseHandler.fail_details = True
        SelfCourseHandler.fail_course = False
        SelfCourseHandler.fail_list = False
        SelfCourseHandler.calendar_limit = 8
        SelfCourseHandler.fail_status = False
        SelfCourseHandler.requests = []
        self.driver.get(self.origin + '/fixture')
        self.wait_done()

    def wait_done(self):
        self.wait.until(lambda d: d.execute_script('return document.documentElement.dataset.calendarDone || document.documentElement.dataset.fixtureError'))
        self.assertFalse(self.driver.execute_script('return document.documentElement.dataset.fixtureError'))
        return json.loads(self.driver.execute_script('return document.documentElement.dataset.calendarResult'))

    def action(self, action):
        self.driver.execute_script('''
delete document.documentElement.dataset.calendarDone;
document.dispatchEvent(new CustomEvent('self-fixture',{detail:{action:arguments[0]}}));
''', action)
        return self.wait_done()

    def test_all_eight_vods_go_to_actual_month_even_when_every_detail_fails(self):
        october = self.action('refresh')
        self.assertEqual(october['items'], [])
        self.assertEqual(october['grid'], 31)
        november = self.action('november')
        self.assertEqual(len(november['items']), 8)
        self.assertEqual(november['grid'], 30)
        for item in november['items']:
            self.assertEqual((item['course'],item['month'],item['day']), ('익명 자율강좌',11,29))
            self.assertIn('수강 기간:', item['period'])
            self.assertIn('23:59', item['period'])
            self.assertNotIn('확인 불가', item['period'])
        self.assertEqual(sum(a['done'] for a in november['items']), 1)
        self.assertFalse(any('id=901' in url for url in SelfCourseHandler.requests))
        self.driver.find_elements(By.CSS_SELECTOR, '#plato-large-days-grid .plato-large-day-cell:not(.empty)')[28].click()
        self.assertEqual(len(self.driver.find_elements(By.CSS_SELECTOR, '.plato-task-course')), 8)
        self.assertTrue(all('익명 자율강좌' in a.text for a in self.driver.find_elements(By.CSS_SELECTOR, '.plato-task-course')))
        for _ in range(2):
            self.assertEqual(len(self.action('refresh')['items']), 8)

    def test_changed_course_deadline_replaces_fresh_detail_cache(self):
        SelfCourseHandler.fail_details = False
        self.action('refresh')
        self.action('november')
        SelfCourseHandler.deadline = '2026-11-28 22:30'
        result = self.action('refresh')
        self.assertEqual(len(result['items']), 8)
        self.assertTrue(all(a['day']==28 and '22:30' in a['period'] for a in result['items']))

    def test_three_vods_missing_from_month_html_still_use_named_course_deadlines(self):
        SelfCourseHandler.calendar_limit = 5
        self.action('refresh')
        result = self.action('november')
        self.assertEqual(len(result['items']), 8)
        self.assertTrue(all(a['course']=='익명 자율강좌' and a['day']==29 for a in result['items']))

    def test_unknown_month_boundary_is_not_invented_as_deadline(self):
        SelfCourseHandler.fail_course = True
        result = self.action('refresh')
        self.assertEqual(result['items'], [])
        self.assertTrue(result['unresolved'])
        self.assertEqual(result['grid'], 31)
        SelfCourseHandler.fail_course = False
        self.action('refresh')
        self.assertEqual(len(self.action('november')['items']), 8)

    def test_previous_bad_month_end_cache_is_repaired_before_display(self):
        result = self.action('legacy-cache')
        self.assertEqual(result['items'], [])
        self.assertEqual(result['grid'], 31)
        self.assertTrue(result['unresolved'])
        self.action('refresh')
        self.assertEqual(len(self.action('november')['items']), 8)

    def test_verified_dates_survive_temporary_course_and_list_failure(self):
        self.action('november')
        SelfCourseHandler.fail_course = True
        result = self.action('refresh')
        self.assertEqual(len(result['items']), 8)
        self.assertTrue(all(a['course']=='익명 자율강좌' and a['day']==29 and '23:59' in a['period'] for a in result['items']))
        SelfCourseHandler.fail_list = True
        result = self.action('refresh')
        self.assertEqual(len(result['items']), 8)
        self.assertTrue(all(a['course']=='익명 자율강좌' and a['day']==29 for a in result['items']))

    def test_completion_cache_survives_status_report_failure(self):
        self.action('november')
        SelfCourseHandler.fail_status = True
        result = self.action('refresh')
        self.assertEqual(len(result['items']),8)
        self.assertEqual(sum(a['done'] for a in result['items']),1)
        self.assertTrue(all(a['course']=='익명 자율강좌' and a['day']==29 for a in result['items']))


if __name__ == '__main__':
    unittest.main()
