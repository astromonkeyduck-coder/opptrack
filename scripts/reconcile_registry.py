#!/usr/bin/env python3
"""Reconcile the Stage 0 inventory from saved probe evidence, without network I/O.

This deliberately promotes only known, narrowly scoped parser results, never
HTTP reachability, vendor metadata, fixtures, or an absent credential.
"""
from copy import deepcopy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    path = ROOT / 'config/source-registry.json'
    registry = json.loads(path.read_text())
    report_path = ROOT / 'reports/probes/latest.json'
    report = json.loads(report_path.read_text())
    sources = {s['source_id']: s for s in registry['sources']}
    requests = {r['request_id']: r for r in report['requests']}
    aliases = {'fsu-matpat-conflict': 'fsu-matpat-reference',
               'fsu-onf-important-dates': 'fsu-onf-dates'}

    # An actual subscription URL was observed in HQ's public page. Its access
    # is a separate route from the dynamic page and the public Localist subset.
    export = next((p for p in report['probes'] if p['probe_id'] == 'fsu-hq-public-export'), None)
    if export and 'fsu-hq-public-export' not in sources:
        row = deepcopy(sources['fsu-hq-events'])
        req = requests[export['request_ids'][0]]
        row.update(source_id='fsu-hq-public-export', organizer='HQ observed public calendar export',
                   url=req['url'], access_class='public', visibility='public_source_private_catalog',
                   credential_dependency={'required': False, 'reference': None, 'setup_state': 'not_required'},
                   retention_policy='public_excerpt_90_days')
        row['adapter'] = {'route': 'observed_ics', 'implementation': 'read_only_probe',
                          'coverage_scope': 'Observed public subscription only; no complete/private HQ coverage claim.',
                          'expected_format': 'ics', 'parser_version': 'stage0-probe-v1'}
        row['affiliation'] = {'class': 'campus', 'evidence_url': 'https://hq.fsu.edu/events',
                              'evidence_kind': 'url_observed_in_official_page', 'checked_at': report['finished_at']}
        sources[row['source_id']] = row

    grouped = {}
    contexts = {}
    for probe in report['probes']:
        sid = 'fsu-hq-public-export' if probe['probe_id'] == 'fsu-hq-public-export' else aliases.get(probe['source_id'], probe['source_id'])
        grouped.setdefault(sid, []).append(probe)
        contexts[sid] = (report, 'reports/probes/latest.json')
    # Keep original full-run failures while applying narrow later investigations.
    # Request IDs are report-local, so never merge their dictionaries globally.
    for filename in ('hq-export-live.json', 'hq-public-calendar-live.json'):
        followup_path = ROOT / 'reports/probes' / filename
        if not followup_path.exists():
            continue
        followup = json.loads(followup_path.read_text())
        followup_groups = {}
        for probe in followup['probes']:
            sid = 'fsu-hq-public-export' if probe['probe_id'] == 'fsu-hq-public-export' else aliases.get(probe['source_id'], probe['source_id'])
            followup_groups.setdefault(sid, []).append(probe)
        for sid, probes in followup_groups.items():
            if sid in contexts and followup['finished_at'] < contexts[sid][0]['finished_at']:
                continue
            grouped[sid] = probes
            contexts[sid] = (followup, 'reports/probes/' + filename)

    for sid, probes in grouped.items():
        if sid not in sources:
            raise SystemExit(f'Unmapped source ID in live report: {sid}')
        row = sources[sid]
        source_report, evidence_path = contexts[sid]
        source_requests = {r['request_id']: r for r in source_report['requests']}
        related = [source_requests[rid] for p in probes
                   for rid in p.get('request_ids', []) + p.get('replay_request_ids', [])]
        attempts = {r['request_id']: r for r in related}
        parsed = [p for p in probes if p['outcome'] == 'parsed']
        # Explicit route-specific content proof; generic parsed diagnostics alone
        # do not promote a new collection source.
        content_proof = (
            sid == 'fsu-calendar-api' and any(p['probe_id'] == 'calendar-seven-day-pagination'
                                            and p.get('pagination_complete') and p.get('event_rows', 0) > 0 for p in parsed)
            or sid == 'fsu-matpat-reference' and any(p.get('occurrence_claim') for p in parsed)
            or any(p.get('event_records_extracted', 0) > 0 or p.get('announcement_records_extracted', 0) > 0
                   or p.get('dated_items_extracted', 0) > 0 for p in parsed)
        )
        failures = [p for p in probes if p['outcome'] in {'blocked', 'transport_error', 'http_error', 'parse_error', 'partial', 'dynamic_shell', 'oversize', 'budget_exhausted'}]
        # A separately failed optional subordinate item remains visible but need
        # not erase a successful archive parser. Calendar windows require all.
        success = bool(content_proof) and not (sid == 'fsu-calendar-api' and failures)
        row['last_attempt_at'] = max((r.get('finished_at', r['started_at']) for r in related), default=source_report['finished_at'])
        row['last_test'] = {'at': source_report['finished_at'], 'outcome': 'success' if success else 'partial' if parsed else 'blocked' if failures else 'reachable_only',
                            'evidence_path': evidence_path,
                            'probe_ids': [p['probe_id'] for p in probes],
                            'observed_outcomes': sorted({p['outcome'] for p in probes}),
                            'limitations': [p[k] for p in probes for k in ('limitation', 'not_verified') if k in p]}
        row['verification_date'] = source_report['finished_at'][:10]
        row['affiliation']['checked_at'] = source_report['finished_at']
        row['actual_cost'] = {'provider_charge_usd': None, 'requests': len(attempts),
                              'basis': 'Public GETs only; no billable service invoked or invoice measured. Local compute/network not priced.'}
        if success:
            row['status'] = 'verified_operational'
            row['status_reason'] = 'Genuine relevant content parsed by a bounded read-only probe; scope is limited to the recorded route/window.'
            row['last_success_at'] = row['last_attempt_at']
            row['consecutive_failures'] = 0
            row['adapter']['implementation'] = 'read_only_probe'
            row['adapter']['parser_version'] = 'stage0-probe-v1'
        elif failures:
            row['status'] = 'blocked'
            row['status_reason'] = 'Recorded collection is blocked/incomplete: ' + ', '.join(sorted({p['outcome'] for p in failures})) + '. See individual request evidence; never an empty-success result.'
            row['consecutive_failures'] = 1  # one aggregate source probe run, not request count
        else:
            row['status'] = 'documented_but_untested'
            row['status_reason'] = 'HTML reached, but event/ticket record ingestion was not demonstrated; reachability is not operational collection.'
        if sid == 'fsu-hq-public-calendar':
            row['adapter']['coverage_scope'] = 'Public preview event links and displayed dates only; some locations restricted; full HQ coverage unknown.'
        if sid == 'fsu-hello-weekly':
            row['freshness_status'] = 'archive_stale_for_current_alerts'
            row['adapter']['coverage_scope'] = 'Public archive/RSS intake only; observed 2023-era items, no current newsletter, inbound email, or flyer OCR claim.'

    directory_path = ROOT / 'config/social-pilot-accounts.json'
    if directory_path.exists():
        directory = json.loads(directory_path.read_text())
        row = sources['fsu-social-directory']
        if directory.get('verification_scope') == 'official_directory_links_only' and directory.get('account_count', 0) > 0:
            row.update(status='verified_operational', status_reason='Official directory parser extracted affiliation links only; Instagram content collection remains untested.',
                       last_attempt_at=directory['tested_at'], last_success_at=directory['tested_at'], verification_date=directory['tested_at'][:10],
                       last_test={'at': directory['tested_at'], 'outcome': 'success', 'evidence_path': 'config/social-pilot-accounts.json', 'scope': 'directory_links_only'},
                       actual_cost={'provider_charge_usd': None, 'requests': 1, 'basis': 'Public directory GET; no actor or Instagram collection run.'})
            row['adapter']['implementation'] = 'read_only_probe'

    for sid, filename in [('instagram-official', 'instagram-login-probe.json'),
                          ('instagram-public-posts-apify', 'apify-dataset-probe.json'),
                          ('instagram-stories-apify', 'apify-dataset-probe.json')]:
        evidence = json.loads((ROOT / 'evidence' / filename).read_text())
        row = sources[sid]
        row.update(status='blocked', status_reason='Setup needed; content collector unrun. Missing: ' + ', '.join(evidence.get('missing', [])),
                   last_test={'at': evidence['tested_at'], 'outcome': 'not_run_setup_needed', 'evidence_path': 'evidence/' + filename},
                   last_attempt_at=None, last_success_at=None,
                   actual_cost={'provider_charge_usd': 0, 'requests': 0, 'basis': 'Credential preflight only; no content requests or actor runs.'})
    registry['sources'] = list(sources.values())
    path.write_text(json.dumps(registry, indent=2) + '\n')
    print(json.dumps({'result': 'reconciled', 'sources': len(sources), 'evidence_finished_at': report['finished_at']}))


if __name__ == '__main__':
    main()
