export type MatchableOccurrence={id:string;title:string;source_id:string;source_url:string|null;description?:string|null;starts_at:string|null;ends_at:string|null;location?:string|null;date_precision?:string;status?:string};
export type MatchSuggestion={leftId:string;rightId:string;reason:string;authorityLink:string};
function authorityLinks(row:MatchableOccurrence) {
  const links=new Set<string>();
  const values=[row.source_url,...(row.description||'').match(/https:\/\/hq\.fsu\.edu\/rsvp\?id=\d+/g)||[]];
  for(const value of values){if(!value)continue;try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)continue;for(const key of [...url.searchParams.keys()])if(key.startsWith('utm_'))url.searchParams.delete(key);url.hash='';links.add(url.href);}catch{}}
  return links;
}
/** Suggestions need an explicit common source link and identical verified intervals.
 * Shared title, host, venue or poster alone never establishes the same occurrence. */
export function suggestOccurrenceMatches(rows:MatchableOccurrence[],limit=12):MatchSuggestion[] {
  const result:MatchSuggestion[]=[];
  for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++){
    const left=rows[a],right=rows[b];
    if(left.id===right.id||left.source_id===right.source_id||left.date_precision!=='instant'||right.date_precision!=='instant'||!left.starts_at||!right.starts_at||!left.ends_at||!right.ends_at)continue;
    if(!Number.isFinite(Date.parse(left.starts_at))||!Number.isFinite(Date.parse(left.ends_at))||Date.parse(left.starts_at)!==Date.parse(right.starts_at)||Date.parse(left.ends_at)!==Date.parse(right.ends_at))continue;
    if(left.status!==right.status)continue;
    const links=authorityLinks(right),common=[...authorityLinks(left)].find(link=>links.has(link));if(!common)continue;
    result.push({leftId:left.id,rightId:right.id,reason:'Both listings cite the same HTTPS source and the same verified start and end. Review the titles, organizers and current source facts before linking.',authorityLink:common});
    if(result.length>=Math.max(1,Math.min(30,limit)))return result;
  }
  return result;
}
