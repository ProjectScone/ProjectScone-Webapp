import {knowledgeResponse,parseKnowledgeCoverage,type Knowledge} from './knowledge.ts';

export interface ReportSettings {resolution:number;excludeHubs:number|null}
export interface ReportEntity {id:string;key:string;label:string}
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid report record');return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string'||!v||v.length>100000)throw Error('Invalid report text');return v;};
const score=(v:unknown,min=0,max=1):number=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Invalid report score');return v;};
const count=(v:unknown):number=>{const n=score(v,0,Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(n))throw Error('Invalid report count');return n;};
const list=(v:unknown,max=20000):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw Error('Invalid report list');return v;};
const flag=(v:unknown):boolean=>{if(typeof v!=='boolean')throw Error('Invalid report flag');return v;};
function distinct<T>(values:T[]):T[]{if(new Set(values).size!==values.length)throw Error('Duplicate report identity');return values;}
function id(v:unknown,prefix='ent:'):string {const s=text(v);if(!s.startsWith(prefix)||s.length<=prefix.length||s.length>200)throw Error('Invalid report identity');return s;}
function entity(value:unknown):ReportEntity {const v=record(value);return {id:id(v.id),key:text(v.key),label:text(v.label)};}
function facts(v:unknown):number[]{return distinct(list(v,50000).map(value=>{const n=count(value);if(!n)throw Error('Invalid supporting claim');return n;}));}
function histogram(v:unknown):[string,number][]{return list(v).map(value=>{const pair=list(value,2);if(pair.length!==2)throw Error('Invalid report distribution');return [text(pair[0]),count(pair[1])];});}
export function parseKnowledgeReport(value:unknown,graph:Knowledge,settings:ReportSettings){
 const v=knowledgeResponse(value,graph),a=record(v.analysis),c=record(a.coverage),s=record(v.summary);
 const resolution=score(a.resolution,Number.MIN_VALUE,10),excludeHubs=a.exclude_hubs===null?null:score(a.exclude_hubs,50,100);
 if(a.basis!=='computed'||resolution!==settings.resolution||excludeHubs!==settings.excludeHubs||c.resolution!==resolution)throw Error('The report did not use the requested analysis settings');
 const modularity=score(a.modularity,-resolution,1),version=text(a.version);
 const analysed=count(c.entities_analysed),total=count(c.entities_total),isolated=count(c.isolated_entities),estimated=flag(c.betweenness_estimated),betweenness=text(c.betweenness);
 if(a.betweenness!==betweenness||(estimated?!/^sampled:[1-9][0-9]*$/.test(betweenness):betweenness!=='exact')||analysed>total)throw Error('Inconsistent report analysis');
 const analysisTruncated=flag(c.truncated),analysisReasons=list(c.reasons,50).map(text);
 if(!analysisTruncated&&analysisReasons.length)throw Error('Inconsistent analysis coverage');
 const summary={entities:count(s.entities),relations:count(s.relations),attributes:count(s.attributes),communities:count(s.communities),isolated:count(s.isolated_entities)};
 const communities=list(v.communities).map(value=>{const g=record(value),central=list(g.central,3).map(entity);distinct(central.map(e=>e.id));const size=count(g.size);if(!size||central.length>size)throw Error('Invalid community size');return {id:id(g.id,'com:'),label:text(g.label),size,central,internalLinks:count(g.internal_links),boundaryLinks:count(g.boundary_links),cohesion:g.cohesion===null?null:score(g.cohesion),kinds:histogram(g.kinds),predicates:histogram(g.predicates)};});
 const groupIds=new Set(distinct(communities.map(g=>g.id)));
 const group=(v:unknown)=>{const value=id(v,'com:');if(!groupIds.has(value))throw Error('Unknown report community');return value;};
 if(summary.communities!==communities.length||summary.isolated!==isolated||total+isolated!==summary.entities||communities.reduce((n,g)=>n+g.size,0)!==analysed)throw Error('Report counts disagree');
 const central=list(v.central_entities,15).map(value=>{const e=record(value);return {...entity(e),communityId:group(e.community_id),community:text(e.community),kind:e.kind===null?null:text(e.kind),degree:count(e.degree),weight:score(e.weight,0,Number.MAX_SAFE_INTEGER),pagerank:score(e.pagerank),betweenness:score(e.betweenness),participation:score(e.participation)};});
 const hubs=list(v.hubs_excluded).map(value=>{const e=record(value);return {...entity(e),degree:count(e.degree),pagerank:score(e.pagerank)};});
 distinct([...central,...hubs].map(e=>e.id));
 if(excludeHubs===null&&hubs.length)throw Error('Unexpected excluded hubs');
 const bridges=list(v.bridging_entities,10).map(value=>{const e=record(value);return {...entity(e),communityId:group(e.community_id),participation:score(e.participation),betweenness:score(e.betweenness)};});distinct(bridges.map(e=>e.id));
 const connections=list(v.surprising_connections,20).map(value=>{const e=record(value),groups=distinct(list(e.communities,2).map(group)),factIds=facts(e.fact_ids),links=count(e.links_between_communities);if(groups.length!==2||!factIds.length||!links)throw Error('Invalid cross-community connection');return {id:id(e.relation_id,'rel:'),subject:entity(e.subject),predicate:text(e.predicate),object:entity(e.object),factIds,groups,links,reason:text(e.reason)};});distinct(connections.map(e=>e.id));
 for(const connection of connections){const known=graph.relations.find(r=>r.id===connection.id);if(known&&(known.source!==connection.subject.id||known.target!==connection.object.id||known.predicate!==connection.predicate||known.factIds.length!==connection.factIds.length||known.factIds.some(f=>!connection.factIds.includes(f))))throw Error('Report connection disagrees with recorded support');}
 const suggestions=list(v.suggestions,10).map(value=>{const q=record(value),kind=text(q.kind);if(!['connection','bridge','kind_conflict','isolated'].includes(kind))throw Error('Unknown report question kind');return {kind,text:text(q.text),entityIds:distinct(list(q.entity_ids).map(v=>id(v))),relationIds:distinct(list(q.relation_ids).map(v=>id(v,'rel:'))),factIds:facts(q.fact_ids)};});
 const names=new Map<string,ReportEntity>(graph.entities.map(e=>[e.id,e]));
 for(const found of [...communities.flatMap(g=>g.central),...central,...hubs,...bridges,...connections.flatMap(c=>[c.subject,c.object])]){
  const known=names.get(found.id);
  if(known&&(known.key!==found.key||known.label!==found.label))throw Error('Report entity disagrees with its recorded identity');
  names.set(found.id,found);
 }
 for(const found of central)if(communities.find(g=>g.id===found.communityId)?.label!==found.community)throw Error('Report community label disagrees with its identity');
 const coverage=parseKnowledgeCoverage(v.coverage);
 if(record(v.coverage).entities_analysed!==analysed||(analysisTruncated&&!coverage.truncated)||analysisReasons.some(reason=>!coverage.reasons.includes(reason)))throw Error('Report coverage omits analysis limits');
 return {resolution,excludeHubs,modularity,version,summary,communities,central,hubs,bridges,connections,suggestions,coverage,analysed,total,estimated,betweenness};
}
export type KnowledgeReportData=ReturnType<typeof parseKnowledgeReport>;
