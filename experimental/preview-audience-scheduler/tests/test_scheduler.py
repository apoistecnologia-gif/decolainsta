import importlib.util
import io
import pathlib
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).resolve().parents[1] / "run.py"
spec = importlib.util.spec_from_file_location("preview_scheduler", PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeResponse:
    status = 200
    def __init__(self, payload):
        self.data = payload
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, max_length):
        return self.data[:max_length]


class TestPreviewScheduler(unittest.TestCase):
    def setUp(self):
        self.env = {
            "PREVIEW_READONLY_CRON_ENABLED": "yes",
            "PREVIEW_REFRESH_URL": "https://" + module.PREVIEW_HOST + module.PREVIEW_PATH,
            "PREVIEW_CRON_SECRET": "a" * 48,
            "PREVIEW_PROTECTION_BYPASS": "b" * 32,
        }

    def test_disabled_default_never_calls_network(self):
        code, message = module.run_once({}, lambda *args, **kwargs: self.fail("network"))
        self.assertEqual((code, message), (0, "disabled"))

    def test_one_authenticated_get_only(self):
        calls = []
        def fake_open(request, timeout):
            calls.append((request, timeout))
            return FakeResponse(b'{"enabled":true,"examined":0,"actionsEnabled":false,"instagramActionsExecuted":0}')
        code, message = module.run_once(self.env, fake_open)
        self.assertEqual((code, message), (0, "ok: examined=0"))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0].get_method(), "GET")
        self.assertIn(module.PREVIEW_PATH, calls[0][0].full_url)
        self.assertEqual(calls[0][0].get_header("Authorization"), "Bearer " + "a" * 48)
        self.assertEqual(calls[0][0].get_header("X-vercel-protection-bypass"), "b" * 32)
        self.assertNotIn("a" * 48, message)
        self.assertNotIn("b" * 32, message)

    def test_rejects_any_non_preview_destination_even_if_secret_exists(self):
        invalid = [
            "https://example.com" + module.PREVIEW_PATH,
            "https://example.com@" + module.PREVIEW_HOST + module.PREVIEW_PATH,
            "http://" + module.PREVIEW_HOST + module.PREVIEW_PATH,
            "https://" + module.PREVIEW_HOST + ":443" + module.PREVIEW_PATH,
            "https://" + module.PREVIEW_HOST + "/api/other",
            "https://" + module.PREVIEW_HOST + module.PREVIEW_PATH + "?q=1",
            "https://" + module.PREVIEW_HOST + module.PREVIEW_PATH + "#fragment",
        ]
        for invalid_url in invalid:
            with self.subTest(url=invalid_url):
                env = {**self.env, "PREVIEW_REFRESH_URL": invalid_url}
                code, message = module.run_once(env, lambda *args, **kwargs: self.fail("network"))
                self.assertEqual((code, message), (2, "invalid-configuration"))

    def test_refuses_redirects_and_unsafe_responses(self):
        requests = []
        def fake_open(request, timeout):
            requests.append(1)
            return FakeResponse(b'{"enabled":true,"examined":1,"instagramActionsExecuted":1}')
        self.assertEqual(module.run_once(self.env, fake_open)[1], "unexpected-or-disabled-runner")
        self.assertEqual(len(requests), 1)
        for body in [
            b'{"enabled":false,"examined":0,"instagramActionsExecuted":0}',
            b'{"enabled":true,"examined":500,"instagramActionsExecuted":0}',
            b'{"enabled":true,"examined":true,"instagramActionsExecuted":0}',
            b'{"enabled":true,"examined":2,"instagramActionsExecuted":0,"actionsEnabled":true}',
            b'secret provider error',
            b'[' + b'1' * 9000 + b']',
        ]:
            with self.subTest(body=body[:30]):
                result = module.run_once(self.env, lambda request, timeout: FakeResponse(body))
                self.assertNotEqual(result[0], 0)
                self.assertNotIn("secret", result[1])

    def test_refuses_short_auth_and_missing_bypass(self):
        for name, value in [("PREVIEW_CRON_SECRET", "tiny"),("PREVIEW_PROTECTION_BYPASS", "")]:
            env = {**self.env, name: value}
            code, message = module.run_once(env, lambda *args, **kwargs: self.fail("network"))
            self.assertEqual((code, message), (2, "invalid-configuration"))


if __name__ == "__main__":
    unittest.main()
