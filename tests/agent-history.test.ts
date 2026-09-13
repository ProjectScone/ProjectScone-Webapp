import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistoryPage,describeEntry,historyAddress,historyCursor,type HistoryPage} from '../src/agents/history.ts';
import {readHistoryFrames} from '../src/agents/history-stream.ts';
import {parseRunRequest} from '../src/agents/runs.ts';
import {parseCapabilities} from '../src/capabilities.ts';
import {readFileSync} from 'node:fs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/http-capabilities.json',import.meta.url),'utf8')) as {python:{features:Record<string,unknown>}};

const task={task_id:'find',agent_id:'research',model_id:'careful',prompt:'Find evidence',depends_on:[]};
const snapshot={space:'alpha',run_id:'run-1',created_at:'2026-09-11T00:00:00Z',cancel_requested_at:null,question:'What happened?',scope:{},exclude_session_id:null,plan:{space:'alpha',revision:1,updated_at:'2026-09-11T00:00:00Z',plan:{workflow_id:'report',tasks:[task]},bindings:{find:'a'.repeat(64)}}};
const request=parseRunRequest(snapshot,'alpha','run-1');
const invocation='c'.repeat(32),collection='d'.repeat(32);
const cursor=(position:number,generation='0'.repeat(32))=>`${generation}.${position.toString(16).padStart(16,'0')}.${'b'.repeat(64)}`;
const progress=(sequence:number,kind:string,extra:Record<string,unknown>={})=>({sequence,invocation_id:invocation,agent_id:'research',model_id:'careful',binding:'a'.repeat(64),kind,occurred_at:'2026-09-11T00:00:01Z',elapsed_s:0.25,operation_id:null,operation_kind:null,duration_s:null,tool_index:null,tool_name:null,status:null,error:null,output_bytes:null,origin:null,reused:null,journal_reused:null,presentation_reused:null,...extra});
const started={kind:'collection_started',collection_id:collection,occurred_at:'2026-09-11T00:00:00Z',invocation_id:null,last_sequence:0,observed_events:0,lost_events:0,terminal_kind:null,error:null};
const finished={kind:'collection_finished',collection_id:collection,occurred_at:'2026-09-11T00:00:02Z',invocation_id:invocation,last_sequence:3,observed_events:2,lost_events:1,terminal_kind:'turn_completed',error:null};
const gap={invocation_id:invocation,first_sequence:2,last_sequence:2};
const entry=(position:number,event:unknown)=>({position,step_id:'find',selection_id:'find',event,collection_id:collection,activation_id:null});
const events=[started,progress(1,'turn_started'),gap,progress(3,'turn_completed'),finished];
const page=(from:number,items:unknown[],extra:Record<string,unknown>={})=>({space:'alpha',run_id:'run-1',available:true,items,next_after:cursor(from+items.length-1),retained_from:1,omitted:null,...extra});
const whole=page(1,events.map((event,index)=>entry(index+1,event)));

test('a history page is read in order and each entry describes itself without private text',()=>{
 const parsed=parseHistoryPage(whole,request);
 assert.deepEqual(parsed.items.map(item=>item.position),[1,2,3,4,5]);
 assert.equal(parsed.next_after,cursor(5));
 assert.equal(parsed.retained_from,1);
 assert.deepEqual(parsed.items.map(item=>describeEntry(item).title),['Observation started','Turn started','Unobserved sequences 2–2','Turn completed','Observation finished']);
 const last=describeEntry(parsed.items[4]);
 assert.match(last.detail,/turn_completed/);
 assert.match(last.detail,/2 observed/);
 assert.match(last.detail,/1 lost/);
 assert.equal(historyAddress('run-1'),'/v1/agent-runs/run-1/history');
});

test('operations and tool outcomes are described with their timing and never their content',()=>{
 const items=[entry(1,progress(1,'operation_started',{operation_id:1,operation_kind:'model'})),entry(2,progress(2,'operation_completed',{operation_id:1,operation_kind:'model',duration_s:0.5})),
  entry(3,progress(3,'tool_result',{tool_index:1,tool_name:'search_memory',origin:'model',status:'prepared',output_bytes:120,reused:false,journal_reused:false,presentation_reused:false}))];
 const parsed=parseHistoryPage(page(1,items),request);
 const described=parsed.items.map(describeEntry);
 assert.equal(described[0].title,'Model call started');
 assert.equal(described[1].title,'Model call finished');
 assert.match(described[1].detail,/0\.5 s/);
 assert.equal(described[2].title,'Tool result · search_memory');
 assert.match(described[2].detail,/120 bytes/);
 assert.ok(!JSON.stringify(described).includes('text'));
});

