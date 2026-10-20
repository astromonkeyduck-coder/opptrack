#!/usr/bin/env python3
"""Offline forecasts. Does not call a provider, provision services, or spend money."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def forecast(config, account_count):
    rates, core, pilot = config["rates"], config["core_month"], config["social_pilot"]
    days = core["days"]
    invocation = rates["trigger_invocation"]
    dispatcher = days * core["dispatcher_runs_per_day"]
    http = days * sum(group["sources"] * group["checks_per_day"] for group in core["http_source_groups"])
    browser = days * core["browser_sources"] * core["browser_checks_per_day"]
    extraction = core["extraction_captures"]
    notifications = core["emails_sent"]
    trigger_raw = (
        dispatcher * (invocation + core["dispatcher_seconds_per_run_assumed"] * rates["trigger_micro_second"])
        + http * (invocation + core["http_seconds_per_run_assumed"] * rates["trigger_small_1x_second"])
        + browser * (invocation + core["browser_seconds_per_run_assumed"] * rates["trigger_medium_1x_second"])
        + extraction * (invocation + core["extraction_worker_seconds_assumed"] * rates["trigger_small_1x_second"])
        + notifications * (invocation + core["notification_worker_seconds_assumed"] * rates["trigger_small_1x_second"])
    )
    input_tokens = extraction * core["llm_text_input_tokens_per_capture_assumed"] + core["images"] * core["llm_image_input_tokens_per_image_assumed"]
    output_tokens = extraction * core["llm_output_tokens_per_capture_assumed"]
    llm = (input_tokens * core["llm_input_usd_per_million_assumed_not_a_vendor_quote"] + output_tokens * core["llm_output_usd_per_million_assumed_not_a_vendor_quote"]) / 1_000_000
    emails = core["emails_sent"] + core["emails_received"]
    resend_free_fits = emails <= rates["resend_free_month_quota"] and core["maximum_combined_emails_per_day_assumed"] <= rates["resend_free_day_quota"]
    media_gb = core["images"] * core["image_mb_assumed"] / 1000 * core["media_retention_days"] / days
    excerpts_gb = extraction * core["raw_excerpt_kb_per_capture"] / 1_000_000 * core["excerpt_retention_days"] / days
    metadata_gb = extraction * core["metadata_kb_per_capture_assumed"] / 1_000_000
    # Netlify meters the web app independently of Trigger.dev Cloud workers.
    netlify_deploy_credits = core["netlify_production_deploys_per_month_assumed"] * rates["netlify_credits_per_production_deploy"]
    netlify_compute_credits = core["netlify_compute_gb_hours_per_month_assumed_includes_previews"] * rates["netlify_credits_per_compute_gb_hour"]
    netlify_bandwidth_credits = core["netlify_bandwidth_gb_per_month_assumed_includes_previews"] * rates["netlify_credits_per_bandwidth_gb"]
    netlify_request_credits = core["netlify_web_requests_per_month_assumed_includes_previews"] / 10000 * rates["netlify_credits_per_10000_web_requests"]
    netlify_credits = netlify_deploy_credits + netlify_compute_credits + netlify_bandwidth_credits + netlify_request_credits + core["netlify_other_team_credit_usage_per_month_assumed"]
    netlify_plan_known = core["netlify_credit_based_plan_assumed"]
    netlify_free_fits = netlify_plan_known and netlify_credits <= rates["netlify_free_month_credits"]
    netlify_personal_fits = netlify_plan_known and netlify_credits <= rates["netlify_personal_month_credits"]
    netlify_pro_fits = netlify_plan_known and netlify_credits <= rates["netlify_pro_month_credits"]
    free_blockers = []
    if trigger_raw > rates["trigger_free_credit_month"]:
        free_blockers.append("Trigger usage exceeds assumed unused Free credit")
    if not resend_free_fits:
        free_blockers.append("Combined inbound/outbound email count or daily peak exceeds Resend Free quota")
    if media_gb + excerpts_gb > rates["supabase_free_storage_gb"]:
        free_blockers.append("Steady-state media plus excerpts exceed Supabase Free storage")
    if metadata_gb + core["existing_database_gb_assumed"] > rates["supabase_free_database_gb"]:
        free_blockers.append("Assumed DB size exceeds Supabase Free database quota")
    if core["egress_gb_per_month_assumed"] > rates["supabase_free_egress_gb"]:
        free_blockers.append("Assumed egress exceeds Supabase Free quota")
    if not netlify_free_fits:
        free_blockers.append("Netlify credit-based plan is not assumed or modeled team usage exceeds Free credits")

    # If Free credits are exceeded, indicate setup/budget change, not automatic upgrade.
    core_hobby = rates["trigger_hobby_month"] + max(0, trigger_raw - rates["trigger_hobby_credit_month"])
    paid_core_without_netlify = rates["supabase_pro_month"] + core_hobby + llm
    paid_core = paid_core_without_netlify + rates["netlify_personal_month"]
    social_days = pilot["days"]
    post_checks = account_count * social_days * pilot["posts_checks_per_day"]
    billed_posts = post_checks * pilot["posts_returned_per_account_check_assumed"]
    backfill = account_count * pilot["posts_backfill_items_per_account_assumed"]
    story_checks = account_count * social_days * pilot["stories_checks_per_day"]
    batches = math.ceil(account_count / pilot["stories_batched_accounts_per_run"])
    story_runs = batches * social_days * pilot["stories_checks_per_day"]
    start_units = max(1, math.ceil(pilot["stories_actor_memory_gb_assumed"]))
    story_vendor = story_checks * rates["apify_stories_username_request"] + story_runs * start_units * rates["apify_stories_start_per_gb_min_one"]
    free_posts = (billed_posts + backfill) * (rates["apify_posts_free_post"] + rates["apify_posts_free_details"])
    bronze_posts = (billed_posts + backfill) * (rates["apify_posts_bronze_post"] + rates["apify_posts_bronze_details"])
    # Repeated old posts can bill repeatedly; extraction is cached by evidence hash.
    unique_posts = account_count * social_days * pilot["unique_new_posts_per_account_day_assumed"]
    story_items = account_count * social_days * pilot["stories_items_per_account_day_assumed_for_media_budget"]
    unique_items = backfill + unique_posts + story_items
    media = (backfill + unique_posts) * pilot["media_per_new_post_assumed"] + story_items
    pilot_input = unique_items * pilot["model_text_tokens_per_unique_item_assumed"] + media * pilot["model_image_tokens_per_media_assumed"]
    pilot_output = unique_items * pilot["model_output_tokens_per_unique_item_assumed"]
    pilot_llm = (pilot_input * pilot["extraction_input_usd_per_million_assumed_not_a_vendor_quote"] + pilot_output * pilot["extraction_output_usd_per_million_assumed_not_a_vendor_quote"]) / 1_000_000
    vendor_retry = (bronze_posts + story_vendor) * pilot["retry_multiplier_assumed"]
    apify_starter_cash = rates["apify_starter_month"] + max(0, vendor_retry - rates["apify_starter_credit_month"])
    proposed_total = apify_starter_cash + pilot_llm + pilot["vendor_storage_transfer_reserve_usd_assumed"]
    return {
        "currency": "USD", "status": "explicit_assumptions_not_measured_runtime_or_invoice", "verified_on": config["verified_on"],
        "core_30_day": {
            "sources": sum(g["sources"] for g in core["http_source_groups"]) + core["browser_sources"],
            "dispatcher_runs": dispatcher, "http_runs": http, "browser_runs": browser,
            "extraction_runs": extraction, "notification_runs": notifications,
            "trigger_raw_usage_usd": round(trigger_raw, 6),
            "trigger_free_credit_sufficient_under_assumptions": trigger_raw <= rates["trigger_free_credit_month"],
            "netlify_credit_based_plan_assumed_not_account_verified": netlify_plan_known,
            "netlify_production_deploy_credits_assumed": round(netlify_deploy_credits, 6),
            "netlify_compute_credits_assumed": round(netlify_compute_credits, 6),
            "netlify_bandwidth_credits_assumed": round(netlify_bandwidth_credits, 6),
            "netlify_web_request_credits_assumed": round(netlify_request_credits, 6),
            "netlify_total_team_credits_assumed": round(netlify_credits, 6),
            "netlify_free_credit_sufficient_under_assumptions": netlify_free_fits,
            "netlify_personal_credit_sufficient_under_assumptions": netlify_personal_fits,
            "netlify_pro_credit_sufficient_under_assumptions": netlify_pro_fits,
            "netlify_auto_recharge_assumed_enabled": core["netlify_auto_recharge_assumed_enabled"],
            "netlify_credit_overage_cash_forecast_usd": None,
            "netlify_overage_policy": "No automatic credit purchase or upgrade is modeled or authorized; budget/setup change required above included credits. Account/team plan and other-project usage remain unverified.",
            "llm_input_tokens_assumed": input_tokens, "llm_output_tokens_assumed": output_tokens,
            "llm_forecast_usd_assumed": round(llm, 6), "combined_email_count": emails, "resend_free_quota_fits": resend_free_fits,
            "storage_gb_media_plus_raw_assumed": round(media_gb + excerpts_gb, 6),
            "database_growth_gb_per_month_assumed_excludes_indexes": round(metadata_gb, 6),
            "free_tier_known_assumed_quotas_fit": not free_blockers,
            "free_tier_setup_or_budget_blockers": free_blockers,
            "free_tier_path_cash_usd_assuming_all_quotas_fit_excludes_domain": None if free_blockers else round(llm, 6),
            "paid_supabase_pro_netlify_personal_trigger_hobby_resend_free_usd_excludes_domain": round(paid_core, 6) if netlify_personal_fits and resend_free_fits else None,
            "paid_netlify_pro_alternative_usd_excludes_domain": round(paid_core_without_netlify + rates["netlify_pro_month"], 6) if netlify_pro_fits and resend_free_fits else None,
            "paid_path_with_netlify_personal_resend_pro_usd_excludes_domain": round(paid_core + rates["resend_pro_month"], 6) if netlify_personal_fits and emails <= rates["resend_pro_month_quota"] else None,
            "optional_domain_monthly_equivalent_assumed": round(core["optional_domain_usd_per_year_assumed"] / 12, 6),
        },
        "social_7_day": {
            "accounts": account_count, "days": social_days, "posts_account_checks": post_checks,
            "posts_items_repeated_and_billable_assumed": billed_posts, "posts_one_time_backfill_items_assumed": backfill,
            "stories_username_checks_including_empty": story_checks, "story_batched_runs": story_runs,
            "story_start_units_per_run_assumed": start_units, "stories_vendor_usd_before_retries": round(story_vendor, 6),
            "posts_vendor_free_rate_usd_before_retries": round(free_posts, 6),
            "posts_vendor_bronze_rate_usd_before_retries": round(bronze_posts, 6),
            "vendor_bronze_plus_stories_usd_before_retries": round(bronze_posts + story_vendor, 6),
            "vendor_bronze_plus_stories_usd_with_retry_reserve": round(vendor_retry, 6),
            "apify_starter_cash_usd_including_plan_and_overage_assumed": round(apify_starter_cash, 6),
            "free_credit_insufficient_usd_before_retries": round(max(0, free_posts + story_vendor - rates["apify_free_credit_month"]), 6),
            "unique_items_extracted_assumed": unique_items, "media_items_assumed": media,
            "media_gb_assumed_at_1mb_each": round(media / 1000, 6),
            "core_free_storage_exceeded_by_social_media_alone": media / 1000 > rates["supabase_free_storage_gb"],
            "storage_condition": "Requires existing paid/private storage or a separately costed retention plan; core hosting excluded",
            "extraction_model_usd_assumed": round(pilot_llm, 6),
            "storage_transfer_reserve_usd_assumed": pilot["vendor_storage_transfer_reserve_usd_assumed"],
            "pilot_incremental_cash_forecast_usd_including_retry_reserve": round(proposed_total, 6),
            "proposed_cap_usd_not_authorized": pilot["future_pilot_total_spend_cap_usd_proposed_not_authorized"],
            "cap_fits_baseline_assumptions": proposed_total <= pilot["future_pilot_total_spend_cap_usd_proposed_not_authorized"],
            "human_audit_hours_assumed_unpriced": round(account_count * social_days * pilot["human_audit_minutes_per_account_day_assumed"] / 60, 3),
            "excluded": ["tax", "human labor valuation", "unmeasured extra actor events/compute/proxy/storage charges", "core hosting", "coding agent subscription", "video transcription"]
        }
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "config/cost-assumptions.json")
    parser.add_argument("--accounts", type=int, help="Override account count for sensitivity analysis")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    count = args.accounts
    if count is None:
        accounts = json.loads((ROOT / config["social_pilot"]["accounts_file"]).read_text())
        count = len(accounts["accounts"])
        assert count == accounts["account_count"], "Pilot count/list mismatch"
    if not 1 <= count <= 1000:
        parser.error("--accounts must be 1..1000")
    result = forecast(config, count)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
