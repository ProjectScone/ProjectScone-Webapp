import {knowledgeResponse,parseKnowledge,type Knowledge} from './knowledge.ts';
import type {PathEntity} from './knowledge-path.ts';

export const WALK_DIRECTIONS=['both','out','in'] as const;
export type WalkDirection=typeof WALK_DIRECTIONS[number];
export interface NeighborhoodWalk {direction:WalkDirection;hops:number|null}
export interface NeighborhoodRequest {seeds:PathEntity[];limit:number;hubDegree:number;walk?:NeighborhoodWalk}
export interface Neighborhood extends Knowledge {hopById:ReadonlyMap<string,number>}

export function neighborhoodRequest(seeds:PathEntity[],limit:number,hubDegree:number,walk?:{direction:string;hops:number|null}):NeighborhoodRequest {
 if(!seeds.length||seeds.length>24||new Set(seeds.map(seed=>seed.id)).size!==seeds.length||seeds.some(seed=>!/^ent:.{1,196}$/.test(seed.id)))throw Error('Choose between 1 and 24 distinct entities.');
 if(!Number.isSafeInteger(limit)||limit<seeds.length||limit>1000)throw Error('The entity limit must include every starting entity and be at most 1,000.');
 if(!Number.isSafeInteger(hubDegree)||hubDegree<1||hubDegree>100000)throw Error('Hub degree must be between 1 and 100,000.');
 if(!walk)return {seeds,limit,hubDegree};
 if(!WALK_DIRECTIONS.some(direction=>direction===walk.direction))throw Error('Choose incoming, outgoing or both directions.');
 if(walk.hops!==null&&(!Number.isSafeInteger(walk.hops)||walk.hops<1||walk.hops>8))throw Error('The step limit must be between 1 and 8, or unlimited.');
 return {seeds,limit,hubDegree,walk:{direction:walk.direction as WalkDirection,hops:walk.hops}};
}

export function neighborhoodParams(graph:Knowledge,request:NeighborhoodRequest):URLSearchParams {
 const params=new URLSearchParams({status:graph.mode,as_of:graph.asOf,limit:String(request.limit),attribute_limit:'1000',hub_degree:String(request.hubDegree)});
 request.seeds.forEach(seed=>params.append('seed',seed.id));
 if(request.walk){params.set('direction',request.walk.direction);if(request.walk.hops!==null)params.set('hops',String(request.walk.hops));}
 return params;
}

export function parseNeighborhood(value:unknown,graph:Knowledge,request:NeighborhoodRequest):Neighborhood {
 const raw=knowledgeResponse(value,graph),filters=raw.filters as Record<string,unknown>;
 if(JSON.stringify(filters.seeds)!==JSON.stringify(request.seeds.map(seed=>seed.id))||filters.hub_degree!==request.hubDegree)throw Error('Neighborhood starting entities or hub setting disagree with the request.');
 if(request.walk&&(filters.direction!==request.walk.direction||filters.hops!==request.walk.hops))throw Error('Neighborhood direction or step limit disagrees with the request.');
 if(!request.walk&&((filters.direction!==undefined&&filters.direction!=='both')||(filters.hops!==undefined&&filters.hops!==null)))throw Error('Neighborhood applied an unrequested direction or step limit.');
 const result=parseKnowledge(value,graph.mode,graph.space);
 if(result.entities.length>request.limit)throw Error('The neighborhood exceeds the requested entity limit.');
 const known=new Map<string,PathEntity>(graph.entities.map(entity=>[entity.id,entity]));
 for(const seed of request.seeds){const prior=known.get(seed.id);if(prior&&(seed.key!==prior.key||seed.label!==prior.label))throw Error('Starting entity disagrees with the displayed graph.');known.set(seed.id,seed);}
 for(const entity of result.entities){const prior=known.get(entity.id);if(prior&&(entity.key!==prior.key||entity.label!==prior.label))throw Error('Neighborhood entity identity changed.');}
 const found=new Set(result.entities.map(entity=>entity.id)),starts=new Set(request.seeds.map(seed=>seed.id));
 if(request.seeds.some(seed=>!found.has(seed.id)))throw Error('The neighborhood omitted a starting entity.');
 const following=new Map<string,string[]>(),degree=new Map<string,number>(),recorded=new Map(graph.relations.map(relation=>[relation.id,relation]));
 const connect=(from:string,to:string)=>{const neighbors=following.get(from);if(neighbors)neighbors.push(to);else following.set(from,[to]);};
 const direction=request.walk?.direction??'both';
 for(const relation of result.relations){
  const support=new Set(relation.factIds),prior=recorded.get(relation.id);
  if(!support.size||support.size!==relation.factIds.length)throw Error('Neighborhood connection has invalid recorded support.');
  if(prior&&(prior.source!==relation.source||prior.target!==relation.target||prior.predicate!==relation.predicate||prior.factIds.length!==support.size||prior.factIds.some(id=>!support.has(id))))throw Error('Neighborhood connection disagrees with recorded map evidence.');
  if(relation.source===relation.target)continue;
  degree.set(relation.source,(degree.get(relation.source)??0)+1);degree.set(relation.target,(degree.get(relation.target)??0)+1);
  if(direction!=='in')connect(relation.source,relation.target);
  if(direction!=='out')connect(relation.target,relation.source);
 }
 const walkable=(id:string)=>starts.has(id)||(degree.get(id)??0)<=request.hubDegree;
 const reached=new Set(starts),queue=[...starts];
 for(let index=0;index<queue.length;index++){
  const entity=queue[index];if(!walkable(entity))continue;
  for(const next of following.get(entity)??[])if(!reached.has(next)){reached.add(next);queue.push(next);}
 }
 if(reached.size!==found.size)throw Error('Neighborhood includes entities unreachable under the requested direction or hub cutoff.');
 const hopById=new Map<string,number>();
 if(request.walk){
  // parseKnowledge validated the entity records and order above.
  for(const entity of raw.entities as Record<string,unknown>[]){
   const hop=entity.hop,id=entity.id as string;
   if(typeof hop!=='number'||!Number.isSafeInteger(hop)||hop<0||hop>=found.size||(request.walk.hops!==null&&hop>request.walk.hops)||starts.has(id)!==(hop===0))throw Error('Invalid distance from the starting entities.');
   hopById.set(id,hop);
  }
  const supported=new Set(starts),claims=new Map(result.entities.map(entity=>[entity.id,entity.claims]));
  for(const [near,neighbors] of following){
   if(!walkable(near))continue;
   const nearHop=hopById.get(near);
   if(nearHop!==undefined)for(const far of neighbors){
    const farHop=hopById.get(far);
    if(farHop===nearHop+1)supported.add(far);
    // Full-read claims bound relation degree; displayed edges alone do not.
    const provenWalkable=starts.has(near)||(claims.get(near)??Infinity)<=request.hubDegree;
    if(provenWalkable&&farHop!==undefined&&farHop>nearHop+1)throw Error('A reported distance ignores a shorter recorded connection.');
   }
  }
  if(supported.size!==found.size)throw Error('A reported distance has no directed predecessor in the returned evidence.');
 }
 if(result.entities.length<result.coverage.counts.entities_total&&!result.coverage.truncated)throw Error('Neighborhood omissions were not disclosed.');
 return {...result,hopById};
}
