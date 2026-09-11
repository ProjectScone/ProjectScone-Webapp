import type {Knowledge} from './knowledge.ts';
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid timeline record');return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string'||v.length>1000000)throw Error('Invalid timeline text');return v;};
const count=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('Invalid timeline count');return v;};
const id=(v:unknown):number=>{const n=count(v);if(!n)throw Error('Invalid timeline record identity');return n;};
const flag=(v:unknown):boolean=>{if(typeof v!=='boolean')throw Error('Invalid timeline flag');return v;};
const list=(v:unknown,max=500):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw Error('Invalid timeline list');return v;};
function unique<T>(v:T[]):T[]{if(new Set(v).size!==v.length)throw Error('Duplicate timeline identity');return v;}
const time=(v:unknown):number=>{const value=text(v),n=Date.parse(value);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(n)||Number(value.slice(0,4))<1||Number(value.slice(11,13))>23||new Date(value.slice(0,10)+'T00:00:00.000Z').toISOString().slice(0,10)!==value.slice(0,10))throw Error('Invalid timeline timestamp');return n;};
function entity(v:unknown){const e=record(v),name=text(e.id);if(!name.startsWith('ent:')||name.length<=4||name.length>200)throw Error('Invalid timeline entity');return {id:name,key:text(e.key),label:text(e.label)};}
function role(v:unknown):'subject'|'object'|'value'{if(v!=='subject'&&v!=='object'&&v!=='value')throw Error('Invalid timeline role');return v;}
export function parseKnowledgeTimeline(value:unknown,graph:Knowledge,selected:string,asOf:string,maxItems=500){
 if(!Number.isInteger(maxItems)||maxItems<1||maxItems>500)throw Error('Invalid requested timeline limit');
 const v=record(value),p=record(v.projection),c=record(v.coverage),read=record(c.read),found=entity(v.entity),instant=time(v.as_of);
 const graphIdentity:unknown=JSON.parse(graph.identity),scheme=['version','classifier','kinds','id_scheme'].map(key=>text(p[key]));
 if(v.schema_version!==1||v.space!==graph.space||found.id!==selected||instant!==time(asOf)||p.revision!==graph.revision||v.consistent!==true||!Array.isArray(graphIdentity)||scheme.some((field,index)=>field!==graphIdentity[index])||!text(p.digest))throw Error('The timeline does not match this entity and graph revision. Refresh the graph and try again.');
 const keys=new Map(graph.entities.map(entity=>[entity.id,entity.key]));
 if(keys.has(found.id)&&keys.get(found.id)!==found.key)throw Error('Timeline entity disagrees with its known identity');
 const items=list(v.items,maxItems).map(value=>{
  const f=record(value),from=time(f.valid_from),until=f.valid_until===null?null:time(f.valid_until),status=text(f.status),excluded=flag(f.excluded),holds=flag(f.holds_at_as_of),kind=role(f.role),far=f.far===null?null:entity(f.far),grounding=text(f.grounding),quote=f.quote===null?null:text(f.quote),sourceId=f.source_episode_id==null?null:id(f.source_episode_id);
  if(until!==null&&until<from)throw Error('Timeline interval ends before it begins');
  if(holds!==(!excluded&&['active','closed'].includes(status)&&from<=instant&&(until===null||instant<until)))throw Error('Timeline validity marker disagrees with the record');
  if((kind==='value')!==(far===null))throw Error('Timeline role disagrees with its endpoint');
  if(far&&keys.has(far.id)&&keys.get(far.id)!==far.key)throw Error('Timeline endpoint disagrees with its known identity');
  if(quote!==null&&(grounding!=='quote_verified'||sourceId===null))throw Error('Timeline quote has no verified source');
  return {id:id(f.fact_id),role:kind,subject:text(f.subject),predicate:text(f.predicate),object:text(f.object),far,from,until,status,excluded,origin:text(f.origin),supersededBy:f.superseded_by===null?null:id(f.superseded_by),grounding,quote,sourceId,holds};
 });unique(items.map(item=>item.id));
 for(let i=1;i<items.length;i++)if(items[i].from<items[i-1].from||(items[i].from===items[i-1].from&&items[i].id<items[i-1].id))throw Error('Timeline is not ordered by valid time');
 const known=new Map(items.map(item=>[item.id,item]));
 const lanes=list(v.lanes).map(value=>{const lane=record(value),kind=role(lane.role),predicate=text(lane.predicate),ids=unique(list(lane.items).map(id)),name=text(lane.id);if(name!==kind+':'+predicate||ids.some(id=>known.get(id)?.role!==kind||known.get(id)?.predicate!==predicate))throw Error('Timeline lane membership disagrees');return {id:name,role:kind,predicate,itemIds:ids};});
 unique(lanes.map(lane=>lane.id));if(unique(lanes.flatMap(lane=>lane.itemIds)).length!==items.length)throw Error('Timeline lanes omit records');
 const relations=list(v.relations,8500).map(value=>{const relation=record(value),from=id(relation.from_fact),to=id(relation.to_fact),kind=text(relation.kind),linkId=relation.link_id===undefined?null:id(relation.link_id);if(!known.has(from)||!known.has(to)||(kind==='superseded_by'&&known.get(from)?.supersededBy!==to))throw Error('Timeline relation has no matching record');return {from,to,kind,linkId};});
 const total=count(c.items_total),shown=count(c.items_shown),truncated=flag(c.truncated),reasons=list(c.reasons,50).map(text),readReasons=list(read.reasons,50).map(text);
 if(shown!==items.length||total<shown||(!truncated&&(total>shown||reasons.length||readReasons.length))||readReasons.some(reason=>!reasons.includes(reason)))throw Error('Timeline coverage disagrees with the returned records');
 return {entity:found,asOf:instant,items,lanes,relations,coverage:{total,truncated,reasons}};
}
export type KnowledgeTimelineData=ReturnType<typeof parseKnowledgeTimeline>;
export type TimelineItem=KnowledgeTimelineData['items'][number];
export function timelineExtent(items:TimelineItem[],asOf:number):[number,number]{
 const points=[asOf,...items.flatMap(item=>[item.from,...(item.until===null?[]:[item.until])])],start=Math.min(...points),end=Math.max(...points),padding=Math.max((end-start)*.05,86400000);
 return [Math.max(-62135596800000,start-padding),Math.min(253402300799999,end+padding)];
}
