import importlib.util
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("private_login_once", ROOT / "login_once.py")
login_once = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = login_once
spec.loader.exec_module(login_once)


class FakeClient:
    def __init__(self, *, result=True, exc=None):
        self.calls = []
        self.result = result
        self.exc = exc

    def login(self, username, password):
        self.calls.append(("login", username, password))
        print("UNSAFE_SECRET_FAKE_MESSAGE")
        if self.exc:
            raise self.exc
        return self.result


class LoginOnceTests(unittest.TestCase):
    def test_disabled_without_explicit_authorization(self):
        with patch.dict(os.environ, {"PRIVATE_API_IG_USERNAME": "test", "PRIVATE_API_IG_PASSWORD": "secret"}, clear=True):
            self.assertEqual(login_once.attempt_once(client_factory=lambda: self.fail("must not create client")), "BLOCKED_NOT_APPROVED")

    def test_missing_credentials_never_constructs_client(self):
        with patch.dict(os.environ, {"PRIVATE_API_LOGIN_ONCE_APPROVED": "yes"}, clear=True):
            self.assertEqual(login_once.attempt_once(client_factory=lambda: self.fail("must not create client")), "BLOCKED_MISSING_CREDENTIALS")

    def test_exactly_one_login_invocation_with_no_read_or_write_requests(self):
        fake = FakeClient()
        with patch.dict(os.environ, {"PRIVATE_API_LOGIN_ONCE_APPROVED": "yes", "PRIVATE_API_IG_USERNAME": "isolated", "PRIVATE_API_IG_PASSWORD": "top-secret"}, clear=True):
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(login_once.attempt_once(client_factory=lambda: fake), "AUTHENTICATED")
            self.assertEqual(fake.calls, [("login", "isolated", "top-secret")])
            self.assertEqual(out.getvalue(), "")

    def test_failed_login_or_challenge_is_sanitized_and_not_retried(self):
        class ChallengeRequired(Exception):
            pass

        for error, expected in [(ChallengeRequired("top-secret challenge url"), "STOPPED_CHALLENGE_OR_2FA"), (RuntimeError("top-secret"), "STOPPED_RUNTIME_ERROR_DURING_LOGIN")]:
            fake = FakeClient(exc=error)
            with patch.dict(os.environ, {"PRIVATE_API_LOGIN_ONCE_APPROVED": "yes", "PRIVATE_API_IG_USERNAME": "isolated", "PRIVATE_API_IG_PASSWORD": "top-secret"}, clear=True):
                out = io.StringIO()
                with redirect_stdout(out):
                    self.assertEqual(login_once.attempt_once(client_factory=lambda: fake), expected)
                self.assertEqual(len(fake.calls), 1)
                self.assertEqual(out.getvalue(), "")

    def test_transport_dependency_and_unknown_are_classified_without_leaking_details(self):
        for error, expected in [
            (ConnectionError("password and private endpoint"), "STOPPED_TRANSPORT_ERROR_DURING_LOGIN"),
            (ModuleNotFoundError("private missing secret"), "STOPPED_DEPENDENCY_ERROR_DURING_LOGIN"),
            (Exception("password and account ID"), "STOPPED_OTHER_ERROR_DURING_LOGIN"),
        ]:
            fake = FakeClient(exc=error)
            with patch.dict(os.environ, {
                "PRIVATE_API_LOGIN_ONCE_APPROVED": "yes",
                "PRIVATE_API_IG_USERNAME": "isolated",
                "PRIVATE_API_IG_PASSWORD": "top-secret",
            }, clear=True):
                out = io.StringIO()
                with redirect_stdout(out):
                    self.assertEqual(login_once.attempt_once(client_factory=lambda: fake), expected)
                self.assertEqual(len(fake.calls), 1)
                self.assertEqual(out.getvalue(), "")

    def test_error_before_login_is_distinguished_from_error_during_login(self):
        with patch.dict(os.environ, {
            "PRIVATE_API_LOGIN_ONCE_APPROVED": "yes",
            "PRIVATE_API_IG_USERNAME": "isolated",
            "PRIVATE_API_IG_PASSWORD": "top-secret",
        }, clear=True):
            output = io.StringIO()
            def broken_factory():
                raise RuntimeError("private credential")
            with redirect_stdout(output):
                self.assertEqual(
                    login_once.attempt_once(client_factory=broken_factory),
                    "STOPPED_RUNTIME_ERROR_DURING_CLIENT_CREATION",
                )
            self.assertEqual(output.getvalue(), "")

    def test_logger_restored_even_when_login_fails(self):
        import logging
        old = logging.root.manager.disable
        try:
            logging.disable(logging.WARNING)
            with patch.dict(os.environ, {
                "PRIVATE_API_LOGIN_ONCE_APPROVED": "yes",
                "PRIVATE_API_IG_USERNAME": "isolated",
                "PRIVATE_API_IG_PASSWORD": "top-secret",
            }, clear=True):
                self.assertEqual(
                    login_once.attempt_once(client_factory=lambda: FakeClient(exc=RuntimeError("hidden"))),
                    "STOPPED_RUNTIME_ERROR_DURING_LOGIN",
                )
            self.assertEqual(logging.root.manager.disable, logging.WARNING)
        finally:
            logging.disable(old)

    def test_false_login_is_not_reported_as_success(self):
        fake = FakeClient(result=False)
        with patch.dict(os.environ, {"PRIVATE_API_LOGIN_ONCE_APPROVED": "yes", "PRIVATE_API_IG_USERNAME": "isolated", "PRIVATE_API_IG_PASSWORD": "top-secret"}, clear=True):
            self.assertEqual(login_once.attempt_once(client_factory=lambda: fake), "NOT_AUTHENTICATED")
            self.assertEqual(len(fake.calls), 1)


if __name__ == "__main__":
    unittest.main()
