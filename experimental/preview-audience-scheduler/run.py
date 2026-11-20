#!/usr/bin/env python3
"""Railway cron: one authorized GET of the PREVIEW read-only importer only.

Never opens an Instagram URL, launches a Phantom, or collects followers.
The server enforces six hours between provider result reads and global locking.
No provider credentials, database access or customer identifiers exist here.
"""
from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

PREVIEW_HOST = "decolainsta-git-experime-c65b12-mariajuvelina403-7231s-projects.vercel.app"
PREVIEW_PATH = "/api/cron/refresh-reference-audiences"
MAX_RESULT_BYTES = 8192

class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None

def validate_target(raw: str) -> bool:
    try:
        url = urlsplit(raw)
        return (url.scheme == "https" and url.hostname == PREVIEW_HOST
                and url.netloc == PREVIEW_HOST and url.path == PREVIEW_PATH
                and not url.query and not url.fragment
                and not url.username and not url.password and url.port is None)
    except ValueError:
        return False

def run_once(env: dict[str, str], opener=None) -> tuple[int, str]:
    # Safe default: an unconfigured service exits without making requests.
    if env.get("PREVIEW_READONLY_CRON_ENABLED") != "yes":
        return 0, "disabled"
    url = env.get("PREVIEW_REFRESH_URL", "")
    cron_secret = env.get("PREVIEW_CRON_SECRET", "")
    bypass = env.get("PREVIEW_PROTECTION_BYPASS", "")
    if (not validate_target(url) or len(cron_secret) < 32
            or len(bypass) != 32 or not bypass.isalnum()):
        return 2, "invalid-configuration"

    request = Request(
        url, method="GET",
        headers={
            "Authorization": "Bearer " + cron_secret,
            "X-Vercel-Protection-Bypass": bypass,
            "Accept": "application/json",
        },
    )
    if opener is None:
        opener = build_opener(NoRedirects()).open
    try:
        with opener(request, timeout=25) as response:
            if response.status != 200:
                return 1, "server-not-ready"
            raw = response.read(MAX_RESULT_BYTES + 1)
    except (HTTPError, URLError, OSError, TimeoutError, ValueError):
        return 1, "preview-request-failed"

    if len(raw) > MAX_RESULT_BYTES:
        return 1, "response-too-large"
    try:
        result = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
        return 1, "unrecognized-response"
    if (not isinstance(result, dict)
            or result.get("instagramActionsExecuted") != 0
            or result.get("actionsEnabled") is True
            or result.get("enabled") is not True
            or not isinstance(result.get("examined"), int)
            or isinstance(result.get("examined"), bool)
            or not 0 <= result["examined"] <= 3):
        return 1, "unexpected-or-disabled-runner"
    # Log only allowlisted counters; never raw response, cookies or credentials.
    return 0, "ok: examined=" + str(result["examined"])

def main() -> int:
    status, message = run_once(os.environ)
    print("preview-readonly-refresh:", message, flush=True)
    return status

if __name__ == "__main__":
    sys.exit(main())
