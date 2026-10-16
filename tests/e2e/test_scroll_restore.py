"""Chrome reload, discard, freeze and history scroll with anonymous long pages."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import time
from urllib.parse import urlparse
import unittest

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from test_extension import BOOTSTRAP, launch_chrome, make_extension


class ScrollHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if urlparse(self.path).path == '/away':
            html = '<!doctype html><html><body>Anonymous other page</body></html>'
        else:
            html = '''<!doctype html><html><head><meta charset="utf-8"></head><body>
            <div id="region-main"><div class="open-content"><div class="course_lists"
            style="height:2400px">Anonymous course list</div></div></div>
            <div id="fragment-target">Anonymous fragment target</div></body></html>'''
        data = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


SCROLL_BRIDGE = '''
document.documentElement.dataset.discarded=String(document.wasDiscarded);
document.addEventListener('scroll-fixture',event=>{
 if(event.detail.action==='render') {
  const site=new URLSearchParams(location.search).get('site');
  const c=site==='plato'?PlatoCalendar:BbitsCalendar;
  c.render();document.documentElement.dataset.fixtureRendered='1';
 } else chrome.runtime.sendMessage({type:'scroll-fixture',...event.detail},result=>{
  document.documentElement.dataset.scrollReply=JSON.stringify(result);
 });
});
window.addEventListener('pageshow',event=>{
 document.documentElement.dataset.persisted=String(event.persisted);
});
'''


class ScrollRestoreTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        cls.base = Path(cls.temp.name)
        extension = cls.base / 'extension'
        make_extension(extension)
        (extension / 'test-bootstrap.js').write_text(BOOTSTRAP + SCROLL_BRIDGE, encoding='utf-8')
        with (extension / 'navigation-worker.js').open('a', encoding='utf-8') as file:
            file.write('''
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(m.type!=='scroll-fixture')return;
 (async()=>{
  if(m.action==='discard'){
   const tab=await chrome.tabs.discard(m.tabId);reply({discarded:tab?.discarded,tabId:tab?.id});
  } else if(m.action==='activate'){
   await chrome.tabs.update(m.tabId,{active:true});reply({activated:true});
  } else reply({tabId:s.tab.id});
 })().catch(e=>reply({error:e.message}));return true;
});
''')
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), ScrollHandler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        cls.driver = launch_chrome(extension, cls.base / 'profile')
        cls.wait = WebDriverWait(cls.driver, 12)

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

    def open_site(self, site, scenario='empty', suffix=''):
        self.driver.get(self.origin + '/local/ubion/allcourse/regular/index.php'
                        + f'?site={site}&scenario={scenario}' + suffix)
        self.ready(site)

    def ready(self, site):
        self.wait.until(lambda d: d.execute_script('''
return document.querySelectorAll(`#${arguments[0]}-large-days-grid .plato-day-num`).length>27
 && !document.querySelector(`#${arguments[0]}-cal-loading-overlay.active`);
''', site))
        self.driver.execute_async_script('const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(done))')

    def position(self, y):
        self.driver.execute_script('scrollTo({top:arguments[0],behavior:"instant"})', y)
        self.driver.execute_async_script('const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(done))')
        return self.driver.execute_script('return scrollY')

    def assert_position(self, expected):
        # Sample after several frames as well as the first restored position.
        for _ in range(3):
            self.assertAlmostEqual(self.driver.execute_script('return scrollY'), expected, delta=2)
            time.sleep(.1)

    def control(self, action='get', **values):
        self.driver.execute_script('''
delete document.documentElement.dataset.scrollReply;
document.dispatchEvent(new CustomEvent('scroll-fixture',{detail:arguments[0]}));
''', {'action': action, **values})
        return json.loads(self.wait.until(lambda d: d.execute_script('return document.documentElement.dataset.scrollReply')))

    def test_reload_top_middle_bottom_both_calendars(self):
        for site in ('plato', 'bbits'):
            self.open_site(site)
            for y in (0, 250, 700, 1200, 2500):
                with self.subTest(site=site, y=y):
                    before = self.position(y)
                    self.driver.refresh()
                    self.ready(site)
                    self.assert_position(before)
                    self.assertEqual(self.driver.execute_script('return history.scrollRestoration'), 'auto')

    def test_cache_failure_and_refresh_preserve_viewport(self):
        for site in ('plato', 'bbits'):
            for scenario in ('legacy', 'corrupt', 'failure', 'timeout'):
                with self.subTest(site=site, scenario=scenario):
                    self.open_site(site, scenario)
                    before = self.position(700)
                    self.driver.refresh()
                    self.ready(site)
                    self.assert_position(before)
                    # Programmatic fixture click does not scroll the button into view.
                    self.driver.execute_script('document.getElementById(arguments[0]+"-refresh-btn").click()', site)
                    self.ready(site)
                    self.assert_position(before)

    def test_freeze_resume_and_background_tab_refresh(self):
        for site in ('plato', 'bbits'):
            with self.subTest(site=site):
                self.open_site(site)
                before = self.position(700)
                self.driver.execute_cdp_cmd('Page.setWebLifecycleState', {'state': 'frozen'})
                self.driver.execute_cdp_cmd('Page.setWebLifecycleState', {'state': 'active'})
                self.assert_position(before)
                original = self.driver.current_window_handle
                self.driver.switch_to.new_window('tab')
                self.driver.get(self.origin + '/away')
                self.driver.switch_to.window(original)
                self.driver.execute_script("document.dispatchEvent(new CustomEvent('scroll-fixture',{detail:{action:'render'}}))")
                self.assert_position(before)

    def test_actual_discard_and_reactivation(self):
        for site in ('plato', 'bbits'):
            with self.subTest(site=site):
                self.setUp()
                self.open_site(site)
                before = self.position(700)
                tab_id = self.control()['tabId']
                original = self.driver.current_window_handle
                self.driver.switch_to.new_window('tab')
                self.open_site(site)
                helper = self.driver.current_window_handle
                discarded = self.control('discard', tabId=tab_id)
                self.assertTrue(discarded.get('discarded'), discarded)
                self.assertEqual(self.control('activate', tabId=discarded['tabId']), {'activated': True})
                # Discard destroys the old renderer target. Chrome creates a
                # new WebDriver handle when the browser tab is reactivated.
                self.wait.until(lambda d: len(d.window_handles) >= 2)
                for handle in self.driver.window_handles:
                    if handle != helper:
                        self.driver.switch_to.window(handle)
                        break
                self.ready(site)
                self.assertEqual(self.driver.execute_script('return document.wasDiscarded'), True)
                self.assert_position(before)

    def test_history_return_and_fragment_are_native(self):
        for site in ('plato', 'bbits'):
            with self.subTest(site=site):
                self.open_site(site)
                before = self.position(700)
                self.driver.get(self.origin + '/away')
                self.driver.back()
                self.ready(site)
                self.assert_position(before)
                self.open_site(site, suffix='#fragment-target')
                self.wait.until(lambda d: d.execute_script('return document.getElementById("fragment-target").getBoundingClientRect().top<innerHeight'))
                self.assertGreater(self.driver.execute_script('return scrollY'), 1500)

    def test_explicit_detail_scroll_and_filter_scope(self):
        for site in ('plato', 'bbits'):
            with self.subTest(site=site):
                self.open_site(site, 'legacy-failure')
                self.assertEqual(self.driver.execute_script('''
const w=document.getElementById(arguments[0]+'-calendar-widget');
return [getComputedStyle(w.parentElement).overflowAnchor,getComputedStyle(document.body).overflowAnchor];
''', site), ['none', 'auto'])
                self.driver.find_elements(By.CSS_SELECTOR, f'#{site}-large-days-grid .plato-large-day-cell:not(.empty)')[14].click()
                self.wait.until(lambda d: d.find_element(By.ID, site + '-calendar-detail-panel').is_displayed())
                time.sleep(.4)
                self.assertTrue(self.driver.execute_script('''
const r=document.getElementById(arguments[0]+'-calendar-detail-panel').getBoundingClientRect();
return r.top<innerHeight && r.bottom>0;
''', site))
                # Removing the widget removes the opt-out automatically.
                self.driver.execute_script('document.getElementById(arguments[0]+"-calendar-widget").remove()', site)
                self.assertEqual(self.driver.execute_script('return getComputedStyle(document.querySelector(".open-content")).overflowAnchor'), 'auto')


if __name__ == '__main__':
    unittest.main()
