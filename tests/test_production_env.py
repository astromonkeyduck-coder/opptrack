"""Meaningful production configuration boundaries. All values are synthetic."""
import importlib.util
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

    def test_calendar_or_unproven_social_cannot_be_enabled(self):
        for target, key in (('netlify', 'CALENDAR_WRITES_ENABLED'), ('trigger', 'CALENDAR_WRITES_ENABLED'), ('trigger', 'SOCIAL_COLLECTION_ENABLED')):
            values = valid_values(target)
            values[key] = 'true'
            self.assertTrue(env.check_values(CONTRACT['targets'][target], values))

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
