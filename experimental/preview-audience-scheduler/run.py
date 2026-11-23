#!/usr/bin/env python3
"""Railway Preview scheduler with explicitly gated, single-purpose operations.

Only the opt-in Apify trial may request one capped, no-cookie public follower
collection; all social follow/unfollow actions remain disabled.
The server owns provider credentials, durable locks and result attribution.
Railway contains no Instagram session or Apify token.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

PREVIEW_HOST = "decolainsta-git-experime-c65b12-mariajuvelina403-7231s-projects.vercel.app"
PREVIEW_PATH = "/api/cron/refresh-reference-audiences"
FOLLOW_PREVIEW_PATH = "/api/cron/preview-follow-simulation"
DYNAMIC_RECONCILE_PATH = "/api/operator/phantombuster/dynamic-references"
INSTAGRAM_READINESS_PATH = "/api/cron/preview-instagram-readiness"
APIFY_PILOT_PATH = "/api/cron/preview-apify-pilot"
APIFY_INDEX_PATH = "/api/cron/preview-apify-candidate-index"
APIFY_SOCIAL_READINESS_PATH = "/api/cron/preview-apify-social-readiness"
APIFY_ONE_FOLLOW_AUDIT_PATH = "/api/cron/preview-apify-one-follow-reconcile"
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


def run_reconciliation_once(env: dict[str, str], opener=None, now=None) -> tuple[int, str]:
    """Reconcile a previously launched exact container; NEVER start a new job."""
    if env.get("PREVIEW_DYNAMIC_RECONCILIATION_CRON_ENABLED") != "yes":
        return 0, "disabled"
    now = now or datetime.now(timezone.utc)
    # Half-hour read-only cadence, independent of the five-minute simulation.
    if not 0 <= now.minute % 30 < 5:
        return 0, "interval-not-due"
    if (not validate_target(env.get("PREVIEW_REFRESH_URL", ""))
            or len(env.get("PREVIEW_CRON_SECRET", "")) < 32
            or len(env.get("PREVIEW_PROTECTION_BYPASS", "")) != 32
            or not env["PREVIEW_PROTECTION_BYPASS"].isalnum()):
        return 2, "invalid-configuration"
    url = "https://" + PREVIEW_HOST + DYNAMIC_RECONCILE_PATH
    payload = b'{"operation":"reconcile-only","confirmDynamicCollection":true}'
    request = Request(url, method="POST", data=payload, headers={
        "Authorization": "Bearer " + env["PREVIEW_CRON_SECRET"],
        "X-Vercel-Protection-Bypass": env["PREVIEW_PROTECTION_BYPASS"],
        "Content-Type": "application/json",
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
    safe = {
        "no-pending-run", "in-progress", "finished",
        "finished-without-input-proof", "import-unavailable",
    }
    if not isinstance(value, dict) or value.get("status") not in safe:
        return 1, "unrecognized-reconciliation-state"
    if value.get("status") == "no-pending-run" and (
            value.get("noAutomaticLaunch") is not True
            or value.get("launchesExecuted") != 0
            or value.get("instagramActionsExecuted") != 0):
        return 1, "unsafe-reconciliation-response"
    # Log only a known status. Never log raw provider output or usernames.
    return 0, "ok: status=" + value["status"]



def run_collection_once(env: dict[str, str], opener=None, now=None) -> tuple[int, str]:
    """Opt-in only: at most one new reference collection every six hours.

    Server-side POST performs the final global lock, historical restriction
    review and collector-idle checks. This worker never has provider cookies.
    """
    if env.get("PREVIEW_DYNAMIC_COLLECTION_CRON_ENABLED") != "yes":
        return 0, "disabled"
    now = now or datetime.now(timezone.utc)
    if now.hour % 6 != 0 or not 5 <= now.minute < 10:
        return 0, "interval-not-due"
    if (not validate_target(env.get("PREVIEW_REFRESH_URL", ""))
            or len(env.get("PREVIEW_CRON_SECRET", "")) < 32
            or len(env.get("PREVIEW_PROTECTION_BYPASS", "")) != 32
            or not env["PREVIEW_PROTECTION_BYPASS"].isalnum()):
        return 2, "invalid-configuration"
    request = Request("https://" + PREVIEW_HOST + DYNAMIC_RECONCILE_PATH,
        method="POST",
        data=b'{"operation":"collect-next","confirmDynamicCollection":true}',
        headers={
            "Authorization": "Bearer " + env["PREVIEW_CRON_SECRET"],
            "X-Vercel-Protection-Bypass": env["PREVIEW_PROTECTION_BYPASS"],
            "Content-Type": "application/json",
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
    safe = {
        "queued", "in-progress", "provider-busy", "review-required",
        "queue-complete", "finished", "finished-without-input-proof",
        "import-unavailable",
    }
    if not isinstance(value, dict) or value.get("status") not in safe:
        return 1, "unrecognized-collection-state"
    if value.get("status") == "queued" and (
            value.get("savedPhantomSettingsChanged") is not False
            or value.get("followsExecuted") != 0
            or value.get("unfollowsExecuted") != 0):
        return 1, "unsafe-collection-response"
    return 0, "ok: status=" + value["status"]



def run_instagram_readiness_once(env: dict[str, str], opener=None, now=None) -> tuple[int, str]:
    """Read-only health probe: Meta account and exact previous Phantom log only."""
    if env.get("PREVIEW_INSTAGRAM_READINESS_PROBE_ENABLED") != "yes":
        return 0, "disabled"
    now = now or datetime.now(timezone.utc)
    # A dated, UTC one-shot test can replace (not add to) the standard
    # half-hour cadence. It expires automatically after five minutes.
    one_shot = env.get("PREVIEW_INSTAGRAM_READINESS_ONE_SHOT_UTC", "")
    if one_shot:
        if len(one_shot) != 17 or not one_shot.endswith("Z"):
            return 2, "invalid-one-shot-time"
        try:
            due = datetime.strptime(one_shot, "%Y-%m-%dT%H:%MZ").replace(
                tzinfo=timezone.utc)
        except ValueError:
            return 2, "invalid-one-shot-time"
        if not 0 <= (now - due).total_seconds() < 300:
            return 0, "one-shot-not-due"
    elif not 5 <= now.minute % 30 < 10:
        return 0, "interval-not-due"
    if (not validate_target(env.get("PREVIEW_REFRESH_URL", ""))
            or len(env.get("PREVIEW_CRON_SECRET", "")) < 32
            or len(env.get("PREVIEW_PROTECTION_BYPASS", "")) != 32
            or not env["PREVIEW_PROTECTION_BYPASS"].isalnum()):
        return 2, "invalid-configuration"
    request = Request("https://" + PREVIEW_HOST + INSTAGRAM_READINESS_PATH,
        method="GET", headers={
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
    categories = {
        "session-invalid", "login-challenge", "invalid-input", "private-target",
        "platform-limited", "workspace-limit", "execution-timeout", "runtime-error",
        "followers-load-failed", "profile-load-failed", "terms-update",
        "credentials-missing", "no-matches", "proxy-failure", "unknown",
        "empty-output", "output-too-large", "provider-unavailable", None,
    }
    if (not isinstance(value, dict)
            or value.get("status") != "read-only-diagnostic"
            or value.get("apifyStatus") not in (
                "connected", "not-configured", "invalid-token",
                "rate-limited", "unavailable")
            or type(value.get("apifyAuthenticationChecked")) is not bool
            or value.get("apifyActorRunsExecuted") != 0
            or value.get("apifyInstagramActionsExecuted") != 0
            or value.get("apifyCollectionEnabled") is not False
            or value.get("metaRead") not in ("ok", "not-connected", "unavailable")
            or value.get("metaIdentity") not in (
                "verified", "username-mismatch", "unavailable")
            or (value.get("metaIdentity") == "verified" and value.get("metaRead") != "ok")
            or value.get("previousContainerCategory") not in categories
            or value.get("collectorConfiguration") not in (
                "ready", "not-configured", "invalid-key", "rate-limited",
                "workspace-mismatch", "ambiguous-match", "invalid-inventory",
                "collector-not-found", "missing-cookie", "mismatch",
                "unavailable")
            or value.get("collectorProgress") not in (
                "not-checked", "running", "finished", "failed", "pending",
                "unverified", "no-run", "invalid-key", "rate-limited", "unavailable")
            or type(value.get("collectionHistoryRequiresReview")) is not bool
            or value.get("newCollectionPermitted") is not False
            or value.get("currentSessionOwnerVerifiedByProvider") is not False
            or value.get("previousContainerOnly") is not True
            or value.get("currentPhantomSessionVerified") is not False
            or value.get("instagramRestrictionCleared") is not None
            or value.get("providerLaunchesExecuted") != 0
            or value.get("instagramActionsExecuted") != 0
            or value.get("dataMutations") != 0):
        return 1, "unsafe-readiness-response"
    # Safe allowlisted status, never raw logs, usernames, tokens or cookies.
    return 0, ("ok: apify=" + value["apifyStatus"] +
               " meta=" + value["metaRead"] +
               " identity=" + value["metaIdentity"] +
               " old-container=" + (value["previousContainerCategory"] or "none") +
               " collector=" + value["collectorConfiguration"] +
               " progress=" + value["collectorProgress"] +
               " history-review=" + str(value["collectionHistoryRequiresReview"]).lower())

def run_apify_trial_once(env: dict[str, str], opener=None, now=None) -> tuple[int, str]:
    """Single opt-in 25-row Apify trial, then read only its exact recorded run.

    No Apify API token is sent from Railway; Vercel alone holds that secret.
    A claim in Neon refuses every duplicate launch, including retries after
    an ambiguous response.
    """
    if env.get("PREVIEW_APIFY_PILOT_CRON_ENABLED") != "yes":
        return 0, "disabled"
    now = now or datetime.now(timezone.utc)
    one_shot = env.get("PREVIEW_APIFY_PILOT_ONE_SHOT_UTC", "")
    try:
        if len(one_shot) != 17 or not one_shot.endswith("Z"):
            return 2, "invalid-one-shot-time"
        due = datetime.strptime(one_shot, "%Y-%m-%dT%H:%MZ").replace(
            tzinfo=timezone.utc)
    except ValueError:
        return 2, "invalid-one-shot-time"
    age = (now - due).total_seconds()
    if age < 0 or age >= 5400:
        return 0, "outside-window"
    operation = "launch" if age < 300 else "inspect"
    if (not validate_target(env.get("PREVIEW_REFRESH_URL", ""))
            or len(env.get("PREVIEW_CRON_SECRET", "")) < 32
            or len(env.get("PREVIEW_PROTECTION_BYPASS", "")) != 32
            or not env["PREVIEW_PROTECTION_BYPASS"].isalnum()):
        return 2, "invalid-configuration"
    payload = json.dumps({"operation": operation}, separators=(",", ":")).encode()
    req = Request("https://" + PREVIEW_HOST + APIFY_PILOT_PATH,
        method="POST", data=payload, headers={
            "Authorization": "Bearer " + env["PREVIEW_CRON_SECRET"],
            "X-Vercel-Protection-Bypass": env["PREVIEW_PROTECTION_BYPASS"],
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
    if opener is None:
        opener = build_opener(NoRedirects()).open
    try:
        with opener(req, timeout=30) as response:
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
    allowed = {"queued", "refused", "unconfirmed", "already-reserved",
               "running", "unavailable", "invalid", "failed",
               "finished", "finished-empty", "finished-unverified",
               "rejected", "claimed", "launched"}
    if (not isinstance(value, dict) or value.get("status") not in allowed
            or value.get("instagramActionsExecuted") != 0
            or value.get("noAutomaticRetry") is not True
            or value.get("actorRunsLaunched") not in (0, 1)
            or type(value.get("actorRunsLaunched")) is not int
            or (operation == "inspect" and value.get("actorRunsLaunched") != 0)
            or (operation == "launch" and value.get("status") == "queued"
                and (value.get("maxResults") != 25
                     or value.get("maxTotalChargeUsd") != 0.25
                     or value.get("actorRunsLaunched") != 1))
            or (operation == "launch" and value.get("status") != "queued"
                and value.get("actorRunsLaunched") != 0)):
        return 1, "unsafe-trial-response"
    # Never log usernames, run ID, API token, cookies or raw output.
    return 0, "ok: status=" + value["status"]


def run_apify_index_once(env: dict[str, str], opener=None, now=None) -> tuple[int, str]:
    """Index only saved, complete Apify trial results into inert candidate rows.

    The endpoint cannot launch Actors, follow or unfollow Instagram accounts.
    One explicit time window and a database serializable transaction ensure
    repeat calls remain idempotent.
    """
    if env.get("PREVIEW_APIFY_INDEX_CRON_ENABLED") != "yes":
        return 0, "disabled"
    now = now or datetime.now(timezone.utc)
    scheduled = env.get("PREVIEW_APIFY_INDEX_ONE_SHOT_UTC", "")
    if len(scheduled) != 17 or not scheduled.endswith("Z"):
        return 2, "invalid-one-shot-time"
    try:
        due = datetime.strptime(scheduled, "%Y-%m-%dT%H:%MZ").replace(
            tzinfo=timezone.utc)
    except ValueError:
        return 2, "invalid-one-shot-time"
    if not 0 <= (now - due).total_seconds() < 300:
        return 0, "outside-window"
    if (not validate_target(env.get("PREVIEW_REFRESH_URL", ""))
            or len(env.get("PREVIEW_CRON_SECRET", "")) < 32
            or len(env.get("PREVIEW_PROTECTION_BYPASS", "")) != 32
            or not env["PREVIEW_PROTECTION_BYPASS"].isalnum()):
        return 2, "invalid-configuration"
    request = Request("https://" + PREVIEW_HOST + APIFY_INDEX_PATH,
        method="POST", data=b'{"operation":"index-existing"}', headers={
            "Authorization": "Bearer " + env["PREVIEW_CRON_SECRET"],
            "X-Vercel-Protection-Bypass": env["PREVIEW_PROTECTION_BYPASS"],
            "Content-Type": "application/json",
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
        result = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
        return 1, "invalid-response"
    if (not isinstance(result, dict)
            or result.get("status") not in ("indexed", "invalid-source", "capacity-reached")
            or result.get("providerRunsExecuted") != 0
            or result.get("instagramActionsExecuted") != 0
            or result.get("actionsEnabled") is not False
            or type(result.get("indexed")) is not int
            or not 0 <= result["indexed"] <= 25
            or type(result.get("alreadyPresent")) is not int
            or not 0 <= result["alreadyPresent"] <= 25
            or type(result.get("sourceCount")) is not int
            or not 0 <= result["sourceCount"] <= 25
            or (result["indexed"] + result["alreadyPresent"] > result["sourceCount"])):
        return 1, "unsafe-index-response"
    return 0, "ok: status=" + result["status"] + " indexed=" + str(result["indexed"])


def run_apify_social_readiness_once(
    env: dict[str, str], opener=None, now=None
) -> tuple[int, str]:
    """Read-only audit of 3 Apify follow/unfollow Actor definitions.

    Never launches an Actor, obtains cookies or triggers social actions.
    """
    if env.get("PREVIEW_APIFY_SOCIAL_READINESS_CRON_ENABLED") != "yes":
        return 0, "disabled"
    now = now or datetime.now(timezone.utc)
    scheduled = env.get("PREVIEW_APIFY_SOCIAL_READINESS_ONE_SHOT_UTC", "")
    if len(scheduled) != 17 or not scheduled.endswith("Z"):
        return 2, "invalid-one-shot-time"
    try:
        due = datetime.strptime(scheduled, "%Y-%m-%dT%H:%MZ").replace(
            tzinfo=timezone.utc)
    except ValueError:
        return 2, "invalid-one-shot-time"
    if not 0 <= (now - due).total_seconds() < 300:
        return 0, "outside-window"
    if (not validate_target(env.get("PREVIEW_REFRESH_URL", ""))
            or len(env.get("PREVIEW_CRON_SECRET", "")) < 32
            or len(env.get("PREVIEW_PROTECTION_BYPASS", "")) != 32
            or not env["PREVIEW_PROTECTION_BYPASS"].isalnum()):
        return 2, "invalid-configuration"
    request = Request("https://" + PREVIEW_HOST + APIFY_SOCIAL_READINESS_PATH,
        method="GET", headers={
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
    statuses = {"listed", "not-configured", "not-found", "unauthorized",
                "rate-limited", "metadata-mismatch", "unavailable"}
    permissions = {"limited", "full", "unknown"}
    if (not isinstance(value, dict) or
            value.get("verifiedFollows") != 0 or
            value.get("verifiedUnfollows") != 0 or
            value.get("actorRunsExecuted") != 0 or
            value.get("instagramActionsExecuted") != 0 or
            value.get("liveActionsEnabled") is not False):
        return 1, "unsafe-social-readiness"
    for key in ("combined", "follow", "unfollow"):
        actor = value.get(key)
        if (not isinstance(actor, dict) or
                actor.get("status") not in statuses or
                actor.get("permissions") not in permissions or
                actor.get("requiresInstagramCookie") is not True or
                actor.get("realActionVerified") is not False):
            return 1, "unsafe-social-readiness"
    # Safe allowlisted output; never show actor input, tokens or session data.
    return 0, ("ok: combined=" + value["combined"]["status"] +
               " follow=" + value["follow"]["status"] +
               " unfollow=" + value["unfollow"]["status"] +
               " unfollow-permissions=" + value["unfollow"]["permissions"])



def run_apify_one_follow_audit_once(
    env: dict[str, str], opener=None, now=None
) -> tuple[int, str]:
    """Read-only reconciliation of EXACT old Apify run, never launches Actor."""
    if env.get("PREVIEW_APIFY_ONE_FOLLOW_AUDIT_CRON_ENABLED") != "yes":
        return 0, "disabled"
    now = now or datetime.now(timezone.utc)
    if not 0 <= now.minute % 30 < 5:
        return 0, "interval-not-due"
    if (not validate_target(env.get("PREVIEW_REFRESH_URL", ""))
            or len(env.get("PREVIEW_CRON_SECRET", "")) < 32
            or len(env.get("PREVIEW_PROTECTION_BYPASS", "")) != 32
            or not env["PREVIEW_PROTECTION_BYPASS"].isalnum()):
        return 2, "invalid-configuration"
    request = Request("https://" + PREVIEW_HOST + APIFY_ONE_FOLLOW_AUDIT_PATH,
        method="GET", headers={
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
    valid_statuses = {
        "no-pending-run", "running", "unavailable", "concurrent",
        "history-invalid", "failed", "ambiguous",
        "provider-reported", "provider-rejected", "provider-blocked",
    }
    if (not isinstance(value, dict)
            or value.get("status") not in valid_statuses
            or value.get("actorRunsLaunched") != 0
            or value.get("instagramActionsExecuted") != 0
            or value.get("independentlyVerified") is not False
            or value.get("unfollowEnabled") is not False
            or value.get("noAutomaticRetry") is not True):
        return 1, "unsafe-apify-audit-response"
    # Never print run ID, target, cookies, token, or unfiltered provider output.
    return 0, "ok: status=" + value["status"]


def main() -> int:
    refresh_status, refresh_message = run_once(os.environ)
    print("preview-readonly-refresh:", refresh_message, flush=True)
    sim_status, sim_message = run_simulation_once(os.environ)
    print("preview-follow-simulation:", sim_message, flush=True)
    reconciliation_status, reconciliation_message = run_reconciliation_once(os.environ)
    print("preview-dynamic-reconciliation:", reconciliation_message, flush=True)
    collection_status, collection_message = run_collection_once(os.environ)
    print("preview-dynamic-collection:", collection_message, flush=True)
    readiness_status, readiness_message = run_instagram_readiness_once(os.environ)
    print("preview-instagram-readiness:", readiness_message, flush=True)
    apify_status, apify_message = run_apify_trial_once(os.environ)
    print("preview-apify-trial:", apify_message, flush=True)
    index_status, index_message = run_apify_index_once(os.environ)
    print("preview-apify-index:", index_message, flush=True)
    social_status, social_message = run_apify_social_readiness_once(os.environ)
    print("preview-apify-social-readiness:", social_message, flush=True)
    follow_audit_status, follow_audit_message = run_apify_one_follow_audit_once(os.environ)
    print("preview-apify-one-follow-audit:", follow_audit_message, flush=True)
    return max(refresh_status, sim_status, reconciliation_status, collection_status,
               readiness_status, apify_status, index_status, social_status,
               follow_audit_status)

if __name__ == "__main__":
    sys.exit(main())
