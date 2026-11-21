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
FOLLOW_PREVIEW_PATH = "/api/cron/preview-follow-simulation"
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
    # A disabled preview importer is a safe no-op, not a Railway crash.
    if (isinstance(result, dict)
            and result.get("enabled") is False
            and result.get("examined") == 0
            and result.get("instagramActionsExecuted") == 0
            and result.get("actionsEnabled") is not True):
        return 0, "importer-disabled"
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

def run_simulation_once(env: dict[str, str], opener=None) -> tuple[int, str]:
    """Optional PREVIEW-only database simulation, never Instagram actions."""
    if env.get("PREVIEW_FOLLOW_SIMULATION_CRON_ENABLED") != "yes":
        return 0, "disabled"
    if (not validate_target(env.get("PREVIEW_REFRESH_URL", ""))
            or len(env.get("PREVIEW_CRON_SECRET", "")) < 32
            or len(env.get("PREVIEW_PROTECTION_BYPASS", "")) != 32
            or not env["PREVIEW_PROTECTION_BYPASS"].isalnum()):
        return 2, "invalid-configuration"
    url = "https://" + PREVIEW_HOST + FOLLOW_PREVIEW_PATH
    request = Request(url, method="GET", headers={
        "Authorization": "Bearer " + env["PREVIEW_CRON_SECRET"],
        "X-Vercel-Protection-Bypass": env["PREVIEW_PROTECTION_BYPASS"],
        "Accept": "application/json",
    })
    if opener is None:
        opener = build_opener(NoRedirects()).open
    try:
        with opener(request, timeout=25) as response:
            if response.status != 200:
                return 1, "preview-not-ready"
            raw = response.read(MAX_RESULT_BYTES + 1)
    except (HTTPError, URLError, OSError, TimeoutError, ValueError):
        return 1, "preview-request-failed"
    if len(raw) > MAX_RESULT_BYTES:
        return 1, "response-too-large"
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
        return 1, "invalid-response"
    if (not isinstance(value, dict)
            or value.get("mode") != "simulation"
            or value.get("instagramActionsExecuted") != 0
            or value.get("realFollowsEnabled") is not False
            or value.get("realUnfollowsEnabled") is not False
            or value.get("enabled") not in (True, False)
            or not isinstance(value.get("advanced"), int)
            or isinstance(value.get("advanced"), bool)
            or not 0 <= value["advanced"] <= 5):
        return 1, "unsafe-or-unknown-response"
    return 0, "ok: advanced=" + str(value["advanced"])


def main() -> int:
    refresh_status, refresh_message = run_once(os.environ)
    print("preview-readonly-refresh:", refresh_message, flush=True)
    sim_status, sim_message = run_simulation_once(os.environ)
    print("preview-follow-simulation:", sim_message, flush=True)
    return max(refresh_status, sim_status)

if __name__ == "__main__":
    sys.exit(main())
