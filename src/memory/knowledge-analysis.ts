import type {EvidenceGroups} from './evidence-network.ts';
export interface KnowledgeCommunity {id:string;label:string;members:string[];size:number}
export interface KnowledgeImportance {entityId:string;communityId:string;degree:number;pagerank:number;betweenness:number;participation:number}
export interface KnowledgeAnalysis {method:string;modularity:number;resolution:number|null;communities:KnowledgeCommunity[];membership:Map<string,string>;importance:Map<string,KnowledgeImportance>;total:number;analysed:number;isolated:number;truncated:boolean;reasons:string[];betweenness:string;estimated:boolean}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid community analysis');return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string'||!v||v.length>100000)throw Error('Invalid analysis text');return v;};
const number=(v:unknown,min=0,max=1):number=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Invalid analysis score');return v;};
const count=(v:unknown):number=>{const n=number(v,0,1000000);if(!Number.isSafeInteger(n))throw Error('Invalid analysis count');return n;};
const flag=(v:unknown):boolean=>{if(typeof v!=='boolean')throw Error('Invalid analysis flag');return v;};
const array=(v:unknown,max=1000):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw Error('Invalid analysis list');return v;};
function distinct(values:string[]){if(new Set(values).size!==values.length)throw Error('Duplicate community assignment');}
export function parseKnowledgeAnalysis(value:unknown,entities:Set<string>):KnowledgeAnalysis {
 const v=object(value),c=object(v.coverage);
 if(v.basis!=='computed')throw Error('Community analysis must be identified as computed');
 const communities=array(v.communities).map(value=>{const g=object(value),members=array(g.members).map(text),size=count(g.size);distinct(members);if(size<members.length||members.some(id=>!entities.has(id)))throw Error('Invalid community membership');return {id:text(g.id),label:text(g.label),members,size};});
 distinct(communities.map(g=>g.id));distinct(communities.flatMap(g=>g.members));
 const membership=new Map(Object.entries(object(v.membership)).map(([entity,group])=>[entity,text(group)]));
 const expected=new Map(communities.flatMap(g=>g.members.map(member=>[member,g.id] as const)));
 if(membership.size!==expected.size||[...membership].some(([entity,group])=>expected.get(entity)!==group))throw Error('Community assignments disagree');
 const importance=new Map<string,KnowledgeImportance>();
 for(const value of array(v.importance)){const score=object(value),entityId=text(score.entity_id),communityId=text(score.community_id);if(membership.get(entityId)!==communityId||importance.has(entityId))throw Error('Invalid entity importance reference');importance.set(entityId,{entityId,communityId,degree:count(score.degree),pagerank:number(score.pagerank),betweenness:number(score.betweenness),participation:number(score.participation)});}
 if(importance.size!==membership.size)throw Error('Community importance is incomplete');
 const estimated=flag(c.betweenness_estimated),betweenness=text(c.betweenness),truncated=flag(c.truncated),reasons=array(c.reasons,50).map(text);
 if(estimated?!/^sampled:[1-9][0-9]*$/.test(betweenness):betweenness!=='exact')throw Error('Inconsistent analysis sampling');
 if(!truncated&&reasons.length)throw Error('Inconsistent analysis coverage');
 const total=count(c.entities_total),analysed=count(c.entities_analysed),isolated=count(c.isolated_entities);
 if(analysed>total||membership.size>analysed)throw Error('Invalid analysis coverage');
 const resolution=c.resolution===undefined?null:number(c.resolution,Number.MIN_VALUE,10);
 return {method:text(v.method),modularity:number(v.modularity,-(resolution??1),1),resolution,communities,membership,importance,total,analysed,isolated,truncated,reasons,betweenness,estimated};
}
export function analysisGroups(analysis:KnowledgeAnalysis,entities:string[]):EvidenceGroups {
 const missing=entities.filter(id=>!analysis.membership.has(id));
 return {method:'computed',groups:[...analysis.communities.map(group=>({id:group.id,label:group.label,nodeIds:group.members,isolated:false})),...(missing.length?[{id:'unassigned',label:'No group returned',nodeIds:missing,isolated:true}]:[])]};
}
