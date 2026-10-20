#!/usr/bin/env python3
"""Bounded Stage 0 public GET probes. No credentials, writes, purchases or calendar calls.

Evidence is live metadata + compact excerpts, never a production ingestion claim.
Exit 2 means at least one blocked/partial/error probe, not an empty successful run.
"""
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

API = "https://calendar.fsu.edu/api/2/events"
MATPAT = "https://calendar.fsu.edu/event/golden-torch-lecture-series-presents-an-evening-with-matpat"
SOURCE_URLS = {
    "fsu-hq-public-calendar": "https://calendar.fsu.edu/department/fsu-hq",
    "fsu-hq-events": "https://hq.fsu.edu/events",
    "fsu-music-events": "https://music.fsu.edu/events/",
    "fsu-tickets": "https://tickets.fsu.edu/",
    "fsu-hello-weekly": "https://hello.fsu.edu/weekly-top-5",
    "fsu-matpat-conflict": MATPAT,
    "fsu-onf-dates": "https://onf.fsu.edu/important-dates",
}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(value).hexdigest()


def minimized_link(link):
    """Preserve public destination evidence without email-security wrapper metadata."""
    url = link["url"]
    parts = urllib.parse.urlsplit(url)
    if (parts.hostname or "").endswith("safelinks.protection.outlook.com"):
        target = urllib.parse.parse_qs(parts.query).get("url", [None])[0]
        if target and urllib.parse.urlsplit(target).scheme == "https":
            url = target
    return {"url": url, "text": link["text"].strip()[:80]}


def minimized_dated_item(text, links):
    label, separator, rest = text.partition(": ")
    if not separator:
        label, rest = text[:80], ""
    title = rest.partition(": ")[0].partition(" | ")[0].strip()
    return {"date_label": label[:80], "program_title": title[:120],
            "observed_links": [minimized_link(link) for link in links[:2]]}


def allowed_url(url):
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    action_query = any(x in parts.query.lower() for x in ("dowork", "createbo", "checkout", "addtocart"))
    # Observed 2026-10-20 as the public HQ ICS's HTTP302 destination; no blanket vendor-host permission.
    hq_export = (host == "static-prod-us-east-1.campusgroups.com" and
                 parts.path == "/ical/floridastate/ical_floridastate.ics" and not parts.query)
    return (not action_query and parts.scheme == "https" and (host == "fsu.edu" or host.endswith(".fsu.edu") or hq_export)
            and parts.port in (None, 443) and not parts.username and not parts.password)


class PublicRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise ValueError("redirect outside approved public FSU HTTPS hosts")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Page(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.links, self.texts, self.dates, self.jsonld = url, [], [], [], []
        self._hidden, self._json, self._json_parts, self._anchor = 0, False, [], None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href"):
            self._anchor = {"url": urllib.parse.urljoin(self.url, attrs["href"]), "text": ""}
            self.links.append(self._anchor)
        if tag == "time":
            self.dates.append(attrs.get("datetime"))
        if tag in ("script", "style"):
            self._hidden += 1
            self._json = tag == "script" and attrs.get("type", "").lower() == "application/ld+json"
            self._json_parts = []

    def handle_endtag(self, tag):
        if tag == "a":
            self._anchor = None
        if tag in ("script", "style"):
            if self._json:
                try:
                    self.jsonld.append(json.loads("".join(self._json_parts)))
                except ValueError:
                    pass
            self._hidden = max(0, self._hidden - 1)
            self._json = False

    def handle_data(self, data):
        if self._json:
            self._json_parts.append(data)
        if not self._hidden:
            self.texts.append(data)
            if self._anchor is not None:
                self._anchor["text"] += data

    @property
    def text(self):
        return re.sub(r"\s+", " ", " ".join(self.texts)).strip()


def html_page(body, url):
    page = Page(url)
    page.feed(body.decode("utf-8", errors="replace"))
    return page


def canonical_event_links(page):
    selected = {}
    score = lambda link: 2 if link["text"].strip() and "Sign in" not in link["text"] else 0
    for link in page.links:
        parts = urllib.parse.urlsplit(link["url"])
        if (parts.hostname == "calendar.fsu.edu" and parts.path.startswith("/event/")
                and "/confirm" not in parts.path and parts.path.rstrip("/") != "/event/create"):
            if link["url"] not in selected or score(link) > score(selected[link["url"]]):
                selected[link["url"]] = {"url": link["url"], "text": link["text"].strip()}
    return list(selected.values())


def classify_html(page):
    """Login links alone are common on public pages and must not cause false walls."""
    text = page.text.lower()
    if re.search(r"\[(?:eventName|eventDates|eventUrlTitle)\]", page.text):
        return "dynamic_shell", "unrendered event template; event payload not collected"
    wall = ("you must sign in", "please sign in to continue", "login required", "sign in to continue",
            "access denied", "verify you are human", "just a moment...", "service unavailable")
    if any(phrase in text for phrase in wall):
        return "blocked", "login/access/error page returned instead of event data"
    if len(text) < 80:
        return "partial", "unexpectedly little visible HTML text"
    return "reachable", "HTML page reachable; record extraction must be checked separately"


def decode_localist(body):
    data = json.loads(body)
    if not isinstance(data, dict) or not isinstance(data.get("events"), list):
        raise ValueError("Localist events array missing; not successful empty")
    page = data.get("page")
    if not isinstance(page, dict) or any(k not in page for k in ("current", "total", "total_items", "next_page")):
        raise ValueError("pagination metadata missing; cannot prove terminal page")
    records = []
    for wrapped in data["events"]:
        event = wrapped.get("event") if isinstance(wrapped, dict) else None
        if not isinstance(event, dict) or event.get("id") is None or not isinstance(event.get("event_instances"), list):
            raise ValueError("event native ID or occurrence array missing")
        if any(not isinstance(x, dict) or not isinstance(x.get("event_instance"), dict) or x["event_instance"].get("id") is None
               for x in event["event_instances"]):
            raise ValueError("occurrence native ID missing")
        records.append(event)
    return data, records


def stable_event(event):
    """Exclude counters; changed attendance/detail_views must not imply changed facts."""
    keys = ("id", "title", "url", "localist_url", "updated_at", "created_at", "first_date", "last_date",
            "recurring", "status", "location", "location_name", "room_number", "description_text",
            "ticket_url", "ticket_cost", "free", "private", "event_instances")
    result = {key: event.get(key) for key in keys}
    result["event_instances"] = [
        {key: wrapped["event_instance"].get(key) for key in ("id", "event_id", "start", "end", "all_day")}
        for wrapped in event.get("event_instances", [])]
    return result


def row_identity(event):
    return str(event["id"]) + ":" + ",".join(str(x["event_instance"]["id"]) for x in event["event_instances"])


def parse_feed(body):
    root = ET.fromstring(body)
    if root.tag == "rss":
        return [{"guid": x.findtext("guid"), "url": x.findtext("link"), "published_at": x.findtext("pubDate")}
                for x in root.findall("./channel/item")]
    if root.tag == "{http://www.w3.org/2005/Atom}feed":
        namespace = {"a": "http://www.w3.org/2005/Atom"}
        records = []
        for entry in root.findall("a:entry", namespace):
            link = entry.find("a:link[@rel='alternate']", namespace)
            if link is None:
                link = entry.find("a:link", namespace)
            records.append({"guid": entry.findtext("a:id", namespaces=namespace),
                            "url": link.get("href") if link is not None else None,
                            "published_at": entry.findtext("a:published", namespaces=namespace) or entry.findtext("a:updated", namespaces=namespace)})
        return records
    raise ValueError("not RSS/Atom; HTTP200 is insufficient")


def parse_ics(body):
    text = body.decode("utf-8-sig", errors="replace").replace("\r\n", "\n")
    text = re.sub(r"\n[ \t]", "", text)
    if not text.lstrip().startswith("BEGIN:VCALENDAR") or "END:VCALENDAR" not in text:
        raise ValueError("not a complete VCALENDAR; HTTP200 is insufficient")
    events = re.findall(r"^BEGIN:VEVENT\s*$(.*?)^END:VEVENT\s*$", text, re.S | re.M)
    if len(events) != len(re.findall(r"^BEGIN:VEVENT\s*$", text, re.M)):
        raise ValueError("incomplete VEVENT components")
    values = lambda key: re.findall(r"^" + key + r"(?:;[^:]*)?:(.+)$", text, re.M)
    uids, starts = values("UID"), values("DTSTART")
    if len(uids) != len(events) or len(starts) != len(events):
        raise ValueError("VEVENT native UID or DTSTART missing; not successful empty")
    return {"event_records_extracted": len(events), "unique_uids": len(set(uids)),
            "duplicate_uid_components": len(uids) - len(set(uids)), "uid_samples": uids[:3],
            "start_samples": starts[:3], "earliest_dtstart": min(starts) if starts else None,
            "latest_dtstart": max(starts) if starts else None,
            "recurrence_rule_count": len(values("RRULE")),
            "field_presence_counts": {key: len(values(key)) for key in ("DTEND", "SEQUENCE", "LAST-MODIFIED", "DTSTAMP", "STATUS", "RECURRENCE-ID")},
            "status_values": sorted(set(values("STATUS"))),
            "latest_dtstamp_or_modified": max(values("DTSTAMP") + values("LAST-MODIFIED"), default=None)}


def pagination_problem(metadata, requested_page, expected_total, cumulative_rows, page_rows):
    if metadata.get("current") != requested_page:
        return "server current page differs from requested page"
    total = metadata.get("total_items")
    pages = metadata.get("total")
    if not isinstance(total, int) or total < 0 or not isinstance(pages, int) or pages < 0:
        return "invalid pagination totals"
    if expected_total is not None and total != expected_total:
        return "total_items changed during pagination; retry a stable overlapping window"
    if page_rows == 0 and cumulative_rows < total:
        return "empty page before declared total_items captured"
    if cumulative_rows > total:
        return "more rows returned than declared total_items"
    if metadata.get("next_page") is None and cumulative_rows != total:
        return "terminal page truncates declared total_items"
    if metadata.get("next_page") is None and total and requested_page != pages:
        return "terminal current page differs from total pages"
    return None


def add_months(date, months):
    year, month = divmod(date.year * 12 + date.month - 1 + months, 12)
    return dt.date(year, month + 1, min(date.day, calendar.monthrange(year, month + 1)[1]))


class Runner:
    def __init__(self, max_requests=100, timeout=25, max_bytes=3 * 1024 * 1024):
        self.max_requests, self.timeout, self.max_bytes = max_requests, timeout, max_bytes
        self.requests, self.probes, self.events = [], [], {}
        self.occurrences_by_event = {}
        self.opener = urllib.request.build_opener(PublicRedirects())

    def fetch(self, url, probe_id):
        record = {"request_id": f"request-{len(self.requests) + 1:03d}", "probe_id": probe_id,
                  "url": url, "method": "GET", "started_at": now(), "transport": "python-stdlib-urllib"}
        self.requests.append(record)
        if len(self.requests) > self.max_requests:
            record.update(outcome="budget_exhausted", error="maximum request budget reached")
            return record, None
        if not allowed_url(url):
            record.update(outcome="blocked_url", error="outside approved public FSU HTTPS hosts")
            return record, None
        started = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "FSUOpportunityTracker/0.0-stage0 (bounded public source verification)",
                                                      "Accept": "application/json,text/calendar,application/rss+xml,text/html;q=0.9,*/*;q=0.2"})
            with self.opener.open(req, timeout=self.timeout) as response:
                record.update(http_status=response.status, final_url=response.url,
                              content_type=response.headers.get("Content-Type"),
                              etag=response.headers.get("ETag"), last_modified=response.headers.get("Last-Modified"),
                              retry_after=response.headers.get("Retry-After"))
                body = response.read(self.max_bytes + 1)
            record.update(bytes=len(body), body_sha256=digest(body))
            if len(body) > self.max_bytes:
                record.update(outcome="oversize", error="body exceeded bounded response size; not parsed")
                return record, None
            record["outcome"] = "fetched"
            return record, body
        except urllib.error.HTTPError as exc:
            record.update(outcome="blocked" if exc.code in (401, 403, 429) else "http_error",
                          http_status=exc.code, error=str(exc), retry_after=exc.headers.get("Retry-After"))
            return record, None
        except (OSError, ValueError) as exc:
            record.update(outcome="transport_error", error=str(exc))
            return record, None
        finally:
            record.update(finished_at=now(), elapsed_seconds=round(time.monotonic() - started, 3))
            time.sleep(0.15)

    def api(self, probe_id, **params):
        url = API + "?" + urllib.parse.urlencode(params)
        record, body = self.fetch(url, probe_id)
        if body is None:
            return record, None, []
        try:
            data, events = decode_localist(body)
            record.update(outcome="parsed", event_count=len(events), pagination=data["page"], api_date=data.get("date"),
                          event_ids=[e["id"] for e in events], occurrence_ids=[
                              x["event_instance"]["id"] for e in events for x in e["event_instances"]])
            for event in events:
                self.events[str(event["id"])] = event
                instances = self.occurrences_by_event.setdefault(str(event["id"]), {})
                for wrapped in event["event_instances"]:
                    item = wrapped["event_instance"]
                    instances[str(item["id"])] = {key: item.get(key) for key in ("id", "event_id", "start", "end", "all_day")}
            return record, data, events
        except (ValueError, TypeError, KeyError) as exc:
            record.update(outcome="parse_error", error=str(exc))
            return record, None, []

    def window(self, probe_id, start, days):
        rows, page_number, seen_pages, request_ids = [], 1, set(), []
        complete, reason, expected_total = False, "not fetched", None
        while len(self.requests) < self.max_requests:
            record, data, events = self.api(probe_id, start=str(start), days=days, pp=100, page=page_number)
            request_ids.append(record["request_id"])
            if data is None:
                reason = record["outcome"]
                break
            metadata = data["page"]
            problem = pagination_problem(metadata, page_number, expected_total, len(rows) + len(events), len(events))
            if problem:
                reason = problem
                break
            expected_total = metadata["total_items"]
            signature = digest([row_identity(e) for e in events])
            if signature in seen_pages and events:
                reason = "pagination repeated a previously seen page"
                break
            seen_pages.add(signature)
            rows.extend(events)
            next_page = metadata["next_page"]
            if next_page is None:
                complete = True
                reason = "server next_page null at terminal page"
                break
            if not isinstance(next_page, int) or next_page <= page_number:
                reason = "invalid/nonadvancing next_page"
                break
            page_number = next_page
        starts = [x["event_instance"].get("start") for e in rows for x in e["event_instances"]]
        starts = [s for s in starts if s]
        boundary = start + dt.timedelta(days=days)
        outside = [s for s in starts if not (str(start) <= s[:10] < str(boundary))]
        result = {"probe_id": probe_id, "source_id": "fsu-calendar-api", "start_inclusive": str(start),
                  "end_requested_exclusive": str(boundary), "days": days, "request_ids": request_ids,
                  "outcome": "parsed" if complete else "partial", "pagination_complete": complete,
                  "terminal_reason": reason, "pages": len(request_ids), "event_rows": len(rows),
                  "server_total_items": expected_total,
                  "distinct_event_ids": len({e["id"] for e in rows}),
                  "distinct_occurrence_ids": len({x["event_instance"]["id"] for e in rows for x in e["event_instances"]}),
                  "earliest_returned_start": min(starts) if starts else None,
                  "latest_returned_start": max(starts) if starts else None,
                  "out_of_requested_half_open_window": len(outside),
                  "boundary_note": "Localist days may include boundary dates; retain IDs, overlap and filter normalized instances in ingestion"}
        if complete and result["distinct_occurrence_ids"] != expected_total:
            result.update(outcome="partial", pagination_complete=False,
                          terminal_reason="distinct occurrence IDs do not equal declared total_items; duplicate/truncated data")
        self.probes.append(result)
        return rows, result

    def calendar(self, start, months):
        rows, weekly = self.window("calendar-seven-day-pagination", start, 7)
        # Explicitly observe the server response after the reported terminal page.
        if weekly["pagination_complete"]:
            r, data, _ = self.api("calendar-after-terminal", start=str(start), days=7, pp=100, page=weekly["pages"] + 1)
            self.probes.append({"probe_id": "calendar-after-terminal", "source_id": "fsu-calendar-api",
                                "request_ids": [r["request_id"]], "outcome": "parsed" if data else "partial",
                                "returned_event_count": r.get("event_count"), "pagination": r.get("pagination")})
        for index in range(months):
            left, right = add_months(start, index), add_months(start, index + 1)
            self.window(f"calendar-month-{index + 1:02d}", left, (right - left).days)
        if rows:
            # Replay the identical request, compare matching IDs and stable content hashes.
            r, _, again = self.api("calendar-replay", start=str(start), days=7, pp=100, page=1)
            first = {row_identity(e): e for e in rows[:100]}
            second = {row_identity(e): e for e in again}
            shared = sorted(first.keys() & second.keys())
            changed = [key for key in shared if digest(stable_event(first[key])) != digest(stable_event(second[key]))]
            self.probes.append({"probe_id": "calendar-replay", "source_id": "fsu-calendar-api",
                                "request_ids": [r["request_id"]], "outcome": "parsed" if again else "partial",
                                "same_page_event_ids": set(first) == set(second), "matched_events": len(shared),
                                "changed_stable_content_ids": changed,
                                "interpretation": "read-only repeat observes identity/hash stability only; upstream edit propagation/deletions remain untested"})
        recurrent = [e for e in self.events.values() if e.get("recurring")]
        multi = [e for e in recurrent if len(self.occurrences_by_event[str(e["id"])]) > 1]
        examples = sorted(multi or recurrent, key=lambda e: str(e["id"]))[:2]
        self.probes.append({"probe_id": "calendar-native-id-recurrence", "source_id": "fsu-calendar-api",
                            "outcome": "parsed" if self.events else "partial",
                            "distinct_events_seen": len(self.events), "recurring_events_seen": len(recurrent),
                            "multi_instance_events_in_response": len(multi),
                            "examples": [{"id": e["id"], "localist_url": e.get("localist_url"),
                                          "created_at": e.get("created_at"), "updated_at": e.get("updated_at"),
                                          "recurring": e.get("recurring"),
                                          "event_instances": list(self.occurrences_by_event[str(e["id"])].values())[:3],
                                          "distinct_instances_across_captures": len(self.occurrences_by_event[str(e["id"])]),
                                          "stable_content_sha256": digest(stable_event(e))} for e in examples],
                            "not_verified": ["recurrence exception/cancellation semantics", "forced upstream edit propagation", "unpublished events"]})

    def page_source(self, source_id):
        record, body = self.fetch(SOURCE_URLS[source_id], source_id)
        probe = {"probe_id": source_id, "source_id": source_id, "request_ids": [record["request_id"]]}
        self.probes.append(probe)
        if body is None:
            probe.update(outcome=record["outcome"], event_records_extracted=0,
                         empty_result_is_success=False)
            return
        page = html_page(body, record["final_url"])
        state, reason = classify_html(page)
        probe.update(outcome=state, classification=reason, visible_text_characters=len(page.text),
                     event_records_extracted=0, empty_result_is_success=False)
        if source_id == "fsu-hq-events":
            # This exact URL must first be observed in the public page; never invent a feed route.
            observed = re.findall(r"https://hq\.fsu\.edu/ical/[^\s\"'<>]+\.ics", body.decode(errors="replace"))
            probe.update(observed_subscription_links=[x for x in page.links if "ics_helper" in x["url"] or "calendar_sync" in x["url"]],
                         observed_public_ics_urls=sorted(set(observed)))
            for url in sorted(set(observed))[:1]:
                self.ics(url, "fsu-hq-public-export", source_id)
        elif source_id == "fsu-hq-public-calendar":
            links = canonical_event_links(page)
            dates = re.findall(r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2} [^']{0,45}?(?:EDT|EST)", page.text)
            probe.update(outcome="parsed" if links else state, event_records_extracted=len(links),
                         event_link_samples=links[:3], date_samples=dates[:3],
                         limitation="public HQ department preview only; no evidence of complete HQ mirror or location access")
        elif source_id == "fsu-music-events":
            selected = {}
            for link in page.links:
                if urllib.parse.urlsplit(link["url"]).path.startswith("/event/") and link["text"].strip() != "More details":
                    selected.setdefault(link["url"], link)
            records = []
            for url, link in selected.items():
                title = link["text"].strip()
                index = page.text.find(title)
                date_match = re.search(r"[A-Z][a-z]+ \d{1,2}, 20\d\d \d{1,2}:\d\d [ap]m", page.text[index + len(title):index + len(title) + 120]) if index >= 0 else None
                if date_match:
                    records.append({"title": title, "url": url, "date_text": date_match.group(0),
                                    "timezone": None, "end": None})
            probe.update(outcome="parsed" if records else "partial", event_records_extracted=len(records),
                         event_samples=records[:2],
                         limitation="current homepage event preview only; full calendar pagination and detail-date consistency untested; timezone/end not assumed")
            if records:
                r, detail = self.fetch(records[0]["url"], "music-observed-detail")
                item = {"probe_id": "music-observed-detail", "source_id": source_id, "request_ids": [r["request_id"]], "outcome": r["outcome"]}
                self.probes.append(item)
                if detail:
                    p = html_page(detail, r["final_url"])
                    item.update(outcome=classify_html(p)[0], dates_in_time_elements=p.dates,
                                observed_ticket_links=[x for x in p.links if "tickets." in x["url"]][:2],
                                limitation="detail reachability only; no RSVP or ticket action")
        elif source_id == "fsu-tickets":
            links = [x for x in page.links if urllib.parse.urlsplit(x["url"]).path.startswith("/online/article/")]
            probe.update(observed_information_links=links[:2], limitation="guest ticket shell only; no ticket availability extracted")
            for link in links[:1]:
                r, detail = self.fetch(link["url"], "ticket-observed-information-page")
                item = {"probe_id": "ticket-observed-information-page", "source_id": source_id,
                        "request_ids": [r["request_id"]], "outcome": r["outcome"], "ticket_status": None, "on_sale_at": None}
                self.probes.append(item)
                if detail:
                    p = html_page(detail, r["final_url"])
                    item.update(outcome=classify_html(p)[0], visible_text_characters=len(p.text),
                                event_date_tokens=re.findall(r"(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}(?:, 20\d\d)?", p.text)[:3],
                                limitation="observed Golden Torch information page; tokens alone are not verified ticket milestones")
        elif source_id == "fsu-hello-weekly":
            links = list({x["url"]: x for x in page.links if "/event/" in x["url"]}.values())
            feeds = [x["url"] for x in page.links if x["url"].endswith("/feed")]
            probe.update(outcome="parsed" if links else state, announcement_links_found=len(links),
                         event_link_samples=links[:2], observed_feed_urls=feeds,
                         freshness_status="unconfirmed-current; visible leading archive items refer to spring/May despite October verification",
                         limitation="archive intake only; current publication freshness and inbound email delivery not proved")
            if feeds:
                self.rss(feeds[0], "hello-observed-rss", source_id)
            if links:
                r, item_body = self.fetch(links[0]["url"], "hello-observed-item")
                if item_body:
                    p = html_page(item_body, r["final_url"])
                    dates = re.findall(r"\b(?:20\d\d-\d\d-\d\d|May \d{1,2}|July \d{1,2})\b", p.text)
                    self.probes.append({"probe_id": "hello-observed-item", "source_id": source_id,
                                        "request_ids": [r["request_id"]], "outcome": classify_html(p)[0],
                                        "observed_date_tokens": sorted(set(dates))[:8],
                                        "publication_dates": p.dates,
                                        "fact_policy": "missing year and relative dates stay unresolved; archived text is not a current alert"})
        elif source_id == "fsu-onf-dates":
            # Extract observed HTML list items, preserving uncertain date/year/time text.
            fragments = re.findall(r"<(?:li|p)\b[^>]*>(.*?)</(?:li|p)>", body.decode(errors="replace"), re.S | re.I)
            samples = []
            for fragment in fragments:
                item = html_page(fragment.encode(), record["final_url"])
                if re.search(r"(?:November \d|Oct\. 22|Mid-October|End of October)", item.text):
                    samples.append(minimized_dated_item(item.text, item.links))
            probe.update(outcome="parsed" if samples else "partial", dated_items_extracted=len(samples),
                         date_context="2026-2027 fellowship deadlines / presentation-workshop dates" if "2026-2027" in page.text else None,
                         dated_item_samples=samples[:3] + samples[-1:],
                         limitation="date-bearing producer evidence; TBA/missing time and misleading EST labels require field-level review; no application or registration actions executed")
        elif source_id == "fsu-matpat-conflict":
            # Keep under 25 quoted words; structured parsed dates are separate claims.
            date_text = re.search(r"Tuesday, September 29, 2026 8:00pm to 9:00pm EDT", page.text)
            ticket_text = re.search(r"Wednesday, March 4th", page.text)
            probe.update(outcome="parsed" if date_text and ticket_text else "partial",
                         occurrence_claim={"start": "2026-09-29T20:00:00-04:00", "end": "2026-09-29T21:00:00-04:00"} if date_text else None,
                         compact_excerpts=[m.group(0) for m in (date_text, ticket_text) if m],
                         event_native_id=54104506971068 if "54104506971068" in body.decode() else None,
                         occurrence_native_id=54104506972094 if "54104506972094" in body.decode() else None,
                         conflict="description ticket-like March 4 reference conflicts with September occurrence context; year/action unspecified",
                         ticket_milestone=None, original_publication_time=None, historical_alert_timeliness=None,
                         policy="human verification; never infer on-sale date or historical capture from this archived page")
            self.ics(MATPAT + ".ics", "matpat-observed-ics", source_id)
        else:
            event_links = [x for x in page.links if re.search(r"event|performance|concert", x["url"], re.I)]
            probe["candidate_event_links"] = event_links[:3]
            probe["limitation"] = "reachable pages alone are not operational event ingestion"

    def ics(self, url, probe_id, source_id):
        record, body = self.fetch(url, probe_id)
        probe = {"probe_id": probe_id, "source_id": source_id, "request_ids": [record["request_id"]]}
        self.probes.append(probe)
        if body is None:
            probe.update(outcome=record["outcome"], empty_result_is_success=False)
            return
        try:
            result = parse_ics(body)
        except ValueError as exc:
            probe.update(outcome="parse_error", reason=str(exc), empty_result_is_success=False)
            return
        probe.update(outcome="parsed" if result["event_records_extracted"] else "partial", **result,
                     limitation="successful export of observed URL only; scope, private events, truncation, freshness, and completeness not established")
        if source_id == "fsu-hq-events":
            r, again = self.fetch(url, "hq-public-export-replay")
            probe["replay_request_ids"] = [r["request_id"]]
            if again is not None:
                try:
                    probe["replay"] = {"outcome": "parsed", "same_body_sha256": digest(body) == digest(again),
                                       "event_records_extracted": parse_ics(again)["event_records_extracted"],
                                       "interpretation": "unchanged replay only; forced upstream edits not tested"}
                except ValueError as exc:
                    probe["replay"] = {"outcome": "parse_error", "error": str(exc)}
            else:
                probe["replay"] = {"outcome": r["outcome"]}

    def rss(self, url, probe_id, source_id):
        record, body = self.fetch(url, probe_id)
        probe = {"probe_id": probe_id, "source_id": source_id, "request_ids": [record["request_id"]]}
        self.probes.append(probe)
        if body is None:
            probe.update(outcome=record["outcome"], empty_result_is_success=False)
            return
        try:
            items = parse_feed(body)
            probe.update(outcome="parsed", announcement_records_extracted=len(items),
                         items=items[:3],
                         freshness_status="archive-only; latest sampled publication is 2023" if items and "2023" in str(items[0].get("published_at")) else "not evaluated",
                         limitation="bounded RSS archive; newsletter receiving/webhook and flyer OCR not configured")
        except (ET.ParseError, ValueError) as exc:
            probe.update(outcome="parse_error", error=str(exc), empty_result_is_success=False)

    def event_ticket(self):
        candidates = [e for e in self.events.values() if e.get("ticket_url") and allowed_url(e["ticket_url"])]
        # Distinct official event-specific URLs first, no guessed ticket route.
        candidates.sort(key=lambda e: ("default.asp" in e["ticket_url"].lower(), str(e["id"])))
        for event in candidates[:2]:
            r, body = self.fetch(event["ticket_url"], "calendar-observed-ticket-link")
            probe = {"probe_id": "calendar-observed-ticket-link", "source_id": "fsu-tickets",
                     "request_ids": [r["request_id"]], "discovered_from": event.get("localist_url"),
                     "event_native_id": event["id"], "ticket_url": event["ticket_url"],
                     "outcome": r["outcome"], "ticket_status": None, "on_sale_at": None}
            self.probes.append(probe)
            if body:
                page = html_page(body, r["final_url"])
                state, reason = classify_html(page)
                probe.update(outcome=state, classification=reason, visible_text_characters=len(page.text),
                             status_tokens=sorted(set(re.findall(r"\b(?:sold out|waitlist|on sale|buy tickets|register)\b", page.text.lower()))),
                             limitation="tokens/page reachability do not prove ticket availability or on-sale dates")
        if not candidates:
            self.probes.append({"probe_id": "calendar-observed-ticket-link", "source_id": "fsu-tickets",
                                "outcome": "not_observed", "reason": "no allowed FSU ticket URL observed in fetched event records"})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="reports/probes/latest.json")
    parser.add_argument("--start-date", type=dt.date.fromisoformat, default=dt.date(2026, 10, 20))
    parser.add_argument("--months", type=int, choices=range(1, 13), default=12)
    parser.add_argument("--only", action="append", choices=["fsu-calendar-api", *SOURCE_URLS], default=[])
    parser.add_argument("--max-requests", type=int, default=100)
    parser.add_argument("--timeout", type=int, default=25)
    parser.add_argument("--max-bytes", type=int, default=3 * 1024 * 1024)
    args = parser.parse_args(argv)
    if not (1 <= args.max_requests <= 100 and 1 <= args.timeout <= 30 and 1024 <= args.max_bytes <= 3 * 1024 * 1024):
        parser.error("caps: 1..100 requests, 1..30 seconds, 1KiB..3MiB per response")
    runner = Runner(args.max_requests, args.timeout, args.max_bytes)
    began = now()
    selected = args.only or ["fsu-calendar-api", *SOURCE_URLS]
    if "fsu-calendar-api" in selected:
        runner.calendar(args.start_date, args.months)
    for source_id in SOURCE_URLS:
        if source_id in selected:
            runner.page_source(source_id)
    if "fsu-tickets" in selected:
        runner.event_ticket()
    failures = [p["probe_id"] for p in runner.probes if p["outcome"] in
                ("blocked", "partial", "parse_error", "transport_error", "http_error", "dynamic_shell", "oversize", "budget_exhausted")]
    report = {"schema_version": 1, "stage": 0, "evidence_class": "live-public-read-only-probe",
              "started_at": began, "finished_at": now(), "command": ["python3", "scripts/probe_sources.py", *sys.argv[1:]],
              "script_sha256": digest(Path(__file__).read_bytes()),
              "policy": "no credentials; public FSU HTTPS GET and exact observed public HQ CDN ICS only; no actions; untrusted source data; no completeness claim",
              "bounds": {"max_requests": args.max_requests, "timeout_seconds": args.timeout, "max_response_bytes": args.max_bytes},
              "requests_attempted": len(runner.requests), "blocked_or_incomplete_probe_ids": failures,
              "requests": runner.requests, "probes": runner.probes,
              "exit_code": 2 if failures else 0}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    matpat = next((x for x in runner.probes if x["probe_id"] == "fsu-matpat-conflict"), None)
    if matpat:
        (output.parent / "matpat-conflict.json").write_text(json.dumps({
            "evidence_class": report["evidence_class"], "captured_at": report["finished_at"], "source_url": MATPAT,
            "probe": matpat, "requests": [x for x in runner.requests if x["request_id"] in matpat["request_ids"]]}, indent=2) + "\n")
    if runner.events:
        repeated = [key for key in runner.occurrences_by_event if len(runner.occurrences_by_event[key]) >= 2]
        samples = []
        if repeated:
            key = repeated[0]
            event = runner.events[key]
            for instance in list(runner.occurrences_by_event[key].values())[:2]:
                record = {field: event.get(field) for field in ("id", "title", "localist_url", "updated_at", "created_at", "recurring", "location", "location_name", "ticket_url")}
                record["event_instances"] = [{"event_instance": instance}]
                samples.append({"event": record})
        (output.parent / "parser-samples.json").write_text(json.dumps({
            "evidence_class": "live-public-field-projection", "synthetic": False, "lossless_response": False,
            "source_url": API, "report_path": str(output), "captured_at": report["finished_at"],
            "projection_note": "two observed occurrences of the same native event; selected public fields only; not original full HTTP body or fake API response; attendance/contact fields excluded",
            "observed_records": samples}, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"report": str(output), "requests": len(runner.requests), "probes": len(runner.probes),
                      "blocked_or_incomplete": failures, "exit_code": report["exit_code"]}, indent=2))
    return report["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
