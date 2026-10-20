#!/usr/bin/env python3
"""Check Stage 0 scenario labels, not application behavior. Network-free; stdlib only."""

import argparse
import copy
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
REQUIRED_TAGS = {
    "image_only", "all_carousel_slides", "partial_media", "old_repost",
    "relative_date", "conflicting_date", "conflicting_year", "different_performances",
    "duplicate_sources", "missing_end", "missing_location", "sold_out", "waitlist",
    "cancellation", "http_200_login_wall", "expired_token", "retries",
    "calendar_partial_success", "unknown_date", "unknown_deadline_time",
    "dst_gap", "dst_fold", "recurrence", "decision_separation", "negative",
    "calendar_idempotency", "manual_calendar_edit", "approval_revoked", "stale_approval",
    "cursor_commit", "delivery_state", "untrusted_content", "recommendation_separation",
}
EXPECTED_PROVENANCE = {"synthetic", "live_reference"}


def valid_instants(local_text, zone_name):
    """Round-trip folds to identify gaps, ambiguity, or a unique local instant."""
    naive = datetime.fromisoformat(local_text)
    if naive.tzinfo is not None:
        raise ValueError("fixture local value must have no UTC offset")
    zone = ZoneInfo(zone_name)
    instants = set()
    for fold in (0, 1):
        zoned = naive.replace(tzinfo=zone, fold=fold)
        utc = zoned.astimezone(timezone.utc)
        if utc.astimezone(zone).replace(tzinfo=None) == naive:
            instants.add(utc.isoformat())
    return sorted(instants)


def validate(data, repo=REPO, check_evidence=True):
    errors = []
    if data.get("schema_version") != 1:
        errors.append("unsupported schema_version")
    if data.get("application_implementation") != "not_built":
        errors.append("Stage 0 must not imply an application benchmark exists")
    cases = data.get("cases")
    if not isinstance(cases, list) or not cases:
        return errors + ["cases must be a nonempty list"]
    ids, tags = set(), set()
    live = []
    for case in cases:
        case_id = case.get("id", "<missing>")
        if not re.fullmatch(r"[a-z][a-z0-9_]+", case_id) or case_id in ids:
            errors.append(f"{case_id}: invalid or duplicate ID")
        ids.add(case_id)
        case_tags = case.get("tags")
        if not isinstance(case_tags, list) or not all(isinstance(t, str) for t in case_tags):
            errors.append(f"{case_id}: tags must be strings")
            continue
        tags.update(case_tags)
        if case.get("provenance") not in EXPECTED_PROVENANCE:
            errors.append(f"{case_id}: missing/invalid provenance")
        if case.get("split") != "development":
            errors.append(f"{case_id}: Stage 0 scenarios cannot be claimed as untouched holdout")
        if case.get("application_test_status") != "not_run":
            errors.append(f"{case_id}: application behavior has not been tested")
        supplied, expected = case.get("input"), case.get("expected")
        if not isinstance(supplied, dict) or not isinstance(expected, dict) or not expected:
            errors.append(f"{case_id}: input/expected objects required")
            continue
        if expected.get("calendar_writes", 0) > 0 and supplied.get("explicit_approval") is not True:
            errors.append(f"{case_id}: write expectation lacks explicit target approval")
        if "source_health" in case_tags and expected.get("run_outcome") in {"blocked", "failed", "partial", "rate_limited"}:
            if expected.get("success_empty") is not False:
                errors.append(f"{case_id}: failed access cannot be successful empty collection")
        if case.get("provenance") == "live_reference":
            live.append(case_id)
            url = urlparse(supplied.get("source_url", ""))
            if url.scheme != "https" or url.hostname != "calendar.fsu.edu":
                errors.append(f"{case_id}: expected exact official live reference host")
            if supplied.get("asset_kind") != "live_reference" or not supplied.get("verified_on"):
                errors.append(f"{case_id}: live source verification metadata required")
            evidence = supplied.get("evidence_file", "")
            path = (repo / evidence).resolve()
            if not evidence or not path.is_relative_to(repo.resolve()):
                errors.append(f"{case_id}: unsafe/missing evidence path")
            elif check_evidence and not path.is_file():
                errors.append(f"{case_id}: missing actual saved probe evidence: {evidence}")
            elif check_evidence:
                try:
                    saved = json.loads(path.read_text())
                    probe = saved["probe"]
                    if saved.get("evidence_class") != "live-public-read-only-probe" or saved.get("source_url") != supplied["source_url"]:
                        errors.append(f"{case_id}: reference is not the saved live source probe")
                    if probe.get("outcome") != "parsed" or probe.get("occurrence_claim") != {"start": expected["occurrence_start"], "end": expected["occurrence_end"]}:
                        errors.append(f"{case_id}: actual occurrence evidence disagrees with fixture label")
                    if not any("March 4th" in excerpt for excerpt in probe.get("compact_excerpts", [])):
                        errors.append(f"{case_id}: actual ticket-reference discrepancy missing")
                    if any(probe.get(key, "missing") is not None for key in ("ticket_milestone", "original_publication_time", "historical_alert_timeliness")):
                        errors.append(f"{case_id}: live probe must preserve unknown ticket/publication/timeliness")
                    if not any(request.get("http_status") == 200 and request.get("method") == "GET" and re.fullmatch(r"[0-9a-f]{64}", request.get("body_sha256", "")) for request in saved.get("requests", [])):
                        errors.append(f"{case_id}: missing successful hashed read-only request evidence")
                except (OSError, ValueError, KeyError, TypeError) as exc:
                    errors.append(f"{case_id}: invalid saved evidence: {exc}")
        elif "image_only" in case_tags or "all_carousel_slides" in case_tags:
            if not supplied.get("asset_kind", "").startswith("synthetic_image_description"):
                errors.append(f"{case_id}: synthetic image description must not masquerade as an image asset")
        if "dst_gap" in case_tags or "dst_fold" in case_tags:
            try:
                actual = valid_instants(supplied["local"], supplied["timezone"])
                if actual != expected["valid_instants"]:
                    errors.append(f"{case_id}: incorrect hand-labeled DST instants: {actual}")
            except (KeyError, ValueError) as exc:
                errors.append(f"{case_id}: invalid time fixture: {exc}")
        if case_id == "weekly_recurrence_exception":
            expected_utc = []
            for local in supplied["local_instances"]:
                if local not in supplied["cancelled_local_instances"]:
                    expected_utc.extend(valid_instants(local, supplied["timezone"]))
            if expected_utc != expected["utc_instances"] or len(expected_utc) != expected["occurrences"]:
                errors.append(f"{case_id}: recurrence/DST/exception label mismatch")
        if "all_carousel_slides" in case_tags and "media" in supplied:
            if [slide["slide"] for slide in supplied["media"]] != expected.get("media_processed"):
                errors.append(f"{case_id}: expectation skips a supplied carousel slide")
    missing = REQUIRED_TAGS - tags
    if missing:
        errors.append("missing required scenarios: " + ", ".join(sorted(missing)))
    if live != ["matpat_live_date_conflict"]:
        errors.append("only the separately evidenced MatPat reference may be live")
    matpat = next((c for c in cases if c.get("id") == "matpat_live_date_conflict"), {})
    expected = matpat.get("expected", {})
    if expected.get("ticket_release_at", "missing") is not None or expected.get("first_announced_at", "missing") is not None or expected.get("historical_timeliness_proven") is not False:
        errors.append("MatPat must preserve unknown release/publication and make no historical timeliness claim")
    return errors


