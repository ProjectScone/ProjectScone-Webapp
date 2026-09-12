import {useState} from 'react';
import type {KnowledgeInference,ImpliedRelation,EntityInference} from './knowledge-implied';
import type {Knowledge} from './knowledge';
import './knowledge-implied.css';
const date=(value:string)=>new Date(value).toLocaleString(undefined,{timeZoneName:'short'});
export function InferenceEvidence({edge}:{edge:ImpliedRelation}){
 const [periodPage,setPeriodPage]=useState(0);
 return <details className="knowledge-inference-evidence"><summary>Rule, periods and premises</summary>
  <p>{edge.follows==='transitive'?'Transitive rule: follows through a chain of recorded relationships.':edge.follows==='symmetric'?'Symmetric rule: this predicate reads in both directions.':'Inverse rule: this predicate names the reverse relationship.'}</p>
  <p>Claims {edge.factIds.slice(0,100).join(', ')}{edge.factIds.length>100?` · ${edge.factIds.length-100} more supporting claim IDs`:''}</p>
  <ul aria-label="Inference validity periods">{edge.periods.slice(periodPage*20,(periodPage+1)*20).map(([start,end])=><li key={start}>From {date(start)} {end?`until ${date(end)} (end excluded)`:'with no recorded end'}</li>)}</ul>
  {edge.periods.length>20&&<nav aria-label="Validity period pages"><button disabled={!periodPage} onClick={()=>setPeriodPage(v=>v-1)}>Previous periods</button><span>{edge.periods.length} periods · page {periodPage+1}</span><button disabled={(periodPage+1)*20>=edge.periods.length} onClick={()=>setPeriodPage(v=>v+1)}>Next periods</button></nav>}
  <p>Premise relationship IDs, in order:</p><ol>{edge.premises.map(id=><li key={id}><code>{id}</code></li>)}</ol>
 </details>;
}
export function KnowledgeInferences({graph,value,shown,toggle,inspect}:{graph:Knowledge;value:KnowledgeInference;shown:boolean;toggle:(value:boolean)=>void;inspect:(id:string,factIds:number[])=>void}){
 const [page,setPage]=useState(0),names=new Map(graph.entities.map(e=>[e.id,e.label]));
 const edges=value.edges.slice(page*20,(page+1)*20),rules=value.meanings;
 if(!rules)return null;
 return <section className="knowledge-inferences" aria-label="Inferred relationships">
  <div><strong>Inferred relationships</strong><label><input type="checkbox" checked={shown} onChange={event=>toggle(event.target.checked)}/>Show dashed inferences on map</label></div>
  <p>{value.edges.length} inferred {value.edges.length===1?'relationship connects':'relationships connect'} this page’s entities · {value.total} found in the projection. These follow from configured rules and recorded premises; they are not separately asserted claims.</p>
  {value.capped&&<p role="status">Inference search stopped at a limit. Other inferred relationships may be missing.</p>}
  <details><summary>Inspect inferred relationships and limits</summary>
   <p>Search uses shortest routes, at most {rules.maxSteps} steps, {rules.maxWalked.toLocaleString()} examined links and {rules.maxImplied.toLocaleString()} results. Alternate routes can hold during other periods and may be omitted. Path search, communities and exports use recorded relationships.</p>
   {!value.edges.length&&<p>No inferred relationships were returned between these entities.</p>}
   <ul className="knowledge-inference-list">{edges.map(edge=><li key={edge.id}><p><strong>{names.get(edge.source)}</strong> → {edge.predicate.replaceAll('_',' ')} → <strong>{names.get(edge.target)}</strong></p><InferenceEvidence edge={edge}/><button className="btn quiet" onClick={()=>inspect(edge.source,edge.factIds)}>Inspect supporting claims</button></li>)}</ul>
   {value.edges.length>20&&<nav aria-label="Inference pages"><button disabled={page===0} onClick={()=>setPage(v=>v-1)}>Previous inferences</button><span>Page {page+1} of {Math.ceil(value.edges.length/20)}</span><button disabled={(page+1)*20>=value.edges.length} onClick={()=>setPage(v=>v+1)}>Next inferences</button></nav>}
  </details>
 </section>;
}
export function EntityInferences({edges,total}:{edges:EntityInference[];total?:number}){
 const [page,setPage]=useState(0);
 if(!edges.length)return null;
 return <section aria-label="Entity inferred relationships"><h3>Inferred connections</h3><p>{edges.length}{total!==undefined?` of ${total} found`: ' returned'} connections follow from rules. This list may omit other inferences.</p>{edges.slice(page*20,(page+1)*20).map(edge=><div className="knowledge-connection" key={edge.id}><p>{edge.subjectLabel} → <strong>{edge.predicate.replaceAll('_',' ')}</strong> → {edge.objectLabel}</p><InferenceEvidence edge={edge}/></div>)}{edges.length>20&&<nav aria-label="Entity inference pages"><button disabled={!page} onClick={()=>setPage(v=>v-1)}>Previous inferences</button><button disabled={(page+1)*20>=edges.length} onClick={()=>setPage(v=>v+1)}>Next inferences</button></nav>}</section>;
}
