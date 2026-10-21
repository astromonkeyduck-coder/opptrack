#!/usr/bin/env python3
"""Offline production configuration validation. Never prints values or calls a provider."""
from __future__ import annotations

import argparse
from datetime import datetime
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / 'config/production-environments.json'


def parse_env(text):
    """Read a deliberately small dotenv subset without executing/interpolating anything."""
    values, errors = {}, []
    for number, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].lstrip()
        key, separator, value = line.partition('=')
        key, value = key.strip(), value.strip()
        if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key):
            errors.append(f'line {number}: expected KEY=value')
            continue
        if key in values:
            errors.append(f'{key}: duplicate key')
            continue
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                errors.append(f'{key}: unclosed quote')
                continue
            value = value[1:-1]
        values[key] = value
    return values, errors


def check_values(spec, values):
    errors = []
    unknown = set(values) - set(spec['variables'])
    for key in sorted(unknown):
        errors.append(f'{key}: forbidden in this target' if key in spec['forbidden_variables']
                      else f'{key}: not declared for this target')
    for key, rule in spec['variables'].items():
        value = values.get(key, '')
        required = rule.get('required', False) or any(values.get(k) == v for k, v in rule.get('required_when', {}).items())
        if required and not value.strip():
            errors.append(f'{key}: required value missing')
            continue
        if not value:
            continue
        if rule['type'] in ('boolean', 'disabled_flag') and value not in ('true', 'false'):
            errors.append(f'{key}: use exactly true or false')
        elif rule['type'] == 'disabled_flag' and value != 'false':
            errors.append(f'{key}: must remain false at the current stage')
        elif rule['type'] == 'https_url':
            try:
                parsed = urlsplit(value)
                valid = (parsed.scheme == 'https' and bool(parsed.hostname)
                         and not parsed.username and not parsed.password
                         and not parsed.query and not parsed.fragment and not re.search(r'\s', value)
                         and parsed.hostname not in ('localhost', '127.0.0.1', '::1'))
                if valid:
                    try:
                        valid = ipaddress.ip_address(parsed.hostname).is_global
                    except ValueError:
                        pass
            except ValueError:
                valid = False
            if not valid:
                errors.append(f'{key}: production requires an HTTPS URL without credentials, query or fragment')
        elif rule['type'] == 'supabase_publishable_key' and not re.fullmatch(r'sb_publishable_[A-Za-z0-9_-]+', value):
            errors.append(f'{key}: use a Supabase publishable key; secret and legacy JWT keys are not accepted')
        elif rule['type'] == 'supabase_secret_key' and not re.fullmatch(r'sb_secret_[A-Za-z0-9_-]+', value):
            errors.append(f'{key}: use a Supabase server secret key')
        elif rule['type'] == 'trigger_production_key' and not value.startswith('tr_prod_'):
            errors.append(f'{key}: use the Trigger.dev Production key, not a development or staging key')
        elif rule['type'] == 'instagram_user_token' and not re.fullmatch(r'[A-Za-z0-9_.~+/=-]{16,4096}', value):
            errors.append(f'{key}: invalid opaque token format')
        elif rule['type'] == 'numeric_id' and not re.fullmatch(r'[0-9]{1,32}', value):
            errors.append(f'{key}: numeric caller account ID required')
        elif rule['type'] == 'iso_instant':
            try:
                if not re.search(r'(Z|[+-][0-9]{2}:?[0-9]{2})$', value):
                    raise ValueError()
                datetime.fromisoformat(value.replace('Z', '+00:00'))
            except ValueError:
                errors.append(f'{key}: explicit-offset ISO timestamp required when supplied')
        if '${' in value or value.startswith('REPLACE_') or '<' in value and key != 'RESEND_FROM_EMAIL':
            errors.append(f'{key}: unresolved placeholder or interpolation')
    return errors


def check_templates(contract):
    errors = []
    for target, spec in contract['targets'].items():
        values, parse_errors = parse_env((ROOT / spec['template']).read_text())
        errors.extend(f'{target}: {message}' for message in parse_errors)
        if set(values) != set(spec['variables']):
            errors.append(f'{target}: template keys differ from declared target variables')
        for key, value in values.items():
            rule = spec['variables'].get(key, {})
            if value != rule.get('default', ''):
                errors.append(f'{target}/{key}: template must contain only empty values or declared safe defaults')
        if any(key.startswith('NEXT_PUBLIC_') and rule.get('secret') for key, rule in spec['variables'].items()):
            errors.append(f'{target}: a secret is declared browser-public')
        if set(values) & set(spec['forbidden_variables']):
            errors.append(f'{target}: template contains forbidden cross-target keys')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=('netlify', 'trigger'))
    parser.add_argument('--env-file', type=Path)
    args = parser.parse_args()
    contract = json.loads(CONTRACT.read_text())
    if bool(args.target) != bool(args.env_file):
        parser.error('--target and --env-file must be provided together')
    if args.target:
        try:
            values, errors = parse_env(args.env_file.read_text())
        except OSError:
            print(json.dumps({'status': 'setup-needed', 'target': args.target, 'errors': ['Environment values file is unavailable; nothing applied.']}))
            return 2
        errors += check_values(contract['targets'][args.target], values)
        result = {'status': 'invalid' if errors else 'valid_offline', 'target': args.target,
                  'context': contract['targets'][args.target]['context'], 'errors': errors,
                  'hosted_variables_applied': False, 'values_printed': False}
    else:
        errors = check_templates(contract)
        result = {'status': 'invalid' if errors else 'templates_valid', 'errors': errors,
                  'hosted_variables_applied': False, 'values_printed': False}
    print(json.dumps(result, indent=2))
    return 2 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
