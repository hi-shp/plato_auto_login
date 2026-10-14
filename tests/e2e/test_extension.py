"""Load a temporary, real Chrome extension against an isolated local LMS fixture.

The temporary manifest permits only 127.0.0.1. It never opens a real LMS or
copies credentials. Screenshots are saved under the ignored dist/e2e directory.
"""
from __future__ import annotations

import calendar
import json
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread
import unittest

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
import websocket


ROOT = Path(__file__).resolve().parents[2]
SCREENSHOTS = ROOT / "dist" / "e2e"
BASELINE = "d5f3a6c"  # v2026.10.11, before the calendar-time.js split
BOOTSTRAP = r"""
(() => {
  const params = new URLSearchParams(location.search);
  const site = params.get('site');
  const scenario = params.get('scenario') || 'empty';
  const calendar = site === 'plato' ? PlatoCalendar : BbitsCalendar;
  document.documentElement.dataset.helperLoaded = typeof CalendarTime;
  const originalRender = calendar.render;
  calendar.render = function() {
    try {
      const result = originalRender.call(this);
      document.documentElement.dataset.renderCount = String(Number(document.documentElement.dataset.renderCount || 0) + 1);
      if (this.cachedData?.activities?.length) document.documentElement.dataset.cacheSeen = '1';
      return result;
    } catch (error) {
      document.documentElement.dataset.extensionError = error.message;
      throw error;
    }
  };
  calendar.fetchCourseStatuses = async () => {
    if (scenario === 'failure' || scenario === 'legacy-failure') throw new Error('Fixture network failure');
    if (scenario === 'timeout') await new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture timeout')), 100));
    return {globalStatusMap: {}, nameStatusMap: {}};
  };
  calendar.fetchCalendarDoc = async () => document.createElement('table');
  calendar.syncSemesterMonthsInBackground = async () => {};
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  const key = `${year}_${month}`;
  const cache = {curYear: year, curMonth: month,
    days: Array.from({length: new Date(year, month, 0).getDate()}, (_, i) => ({day:i+1,events:[]})),
    activities: [{title:'익명 과제',type:'과제',courseName:'시험 강좌',dueDay:15,
      isCompleted:false,statusType:'pending',statusLabel:'미완료',dDayText:'D-3',periodText:'15일 마감',href:'#'}],
    dayDueActivitiesMap:{}};
  if (scenario === 'corrupt') {
    cache.days = [null, {day:1}, {day:now.getDate(),isToday:false,events:null}];
    cache.activities = [null];
    cache.dayDueActivitiesMap = {1:[null]};
  }
  const prefix = site === 'plato' ? 'plato' : 'bbits';
  const values = scenario === 'legacy' || scenario === 'legacy-failure' || scenario === 'corrupt'
    ? {[`${prefix}_calendar_months`]:{[key]:cache}, [`${prefix}_calendar_data`]:cache}
    : {};
  const mount = () => chrome.storage.local.set(values, () => {
    if (site === 'plato') calendar.init();
    else { calendar.mountWidgetSkeleton(); calendar.loadCachedData(); }
  });
  if (scenario === 'preserve') mount();
  else chrome.storage.local.clear(mount);
})();
"""


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = """<!doctype html><html lang="ko"><head><meta charset="utf-8"></head>
        <body><div id="region-main"><div class="open-content"><div class="course_lists"></div></div></div></body></html>"""
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


