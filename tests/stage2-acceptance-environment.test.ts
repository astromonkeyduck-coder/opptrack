/** Synthetic version records only; no installed tool or real source is opened. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAcceptanceEnvironment } from '../evaluation/stage2-acceptance-environment';
import { projectCanonicalComparison } from '../evaluation/stage2-acceptance-canonical';
import type { CandidateFreeze } from '../evaluation/stage2-acceptance-guards';
const versions={nodeVersion:'SYNTHETIC NODE',tesseract:'SYNTHETIC TESS',pdfinfo:'SYNTHETIC PDF',pdftotext:'SYNTHETIC TEXT',pdftoppm:'SYNTHETIC PPM',sharp:'SYNTHETIC SHARP'};
const freeze={environment:{nodeVersion:versions.nodeVersion,nativeTools:versions,locale:'C',timeZone:'UTC'}} as unknown as Pick<CandidateFreeze,'environment'>;
test('frozen environment is checked against observed nonsecret versions, not only its own hash',()=>{assert.doesNotThrow(()=>assertAcceptanceEnvironment(freeze,versions));assert.throws(()=>assertAcceptanceEnvironment(freeze,{...versions,nodeVersion:'SYNTHETIC changed'}),/Actual Node/);assert.throws(()=>assertAcceptanceEnvironment(freeze,{...versions,pdfinfo:'SYNTHETIC changed'}),/Actual native/);});
test('canonical date conversion requires an explicit instant and stated valid zone while source date stays separate',()=>{const candidate={key:'SYNTHETIC',kind:'event' as const,fields:{title:'SYNTHETIC',date:'2026-11-04',startAt:'2026-11-04T02:00:00Z',timeZone:'America/New_York'},claims:[],issues:[]};const projected=projectCanonicalComparison(candidate);assert.equal(projected.date,'2026-11-03');assert.equal(candidate.fields.date,'2026-11-04');assert.equal(projectCanonicalComparison({...candidate,fields:{...candidate.fields,timeZone:null}}).date,null);assert.equal(projectCanonicalComparison({...candidate,fields:{...candidate.fields,timeZone:'SYNTHETIC INVALID'}}).date,null);assert.equal(projectCanonicalComparison({...candidate,fields:{...candidate.fields,startAt:null,timeZone:null}}).date,'2026-11-04');});
