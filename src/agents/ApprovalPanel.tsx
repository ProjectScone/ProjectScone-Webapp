import {displayArguments} from './approval-json';
import {useEffect,useRef,useState} from 'react';
import {ApiError,type ApiClient} from '../api';
import {continueApprovals,decideApproval,type ApprovalAttemptRef} from './approval-actions';
import {prepareContinuation,type Decision,type ToolApproval} from './approvals';
import type {RunRequest,RunStatus} from './runs';
function issue(error:unknown):string {
 if(error instanceof ApiError){
  if(error.status===403)return 'This key cannot perform that action. Decisions require a review or full key; continuing requires a write or full key.';
  if(error.status===409)return 'The request changed or cannot continue in its current state. Check status to review the current call, decision and run.';
  if(error.status===429)return 'The server is busy. Check status before retrying the same continuation.';
  if(error.status===404)return 'This approval is no longer available in the connected space.';
 }
 return error instanceof Error?error.message:'The approval could not be confirmed.';
}
function stage(item:Readonly<ToolApproval>):string {
 if(item.revision===1)return 'Needs your decision';
 if(item.revision===2)return item.decision==='approve'?'Approved · waiting to continue':'Denied · waiting to continue';
 if(item.revision===3)return 'Continuation saved';
 return 'Execution admitted';
}
function Arguments({value}:{value:string}){
 const visible=displayArguments(value);
 return <>{visible!==value&&<p className="agent-arguments-note">Directional control characters are shown as Unicode escapes.</p>}<pre className="agent-arguments" dir="ltr">{visible}</pre></>;
}
export function ApprovalPanel({api,request,status,items,onChanged,attempt}:{api:ApiClient;request:RunRequest;status:RunStatus;items:readonly Readonly<ToolApproval>[];onChanged:()=>void;attempt:ApprovalAttemptRef}){
 const [selected,setSelected]=useState<Set<string>>(()=>new Set()),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[api,request.run_id,request.space]);
 const safe=!status.active_local&&!status.outcome_unknown&&!['cancelled','sources_invalid','completed','running','unavailable'].includes(status.status);
 const pending=items.filter(item=>item.revision<4),history=items.filter(item=>item.revision===4);
 const decide=async(item:Readonly<ToolApproval>,decision:Decision)=>{
  if(busy||!safe||attempt.current)return;
  const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');
  try{
   await decideApproval(api,request,item,decision,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
   if(!controller.signal.aborted)onChanged();
  }catch(error){if(!controller.signal.aborted)setMessage(issue(error)+' Decision not confirmed. Check status before deciding again.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 const resume=async(recoveryId?:string)=>{
  if(busy||!safe)return;
  const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');
  try{
   if(!attempt.current){
    const ids=recoveryId?items.filter(item=>item.activation_id===recoveryId).map(item=>item.request_id):[...selected];
    attempt.current={body:prepareContinuation(items,ids,recoveryId??crypto.randomUUID()),prior:items};
   }
   const saved=attempt.current;
   await continueApprovals(api,request,saved.body,saved.prior,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
   if(!controller.signal.aborted){attempt.current=null;onChanged();}
  }catch(error){if(!controller.signal.aborted)setMessage(issue(error)+' Continuation not confirmed. Check status or retry this same continuation; it will not be submitted automatically.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 const recoveries=[...new Set(pending.filter(item=>item.revision===3).map(item=>item.activation_id))].filter((id):id is string=>id!==null);
 return <section className="agent-approvals" aria-label="Tool approval requests">
  <h4>Tool approval requests</h4><p>Review the exact call, then approve or deny it. Saving a decision does not run a tool or call a model. Continue separately when you are ready.</p>
  {pending.map(item=><article className="agent-approval" key={item.request_id} aria-label={`Tool request ${item.call.step_id}`}>
   <div className="agent-task-heading"><h5>{item.call.tool_name}</h5><span className="agent-approval-stage">{stage(item)}</span></div>
   <dl className="agent-approval-facts"><div><dt>Agent</dt><dd>{item.call.agent_id}</dd></div><div><dt>Selected model</dt><dd>{item.call.model_id}</dd></div><div><dt>Workflow step</dt><dd>{item.call.step_id}</dd></div><div><dt>Tool revision</dt><dd>{item.call.tool_revision}</dd></div></dl>
   <p className="agent-arguments-label">Exact arguments (JSON)</p><Arguments value={item.call.arguments_json}/>
   <details className="agent-approval-identity"><summary>Request details</summary><dl><dt>Request identifier</dt><dd>{item.request_id}</dd><dt>Record revision</dt><dd>{item.revision}</dd><dt>Requested</dt><dd>{item.created_at}</dd>{item.decided_by&&<><dt>Decided by</dt><dd>{item.decided_by}</dd></>}{item.activation_id&&<><dt>Continuation identifier</dt><dd>{item.activation_id}</dd></>}</dl></details>
   {item.revision===1?<div className="agent-actions"><button disabled={busy||!safe||attempt.current!==null} onClick={()=>void decide(item,'approve')}>Approve {item.call.tool_name}</button><button disabled={busy||!safe||attempt.current!==null} onClick={()=>void decide(item,'deny')}>Deny {item.call.tool_name}</button></div>:<p>{item.decision==='approve'?'This exact call is approved.':'The tool handler will be skipped.'} {item.revision===2?'Continue to let the agent proceed.':'The saved continuation can be retried explicitly.'}</p>}
   {item.revision===2&&<label className="agent-approval-select"><input type="checkbox" checked={selected.has(item.request_id)} disabled={busy||!safe||attempt.current!==null} onChange={event=>setSelected(current=>{const next=new Set(current);if(event.target.checked)next.add(item.request_id);else next.delete(item.request_id);return next;})}/>Continue with this {item.decision==='approve'?'approval':'denial'}</label>}
  </article>)}
  {(pending.some(item=>item.revision===2)||attempt.current)&&<div className="agent-actions"><button className="primary" disabled={busy||!safe||(!attempt.current&&!selected.size)} onClick={()=>void resume()}>{busy?'Submitting…':attempt.current?'Retry same tool continuation':`Continue with selected decisions (${selected.size})`}</button></div>}
  {!attempt.current&&recoveries.map(id=><button className="agent-recovery" key={id} disabled={busy||!safe} onClick={()=>void resume(id)}>Retry saved tool continuation {id}</button>)}
  {attempt.current&&<p className="agent-approval-attempt">Continuation: {attempt.current.body.continuation_id}</p>}
  {status.active_local&&pending.length>0&&<p>Independent work is still running. Check status when it finishes.</p>}
  {history.length>0&&<details className="agent-approval-history"><summary>Previously admitted calls ({history.length})</summary><p>Admission alone does not confirm an effect completed. Check the run results and any unknown-outcome notice.</p><ul>{history.map(item=><li key={item.request_id}>{item.call.step_id} · {item.call.tool_name} · {item.decision==='approve'?'Approved':'Denied'}<details><summary>Exact request</summary><p>{item.call.agent_id} · {item.call.model_id} · Tool revision {item.call.tool_revision}</p><Arguments value={item.call.arguments_json}/><p>{item.request_id}</p></details></li>)}</ul></details>}
  {message&&<p className="agent-notice" role="alert">{message}</p>}
 </section>;
}
