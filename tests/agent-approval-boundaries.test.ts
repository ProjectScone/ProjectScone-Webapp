import test from 'node:test';
import assert from 'node:assert/strict';
import {literalArguments} from '../src/agents/approval-json.ts';
import {parseApproval,parseApprovalPage,prepareContinuation,matchContinuation} from '../src/agents/approvals.ts';
import {request,pending,decided,status} from './fixtures/agent-approval-data.ts';

test('literal boundary preserves exact valid values and never builds prototype-bearing objects',()=>{
 const maximum=(1n<<256n)-1n;
 for(const raw of ['{"__proto__":{"polluted":true},"constructor":{"prototype":1}}',`{"x":${maximum}}`,`{"x":-${maximum}}`,'{"big":9007199254740993,"decimal":1.0000000000000002,"zero":-0.0}', '{"line":"a\\nb","pair":"😀","escaped":"\\u0061"}']){
  assert.equal(literalArguments(raw),raw);
 }
 assert.equal(({} as {polluted?:boolean}).polluted,undefined);
});
test('literal malformed, UTF8, integer and depth bounds refuse',()=>{
 for(const raw of ['{"x":1,"\\u0078":2}','{"x":01}','{"x":1.}','{"x":1e}','{"x":1e309}','{"x":+1}','{"x":true}tail','{"x":"\\ud800"}','{"x":"\udc00"}',`{"x":${1n<<256n}}`,`{"x":-${1n<<256n}}`,'{"x":'+'['.repeat(33)+'0'+']'.repeat(33)+'}','{"x":"'+'😀'.repeat(4000)+'"}'])assert.throws(()=>literalArguments(raw),raw.slice(0,40));
});
test('approval record fields are own, detached and frozen',()=>{
 const source=structuredClone(pending);
 const parsed=parseApproval(source,request);
 source.call.arguments_json='{"changed":true}';
 assert.equal(parsed.call.arguments_json,pending.call.arguments_json);
 assert.ok(Object.isFrozen(parsed));assert.ok(Object.isFrozen(parsed.call));
 assert.throws(()=>parseApproval(Object.create(pending),request));
 assert.throws(()=>parseApproval({...pending,call:Object.create(pending.call)},request));
 assert.throws(()=>parseApprovalPage({space:'alpha',run_id:'one',items:[pending,{...pending,request_id:'f'.repeat(64)}]},request));
});
test('selected activation acknowledgement binds IDs, revisions, hashes and space',()=>{
 const record=parseApproval(decided,request),expected=prepareContinuation([record],[record.request_id],'next');
 const activation={space:'alpha',run_id:'one',activation_id:'next',created_at:pending.created_at,decisions:{[record.request_id]:2},decision_digests:{[record.request_id]:record.decision_digest}};
 for(const mutation of [{decisions:{[record.request_id]:true}},{decision_digests:{[record.request_id]:'f'.repeat(64)}},{space:'bravo'},{decisions:{[record.request_id]:2,extra:2}},{decision_digests:{[record.request_id]:record.decision_digest,extra:'f'.repeat(64)}}])assert.throws(()=>matchContinuation({status,activation:{...activation,...mutation}},request,expected,[record]));
});
