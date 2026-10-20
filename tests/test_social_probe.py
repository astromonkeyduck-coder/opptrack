"""Offline failure/permission checks; never use a real token or vendor account."""
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("social_probe", ROOT / "scripts/social_probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

SYNTHETIC_ENV = {"IG_ACCESS_TOKEN": "synthetic-token-do-not-log", "IG_USER_ID": "123", "IG_API_VERSION": "v99.0"}


class SocialReadSafetyTests(unittest.TestCase):
    def test_missing_credentials_make_no_request(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(probe, "json_get") as read:
            with self.assertRaises(probe.ProbeError) as error:
                probe.instagram_login(1)
            self.assertEqual(error.exception.facts["status"], "setup-needed")
            self.assertEqual(error.exception.facts["upstream_requests"], 0)
            read.assert_not_called()

    def test_missing_dataset_setup_is_not_empty_success(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(probe, "json_get") as read:
            with self.assertRaises(probe.ProbeError) as error:
                probe.apify_dataset(1)
            self.assertEqual(error.exception.facts["status"], "setup-needed")
            read.assert_not_called()

    def test_actor_starting_get_endpoints_are_rejected_before_network(self):
        for path in ("/v2/acts/apify~instagram-post-scraper/runs", "/v2/acts/apify~instagram-post-scraper/run-sync-get-dataset-items", "/v2/actor-tasks/123/run-sync"):
            with self.subTest(path=path), patch.object(probe, "build_opener") as opener:
                with self.assertRaises(probe.ProbeError):
                    probe.get("https://api.apify.com" + path)
                opener.assert_not_called()

    def test_untrusted_hosts_and_insecure_schemes_rejected(self):
        for url in ("http://api.apify.com/v2/acts/apify~instagram-post-scraper", "https://graph.instagram.com.evil.example/media", "https://127.0.0.1/media", "https://graph.instagram.com/v99.0/me/messages", "https://example:password@api.apify.com/v2/acts/apify~instagram-post-scraper"):
            with self.subTest(url=url), patch.object(probe, "build_opener") as opener:
                with self.assertRaises(probe.ProbeError):
                    probe.get(url)
                opener.assert_not_called()

    def test_failed_request_does_not_echo_exception_url_or_token(self):
        error = HTTPError("https://graph.instagram.com/?access_token=synthetic-secret", 401, "synthetic-secret", {}, None)
        with patch.object(probe, "build_opener") as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(probe.ProbeError) as observed:
                probe.get("https://graph.instagram.com/v99.0/123/media", "synthetic-secret")
            serialized = json.dumps(observed.exception.facts)
            self.assertNotIn("synthetic-secret", serialized)
            self.assertNotIn("access_token", serialized)
            self.assertEqual(observed.exception.facts["status"], "setup-needed")

    def test_http200_login_html_is_not_json_success(self):
        with patch.object(probe, "get", return_value=(b"<html>Log in</html>", {}, 200)):
            with self.assertRaises(probe.ProbeError) as observed:
                probe.json_get("https://graph.instagram.com/v99.0/123/media")
            self.assertEqual(observed.exception.facts["status"], "blocked")

    def test_official_row_error_is_partial(self):
        with patch.dict(os.environ, SYNTHETIC_ENV, clear=True), patch.object(probe, "json_get", return_value=({"data": [{"error": "account unavailable"}]}, {}, 200)):
            result = probe.instagram_login(1)
            self.assertEqual(result["status"], "partial")
            self.assertEqual(result["stats"]["rows_with_vendor_error"], 1)

    def test_missing_native_id_or_timestamp_is_partial(self):
        for row in ({"timestamp": "2026-10-20T12:00:00Z"}, {"id": "synthetic"}):
            with self.subTest(row=row), patch.dict(os.environ, SYNTHETIC_ENV, clear=True), patch.object(probe, "json_get", return_value=({"data": [row]}, {}, 200)):
                self.assertEqual(probe.instagram_login(1)["status"], "partial")

    def test_carousel_remaining_child_page_is_partial(self):
        payload = {"data": [{"id": "synthetic", "timestamp": "2026-10-20T12:00:00Z", "media_type": "CAROUSEL_ALBUM", "children": {"data": [{"id": "child"}], "paging": {"next": "https://example.invalid"}}}]}
        with patch.dict(os.environ, SYNTHETIC_ENV, clear=True), patch.object(probe, "json_get", return_value=(payload, {}, 200)):
            result = probe.instagram_login(1)
            self.assertEqual(result["status"], "partial")
            self.assertEqual(result["stats"]["carousel_child_pagination_remaining"], 1)

    def test_pagination_never_follows_supplied_next_url(self):
        payloads = [({"data": [{"id": "one", "timestamp": "2026-10-20"}], "paging": {"next": "https://evil.invalid/?access_token=synthetic-token-do-not-log", "cursors": {"after": "cursor"}}}, {}, 200), ({"data": [{"id": "two", "timestamp": "2026-10-20"}]}, {}, 200)]
        with patch.dict(os.environ, SYNTHETIC_ENV, clear=True), patch.object(probe, "json_get", side_effect=payloads) as read:
            result = probe.instagram_login(2)
            self.assertEqual(result["status"], "success-sample")
            urls = [call.args[0] for call in read.call_args_list]
            self.assertTrue(all(url.startswith("https://graph.instagram.com/v99.0/123/media?") for url in urls))
            self.assertTrue(all("access_token" not in url and "synthetic-token" not in url for url in urls))
            self.assertIn("after=cursor", urls[1])

    def test_dataset_empty_remains_unverified(self):
        with patch.dict(os.environ, {"APIFY_TOKEN": "synthetic", "APIFY_DATASET_ID": "synthetic"}, clear=True), patch.object(probe, "json_get", return_value=([], {"X-Apify-Pagination-Total": "0"}, 200)):
            result = probe.apify_dataset(1)
            self.assertEqual(result["status"], "success-empty-unverified")
            self.assertFalse(result["collection_executed"])

    def test_dataset_errors_retained_and_not_summarized_as_success(self):
        with patch.dict(os.environ, {"APIFY_TOKEN": "synthetic", "APIFY_DATASET_ID": "synthetic"}, clear=True), patch.object(probe, "json_get", return_value=([{"error": "profile not accessible"}], {"X-Apify-Pagination-Total": "1"}, 200)) as read:
            result = probe.apify_dataset(1)
            self.assertEqual(result["status"], "partial")
            self.assertIn("clean=false", read.call_args.args[0])
            self.assertEqual(result["stats"]["rows_with_vendor_error"], 1)


if __name__ == "__main__":
    unittest.main()
