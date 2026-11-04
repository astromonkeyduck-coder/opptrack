#!/usr/bin/env python3
"""Offline, source-only preparation. Never score predictions or open holdout answers."""
import hashlib
import html
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'stage2-acceptance-preparation-v1'
SNAPSHOT = 'private/stage2-review/snapshot-861858544d6817c5'
MAX_CASE_BYTES = 256 * 1024

def read(file):
    path = ROOT / file
    if path.stat().st_size > 25 * 1024 * 1024:
        raise ValueError('Preparation input exceeds its bounded size')
    return json.loads(path.read_text())

def sha(value):
    data = value if isinstance(value, bytes) else json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    return hashlib.sha256(data).hexdigest()

def norm(value):
    value = re.sub(r'\([^)]*\)', ' ', str(value).lower())
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()

def orgs(value):
    return {norm(part) for part in (value or '').split('|') if norm(part)}

def words(value):
    return set(norm(value).split()) - {'the','a','and','of','in','at','for','with','on','fsu','2026','2027'}

def close_title(left, right):
    a, b = words(left), words(right)
    return bool(a and b and (norm(left) == norm(right) or len(a & b) / len(a | b) >= .5))

def overlap(left, right):
    # Hierarchical publisher components and ASLC-style abbreviations are conservative exclusions.
    return any(a == b or (len(set(a.split()) & set(b.split())) / max(1, min(len(a.split()), len(b.split()))) >= .8)
               for a in left for b in right)

def precise_links(text):
    links = set()
    for value in re.findall(r'https?://[^\s<>"\\]+', html.unescape(text.replace('\\/', '/'))):
        value = value.rstrip('.,);]')
        if re.search(r'calendar[.]fsu[.]edu/event/|hq[.]fsu[.]edu/rsvp[?]id=|music[.]fsu[.]edu/event/|openingnights[.]fsu[.]edu/show-details/', value):
            links.add(value.split('#')[0].rstrip('/'))
    return links

def safe_write(file, value):
    path = ROOT / file
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    data = value if isinstance(value, str) else json.dumps(value, indent=2, ensure_ascii=False) + '\n'
    data = data.replace('\r\n', '\n')
    if path.exists():
        if path.read_text() != data:
            raise ValueError('Existing preparation artifact differs; create a new version: '+str(file)+' first differing line '+str(next((i+1 for i,(a,b) in enumerate(zip(path.read_text().splitlines(),data.splitlines())) if a!=b), 'length')))
    else:
        with path.open('x') as out:
            out.write(data)
    path.chmod(0o600)

def source_only_member(member):
    # Deliberately never access the unreviewed member.silverLabels.
    evidence = []
    for item in member['evidence']:
        capture = ROOT / item['capturePath']
        if not str(capture.resolve()).startswith(str((ROOT / SNAPSHOT).resolve()) + '/'):
            raise ValueError('Frozen capture escaped its snapshot')
        if hashlib.sha256(capture.read_bytes()).hexdigest() != item['bodySha256']:
            raise ValueError('Frozen capture changed')
        evidence.append({key: item[key] for key in ['sourceUrl','fetchedAt','contentType','bodySha256','byteCount','originalPointer','rawInput']})
    return {'sourceId': member['sourceId'], 'nativeOpportunityId': member['nativeOpportunityId'], 'evidence': evidence}

def category(event):
    text = event.get('title','') + ' ' + event.get('description_text','')
    for name, pattern in [('outdoors',r'hik|outdoor|kayak'),('film',r'film|screening|cinema'),('music',r'concert|recital|music|jazz'),('deadline_or_registration_candidate',r'deadline|application|register by|registration|apply by'),('research',r'defense|dissertation|research'),('career',r'career|employer|recruit'),('speaker',r'lecture|speaker|policy|seminar'),('social',r'social|club|game|workshop')]:
        if re.search(pattern, text, re.I): return name
    return 'other_campus'

first = read('reports/stage-2-first-ten-human-review.json')
next25 = read('reports/stage-2-next25-human-review.json')
inventory_bytes = (ROOT / SNAPSHOT / 'inventory.json').read_bytes()
if sha(inventory_bytes) != first['frozenInventorySha256']:
    raise ValueError('Original hundred-example inventory changed')
