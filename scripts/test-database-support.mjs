/** Test-only registry seed, executes real SQL constraints; no hosted Supabase client. */
import { readFile } from 'node:fs/promises';
export async function seedDisabledRegistryRoutes(db,ownerId) {
  const registry=JSON.parse(await readFile(new URL('../config/source-registry.json',import.meta.url),'utf8'));
  const ids=new Set(registry.sources.map(source=>source.source_id));
  const existing=(await db.query('select id from public.sources')).rows;
  for(const row of existing) if(!ids.has(row.id)) throw new Error(`Migration source ID is absent from registry: ${row.id}`);
  const rows=registry.sources.map(source=>({id:source.source_id,name:source.organizer,url:source.url,health_status:source.status,health_message:source.status_reason,coverage_note:source.adapter.coverage_scope}));
  await db.query("insert into public.sources(id,owner_id,name,adapter,url,enabled,health_status,health_message,coverage_note) select id,$1,name,'unconfigured',url,false,health_status,health_message,coverage_note from jsonb_to_recordset($2::jsonb) as r(id text,name text,url text,health_status text,health_message text,coverage_note text) on conflict(id) do nothing",[ownerId,JSON.stringify(rows)]);
  return registry.sources.length;
}
