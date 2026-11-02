'use server';
import {redirect} from 'next/navigation';
import {requireTrackerSession} from '../../lib/auth/session';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function proposeMatch(form:FormData){
 const {supabase}=await requireTrackerSession();const left=String(form.get('left_id')||''),right=String(form.get('right_id')||''),reason=String(form.get('reason')||'').trim();
 if(!uuid.test(left)||!uuid.test(right)||left===right||!reason||reason.length>2000)redirect('/extractions/matches?message=invalid');
 const result=await supabase.rpc('reconciliation_propose',{p_kind:'occurrence',p_left_id:left,p_right_id:right,p_reason:reason});
 const row=Array.isArray(result.data)?result.data[0]:result.data;
 if(result.error||!row||!uuid.test(row.id))redirect('/extractions/matches?message=failed');
 redirect(`/extractions/matches?id=${encodeURIComponent(row.id)}`);
}
export async function reviewMatch(form:FormData){
 const {supabase}=await requireTrackerSession();const id=String(form.get('id')||''),action=String(form.get('action')||''),fingerprint=String(form.get('fingerprint')||'');
 if(!uuid.test(id)||!['confirm','reject','revoke'].includes(action)||!/^[a-f0-9]{64}$/.test(fingerprint)||form.get('confirmed')!=='yes')redirect('/extractions/matches?message=invalid');
 const result=await supabase.rpc('reconciliation_review',{p_id:id,p_action:action,p_expected_fingerprint:fingerprint});
 if(result.error)redirect(`/extractions/matches?id=${encodeURIComponent(id)}&message=changed`);
 redirect(`/extractions/matches?id=${encodeURIComponent(id)}&message=recorded`);
}