inventory = json.loads(inventory_bytes)
if inventory['split'] != 'development_review_pending_only_no_acceptance_holdout':
    raise ValueError('This tool cannot read an assigned holdout')
rows = inventory['examples']
approved_ids = {item['exampleId'] for item in first['examples']} | {item['exampleId'] for item in next25['inventoryExamples']}
if len(approved_ids) != 30 or next25['counts']['totalReviewedDevelopmentExamples'] != 35:
    raise ValueError('Expected exact existing 35-development approval checkpoint')
approved_rows = [row for row in rows if row['id'] in approved_ids]
excluded_orgs = set().union(*(orgs(row['organizer']) for row in approved_rows))
# Known producer/umbrella aliases of approved development routes/media. Human review can only tighten this provisional blocklist.
excluded_orgs |= {norm(x) for x in ['Career Center','FSU HQ','Office of Research','Office of National Fellowships','College of Music','FSU Coastal and Marine Laboratory','Askew Student Life Center','Student Union']}
dev_titles = []
for row in approved_rows:
    example = read(row['path'])
    if sha((ROOT / row['path']).read_bytes()) != row['contentSha256']:
        raise ValueError('An approved frozen example changed')
    # Approved development labels may be used for contamination EXCLUSION only, never to produce a holdout label/input.
    dev_titles.extend(member['silverLabels']['opportunity']['title'] for member in example['members'])
dev_titles += ['2nd Neutron Nexus Workshop Engineering Materials','Boren Awards','Science and Diving SCUBA as a tool for research','Apalachicola National Estuarine Research Reserve Science Partnerships and Action']
all_existing_native = set()
all_existing_links = set()
all_existing_source_titles = set()
for row in rows:
    if sha((ROOT / row['path']).read_bytes()) != row['contentSha256']:
        raise ValueError('An original unreviewed or development example changed')
    example = read(row['path'])
    all_existing_native.update((member['sourceId'], member['nativeOpportunityId']) for member in example['members'])
    for member in example['members']:
        for evidence in member['evidence']:
            raw = evidence['rawInput']
            all_existing_links |= precise_links(raw)
            if 'json' in evidence['contentType']:
                source = json.loads(raw)
                title = source.get('title') or source.get('name')
                if isinstance(title, str): all_existing_source_titles.add(norm(title))
            elif 'calendar' in evidence['contentType']:
                title = re.search(r'^SUMMARY(?:;[^:]*)?:(.*)$', raw, re.M)
                if title: all_existing_source_titles.add(norm(title.group(1)))

batch_path = 'private/stage1-reingestion-live/fsu-calendar-api.json'
batch_bytes = (ROOT / batch_path).read_bytes()
batch = json.loads(batch_bytes)
if batch['sourceId'] != 'fsu-calendar-api' or batch['status'] != 'success' or not batch['observations']['paginationComplete']:
    raise ValueError('A complete permitted public source capture is required')
events = {}
for page in batch['pages']:
    if sha(page['body'].encode()) != page['sha256'] or len(page['body'].encode()) != page['byteCount']:
        raise ValueError('Original public body hash/bytes differ')
    for index, wrapped in enumerate(json.loads(page['body'])['events']):
        event = wrapped['event']
        # Keep every captured observation of this source opportunity together.
        record = events.setdefault(str(event['id']), {'event':event, 'observations':[]})
        record['observations'].append((page,index,event))

