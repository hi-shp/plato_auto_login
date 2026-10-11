"""Validate and reproducibly package the unpacked Chrome extension.

Run from any directory: python scripts/release.py
Use --check to validate without creating a ZIP, or --verify to verify an existing ZIP.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
ASSET_EXTENSIONS = {".js", ".mjs", ".css", ".html", ".htm", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".json"}
FORBIDDEN_PARTS = {".git", ".agents", ".codex", "dist", "tests", "__pycache__", ".cursor"}
FORBIDDEN_NAMES = {"agents.md", "claude.md", "gemini.md", "readme.md", "changelog.md", ".env"}
VERSION_RE = re.compile(r"(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}\Z")
CSS_URL_RE = re.compile(r"url\(\s*['\"]?([^)'\"]+)['\"]?\s*\)|@import\s+['\"]([^'\"]+)['\"]", re.I)
JS_ASSET_RE = re.compile(r"(?:chrome\.runtime\.getURL|importScripts|import\s*(?:\(|[^;]*?from\s*))\s*\(?\s*['\"]([^'\"]+)['\"]")


def fail(message: str) -> None:
    raise ValueError(message)


def checked_path(raw: str, base: str = "") -> str | None:
    """Resolve a literal extension resource path, ignoring remote/data references."""
    raw = raw.strip()
    if not raw or raw.startswith(("#", "//")) or "${" in raw:
        return None
    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc:
        return None
    path = unquote(parsed.path).replace("\\", "/")
    if not path or path.startswith("data:"):
        return None
    candidate = PurePosixPath(path.lstrip("/")) if path.startswith("/") else PurePosixPath(base).parent / path if base else PurePosixPath(path)
    parts = candidate.parts
    if ".." in parts or not parts or candidate.is_absolute():
        fail(f"Unsafe resource path: {raw}")
    name = candidate.as_posix()
    lowered = {part.lower() for part in parts}
    if lowered & FORBIDDEN_PARTS or candidate.name.lower() in FORBIDDEN_NAMES or candidate.suffix.lower() in {".zip", ".pem", ".key", ".p12", ".csv"}:
        fail(f"Development or sensitive file referenced by extension: {name}")
    return name


class ResourceHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.refs: list[str] = []
        self.ids: set[str] = set()
        self.style_depth = 0
        self.css: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.add(values["id"] or "")
        if tag == "style":
            self.style_depth += 1
        for key in ("src", "poster"):
            if values.get(key):
                self.refs.append(values[key] or "")
        if tag in {"link", "use", "image"} and values.get("href"):
            self.refs.append(values["href"] or "")
        if values.get("style"):
            self.css.append(values["style"] or "")

    def handle_endtag(self, tag: str) -> None:
        if tag == "style" and self.style_depth:
            self.style_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.style_depth:
            self.css.append(data)


def css_refs(source: str) -> list[str]:
    return [first or second for first, second in CSS_URL_RE.findall(source)]


def manifest_refs(manifest: dict) -> set[str]:
    refs: set[str] = {"manifest.json"}

    def add(value: object) -> None:
        if isinstance(value, str):
            refs.add(value)
        elif isinstance(value, dict):
            for item in value.values():
                add(item)
        elif isinstance(value, list):
            for item in value:
                add(item)

    for key in ("icons", "options_page", "devtools_page", "chrome_url_overrides"):
        add(manifest.get(key))
    for key in ("default_popup", "default_icon"):
        add(manifest.get("action", {}).get(key))
    add(manifest.get("options_ui", {}).get("page"))
    add(manifest.get("side_panel", {}).get("default_path"))
    add(manifest.get("background", {}).get("service_worker"))
    for script in manifest.get("content_scripts", []):
        add(script.get("js", []))
        add(script.get("css", []))
    for sandbox in manifest.get("sandbox", {}).get("pages", []):
        add(sandbox)
    for rule in manifest.get("declarative_net_request", {}).get("rule_resources", []):
        add(rule.get("path"))
    for entry in manifest.get("web_accessible_resources", []):
        for resource in entry.get("resources", []):
            if "*" in resource:
                found = [p.relative_to(ROOT).as_posix() for p in ROOT.glob(resource) if p.is_file()]
                if not found:
                    fail(f"Unmatched web_accessible_resources glob: {resource}")
                refs.update(found)
            else:
                add(resource)
    return refs


def validate_version(manifest: dict) -> str:
    if manifest.get("manifest_version") != 3:
        fail("manifest_version must be 3")
    if not manifest.get("name") or not manifest.get("description"):
        fail("manifest name and description are required")
    version = manifest.get("version", "")
    if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
        fail(f"Invalid Chrome extension version: {version!r}")
    if any(int(part) > 65535 for part in version.split(".")):
        fail(f"Version component exceeds 65535: {version}")
    if "version_name" in manifest and manifest["version_name"] != version:
        fail("version_name must match version")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    first_note = re.search(r"^\s*\*\s*\*\*v(\d+(?:\.\d+){1,3})\*\*", readme, re.M)
    if not first_note or first_note.group(1) != version:
        fail(f"First README release note must be v{version}")
    return version


def collect_files(manifest: dict) -> set[str]:
    pending = list(manifest_refs(manifest))
    found: set[str] = set()
    while pending:
        raw = pending.pop()
        name = checked_path(raw)
        if name is None or name in found:
            continue
        path = ROOT / name
        if not path.is_file():
            fail(f"Missing extension resource: {name}")
        found.add(name)
        suffix = path.suffix.lower()
        if suffix not in ASSET_EXTENSIONS:
            continue
        if suffix in {".html", ".htm", ".css", ".js", ".mjs"}:
            source = path.read_text(encoding="utf-8")
            refs: list[str] = []
            if suffix in {".html", ".htm"}:
                parser = ResourceHTMLParser()
                parser.feed(source)
                refs.extend(parser.refs)
                refs.extend(ref for css in parser.css for ref in css_refs(css))
            if suffix == ".css":
                refs.extend(css_refs(source))
            if suffix in {".js", ".mjs"}:
                refs.extend(JS_ASSET_RE.findall(source))
            for ref in refs:
                resolved = checked_path(ref, name)
                if resolved:
                    pending.append(resolved)
    return found


def validate_popup(files: set[str]) -> None:
    if "popup.html" not in files or "popup.js" not in files:
        fail("Popup HTML or JavaScript is missing")
    parser = ResourceHTMLParser()
    parser.feed((ROOT / "popup.html").read_text(encoding="utf-8"))
    js = (ROOT / "popup.js").read_text(encoding="utf-8")
    used_ids = set(re.findall(r"getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)", js))
    missing = used_ids - parser.ids
    if missing:
        fail(f"Popup JavaScript refers to missing IDs: {', '.join(sorted(missing))}")


def validate_sources(files: set[str]) -> None:
    node = shutil.which("node")
    if not node:
        fail("Node.js is required for JavaScript syntax validation (node --check)")
    for name in sorted(files):
        if Path(name).suffix.lower() in {".js", ".mjs"}:
            result = subprocess.run([node, "--check", str(ROOT / name)], capture_output=True, text=True)
            if result.returncode:
                fail(f"JavaScript syntax check failed: {name}\n{result.stderr}")
    validate_popup(files)


def verify_zip(package: Path, files: set[str]) -> None:
    if not package.is_file():
        fail(f"ZIP does not exist: {package}")
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != files:
            fail(f"ZIP file list differs from extension resources: {sorted(set(names) ^ files)}")
        if "manifest.json" not in names or archive.testzip() is not None:
            fail("ZIP manifest is not at root or ZIP integrity check failed")
        inside_manifest = json.loads(archive.read("manifest.json"))
        if inside_manifest != json.loads((ROOT / "manifest.json").read_text(encoding="utf-8")):
            fail("ZIP manifest differs from local manifest")
        for name in names:
            if checked_path(name) != name:
                fail(f"Unsafe ZIP entry: {name}")
            if archive.read(name) != (ROOT / name).read_bytes():
                fail(f"ZIP content differs from local source: {name}")


def build_zip(package: Path, files: set[str]) -> None:
    DIST.mkdir(exist_ok=True)
    if package.exists():
        verify_zip(package, files)
        print(f"Existing package verified: {package}")
        return
    with tempfile.NamedTemporaryFile(dir=DIST, suffix=".tmp", delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in sorted(files):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, (ROOT / name).read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        verify_zip(temp_path, files)
        temp_path.replace(package)
    finally:
        temp_path.unlink(missing_ok=True)
    verify_zip(package, files)
    print(f"Built and verified: {package} ({package.stat().st_size} bytes, {len(files)} files)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="validate sources only")
    mode.add_argument("--verify", action="store_true", help="verify the existing versioned ZIP")
    args = parser.parse_args()
    try:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        version = validate_version(manifest)
        files = collect_files(manifest)
        validate_sources(files)
        package = DIST / f"plato_auto_login_v{version}.zip"
        if args.verify:
            verify_zip(package, files)
            print(f"Verified: {package} ({package.stat().st_size} bytes, {len(files)} files)")
        elif args.check:
            print(f"Source validation passed: v{version}, {len(files)} extension files")
        else:
            build_zip(package, files)
        return 0
    except (ValueError, OSError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        print(f"Release validation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
