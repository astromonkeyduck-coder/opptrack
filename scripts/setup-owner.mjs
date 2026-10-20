/** Explicit single-owner bootstrap. Never prints credentials or user details. */
import { createClient } from '@supabase/supabase-js';
try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const userId = process.argv[2];
if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
  console.error('Usage: npm run setup:owner -- <existing Supabase Auth user UUID>');
  process.exit(2);
}
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error('Setup needed: Supabase URL and server secret are missing. Enter values directly in .env.local.'); process.exit(2); }
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { error } = await client.rpc('configure_tracker_owner', { p_user_id: userId });
if (error) { console.error(`Owner setup failed (${error.code || 'database'}). Verify migrations and that the Auth user exists; no credentials were logged.`); process.exit(1); }
console.log('Single owner configured. Only this existing Auth account can read the inbox. Two free public sources are due; no calendar or delivery writes enabled.');
