#!/usr/bin/env python3
"""Read-only source integrity and blank-label audit. Does not run an extractor/scorer."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
read=lambda file:json.loads((ROOT/file).read_text())
hash_bytes=lambda value:hashlib.sha256(value).hexdigest()
hash_object=lambda value:hash_bytes(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode())
r=read('reports/stage-2-acceptance-preparation.json')
base=r['privateArtifacts']['directory']
assert r['candidateFreezeCompleted'] is False and r['holdoutAssigned'] is False
assert r['holdoutLabelsCreated']==r['holdoutPredictionsRun']==r['humanReviewedHoldout']==0
assert r['target']['generalReleaseNear100Holdout']==100
assert r['target']['repositoryProvisionalHoldoutMinimum']==40
assert not r['stage2Accepted']
inv=read('private/stage2-review/snapshot-861858544d6817c5/inventory.json')
assert hash_bytes((ROOT/'private/stage2-review/snapshot-861858544d6817c5/inventory.json').read_bytes())==r['identity']['inventorySha256']
for row in inv['examples']:
    assert hash_bytes((ROOT/row['path']).read_bytes())==row['contentSha256']
batch_path='private/stage1-reingestion-live/fsu-calendar-api.json'
assert hash_bytes((ROOT/batch_path).read_bytes())==r['identity']['publicBatchSha256']
batch=read(batch_path)
pages={page['sha256']:page for page in batch['pages']}
case_ids=set()
for purpose,count in [('development',r['newUnreviewedDevelopment']),('holdout-candidates',r['prospectiveHoldoutSourceCases'])]:
    blank=read(f'{base}/{purpose}/blank-review.json')
    assert blank['factualLabelsReleased'] is False and blank['candidateFreezeManifest'] is None
    assert len(blank['cases'])==count
    for entry in blank['cases']:
        assert all(value is None for key,value in entry.items() if key!='id')
        assert entry['id'] not in case_ids
        case_ids.add(entry['id'])
        source=read(f'{base}/{purpose}/sources/{entry["id"]}.json')
        assert 'silverLabels' not in json.dumps(source) and 'proposedFacts' not in source
        if purpose=='holdout-candidates':
            for ev in source['evidence']:
                assert hash_object(ev['sourcePayload'])==ev['sourcePayloadSha256']
                page=pages[ev['sourceCaptureSha256']]
                assert hash_bytes(page['body'].encode())==page['sha256']
                index=int(ev['originalPointer'].split('/')[2])
                original=json.loads(page['body'])['events'][index]['event']
                assert all(original[key]==value for key,value in ev['sourcePayload'].items())
                assert str(original['id'])==source['nativeOpportunityId']
assert len(case_ids)==r['newUnreviewedDevelopment']+r['prospectiveHoldoutSourceCases']
print(json.dumps({'status':'passed','originalFrozenExamplesUnchanged':len(inv['examples']),'newDevelopmentSources':r['newUnreviewedDevelopment'],'prospectiveHoldoutSources':r['prospectiveHoldoutSourceCases'],'allSourcePayloadsMatchOriginalPublicCaptures':True,'allHumanLabelsBlank':True,'freezeAndAssignmentStillPending':True,'labelsOrPredictionsOpened':0,'extractorScorerModelNetworkCalls':0}))
