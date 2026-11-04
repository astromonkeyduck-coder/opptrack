#!/usr/bin/env python3
"""Isolated holdout source custody only. Prints counts/hashes, never source facts."""
import hashlib,html,json,re,shutil,subprocess
from collections import Counter,defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PRIMARY=ROOT/'private/stage2-holdout-curation/primary-20261103'
HELPER=ROOT/'private/stage2-holdout-curation/helper-20261103'
sha=lambda value:hashlib.sha256(value if isinstance(value,bytes)else json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
read=lambda p:json.loads(p.read_text())
def save(path,value):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);path.parent.chmod(0o700)
 data=value if isinstance(value,bytes)else(json.dumps(value,indent=2,ensure_ascii=False)+'\n').encode()
 if path.exists()and path.read_bytes()!=data:raise ValueError('Sealed artifact differs; preserve it and create a new version')
 if not path.exists():path.write_bytes(data)
 path.chmod(0o600)

primary=read(PRIMARY/'sealed-existing-candidates-v3.json');helper=read(HELPER/'manifest.json');ledger=read(HELPER/'fetch-ledger.json');page_info=read(HELPER/'pdf-page-manifest.json');exclusions=read(PRIMARY/'development-exclusions-v2.json')
assert primary['humanReviewedLabels']==0 and helper['counts']['humanLabels']==0
assert helper['networkBudget']['actualGetAttempts']==20 and helper['networkBudget']['actualBodyBytesObserved']==5242881
assert helper['networkBudget']['actualGetAttempts']<=80 and helper['networkBudget']['actualBodyBytesObserved']<=16*1024*1024
for file,digest in exclusions['sourceExampleFingerprints'].items():assert sha((ROOT/file).read_bytes())==digest
media_approval=read(ROOT/'reports/stage-2-next25-human-review.json')
blocked_media={item['originalSha256']for item in media_approval['mediaExamples']}
for name in ['reports/stage-2-public-image-probe.json']:
 p=ROOT/name
 if p.exists():
  def hashes(v):
   if isinstance(v,dict):
    for k,x in v.items():
     if k in ['sha256','bodySha256']and isinstance(x,str):blocked_media.add(x)
     else:hashes(x)
   elif isinstance(v,list):
    for x in v:hashes(x)
  hashes(read(p))

pdf_pages={row['caseId']:row['pages']for row in page_info['cases']}
producer_for_url={row['url']:row['producer']for row in ledger['ledger']}
blocked_tokens=set(exclusions['blockedOrganizerTokens'])
def normalized_org(value):return re.sub(r'[^a-z0-9]+',' ',str(value).lower()).strip()
def organizer_overlaps(value):
 words=set(normalized_org(value).split())
 return any(words and set(old.split()) and len(words&set(old.split()))/min(len(words),len(set(old.split())))>=.8 for old in blocked_tokens)
new_complete=[];large_pdf=[];helper_overlap_excluded=0
for case in helper['cases']:
 if any(organizer_overlaps(producer_for_url.get(asset['sourceUrl'],''))for asset in case['assets']):
  helper_overlap_excluded+=1;continue
 for asset in case['assets']:
  body=(ROOT/asset['path']).read_bytes();assert len(body)==asset['bytes']and sha(body)==asset['sha256']
  assert asset['captureComplete']and asset['sha256']not in blocked_media
 if case['format']=='pdf':
  case['knownPdfPageCount']=pdf_pages[case['id']]
  if case['knownPdfPageCount']>12:
   case['challengeReason']='Actual complete large PDF beyond one normal twelve-visual-page job allowance; no factual answers/extraction result inferred.'
   large_pdf.append(case);continue
 new_complete.append(case)
existing_json=[c for c in primary['candidateCases']if c['format']=='json']
ics_pool=[c for c in primary['candidateCases']if c['format']=='ics']
needed=100-len(existing_json)-len(new_complete)
assert 0<=needed<=len(ics_pool)
# Alternate broad source-intent categories, keep whole stored recurrence/title families.
by_category=defaultdict(list)
for c in ics_pool:by_category[c['broadCategory']].append(c)
selected=[]
while len(selected)<needed:
 changed=False
 for category in sorted(by_category):
  remaining=[c for c in by_category[category]if c['id']not in{v['id']for v in selected}]
  if remaining:selected.append(remaining[0]);changed=True
  if len(selected)==needed:break
 if not changed:break
