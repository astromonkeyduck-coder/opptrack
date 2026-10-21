/** Synthetic fixtures only: these tests never contact Meta or read local credentials. */
import assert from "node:assert/strict";
import test from "node:test";
import candidates from "../config/instagram-candidates.json";
import { discoveryRequestUrl, preflightBusinessDiscovery, preflightHighPriorityInstagramCandidate } from "../lib/instagram/business-discovery-preflight";
import { instagramHandles } from "../lib/instagram/collector";
import { probeHighPriorityCandidates } from "../scripts/probe-instagram-candidates";

const environment={IG_FB_USER_ACCESS_TOKEN:"SYNTHETIC_CANDIDATE_TOKEN_ONLY",IG_CALLER_USER_ID:"123456789012345"};

test("candidate permission is separate from the production27 and selected watchlist",async()=>{
  assert.equal(instagramHandles.size,27);assert.equal(instagramHandles.has("dmcfsu"),false);
  assert.throws(()=>discoveryRequestUrl(environment.IG_CALLER_USER_ID,"dmcfsu",5));
  const selected=await preflightBusinessDiscovery({target:"dmcfsu",environment},{fetch:(async()=>{throw Error("must not fetch");}) as typeof fetch});
  assert.equal(selected.summary.requests,0);assert.equal(selected.summary.status,"blocked");
  const standard=candidates.accounts.find(account=>account.priority==="standard")!.handle;
  const denied=await preflightHighPriorityInstagramCandidate({target:standard,environment},{fetch:(async()=>{throw Error("must not fetch");}) as typeof fetch});
  assert.equal(denied.summary.requests,0);assert.equal(denied.summary.status,"blocked");
});

test("approved29 candidate batch enforces one fixed GET/five parents, twoconcurrent, no paging or publicprivate IDs",async()=>{
  let requests=0,active=0,maximum=0;
  const report=await probeHighPriorityCandidates(environment,{fetch:(async(input,options)=>{
    requests++;active++;maximum=Math.max(maximum,active);
    const url=new URL(String(input)),fields=url.searchParams.get("fields")!;
    assert.equal(url.origin,"https://graph.facebook.com");assert.equal(url.pathname,"/v26.0/"+environment.IG_CALLER_USER_ID);
    assert.equal(url.searchParams.has("access_token"),false);assert.equal(options?.redirect,"manual");assert.equal(options?.method,"GET");
    assert.match(fields,/media\.limit\(5\)/);assert.match(fields,/children\.limit\(20\)/);
    assert.doesNotMatch(fields,/caption|media_url|stories/);
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer "+environment.IG_FB_USER_ACCESS_TOKEN);
    const target=fields.match(/username\(([^)]+)\)/)![1];
    await new Promise(resolve=>setTimeout(resolve,1));active--;
    return Response.json({id:environment.IG_CALLER_USER_ID,business_discovery:{id:"9988776655443322",username:target,media_count:100,media:{data:Array.from({length:5},(_,index)=>({id:String(8877665544332200+index),media_type:"IMAGE",timestamp:"2026-10-21T00:00:00+0000",permalink:`https://www.instagram.com/p/private_synthetic_${index}/`,caption:"NOT_REQUESTED_OR_RETAINED",media_url:"https://do-not-follow.invalid"}))}}});
  }) as typeof fetch});
  assert.equal(requests,29);assert.equal(maximum,2);assert.equal(report.counts.requests,29);assert.equal(report.counts.access_samples_proven,29);
  assert.equal(report.counts.valid_parent_posts,145);assert.equal(report.changes.candidates_activated,0);assert.equal(report.changes.production_worker_allowlist_modified,false);
  const text=JSON.stringify(report);
  for(const value of [environment.IG_FB_USER_ACCESS_TOKEN,environment.IG_CALLER_USER_ID,"9988776655443322","https://","private_synthetic","NOT_REQUESTED_OR_RETAINED"])assert.equal(text.includes(value),false);
});

test("candidate batch without credentials makes zero requests and retains explicit setupneeded",async()=>{
  const report=await probeHighPriorityCandidates({},{fetch:(async()=>{throw Error("must not fetch");}) as typeof fetch});
  assert.equal(report.counts.requests,0);assert.equal(report.counts.accounts_attempted,0);assert.equal(report.counts.status_counts.setup_needed,29);
  assert.equal(report.counts.access_samples_proven,0);
});