allowed_fields = ['id','title','url','localist_url','localist_ics_url','created_at','updated_at','description','description_text','location','location_name','room_number','address','status','recurring','free','ticket_url','ticket_cost','has_register','departments','filters','event_instances','photo_url','photo_caption']
pool, exclusions = [], Counter()
for native, record in events.items():
    event = record['event']
    names = [item.get('name') or item.get('title') for item in event.get('departments',[]) if isinstance(item,dict)]
    names = [name for name in names if name]
    groups = {norm(name) for name in names}
    if not groups: exclusions['unknown_publisher_organizer'] += 1; continue
    if overlap(groups, excluded_orgs): exclusions['development_organizer_or_alias_overlap'] += 1; continue
    if ('fsu-calendar-api', native) in all_existing_native: exclusions['already_in_original_hundred'] += 1; continue
    if precise_links(json.dumps(event)) & all_existing_links: exclusions['precise_event_link_alias_to_original_hundred'] += 1; continue
    if norm(event.get('title','')) in all_existing_source_titles: exclusions['exact_source_title_alias_to_original_hundred'] += 1; continue
    if any(close_title(event.get('title',''), title) for title in dev_titles): exclusions['development_title_or_semantic_overlap'] += 1; continue
    family = 'publisher-organizer:' + sha(sorted(groups))[:24]
    case = {'id':'holdout-candidate-central-' + native,'sourceKind':'public_json','nativeOpportunityId':native,'organizerNames':names,'organizerGroup':family,'opportunityFamily':'localist:'+native,'selectionCategory':category(event),'sourceWindow':{'from':batch['startedAt'],'to':batch['finishedAt']},'sourceBatchSha256':sha(batch_bytes),'priorSourceExposure':'Captured before assignment; no candidate holdout prediction or human canonical labels prepared by this tool. Independent exposure review is required.'}
    evidence=[]
    for page,index,original in record['observations']:
        payload={field:original[field] for field in allowed_fields if field in original}
        evidence.append({'sourceUrl':page['url'],'sourceCaptureSha256':page['sha256'],'fetchedAt':page['fetchedAt'],'originalPointer':f'/events/{index}/event','sourcePayload':payload,'sourcePayloadSha256':sha(payload)})
    case['evidence']=evidence
    if len(json.dumps(case).encode()) > MAX_CASE_BYTES: exclusions['case_size_bound'] += 1; continue
    pool.append(case)

# Deterministic round robin keeps a large thesis publisher from dominating the sample.
by_group=defaultdict(list)
for case in sorted(pool,key=lambda item:sha(item['id'])): by_group[case['organizerGroup']].append(case)
selected=[]
for depth in range(8):
    for group in sorted(by_group):
        if depth < len(by_group[group]): selected.append(by_group[group][depth])
        if len(selected)==40: break
    if len(selected)==40: break
if len(selected)<40:
    # Report actual attainable count rather than invent or duplicate cases.
    pass
holdout_orgs=set().union(*(set(map(norm,item['organizerNames'])) for item in selected)) if selected else set()
reserved_families={item['opportunityFamily'] for item in selected}
new_dev=[]
for row in sorted(rows,key=lambda row:(row['primarySource'],sha(row['id']))):
    if row['id'] in approved_ids or overlap(orgs(row['organizer']),holdout_orgs): continue
    example=read(row['path'])
    new_dev.append({'id':row['id'],'familyId':row['familyId'],'sourceKind':'frozen_public_source_members','organizerNames':(row['organizer'] or '').split('|'),'familyStatus':'Requires human canonical/organizer adjudication','selectionCategory':row['category'],'sourceExampleSha256':row['contentSha256'],'members':[source_only_member(member) for member in example['members']]})
    if len(new_dev)==25: break