def mutation_checks(data):
    """Prove critical checks reject a falsely successful or unsafe corpus label."""
    mutations = []
    changed = copy.deepcopy(data)
    changed["cases"][0]["application_test_status"] = "passed"
    mutations.append((changed, "unrun app marked passed"))
    changed = copy.deepcopy(data)
    next(c for c in changed["cases"] if c["id"] == "save_is_not_approval")["expected"]["calendar_writes"] = 1
    mutations.append((changed, "save grants calendar permission"))
    changed = copy.deepcopy(data)
    next(c for c in changed["cases"] if c["id"] == "http_200_login_wall")["expected"]["success_empty"] = True
    mutations.append((changed, "login wall shown as empty success"))
    changed = copy.deepcopy(data)
    next(c for c in changed["cases"] if c["id"] == "dst_ambiguous_local_time")["expected"]["valid_instants"] = ["2026-11-01T05:30:00+00:00"]
    mutations.append((changed, "ambiguous DST fold silently resolved"))
    changed = copy.deepcopy(data)
    next(c for c in changed["cases"] if c["id"] == "matpat_live_date_conflict")["expected"]["ticket_release_at"] = "2026-03-04T12:00:00-05:00"
    mutations.append((changed, "MatPat ticket time invented"))
    changed = copy.deepcopy(data)
    next(c for c in changed["cases"] if c["id"] == "all_carousel_slides")["expected"]["media_processed"] = [0]
    mutations.append((changed, "only first carousel slide processed"))
    for changed, label in mutations:
        if not validate(changed, check_evidence=False):
            raise AssertionError(f"validator failed to reject: {label}")
    return len(mutations)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=Path(__file__).with_name("cases.json"))
    args = parser.parse_args()
    data = json.loads(args.cases.read_text())
    errors = validate(data)
    if errors:
        for error in errors:
            print("FAIL:", error)
        return 1
    count = mutation_checks(data)
    provenance = Counter(case["provenance"] for case in data["cases"])
    print(f"PASS: {len(data['cases'])} scenario contracts; provenance={dict(provenance)}; {count} rejection checks")
    print("PASS: DST gap/fold, recurrence exception, all-slide and evidence-reference labels")
    print("NOT RUN: application extraction, model accuracy, live calendar/delivery, database/RLS/outbox behavior")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
