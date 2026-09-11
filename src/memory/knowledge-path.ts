import {knowledgeResponse,parseKnowledgeCoverage,type Coverage,type Knowledge} from './knowledge.ts';
import type {QueryEvidenceNode,QueryEvidenceEdge} from './query-evidence.ts';

export interface PathEntity {id:string;key:string;label:string}
export interface PathRequest {from:string;to:string;max_hops:number;limit:number;hub_degree:number}
export interface PathHop {id:string;subject:PathEntity;object:PathEntity;predicate:string;direction:'forward'|'reverse';factIds:number[]}
export interface KnowledgeRoute {entities:PathEntity[];hops:PathHop[]}
export interface KnowledgePaths {status:'found'|'none_within_limit'|'disconnected'|'not_connected_in_read';complete:boolean;coverage:Coverage;hubs:PathEntity[];truncated:boolean;paths:KnowledgeRoute[]}
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid path record');return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string'||!v||v.length>100000)throw Error('Invalid path text');return v;};
const flag=(v:unknown):boolean=>{if(typeof v!=='boolean')throw Error('Invalid path flag');return v;};
const list=(v:unknown,max:number):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw Error('Invalid path list');return v;};
const id=(v:unknown,prefix='ent:')=>{const value=text(v);if(!value.startsWith(prefix)||value.length<=prefix.length||value.length>200)throw Error('Invalid path identity');return value;};
const distinct=(values:(string|number)[])=>{if(new Set(values).size!==values.length)throw Error('Duplicate path identity');};
function entity(value:unknown):PathEntity {const v=record(value);return {id:id(v.id),key:text(v.key),label:text(v.label)};}
function hop(value:unknown):PathHop {
 const v=record(value),direction=v.direction;
 if(direction!=='forward'&&direction!=='reverse')throw Error('Invalid path direction');
 const factIds=list(v.fact_ids,50000).map(value=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw Error('Invalid path support');return value;});
 if(!factIds.length)throw Error('Path relationship has no recorded support');distinct(factIds);
 return {id:id(v.relation_id,'rel:'),subject:entity(v.subject),object:entity(v.object),predicate:text(v.predicate),direction,factIds};
}
function route(value:unknown,request:PathRequest):KnowledgeRoute {
 const v=record(value),entities=list(v.entities,request.max_hops+1).map(entity),hops=list(v.hops,request.max_hops).map(hop);
 if(entities.length!==hops.length+1||entities[0]?.id!==request.from||entities.at(-1)?.id!==request.to)throw Error('Path endpoints do not match the request');
 distinct(entities.map(entity=>entity.id));distinct(hops.map(hop=>hop.id));
 hops.forEach((hop,index)=>{
  const left=entities[index],right=entities[index+1],subject=hop.direction==='forward'?left:right,object=hop.direction==='forward'?right:left;
  if(hop.subject.id!==subject.id||hop.object.id!==object.id||hop.subject.label!==subject.label||hop.object.label!==object.label||hop.subject.key!==subject.key||hop.object.key!==object.key)throw Error('Path relationships do not form the returned route');
 });
 return {entities,hops};
}
function matchMap(paths:KnowledgeRoute[],graph:Knowledge){
 const names=new Map(graph.entities.map(entity=>[entity.id,entity])),relations=new Map(graph.relations.map(relation=>[relation.id,relation]));
 for(const path of paths){
  for(const entity of path.entities){const known=names.get(entity.id);if(known&&(known.label!==entity.label||known.key!==entity.key))throw Error('Path entity disagrees with the displayed graph');}
  for(const hop of path.hops){
   const known=relations.get(hop.id);if(!known)continue;
   const support=new Set(known.factIds);
   if(known.source!==hop.subject.id||known.target!==hop.object.id||known.predicate!==hop.predicate||support.size!==hop.factIds.length||hop.factIds.some(id=>!support.has(id)))throw Error('Path evidence disagrees with the displayed graph');
  }
 }
}
export function parseKnowledgePath(value:unknown,graph:Knowledge,request:PathRequest):KnowledgePaths {
 const v=knowledgeResponse(value,graph),policy=record(v.policy);
 for(const key of ['max_hops','limit','hub_degree'] as const)if(policy[key]!==request[key])throw Error('Path search bounds do not match the request');
 if(entity(v.from).id!==request.from||entity(v.to).id!==request.to)throw Error('Path response belongs to different endpoints');
 const coverage=parseKnowledgeCoverage(v.coverage),complete=flag(v.complete),truncated=flag(v.truncated),status=v.status;
 if(complete===coverage.truncated)throw Error('Inconsistent path read coverage');
 if(!['found','none_within_limit','disconnected','not_connected_in_read'].includes(String(status)))throw Error('Unknown path outcome');
 const paths=list(v.paths,request.limit).map(value=>route(value,request)),hubs=list(v.hubs_skipped,100000).map(entity);distinct(hubs.map(hub=>hub.id));
 if((status==='found')!==(paths.length>0)||(status==='disconnected'&&!complete)||(status==='not_connected_in_read'&&complete))throw Error('Path outcome contradicts its evidence');
 if(truncated&&(status!=='found'||paths.length!==request.limit))throw Error('Inconsistent path result limit');
 distinct(paths.map(path=>JSON.stringify(path.entities.map(entity=>entity.id))));
 if(paths.some(path=>path.hops.length!==paths[0].hops.length))throw Error('Returned routes are not equally short');
 matchMap(paths,graph);
 return {status:status as KnowledgePaths['status'],complete,coverage,hubs,truncated,paths};
}
export function pathNetwork(path:KnowledgeRoute):{nodes:QueryEvidenceNode[];edges:QueryEvidenceEdge[]} {
 return {nodes:path.entities.map(entity=>({id:entity.id,kind:'concept',label:entity.label,data:{}})),edges:path.hops.map(hop=>({id:hop.id,kind:'relation',source:hop.subject.id,target:hop.object.id,data:{predicate:hop.predicate,fact_ids:hop.factIds}}))};
}
