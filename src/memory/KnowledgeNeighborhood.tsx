import {useEffect,useMemo,useState} from 'react';
import type {ApiClient} from '../api';
import {EntityPicker} from './KnowledgePath';
import {EvidenceNetworkCanvas} from './EvidenceNetworkCanvas';
import {knowledgeNetwork,type Knowledge} from './knowledge';
import type {PathEntity} from './knowledge-path';
import {neighborhoodRequest,parseNeighborhood} from './knowledge-neighborhood';

export function KnowledgeNeighborhood({api,graph,searchAvailable,selected,inspect,clearInspection}:{api:ApiClient;graph:Knowledge;searchAvailable:boolean;selected:PathEntity|null;inspect:(entity:PathEntity)=>void;clearInspection:()=>void}){
 const [draft,setDraft]=useState<{graph:Knowledge;seeds:PathEntity[];limit:string;hub:string}>({graph,seeds:[],limit:'150',hub:'64'});
 const [picker,setPicker]=useState(0),[recordPage,setRecordPage]=useState(0),[chosen,setChosen]=useState<string|null>(null);
 const seeds=useMemo(()=>draft.graph===graph?draft.seeds:[],[draft,graph]),limit=draft.graph===graph?draft.limit:'150',hub=draft.graph===graph?draft.hub:'64';
 const settings=useMemo(()=>{try{return {value:neighborhoodRequest(seeds,Number(limit),Number(hub)),error:null};}catch(error){return {value:null,error:error instanceof Error?error.message:'Invalid neighborhood settings.'};}},[seeds,limit,hub]);
 const context=useMemo(()=>({api,graph,settings}),[api,graph,settings]);
 const [submission,setSubmission]=useState<{context:object;settings:NonNullable<typeof settings.value>}|null>(null);
 const [snapshot,setSnapshot]=useState<{request:object;data?:Knowledge;error?:string}|null>(null);
 const request=submission?.context===context?submission:null;
 const update=(next:Partial<Pick<typeof draft,'seeds'|'limit'|'hub'>>)=>{clearInspection();setChosen(null);setRecordPage(0);setDraft({graph,seeds,limit,hub,...next});};
 const add=(entity:PathEntity|null)=>{if(entity&&seeds.length<24&&!seeds.some(seed=>seed.id===entity.id)){update({seeds:[...seeds,entity]});setPicker(value=>value+1);}};
 useEffect(()=>{
  if(!request)return;
  const controller=new AbortController(),params=new URLSearchParams({status:graph.mode,as_of:graph.asOf,limit:String(request.settings.limit),attribute_limit:'1000',hub_degree:String(request.settings.hubDegree)});
  request.settings.seeds.forEach(seed=>params.append('seed',seed.id));
  api.request<unknown>('/v1/graph/knowledge?'+params,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),cache:'no-store'})
   .then(value=>parseNeighborhood(value,graph,request.settings)).then(data=>{if(!controller.signal.aborted)setSnapshot({request,data});})
   .catch(error=>{if(!controller.signal.aborted)setSnapshot({request,error:error instanceof Error?error.message:'Neighborhood could not be read.'});});
  return()=>controller.abort();
 },[request]);
 const result=request&&snapshot?.request===request?snapshot:null,data=result?.data;
 const network=useMemo(()=>data?knowledgeNetwork(data):null,[data]);
 const visible=useMemo(()=>{if(!network)return null;const nodes=network.nodes.slice(0,150),selected=network.nodes.find(node=>node.id===chosen);if(selected&&!nodes.some(node=>node.id===chosen))nodes.splice(-1,1,selected);const ids=new Set(nodes.map(node=>node.id));return {nodes,edges:network.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target)).slice(0,1000)};},[network,chosen]);
 const choose=(id:string)=>{if(!data)return;const entity=data.entities.find(entity=>entity.id===id);if(entity){setChosen(id);setRecordPage(Math.floor(data.entities.indexOf(entity)/20));inspect(entity);}};
 const cancel=()=>{setSubmission(null);setChosen(null);setRecordPage(0);clearInspection();};
 return <section className="knowledge-neighborhood" aria-label="Connected neighborhood">
  <p>Choose starting entities to explore their recorded connections in both directions. High-degree hubs remain visible, but the walk stops there unless they are starting entities.</p>
  {seeds.length<24&&(searchAvailable?<EntityPicker key={picker} api={api} graph={graph} label="Add starting entity" selected={null} choose={add}/>:<label>Add starting entity<select value="" onChange={event=>add(graph.entities.find(entity=>entity.id===event.target.value)??null)}><option value="">Choose from this map</option>{graph.entities.filter(entity=>!seeds.some(seed=>seed.id===entity.id)).map(entity=><option key={entity.id} value={entity.id}>{entity.label}</option>)}</select></label>)}
  {selected&&!seeds.some(seed=>seed.id===selected.id)&&seeds.length<24&&<button type="button" className="btn quiet" onClick={()=>add(selected)}>Add selected: {selected.label}</button>}
  <ul className="knowledge-neighborhood-seeds" aria-label="Starting entities">{seeds.map(seed=><li key={seed.id}><span>{seed.label}</span><button type="button" className="btn quiet" onClick={()=>update({seeds:seeds.filter(value=>value.id!==seed.id)})} aria-label={`Remove ${seed.label}`}>Remove</button></li>)}</ul>
  <form onSubmit={event=>{event.preventDefault();if(settings.value){clearInspection();setChosen(null);setRecordPage(0);setSubmission({context,settings:settings.value});}}}>
   <label>Maximum entities<input type="number" min={Math.max(1,seeds.length)} max="1000" step="1" required value={limit} onChange={event=>update({limit:event.target.value})}/></label>
   <label>Hub degree cutoff<input type="number" min="1" max="100000" step="1" required value={hub} onChange={event=>update({hub:event.target.value})}/></label>
   <button className="btn quiet" disabled={!settings.value||Boolean(request&&!result)}>Explore neighborhood</button>{request&&<button type="button" className="btn quiet" onClick={cancel}>Clear neighborhood</button>}
  </form>
  {settings.error&&<p>{settings.error}</p>}
  {request&&!result?<p role="status">Reading connected entities…</p>:result?.error?<div role="alert"><p>{result.error}</p><p>Refresh the main graph if its evidence has changed.</p></div>:data&&network&&visible&&<>
   <p role="status"><strong>{data.coverage.truncated?'Partial neighborhood':'Returned neighborhood'}</strong> · {data.entities.length} of {data.coverage.counts.entities_total} entities in the read · {data.relations.length} relationships</p>
   {data.coverage.reasons.length>0&&<p>{data.coverage.reasons.map(reason=>reason.replaceAll('_',' ')).join(' · ')}. Other entities or connections may exist.</p>}
   <div className="knowledge-neighborhood-map"><EvidenceNetworkCanvas nodes={visible.nodes} edges={visible.edges} groupColors={false} selectedNode={chosen} selectedEdge={null} selectNode={choose} selectEdge={id=>{const edge=visible.edges.find(edge=>edge.id===id);if(edge)choose(edge.source);}} reset={()=>{setChosen(null);clearInspection();}}/></div>
   {(visible.nodes.length<data.entities.length||visible.edges.length<data.relations.length)&&<p>Map draws {visible.nodes.length} of {data.entities.length} entities and {visible.edges.length} of {data.relations.length} relationships. The directory below reaches every returned entity; selecting one brings it into the map.</p>}
   <ul className="knowledge-neighborhood-directory" aria-label="Neighborhood entities">{data.entities.slice(recordPage*20,(recordPage+1)*20).map(entity=><li key={entity.id}><button type="button" aria-pressed={chosen===entity.id} onClick={()=>choose(entity.id)}><strong>{entity.label}</strong><span>{seeds.some(seed=>seed.id===entity.id)?'Starting entity · ':''}{entity.claims} claims</span></button></li>)}</ul>
   {data.entities.length>20&&<nav aria-label="Neighborhood directory pages"><button className="btn quiet" disabled={recordPage===0} onClick={()=>setRecordPage(value=>value-1)}>Previous neighborhood entities</button><span>{recordPage*20+1}–{Math.min((recordPage+1)*20,data.entities.length)} of {data.entities.length}</span><button className="btn quiet" disabled={(recordPage+1)*20>=data.entities.length} onClick={()=>setRecordPage(value=>value+1)}>Next neighborhood entities</button></nav>}
  </>}
 </section>;
}
