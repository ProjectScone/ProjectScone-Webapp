import {useEffect,useRef,useState} from 'react';
import {type ApiClient} from '../api';
import {inputAddress,matchInputActivation,parseInput,parseInputPage,validateResponse,type RunInput} from './inputs';
import {record} from './plans';
import {matchRun,parseRunStatus,runAddress,type RunRequest,type RunStatus} from './runs';
const secureRequest={cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
function contexts(input:RunInput):{task_id:string;text:string}[]{
 const values:unknown=JSON.parse(input.context);
 if(!Array.isArray(values))return [];
 return (values as unknown[]).map(value=>{const row=record(value);if(typeof row.task_id!=='string'||typeof row.text!=='string')throw Error('Invalid dependency context.');return {task_id:row.task_id,text:row.text};});
}
export function InputPanel({api,request,status,items,onChanged}:{api:ApiClient;request:RunRequest;status:RunStatus;items:RunInput[];onChanged:()=>void}){
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[selected,setSelected]=useState<Set<string>>(()=>new Set(items.filter(item=>item.revision===2).map(item=>item.task_id))),[busy,setBusy]=useState(false),[issue,setIssue]=useState('');
 const active=useRef<AbortController|null>(null),attempt=useRef<{continuation_id:string;responses:Record<string,number>}|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 const save=async(input:RunInput)=>{
  if(busy)return;setIssue('');const controller=new AbortController();active.current=controller;
  try{
   const body=validateResponse(input,drafts[input.task_id]??'');setBusy(true);
   const saved=parseInput(await api.request<unknown>(inputAddress(request.run_id,input.task_id),{...secureRequest,method:'POST',body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),request);
   if(saved.task_id!==input.task_id||saved.response!==body.response||saved.revision<2)throw Error('The saved reply did not match your response.');
   if(!controller.signal.aborted)onChanged();
  }catch(error){if(!controller.signal.aborted)setIssue((error instanceof Error?error.message:'Reply could not be confirmed.')+' Check status to confirm whether this reply was saved.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 const resume=async(recovery?:{continuation_id:string;responses:Record<string,number>})=>{
  if(busy||status.active_local||status.outcome_unknown)return;
  const body=recovery??attempt.current??{continuation_id:crypto.randomUUID(),responses:Object.fromEntries(items.filter(item=>item.revision===2&&selected.has(item.task_id)).map(item=>[item.task_id,2]))};
  if(!Object.keys(body.responses).length)return;
  attempt.current=body;setBusy(true);setIssue('');const controller=new AbortController();active.current=controller;
  try{
   const progress=parseRunStatus(await api.request<unknown>(runAddress(request.run_id)+'/continue',{...secureRequest,method:'POST',body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),request.space,request.run_id);
   matchRun(progress,request);
   const confirmed=parseInputPage(await api.request<unknown>(runAddress(request.run_id)+'/inputs',{...secureRequest,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),request);
   matchInputActivation(confirmed,body,items);
   if(!controller.signal.aborted){attempt.current=null;onChanged();}
  }catch(error){if(!controller.signal.aborted)setIssue((error instanceof Error?error.message:'Continuation could not be confirmed.')+' Check this run’s status before retrying the same continuation.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 const recoveries=new Map<string,RunInput[]>();
 for(const input of items)if(input.activation_id){const group=recoveries.get(input.activation_id)??[];group.push(input);recoveries.set(input.activation_id,group);}
 const canContinue=!status.active_local&&!status.outcome_unknown&&!['cancelled','sources_invalid','completed','running'].includes(status.status);
 return <section className="agent-inputs" aria-label="Human input requests"><h4>Human input requests</h4><p>Save your reply, then choose when to continue. Saving a reply does not call a model.</p>
  {items.map(input=><article className="agent-task" key={input.task_id}><h5>{input.task_id} · {status.completed_steps.includes(input.task_id)?'Used in this run':input.revision===3?'Continuation authorized':input.revision===2?'Reply saved':'Waiting for your reply'}</h5><p className="agent-output">{input.prompt}</p>
   {contexts(input).length>0&&<details><summary>Previous task outputs</summary>{contexts(input).map(value=><div key={value.task_id}><strong>{value.task_id}</strong><p className="agent-output">{value.text}</p></div>)}</details>}
   {input.response===null?<form onSubmit={event=>{event.preventDefault();void save(input);}}><label>Reply to {input.task_id}<textarea required maxLength={input.max_response_bytes} rows={3} value={drafts[input.task_id]??''} disabled={busy||status.status==='cancelled'} onChange={event=>setDrafts(current=>({...current,[input.task_id]:event.target.value}))}/></label><p>Maximum {input.max_response_bytes.toLocaleString()} UTF-8 bytes.</p><button disabled={busy||status.status==='cancelled'}>Save reply</button></form>:<><p className="agent-output">{input.response}</p>{input.revision===2&&<label><input type="checkbox" disabled={busy||attempt.current!==null} checked={selected.has(input.task_id)} onChange={event=>setSelected(current=>{const next=new Set(current);if(event.target.checked)next.add(input.task_id);else next.delete(input.task_id);return next;})}/>Use this reply when continuing</label>}</>}
  </article>)}
  {items.some(input=>input.revision===2)&&<button className="primary" disabled={busy||!canContinue||(!selected.size&&!attempt.current)} onClick={()=>void resume()}>{busy?'Submitting…':attempt.current?'Retry same continuation':'Continue with selected replies'}</button>}
  {[...recoveries].filter(([,group])=>group.some(input=>!status.completed_steps.includes(input.task_id))).map(([id,group])=><button key={id} disabled={busy||!canContinue} onClick={()=>void resume({continuation_id:id,responses:Object.fromEntries(group.map(input=>[input.task_id,2]))})}>Retry saved continuation</button>)}
  {status.active_local&&<p>Independent work is still running. You can save replies now and continue once it finishes.</p>}
  {issue&&<p role="alert">{issue}</p>}
 </section>;
}
