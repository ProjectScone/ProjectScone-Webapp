import type {QueryEvidenceNode,QueryEvidenceEdge} from './query-evidence.ts';
export const KNOWLEDGE_MODES=['current','history','proposed','all'] as const;
export type KnowledgeMode=typeof KNOWLEDGE_MODES[number];
export interface Entity {id:string;key:string;label:string;kind:string|null;kindStatus:string;claims:number}
export interface Coverage {truncated:boolean;reasons:string[];counts:Record<string,number>}
export interface Relation {id:string;source:string;target:string;predicate:string;factIds:number[];support:Record<string,number>}
export interface Attribute {predicate:string;value:string;factIds:number[];entityId:string}
export interface Knowledge {space:string;identity:string;revision:number;mode:KnowledgeMode;asOf:string;entities:Entity[];relations:Relation[];attributes:Attribute[];coverage:Coverage}
export interface DetailFact {id:number;subject:string;predicate:string;object:string;status:string;excluded:boolean;origin:string;sourceId:number|null;quote:string|null;grounding:string}
export interface EntityDetail {entity:Entity;facts:DetailFact[];consistent:boolean;complete:boolean;coverage:Coverage;relations:{predicate:string;direction:'incoming'|'outgoing';other:{id:string;label:string};factIds:number[]}[];attributes:Attribute[]}
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid knowledge record');return v as Record<string,unknown>;};
const str=(v:unknown):string=>{if(typeof v!=='string'||v.length>100000)throw Error('Invalid knowledge text');return v;};
const num=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('Invalid knowledge count');return v;};
const bool=(v:unknown):boolean=>{if(typeof v!=='boolean')throw Error('Invalid knowledge flag');return v;};
const list=(v:unknown,max=5000):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw Error('Invalid or oversized knowledge list');return v;};
const ids=(v:unknown):number[]=>list(v,50000).map(value=>{const id=num(value);if(!id)throw Error('Invalid claim identity');return id;});
const id=(v:unknown,prefix='ent:'):string=>{const value=str(v);if(!value.startsWith(prefix)||value.length>200||value.length===prefix.length)throw Error('Invalid graph identity');return value;};
function entity(value:unknown):Entity {const v=record(value);return {id:id(v.id),key:str(v.key),label:str(v.label),kind:v.kind===null?null:str(v.kind),kindStatus:str(v.kind_status),claims:num(v.claims)};}
function coverage(value:unknown):Coverage {
 const v=record(value),counts:Record<string,number>={};
 for(const key of ['facts_read','facts_counted','facts_limit','entities_total','entities_shown','relations_total','relations_shown','attributes_total','attributes_shown'])if(v[key]!==undefined&&v[key]!==null)counts[key]=num(v[key]);
 const truncated=bool(v.truncated),reasons=list(v.reasons,50).map(str);
 if(!truncated&&reasons.length)throw Error('Inconsistent knowledge coverage');
 for(const key of ['facts_read','facts_counted','facts_limit'])num(counts[key]);
 return {truncated,reasons,counts};
}
function identity(value:unknown):{key:string;revision:number} {
 const v=record(value);return {key:JSON.stringify(['version','classifier','kinds','id_scheme','digest'].map(key=>str(v[key]))),revision:num(v.revision)};
}
function unique(values:string[]){if(new Set(values).size!==values.length)throw Error('Duplicate graph identity');}
function attribute(value:unknown,entityId?:string):Attribute {const v=record(value);return {entityId:entityId??id(v.entity_id),predicate:str(v.predicate),value:str(v.value),factIds:ids(v.fact_ids)};}
export function parseKnowledge(value:unknown,mode:KnowledgeMode,expectedSpace?:string):Knowledge {
 const v=record(value),filters=record(v.filters),projection=identity(v.projection);
 if(v.schema_version!==1||filters.status!==mode)throw Error('Knowledge response does not match this view');
 const space=str(v.space);if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(space))throw Error('Invalid knowledge space');
 if(expectedSpace!==undefined&&space!==expectedSpace)throw Error('Knowledge response belongs to another space');
 const entities=list(v.entities,1000).map(entity);unique(entities.map(e=>e.id));const known=new Set(entities.map(e=>e.id));
 const relations=list(v.relations,100000).map(value=>{const r=record(value),support=record(r.support);return {id:id(r.id,'rel:'),source:id(r.subject_id),target:id(r.object_id),predicate:str(r.predicate),factIds:ids(r.fact_ids),support:Object.fromEntries(Object.entries(support).map(([k,v])=>[k,num(v)]))};});
 unique(relations.map(r=>r.id));
 const attributes=list(v.attributes).map(value=>attribute(value));
 if(relations.some(r=>!known.has(r.source)||!known.has(r.target))||attributes.some(a=>!known.has(a.entityId)))throw Error('Knowledge contains a missing entity reference');
 const c=coverage(v.coverage);
 for(const [key,actual] of [['entities',entities.length],['relations',relations.length],['attributes',attributes.length]] as const){if(num(c.counts[key+'_shown'])!==actual||num(c.counts[key+'_total'])<actual)throw Error('Knowledge coverage does not match returned records');}
 if(!Number.isFinite(Date.parse(str(filters.as_of))))throw Error('Invalid knowledge timestamp');
 return {space,identity:projection.key,revision:projection.revision,mode,asOf:str(filters.as_of),entities,relations,attributes,coverage:c};
}
export function knowledgeNetwork(graph:Knowledge):{nodes:QueryEvidenceNode[];edges:QueryEvidenceEdge[]} {
 return {nodes:graph.entities.map(e=>({id:e.id,kind:'concept',label:e.label,data:{}})),edges:graph.relations.map(r=>({id:r.id,kind:'relation',source:r.source,target:r.target,data:{predicate:r.predicate,fact_ids:r.factIds}}))};
}
export function parseEntityDetail(value:unknown,graph:Knowledge,selected:string):EntityDetail {
 const v=record(value),filters=record(v.filters),projection=identity(v.projection),selectedEntity=entity(v.entity);
 if(v.schema_version!==1||v.space!==graph.space||selectedEntity.id!==selected||filters.status!==graph.mode||filters.as_of!==graph.asOf||projection.key!==graph.identity||projection.revision!==graph.revision)throw Error('Knowledge changed while inspecting. Refresh the graph to load its current evidence.');
 const relations:EntityDetail['relations']=[];
 for(const direction of ['incoming','outgoing'] as const)for(const group of list(v[direction])){const g=record(group);for(const value of list(g.relations)){const r=record(value),other=record(r[direction==='incoming'?'subject':'object']);relations.push({predicate:str(g.predicate),direction,other:{id:id(other.id),label:str(other.label)},factIds:ids(r.fact_ids)});}}
 const attributes=list(v.attributes).map(value=>attribute(value,selected));
 const supported=new Set([...relations.flatMap(r=>r.factIds),...attributes.flatMap(a=>a.factIds)]);
 const facts=list(v.facts,50000).map(value=>{const f=record(value),factId=num(f.fact_id);if(!factId||!supported.has(factId))throw Error('Unexpected supporting claim');return {id:factId,subject:str(f.subject),predicate:str(f.predicate),object:str(f.object),status:str(f.status),excluded:bool(f.excluded),origin:str(f.origin),sourceId:f.source_episode_id===null?null:num(f.source_episode_id),quote:f.quote===null?null:str(f.quote),grounding:str(f.grounding)};});
 unique(facts.map(f=>String(f.id)));
 return {entity:selectedEntity,relations,attributes,facts,consistent:bool(v.consistent),complete:bool(v.complete),coverage:coverage(v.coverage)};
}
