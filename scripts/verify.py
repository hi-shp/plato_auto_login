"""Run the regression gate; --package safely rebuilds today's date-only ZIP.

The browser suite uses isolated, anonymous fixtures and installs a temporary
copy of this extension. It never submits coursework or uses saved credentials.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent


def run_group(name: str, command: list[str]) -> dict:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True,
                                text=True, encoding="utf-8", errors="replace")
        output = (result.stdout + "\n" + result.stderr).strip()
    except OSError as error:
        return {"name": name, "status": "FAIL", "tests": 1, "passed": 0,
                "failed": 1, "reason": str(error)}
    count = re.search(r"Ran (\d+) tests?", output)
    node_count = re.search(r"^# tests (\d+)$", output, re.MULTILINE)
    node_pass = re.search(r"^# pass (\d+)$", output, re.MULTILINE)
    node_fail = re.search(r"^# fail (\d+)$", output, re.MULTILINE)
    tests = int(count.group(1)) if count else int(node_count.group(1)) if node_count else 1
    if node_pass:
        passed = int(node_pass.group(1))
        failed = int(node_fail.group(1)) if node_fail else tests - passed
    elif result.returncode == 0:
        passed, failed = tests, 0
    else:
        summary = re.search(r"FAILED \(([^)]*)\)", output)
        counts = re.findall(r"(?:failures|errors)=(\d+)", summary.group(1)) if summary else []
        failed = min(tests, sum(map(int, counts))) if counts else tests
        passed = tests - failed
    status = "PASS" if result.returncode == 0 else "FAIL"
    if status == "FAIL":
        print(f"\n[{name}] failure output:\n{output}\n")
    return {"name": name, "status": status, "tests": tests,
            "passed": passed, "failed": failed,
            "reason": "" if status == "PASS" else f"exit {result.returncode}"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", action="store_true",
                        help="after all tests pass, verify and replace today's Asia/Seoul YYYY.MM.DD ZIP if sources changed")
    args = parser.parse_args()
    commands = [
        ("Release source and JavaScript syntax", [sys.executable, "scripts/release.py", "--check"]),
        ("JavaScript unit regressions", ["node", "--test", *[
            str(path.relative_to(ROOT)) for path in sorted((ROOT / "tests" / "unit").glob("*.test.js"))
        ]]),
        ("Release resource tests", [sys.executable, "-m", "unittest", "discover", "-s", "tests",
                                    "-p", "test_release.py", "-v"]),
        ("Chrome fixture and extension E2E", [sys.executable, "-m", "unittest", "discover",
                                              "-s", "tests/e2e", "-p", "test_*.py", "-v"]),
        ("Git whitespace check", ["git", "diff", "--check"]),
    ]
    outcomes = [run_group(name, command) for name, command in commands]
    if args.package:
        if all(item["status"] == "PASS" for item in outcomes):
            outcomes.append(run_group("ZIP build and verification", [sys.executable, "scripts/release.py", "--build-tested"]))
            if outcomes[-1]["status"] == "PASS":
                outcomes.append(run_group("ZIP recheck", [sys.executable, "scripts/release.py", "--verify"]))
        else:
            outcomes.append({"name": "ZIP build and verification", "status": "NOT RUN",
                             "tests": 1, "passed": 0, "failed": 0,
                             "reason": "a required regression check failed"})
    outcomes.append({"name": "Authenticated live-site login and session expiry", "status": "NOT RUN",
                     "tests": 1, "passed": 0, "failed": 0,
                     "reason": "requires an installed updated extension, authenticated sessions, and safe live scenarios"})
    for item in outcomes:
        print(f"{item['status']:7} {item['name']} ({item['passed']}/{item['tests']})"
              + (f" - {item['reason']}" if item["reason"] else ""))
    passed = sum(item["passed"] for item in outcomes)
    failed = sum(item["failed"] for item in outcomes)
    not_run = sum(item["tests"] for item in outcomes if item["status"] == "NOT RUN")
    print(f"TOTAL: {passed + failed + not_run} checks; PASS {passed}; FAIL {failed}; NOT RUN {not_run}")
    print(f"Browser screenshots: {ROOT / 'dist' / 'e2e'}")
    return 1 if any(item["status"] == "FAIL" for item in outcomes) else 0


if __name__ == "__main__":
    raise SystemExit(main())