identity={'version':VERSION,'selectionRevision':'strict-alias-exclusion-and-pack-scope-v3','inventorySha256':sha(inventory_bytes),'approvalFilesSha256':[sha((ROOT/'reports/stage-2-first-ten-human-review.json').read_bytes()),sha((ROOT/'reports/stage-2-next25-human-review.json').read_bytes())],'publicBatchSha256':sha(batch_bytes),'holdoutIds':[item['id'] for item in selected],'newDevelopmentIds':[item['id'] for item in new_dev]}
packet_id=sha(identity)
directory=f'private/stage2-acceptance-preparation/{packet_id[:16]}'
policy={
 'status':'candidate_preparation_only_not_assigned_or_human_reviewed',
 'runtimeFreezeRequiredBeforeHumanHoldoutLabelsOrAnyPredictions':True,
 'freezeRequirement':'Hash every candidate runtime, prompt/config, source-input transform, canonical field/entity matching contract and scorer BEFORE releasing holdout factual labels or running any holdout predictions. Root must supply a separate candidate-freeze manifest.',
 'existingRecallTarget':.95,'existingRepositoryProvisionalMinimumReviewedHoldout':40,'workingGeneralReleaseHoldoutTarget':100,'scopeAdjudicationRequired':True,
 'scopeEvidence':{'packGeneralRelease':'FSU_Opportunity_Tracker_Build_Pack.txt:250 says human-labeled holdout starting near100 diverse examples','stage2Prompt':'Same pack:298 says roughly100 varied examples separated into development and holdout','repository':'docs/stage-2-evaluation.md:31 calls40 a provisional declared target, not a pack minimum'},
 'scopePolicy':'Use the stricter near100 independent human holdout as the working release target until owner adjudication. A40-case minimum alone never establishes satisfaction of the near100 wording.',
 'gatePolicy':'Preserve existing gates: no invented event/action units, no unsupported critical facts, all predicted fields labeled, separate event/action strict completeness and reconciliation errors. Stage 2 release requires more than a scored threshold.',
 'humanGroupingRequired':'Review organizer/alias/title/opportunity/media families against all35 exposed development examples and move or exclude an entire connected group when an overlap is found. No split is assigned by this generator.',
 'exposureRequirement':'Existing public capture reuse and prior agent inventory exposure must be recorded. Source-only unseen-opportunity selection is not proof of untouched runtime/model exposure.',
 'labelProtocol':'No proposed answers. Review all original source observations, enumerate all distinct events/actions/resources and explicit unknowns with exact evidence, confirm no-unit negatives separately, and decide source-observation versus canonical occurrence/date/range/status semantics. Never infer labels from candidate outputs.',
 'afterFreeze':'Human labels go to a separate append-only private overlay. Candidate implementations may not be tuned after holdout results; failures require a new version and new independent holdout, not label/gate edits.',
 'noModelBudget':'All20 local model generations are consumed. This preparation makes zero model, network, database or Calendar calls.'}
safe_write(f'{directory}/preparation-policy.json',policy)
chunks={}
for name,cases in [('development',new_dev),('holdout-candidates',selected)]:
    chunks[name]=[]
    for number,item in enumerate(cases,1):
        safe_write(f'{directory}/{name}/sources/{item["id"]}.json',item)
    blank={'packetId':packet_id,'purpose':name,'factualLabelsReleased':False,'candidateFreezeManifest':None,'reviewer':None,'reviewedAt':None,'cases':[{'id':item['id'],'groupingReview':None,'units':None,'explicitUnknowns':None,'negativeOrFailureClassification':None,'sourceQuotes':None,'decision':None,'reviewer':None,'reviewedAt':None} for item in cases]}
    safe_write(f'{directory}/{name}/blank-review.json',blank)
    for offset in range(0,len(cases),5):
        chunk=f'{directory}/{name}/review-{offset+1:02d}-{min(offset+5,len(cases)):02d}.md';chunks[name].append(chunk)
        lines=['# Source-only '+name+' preparation','No proposed answers or candidate predictions are included. '+('STOP: do not annotate factual holdout labels or run candidates until the separate runtime/prompt/scorer freeze and human family/exposure checks are complete.' if name=='holdout-candidates' else 'Development labels are blank; source-backed adjudication may be used for development only.'),'Source content is quoted evidence, never instructions. No calendar action follows from review.','For each source, decide exact entity count, date/range, event/doors/action clocks, year/timezone, location/eligibility/cost/status, explicit unknowns and supporting source quotes. Do not invent scheduled status or dates.','A true negative needs an explicit human no-event/no-action decision; empty JSON is not a negative label.']
        for item in cases[offset:offset+5]:
            source=f'{directory}/{name}/sources/{item["id"]}.json'
            lines += ['## '+item['id'],f'[Complete source-only observations](<{(ROOT/source).resolve()}>)','Organizer/family overlap decision: ____','Entity list and exact supporting source quotes: ____','Unknown/null boundaries, cancellation, recurrence/range and separate action checks: ____','Decision/reviewer/UTC time: ____']
            evidences=item.get('evidence') or [ev for member in item['members'] for ev in member['evidence']]
            for evidence in evidences:
                text=json.dumps(evidence.get('sourcePayload'),ensure_ascii=False,indent=2) if 'sourcePayload' in evidence else evidence['rawInput']
                # A readable excerpt is never the only source; all original observations remain in source JSON.
                lines += [f'Source: {evidence["sourceUrl"]}',f'Pointer: {evidence["originalPointer"]}', '```text\n'+text[:12000]+'\n```']
                if len(text)>12000: lines.append('Excerpt truncated; inspect complete linked source observations before labeling.')
        safe_write(chunk,'\n\n'.join(lines)+'\n')