core=existing_json+selected+new_complete
assert len(core)==100
partial=[]
for row in ledger['ledger']:
 if row.get('captureComplete')is not False:continue
 path=row.get('rawPath')
 if not path or not (ROOT/path).exists():continue
 body=(ROOT/path).read_bytes()
 assert len(body)==row['bodyBytes']and sha(body)==row['sha256']
 partial.append({'id':'incomplete-'+sha({'index':row['index'],'sha256':row['sha256']})[:20],'format':'partial_response','broadCategory':'actual_operator_bounded_capture_failure','organizerFamilyHash':sha(row['producer']),'opportunityFamilyHash':sha(row['url']),'assets':[{'path':path,'sha256':row['sha256'],'bytes':row['bodyBytes'],'mime':row['contentType'],'sourceUrl':row['url'],'httpStatus':row['httpStatus'],'captureComplete':False}],'labelStatus':'unreviewed','review':{'decision':None},'sourceMetadata':{'actualCaptureState':row['state'],'notAnEmptySuccess':True,'operatorBodyLimitBytes':550000,'productionLimitEquivalenceEstablished':False,'failureScope':'A real interrupted source read under the declared curation cap; not evidence the production4MiB upload/native route would fail or a semantic no-event label.'}})
challenges=partial+large_pdf
identity={'version':'stage2-sealed-holdout-source-preparation-v2','custodyRevision':'explicit-metadata-only-failure-ledger-v2','primaryManifestSha256':sha((PRIMARY/'sealed-existing-candidates-v3.json').read_bytes()),'helperManifestSha256':sha((HELPER/'manifest.json').read_bytes()),'developmentExclusionSha256':sha((PRIMARY/'development-exclusions-v2.json').read_bytes()),'coreSources':[(c['id'],[a['sha256']for a in c['assets']])for c in core],'challenges':[(c['id'],[a['sha256']for a in c['assets']])for c in challenges]}
packet_id=sha(identity);directory=ROOT/'private/stage2-sealed-holdout'/packet_id[:16]
source_manifest=[];challenge_manifest=[]
for scope,cases,target in [('core',core,source_manifest),('challenge',challenges,challenge_manifest)]:
 for i,case in enumerate(cases,1):
  blind=('H'if scope=='core'else'F')+f'{i:03d}'
  record={**case,'blindId':blind,'scope':scope,'assignment':'unassigned_until_candidate_freeze_and_human_grouping_exposure_review','humanLabels':None,'candidatePredictions':None,'goldWasNotUsedToConstructSource':True}
  assets=[]
  for j,asset in enumerate(case['assets'],1):
   body=(ROOT/asset['path']).read_bytes();assert sha(body)==asset['sha256']and len(body)==asset['bytes']
   suffix={'application/json':'.json','text/calendar':'.ics','text/html':'.html','application/pdf':'.pdf','image/png':'.png','image/jpeg':'.jpg'}.get(asset['mime'].split(';')[0],'.bin')
   dest=directory/scope/blind/f'source-{j:02d}{suffix}';save(dest,body)
   item={**asset,'path':str(dest.relative_to(ROOT)),'originalCuratorPath':asset['path']}
   if case['format']=='pdf'and scope=='core':
    count=case['knownPdfPageCount'];prefix=directory/scope/blind/'page'
    expected=[Path(f'{prefix}-{page}.png')for page in range(1,count+1)]
    if not all(p.exists()for p in expected):
     result=subprocess.run([shutil.which('pdftoppm')or'/opt/homebrew/bin/pdftoppm','-r','96','-png',str(dest),str(prefix)],capture_output=True,timeout=60)
     if result.returncode:raise ValueError('Sealed PDF page rendering failed; do not claim complete source views')
    rendered=sorted(prefix.parent.glob('page-*.png'))
    assert len(rendered)==count
    item['allPageViews']=[{'path':str(p.relative_to(ROOT)),'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size,'page':n}for n,p in enumerate(rendered,1)]
    item['allOriginalPdfPagesRetained']=True
   assets.append(item)
  record['assets']=assets
  save(directory/scope/blind/'source-record.json',record)
  target.append({'blindId':blind,'sourceRecord':str((directory/scope/blind/'source-record.json').relative_to(ROOT)),'sourceRecordSha256':sha((directory/scope/blind/'source-record.json').read_bytes()),'format':case['format'],'broadCategory':case['broadCategory'],'organizerFamilyHash':case['organizerFamilyHash'],'opportunityFamilyHash':case['opportunityFamilyHash'],'assetHashes':[a['sha256']for a in assets]})

all_records=source_manifest+challenge_manifest
blank={'packetId':packet_id,'status':'not_released_for_factual_labeling','candidateFreezeManifest':None,'familyExposureReviewComplete':False,'factualGold':None,'cases':[{'blindId':r['blindId'],'sourceObservationEntities':None,'canonicalOccurrencesActionsResources':None,'explicitUnknowns':None,'cancellationOrRangeDecision':None,'negativeOrFailureDecision':None,'exactFieldEvidence':None,'groupingAliases':None,'decision':None,'reviewer':None,'reviewedAt':None}for r in all_records]}
save(directory/'blank-human-review.json',blank)
pairs=[]
by_org=defaultdict(list)
for row in source_manifest:by_org[row['organizerFamilyHash']].append(row)
for group,rows in sorted(by_org.items()):
 if len(rows)>1:pairs.append({'id':f'P{len(pairs)+1:03d}','left':rows[0]['blindId'],'right':rows[1]['blindId'],'selectionBasis':'same provisional publisher; relation is NOT inferred','humanRelation':None,'sourceEvidence':None,'reviewer':None,'reviewedAt':None})
 if len(pairs)>=12:break
save(directory/'blank-reconciliation-review.json',{'status':'candidate_pairs_not_labeled_or_scored','packetId':packet_id,'pairs':pairs,'note':'Same publisher does not establish same opportunity/occurrence. Add source-backed true duplicates and separate-performance negatives only after human whole-family review; no merge truth is generated.'})
policy={'packetId':packet_id,'status':'sealed_unassigned_unlabeled_no_predictions','strictWorkingHoldoutTarget':100,'repository40IsProvisionalNotSatisfactionOfNear100PackWording':True,'humanScopeAdjudicationPending':True,'releaseGate':'Do not create or expose factual holdout labels or run any candidate until runtime/config/prompt/media/source-transform/canonical-matching/scorer hashes are frozen in a separate manifest. Root is currently editing runtime and receives counts/hashes only.','sourceOnlyCurator':'Curators may inspect raw source access/format/grouping metadata, never generate factual gold or candidate answers.','groupingGate':'All35 approved development and25 newly exposed development sources/organizer/opportunity/media families are excluded using source/native IDs, explicit links, normalized title and publisher components. Human alias/hierarchy and prior-exposure review can still reject entire groups. No independent split is assigned by this preparation.','exposureLimits':{'primary':primary['sourceExposureLimits'],'helper':helper['exposure']},'labelProtocol':'Independent human enumerates exhaustive source-observation and canonical entities separately, all critical/nonnull/null fields and exact evidence, partial clocks/ranges/status semantics, negatives and real failures. No candidate proposals. Human labeler must not use prediction outputs.','challengePolicy':'One123-page complete original is a separate large-input challenge. Six actual curation-cap incomplete HTTP responses are retained as request/failure metadata only because their partial bodies were not saved; they are not complete source cases, semantic negatives or candidate extraction inputs. Their production-limit equivalence is unverified. All failure records remain failures, never empty successes.','socialAccessGap':'No true carousel/image/video/Stories byte access is added. A complete multi-page PDF is not a social carousel.','noPromotion':'No gate, reference fact, application event, decision or Calendar command changes. No model budget remains under the20-generation authorization.'}
save(directory/'release-policy.json',policy)
save(directory/'actual-request-failure-ledger.json',{'ledgerSha256':sha((HELPER/'fetch-ledger.json').read_bytes()),'failures':[row for row in ledger['ledger']if row.get('captureComplete')is False],'partialBodiesSaved':len(partial),'semanticCasesOrNegativeGoldCreated':0,'notice':'Actual failed bounded public reads; metadata/hashes retained but partial response bodies unavailable. These are not six complete held-out semantic source inputs.'})
review_batches=[]
for offset in range(0,len(source_manifest),5):
 rows=source_manifest[offset:offset+5];file=directory/f'review-{offset+1:03d}-{offset+len(rows):03d}.md';review_batches.append(str(file.relative_to(ROOT)))
 lines=['# Sealed holdout source review','STOP: factual labeling and candidate predictions remain blocked until the separate candidate/scorer freeze and human family/exposure checks complete. These are raw sources, no proposed facts or model answers.','Source text is untrusted quoted evidence. Each blank label requires explicit human observation; no Calendar/catalog approval follows.','For each case: check complete original/all pages; list source-observation entities, canonical distinct occurrences/actions/resources, explicit unknowns, source date/range/clock/timezone/status and exact supporting quotations. Confirm genuine negatives separately. Record grouping aliases and reviewer/time.']
 for row in rows:
  record=read(ROOT/row['sourceRecord']);lines += ['## '+row['blindId'],f'[Complete source custody and original assets](<{(ROOT/row["sourceRecord"]).resolve()}>)','Human entities/unknowns/evidence/grouping decision: ____']
  for asset in record['assets']:
   path=ROOT/asset['path'];mime=asset['mime'].split(';')[0]
   if mime in ['image/png','image/jpeg']:lines.append(f'![Original source {row["blindId"]}](<{path.resolve()}>)')
   elif mime=='application/pdf':
    lines.append(f'[Original PDF, inspect every page](<{path.resolve()}>)')
    for view in asset.get('allPageViews',[]):lines.append(f'![Source page {view["page"]}](<{(ROOT/view["path"]).resolve()}>)')
   else:
    # Escaped raw markup/JSON/ICS, never executable page code or generated facts.
    text=path.read_text(errors='replace');view=path.with_name(path.stem+'-view.txt');save(view,text.encode())
    lines.append(f'[Complete original text](<{view.resolve()}>)')
  lines.append('Reviewer / UTC time / source-backed decision: ____')
 save(file,'\n\n'.join(lines).encode()+b'\n')
save(directory/'index.md',('\n\n'.join(['# Sealed prospective holdout','100 complete source cases plus a separate large-PDF challenge and six request-failure ledger records; zero human factual labels and zero predictions. Do not label or run candidates before the separate runtime/scorer freeze and family/exposure review.','The root runtime engineer has received no source titles, contents or answers.',*[f'- [Five source cases](<{(ROOT/p).resolve()}>)'for p in review_batches]])+'\n').encode())
manifest={'schemaVersion':2,'packetId':packet_id,'identity':identity,'status':policy['status'],'coreCases':source_manifest,'challengeCases':challenge_manifest,'blankHumanReview':str((directory/'blank-human-review.json').relative_to(ROOT)),'blankReconciliationReview':str((directory/'blank-reconciliation-review.json').relative_to(ROOT)),'releasePolicy':str((directory/'release-policy.json').relative_to(ROOT)),'reviewBatches':review_batches,'humanLabels':0,'candidatePredictions':0,'candidateFreezeCompleted':False,'holdoutAssigned':False,'stage2Accepted':False}
save(directory/'integrity-manifest.json',manifest)
public={'schemaVersion':2,'packetId':packet_id,'status':policy['status'],'completeCoreSourceCases':len(source_manifest),'separateChallengeCases':len(challenge_manifest),'formatCounts':dict(Counter(r['format']for r in source_manifest)),'selectionIntentCategoryCountsNotGold':dict(Counter(r['broadCategory']for r in source_manifest)),'provisionalPublisherGroups':len({r['organizerFamilyHash']for r in source_manifest}),'sourceOpportunityGroups':len({r['opportunityFamilyHash']for r in source_manifest}),'humanReviewedHoldout':0,'goldLabelsCreated':0,'candidatePredictionsRun':0,'holdoutAssigned':False,'candidateFreezeCompleted':False,'strictWorkingHoldoutTarget':100,'corpusSizeScopeAdjudicationPending':True,'existingApprovedDevelopment':35,'additionalExposedDevelopmentExcluded':25,'wholeRecurrenceFamiliesTogether':True,'completeSmallPdfDocuments':sum(r['format']=='pdf'for r in source_manifest),'renderedOriginalPdfPages':sum(c.get('knownPdfPageCount',0)for c in new_complete if c['format']=='pdf'),'largePdfChallengePages':sum(c['knownPdfPageCount']for c in large_pdf),'realSocialCarouselCaptured':False,'network':{'maximumGetsAuthorized':80,'actualGets':20,'maximumBodyBytesAuthorized':16*1024*1024,'actualBodyBytes':5242881,'overallWithinAuthorizedCaps':True,'helperAllocationOverrunBytes':1,'helperAllocationOverrunDisclosed':True,'furtherRequestsIssuedAfterOverrun':0,'completeFreshBodies':len(helper['cases']),'helperCasesExcludedForDevelopmentProducerOverlap':helper_overlap_excluded,'incompleteBodiesNeverCalledEmptySuccess':helper['networkBudget']['incompleteBodyLimitFailures'],'incompletePartialBodiesRetained':len(partial),'failureMetadataOnlyRecords':helper['networkBudget']['incompleteBodyLimitFailures']-len(partial)},'calls':{'model':0,'candidateExtractor':0,'scorer':0,'database':0,'calendar':0},'sealedArtifacts':{'directory':str(directory.relative_to(ROOT)),'integrityManifest':str((directory/'integrity-manifest.json').relative_to(ROOT)),'integrityManifestSha256':sha((directory/'integrity-manifest.json').read_bytes()),'releasePolicySha256':sha((directory/'release-policy.json').read_bytes())},'sourceExposureLimits':['All35 reviewed and25 newly exposed development families are screened; publisher aliases/hierarchies/media reuse still need independent human review before assignment.','Prior public collection response exposure is recorded;100 sources do not by themselves prove an untouched independent holdout.34JSON candidate IDs/source-only preparation files existed before isolation; runtime-engineer exposure must be explicitly checked, not assumed absent.','Categories are source-selection intents, not event/action/negative ground truth.','Factual labels, source-to-canonical mapping and a candidate/scorer freeze remain absent; strict pass/fail cannot be evaluated.','True social carousels remain an explicit unavailable-access stratum, with no permission expansion.'],'preservation':{'originalHundredExamplesHashesVerified':len(exclusions['sourceExampleFingerprints']),'originalExamplesLabelsOverlaysChanged':False,'existingSyntheticHoldoutAnswersRead':False},'stage2Accepted':False}
(ROOT/'reports/stage-2-sealed-holdout-preparation.json').write_text(json.dumps(public,indent=2)+'\n')
(ROOT/'evaluation/stage2-sealed-holdout-preparation-v2.json').write_text(json.dumps({'schemaVersion':2,'packetId':packet_id,'status':policy['status'],'sourceCount':100,'strictWorkingHoldoutTarget':100,'assignmentFrozen':False,'candidateFreezeCompleted':False,'humanReviewed':0,'predictions':0,'sourceIntegrityManifestSha256':public['sealedArtifacts']['integrityManifestSha256'],'privateManifest':public['sealedArtifacts']['integrityManifest'],'publicReport':'reports/stage-2-sealed-holdout-preparation.json','contentAndAnswersDisclosedToRuntimeEngineer':False,'stage2Accepted':False},indent=2)+'\n')
print(json.dumps({k:public[k]for k in ['packetId','completeCoreSourceCases','separateChallengeCases','formatCounts','provisionalPublisherGroups','renderedOriginalPdfPages','largePdfChallengePages','humanReviewedHoldout','candidatePredictionsRun','holdoutAssigned','network']}))
