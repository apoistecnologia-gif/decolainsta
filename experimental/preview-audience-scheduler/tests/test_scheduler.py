import importlib.util
import io
from datetime import datetime, timezone
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

    def test_disabled_importer_is_successful_noop(self):
        payload = b'{"enabled":false,"examined":0,"instagramActionsExecuted":0}'
        self.assertEqual(module.run_once(
            self.env, lambda *_args, **_kwargs: FakeResponse(payload)),
            (0, "importer-disabled"))

    def test_simulation_cron_is_opt_in_and_never_targets_production(self):
        self.assertEqual(module.run_simulation_once(
            self.env, lambda *_args: self.fail("unexpected request")),
            (0, "disabled"))
        env = {**self.env, "PREVIEW_FOLLOW_SIMULATION_CRON_ENABLED": "yes"}
        requests = []
        def open_sim(request, timeout):
            requests.append(request)
            return FakeResponse(
                b'{"enabled":true,"mode":"simulation","advanced":5,'
                b'"instagramActionsExecuted":0,'
                b'"realFollowsEnabled":false,"realUnfollowsEnabled":false}')
        self.assertEqual(module.run_simulation_once(env, open_sim),
                         (0, "ok: advanced=5"))
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].get_method(), "GET")
        self.assertEqual(requests[0].full_url, "https://" + module.PREVIEW_HOST
                         + module.FOLLOW_PREVIEW_PATH)

    def test_simulation_cron_rejects_unknown_or_unsafe_outputs(self):
        env = {**self.env, "PREVIEW_FOLLOW_SIMULATION_CRON_ENABLED": "yes"}
        cases = [
            b'{"enabled":true,"mode":"simulation","advanced":1,"instagramActionsExecuted":1,"realFollowsEnabled":false,"realUnfollowsEnabled":false}',
            b'{"enabled":true,"mode":"live","advanced":1,"instagramActionsExecuted":0,"realFollowsEnabled":false,"realUnfollowsEnabled":false}',
            b'{"enabled":true,"mode":"simulation","advanced":6,"instagramActionsExecuted":0,"realFollowsEnabled":false,"realUnfollowsEnabled":false}',
            b'sensitive-provider-error'
        ]
        for payload in cases:
            with self.subTest(payload=payload[:20]):
                code, msg = module.run_simulation_once(
                    env, lambda *_args, **_kwargs: FakeResponse(payload))
                self.assertNotEqual(code, 0)
                self.assertNotIn("sensitive", msg)

    def test_reconciliation_is_disabled_without_explicit_opt_in(self):
        result = module.run_reconciliation_once(
            self.env, lambda *_args, **_kwargs: self.fail("unexpected network"))
        self.assertEqual(result, (0, "disabled"))

    def test_reconciliation_only_posts_one_fixed_operation_to_preview(self):
        env = {**self.env, "PREVIEW_DYNAMIC_RECONCILIATION_CRON_ENABLED": "yes"}
        requests = []
        def fake_open(request, timeout):
            requests.append((request, timeout))
            return FakeResponse(
                b'{"status":"no-pending-run","noAutomaticLaunch":true,'
                b'"launchesExecuted":0,"instagramActionsExecuted":0}')
        due = datetime(2026, 11, 21, 21, 0, tzinfo=timezone.utc)
        self.assertEqual(module.run_reconciliation_once(env, fake_open, now=due),
                         (0, "ok: status=no-pending-run"))
        self.assertEqual(len(requests), 1)
        request, timeout = requests[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.full_url, "https://" + module.PREVIEW_HOST
                         + module.DYNAMIC_RECONCILE_PATH)
        self.assertEqual(request.data, b'{"operation":"reconcile-only","confirmDynamicCollection":true}')
        self.assertEqual(timeout, 25)
        self.assertEqual(request.get_header("Authorization"), "Bearer " + "a" * 48)

    def test_reconciliation_checks_provider_only_twice_per_hour(self):
        env = {**self.env, "PREVIEW_DYNAMIC_RECONCILIATION_CRON_ENABLED": "yes"}
        not_due = datetime(2026, 11, 21, 21, 10, tzinfo=timezone.utc)
        self.assertEqual(module.run_reconciliation_once(
            env, lambda *_args, **_kwargs: self.fail("too soon"), now=not_due),
            (0, "interval-not-due"))

    def test_reconciliation_rejects_unsafe_or_unknown_responses(self):
        env = {**self.env, "PREVIEW_DYNAMIC_RECONCILIATION_CRON_ENABLED": "yes"}
        for payload in [
            b'{"status":"started"}',
            b'{"status":"no-pending-run","noAutomaticLaunch":true,"launchesExecuted":1,"instagramActionsExecuted":0}',
            b'{"status":"no-pending-run","noAutomaticLaunch":true,"launchesExecuted":0,"instagramActionsExecuted":1}',
            b'sensitive-private-output',
        ]:
            with self.subTest(payload=payload[:24]):
                code, message = module.run_reconciliation_once(
                    env, lambda *_args, **_kwargs: FakeResponse(payload),
                    now=datetime(2026, 11, 21, 21, 0, tzinfo=timezone.utc))
                self.assertNotEqual(code, 0)
                self.assertNotIn("sensitive", message)

    def test_collection_never_starts_without_distinct_opt_in(self):
        self.assertEqual(module.run_collection_once(
            self.env, lambda *_args, **_kwargs: self.fail("unexpected network")),
            (0, "disabled"))

    def test_collection_is_not_due_outside_six_hour_window(self):
        env = {**self.env, "PREVIEW_DYNAMIC_COLLECTION_CRON_ENABLED": "yes"}
        not_due = datetime(2026, 11, 21, 21, 30, tzinfo=timezone.utc)
        self.assertEqual(module.run_collection_once(
            env, lambda *_args, **_kwargs: self.fail("too soon"), now=not_due),
            (0, "interval-not-due"))

    def test_collection_sends_only_server_authorized_reference_request(self):
        env = {**self.env, "PREVIEW_DYNAMIC_COLLECTION_CRON_ENABLED": "yes"}
        due = datetime(2026, 11, 22, 0, 5, tzinfo=timezone.utc)
        requests = []
        def fake_open(request, timeout):
            requests.append((request, timeout))
            return FakeResponse(b'{"status":"queued","savedPhantomSettingsChanged":false,'
                                b'"followsExecuted":0,"unfollowsExecuted":0}')
        self.assertEqual(module.run_collection_once(env, fake_open, now=due),
                         (0, "ok: status=queued"))
        self.assertEqual(len(requests), 1)
        request, timeout = requests[0]
        self.assertEqual(request.full_url, "https://" + module.PREVIEW_HOST
                         + module.DYNAMIC_RECONCILE_PATH)
        self.assertEqual(request.data,
                         b'{"operation":"collect-next","confirmDynamicCollection":true}')
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(timeout, 25)

    def test_collection_rejects_unsafe_and_unexpected_provider_responses(self):
        env = {**self.env, "PREVIEW_DYNAMIC_COLLECTION_CRON_ENABLED": "yes"}
        due = datetime(2026, 11, 22, 0, 5, tzinfo=timezone.utc)
        for payload in [
            b'{"status":"queued","savedPhantomSettingsChanged":false,"followsExecuted":1,"unfollowsExecuted":0}',
            b'{"status":"queued","savedPhantomSettingsChanged":true,"followsExecuted":0,"unfollowsExecuted":0}',
            b'{"status":"unknown"}',
            b'{"status":"reconcile-only"}',
            b'secret provider error',
        ]:
            with self.subTest(payload=payload[:24]):
                code, message = module.run_collection_once(
                    env, lambda *_args, **_kwargs: FakeResponse(payload), now=due)
                self.assertNotEqual(code, 0)
                self.assertNotIn("secret", message)

    def test_instagram_readiness_is_opt_in_and_never_triggers_remote(self):
        self.assertEqual(module.run_instagram_readiness_once(
            self.env, lambda *_args, **_kwargs: self.fail("unexpected network")),
            (0, "disabled"))

    def test_instagram_readiness_hits_only_preview_readonly_endpoint(self):
        env = {**self.env, "PREVIEW_INSTAGRAM_READINESS_PROBE_ENABLED": "yes"}
        due = datetime(2026, 11, 21, 21, 35, tzinfo=timezone.utc)
        requests = []
        def fake_open(request, timeout):
            requests.append((request, timeout))
            return FakeResponse(
                b'{"status":"read-only-diagnostic","metaRead":"ok",'
                b'"previousContainerCategory":"platform-limited",'
                b'"previousContainerOnly":true,'
                b'"currentPhantomSessionVerified":false,'
                b'"instagramRestrictionCleared":null,'
                b'"providerLaunchesExecuted":0,'
                b'"instagramActionsExecuted":0,'
                b'"dataMutations":0}')
        self.assertEqual(module.run_instagram_readiness_once(
            env, fake_open, now=due),
            (0, "ok: meta=ok old-container=platform-limited"))
        self.assertEqual(len(requests), 1)
        request, timeout = requests[0]
        self.assertEqual(request.full_url, "https://" + module.PREVIEW_HOST
                         + module.INSTAGRAM_READINESS_PATH)
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        self.assertEqual(timeout, 25)
        self.assertEqual(request.get_header("Authorization"), "Bearer " + "a"*48)

    def test_readiness_rejects_unexpected_status_or_social_actions(self):
        env = {**self.env, "PREVIEW_INSTAGRAM_READINESS_PROBE_ENABLED": "yes"}
        due = datetime(2026, 11, 21, 21, 35, tzinfo=timezone.utc)
        for body in [
            b'{"status":"read-only-diagnostic","metaRead":"ok","instagramRestrictionCleared":true}',
            b'{"status":"read-only-diagnostic","metaRead":"ok","providerLaunchesExecuted":1}',
            b'{"status":"read-only-diagnostic","metaRead":"ok","instagramActionsExecuted":1}',
            b'{"status":"read-only-diagnostic","metaRead":"ok","dataMutations":1}',
            b'{"status":"read-only-diagnostic","metaRead":"ok","previousContainerCategory":"sensitive secret"}',
            b'{"status":"unknown"}',
            b'raw-secret',
        ]:
            with self.subTest(body=body[:26]):
                code, msg = module.run_instagram_readiness_once(
                    env, lambda *_args, **_kwargs: FakeResponse(body), now=due)
                self.assertNotEqual(code, 0)
                self.assertNotIn("secret", msg)

    def test_readiness_is_throttled_between_half_hour_windows(self):
        env = {**self.env, "PREVIEW_INSTAGRAM_READINESS_PROBE_ENABLED": "yes"}
        now = datetime(2026, 11, 21, 21, 20, tzinfo=timezone.utc)
        self.assertEqual(module.run_instagram_readiness_once(
            env, lambda *_args, **_kwargs: self.fail("too early"), now=now),
            (0, "interval-not-due"))

    def test_readiness_one_shot_runs_only_within_exact_utc_window(self):
        env = {
            **self.env,
            "PREVIEW_INSTAGRAM_READINESS_PROBE_ENABLED": "yes",
            "PREVIEW_INSTAGRAM_READINESS_ONE_SHOT_UTC": "2026-11-21T21:45Z",
        }
        def good_response(*_args, **_kwargs):
            return FakeResponse(
                b'{"status":"read-only-diagnostic","metaRead":"ok",'
                b'"previousContainerCategory":null,"previousContainerOnly":true,'
                b'"currentPhantomSessionVerified":false,'
                b'"instagramRestrictionCleared":null,'
                b'"providerLaunchesExecuted":0,'
                b'"instagramActionsExecuted":0,"dataMutations":0}')
        due = datetime(2026, 11, 21, 21, 45, tzinfo=timezone.utc)
        self.assertEqual(module.run_instagram_readiness_once(
            env, good_response, now=due), (0, "ok: meta=ok old-container=none"))
        late = datetime(2026, 11, 21, 21, 50, tzinfo=timezone.utc)
        self.assertEqual(module.run_instagram_readiness_once(
            env, lambda *_args, **_kwargs: self.fail("repeated later"), now=late),
            (0, "one-shot-not-due"))
        earlier = datetime(2026, 11, 21, 21, 40, tzinfo=timezone.utc)
        self.assertEqual(module.run_instagram_readiness_once(
            env, lambda *_args, **_kwargs: self.fail("started early"), now=earlier),
            (0, "one-shot-not-due"))
        invalid = {**env, "PREVIEW_INSTAGRAM_READINESS_ONE_SHOT_UTC": "not-a-date"}
        self.assertEqual(module.run_instagram_readiness_once(
            invalid, lambda *_args, **_kwargs: self.fail("bad date"), now=due),
            (2, "invalid-one-shot-time"))

    def test_refuses_short_auth_and_missing_bypass(self):
        for name, value in [("PREVIEW_CRON_SECRET", "tiny"),("PREVIEW_PROTECTION_BYPASS", "")]:
            env = {**self.env, name: value}
            code, message = module.run_once(env, lambda *args, **kwargs: self.fail("network"))
            self.assertEqual((code, message), (2, "invalid-configuration"))


if __name__ == "__main__":
    unittest.main()
