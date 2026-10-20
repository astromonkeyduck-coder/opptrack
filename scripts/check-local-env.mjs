import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const names = ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','TRIGGER_SECRET_KEY'];
let missing = false;
for (const name of names) {
  const ready = Boolean(process.env[name]?.trim());
  console.log(`${name}: ${ready ? 'configured (value hidden)' : 'missing'}`);
  missing ||= !ready;
}
console.log('Calendar execution: absent from Stage 1');
process.exitCode = missing ? 2 : 0;
