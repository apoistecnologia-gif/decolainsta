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
    try:
        with open(os.devnull, "w", encoding="utf-8") as silent:
            with contextlib.redirect_stdout(silent), contextlib.redirect_stderr(silent):
                if client_factory is None:
                    from instagrapi import Client
                    client_factory = lambda: Client(with_challenge_flow=False)
                logging.disable(logging.CRITICAL)
                try:
                    client = client_factory()
                    ok = client.login(username, password)
                finally:
                    logging.disable(logging.NOTSET)
        return "AUTHENTICATED" if ok is True else "NOT_AUTHENTICATED"
    except Exception as error:
        # Only print allowlisted class names. No message, trace, response, or URL.
        name = type(error).__name__
        if name in {"ChallengeRequired", "TwoFactorRequired", "ClientChallengeRequired"}:
            return "STOPPED_CHALLENGE_OR_2FA"
        if name in {"BadPassword", "ClientBadPassword", "ClientLoginRequired", "LoginRequired"}:
            return "STOPPED_LOGIN_REJECTED"
        if name in {"PleaseWaitFewMinutes", "ClientThrottledError", "FeedbackRequired", "RateLimitError"}:
            return "STOPPED_PLATFORM_RESTRICTION"
        # Only allowlisted categories are emitted. Never print exception text,
        # request URLs, response bodies, headers, sessions, usernames or passwords.
        if isinstance(error, (ImportError, ModuleNotFoundError)):
            return "STOPPED_DEPENDENCY_ERROR"
        if name in {"ConnectionError", "ConnectError", "Timeout", "ConnectTimeout",
                    "ReadTimeout", "SSLError", "ProxyError", "RequestException",
                    "RequestsError", "CurlError", "NetworkError", "ConnectionResetError"}:
            return "STOPPED_TRANSPORT_ERROR"
        if name in {"TypeError", "ValueError", "AttributeError", "KeyError",
                    "RuntimeError", "AssertionError"}:
            return "STOPPED_RUNTIME_ERROR"
        return "STOPPED_OTHER_ERROR"


def main() -> int:
    result = attempt_once()
    print(f"INSTAGRAM_TEST_LOGIN_DIAGNOSTIC={result}", flush=True)
    # A rejected/challenged login does not break the *passive* service deployment.
    # The diagnostic result is a log entry, NOT a reason to retry automatically.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
