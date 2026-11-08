"""Real isolated Chrome tests for student support SSO and MAIN-world readiness.

Uses only anonymous localhost pages and synthetic credentials. No real SSO
tokens, cookies, accounts, or requests to university servers are involved.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import parse_qs, urlparse
import unittest

from selenium.webdriver.support.ui import WebDriverWait
from test_extension import ROOT, launch_chrome


class SupportHandler(BaseHTTPRequestHandler):
    calls = []

    def do_GET(self):
        parsed = urlparse(self.path)
        scenario = parse_qs(parsed.query).get('case', ['success'])[0]
        type(self).calls.append(parsed.path)
        if parsed.path == '/protected':
            self.send_response(302)
            self.send_header('Location', '/login?case=success')
            self.end_headers()
            return
        if parsed.path == '/success':
            body = '<li id="global_login">로그아웃</li>'
        elif parsed.path == '/notice':
            body = '''<a href="javascript:changeNextPw()">다음에 변경</a>
            <script>setTimeout(()=>window.changeNextPw=()=>{
              document.body.dataset.calls=String(Number(document.body.dataset.calls||0)+1);
            },700);</script>'''
        elif parsed.path == '/sso':
            body = '''<input id="login_id"><input type="password" id="login_pw">
            <input type="button" id="btnLogin" onclick="document.body.dataset.calls=String(Number(document.body.dataset.calls||0)+1)">
            <div class="alert">아이디 또는 비밀번호 정보를 확인해주세요!</div>'''
        else:
            target = '/login?status=fail' if scenario == 'reject' else '/success'
            body = '<li id="global_login"><a href="#" onclick="ssoOpen();return false">로그인</a></li>'
            body += '<div id="popup_error" role="alert">회원정보가 없습니다. 다시 로그인해주세요</div><div class="modal-backdrop"></div>'
            body += f'''<script>setTimeout(()=>window.ssoOpen=()=>location.replace('{target}'),700);</script>'''
        data = ('<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


class OnestopExtensionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        cls.base = Path(cls.temp.name)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), SupportHandler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        ext = cls.base / 'extension'
        ext.mkdir()
        source = (ROOT / 'content.js').read_text(encoding='utf-8')
        source = source.replace('onestop.pusan.ac.kr', '127.0.0.1').replace('login.pusan.ac.kr', 'localhost')
        (ext / 'content.js').write_text(source, encoding='utf-8')
        (ext / 'event.js').write_bytes((ROOT / 'event.js').read_bytes())
        # Settings complete before the actual content script runs. MAIN-world
        # event.js and late site functions are genuine separate script worlds.
        (ext / 'settings.js').write_text('''
const fixtureReady = new Promise(resolve=>chrome.storage.local.set({hjsToggle:true,
 hjsPopupClose:true,hjsId:'fixture-user',hjsPw:'fixture-password'},resolve));
const originalGet=chrome.storage.local.get.bind(chrome.storage.local);
chrome.storage.local.get=(keys,callback)=>fixtureReady.then(()=>originalGet(keys,callback));
''', encoding='utf-8')
        manifest = {'manifest_version': 3, 'name': 'Anonymous student support test', 'version': '1',
            'permissions': ['storage'], 'host_permissions': ['http://127.0.0.1/*','http://localhost/*'],
            'content_scripts': [
                {'matches':['http://127.0.0.1/*','http://localhost/*'], 'js':['event.js'], 'world':'MAIN','run_at':'document_start'},
                {'matches':['http://127.0.0.1/*','http://localhost/*'], 'js':['settings.js','content.js'],'run_at':'document_end'}]}
        (ext / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        cls.driver = launch_chrome(ext, cls.base / 'profile')
        cls.wait = WebDriverWait(cls.driver, 12)

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def setUp(self):
        SupportHandler.calls = []

    def settle(self):
        # Wait across the real 2-second automatic-login monitoring cycle.
        self.driver.execute_async_script('setTimeout(arguments[0],2600)')

    def test_late_site_function_retries_and_success_does_not_repeat(self):
        self.driver.get(self.origin + '/login')
        self.wait.until(lambda d: urlparse(d.current_url).path == '/success')
        self.settle()
        self.assertEqual(SupportHandler.calls.count('/success'),1)
        self.assertIn('로그아웃', self.driver.find_element('id','global_login').text)

    def test_session_expiry_server_redirect_recovers(self):
        self.driver.get(self.origin + '/protected')
        self.wait.until(lambda d: urlparse(d.current_url).path == '/success')
        self.assertEqual(SupportHandler.calls.count('/protected'),1)
        self.assertEqual(SupportHandler.calls.count('/success'),1)

    def test_member_lookup_failure_preserves_dialog_and_does_not_loop(self):
        self.driver.get(self.origin + '/login?status=fail')
        self.settle()
        self.assertIn('status=fail',self.driver.current_url)
        self.assertTrue(self.driver.find_element('id','popup_error').is_displayed())
        self.assertEqual(self.driver.execute_script("return document.querySelector('#global_login').dataset.done || ''"),'')
        self.assertEqual(SupportHandler.calls.count('/login'),1)

    def test_server_rejection_after_sso_stops_at_error(self):
        self.driver.get(self.origin + '/login?case=reject')
        self.wait.until(lambda d: 'status=fail' in d.current_url)
        self.settle()
        self.assertEqual(SupportHandler.calls.count('/login'),2)
        self.assertTrue(self.driver.find_element('id','popup_error').is_displayed())

    def test_password_notice_calls_official_function_once(self):
        self.driver.get(f'http://localhost:{self.server.server_port}/notice')
        self.wait.until(lambda d: d.execute_script("return document.body.dataset.calls === '1'"))
        self.settle()
        self.assertEqual(self.driver.execute_script('return document.body.dataset.calls'),'1')

    def test_known_login_error_is_not_submitted_again(self):
        self.driver.get(f'http://localhost:{self.server.server_port}/sso')
        self.settle()
        self.assertIsNone(self.driver.execute_script('return document.body.dataset.calls'))
        self.assertEqual(self.driver.find_element('id','login_id').get_attribute('value'),'')


if __name__ == '__main__':
    unittest.main()
