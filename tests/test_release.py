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

    def test_release_version_must_equal_seoul_date(self):
        release.validate_packaging_version("2026.10.12", today=date(2026, 10, 12))
        with self.assertRaisesRegex(ValueError, "YYYY.MM.DD"):
            release.validate_packaging_version("2026.10.12.1", today=date(2026, 10, 12))
        with self.assertRaisesRegex(ValueError, "Asia/Seoul date"):
            release.validate_packaging_version("2026.10.13", today=date(2026, 10, 12))

    def test_fourth_component_and_invalid_date_rejected(self):
        (self.root / "README.md").write_text("* **v2026.10.12**: current release\n", encoding="utf-8")
        self.manifest["version"] = "2026.10.12"
        self.assertEqual(release.validate_version(self.manifest), "2026.10.12")
        self.manifest["version"] = "2026.10.13.1"
        with self.assertRaisesRegex(ValueError, "YYYY.MM.DD"):
            release.validate_version(self.manifest)
        self.manifest["version"] = "2026.02.30"
        with self.assertRaisesRegex(ValueError, "YYYY.MM.DD"):
            release.validate_version(self.manifest)

    def test_same_day_zip_is_replaced_only_after_verification(self):
        self.manifest["version"] = "2026.10.12"
        (self.root / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        package = self.root / "dist" / "plato_auto_login_v2026.10.12.zip"
        legacy = self.root / "dist" / "plato_auto_login_v2026.10.12.1.zip"
        package.parent.mkdir()
        legacy.write_bytes(b"historical package")
        files = release.collect_files(self.manifest)
        release.build_zip(package, files, "2026.10.12")
        original = package.read_bytes()
        release.build_zip(package, files, "2026.10.12")
        self.assertEqual(package.read_bytes(), original)

        changed = 'document.getElementById("name"); const changed = true;'
        (self.root / "popup.js").write_text(changed, encoding="utf-8")
        original_verify = release.verify_zip

        def reject_temporary(path, included, expected_version=None):
            if path.suffix == ".tmp":
                raise ValueError("simulated candidate validation failure")
            return original_verify(path, included, expected_version)

        with patch.object(release, "verify_zip", side_effect=reject_temporary):
            with self.assertRaisesRegex(ValueError, "candidate validation failure"):
                release.build_zip(package, files, "2026.10.12")
        self.assertEqual(package.read_bytes(), original)

        release.build_zip(package, files, "2026.10.12")
        self.assertNotEqual(package.read_bytes(), original)
        release.verify_zip(package, files, "2026.10.12")
        verified = package.read_bytes()
        (self.root / "popup.js").write_text(changed + "\nconst again = true;", encoding="utf-8")

        def reject_final(path, included, expected_version=None):
            if path == package and path.read_bytes() != verified:
                raise ValueError("simulated final validation failure")
            return original_verify(path, included, expected_version)

        with patch.object(release, "verify_zip", side_effect=reject_final):
            with self.assertRaisesRegex(ValueError, "final validation failure"):
                release.build_zip(package, files, "2026.10.12")
        self.assertEqual(package.read_bytes(), verified)
        self.assertEqual(legacy.read_bytes(), b"historical package")
        with self.assertRaisesRegex(ValueError, "filename does not match"):
            release.verify_zip(package, files, "2026.10.13")


if __name__ == "__main__":
    unittest.main()
