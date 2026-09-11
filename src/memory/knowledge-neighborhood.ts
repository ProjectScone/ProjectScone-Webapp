import {knowledgeResponse,parseKnowledge,type Knowledge} from './knowledge.ts';
import type {PathEntity} from './knowledge-path.ts';
export interface NeighborhoodRequest {seeds:PathEntity[];limit:number;hubDegree:number}
export function neighborhoodRequest(seeds:PathEntity[],limit:number,hubDegree:number):NeighborhoodRequest {
 if(!seeds.length||seeds.length>24||new Set(seeds.map(seed=>seed.id)).size!==seeds.length||seeds.some(seed=>!/^ent:.{1,196}$/.test(seed.id)))throw Error('Choose between 1 and 24 distinct entities.');
 if(!Number.isSafeInteger(limit)||limit<seeds.length||limit>1000)throw Error('The entity limit must include every starting entity and be at most 1,000.');
 if(!Number.isSafeInteger(hubDegree)||hubDegree<1||hubDegree>100000)throw Error('Hub degree must be between 1 and 100,000.');
 return {seeds,limit,hubDegree};
}
export function parseNeighborhood(value:unknown,graph:Knowledge,request:NeighborhoodRequest):Knowledge {
 const raw=knowledgeResponse(value,graph),filters=raw.filters as Record<string,unknown>;
 if(JSON.stringify(filters.seeds)!==JSON.stringify(request.seeds.map(seed=>seed.id))||filters.hub_degree!==request.hubDegree)throw Error('Neighborhood starting entities or hub setting disagree with the request.');
 const result=parseKnowledge(value,graph.mode,graph.space);
 if(result.entities.length>request.limit)throw Error('The neighborhood exceeds the requested entity limit.');
 const known=new Map<string,PathEntity>(graph.entities.map(entity=>[entity.id,entity]));
 for(const seed of request.seeds){const prior=known.get(seed.id);if(prior&&(seed.key!==prior.key||seed.label!==prior.label))throw Error('Starting entity disagrees with the displayed graph.');known.set(seed.id,seed);}
 for(const entity of result.entities){const prior=known.get(entity.id);if(prior&&(entity.key!==prior.key||entity.label!==prior.label))throw Error('Neighborhood entity identity changed.');}
 const found=new Set(result.entities.map(entity=>entity.id)),reached=new Set(request.seeds.map(seed=>seed.id));
 if(request.seeds.some(seed=>!found.has(seed.id)))throw Error('The neighborhood omitted a starting entity.');
 const touching=new Map<string,string[]>(),starts=new Set(reached),recorded=new Map(graph.relations.map(relation=>[relation.id,relation]));
 const connect=(from:string,to:string)=>{const neighbors=touching.get(from);if(neighbors)neighbors.push(to);else touching.set(from,[to]);};
 for(const relation of result.relations){
  const support=new Set(relation.factIds),prior=recorded.get(relation.id);
  if(!support.size||support.size!==relation.factIds.length)throw Error('Neighborhood connection has invalid recorded support.');
  if(prior&&(prior.source!==relation.source||prior.target!==relation.target||prior.predicate!==relation.predicate||prior.factIds.length!==support.size||prior.factIds.some(id=>!support.has(id))))throw Error('Neighborhood connection disagrees with recorded map evidence.');
  if(relation.source===relation.target)continue;
  connect(relation.source,relation.target);connect(relation.target,relation.source);
 }
 const queue=[...reached];
 for(let index=0;index<queue.length;index++){
  const entity=queue[index],neighbors=touching.get(entity)??[];
  if(!starts.has(entity)&&neighbors.length>request.hubDegree)continue;
  for(const next of neighbors)if(!reached.has(next)){reached.add(next);queue.push(next);}
 }
 if(reached.size!==found.size)throw Error('Neighborhood includes entities unreachable under the requested hub cutoff.');
 if(result.entities.length<result.coverage.counts.entities_total&&!result.coverage.truncated)throw Error('Neighborhood omissions were not disclosed.');
 return result;
}
