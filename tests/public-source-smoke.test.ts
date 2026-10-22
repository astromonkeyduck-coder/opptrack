import assert from 'node:assert/strict';
import test from 'node:test';
import { manualPublicSourceEnvironment } from '../trigger/source-dispatcher';
import { runDispatcherHandler } from '../lib/collection/dispatcher';
import type { dispatchDueSources } from '../lib/ingestion';
const env={SUPABASE_URL:'https://synthetic.example.test',SUPABASE_SECRET_KEY:'synthetic-only',SOCIAL_COLLECTION_ENABLED:'true',CALENDAR_WRITES_ENABLED:'false'};
test('only an explicit manual test can omit social reads, without changing persistent environment',()=>{
 const isolated=manualPublicSourceEnvironment({publicSourcesOnly:true},{isTest:true},env);
 assert.equal(isolated?.SOCIAL_COLLECTION_ENABLED,'false');assert.equal(isolated?.CALENDAR_WRITES_ENABLED,'false');
 assert.equal(env.SOCIAL_COLLECTION_ENABLED,'true');assert.equal(isolated?.SUPABASE_SECRET_KEY,env.SUPABASE_SECRET_KEY);
 for(const payload of [null,[],{}, {publicSourcesOnly:'true'}, {publicSourcesOnly:false}]) assert.equal(manualPublicSourceEnvironment(payload,{isTest:true},env),undefined);
});
test('scheduled provenance cannot be changed by a public-only payload flag',()=>{
 assert.equal(manualPublicSourceEnvironment({publicSourcesOnly:true},{isTest:false},env),undefined);
});
test('public smoke test still uses the real handler and keeps manual provenance and write prohibition',async()=>{
 const isolated=manualPublicSourceEnvironment({publicSourcesOnly:true},{isTest:true},env)!;
 const result=await runDispatcherHandler((async(limit,client,provenance,environment)=>{
  assert.equal(limit,3);assert.equal(environment?.SOCIAL_COLLECTION_ENABLED,'false');assert.equal(provenance?.invocationKind,'manual');return [];
 }) as typeof dispatchDueSources,isolated,{invocationKind:'manual',triggerRunId:'run_synthetic_public_only'});
 assert.equal(result.status,'idle');assert.equal(result.provenance.invocationKind,'manual');
 await assert.rejects(runDispatcherHandler(undefined,{...isolated,CALENDAR_WRITES_ENABLED:'true'}),/calendar writes disabled/);
});
