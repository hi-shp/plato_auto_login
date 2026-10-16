"""Real tabs and pre-HTML HTTP redirects; only anonymous localhost data."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread
import time
from urllib.parse import parse_qs, urlparse
import unittest

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from test_extension import ROOT, launch_chrome

COURSE = '/local/ubion/allcourse/regular/index.php'
BASELINE = '7fecf0c'


class LoginHandler(BaseHTTPRequestHandler):
    authenticated = set()
    events = []
    expire_home = set()
    metrics = []
    auth_delay = 0
    auth_notice = '0'
    auth_slow = '0'

    def send_html(self, body, status=200):
        data = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        query_case = parse_qs(urlparse(self.path).query).get('case')
        if query_case:
            self.send_header('Set-Cookie', 'fixture_case=' + query_case[0] + '; SameSite=Lax; Path=/')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Early redirects intentionally cancel a parser-blocking response.

    def redirect(self, url):
        self.send_response(302)
        self.send_header('Location', url)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        from http.cookies import SimpleCookie
        cookies = SimpleCookie(self.headers.get('Cookie', ''))
        cookie_case = cookies['fixture_case'].value if 'fixture_case' in cookies else '0'
        case = params.get('case', [cookie_case])[0]
        self.events.append({'case': case, 'path': self.path, 'at': time.perf_counter()})
        if parsed.path == '/slow.js':
            time.sleep(.25)
            self.send_html('/* anonymous parsing delay */')
            return
        if parsed.path == '/sso/bridge':
            time.sleep(self.auth_delay)
            self.redirect('/?case=' + case + '&notice=' + params.get('notice', ['0'])[0] + '&slow=' + self.auth_slow)
            return
        if parsed.path == '/' and case in self.expire_home and case not in self.authenticated:
            self.redirect('/login/index.php?case=' + case)
            return
        protected = parsed.path.startswith(('/mod/', '/course/', '/message/'))
        if protected and case not in self.authenticated:
            # Deliberately no wantsurl: requested HTML never reaches a content script.
            self.redirect('/login/index.php?case=' + case)
            return
        if parsed.path.startswith('/login/'):
            from html import escape
            error = '<div class="loginerrors">아이디 또는 비밀번호 불일치</div>' if params.get('error') else ''
            wants = escape(params.get('hiddenwants', [''])[0], quote=True)
            body = f'<body class="notloggedin">{error}<form id="form-login-sso" method="post" action="/authenticate"><input name="case" type="hidden" value="{case}"><input name="wantsurl" type="hidden" value="{wants}"><input id="input-username" name="username"><input id="input-password" type="password" name="password"><button type="submit" class="btn-login">Login</button></form></body>'
        elif parsed.path == '/fixture-seed':
            body = '<body>Anonymous settings seed</body>'
        elif parsed.path == '/' and params.get('expired') == ['1'] and case not in self.authenticated:
            body = f'<body class="notloggedin"><header><a class="btn-login" href="/login/index.php?case={case}">Login</a></header><script src="/slow.js"></script></body>'
        else:
            notice = ''
            if parsed.path == '/' and params.get('notice') == ['1']:
                notice = '''<div class="ubboard-popup"><div class="modal modal-ubboard-notice"><div id="popup-splide" class="splide is-initialized"><div class="popup-footer"><button class="btn-not-show-again" data-not-show-type="2">더 이상 보지 않음</button></div></div></div></div><script>document.querySelector('.btn-not-show-again').onclick=()=>setTimeout(()=>document.querySelector('#popup-splide')?.remove(),120);</script>'''
            denied = '<div class="alert">접근 권한 없음</div>' if params.get('denied') else ''
            links = ''.join(f'<a id="{kind}-link" href="/mod/{kind}/view.php?id={number}&case={case}&action=view#intro" target="_blank" rel="noopener noreferrer">Anonymous {kind}</a>' for kind, number in [('assign', 42), ('vod', 43), ('quiz', 44)])
            body = f'<body class="loggedin"><a class="btn-channel" id="home-menu" href="/?case={case}">홈</a>{links}<div id="region-main"><div class="open-content">Anonymous page{denied}</div></div>{notice}<script>window.homeFrames=0;if(location.pathname==="/"){{const sample=()=>{{homeFrames++;requestAnimationFrame(sample)}};requestAnimationFrame(sample)}};</script>'
            if params.get('long') == ['1']:
                body = body.replace('Anonymous page', '<div style="height:2400px">Anonymous long course list</div>')
            if parsed.path == '/' and params.get('slow') == ['1']:
                body += '<script src="/slow.js"></script>'
            body += '</body>'
        metrics = '''<script>
window.addEventListener('pagehide',()=>navigator.sendBeacon('/metrics',JSON.stringify({
 path:location.pathname,origin:performance.timeOrigin,homeFrames:window.homeFrames||0,
 marks:performance.getEntriesByType('mark').map(e=>({name:e.name,at:e.startTime})),
 paints:performance.getEntriesByType('paint').map(e=>({name:e.name,at:e.startTime})),
 domReady:performance.getEntriesByType('navigation')[0]?.domContentLoadedEventStart||0
})));
</script>'''
        self.send_html('<!doctype html><html><head><meta charset="utf-8"><title>Anonymous LMS</title>' + metrics + '</head>' + body + '</html>',
                       403 if params.get('denied') else 404 if params.get('missing') else 200)

    def do_POST(self):
        if self.path == '/metrics':
            self.metrics.append(json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0')))))
            self.send_html('ok')
            return
        params = parse_qs(self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode())
        case = params.get('case', ['0'])[0]
        self.authenticated.add(case)
        self.events.append({'case': case, 'path': '/authenticate', 'at': time.perf_counter()})
        time.sleep(self.auth_delay)
        self.redirect('/sso/bridge?case=' + case + '&notice=' + self.auth_notice)

    def log_message(self, *_):
        pass


def navigation_extension(directory, origin, baseline=False):
    directory.mkdir()
    names = ['manifest.json', 'content.js', 'calendar-time.js', 'calendar.css', 'notice.js',
             'notice-early.js', 'popup.html', 'popup.js', 'favicon.png', 'event.js']
    if not baseline:
        names += ['navigation-worker.js', 'navigation.js']
    for name in names:
        if baseline:
            data = subprocess.check_output(['git', 'show', f'{BASELINE}:{name}'], cwd=ROOT)
        else:
            data = (ROOT / name).read_bytes()
        if name.endswith('.js'):
            source = data.decode('utf-8').replace('https://plato.pusan.ac.kr', origin)
            source = source.replace('plato.pusan.ac.kr', '127.0.0.1')
            # Adapt only host/transport validation to the isolated HTTP origin.
            source = source.replace("target.protocol !== 'https:'", "target.protocol !== 'http:'")
            source = source.replace('target.port ||', '')
            if name == 'navigation-worker.js':
                source = source.replace("if (details.frameId !== 0) return;", "if (details.frameId !== 0 || new URL(details.url).pathname.startsWith('/fixture-')) return;")
                source = source.replace('const target = new URL(raw, base);', "const target = new URL(raw, base);if(target.pathname.startsWith('/fixture-'))return null;")
            if name == 'navigation.js':
                source = source.replace("if (window !== window.top ||", "if (location.pathname.startsWith('/fixture-') || window !== window.top ||")
            if name == 'content.js':
                source = "performance.mark('plato-content-start');\n" + source
                source = source.replace('if (!chrome.runtime?.id || chrome.runtime.lastError) return;', "if (!chrome.runtime?.id || chrome.runtime.lastError) return;performance.mark('plato-settings-loaded');")
                source = source.replace('if (isLoggedIn) {', "if (isLoggedIn) {performance.mark('plato-auth-detected');")
                source = source.replace('if (!b.disabled) {', "if (!b.disabled) {performance.mark('plato-form-submit');")
                if baseline:
                    source = source.replace('window.location.replace(', "performance.mark('plato-redirect-request');window.location.replace(")
            data = source.encode('utf-8')
        (directory / name).write_bytes(data)
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    manifest['host_permissions'] = ['http://127.0.0.1/*']
    manifest['content_scripts'] = [
        {'matches': ['http://127.0.0.1/*'], 'js': (['navigation.js'] if not baseline else []) + ['notice-early.js', 'seed.js'], 'run_at': 'document_start'},
        {'matches': ['http://127.0.0.1/*'], 'js': ['calendar-time.js', 'notice.js', 'content.js', 'calendar-fixture.js'], 'css': ['calendar.css'], 'run_at': 'document_end'}]
    (directory / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    (directory / 'seed.js').write_text('''
if(location.pathname==='/fixture-seed') {
 const seed=()=>{sessionStorage.clear();chrome.storage.local.set({
 userId:'anonymous',userPw:'fixture-only',popupToggle:true,platoCalendarToggle:true,
 platoPopupClose:new URLSearchParams(location.search).get('on')!=='0'
 },()=>{document.documentElement.dataset.seeded='1'});};
 if(chrome.runtime.getManifest().background)chrome.runtime.sendMessage({type:'fixture-control',action:'reset'},seed);
 else seed();
}
window.addEventListener('fixture-control',e=>chrome.runtime.sendMessage({type:'fixture-control',...e.detail},reply=>{
 document.documentElement.dataset.controlReply=JSON.stringify(reply||{});
}));
''', encoding='utf-8')
    if not baseline:
        with (directory / 'navigation-worker.js').open('a', encoding='utf-8') as file:
            file.write('''
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(m.type!=='fixture-control')return;
 (async()=>{
  if(m.action==='expire')await chrome.storage.session.set({['plato_navigation_'+s.tab.id]:{
   url:m.url,reason:'click',pending:true,createdAt:Date.now()-360000}});
  if(m.action==='reset')await navigationQueue(s.tab.id,()=>null);
  if(m.action==='discard'){
   const tab=await chrome.tabs.discard(m.tabId);reply({tabId:tab.id,discarded:tab.discarded});return;
  }
  if(m.action==='activate'){
   await chrome.tabs.update(m.tabId,{active:true});reply({activated:true});return;
  }
  reply({tabId:s.tab.id,states:await chrome.storage.session.get(null)});
 })();return true;
});
''')
    (directory / 'calendar-fixture.js').write_text('''
PlatoCalendar.fetchAndRefreshData=async()=>{};
PlatoCalendar.loadCachedData=function(){
 const date=new Date(),year=date.getFullYear(),month=date.getMonth()+1,day=date.getDate();
 const c=new URLSearchParams(location.search).get('case');
 const items=[['assign',42,'과제'],['vod',43,'강의']].map(([kind,id,type])=>({
  title:'익명 '+type,type,courseName:'예시 강좌',dueDay:day,isCompleted:false,statusType:'pending',statusLabel:'미완료',
  periodText:'마감: 예시',href:location.origin+'/mod/'+kind+'/view.php?id='+id+'&case='+c+'&action=view#intro'}));
 this.cachedData={curYear:year,curMonth:month,days:[],activities:items,dayDueActivitiesMap:{[day]:items}};
 this.render();document.documentElement.dataset.calendarReady='1';
};
''', encoding='utf-8')


class NavigationExtensionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        cls.base = Path(cls.temp.name)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), LoginHandler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        cls.extension = cls.base / 'extension'
        navigation_extension(cls.extension, cls.origin, baseline=os.environ.get('PLATO_NAV_BASELINE') == '1')
        cls.driver = launch_chrome(cls.extension, cls.base / 'profile')
        cls.wait = WebDriverWait(cls.driver, 12)
        cls.counter = 0

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def setUp(self):
        handles = self.driver.window_handles
        for handle in handles[1:]:
            self.driver.switch_to.window(handle)
            self.driver.close()
        self.driver.switch_to.window(handles[0])
        type(self).counter += 1
        self.case = str(self.counter)
        self.driver.get(self.origin + '/fixture-seed')
        self.wait.until(lambda d: d.execute_script("return document.documentElement.dataset.seeded==='1'"))

    def calendar(self):
        self.driver.get(self.origin + COURSE + '?case=' + self.case)
        self.wait.until(lambda d: d.execute_script("return document.documentElement.dataset.calendarReady==='1'"))
        self.driver.find_element(By.CSS_SELECTOR, '.plato-large-day-cell.today').click()
        self.wait.until(lambda d: d.find_element(By.CSS_SELECTOR, '.plato-task-card').is_displayed())

    def assert_stays(self, expected):
        try:
            self.wait.until(lambda d: d.current_url == expected, 'Expected destination: ' + expected)
        except Exception:
            self.fail(f'Anonymous fixture URL: {self.driver.current_url}; expected: {expected}; storage: {self.driver.execute_script("return {...sessionStorage}")}')
        time.sleep(.4)
        self.assertEqual(self.driver.current_url, expected)

    def test_calendar_assignment_real_noopener_tab_pre_html_redirect(self):
        self.calendar()
        original = self.driver.current_window_handle
        card = self.driver.find_element(By.CSS_SELECTOR, '.plato-task-card[href*="/assign/"]')
        expected = card.get_attribute('href')
        self.assertEqual(card.get_attribute('target'), '_blank')
        self.assertIn('noopener', card.get_attribute('rel'))
        self.assertIn('noreferrer', card.get_attribute('rel'))
        card.click()
        self.wait.until(lambda d: len(d.window_handles) == 2)
        self.driver.switch_to.window(next(h for h in self.driver.window_handles if h != original))
        self.assert_stays(expected)
        self.assertIsNone(self.driver.execute_script('return window.opener'))
        self.driver.switch_to.window(original)
        self.assertTrue(self.driver.find_element(By.ID, 'plato-calendar-detail-panel').is_displayed())

    def new_tab_link(self, selector):
        before = self.driver.window_handles
        link = self.driver.find_element(By.CSS_SELECTOR, selector)
        expected = link.get_attribute('href')
        link.click()
        self.wait.until(lambda d: len(d.window_handles) > len(before))
        new = next(h for h in self.driver.window_handles if h not in before)
        self.driver.switch_to.window(new)
        self.assert_stays(expected)
        return new, expected

    def control(self, action='get', **values):
        self.driver.execute_script("delete document.documentElement.dataset.controlReply;window.dispatchEvent(new CustomEvent('fixture-control',{detail:arguments[0]}))", {'action': action, **values})
        self.wait.until(lambda d: d.execute_script('return !!document.documentElement.dataset.controlReply'))
        return json.loads(self.driver.execute_script('return document.documentElement.dataset.controlReply'))

    def test_calendar_vod_new_tab(self):
        self.calendar()
        self.new_tab_link('.plato-task-card[href*="/vod/"]')

    def test_course_quiz_new_tab(self):
        self.calendar()
        self.new_tab_link('#quiz-link')

    def test_assignment_same_tab_and_sso_chain(self):
        self.calendar()
        link = self.driver.find_element(By.ID, 'assign-link')
        expected = link.get_attribute('href')
        self.driver.execute_script("arguments[0].removeAttribute('target')", link)
        link.click()
        self.assert_stays(expected)
        paths = [e['path'] for e in LoginHandler.events if e['case'] == self.case]
        self.assertTrue(any(p.startswith('/login/') for p in paths))
        self.assertTrue(any(p.startswith('/sso/') for p in paths))
        state = self.control()['states']
        self.assertTrue(all(not s.get('pending') and not s.get('url') for s in state.values()))

    def test_direct_assignment_address_before_html(self):
        expected = self.origin + f'/mod/assign/view.php?id=101&case={self.case}&action=view#intro'
        self.driver.get(expected)
        self.assert_stays(expected)

    def test_direct_message_url(self):
        expected = self.origin + f'/message/index.php?id=111&case={self.case}&view=conversation'
        self.driver.get(expected)
        self.assert_stays(expected)

    def test_home_menu_from_every_internal_page(self):
        LoginHandler.authenticated.add(self.case)
        for path in (COURSE, '/course/view.php?id=9', '/mod/assign/view.php?id=9',
                     '/mod/vod/view.php?id=9', '/mod/quiz/view.php?id=9',
                     '/message/index.php?id=9', '/calendar/view.php?view=month'):
            with self.subTest(path=path):
                self.driver.get(self.origin + path + ('&' if '?' in path else '?') + 'case=' + self.case)
                self.driver.find_element(By.ID, 'home-menu').click()
                self.assert_stays(self.origin + '/?case=' + self.case)

    def test_modified_click_new_tab_keeps_parent_state(self):
        from selenium.webdriver.common.action_chains import ActionChains
        from selenium.webdriver.common.keys import Keys
        self.calendar()
        original = self.driver.current_window_handle
        link = self.driver.find_element(By.ID, 'assign-link')
        expected = link.get_attribute('href')
        self.driver.execute_script("arguments[0].removeAttribute('target')", link)
        # Calendar detail uses smooth scrolling. Settle it before a coordinate action.
        self.driver.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'});arguments[0].addEventListener('click',e=>document.documentElement.dataset.modifiedClick=JSON.stringify({ctrl:e.ctrlKey,trusted:e.isTrusted}),{once:true})", link)
        self.driver.execute_async_script("const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(done))")
        ActionChains(self.driver).key_down(Keys.CONTROL).click(link).key_up(Keys.CONTROL).perform()
        self.wait.until(lambda d: len(d.window_handles) == 2,
                        'Ctrl-click should create a tab after the calendar scroll settles')
        self.driver.switch_to.window(next(h for h in self.driver.window_handles if h != original))
        self.assert_stays(expected)
        self.driver.switch_to.window(original)
        reply = self.control()
        self.assertFalse(reply['states']['plato_navigation_' + str(reply['tabId'])].get('pending'))

    def test_bookmark_course_navigation(self):
        expected = self.origin + f'/course/view.php?id=201&case={self.case}&section=2'
        self.driver.execute_cdp_cmd('Page.navigate', {'url': expected, 'transitionType': 'auto_bookmark'})
        self.assert_stays(expected)

    def test_external_link_new_tab(self):
        self.driver.get(self.origin.replace('127.0.0.1', 'localhost') + '/fixture-external')
        self.driver.execute_script("document.body.insertAdjacentHTML('beforeend','<a id=external target=_blank rel=\"noopener noreferrer\">External example</a>');document.querySelector('#external').href=arguments[0]", self.origin + f'/mod/assign/view.php?id=301&case={self.case}&action=view')
        self.new_tab_link('#external')

    def test_home_click_expiry_and_reload(self):
        self.calendar()
        LoginHandler.expire_home.add(self.case)
        self.driver.find_element(By.ID, 'home-menu').click()
        self.assert_stays(self.origin + '/?case=' + self.case)
        self.driver.refresh()
        self.assert_stays(self.origin + COURSE)

    def test_existing_assignment_session_modal(self):
        LoginHandler.authenticated.add(self.case)
        expected = self.origin + f'/mod/assign/view.php?id=401&case={self.case}'
        self.driver.get(expected)
        self.wait.until(lambda d: d.execute_script("return document.body.classList.contains('loggedin')"))
        LoginHandler.authenticated.discard(self.case)
        self.driver.execute_script("document.body.insertAdjacentHTML('beforeend','<div class=\"modal show\">세션 만료<button class=btn-primary>다시 로그인</button></div>');document.querySelector('.modal button').onclick=()=>location.href=arguments[0]", self.origin + '/login/index.php?case=' + self.case)
        self.wait.until(lambda _: self.case in LoginHandler.authenticated)
        self.assert_stays(expected)

    def test_long_course_reload_keeps_position_without_reauthentication(self):
        LoginHandler.authenticated.add(self.case)
        expected = self.origin + COURSE + '?case=' + self.case + '&long=1'
        self.driver.get(expected)
        self.wait.until(lambda d: d.execute_script("return document.documentElement.dataset.calendarReady==='1'"))
        self.driver.execute_script('scrollTo({top:700,behavior:"instant"})')
        self.driver.execute_async_script('const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(done))')
        count = sum(e['path'] == '/authenticate' and e['case'] == self.case for e in LoginHandler.events)
        self.driver.refresh()
        self.wait.until(lambda d: d.execute_script("return document.documentElement.dataset.calendarReady==='1'"))
        self.assert_stays(expected)
        self.assertAlmostEqual(self.driver.execute_script('return scrollY'), 700, delta=2)
        self.assertEqual(sum(e['path'] == '/authenticate' and e['case'] == self.case for e in LoginHandler.events), count)

    def test_discarded_assignment_expired_before_html_restores_exact_url(self):
        LoginHandler.authenticated.add(self.case)
        expected = self.origin + f'/mod/assign/view.php?id=409&case={self.case}&action=view#intro'
        self.driver.get(expected)
        self.assert_stays(expected)
        tab_id = self.control()['tabId']
        LoginHandler.authenticated.discard(self.case)
        self.driver.switch_to.new_window('tab')
        self.driver.get(self.origin + '/fixture-seed')
        self.wait.until(lambda d: d.execute_script("return document.documentElement.dataset.seeded==='1'"))
        helper = self.driver.current_window_handle
        discarded = self.control('discard', tabId=tab_id)
        self.assertTrue(discarded['discarded'])
        self.assertEqual(self.control('activate', tabId=discarded['tabId']), {'activated': True})
        self.wait.until(lambda d: len(d.window_handles) == 2)
        self.driver.switch_to.window(next(h for h in self.driver.window_handles if h != helper))
        try:
            self.wait.until(lambda _: self.case in LoginHandler.authenticated)
        except Exception:
            page = self.driver.execute_script('return {discarded:document.wasDiscarded,ready:document.readyState,classes:document.body.className,hasForm:!!document.querySelector("form")}')
            self.fail(f'Anonymous discard recovery: {self.driver.current_url}; '
                      f'page={page}; '
                      f'paths={[e["path"] for e in LoginHandler.events if e["case"] == self.case]}')
        self.assert_stays(expected)
        paths = [e['path'] for e in LoginHandler.events if e['case'] == self.case]
        self.assertGreaterEqual(sum(p.startswith('/mod/assign/view.php?id=409') for p in paths), 2)
        self.assertTrue(any(p.startswith('/login/') for p in paths))
        self.assertTrue(any(p.startswith('/sso/') for p in paths))
        self.assertEqual(paths.count('/authenticate'), 1)

    def test_long_course_session_expiry_returns_without_bottom_jump(self):
        LoginHandler.authenticated.add(self.case)
        expected = self.origin + COURSE + '?case=' + self.case + '&long=1'
        self.driver.get(expected)
        self.wait.until(lambda d: d.execute_script("return document.documentElement.dataset.calendarReady==='1'"))
        self.driver.execute_script('scrollTo({top:700,behavior:"instant"})')
        LoginHandler.authenticated.discard(self.case)
        self.driver.execute_script('''
document.body.insertAdjacentHTML('beforeend','<div class="modal show">세션 만료<button class="btn-primary">다시 로그인</button></div>');
document.querySelector('.modal button').onclick=()=>location.href=arguments[0];
''', self.origin + '/login/index.php?case=' + self.case)
        self.wait.until(lambda _: self.case in LoginHandler.authenticated)
        self.assert_stays(expected)
        self.wait.until(lambda d: d.execute_script("return document.documentElement.dataset.calendarReady==='1'"))
        # Login recovery promises the exact destination, not scroll persistence
        # through unrelated authentication documents. It must never force bottom.
        self.assertTrue(self.driver.execute_script('return scrollY < document.documentElement.scrollHeight-innerHeight-100'))
        restored = self.driver.execute_script('return scrollY')
        time.sleep(2.2)  # Include the content script's next login-monitor tick.
        self.assertEqual(self.driver.current_url, expected)
        self.assertAlmostEqual(self.driver.execute_script('return scrollY'), restored, delta=2)
        self.assertEqual(sum(e['path'] == '/authenticate' and e['case'] == self.case for e in LoginHandler.events), 1)

    def test_two_tabs_authenticate_independently(self):
        self.calendar()
        original = self.driver.current_window_handle
        expected = [self.origin + f'/mod/assign/view.php?id={i}&case={self.case}-{i}&action=view#intro' for i in (501, 502)]
        self.driver.execute_script("document.querySelector('#assign-link').href=arguments[0];document.querySelector('#vod-link').href=arguments[1]", *expected)
        self.driver.find_element(By.ID, 'assign-link').click()
        self.driver.find_element(By.ID, 'vod-link').click()
        self.wait.until(lambda d: len(d.window_handles) == 3)
        found = []
        for handle in self.driver.window_handles:
            if handle == original:
                continue
            self.driver.switch_to.window(handle)
            self.wait.until(lambda d: d.current_url in expected)
            found.append(self.driver.current_url)
            self.assertIsNone(self.driver.execute_script('return window.opener'))
        self.assertEqual(set(found), set(expected))
        time.sleep(.4)
        for handle in self.driver.window_handles:
            if handle != original:
                self.driver.switch_to.window(handle)
                self.assertIn(self.driver.current_url, expected)

    def test_first_login_without_destination(self):
        self.driver.get(self.origin + '/login/index.php?case=' + self.case)
        self.assert_stays(self.origin + COURSE)

    def test_expired_first_home_login_then_course(self):
        self.driver.get(self.origin + '/?expired=1&case=' + self.case)
        self.assert_stays(self.origin + COURSE)

    def test_initial_home_notice_on(self):
        self.driver.get(self.origin + '/?notice=1&slow=1&case=' + self.case)
        self.assert_stays(self.origin + COURSE)

    def test_initial_home_notice_off(self):
        self.driver.get(self.origin + '/fixture-seed?on=0')
        self.wait.until(lambda d: d.execute_script("return document.documentElement.dataset.seeded==='1'"))
        self.driver.get(self.origin + '/?notice=1&slow=1&case=' + self.case)
        self.assert_stays(self.origin + COURSE)

    def test_initial_home_without_notice(self):
        self.driver.get(self.origin + '/?slow=1&case=' + self.case)
        self.assert_stays(self.origin + COURSE)

    def test_login_failure_stops_submission(self):
        self.driver.get(self.origin + '/login/index.php?error=1&case=' + self.case)
        time.sleep(.4)
        self.assertIn('/login/index.php', self.driver.current_url)
        self.assertNotIn(self.case, LoginHandler.authenticated)

    def test_access_denied_destination_does_not_loop(self):
        expected = self.origin + f'/mod/assign/view.php?id=601&case={self.case}&denied=1'
        self.driver.get(expected)
        self.assert_stays(expected)
        self.assertIn('접근 권한 없음', self.driver.find_element(By.ID, 'region-main').text)

    def test_deleted_destination_does_not_loop(self):
        expected = self.origin + f'/mod/assign/view.php?id=602&case={self.case}&missing=1'
        self.driver.get(expected)
        self.assert_stays(expected)

    def test_expired_state_and_invalid_wantsurl(self):
        self.control('expire', url=self.origin + '/mod/assign/view.php?id=999')
        self.driver.get(self.origin + f'/login/index.php?case={self.case}&wantsurl=https%3A%2F%2Fevil.example%2Ftarget')
        self.assert_stays(self.origin + COURSE)

    def test_valid_wantsurl_full_query(self):
        from urllib.parse import quote
        expected = self.origin + f'/mod/assign/view.php?id=701&case={self.case}&action=view#intro'
        self.driver.get(self.origin + f'/login/index.php?case={self.case}&wantsurl=' + quote(expected, safe=''))
        self.assert_stays(expected)

    def test_hidden_form_wantsurl_is_preserved(self):
        from urllib.parse import quote
        expected = self.origin + f'/mod/assign/view.php?id=702&case={self.case}&action=view#intro'
        self.driver.get(self.origin + f'/login/index.php?case={self.case}&hiddenwants=' + quote(expected, safe=''))
        self.assert_stays(expected)

    def test_legacy_active_attempt_migrates_when_worker_state_is_empty(self):
        expected = self.origin + f'/mod/assign/view.php?id=703&case={self.case}&action=view'
        self.driver.execute_script("sessionStorage.setItem('plato_login_intent',JSON.stringify({url:arguments[0],reason:'click',createdAt:Date.now()}));sessionStorage.setItem('plato_auto_login_pending',Date.now().toString())", expected)
        self.driver.get(self.origin + f'/login/index.php?case={self.case}')
        self.assert_stays(expected)

    def test_worker_restart_preserves_destination(self):
        from urllib.parse import quote
        expected = self.origin + f'/mod/assign/view.php?id=801&case={self.case}'
        # Error holds the login form without submitting; destination is already saved.
        self.driver.get(self.origin + f'/login/index.php?error=1&case={self.case}&wantsurl=' + quote(expected, safe=''))
        snapshot = self.control()
        self.assertEqual(snapshot['states']['plato_navigation_' + str(snapshot['tabId'])]['url'], expected)
        workers = [t for t in self.driver.execute_cdp_cmd('Target.getTargets', {})['targetInfos'] if t['type'] == 'service_worker' and self.driver.extension_id in t['url']]
        self.assertEqual(len(workers), 1)
        self.driver.execute_cdp_cmd('Target.closeTarget', {'targetId': workers[0]['targetId']})
        self.driver.get(self.origin + f'/login/index.php?case={self.case}')
        self.assert_stays(expected)

    def test_closed_tab_state_is_removed(self):
        self.calendar()
        original = self.driver.current_window_handle
        self.new_tab_link('#assign-link')
        tab_id = self.control()['tabId']
        self.driver.close()
        self.driver.switch_to.window(original)
        self.wait.until(lambda _: 'plato_navigation_' + str(tab_id) not in self.control()['states'])


if __name__ == '__main__':
    unittest.main()