test('a page that does not belong to this run or breaks continuity is refused',()=>{
 assert.throws(()=>parseHistoryPage({...whole,space:'bravo'},request));
 assert.throws(()=>parseHistoryPage({...whole,run_id:'run-2'},request));
 assert.throws(()=>parseHistoryPage(page(1,[entry(1,started),entry(3,progress(1,'turn_started'))]),request),/continuity|position/i);
 assert.throws(()=>parseHistoryPage({...whole,next_after:cursor(9)},request));
 assert.throws(()=>parseHistoryPage({...whole,extra:1},request));
 assert.throws(()=>parseHistoryPage(page(1,[{...entry(1,started),text:'private'}]),request),/entry/i);
 assert.throws(()=>parseHistoryPage(page(1,[entry(1,progress(1,'turn_started',{model_id:'fast'}))]),request),/binding/i);
 assert.throws(()=>parseHistoryPage(page(1,[entry(1,progress(1,'turn_started',{binding:'e'.repeat(64)}))]),request),/binding/i);
 assert.throws(()=>parseHistoryPage(page(1,[{...entry(1,started),step_id:'other',selection_id:'other'}]),request));
 assert.throws(()=>parseHistoryPage(page(1,[entry(1,{...started,collection_id:'e'.repeat(32)})]),request),/collection/i);
 assert.throws(()=>parseHistoryPage({...whole,available:false},request));
 assert.throws(()=>parseHistoryPage({...whole,next_after:'not-a-cursor'},request));
});

test('an unavailable history says so and carries nothing else',()=>{
 const parsed=parseHistoryPage({space:'alpha',run_id:'run-1',available:false,items:[],next_after:null,retained_from:null,omitted:null},request);
 assert.equal(parsed.available,false);
 assert.deepEqual(parsed.items,[]);
 assert.equal(parsed.next_after,null);
});

test('retention is disclosed exactly: what the cursor asked for and what remains',()=>{
 const items=[entry(7,progress(7,'turn_started')),entry(8,progress(8,'turn_completed'))];
 const parsed=parseHistoryPage(page(7,items,{retained_from:7,omitted:[5,6]}),request,cursor(4));
 assert.deepEqual(parsed.omitted,[5,6]);
 assert.throws(()=>parseHistoryPage(page(7,items,{retained_from:7,omitted:null}),request,cursor(4)),/retention/i);
 assert.throws(()=>parseHistoryPage(page(7,items,{retained_from:7,omitted:[5,7]}),request,cursor(4)),/retention/i);
 assert.throws(()=>parseHistoryPage(page(7,items,{retained_from:7,omitted:[5,6]}),request,cursor(4,'1'.repeat(32))),/generation/i);
 const empty=parseHistoryPage({...page(9,[]),next_after:cursor(8),retained_from:1},request,cursor(8));
 assert.equal(empty.next_after,cursor(8));
 assert.throws(()=>historyCursor('x'));
});

function stream(...parts:string[]):ReadableStream<Uint8Array>{
 const encoder=new TextEncoder();
 return new ReadableStream({start(controller){for(const part of parts)controller.enqueue(encoder.encode(part));controller.close();}});
}
async function collect(body:ReadableStream<Uint8Array>,after:string|null=null):Promise<HistoryPage[]>{
 const pages:HistoryPage[]=[];
 for await(const item of readHistoryFrames(body,{request,after,limit:50}))pages.push(item);
 return pages;
}
const first=page(1,events.slice(0,3).map((event,index)=>entry(index+1,event)));
const second={...page(4,events.slice(3).map((event,index)=>entry(index+4,event))),retained_from:1};
const frame=(event:string,id:string|null,data:unknown)=>`event: ${event}\n${id===null?'':'id: '+id+'\n'}data: ${JSON.stringify(data)}\n\n`;

test('history frames are read page by page, keep-alives ignored, until the server ends the stream',async()=>{
 const pages=await collect(stream(': keep-alive\n\n',frame('history',cursor(3),first),': still here\n\n',frame('history',cursor(5),second),frame('end',null,{})));
 assert.deepEqual(pages.map(item=>item.items.map(entry=>entry.position)),[[1,2,3],[4,5]]);
 assert.equal(pages[1].next_after,cursor(5));
});

test('a frame whose id does not name its page, an error frame, and a stream cut mid-frame are all refused',async()=>{
 await assert.rejects(collect(stream(frame('history',cursor(2),first),frame('end',null,{}))),/id/i);
 await assert.rejects(collect(stream(frame('history',cursor(3),first),frame('error',null,{error:'history_unavailable'}))),/history_unavailable/);
 await assert.rejects(collect(stream(frame('history',cursor(3),first),'event: history\nid: '+cursor(5)+'\n')),/ended/i);
 await assert.rejects(collect(stream(frame('history',cursor(3),{...first,space:'bravo'}),frame('end',null,{}))));
 await assert.rejects(collect(stream(frame('other',null,{}),frame('end',null,{}))),/event/i);
});

test('resuming from a cursor requires continuity with it',async()=>{
 const pages=await collect(stream(frame('history',cursor(5),second),frame('end',null,{})),cursor(3));
 assert.equal(pages.length,1);
 await assert.rejects(collect(stream(frame('history',cursor(5),second),frame('end',null,{})),cursor(2)),/continuity|position/i);
});

test('the history capability is read like the others',()=>{
 const features={...fixtures.python.features};delete (features as Record<string,unknown>)['agents.history'];
 assert.equal(parseCapabilities({...fixtures.python,features}).features['agents.history'],false);
 assert.equal(parseCapabilities({...fixtures.python,features:{...features,'agents.history':true}}).features['agents.history'],true);
 assert.throws(()=>parseCapabilities({...fixtures.python,features:{...features,'agents.history':'yes'}}));
});
