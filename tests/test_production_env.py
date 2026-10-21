"""Meaningful production configuration boundaries. All values are synthetic."""
import importlib.util
import base64
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('production_env', ROOT / 'scripts/validate_production_env.py')
env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(env)
CONTRACT = json.loads(env.CONTRACT.read_text())


def valid_values(target):
    values, errors = env.parse_env((ROOT / CONTRACT['targets'][target]['template']).read_text())
    assert not errors
    values['APP_URL'] = 'https://tracker.example.com'
    if target == 'netlify':
        values.update(NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co',
                      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_SYNTHETIC',
                      TRIGGER_SECRET_KEY='tr_prod_SYNTHETIC')
    else:
        values.update(SUPABASE_URL='https://example.supabase.co', SUPABASE_SECRET_KEY='sb_secret_SYNTHETIC')
    return values


class ProductionEnvironmentTests(unittest.TestCase):
    def test_templates_contain_no_credentials(self):
        self.assertEqual(env.check_templates(CONTRACT), [])

    def test_separate_target_configurations_validate(self):
        for target in ('netlify', 'trigger'):
            self.assertEqual(env.check_values(CONTRACT['targets'][target], valid_values(target)), [])

    def test_worker_credentials_are_rejected_on_web_even_if_empty(self):
        values = valid_values('netlify')
        values['SUPABASE_SECRET_KEY'] = ''
        self.assertTrue(env.check_values(CONTRACT['targets']['netlify'], values))

    def test_privileged_key_cannot_be_bundled_as_public_key(self):
        for secret in ('sb_secret_SYNTHETIC_DO_NOT_LEAK', 'eyJsynthetic.service_role.jwt'):
            values = valid_values('netlify')
            values['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] = secret
            errors = env.check_values(CONTRACT['targets']['netlify'], values)
            self.assertTrue(errors)
            self.assertNotIn(secret, str(errors))

    def test_nonproduction_trigger_key_is_rejected(self):
        values = valid_values('netlify')
        values['TRIGGER_SECRET_KEY'] = 'tr_dev_SYNTHETIC'
        self.assertTrue(env.check_values(CONTRACT['targets']['netlify'], values))

    def test_worker_public_key_is_rejected(self):
        values = valid_values('trigger')
        values['SUPABASE_SECRET_KEY'] = 'sb_publishable_SYNTHETIC'
        self.assertTrue(env.check_values(CONTRACT['targets']['trigger'], values))

    def test_calendar_cannot_be_enabled(self):
        for target, key in (('netlify', 'CALENDAR_WRITES_ENABLED'), ('trigger', 'CALENDAR_WRITES_ENABLED')):
            values = valid_values(target)
            values[key] = 'true'
            self.assertTrue(env.check_values(CONTRACT['targets'][target], values))

    def test_optional_google_read_credentials_are_complete_server_only_group(self):
        values = valid_values('netlify')
        google_values = {
            'GOOGLE_CLIENT_ID': 'synthetic-client.apps.googleusercontent.com',
            'GOOGLE_CLIENT_SECRET': 'SYNTHETIC_GOOGLE_CLIENT_SECRET',
            'CALENDAR_TOKEN_ENCRYPTION_KEY': base64.b64encode(bytes(range(32))).decode('ascii'),
        }
        # An unconfigured integration remains optional; a partial one is a setup error.
        self.assertEqual(env.check_values(CONTRACT['targets']['netlify'], values), [])
        for key, value in google_values.items():
            partial = dict(values, **{key: value})
            errors = env.check_values(CONTRACT['targets']['netlify'], partial)
            self.assertTrue(errors)
            self.assertTrue(any('required with the other google_calendar_readonly variables' in error for error in errors))
            self.assertNotIn(value, str(errors))
        values.update(google_values)
        self.assertEqual(env.check_values(CONTRACT['targets']['netlify'], values), [])
        self.assertEqual(values['CALENDAR_WRITES_ENABLED'], 'false')
        for key in google_values:
            rule = CONTRACT['targets']['netlify']['variables'][key]
            self.assertEqual(rule['scopes'], ['functions'])
            self.assertFalse(key.startswith('NEXT_PUBLIC_'))

    def test_google_encryption_key_requires_exact_canonical_32_byte_base64(self):
        values = valid_values('netlify')
        values.update(GOOGLE_CLIENT_ID='synthetic-client.apps.googleusercontent.com',
                      GOOGLE_CLIENT_SECRET='SYNTHETIC_GOOGLE_CLIENT_SECRET')
        for bad in ('SYNTHETIC_NOT_BASE64', base64.b64encode(bytes(16)).decode('ascii'),
                    base64.b64encode(bytes(33)).decode('ascii'), 'A' * 42 + 'B=',
                    base64.b64encode(bytes(32)).decode('ascii').rstrip('=')):
            values['CALENDAR_TOKEN_ENCRYPTION_KEY'] = bad
            errors = env.check_values(CONTRACT['targets']['netlify'], values)
            self.assertTrue(any('canonical base64' in error for error in errors))
            self.assertNotIn(bad, str(errors))

    def test_google_credentials_and_tokens_never_belong_in_trigger_or_public_variables(self):
        for key in ('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CALENDAR_TOKEN_ENCRYPTION_KEY',
                    'GOOGLE_ACCESS_TOKEN', 'GOOGLE_REFRESH_TOKEN'):
            values = valid_values('trigger')
            values[key] = 'SYNTHETIC_PRIVATE_GOOGLE_VALUE'
            errors = env.check_values(CONTRACT['targets']['trigger'], values)
            self.assertTrue(any('forbidden in this target' in error for error in errors))
            self.assertNotIn(values[key], str(errors))
        for key in ('NEXT_PUBLIC_GOOGLE_CLIENT_SECRET', 'NEXT_PUBLIC_CALENDAR_TOKEN_ENCRYPTION_KEY',
                    'GOOGLE_ACCESS_TOKEN', 'GOOGLE_REFRESH_TOKEN'):
            values = valid_values('netlify')
            values[key] = 'SYNTHETIC_PRIVATE_GOOGLE_VALUE'
            errors = env.check_values(CONTRACT['targets']['netlify'], values)
            self.assertTrue(any('forbidden in this target' in error for error in errors))
            self.assertNotIn(values[key], str(errors))

    def test_social_enablement_requires_worker_only_read_credentials(self):
        values = valid_values('trigger')
        values['SOCIAL_COLLECTION_ENABLED'] = 'true'
        self.assertTrue(env.check_values(CONTRACT['targets']['trigger'], values))
        values.update(IG_FB_USER_ACCESS_TOKEN='SYNTHETIC_READ_TOKEN_1234', IG_CALLER_USER_ID='123456789')
        self.assertEqual(env.check_values(CONTRACT['targets']['trigger'], values), [])
        values['IG_TOKEN_EXPIRES_AT'] = 'tomorrow'
        self.assertTrue(env.check_values(CONTRACT['targets']['trigger'], values))
        values['IG_TOKEN_EXPIRES_AT'] = '2026-10-21T02:00:00Z'
        self.assertEqual(env.check_values(CONTRACT['targets']['trigger'], values), [])
        web_values = valid_values('netlify')
        web_values['IG_FB_USER_ACCESS_TOKEN'] = values['IG_FB_USER_ACCESS_TOKEN']
        errors = env.check_values(CONTRACT['targets']['netlify'], web_values)
        self.assertTrue(errors)
        self.assertNotIn(values['IG_FB_USER_ACCESS_TOKEN'], str(errors))

    def test_email_requires_credentials_only_when_enabled(self):
        values = valid_values('trigger')
        values['EMAIL_DELIVERY_ENABLED'] = 'true'
        errors = env.check_values(CONTRACT['targets']['trigger'], values)
        self.assertTrue(any('RESEND_API_KEY' in e for e in errors))
        self.assertTrue(any('RESEND_FROM_EMAIL' in e for e in errors))

    def test_webhook_requires_secret_when_enabled(self):
        values = valid_values('netlify')
        values['INBOUND_EMAIL_ENABLED'] = 'true'
        self.assertTrue(env.check_values(CONTRACT['targets']['netlify'], values))

    def test_bad_production_origins_and_placeholders_are_rejected(self):
        for bad in ('http://localhost:3000', 'https://user:password@example.com', 'https://10.0.0.1', 'https://bad host', '${APP_URL}'):
            values = valid_values('netlify')
            values['APP_URL'] = bad
            errors = env.check_values(CONTRACT['targets']['netlify'], values)
            self.assertTrue(errors)
            self.assertNotIn(bad, str(errors))

    def test_duplicate_keys_do_not_silently_override_secrets(self):
        values, errors = env.parse_env('TRIGGER_SECRET_KEY=first\nTRIGGER_SECRET_KEY=second')
        self.assertTrue(errors)
        self.assertEqual(values['TRIGGER_SECRET_KEY'], 'first')
        self.assertNotIn('second', str(errors))


if __name__ == '__main__':
    unittest.main()
