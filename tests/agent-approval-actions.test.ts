import test from 'node:test';
import assert from 'node:assert/strict';
import {readApprovals,decideApproval,continueApprovals} from '../src/agents/approval-actions.ts';
import {parseApproval,prepareContinuation} from '../src/agents/approvals.ts';
import {request,pending,decided,status,page} from './fixtures/agent-approval-data.ts';
function transport(responses:unknown[]){const calls:{path:string;options?:RequestInit}[]=[];return {calls,api:{async request<T>(path:string,options?:RequestInit):Promise<T>{calls.push({path,options});const response=responses.shift();if(response instanceof Error)throw response;return response as T;}}};}
test('reading and deciding each perform only their explicit action',async()=>{
 const t=transport([page([pending]),page([pending]),decided]),signal=new AbortController().signal;
 const [item]=await readApprovals(t.api,request,signal);await decideApproval(t.api,request,item,'approve',signal);
 const writes=t.calls.filter(call=>call.options?.method==='POST');assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].options!.body as string),{decision:'approve',expected_revision:1});
 assert.ok(t.calls.every(call=>call.options?.cache==='no-store'));
});
test('source snapshot changes and cancellation refuse before POST',async()=>{
 const p=parseApproval(pending,request),t=transport([page([{...pending,call:{...pending.call,arguments_json:'{"message":"changed"}'}}])]);
 await assert.rejects(()=>decideApproval(t.api,request,p,'approve',new AbortController().signal));assert.equal(t.calls.length,1);
 const controller=new AbortController();let writes=0;
 const api={async request<T>(path:string,options?:RequestInit):Promise<T>{if(options?.method==='POST')writes++;controller.abort();return page([pending]) as T;}};
 await assert.rejects(()=>decideApproval(api,request,p,'approve',controller.signal));assert.equal(writes,0);
});
test('ambiguous continuation is never automatically replayed',async()=>{
 const d=parseApproval(decided,request),body=prepareContinuation([d],[d.request_id],'next'),t=transport([page([decided]),Error('connection lost')]);
 await assert.rejects(()=>continueApprovals(t.api,request,body,[d],new AbortController().signal));
 assert.equal(t.calls.filter(call=>call.options?.method==='POST').length,1);
});
test('changed decision hashes cannot authorize continuation',async()=>{
 const d=parseApproval(decided,request),body=prepareContinuation([d],[d.request_id],'next'),t=transport([page([{...decided,decision_digest:'f'.repeat(64)}])]);
 await assert.rejects(()=>continueApprovals(t.api,request,body,[d],new AbortController().signal));assert.equal(t.calls.length,1);
});
