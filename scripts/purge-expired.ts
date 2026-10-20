/** Plan-only until hosted deletion/refresh races and Storage restore are verified. */
import { existsSync } from 'node:fs';
import { getWorkerClient } from '../lib/ingestion';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const client = getWorkerClient();
const { data, error } = await client.rpc('purge_candidates', { p_limit: 100 });
if (error) throw new Error(`Retention planning failed (${error.code ?? 'database'})`);
console.log(JSON.stringify({ mode: 'plan_only', candidateObjects: data?.length ?? 0, batchLimit: 100, objectsDeleted: 0, reason: 'Hosted Storage deletion/refresh race and restore checks remain required. No production purge is enabled.' }));
