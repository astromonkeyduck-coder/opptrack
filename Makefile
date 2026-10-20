.PHONY: check reconcile forecast probe

check:
	python3 -m unittest discover -s tests -v
	python3 scripts/validate_registry.py
	python3 evaluation/validate_cases.py
	python3 scripts/validate_production_env.py

reconcile:
	python3 scripts/reconcile_registry.py
	python3 scripts/validate_registry.py

forecast:
	python3 scripts/cost_model.py --output evidence/cost-forecast.json

# Read-only public network access; mixed/blocked outcomes deliberately exit 2.
probe:
	python3 scripts/probe_sources.py --output reports/probes/latest.json --start-date 2026-10-20 --months 12
