"""Synthetic failure/structure tests; never evidence of live FSU collection."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("probe_sources", Path(__file__).resolve().parents[1] / "scripts/probe_sources.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def fixture():
    return {"events": [{"event": {"id": 123, "recurring": True, "title": "Synthetic recurrence",
             "event_instances": [{"event_instance": {"id": 456, "event_id": 123, "start": "2026-10-20T18:00:00-04:00"}}]}}],
            "page": {"current": 1, "total": 1, "total_items": 1, "next_page": None}}


class PublicProbeTests(unittest.TestCase):
    def test_login_wall_200_is_not_empty_success(self):
        page = p.html_page(b"<html><h1>Please sign in to continue</h1><form>FSUID login required</form></html>", "https://hq.fsu.edu/events")
        self.assertEqual(p.classify_html(page)[0], "blocked")

    def test_public_events_with_login_link_are_not_wall(self):
        page = p.html_page(b"<html><a href='/login'>Log in</a><h1>Public concerts</h1><p>October 20: concert, free to all visitors. Music and discussion welcome tonight at 8pm.</p></html>", "https://calendar.fsu.edu/")
        self.assertEqual(p.classify_html(page)[0], "reachable")

    def test_template_only_200_is_incomplete(self):
        page = p.html_page(b"<html>[eventName] [eventDates] [eventUrlTitle]</html>", "https://hq.fsu.edu/events")
        self.assertEqual(p.classify_html(page)[0], "dynamic_shell")

    def test_error_page_200_is_failure(self):
        page = p.html_page(b"<h1>Service unavailable</h1><p>Please try again later. This is a synthetic outage.</p>", "https://calendar.fsu.edu/")
        self.assertEqual(p.classify_html(page)[0], "blocked")

    def test_html_instead_of_json_fails(self):
        with self.assertRaises(ValueError):
            p.decode_localist(b"<html>Sign in</html>")

    def test_missing_pagination_fails(self):
        with self.assertRaises(ValueError):
            p.decode_localist(b'{"events":[]}')

    def test_missing_occurrence_id_fails(self):
        data = fixture()
        del data["events"][0]["event"]["event_instances"][0]["event_instance"]["id"]
        with self.assertRaises(ValueError):
            p.decode_localist(json.dumps(data))

    def test_null_occurrence_fails_without_aborting_other_sources(self):
        data = fixture()
        data["events"][0]["event"]["event_instances"] = [None]
        with self.assertRaises(ValueError):
            p.decode_localist(json.dumps(data))

    def test_atom_entries_are_not_silently_empty(self):
        body = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>synthetic-1</id><link href="https://hello.fsu.edu/event/synthetic"/><updated>2026-10-20T12:00:00Z</updated></entry></feed>'
        records = p.parse_feed(body)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["guid"], "synthetic-1")

    def test_rss_preserves_native_guid_and_date(self):
        records = p.parse_feed(b'<rss><channel><item><guid>synthetic-1</guid><link>https://hello.fsu.edu/event/synthetic</link><pubDate>Tue, 20 Oct 2026 12:00:00 +0000</pubDate></item></channel></rss>')
        self.assertEqual(records[0]["guid"], "synthetic-1")
        self.assertIn("2026", records[0]["published_at"])

    def test_nonfeed_html_cannot_be_successful_empty(self):
        with self.assertRaises(ValueError):
            p.parse_feed(b'<html><h1>Please sign in</h1></html>')

    def test_observed_export_allowlist_is_exact(self):
        self.assertTrue(p.allowed_url("https://static-prod-us-east-1.campusgroups.com:443/ical/floridastate/ical_floridastate.ics"))
        self.assertFalse(p.allowed_url("https://static-prod-us-east-1.campusgroups.com/ical/other/private.ics"))
        self.assertFalse(p.allowed_url("https://static-prod-us-east-1.campusgroups.com/ical/floridastate/ical_floridastate.ics?token=private"))

    def test_ics_preserves_uid_separate_occurrence_and_date_range(self):
        body = b'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:synthetic-1\r\nDTSTART:20261020T120000Z\r\nDTEND:20261020T130000Z\r\nSTATUS:CONFIRMED\r\nSEQUENCE:2\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
        result = p.parse_ics(body)
        self.assertEqual(result["unique_uids"], 1)
        self.assertEqual(result["earliest_dtstart"], "20261020T120000Z")
        self.assertEqual(result["field_presence_counts"]["SEQUENCE"], 1)
        self.assertEqual(result["status_values"], ["CONFIRMED"])

    def test_ics_missing_uid_is_failure(self):
        with self.assertRaises(ValueError):
            p.parse_ics(b'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261020\nEND:VEVENT\nEND:VCALENDAR')

    def test_email_security_tracking_is_not_retained(self):
        sample = p.minimized_dated_item("Mid-October (TBA): Synthetic Scholarship: marketing description | More Info", [
            {"url": "https://nam04.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.example.test%2Fapply%2F&data=synthetic-email-metadata&sdata=tracking", "text": "More Info"}])
        self.assertEqual(sample["program_title"], "Synthetic Scholarship")
        self.assertEqual(sample["observed_links"][0]["url"], "https://www.example.test/apply/")
        self.assertNotIn("metadata", json.dumps(sample))

    def test_public_preview_links_exclude_navigation_shares_and_prefer_title(self):
        page = p.html_page(b'<a href="/event/synthetic"></a><a href="/event/synthetic">Synthetic concert</a><a href="/event/synthetic">Sign in to download the location</a><a href="/event/create">Submit</a><a href="https://example.test/?u=https://calendar.fsu.edu/event/synthetic">Share</a>', "https://calendar.fsu.edu/department/fsu-hq")
        self.assertEqual(p.canonical_event_links(page), [{"url": "https://calendar.fsu.edu/event/synthetic", "text": "Synthetic concert"}])

    def test_terminal_zero_is_accepted_with_pagination(self):
        data = fixture()
        data["events"] = []
        parsed, records = p.decode_localist(json.dumps(data))
        self.assertEqual(records, [])
        self.assertIsNone(parsed["page"]["next_page"])

    def test_native_event_and_occurrence_ids_remain_distinct(self):
        _, records = p.decode_localist(json.dumps(fixture()))
        self.assertEqual(records[0]["id"], 123)
        self.assertEqual(records[0]["event_instances"][0]["event_instance"]["id"], 456)

    def test_hash_ignores_counters_but_observes_changed_facts(self):
        event = fixture()["events"][0]["event"]
        before = p.digest(p.stable_event(event))
        event["detail_views"] = 200
        self.assertEqual(before, p.digest(p.stable_event(event)))
        event["title"] = "Changed time and title"
        self.assertNotEqual(before, p.digest(p.stable_event(event)))

    def test_calendar_month_windows_do_not_drift(self):
        date = dt.date(2026, 10, 20)
        self.assertEqual(p.add_months(date, 12), dt.date(2027, 10, 20))
        self.assertEqual(p.add_months(dt.date(2027, 1, 31), 1), dt.date(2027, 2, 28))

    def test_public_url_guard_rejects_secrets_and_local_routes(self):
        for url in ("http://calendar.fsu.edu/", "https://fsu.edu.evil.test/", "https://127.0.0.1/", "https://user:secret@fsu.edu/", "https://calendar.fsu.edu:8443/"):
            self.assertFalse(p.allowed_url(url), url)
        self.assertTrue(p.allowed_url("https://calendar.fsu.edu/api/2/events?days=7"))

    def test_links_normalize_without_following_actions(self):
        page = p.html_page(b'<a href="/ical/test.ics">Subscribe</a><a href="/rsvp?id=2">RSVP</a>', "https://hq.fsu.edu/events")
        self.assertEqual(page.links[0]["url"], "https://hq.fsu.edu/ical/test.ics")
        self.assertEqual(len(page.links), 2)

    def test_silent_terminal_truncation_fails(self):
        page = {"current": 1, "total": 2, "total_items": 101, "next_page": None}
        self.assertIn("truncates", p.pagination_problem(page, 1, None, 100, 100))

    def test_empty_positive_total_fails(self):
        page = {"current": 1, "total": 1, "total_items": 2, "next_page": None}
        self.assertIn("empty page", p.pagination_problem(page, 1, None, 0, 0))

    def test_current_page_mismatch_fails(self):
        page = {"current": 1, "total": 2, "total_items": 101, "next_page": 2}
        self.assertIn("current page", p.pagination_problem(page, 2, 101, 101, 1))

    def test_changed_total_during_pagination_fails(self):
        page = {"current": 2, "total": 2, "total_items": 102, "next_page": None}
        self.assertIn("changed", p.pagination_problem(page, 2, 101, 102, 2))

    def test_terminal_matching_total_passes(self):
        page = {"current": 2, "total": 2, "total_items": 101, "next_page": None}
        self.assertIsNone(p.pagination_problem(page, 2, 101, 101, 1))

    def test_recurrent_rows_identified_by_occurrence(self):
        first = fixture()["events"][0]["event"]
        second = json.loads(json.dumps(first))
        second["event_instances"][0]["event_instance"]["id"] = 789
        self.assertNotEqual(p.row_identity(first), p.row_identity(second))


if __name__ == "__main__":
    unittest.main()
