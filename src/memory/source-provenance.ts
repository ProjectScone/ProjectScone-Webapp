export interface ProvenanceSource {space:string;episodeId:number;content:string}
export interface SourceSpan {start:number;end:number;text:string}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid source provenance record');return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string'||v.length>1000000)throw Error('Invalid source provenance text');return v;};
const count=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('Invalid source provenance count');return v;};
const id=(v:unknown):number=>{const n=count(v);if(!n)throw Error('Invalid source record identity');return n;};
const flag=(v:unknown):boolean=>{if(typeof v!=='boolean')throw Error('Invalid source provenance flag');return v;};
const list=(v:unknown,max=1000):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw Error('Invalid source provenance list');return v;};
function unique<T>(values:T[]):T[]{if(new Set(values).size!==values.length)throw Error('Duplicate source provenance identity');return values;}
function entityId(v:unknown):string {const s=text(v);if(!s.startsWith('ent:')||s.length<=4||s.length>200)throw Error('Invalid named entity identity');return s;}
const nullableText=(v:unknown)=>v===null?null:text(v);
export async function parseSourceProvenance(value:unknown,source:ProvenanceSource,limits={maxChunks:1000,maxClaims:1000}){
 if(![limits.maxChunks,limits.maxClaims].every(limit=>Number.isInteger(limit)&&limit>=1&&limit<=1000))throw Error('Invalid requested source provenance limit');
 const v=object(value),episode=object(v.episode),c=object(v.coverage),read=object(c.read);
 const bytes=new TextEncoder().encode(source.content);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(v.schema_version!==1||v.space!==source.space||episode.id!==source.episodeId||episode.bytes!==bytes.length||episode.content_sha256!==hash||v.consistent!==true)throw Error('This provenance does not match the retained original. Refresh the source and try again.');
 const span=(value:unknown):SourceSpan=>{const s=object(value),start=count(s.start),end=count(s.end);if(start>end||end>bytes.length)throw Error('Source span is outside the original');try{return {start,end,text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(start,end))};}catch{throw Error('Source span splits a UTF-8 character');}};
 const sections=list(v.sections,20000).map(value=>{const s=object(value),level=count(s.level);if(level<1||level>6)throw Error('Invalid heading level');return {id:text(s.id),title:text(s.title),level,parent:nullableText(s.parent),span:span(s)};});unique(sections.map(s=>s.id));
 const chunks=list(v.chunks,limits.maxChunks).map(value=>{const chunk=object(value);return {id:id(chunk.chunk_id),ordinal:count(chunk.ordinal),span:span(chunk),section:nullableText(chunk.section)};});unique(chunks.map(chunk=>chunk.id));unique(chunks.map(chunk=>chunk.ordinal));
 const chunksTotal=count(c.chunks_total),truncated=flag(c.truncated),reasons=list(c.reasons,50).map(text),readReasons=list(read.reasons,50).map(text);
 if(c.chunks_shown!==chunks.length||chunksTotal<chunks.length||(!truncated&&(reasons.length||readReasons.length))||readReasons.some(reason=>!reasons.includes(reason)))throw Error('Source provenance coverage disagrees');
 const knownChunks=new Map(chunks.map(chunk=>[chunk.id,chunk]));
 const quotes=new Map<string,{start:number;occurrences:number}>();
 function locate(quote:string){let found=quotes.get(quote);if(found)return found;const first=source.content.indexOf(quote);let occurrences=0,position=first;while(position>=0){occurrences++;position=source.content.indexOf(quote,position+quote.length);}found={start:first<0?-1:new TextEncoder().encode(source.content.slice(0,first)).length,occurrences};quotes.set(quote,found);return found;}
 const claims=list(v.claims,limits.maxClaims).map(value=>{
  const f=object(value),quote=nullableText(f.quote),located=f.span===null?null:span(f.span),occurrences=count(f.occurrences),grounding=text(f.grounding),chunkIds=unique(list(f.chunks,100000).map(id));
  if(quote){const expected=locate(quote);if(expected.occurrences!==occurrences||(expected.start<0?located!==null:located?.start!==expected.start||located.text!==quote)||grounding!==(located?'quote_verified':'quote_not_found'))throw Error('Claim quote does not match its source span');}
  else if(located||occurrences||grounding!=='source_unquoted')throw Error('Unquoted claim cannot have a source span');
  if(!located&&chunkIds.length)throw Error('Unlocated claim cannot name overlapping chunks');
  for(const chunkId of chunkIds){const chunk=knownChunks.get(chunkId);if(!chunk){if(chunks.length===chunksTotal)throw Error('Claim names an unknown source chunk');continue;}if(!located||chunk.span.start>=located.end||located.start>=chunk.span.end)throw Error('Claim names a non-overlapping chunk');}
  if(located&&chunks.some(chunk=>chunk.span.start<located.end&&located.start<chunk.span.end&&!chunkIds.includes(chunk.id)))throw Error('Claim omits an overlapping source chunk');
  return {id:id(f.fact_id),subject:text(f.subject),predicate:text(f.predicate),object:text(f.object),status:text(f.status),excluded:flag(f.excluded),quote,span:located,occurrences,grounding,section:nullableText(f.section),chunkIds,entityIds:unique(list(f.entities,2).map(entityId))};
 });unique(claims.map(claim=>claim.id));if(c.claims_shown!==claims.length)throw Error('Source claim counts disagree');
 const entities=list(v.entities,2000).map(value=>{const e=object(value);return {id:entityId(e.id),key:text(e.key),label:text(e.label),kind:nullableText(e.kind),claimIds:unique(list(e.claims).map(id))};});unique(entities.map(e=>e.id));
 const knownEntities=new Map(entities.map(e=>[e.id,e]));
 for(const claim of claims)for(const entity of claim.entityIds)if(!knownEntities.get(entity)?.claimIds.includes(claim.id))throw Error('Claim entity membership disagrees');
 for(const entity of entities)for(const fact of entity.claimIds)if(!claims.find(claim=>claim.id===fact)?.entityIds.includes(entity.id))throw Error('Entity claim membership disagrees');
 const mentions=list(v.mentions,100000).map(value=>{const m=object(value),occurrences=count(m.occurrences);if(!occurrences)throw Error('Invalid textual mention count');return {id:entityId(m.id),key:text(m.key),label:text(m.label),span:span(m.span),occurrences};});unique(mentions.map(m=>m.id));
 if(mentions.some(m=>knownEntities.has(m.id)))throw Error('Text-only mention is already named by a claim');
 return {sections,chunks,claims,entities,mentions,coverage:{chunksTotal,truncated,reasons}};
}
export type SourceProvenanceData=Awaited<ReturnType<typeof parseSourceProvenance>>;