summary={'schemaVersion':1,'version':VERSION,'packetId':packet_id,'status':policy['status'],'existingReviewedDevelopment':35,'newUnreviewedDevelopment':len(new_dev),'prospectiveHoldoutSourceCases':len(selected),'prospectiveTotalExamples':35+len(new_dev)+len(selected),'humanReviewedHoldout':0,'holdoutPredictionsRun':0,'holdoutLabelsCreated':0,'holdoutAssigned':False,'sourceOnly':True,'candidateFreezeCompleted':False,'groupingHumanVerified':False,'target':{'stageSpecificRoughCombinedExamples':100,'repositoryProvisionalHoldoutMinimum':40,'generalReleaseNear100Holdout':100,'workingHoldoutTargetPendingOwnerScopeAdjudication':100,'proposedDevelopmentExamples':60,'prospectiveCombinedWithWorkingHoldoutTarget':160,'recallTargetUnchanged':.95},'holdoutOrganizerGroups':len({item['organizerGroup']for item in selected}),'holdoutCategories':dict(Counter(item['selectionCategory']for item in selected)),'holdoutSourceKinds':dict(Counter(item['sourceKind']for item in selected)),'exclusions':dict(exclusions),'privateArtifacts':{'directory':directory,'policy':f'{directory}/preparation-policy.json','adjudicationFirst':f'{directory}/adjudication-first.md','developmentBatches':chunks['development'],'holdoutSourceBatches':chunks['holdout-candidates'],'developmentReview':f'{directory}/development/blank-review.json','holdoutReview':f'{directory}/holdout-candidates/blank-review.json'},'identity':identity,'additionalSourceCasesToProvisional40':max(0,40-len(selected)),'additionalSourceCasesToWorkingNear100Holdout':max(0,100-len(selected)),'eligibleSourceOpportunityPool':len(pool),'maxPerOrganizerInThisPreparation':8,'missingStrata':['Human-confirmed independent negatives and realistic source/processing failures in holdout','Actual unexposed flyer/image/all-page PDF families in holdout','Separate supported application/ticket/deadline action units in holdout','True carousel bytes and complete source manifest unavailable under current social access; no substitute claim','Independent duplicate/nonduplicate reconciliation pair labels tied to whole family groups'],'nextActions':['Freeze v4 and all candidate/config/prompt/scorer hashes before factual holdout annotation or prediction','Human-review family aliases/exposure; reject overlaps as whole connected groups','Adjudicate conflicting corpus-size wording; the working target remains near100 independent human holdout, not40 alone','Collect permitted fresh independent action/media/negative/failure examples to replace/supplement this JSON-heavy roster before final split','Review source-only development batches and adjudication audit separately','Have human annotate the finalized holdout without model proposals, then run frozen candidates once'],'preservation':{'originalInventorySha256':sha(inventory_bytes),'originalInventoryUnchanged':sha((ROOT/SNAPSHOT/'inventory.json').read_bytes())==sha(inventory_bytes),'originalExamplesLabelsOverlaysChanged':False,'existingSyntheticHoldoutRead':False,'unreviewedSilverLabelsUsedForHoldoutInputs':False},'calls':{'http':0,'model':0,'database':0,'calendar':0},'stage2Accepted':False}
safe_write(f'{directory}/manifest.json',summary)
report=ROOT/'reports/stage-2-acceptance-preparation.json'
report.write_text(json.dumps(summary,indent=2)+'\n')
manifest={key:summary[key]for key in ['schemaVersion','version','packetId','status','target','candidateFreezeCompleted','holdoutAssigned','holdoutLabelsCreated','holdoutPredictionsRun','missingStrata','nextActions','stage2Accepted']}
manifest['publicSourceCaseIdentities']=[{'id':item['id'],'organizerGroup':item['organizerGroup'],'opportunityFamily':item['opportunityFamily'],'sourceBatchSha256':item['sourceBatchSha256'],'sourcePayloadSha256s':[e['sourcePayloadSha256']for e in item['evidence']]}for item in selected]
manifest['privateManifest']=f'{directory}/manifest.json'
(ROOT/'evaluation/stage2-acceptance-preparation-v1.json').write_text(json.dumps(manifest,indent=2)+'\n')
index=['# Stage 2 review preparation','This is preparation, not an assigned/reviewed holdout or acceptance result.',f'Existing reviewed development:35. New development sources:{len(new_dev)}. Prospective source-only holdout cases:{len(selected)}. Total candidate examples:{35+len(new_dev)+len(selected)}.','## Development batches',*[f'- [Five source examples](<{(ROOT/f).resolve()}>)'for f in chunks['development']],'## Prospective holdout source batches','Do not annotate factual labels or run predictions before candidate/scorer freeze and human organizer/exposure review.',*[f'- [Five source-only candidates](<{(ROOT/f).resolve()}>)'for f in chunks['holdout-candidates']],'## Still needed',*['- '+item for item in summary['missingStrata']]]
safe_write(f'{directory}/index.md','\n\n'.join(index)+'\n')
adjudication=['# Human adjudication before a scored acceptance set',
 'No reference label, scorer denominator or acceptance gate has been changed. Current candidates and all35 approved development examples stay separate from an unassigned holdout.',
 '1. Status: should publishing status live or a retained ICS item with no STATUS remain canonical unknown unless that provider contract affirmatively establishes scheduled? There are31 missing-status penalties (9 publishing-live,22 no retained ICS STATUS). Please confirm the provider-specific rule with its evidence; do not approve invented scheduled values to raise recall.',
 '2. Units: measure extraction on every source observation AND canonical occurrence/reconciliation once per actual occurrence, as separate metrics? Four duplicate interval pairs are documented. Human-confirm the aliases before any new denominator is frozen.',
 '3. Date: keep literal source date separately from the event-local date, and require a stated zone before converting? The same Senate interval is Nov4 in source-local text and Nov5 UTC; both cannot be treated as an unexplained single date field.',
 '4. Ranges/partial facts: should a multi-day range remain one range/program unless separate performances are stated, and missing-year clock/month-day/month-only facts remain explicit partial facts? Alash/Barron and ORNL/Marine/Boren need these canonical decisions; no year/day/instant should be invented.',
 '5. Family boundaries: confirm organizer aliases, exact event links and recurring/media families, including the same Megan recital in Music003 and Central070. Any connected family must remain entirely in development or holdout.',
 '6. Corpus size: pack line250 asks for a human-labeled holdout starting near100; Stage2line298 asks for roughly100 examples separated across both splits, while repo40 is explicitly provisional. The working release plan follows the stricter near100 holdout until you adjudicate the scope.34 prospective cases do not satisfy either40 ornear100.',
 'Recommended immediate review: answer these contracts first, then review the first five source-only DEVELOPMENT examples. Do not label any prospective holdout facts or run v4 until the runtime/prompt/source-transform/canonical-matching/scorer freeze is separately recorded.',
 f'[First five development sources](<{(ROOT/chunks["development"][0]).resolve()}>)',
 '[Detailed source-backed audit](<'+str((ROOT/'reports/stage-2-label-adjudication-audit.json').resolve())+'>)',
 'Reviewer / UTC time / source-backed corrections: ____']
safe_write(f'{directory}/adjudication-first.md','\n\n'.join(adjudication)+'\n')

print(json.dumps({'report':str(report),'newDevelopment':len(new_dev),'holdoutSourceCandidates':len(selected),'totalExamples':summary['prospectiveTotalExamples'],'holdoutOrganizerGroups':summary['holdoutOrganizerGroups'],'index':str((ROOT/directory/'index.md').resolve()),'humanHoldoutLabels':0,'holdoutPredictions':0}))
