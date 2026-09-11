import {parseKnowledge,type Knowledge,type KnowledgeMode} from './knowledge.ts';

export interface KnowledgePage {graph:Knowledge;nextCursor:string|null}
type Snapshot=Pick<Knowledge,'space'|'identity'|'revision'|'mode'|'asOf'> & {totals:Record<string,number>};
export interface KnowledgeTrail {anchor:Snapshot;index:number;pages:{cursor:string|null;ids:string[]|null}[]}
const totalKeys=['facts_read','facts_counted','entities_total','relations_total','attributes_total'] as const;
const changed=()=>Error('Knowledge changed between pages. Refresh the graph to start again.');

export function parseKnowledgePage(value:unknown,mode:KnowledgeMode,space:string|undefined,trail:KnowledgeTrail|null,paging:boolean,limit=150):KnowledgePage {
 const graph=parseKnowledge(value,mode,space);
 if(graph.entities.length>limit)throw Error('The server exceeded the requested entity limit.');
 if(!paging){if(trail)throw changed();return {graph,nextCursor:null};}
 const raw=value as {coverage:Record<string,unknown>;filters:Record<string,unknown>};
 if(raw.filters.seeds!=null&&(!Array.isArray(raw.filters.seeds)||raw.filters.seeds.length))throw Error('The server returned a seeded view instead of the requested ranking.');
 const cursor=raw.coverage.next_cursor;
 if(cursor!=null&&(typeof cursor!=='string'||!/^[-_A-Za-z0-9=]{1,512}$/.test(cursor)))throw Error('Invalid knowledge page cursor.');
 const nextCursor=typeof cursor==='string'?cursor:null,total=graph.coverage.counts.entities_total,offset=(trail?.index??0)*limit;
 if(graph.entities.length!==Math.min(limit,total-offset)||Boolean(nextCursor)!==(offset+graph.entities.length<total))throw Error('The knowledge page does not cover the requested ranking. Refresh the graph.');
 if(trail){
  const anchor=trail.anchor;
  for(const key of ['space','identity','revision','mode','asOf'] as const)if(graph[key]!==anchor[key])throw changed();
  for(const key of totalKeys)if(graph.coverage.counts[key]!==anchor.totals[key])throw changed();
  const seen=new Set(trail.pages.flatMap((page,index)=>index===trail.index?[]:page.ids??[]));
  if(graph.entities.some(entity=>seen.has(entity.id)))throw Error('Knowledge pages repeat entities. Refresh the graph.');
  const previous=trail.pages[trail.index].ids;
  if(previous&&JSON.stringify(previous)!==JSON.stringify(graph.entities.map(entity=>entity.id)))throw changed();
  if(nextCursor&&trail.pages.slice(0,trail.index+1).some(page=>page.cursor===nextCursor))throw Error('Knowledge page cursor repeats. Refresh the graph.');
  const following=trail.pages[trail.index+1];
  if(following&&following.cursor!==nextCursor)throw changed();
 }
 return {graph,nextCursor};
}

export function moveKnowledgePage(trail:KnowledgeTrail|null,page:KnowledgePage,direction:-1|1):KnowledgeTrail {
 const graph=page.graph,index=trail?.index??0;
 if(direction===-1&&index===0||direction===1&&!page.nextCursor)throw Error('No knowledge page in that direction.');
 const anchor=trail?.anchor??{space:graph.space,identity:graph.identity,revision:graph.revision,mode:graph.mode,asOf:graph.asOf,totals:Object.fromEntries(totalKeys.map(key=>[key,graph.coverage.counts[key]]))};
 const pages=trail?trail.pages.map(page=>({...page})):[{cursor:null,ids:null}];
 pages[index]={cursor:pages[index].cursor,ids:graph.entities.map(entity=>entity.id)};
 if(direction===1&&!pages[index+1])pages.push({cursor:page.nextCursor,ids:null});
 return {anchor,index:index+direction,pages};
}
