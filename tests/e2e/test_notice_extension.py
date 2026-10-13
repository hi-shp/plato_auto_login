"""Real document_start/document_end scripts, anonymous AMD and response delays."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import parse_qs, urlparse
import unittest
import time

from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By
from test_extension import make_extension, launch_chrome, ROOT


HTML = r'''<!doctype html><html><head><meta charset="utf-8"><title>Anonymous notice fixture</title>
<style>body{font:16px sans-serif;margin:20px}.modal-ubboard-notice{padding:24px;border:2px solid blue}
.important{padding:20px;background:#eee;border:2px solid red}</style></head><body>
<main>Anonymous home fixture</main><div class="ubboard-popup" id="stage"></div>
<script>
const scenario=new URLSearchParams(location.search).get('scenario')||'late';
const state={created:0,saved:0,requests:0,visibleFrames:0,frames:0,initial:[],protectedClicks:0};
window.fixtureState=()=>({...state,remaining:document.querySelectorAll('#popup-splide').length,
 protected:!!document.querySelector('.important'),filter:!!document.querySelector('#plato-home-notice-filter')});
window.setFixtureToggle=enabled=>window.dispatchEvent(new CustomEvent('fixture-toggle',{detail:enabled}));
const add=()=>{
 const notice=document.createElement('div');notice.className='modal modal-ubboard-notice';
 notice.innerHTML='<div class="modal-dialog"><div class="modal-content"><div id="popup-splide" class="splide"><div class="splide__slide">Anonymous notice</div><div class="popup-footer"><button class="btn-not-show-again" data-not-show-type="2">더 이상 보지 않음</button></div></div></div></div>';
 if(scenario==='malformed') notice.querySelector('.modal-content').insertAdjacentHTML('beforeend','<form><input type="file"></form>');
 document.querySelector('#stage').append(notice);state.created++;
 state.initial.push(getComputedStyle(notice).visibility);
 const carousel=notice.querySelector('#popup-splide');
 const bind=()=>carousel.querySelector('button').addEventListener('click',()=>{
  state.requests++;
  fetch('/notice-save?scenario='+scenario+'&case='+new URLSearchParams(location.search).get('case'),{method:'POST'})
   .then(r=>r.json()).then(data=>{if(data.code==='100'){state.saved++;carousel.remove();}});
 });
 if(scenario!=='toggle')setTimeout(()=>{
  carousel.classList.add('is-initialized');
  if(scenario==='binding-delay')setTimeout(bind,700);else bind();
 },scenario==='late'?400:100);
};
if(scenario==='important'){
 const dialog=document.createElement('div');dialog.className='modal show important';dialog.setAttribute('role','alertdialog');
 dialog.innerHTML='Important submission confirmation <button id="important-close">Close</button>';
 dialog.querySelector('button').onclick=()=>{state.protectedClicks++;dialog.remove();};document.body.append(dialog);
}
setTimeout(add,0);
if(scenario==='late'){setTimeout(add,500);setTimeout(add,13050);}
let running=true;
const sample=()=>{if(!running)return;state.frames++;
 if([...document.querySelectorAll('.modal-ubboard-notice')].some(n=>n.querySelector('#popup-splide')&&getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).display!=='none'))state.visibleFrames++;
 requestAnimationFrame(sample);
};requestAnimationFrame(sample);window.stopFixtureFrames=()=>running=false;
</script></body></html>'''


class Handler(BaseHTTPRequestHandler):
    counts = {}

    def do_GET(self):
        if urlparse(self.path).path == '/slow.js':
            time.sleep(13.1)
            data = b'/* delayed page script */'
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        data = HTML.encode('utf-8')
        if parse_qs(urlparse(self.path).query).get('scenario') == ['slow']:
            data = data.replace(b'</body>', b'<script src="/slow.js"></script></body>')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        params = parse_qs(urlparse(self.path).query)
        key = params.get('case', [''])[0]
        self.counts[key] = self.counts.get(key, 0) + 1
        failure = params.get('scenario') == ['failure'] and self.counts[key] == 1
        data = json.dumps({'code': '500' if failure else '100'}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


class NoticeExtensionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        base = Path(cls.temp.name)
        ext = base / 'extension'
        make_extension(ext)
        # Only the fixture host is adapted; the production algorithms are intact.
        early = (ROOT / 'notice-early.js').read_text(encoding='utf-8')
        (ext / 'notice-early.js').write_text(early.replace(
            "location.hostname !== 'plato.pusan.ac.kr'", "location.hostname !== '127.0.0.1'"), encoding='utf-8')
        manifest = json.loads((ext / 'manifest.json').read_text(encoding='utf-8'))
        manifest['content_scripts'] = [
            {'matches': ['http://127.0.0.1/*'], 'js': ['notice-early.js'], 'run_at': 'document_start'},
            {'matches': ['http://127.0.0.1/*'], 'js': ['notice.js', 'notice-bootstrap.js'], 'run_at': 'document_end'}]
        (ext / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        (ext / 'notice-bootstrap.js').write_text("""
