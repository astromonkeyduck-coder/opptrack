#!/usr/bin/env python3
"""Offline integrity checks for Stage 0 source claims. No network or credentials."""
import json
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {
    'source_id', 'organizer', 'url', 'platform', 'account_id', 'affiliation',
    'access_class', 'visibility', 'source_role', 'categories', 'adapter',
    'credential_dependency', 'status', 'status_reason', 'enabled', 'probe_enabled',
    'priority', 'cadence_minutes', 'rate_limit', 'cursor', 'next_due_at',
    'last_attempt_at', 'last_success_at', 'consecutive_failures',
    'last_content_timestamp', 'last_test', 'verification_date',
    'estimated_cost', 'actual_cost', 'owner', 'retention_policy',
}


def validate(registry):
    errors = []
    ids = set()
    for source in registry['sources']:
        sid = source.get('source_id', '<missing>')
        missing = REQUIRED - source.keys()
        if missing:
            errors.append(f'{sid}: missing {sorted(missing)}')
        if sid in ids:
            errors.append(f'{sid}: duplicate source ID')
        ids.add(sid)
        if source.get('status') not in registry['status_vocabulary']:
            errors.append(f'{sid}: invalid status')
        parsed = urlsplit(source.get('url', ''))
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            errors.append(f'{sid}: invalid public reference URL')
        if source.get('enabled'):
            errors.append(f'{sid}: runtime must remain disabled in Stage 0')
        if source.get('status') == 'verified_operational':
            test = source.get('last_test') or {}
            if not source.get('last_success_at') or not test.get('evidence_path'):
                errors.append(f'{sid}: operational claim needs successful test evidence')
            evidence = ROOT / test.get('evidence_path', '__missing__')
            if not evidence.is_file():
                errors.append(f'{sid}: operational evidence file missing')
            if test.get('outcome') != 'success':
                errors.append(f'{sid}: operational test must be success')
        if source.get('status') == 'blocked' and not source.get('status_reason'):
            errors.append(f'{sid}: blocked reason required')
        # Credentials contain names/references, never a secret value.
        dependency = source.get('credential_dependency', {})
        if any(k.lower() in {'value', 'token', 'secret', 'password'} for k in dependency):
            errors.append(f'{sid}: credential values do not belong in the registry')
    return errors


if __name__ == '__main__':
    data = json.loads((ROOT / 'config/source-registry.json').read_text())
    problems = validate(data)
    if problems:
        raise SystemExit('\n'.join(problems))
    counts = {status: sum(s['status'] == status for s in data['sources'])
              for status in data['status_vocabulary']}
    print(json.dumps({'result': 'pass', 'sources': len(data['sources']), 'statuses': counts}, indent=2))
