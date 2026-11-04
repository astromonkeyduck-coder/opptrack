#!/usr/bin/env python3
"""Custody/blank-label checks only; never inspect answers or run any candidate."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
read=lambda path:json.loads(path.read_text())
sha=lambda data:hashlib.sha256(data).hexdigest()
r=read(ROOT/'reports/stage-2-sealed-holdout-preparation.json')
mfile=ROOT/r['sealedArtifacts']['integrityManifest'];m=read(mfile)
assert sha(mfile.read_bytes())==r['sealedArtifacts']['integrityManifestSha256']
assert len(m['coreCases'])==100 and len({c['blindId']for c in m['coreCases']})==100
assert m['humanLabels']==m['candidatePredictions']==0
assert m['candidateFreezeCompleted']is False and m['holdoutAssigned']is False
assert r['existingApprovedDevelopment']==35 and r['additionalExposedDevelopmentExcluded']==25
base=mfile.parent;checked_assets=0;pdf_pages=0
for item in m['coreCases']+m['challengeCases']:
 casefile=ROOT/item['sourceRecord'];assert sha(casefile.read_bytes())==item['sourceRecordSha256']
 case=read(casefile)
 assert case['humanLabels']is None and case['candidatePredictions']is None
 assert case['assignment'].startswith('unassigned_')
 for asset in case['assets']:
  path=ROOT/asset['path'];original=ROOT/asset['originalCuratorPath'];body=path.read_bytes()
  assert len(body)==asset['bytes']and sha(body)==asset['sha256']
  assert body==original.read_bytes()
  checked_assets+=1
  views=asset.get('allPageViews',[])
  if views:
   assert len(views)==case['knownPdfPageCount']
   assert {v['page']for v in views}==set(range(1,case['knownPdfPageCount']+1))
   for view in views:
    data=(ROOT/view['path']).read_bytes();assert sha(data)==view['sha256']and len(data)==view['bytes']
    assert data.startswith(b'\x89PNG\r\n\x1a\n')
   pdf_pages+=len(views)
blank=read(base/'blank-human-review.json')
assert blank['status']=='not_released_for_factual_labeling'and blank['candidateFreezeManifest']is None
assert all(value is None for row in blank['cases']for key,value in row.items()if key!='blindId')
failures=read(base/'actual-request-failure-ledger.json')
assert len(failures['failures'])==6 and failures['partialBodiesSaved']==0
assert failures['semanticCasesOrNegativeGoldCreated']==0
for row in failures['failures']:assert row['captureComplete']is False and row['state']!='success'
net=r['network'];assert net['actualGets']<=80 and net['actualBodyBytes']<=16*1024*1024
assert net['helperAllocationOverrunBytes']==1 and net['failureMetadataOnlyRecords']==6
ex=read(ROOT/'private/stage2-holdout-curation/primary-20261103/development-exclusions-v2.json')
for file,digest in ex['sourceExampleFingerprints'].items():assert sha((ROOT/file).read_bytes())==digest
print(json.dumps({'status':'passed','completeSourceCases':100,'assetHashesAndOriginalCopiesVerified':checked_assets,'allCorePdfPageViewsVerified':pdf_pages,'originalFrozenExamplesUnchanged':len(ex['sourceExampleFingerprints']),'humanLabelsAndPredictions':0,'splitAndCandidateFreezeStillPending':True,'sixFailureRecordsRemainIncomplete':True,'authorizedOverallNetworkCapsRespected':True,'helperOneByteAllocationOverrunDisclosed':True,'candidateExtractorScorerModelCalls':0,'sourceContentDisclosed':False}))