if(location.pathname==='/seed'){
 chrome.storage.local.set({platoPopupClose:new URLSearchParams(location.search).get('on')==='1'},()=>{
 document.documentElement.dataset.seeded='1';});
}
window.addEventListener('fixture-toggle',e=>chrome.storage.local.set({platoPopupClose:e.detail===true}));
document.documentElement.dataset.noticeVersion=chrome.runtime.getManifest().version;
""", encoding='utf-8')
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.driver = launch_chrome(ext, base / 'profile')
        cls.wait = WebDriverWait(cls.driver, 20)
        cls.case = 0

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def open(self, scenario, enabled=True):
        origin = f'http://127.0.0.1:{self.server.server_port}'
        self.driver.get(f'{origin}/seed?on={int(enabled)}')
        self.wait.until(lambda d: d.execute_script("return document.documentElement.dataset.seeded==='1'"))
        type(self).case += 1
        self.driver.get(f'{origin}/?scenario={scenario}&case={self.case}')
        self.wait.until(lambda _: self.state()['created'] >= 1)

    def state(self):
        return self.driver.execute_script('return fixtureState()')

    def test_first_frames_multiple_and_notice_after_12_seconds(self):
        self.open('late')
        self.wait.until(lambda _: self.state()['saved'] == 3)
        state = self.state()
        self.assertEqual(state['requests'], 3)
        self.assertEqual(state['visibleFrames'], 0)
        self.assertEqual(state['initial'], ['hidden'] * 3)
        self.assertGreater(state['frames'], 20)
        self.assertEqual(state['remaining'], 0)
        self.assertTrue(state['filter'])
        output = ROOT / 'dist' / 'e2e' / 'notice-first-frames.png'
        output.parent.mkdir(parents=True, exist_ok=True)
        self.driver.save_screenshot(str(output))

    def test_setting_off_then_on_processes_existing_notice(self):
        self.open('off', enabled=False)
        self.wait.until(lambda _: self.state()['visibleFrames'] > 2)
        self.assertEqual(self.state()['requests'], 0)
        self.driver.execute_script('setFixtureToggle(true)')
        self.wait.until(lambda _: self.state()['saved'] == 1)
        self.assertTrue(self.state()['filter'])

    def test_slow_document_end_does_not_release_filter_after_12_seconds(self):
        self.open('slow')
        self.wait.until(lambda _: self.state()['saved'] == 1)
        self.assertEqual(self.state()['visibleFrames'], 0)
        self.assertEqual(self.state()['initial'], ['hidden'])
        self.assertTrue(self.state()['filter'])

    def test_on_off_on_does_not_permanently_hide_disabled_notice(self):
        self.open('toggle')
        self.assertEqual(self.state()['initial'], ['hidden'])
        self.driver.execute_script('setFixtureToggle(false)')
        self.wait.until(lambda _: not self.state()['filter'])
        self.assertTrue(self.driver.find_element(By.CSS_SELECTOR, '.modal-ubboard-notice').is_displayed())
        self.driver.execute_script('setFixtureToggle(true)')
        self.wait.until(lambda _: self.state()['filter'])
        self.assertFalse(self.driver.find_element(By.CSS_SELECTOR, '.modal-ubboard-notice').is_displayed())
        self.assertEqual(self.state()['requests'], 0)

    def test_late_handler_binding_can_retry(self):
        self.open('binding-delay')
        self.wait.until(lambda _: self.state()['saved'] == 1)
        self.assertEqual(self.state()['visibleFrames'], 0)
        self.assertEqual(self.state()['requests'], 1)

    def test_failed_official_response_can_retry_without_flash(self):
        self.open('failure')
        self.wait.until(lambda _: self.state()['saved'] == 1)
        self.assertEqual(self.state()['requests'], 2)
        self.assertEqual(self.state()['visibleFrames'], 0)

    def test_important_dialog_is_visible_and_not_auto_clicked(self):
        self.open('important')
        self.wait.until(lambda _: self.state()['frames'] > 5)
        self.assertTrue(self.driver.find_element(By.CSS_SELECTOR, '.important').is_displayed())
        self.assertEqual(self.state()['protectedClicks'], 0)
        self.assertEqual(self.state()['requests'], 0)
        self.driver.find_element(By.ID, 'important-close').click()
        self.wait.until(lambda _: self.state()['saved'] == 1)
        self.assertEqual(self.state()['visibleFrames'], 0)

    def test_form_inside_notice_is_not_filtered_or_clicked(self):
        self.open('malformed')
        self.wait.until(lambda _: self.state()['visibleFrames'] > 2)
        self.assertEqual(self.state()['requests'], 0)
        self.assertTrue(self.driver.find_element(By.CSS_SELECTOR, '.modal-ubboard-notice').is_displayed())
