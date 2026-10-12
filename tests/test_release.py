"""Regression checks for release dependency discovery and ZIP integrity."""

import json
from datetime import date
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release  # noqa: E402


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(release, "ROOT", self.root)
        self.dist_patch = patch.object(release, "DIST", self.root / "dist")
        self.root_patch.start()
        self.dist_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.dist_patch.stop)
        (self.root / "assets").mkdir()
        self.manifest = {
            "manifest_version": 3,
            "name": "Test",
            "description": "Test extension",
            "version": "2026.10.11",
            "action": {"default_popup": "popup.html", "default_icon": "assets/icon.png"},
            "content_scripts": [{"js": ["content.js"], "css": ["style.css"]}],
        }
        (self.root / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        (self.root / "popup.html").write_text('<input id="name"><script src="popup.js"></script>', encoding="utf-8")
        (self.root / "popup.js").write_text('document.getElementById("name");', encoding="utf-8")
        (self.root / "content.js").write_text('const ok = true;', encoding="utf-8")
        (self.root / "style.css").write_text('body { background: url("assets/bg.png"); }', encoding="utf-8")
        (self.root / "assets/icon.png").write_bytes(b"icon")
        (self.root / "assets/bg.png").write_bytes(b"background")

    def test_dependency_closure_and_missing_asset(self):
        files = release.collect_files(self.manifest)
        self.assertIn("assets/bg.png", files)
        self.assertIn("popup.js", files)
        (self.root / "assets/bg.png").unlink()
        with self.assertRaisesRegex(ValueError, "Missing extension resource"):
            release.collect_files(self.manifest)

    def test_popup_id_and_zip_source_integrity(self):
        files = release.collect_files(self.manifest)
        release.validate_popup(files)
        package = self.root / "dist" / "extension.zip"
        release.build_zip(package, files)
        (self.root / "popup.js").write_text('document.getElementById("other");', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "missing IDs"):
            release.validate_popup(files)
        with self.assertRaisesRegex(ValueError, "differs from local source"):
            release.verify_zip(package, files)

    def test_date_only_release_after_legacy_version(self):
        package = self.root / "dist" / "plato_auto_login_v2026.10.13.zip"
        release.validate_packaging_version("2026.10.13", package,
                                           today=date(2026, 10, 13), prior={"2026.10.12.1"})
        with self.assertRaisesRegex(ValueError, "YYYY.MM.DD only"):
            release.validate_packaging_version("2026.10.12.1", package,
                                               today=date(2026, 10, 12), prior=set())
        with self.assertRaisesRegex(ValueError, "Asia/Seoul date"):
            release.validate_packaging_version("2026.10.13", package,
                                               today=date(2026, 10, 12), prior={"2026.10.12.1"})
        with self.assertRaisesRegex(ValueError, "not higher"):
            release.validate_packaging_version("2026.10.12", package,
                                               today=date(2026, 10, 12), prior={"2026.10.12.1"})
        with self.assertRaisesRegex(ValueError, "not higher"):
            release.validate_packaging_version("2026.10.13", package,
                                               today=date(2026, 10, 13), prior={"2026.10.13"})

    def test_only_existing_legacy_version_can_pass_source_validation(self):
        (self.root / "README.md").write_text("* **v2026.10.12.1**: archived release\n", encoding="utf-8")
        self.manifest["version"] = "2026.10.12.1"
        self.assertEqual(release.validate_version(self.manifest), "2026.10.12.1")
        self.manifest["version"] = "2026.10.13.1"
        with self.assertRaisesRegex(ValueError, "YYYY.MM.DD"):
            release.validate_version(self.manifest)
        self.manifest["version"] = "2026.02.30"
        with self.assertRaisesRegex(ValueError, "YYYY.MM.DD"):
            release.validate_version(self.manifest)


if __name__ == "__main__":
    unittest.main()
