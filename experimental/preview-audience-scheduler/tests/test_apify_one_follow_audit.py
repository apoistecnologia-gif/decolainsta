"""Tests for the opt-in Apify historical run audit cron; no network calls."""
import importlib.util
import json
from pathlib import Path
import unittest
from datetime import datetime, timezone

SCRIPT = Path(__file__).resolve().parents[1] / "run.py"
spec = importlib.util.spec_from_file_location("preview_audience_runner", SCRIPT)
assert spec and spec.loader
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

BASE = {
    "PREVIEW_APIFY_ONE_FOLLOW_AUDIT_CRON_ENABLED": "yes",
    "PREVIEW_REFRESH_URL":
        "https://" + runner.PREVIEW_HOST + runner.PREVIEW_PATH,
    "PREVIEW_CRON_SECRET": "s" * 32,
    "PREVIEW_PROTECTION_BYPASS": "b" * 32,
}
DUE = datetime(2026, 11, 22, 22, 0, tzinfo=timezone.utc)
NOT_DUE = datetime(2026, 11, 22, 22, 6, tzinfo=timezone.utc)
SAFE = {
    "status": "provider-rejected",
    "actorRunsLaunched": 0,
    "instagramActionsExecuted": 0,
    "independentlyVerified": False,
    "unfollowEnabled": False,
    "noAutomaticRetry": True,
}

class FakeResponse:
    status = 200
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc_value, traceback):
        return False
    def read(self, n):
        return self.payload[:n]

class AuditTests(unittest.TestCase):
    def test_disabled_and_not_due_issue_no_requests(self):
        def no_network(*args, **kwargs):
            self.fail("No network request allowed")
        self.assertEqual(runner.run_apify_one_follow_audit_once(
            {}, opener=no_network, now=DUE), (0, "disabled"))
        self.assertEqual(runner.run_apify_one_follow_audit_once(
            BASE, opener=no_network, now=NOT_DUE), (0, "interval-not-due"))

    def test_single_get_only_and_safe_result(self):
        calls = []
        def opener(req, timeout):
            calls.append((req.get_method(), req.full_url))
            return FakeResponse(SAFE)
        code, msg = runner.run_apify_one_follow_audit_once(
            BASE, opener=opener, now=DUE)
        self.assertEqual((code, msg), (0, "ok: status=provider-rejected"))
        self.assertEqual(calls, [("GET",
            "https://" + runner.PREVIEW_HOST +
            runner.APIFY_ONE_FOLLOW_AUDIT_PATH)])

    def test_rejects_claimed_actions_and_invalid_host(self):
        def fake(req, timeout):
            return FakeResponse({**SAFE, "actorRunsLaunched": 1})
        self.assertEqual(runner.run_apify_one_follow_audit_once(
            BASE, opener=fake, now=DUE), (1, "unsafe-apify-audit-response"))
        wrong = {**BASE, "PREVIEW_REFRESH_URL":
            "https://attacker.invalid" + runner.PREVIEW_PATH}
        self.assertEqual(runner.run_apify_one_follow_audit_once(
            wrong, now=DUE), (2, "invalid-configuration"))

    def test_provider_report_never_counts_as_verified_follow(self):
        def fake(req, timeout):
            return FakeResponse({**SAFE, "status": "provider-reported",
                                 "independentlyVerified": True})
        self.assertEqual(runner.run_apify_one_follow_audit_once(
            BASE, opener=fake, now=DUE), (1, "unsafe-apify-audit-response"))

if __name__ == "__main__":
    unittest.main()
