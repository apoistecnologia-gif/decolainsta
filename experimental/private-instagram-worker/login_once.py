"""One explicitly approved diagnostic authentication via instagrapi.

Invoked ONLY as a temporary Railway pre-deploy command. Does not read followers,
follow/unfollow accounts, fetch profile details, persist sessions, retry login,
or print credentials / Instagram response content. One Client.login() invocation
can make multiple requests internally; this is NOT a single HTTP request.
"""
from __future__ import annotations

import contextlib
import logging
import os


def attempt_once(*, client_factory=None) -> str:
    """Return a sanitized fixed result label; never leak credentials."""
    if os.environ.get("PRIVATE_API_LOGIN_ONCE_APPROVED") != "yes":
        return "BLOCKED_NOT_APPROVED"
    username = os.environ.get("PRIVATE_API_IG_USERNAME")
    password = os.environ.get("PRIVATE_API_IG_PASSWORD")
    if not username or not password:
        return "BLOCKED_MISSING_CREDENTIALS"

    # Do not install automatic challenge, OTP, password-reset, or retry handlers.
    # Print nothing originating from the library, including exception messages.
    phase = "CLIENT_CREATION"
    try:
        with open(os.devnull, "w", encoding="utf-8") as silent:
            with contextlib.redirect_stdout(silent), contextlib.redirect_stderr(silent):
                previous_logging_disable = logging.root.manager.disable
                logging.disable(logging.CRITICAL)
                try:
                    if client_factory is None:
                        phase = "IMPORT"
                        from instagrapi import Client
                        client_factory = lambda: Client(with_challenge_flow=False)
                    phase = "CLIENT_CREATION"
                    client = client_factory()
                    phase = "LOGIN"
                    ok = client.login(username, password)
                finally:
                    logging.disable(previous_logging_disable)
        return "AUTHENTICATED" if ok is True else "NOT_AUTHENTICATED"
    except Exception as error:
        # Only print allowlisted class names. No message, trace, response, or URL.
        name = type(error).__name__
        # Distinguish the 4 restriction responses, using only fixed labels.
        # Never log a raw response, status body, cookies or exception text.
        if name == "PleaseWaitFewMinutes":
            return "STOPPED_PLEASE_WAIT_FEW_MINUTES"
        if name == "FeedbackRequired":
            return "STOPPED_FEEDBACK_REQUIRED"
        if name == "ClientThrottledError":
            return "STOPPED_HTTP_429_THROTTLED"
        if name == "RateLimitError":
            return "STOPPED_RATE_LIMIT_ERROR"
        if name in {"ChallengeRequired", "TwoFactorRequired", "ClientChallengeRequired"}:
            return "STOPPED_CHALLENGE_OR_2FA"
        if name in {"BadPassword", "ClientBadPassword", "ClientLoginRequired", "LoginRequired"}:
            return "STOPPED_LOGIN_REJECTED"
        if name in {"PleaseWaitFewMinutes", "ClientThrottledError", "FeedbackRequired", "RateLimitError"}:
            return "STOPPED_PLATFORM_RESTRICTION"
        # Only allowlisted categories are emitted. Never print exception text,
        # request URLs, response bodies, headers, sessions, usernames or passwords.
        if isinstance(error, (ImportError, ModuleNotFoundError)):
            return f"STOPPED_DEPENDENCY_ERROR_DURING_{phase}"
        if name in {"ConnectionError", "ConnectError", "Timeout", "ConnectTimeout",
                    "ReadTimeout", "SSLError", "ProxyError", "RequestException",
                    "RequestsError", "CurlError", "NetworkError", "ConnectionResetError"}:
            return f"STOPPED_TRANSPORT_ERROR_DURING_{phase}"
        if name in {"TypeError", "ValueError", "AttributeError", "KeyError",
                    "RuntimeError", "AssertionError"}:
            return f"STOPPED_RUNTIME_ERROR_DURING_{phase}"
        return f"STOPPED_OTHER_ERROR_DURING_{phase}"


def main() -> int:
    result = attempt_once()
    print(f"INSTAGRAM_TEST_LOGIN_DIAGNOSTIC={result}", flush=True)
    # A rejected/challenged login does not break the *passive* service deployment.
    # The diagnostic result is a log entry, NOT a reason to retry automatically.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
