"""Offline cost invariants: fee/credit accounting and failed free-tier assumptions."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("cost_model", ROOT / "scripts/cost_model.py")
cost = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cost)
CONFIG = json.loads((ROOT / "config/cost-assumptions.json").read_text())


class CostBudgetTests(unittest.TestCase):
    def test_story_fee_includes_empty_checks_and_batched_starts(self):
        result = cost.forecast(CONFIG, 39)["social_7_day"]
        self.assertEqual(result["stories_username_checks_including_empty"], 3276)
        self.assertEqual(result["story_batched_runs"], 84)
        self.assertAlmostEqual(result["stories_vendor_usd_before_retries"], 3276 * 0.003 + 84 * 0.099)

    def test_starter_prepaid_credit_not_double_counted(self):
        result = cost.forecast(CONFIG, 39)["social_7_day"]
        self.assertEqual(result["apify_starter_cash_usd_including_plan_and_overage_assumed"], result["vendor_bronze_plus_stories_usd_with_retry_reserve"])

    def test_changed_usage_cannot_quote_impossible_free_path(self):
        for key, value in (("http_seconds_per_run_assumed", 100), ("emails_received", 4000), ("images", 10000), ("egress_gb_per_month_assumed", 20)):
            with self.subTest(key=key):
                config = copy.deepcopy(CONFIG)
                config["core_month"][key] = value
                result = cost.forecast(config, 39)["core_30_day"]
                self.assertIsNone(result["free_tier_path_cash_usd_assuming_all_quotas_fit_excludes_domain"])
                self.assertTrue(result["free_tier_setup_or_budget_blockers"])

    def test_excerpt_retention_is_independent_from_media_retention(self):
        result = cost.forecast(CONFIG, 39)["core_30_day"]
        self.assertEqual(result["storage_gb_media_plus_raw_assumed"], 0.312)

    def test_larger_pilot_cannot_claim_same_cap_fits(self):
        self.assertTrue(cost.forecast(CONFIG, 39)["social_7_day"]["cap_fits_baseline_assumptions"])
        self.assertFalse(cost.forecast(CONFIG, 50)["social_7_day"]["cap_fits_baseline_assumptions"])


if __name__ == "__main__":
    unittest.main()
