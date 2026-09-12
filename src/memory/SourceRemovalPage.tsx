import {displayFilename} from './filename-display';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Link,useLocation,useParams} from 'react-router-dom';
import {ApiError,type ApiClient} from '../api';
import {WorkspaceState} from '../components/WorkspaceState';
import {readSourceAddress,sourceAddress} from './source-address';
import {readRemoval,removeSource,type ForgetReceipt,type RemovalAddress,type RemovalView} from './source-removal';
import './source-page.css';
import './source-removal.css';

type Result={kind:'ready';view:RemovalView}|{kind:'done';receipt:ForgetReceipt}|{kind:'issue';message:string;uncertain:boolean};
function Inventory({label,ids}:{label:string;ids:readonly (number|string)[]}){
 const [page,setPage]=useState(0),pages=Math.max(1,Math.ceil(ids.length/20));
 return <details className="removal-inventory"><summary>{label} · {ids.length}</summary>
  {ids.length===0?<p>None reported.</p>:<><ul>{ids.slice(page*20,(page+1)*20).map(id=><li key={id}><code>{typeof id==='number'?`#${id}`:id}</code></li>)}</ul>
   {pages>1&&<div className="removal-actions"><button className="btn quiet small" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous {label.toLowerCase()}</button><span>Page {page+1} of {pages}</span><button className="btn quiet small" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>Next {label.toLowerCase()}</button></div>}</>}
 </details>;
}
function Impact({receipt,completed}:{receipt:ForgetReceipt;completed:boolean}){
 return <section className="removal-impact" aria-label={completed?'Removal receipt':'Removal impact'}>
  <div className="removal-counts"><div><strong>{receipt.chunks}</strong><span>chunks {completed?'removed':'to remove'}</span></div><div><strong>{receipt.attachments_released.length}</strong><span>attachments {completed?'released':'to release'}</span></div><div><strong>{receipt.attachments_kept.length}</strong><span>shared attachments retained</span></div></div>
  <p>Claims and links that cite this source remain in the ledger, including any retained quotes. Review them separately if they should no longer be used.</p>
  <Inventory label="Citing claims" ids={receipt.facts_citing}/><Inventory label="Citing links" ids={receipt.links_citing}/>
  <Inventory label="Released attachments" ids={receipt.attachments_released}/><Inventory label="Shared attachments" ids={receipt.attachments_kept}/>
 </section>;
}
function Removal({api,address}:{api:ApiClient;address:RemovalAddress}){
 const context=useMemo(()=>({api,episodeId:address.episodeId,space:address.space}),[api,address.episodeId,address.space]);
 const [snapshot,setSnapshot]=useState<{context:typeof context;result:Result}|null>(null),[busy,setBusy]=useState<'read'|'remove'|null>('read'),[confirmed,setConfirmed]=useState(false);
 const active=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement>(null);
 const current=snapshot?.context===context?snapshot.result:null;
 const start=()=>{active.current?.abort();const controller=new AbortController();active.current=controller;setConfirmed(false);setSnapshot(null);return controller;};
 const save=(controller:AbortController,result:Result)=>{if(active.current===controller&&!controller.signal.aborted){setSnapshot({context,result});setBusy(null);}};
 const read=async()=>{
  const controller=start();setBusy('read');
  try{const view=await readRemoval(api,address,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));save(controller,{kind:'ready',view});}
  catch(error){save(controller,{kind:'issue',uncertain:false,message:error instanceof ApiError&&error.status===404?'This source is unavailable in the linked space.':error instanceof Error?error.message:'Removal status could not be checked.'});}
 };
 useEffect(()=>{void read();return()=>{active.current?.abort();active.current=null;};},[context]); // Context binds every response to the connected source.
 useEffect(()=>{if(current)heading.current?.focus();},[current]);
 const remove=async()=>{
  if(!confirmed||busy||current?.kind!=='ready'||current.view.status.state==='forgotten')return;
  const controller=start();setBusy('remove');
  try{const receipt=await removeSource(api,address.episodeId,AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]));save(controller,{kind:'done',receipt});}
  catch(error){save(controller,{kind:'issue',uncertain:true,message:error instanceof ApiError&&error.status===403?'Your key does not allow source removal. The connection remains available.':'The removal response could not be verified. Cleanup may already have started or finished. Check status before taking another action.'});}
 };
 const view=current?.kind==='ready'?current.view:null,done=current?.kind==='done',forgotten=done||view?.status.state==='forgotten';
 return <article>
  <header className="removal-heading"><span className="eyebrow">{address.space} / Episode #{address.episodeId}</span><h1 ref={heading} tabIndex={-1}>{forgotten?'Source removed':'Remove source'}</h1>{view&&<p className="removal-title">{displayFilename(view.title)}</p>}</header>
  {!current?<WorkspaceState icon="documents" role="status" busy title={busy==='remove'?'Removing source…':'Checking source removal…'} description={busy==='remove'?'Waiting for the cleanup receipt. Leaving this page does not undo a request already sent.':'Checking this space, source and cleanup state.'}/>
   :current.kind==='issue'?<WorkspaceState icon="documents" role="alert" title={current.uncertain?'Removal unconfirmed':'Source could not be checked'} description={current.message} actions={<button className="btn quiet" onClick={()=>void read()}>Check removal status</button>}/>
   :forgotten?<section aria-label="Source removal complete"><p role="status">Removal is confirmed for episode #{address.episodeId} in “{address.space}”.</p>
    <p className="muted">Recorded at {current.kind==='done'?current.receipt.forgotten_at:view?.status.state==='forgotten'?view.status.forgotten_at:''}.</p>
    {current.kind==='done'?<Impact completed receipt={current.receipt}/>:<p>The completion record confirms removal. A full receipt with counts is unavailable from this status read. Claims and links remain; attachments shared with other sources may remain.</p>}
    <p>Copies you downloaded and backups are outside this source-removal action.</p><Link className="btn primary" to="/memory#documents">Return to source library</Link>
   </section>
   :view&&<>
    {view.status.state==='pending'&&<p role="status" className="removal-pending">Cleanup is pending from {view.status.requested_at}. This page has only checked its status. Resume cleanup explicitly to finish the original removal.</p>}
    <p>This removes the retained source text and its search chunks and vectors. Attachments are released only when no other source in this space carries them. The source cannot be restored by this page.</p>
    {view.impact&&<Impact key={snapshot===null?'empty':view.status.state} receipt={view.impact} completed={false}/>}
    <p className="muted">{view.status.state==='pending'?'These are the targets recorded when cleanup started. Some cleanup may already be complete.':'This preview reflects the current records. Other writes can change the final impact before removal.'} Copies you downloaded and backups are outside this action.</p>
    <form className="removal-confirm" onSubmit={event=>{event.preventDefault();void remove();}}><label><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>I confirm removal of episode #{address.episodeId} from “{address.space}” and understand that citing claims and links remain.</span></label>
     <div className="removal-actions"><button className="btn removal-danger" disabled={!confirmed||busy!==null}>{view.status.state==='pending'?'Resume source cleanup':'Remove this source'}</button><button type="button" className="btn quiet" onClick={()=>void read()}>Refresh impact and status</button></div>
    </form>
   </>}
 </article>;
}
export function SourceRemovalPage({api,enabled}:{api:ApiClient;enabled:boolean}){
 const {id}=useParams(),location=useLocation(),address=readSourceAddress(id,location.search);
 return <main id="main" className="source-page source-removal"><nav aria-label="Source navigation"><Link to="/memory#documents">← Source library</Link>{address&&<Link to={sourceAddress(address.episodeId,address.space)}>Open source</Link>}</nav>
  {!address?<WorkspaceState icon="documents" title="Invalid source link" description="Open source removal from the source library so the episode and memory space can be checked."/>
   :!enabled?<WorkspaceState icon="memory" title="Connect to manage this source" description={`Connect to “${address.space}” using Memory connection.`}/>
   :<Removal key={`${address.space}:${address.episodeId}`} api={api} address={address}/>}
 </main>;
}