def make_extension(directory: Path, *, baseline: bool = False, omit_helpers: bool = False):
    directory.mkdir()
    if baseline:
        manifest = json.loads(subprocess.check_output(["git", "show", f"{BASELINE}:manifest.json"], cwd=ROOT))
        names = ["manifest.json", "content.js", "calendar.css", "event.js", "favicon.png", "popup.html", "popup.js"]
        for name in names:
            (directory / name).write_bytes(subprocess.check_output(["git", "show", f"{BASELINE}:{name}"], cwd=ROOT))
    else:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        names = ["manifest.json", "calendar-time.js", "notice-early.js", "notice.js", "navigation.js", "navigation-worker.js", "content.js", "calendar.css",
                 "event.js", "favicon.png", "popup.html", "popup.js"]
        for name in names:
            shutil.copy2(ROOT / name, directory / name)
    manifest["host_permissions"] = ["http://127.0.0.1/*"]
    manifest["content_scripts"] = [{
        "matches": ["http://127.0.0.1/*"],
        "js": (["content.js"] if baseline or omit_helpers else ["calendar-time.js", "notice.js", "content.js"])
              + ["test-bootstrap.js"],
        "css": ["calendar.css"], "run_at": "document_end"
    }]
    (directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    (directory / "test-bootstrap.js").write_text(BOOTSTRAP, encoding="utf-8")


def launch_chrome(extension: Path, profile: Path):
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--window-size=1366,768")
    options.add_argument(f"--user-data-dir={profile}")
    options.add_argument("--remote-debugging-pipe")
    options.add_argument("--enable-unsafe-extension-debugging")
    options.set_capability("webSocketUrl", True)
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    driver = webdriver.Chrome(options=options)
    try:
        connection = websocket.create_connection(driver.capabilities["webSocketUrl"], timeout=15)
        try:
            connection.send(json.dumps({"id": 1, "method": "webExtension.install", "params": {
                "extensionData": {"type": "path", "path": str(extension)}
            }}))
            result = json.loads(connection.recv())
        finally:
            connection.close()
        if result.get("type") != "success" or not result.get("result", {}).get("extension"):
            raise RuntimeError(f"Chrome extension install failed: {result}")
        driver.extension_id = result["result"]["extension"]
        return driver
    except Exception:
        driver.quit()
        raise


class ExtensionBrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        cls.base = Path(cls.temp.name)
        cls.extension = cls.base / "extension"
        make_extension(cls.extension)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.driver = launch_chrome(cls.extension, cls.base / "profile")
        cls.wait = WebDriverWait(cls.driver, 12)
        SCREENSHOTS.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def open_site(self, site: str, scenario: str = "empty", driver=None):
        driver = driver or self.driver
        path = "/local/ubion/allcourse/regular/index.php" if site == "plato" else "/"
        driver.get(f"http://127.0.0.1:{self.server.server_port}{path}?site={site}&scenario={scenario}")
        prefix = site
        WebDriverWait(driver, 12).until(lambda d: d.execute_script(
            f"return document.querySelectorAll('#{prefix}-large-days-grid .plato-large-day-cell:not(.empty)').length > 0 || !!document.documentElement.dataset.extensionError"))
        WebDriverWait(driver, 12).until(lambda d: not d.execute_script(
            f"return !!document.querySelector('#{prefix}-cal-loading-overlay.active')"))
        return prefix

    def grid_state(self, site: str, driver=None):
        driver = driver or self.driver
        return driver.execute_script("""
            const root = document.querySelector(`#${arguments[0]}-calendar-widget`);
            const grid = root?.querySelector('.plato-large-days-grid');
            const cells = [...(grid?.querySelectorAll('.plato-large-day-cell:not(.empty)') || [])];
            return {widget:!!root,weekdays:root?.querySelectorAll('.plato-cal-weekdays span').length,
              numbers:cells.map(c=>Number(c.querySelector('.plato-day-num')?.textContent)),
              visible:cells.every(c=>{const r=c.getBoundingClientRect();const s=getComputedStyle(c);
                return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden'}),
              blanks:grid?.querySelectorAll('.plato-large-day-cell.empty').length,
              today:grid?.querySelectorAll('.plato-large-day-cell.today').length,
              error:document.documentElement.dataset.extensionError || '',
              helper:document.documentElement.dataset.helperLoaded,
              renderCount:Number(document.documentElement.dataset.renderCount||0),
              overlay:root?.querySelector('.plato-cal-loading-overlay')?.classList.contains('active')};
        """, site)

    def assert_month(self, site: str, year: int, month: int, driver=None):
        state = self.grid_state(site, driver)
        self.assertEqual(state["error"], "", state)
        self.assertTrue(state["widget"])
        self.assertEqual(state["weekdays"], 7)
        self.assertEqual(state["numbers"], list(range(1, calendar.monthrange(year, month)[1] + 1)))
        self.assertTrue(state["visible"])
        self.assertEqual(state["blanks"], (calendar.weekday(year, month, 1) + 1) % 7)
        return state

    def test_both_sites_initial_grid_navigation_and_detail(self):
        now = datetime.now()
        for site in ("plato", "bbits"):
            with self.subTest(site=site):
                self.open_site(site)
                initial = self.assert_month(site, now.year, now.month)
                self.assertEqual(initial["helper"], "object")
                self.assertEqual(initial["today"], 1)
                root = f"#{site}-calendar-widget"
                self.driver.find_element(By.CSS_SELECTOR, f"{root} .plato-large-day-cell:not(.empty)").click()
                self.wait.until(lambda _: self.driver.find_element(By.ID, f"{site}-calendar-detail-panel").is_displayed())
                self.driver.find_element(By.ID, f"{site}-detail-close-btn").click()
                self.assertFalse(self.driver.find_element(By.ID, f"{site}-calendar-detail-panel").is_displayed())
                self.driver.find_element(By.ID, f"{site}-cal-prev-btn").click()
                previous_year = now.year if now.month > 1 else now.year - 1
                previous_month = now.month - 1 or 12
                self.wait.until(lambda _: self.grid_state(site)["numbers"][-1] == calendar.monthrange(previous_year, previous_month)[1])
                self.assert_month(site, previous_year, previous_month)
                self.driver.find_element(By.ID, f"{site}-cal-next-btn").click()
                self.wait.until(lambda _: self.grid_state(site)["numbers"][-1] == calendar.monthrange(now.year, now.month)[1])
                self.assert_month(site, now.year, now.month)
                self.driver.find_element(By.ID, f"{site}-cal-toggle-btn").click()
                self.assertIn("collapsed", self.driver.find_element(By.ID, f"{site}-calendar-widget").get_attribute("class"))
                self.driver.find_element(By.ID, f"{site}-cal-toggle-btn").click()
                self.assertNotIn("collapsed", self.driver.find_element(By.ID, f"{site}-calendar-widget").get_attribute("class"))

    def test_cache_and_failure_keep_dates(self):
        now = datetime.now()
        for site in ("plato", "bbits"):
            for scenario in ("legacy", "corrupt", "failure", "timeout"):
                with self.subTest(site=site, scenario=scenario):
                    self.open_site(site, scenario)
                    state = self.assert_month(site, now.year, now.month)
                    self.assertEqual(state["today"], 1)
                    self.wait.until(lambda d: not self.grid_state(site)["overlay"])

    def test_four_viewports_and_screenshots(self):
        for site in ("plato", "bbits"):
            self.open_site(site, "legacy-failure")
            for width, height in ((1920,1080),(1366,768),(768,900),(390,844)):
                with self.subTest(site=site, viewport=width):
                    self.driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
                        "width": width, "height": height, "deviceScaleFactor": 1, "mobile": False
                    })
                    self.assertEqual(self.driver.execute_script("return [innerWidth,innerHeight]"), [width,height])
                    self.assert_month(site, datetime.now().year, datetime.now().month)
                    self.assertTrue(self.driver.execute_script("""
                        const badge = document.querySelector(`#${arguments[0]}-calendar-widget .plato-day-badge`);
                        if (!badge) return false;
                        const b = badge.getBoundingClientRect(), cell = badge.closest('.plato-large-day-cell').getBoundingClientRect();
                        return b.width > 0 && b.left >= cell.left && b.right <= cell.right + 0.5;
                    """, site))
                    self.assertLessEqual(self.driver.execute_script("return document.documentElement.scrollWidth"), width)
                    self.driver.save_screenshot(str(SCREENSHOTS / f"{site}-{width}x{height}.png"))
            self.driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})

    def test_cached_activity_and_refresh_failure(self):
        for site in ("plato", "bbits"):
            with self.subTest(site=site):
                self.open_site(site, "legacy-failure")
                self.assertEqual(self.grid_state(site)["numbers"][14], 15)
                selector = f"#{site}-large-days-grid .plato-large-day-cell:not(.empty)"
                self.driver.find_elements(By.CSS_SELECTOR, selector)[14].click()
                panel = self.driver.find_element(By.ID, f"{site}-calendar-detail-panel")
                self.wait.until(lambda _: panel.is_displayed())
                self.assertIn("익명 과제", panel.text)
                self.driver.find_element(By.ID, f"{site}-refresh-btn").click()
                self.wait.until(lambda _: not self.grid_state(site)["overlay"])
                self.assert_month(site, datetime.now().year, datetime.now().month)

    def test_popup_calendar_settings_persist(self):
        self.driver.get(f"chrome-extension://{self.driver.extension_id}/popup.html")
        self.wait.until(lambda d: d.find_element(By.ID, "platoCalendarToggle").is_selected())
        for field in ("platoCalendarToggle", "bbitsCalendarToggle"):
            checkbox = self.driver.find_element(By.ID, field)
            self.assertTrue(checkbox.is_selected())
            checkbox.click()
        self.wait.until(lambda d: d.execute_async_script("""
            const done = arguments[0];
            chrome.storage.local.get(['platoCalendarToggle','bbitsCalendarToggle'], data =>
                done(data.platoCalendarToggle === false && data.bbitsCalendarToggle === false));
        """))
        self.driver.refresh()
        for field in ("platoCalendarToggle", "bbitsCalendarToggle"):
            self.assertFalse(self.driver.find_element(By.ID, field).is_selected())

    def test_legacy_manifest_missing_helper_still_shows_dates(self):
        extension = self.base / "legacy-manifest"
        make_extension(extension, omit_helpers=True)
        driver = launch_chrome(extension, self.base / "legacy-profile")
        try:
            for site in ("plato", "bbits"):
                self.open_site(site, "legacy-failure", driver)
                state = self.assert_month(site, datetime.now().year, datetime.now().month, driver)
                self.assertEqual(state["helper"], "undefined")
                self.assertGreaterEqual(state["renderCount"], 1)
                self.assertEqual(driver.execute_script("return document.documentElement.dataset.cacheSeen"), "1")
        finally:
            driver.quit()

    def test_v2026_10_11_baseline_grid(self):
        extension = self.base / "baseline"
        make_extension(extension, baseline=True)
        driver = launch_chrome(extension, self.base / "baseline-profile")
        try:
            for site in ("plato", "bbits"):
                self.open_site(site, "empty", driver)
                self.assert_month(site, datetime.now().year, datetime.now().month, driver)
        finally:
            driver.quit()


if __name__ == "__main__":
    unittest.main()
