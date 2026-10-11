"""Optional Chrome browser tests for local, anonymous PLATO fixtures.

Run: python -m unittest discover -s tests/e2e -p 'test_*.py' -v
Requires selenium and a Chrome/ChromeDriver installation. No LMS account is used.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[2]


class FixtureBrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1100,900")
        options.add_argument(f"--user-data-dir={cls.temp.name}")
        cls.browser = webdriver.Chrome(options=options)
        cls.wait = WebDriverWait(cls.browser, 8)

    @classmethod
    def tearDownClass(cls):
        cls.browser.quit()
        cls.temp.cleanup()

    def open_fixture(self, name):
        self.browser.get((ROOT / "tests" / "fixtures" / name).as_uri())

    def click(self, id_):
        self.browser.find_element(By.ID, id_).click()

    def state(self):
        return self.browser.execute_script("return fixtureState()")

    def test_notice_repeated_and_protected_dialogs(self):
        self.open_fixture("popup-lab.html")
        for _ in range(3):
            self.click("notices")
            self.click("run")
            self.assertEqual(self.state()["permanent"], 2)
            self.assertEqual(self.state()["notices"], 0)
            self.click("run")
            self.assertEqual(self.state()["permanent"], 2)
            self.click("reset")

        self.click("notice")
        self.click("enabled")
        self.click("run")
        self.assertEqual(self.state()["notices"], 1)
        self.click("reset")

        self.click("nested")
        self.click("run")
        self.assertEqual(self.state()["notices"], 1)
        self.assertEqual(self.state()["dialogs"], 1)
        self.assertEqual(self.state()["permanent"], 0)
        self.click("reset")

        for protected in ("assignment", "upload", "session", "login"):
            self.click(protected)
            self.click("run")
            self.assertEqual(self.state()["dialogs"], 1)
            self.assertEqual(self.state()["close"], 0)
            self.click("reset")

        self.click("close-only")
        self.click("run")
        self.assertEqual(self.state()["close"], 1)

    def test_dynamic_notice(self):
        self.open_fixture("popup-lab.html")
        self.click("dynamic")
        self.wait.until(lambda _: self.state()["permanent"] == 1)
        self.assertEqual(self.state()["notices"], 0)

    def test_mock_assignment_end_to_end(self):
        self.open_fixture("assignment-flow.html")
        self.click("start")
        self.click("attach")
        self.browser.execute_script("PlatoNotice.handle(true)")
        self.assertTrue(self.browser.find_element(By.CSS_SELECTOR, ".filepicker").is_displayed())
        upload = Path(self.temp.name) / "fixture.txt"
        upload.write_text("anonymous fixture", encoding="utf-8")
        self.browser.find_element(By.ID, "file").send_keys(str(upload))
        self.click("save")
        self.assertEqual(self.browser.execute_script("return assignmentState().state"), "임시 저장")
        self.click("final")
        self.browser.execute_script("PlatoNotice.handle(true)")
        self.assertTrue(self.browser.find_element(By.CSS_SELECTOR, '[role="alertdialog"]').is_displayed())
        self.click("confirm")
        self.assertEqual(self.browser.execute_script("return assignmentState().state"), "제출 완료")
        self.assertEqual(self.browser.execute_script("return assignmentState().calendar"), "캘린더: 완료")

    def test_both_calendars_render_exact_time_without_duplicate_done_badge(self):
        self.open_fixture("calendar-lab.html")
        result = self.browser.execute_script("return runCalendarFixture()")
        for site in ("plato", "bbits"):
            data = result[site]
            self.assertEqual(len(data["due"]), 3)
            self.assertEqual(data["badges"], 2)
            self.assertEqual(data["completed"], 1)
            self.assertTrue(any("23:55" in text for text in data["periods"]))
            self.assertTrue(any("23:59:59" in text for text in data["periods"]))
        self.browser.set_window_size(390, 844)
        self.assertTrue(self.browser.execute_script("""
            return [...document.querySelectorAll('.plato-task-card')].every(card =>
                card.getBoundingClientRect().right <= window.innerWidth + 1);
        """))
        self.browser.set_window_size(1100, 900)

    def test_plato_midnight_deadline_moves_to_next_month(self):
        self.open_fixture("calendar-lab.html")
        result = self.browser.execute_script("""
            const point = CalendarTime.parse('2026-10-31 24:00');
            const item = {modId:'9000', name:'월말 과제', courseName:'테스트 강좌',
              href:'https://plato.pusan.ac.kr/mod/assign/view.php?id=9000',
              isCompleted:false, parsedPeriod:'10월 31일'};
            const maps = {globalStatusMap:{9000:item}, timeMap:{9000:{dueAt:point.at,
              dueYear:point.year,dueMonth:point.month,dueDay:point.day,
              timePrecision:point.precision}}};
            const empty = document.createElement('table');
            const october = PlatoCalendar.parseCalendarDoc(empty, 2026, 10, maps);
            const november = PlatoCalendar.parseCalendarDoc(empty, 2026, 11, maps);
            return [october.activities.length, november.activities.length,
              november.dayDueActivitiesMap[1]?.[0]?.periodText];
        """)
        self.assertEqual(result[0], 0)
        self.assertEqual(result[1], 1)
        self.assertIn("11월 1일", result[2])

    def test_plato_course_table_time_survives_detail_fetch_failure(self):
        self.open_fixture("calendar-lab.html")
        result = self.browser.execute_script("""
            const point = CalendarTime.parse('수요일, 14 10월 2026, 11:59 PM');
            const maps = {globalStatusMap:{9001:{modId:'9001', name:'목록 과제',
              courseName:'테스트 강좌', isCompleted:false, parsedPeriod:'10월 14일',
              dueAt:point.at, timePrecision:point.precision,
              href:'https://plato.pusan.ac.kr/mod/assign/view.php?id=9001'}}};
            const month = PlatoCalendar.parseCalendarDoc(document.createElement('table'), 2026, 10, maps);
            return month.dayDueActivitiesMap[14]?.[0]?.periodText;
        """)
        self.assertIn("23:59", result)

    def test_both_full_month_grids_render_without_cache(self):
        self.open_fixture("calendar-lab.html")
        result = self.browser.execute_script("""
            const target = document.createElement('div');
            target.id = 'region-main';
            document.body.append(target);
            chrome.storage = {local:{get:(_,callback)=>callback({}),set:()=>{}}};
            PlatoCalendar.mountWidgetSkeleton();
            PlatoCalendar.renderEmptyMonthGrid(2026,10);
            BbitsCalendar.mountWidgetSkeleton();
            BbitsCalendar.renderEmptyMonthGrid(2026,10);
            return ['plato','bbits'].map(site =>
                document.querySelectorAll(`#${site}-large-days-grid .plato-large-day-cell:not(.empty)`).length);
        """)
        self.assertEqual(result, [31, 31])


if __name__ == "__main__":
    unittest.main()
