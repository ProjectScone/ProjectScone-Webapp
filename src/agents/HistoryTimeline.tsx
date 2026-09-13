import {useEffect,useRef,useState} from 'react';
import {ApiError,type ApiClient} from '../api';
import {describeEntry,historyAddress,parseHistoryPage,type HistoryEntry,type HistoryPage} from './history';
import {readHistoryFrames} from './history-stream';
import type {RunRequest} from './runs';
const secureRequest={cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
const PAGE=50,SHOWN=2000,RECONNECTS=3;
function message(error:unknown):string{
 if(error instanceof ApiError){
  if(error.status===403)return 'This key cannot read execution history.';
  if(error.status===404)return 'No history is available for this run in the connected space.';
  if(error.status===409)return 'The history cannot be read in the run’s current state.';
  if(error.status===422)return 'The history cursor was refused. Reload the timeline from the start.';
 }
 return error instanceof Error?error.message:'The execution history is unavailable.';
}
interface Held {entries:HistoryEntry[];cursor:string|null;omitted:[number,number][];available:boolean|null;trimmed:number}
function absorb(held:Held,page:HistoryPage):Held{
 const known=new Set(held.entries.map(entry=>entry.position));
 const fresh=page.items.filter(entry=>!known.has(entry.position));
 let entries=[...held.entries,...fresh],trimmed=held.trimmed;
 if(entries.length>SHOWN){trimmed+=entries.length-SHOWN;entries=entries.slice(entries.length-SHOWN);}
 return {entries,cursor:page.next_after,available:page.available,trimmed,omitted:page.omitted&&!held.omitted.some(gap=>gap[0]===page.omitted?.[0])?[...held.omitted,page.omitted]:held.omitted};
}
export function HistoryTimeline({api,request,active}:{api:ApiClient;request:RunRequest;active:boolean}){
 const [held,setHeld]=useState<Held>({entries:[],cursor:null,omitted:[],available:null,trimmed:0}),[busy,setBusy]=useState(false),[following,setFollowing]=useState(false),[issue,setIssue]=useState(''),[note,setNote]=useState('');
 const stream=useRef<AbortController|null>(null),latest=useRef(held);latest.current=held;
 const id=request.run_id;
 const read=async(after:string|null,signal:AbortSignal):Promise<HistoryPage>=>{
  const page=await api.request<unknown>(historyAddress(id)+'?limit='+PAGE+(after?'&after='+encodeURIComponent(after):''),{...secureRequest,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  return parseHistoryPage(page,request,after,PAGE);
 };
 useEffect(()=>{
  const controller=new AbortController();setHeld({entries:[],cursor:null,omitted:[],available:null,trimmed:0});setIssue('');setNote('');setBusy(true);
  void read(null,controller.signal).then(page=>{if(!controller.signal.aborted)setHeld(absorb({entries:[],cursor:null,omitted:[],available:null,trimmed:0},page));})
   .catch(error=>{if(!controller.signal.aborted)setIssue(message(error));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>{controller.abort();stream.current?.abort();};
 },[api,request]);  // eslint-disable-line react-hooks/exhaustive-deps
 const more=async()=>{
  if(busy||following||!held.cursor)return;
  const controller=new AbortController();setBusy(true);setIssue('');
  try{const page=await read(held.cursor,controller.signal);setHeld(current=>absorb(current,page));}
  catch(error){setIssue(message(error));}
  finally{setBusy(false);}
 };
 const follow=async()=>{
  if(following||busy)return;
  const controller=new AbortController();stream.current=controller;setFollowing(true);setIssue('');setNote('');
  let stalls=0;
  try{
   while(!controller.signal.aborted){
    const before=latest.current.cursor;let moved=false;
    const body=await api.historyStream(id,before,PAGE,controller.signal);
    for await(const page of readHistoryFrames(body,{request,after:before,limit:PAGE})){
     if(controller.signal.aborted)return;
     if(page.items.length)moved=true;
     setHeld(current=>absorb(current,page));
     const last=page.items[page.items.length-1];
     if(last&&last.event.type==='collection'&&last.event.kind!=='collection_started'){setNote('Observation finished; the collector recorded no more events for this run.');return;}
    }
    // The server closed its observation window. Reconnect from the last
    // cursor while the run is still going; a window that brought nothing
    // three times in a row is left, and said so, rather than polled forever.
    if(!active){setNote('The observation window ended and the run is not active. Use Follow live again to look for more.');return;}
    stalls=moved?0:stalls+1;
    if(stalls>=RECONNECTS){setNote(`No new events across ${RECONNECTS} observation windows; following stopped. Use Follow live again to continue.`);return;}
   }
  }catch(error){if(!controller.signal.aborted)setIssue(message(error));}
  finally{if(stream.current===controller){stream.current=null;setFollowing(false);}}
 };
 const stop=()=>{stream.current?.abort();stream.current=null;setFollowing(false);};
 return <section className="agent-timeline" aria-label="Execution timeline"><h4>Timeline</h4>
  <p className="agent-timeline-note">Execution metadata as it was recorded: turns, model and tool calls, their timing and outcomes. Prompts, tool arguments, answers and reasoning are never in this timeline.</p>
  {held.available===false&&<p>No retained observations are available for this run.</p>}
  {held.omitted.map(gap=><p key={gap[0]} className="agent-notice">Positions {gap[0]}–{gap[1]} were removed by retention and cannot be shown.</p>)}
  {held.trimmed>0&&<p className="agent-notice">{held.trimmed} earlier entr{held.trimmed===1?'y':'ies'} trimmed from view; reopen the run to read from the start.</p>}
  {held.entries.length>0&&<ol className="agent-timeline-entries">{held.entries.map(entry=>{const said=describeEntry(entry);return <li key={entry.position}><span className="agent-timeline-position">#{entry.position}</span> <strong>{said.title}</strong> · {entry.step_id}{entry.selection_id!==entry.step_id?` · ${entry.selection_id}`:''}<br/><small>{said.detail}</small></li>;})}</ol>}
  {held.available&&!held.entries.length&&!busy&&<p>No events have been recorded yet.</p>}
  <div className="agent-actions">
   {held.cursor&&!following&&<button disabled={busy} onClick={()=>void more()}>{busy?'Loading…':'Load more'}</button>}
   {held.available&&(following?<button onClick={stop}>Stop following</button>:<button disabled={busy} onClick={()=>void follow()}>Follow live</button>)}
   {following&&<span role="status">Following live…</span>}
  </div>
  {note&&<p role="status" className="agent-notice">{note}</p>}
  {issue&&<p role="alert" className="agent-notice">{issue}</p>}
 </section>;
}
