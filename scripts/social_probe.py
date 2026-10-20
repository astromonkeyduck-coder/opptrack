#!/usr/bin/env python3
"""Bounded Stage 0 reads. Never starts an actor, sends a message, or writes upstream.

Only public actor metadata/directory reads are credential-free. Account media and
existing dataset inspection require explicit environment setup. Summary files do
not contain captions, access tokens, signed media URLs, or credential-bearing URLs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

DIRECTORY = "https://studentaffairs.fsu.edu/resources/social-media-follow-list"
ACTORS = {
    "posts": "apify~instagram-post-scraper",
    "stories": "datavoyantlab~advanced-instagram-stories-scraper",
}
MAX_BYTES = 5_000_000


class ProbeError(Exception):
    def __init__(self, status: str, detail: str, **facts):
        super().__init__(detail)
        self.facts = {"status": status, "detail": detail, **facts}


class NoRedirect(HTTPRedirectHandler):
    # Reject redirects rather than risk forwarding Authorization to another host.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def get(url: str, token: str | None = None):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port or parsed.hostname not in {
        "studentaffairs.fsu.edu", "api.apify.com", "graph.instagram.com"
    }:
        raise ProbeError("blocked", "URL outside fixed HTTPS read allowlist")
    if parsed.hostname == "graph.instagram.com" and not re.fullmatch(r"/v[0-9]+\.[0-9]+/([0-9]+|me)/media", parsed.path):
        raise ProbeError("blocked", "Only authorized account media GET is allowed")
    # Apify offers actor-starting GET convenience endpoints; none are allowed.
    if parsed.hostname == "api.apify.com" and not (
        re.fullmatch(r"/v2/acts/(apify~instagram-post-scraper|datavoyantlab~advanced-instagram-stories-scraper)", parsed.path)
        or re.fullmatch(r"/v2/datasets/[A-Za-z0-9_-]+/items", parsed.path)
    ):
        raise ProbeError("blocked", "Only actor metadata and existing dataset items are allowed")
    headers = {"User-Agent": "FSU-Opportunity-Tracker-Stage0/0.1", "Accept": "application/json,text/html"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with build_opener(NoRedirect()).open(Request(url, headers=headers, method="GET"), timeout=30) as response:
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ProbeError("partial", "Response exceeded bounded read size")
            return body, dict(response.headers), response.status
    except HTTPError as exc:
        status = "setup-needed" if exc.code in (401, 403) else "blocked"
        retry = exc.headers.get("Retry-After", "") if exc.headers else ""
        exc.close()
        # Do not serialize exception text or bodies, which can echo access tokens.
        raise ProbeError(status, "Upstream HTTP failure; no no-new-content conclusion", http_status=exc.code,
                         retry_after=retry if re.fullmatch(r"[0-9]{1,6}", retry) else None) from None
    except (URLError, TimeoutError, OSError):
        raise ProbeError("blocked", "Network/DNS/TLS failure; no no-new-content conclusion") from None


def json_get(url, token=None):
    body, headers, status = get(url, token)
    try:
        return json.loads(body), headers, status
    except (ValueError, UnicodeError):
        raise ProbeError("blocked", "Expected JSON; possible login/error HTML") from None


def require(*names):
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise ProbeError("setup-needed", "Required configuration unavailable; collector unrun", missing=missing,
                         upstream_requests=0, collection_executed=False)
    return [os.environ[name] for name in names]


class DirectoryParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.link = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        if tag == "a" and self.row is not None:
            self.link = [dict(attrs).get("href", ""), ""]

    def handle_data(self, data):
        if self.link is not None:
            self.link[1] += data

    def handle_endtag(self, tag):
        if tag == "a" and self.link is not None:
            if self.row is not None:
                self.row.append(self.link)
            self.link = None
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def pilot_accounts():
    body, _, code = get(DIRECTORY)
    parser = DirectoryParser()
    parser.feed(body.decode("utf-8"))
    accounts, seen = [], set()
    for row in parser.rows:
        for url, _ in row:
            parsed = urlparse(url)
            handle = parsed.path.strip("/").lower()
            if parsed.hostname in ("instagram.com", "www.instagram.com") and re.fullmatch(r"[a-z0-9_.]+", handle) and handle not in seen:
                seen.add(handle)
                accounts.append({"organizer": row[0][1].strip(), "handle": handle,
                                 "url": "https://www.instagram.com/" + handle + "/",
                                 "affiliation_evidence_url": DIRECTORY,
                                 "identity_status": "linked_from_fsu_official_directory",
                                 "account_content_access": "untested",
                                 "pilot_enabled": False})
    if len(accounts) < 30:
        raise ProbeError("blocked", "Directory parser did not find the planned minimum 30 accounts")
    return {"status": "verified-operational", "verification_scope": "official_directory_links_only",
            "http_status": code, "content_sha256": hashlib.sha256(body).hexdigest(),
            "account_count": len(accounts), "accounts": accounts,
            "collection_executed": False, "detail": "Affiliation links verified; Instagram account existence, public status, professional status and ingestion remain untested"}


def actor_metadata(kind):
    actor = ACTORS[kind]
    payload, _, code = json_get("https://api.apify.com/v2/acts/" + actor)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict) or not data.get("id"):
        raise ProbeError("blocked", "Unexpected actor metadata envelope")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    prices = [p for p in data.get("pricingInfos", []) if p.get("startedAt", "9999") <= now]
    current = max(prices, key=lambda p: p.get("startedAt", ""), default=None)
    return {"status": "verified-operational", "verification_scope": "public_vendor_metadata_only",
            "actor": actor.replace("~", "/"), "actor_id": data["id"], "http_status": code,
            "modified_at": data.get("modifiedAt"), "latest_build": data.get("taggedBuilds", {}).get("latest"),
            "current_pricing": current, "collection_executed": False, "billable_actor_runs": 0,
            "detail": "Metadata GET succeeded; actor output, permission and capture completeness untested"}


def media_summary(rows):
    stats = {"rows": len(rows), "rows_with_native_id": 0, "rows_with_timestamp": 0,
             "rows_with_media_url": 0, "carousel_rows": 0, "carousel_children_returned": 0,
             "carousel_child_pagination_remaining": 0, "rows_with_vendor_error": 0}
    for row in rows:
        if not isinstance(row, dict):
            raise ProbeError("partial", "Non-object media/dataset row")
        stats["rows_with_native_id"] += bool(row.get("id") or row.get("shortCode") or row.get("pk"))
        stats["rows_with_timestamp"] += bool(row.get("timestamp") or row.get("taken_at") or row.get("takenAt"))
        stats["rows_with_media_url"] += bool(row.get("media_url") or row.get("displayUrl") or row.get("image_url") or row.get("videoUrl"))
        stats["rows_with_vendor_error"] += bool(row.get("error") or row.get("errorMessage"))
        children = row.get("children", row.get("childPosts", []))
        if isinstance(children, dict):
            stats["carousel_child_pagination_remaining"] += bool(children.get("paging", {}).get("next"))
            children = children.get("data", [])
        if row.get("media_type") == "CAROUSEL_ALBUM" or row.get("type") == "Sidecar" or children:
            stats["carousel_rows"] += 1
            stats["carousel_children_returned"] += len(children) if isinstance(children, list) else 0
    return stats


def instagram_login(max_pages):
    token, ig_id, version = require("IG_ACCESS_TOKEN", "IG_USER_ID", "IG_API_VERSION")
    if not re.fullmatch(r"[0-9]+|me", ig_id) or not re.fullmatch(r"v[0-9]+\.[0-9]+", version):
        raise ProbeError("setup-needed", "IG_USER_ID must be numeric or me; set an explicitly verified Graph API version")
    fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}"
    base = "https://graph.instagram.com/" + version + "/" + ig_id + "/media"
    rows, pages, after, more = [], 0, None, False
    while pages < max_pages:
        query = {"fields": fields, "limit": 25}
        if after:
            query["after"] = after
        payload, _, _ = json_get(base + "?" + urlencode(query), token)
        if not isinstance(payload, dict) or "error" in payload or not isinstance(payload.get("data"), list):
            raise ProbeError("blocked", "Invalid API media envelope or upstream error; never interpret as no new content")
        rows.extend(payload["data"])
        pages += 1
        more = bool(payload.get("paging", {}).get("next"))
        next_after = payload.get("paging", {}).get("cursors", {}).get("after")
        if not more:
            break
        if not next_after or next_after == after:
            raise ProbeError("partial", "Pagination continuation missing/repeated", pages=pages)
        # Use only cursor values, never an upstream next URL carrying access_token.
        after = next_after
    stats = media_summary(rows)
    incomplete = (more or stats["carousel_child_pagination_remaining"] > 0
                  or stats["rows_with_vendor_error"] > 0
                  or stats["rows_with_native_id"] != len(rows)
                  or stats["rows_with_timestamp"] != len(rows))
    return {"status": "partial" if incomplete else ("success-empty-unverified" if not rows else "success-sample"),
            "verification_scope": "authorized_account_media_sample_only", "pages": pages, "stats": stats,
            "more_pages": more, "collection_executed": True, "stories_tested": False,
            "carousel_completeness": "unproven: compare against manual baseline; child pagination is counted but not fetched",
            "detail": "No arbitrary-account or Story coverage conclusion; no media downloaded; field support must be validated with configured app/version"}


def apify_dataset(max_pages):
    token, dataset = require("APIFY_TOKEN", "APIFY_DATASET_ID")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", dataset):
        raise ProbeError("setup-needed", "Invalid dataset identifier")
    rows, offset, pages, total = [], 0, 0, None
    while pages < max_pages:
        # clean=false preserves error/empty records so failures are not filtered out.
        url = "https://api.apify.com/v2/datasets/" + dataset + "/items?" + urlencode({"format": "json", "clean": "false", "offset": offset, "limit": 100})
        payload, headers, _ = json_get(url, token)
        if not isinstance(payload, list):
            raise ProbeError("blocked", "Expected dataset array, got error/invalid payload")
        rows.extend(payload)
        pages += 1
        header_map = {key.lower(): value for key, value in headers.items()}
        raw_total = header_map.get("x-apify-pagination-total")
        total = int(raw_total) if raw_total and raw_total.isdigit() else None
        offset += len(payload)
        if (total is not None and offset >= total) or not payload:
            break
    stats = media_summary(rows)
    complete = total is not None and offset >= total
    status = ("success-empty-unverified" if complete and not rows else
              "existing-dataset-inspected" if complete and not stats["rows_with_vendor_error"] else "partial")
    return {"status": status,
            "verification_scope": "existing_dataset_only", "pages": pages, "dataset_total": total,
            "pagination_complete": complete, "stats": stats, "collection_executed": False,
            "billable_actor_runs": 0, "detail": "Dataset retrieval does not prove actor-run success, target access, freshness or carousel completeness; no media downloaded"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("route", choices=["pilot-accounts", "apify-posts-metadata", "apify-stories-metadata", "instagram-login", "apify-dataset"])
    parser.add_argument("--max-pages", type=int, default=2, help="Bounded media/dataset pagination, 1..5")
    parser.add_argument("--output", type=Path, help="Sanitized summary JSON; no captures or secrets")
    args = parser.parse_args()
    if not 1 <= args.max_pages <= 5:
        parser.error("--max-pages must be 1..5")
    result = {"route": args.route, "tested_at": datetime.now(timezone.utc).isoformat(), "probe_version": "0.1"}
    exit_code = 0
    try:
        if args.route == "pilot-accounts":
            result.update(pilot_accounts())
        elif args.route.endswith("-metadata"):
            result.update(actor_metadata("stories" if "stories" in args.route else "posts"))
        elif args.route == "instagram-login":
            result.update(instagram_login(args.max_pages))
        else:
            result.update(apify_dataset(args.max_pages))
        if result["status"] in ("partial", "success-empty-unverified"):
            exit_code = 3
    except ProbeError as exc:
        result.update(exc.facts)
        exit_code = 2 if result["status"] == "setup-needed" else 3
    except (TypeError, ValueError, KeyError, UnicodeError):
        result.update(status="blocked", detail="Unexpected payload shape; no no-new-content conclusion")
        exit_code = 3
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
