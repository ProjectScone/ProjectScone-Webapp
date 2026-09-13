import type {ApiClient} from '../api.ts';
import {approvalAddress,matchContinuation,matchDecision,parseApproval,parseApprovalPage,prepareContinuation,sameCall,sameDecision,type ApprovalContinuation,type Decision,type ToolApproval} from './approvals.ts';
import {runAddress,type RunRequest,type RunStatus} from './runs.ts';
const secure={cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
type Transport=Pick<ApiClient,'request'>;
export async function readApprovals(api:Transport,request:RunRequest,signal:AbortSignal):Promise<Readonly<ToolApproval>[]> {
 signal.throwIfAborted();
 const raw=await api.request<unknown>(approvalAddress(request.run_id),{...secure,signal});
 signal.throwIfAborted();return parseApprovalPage(raw,request);
}
export async function decideApproval(api:Transport,request:RunRequest,pending:Readonly<ToolApproval>,decision:Decision,signal:AbortSignal):Promise<Readonly<ToolApproval>> {
 const checked=parseApproval(pending,request);if(decision!=='approve'&&decision!=='deny')throw Error('Choose approve or deny.');
 const items=await readApprovals(api,request,signal),current=items.find(item=>item.request_id===checked.request_id);
 if(!current||!sameCall(current,checked)||(current.decision!==null&&current.decision!==decision))throw Error('This call has changed. Check status before deciding.');
 signal.throwIfAborted();
 const saved=parseApproval(await api.request<unknown>(approvalAddress(request.run_id,checked.request_id),{...secure,signal,method:'POST',body:JSON.stringify({decision,expected_revision:1})}),request);
 signal.throwIfAborted();matchDecision(saved,current,decision);return saved;
}
export async function continueApprovals(api:Transport,request:RunRequest,expected:ApprovalContinuation,prior:readonly Readonly<ToolApproval>[],signal:AbortSignal):Promise<RunStatus> {
 const checked=prior.map(item=>parseApproval(item,request)),ids=Object.keys(expected.decisions);
 if(ids.some(id=>expected.decisions[id]!==2))throw Error('Invalid approval selection.');
 const body=prepareContinuation(checked,ids,expected.continuation_id);
 const current=await readApprovals(api,request,signal);
 prepareContinuation(current,ids,body.continuation_id);
 for(const id of ids){const latest=current.find(item=>item.request_id===id),original=checked.find(item=>item.request_id===id);if(!latest||!original||!sameDecision(latest,original))throw Error('A selected decision changed. Check status before continuing.');}
 signal.throwIfAborted();
 const result=await api.request<unknown>(runAddress(request.run_id)+'/approval-continuations',{...secure,signal,method:'POST',body:JSON.stringify(body)});
 signal.throwIfAborted();return matchContinuation(result,request,body,checked);
}
