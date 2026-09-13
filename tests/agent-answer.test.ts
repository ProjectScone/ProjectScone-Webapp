import test from 'node:test';
import assert from 'node:assert/strict';
import {readAnswerStream,answerAddress,type AnswerEvent} from '../src/agents/answer-stream.ts';
import {parseCapabilities} from '../src/capabilities.ts';
import {readFileSync} from 'node:fs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/http-capabilities.json',import.meta.url),'utf8')) as {python:{features:Record<string,unknown>}};

const frame=(event:string,data:unknown,id?:number)=>`event: ${event}\n${id===undefined?'':'id: '+id+'\n'}data: ${JSON.stringify(data)}\n\n`;
const text=(sequence:number,value:string)=>frame('text',{sequence,text:value},sequence);
function stream(...parts:string[]):ReadableStream<Uint8Array>{
 const encoder=new TextEncoder();
 return new ReadableStream({start(controller){for(const part of parts)controller.enqueue(encoder.encode(part));controller.close();}});
}
async function collect(body:ReadableStream<Uint8Array>,after=0):Promise<AnswerEvent[]>{
 const events:AnswerEvent[]=[];
 for await(const event of readAnswerStream(body,after))events.push(event);
 return events;
}

test('text arrives in sequence and a terminal points at the receipt',async()=>{
 const events=await collect(stream(': keep-alive\n\n',text(1,'We '),text(2,'decided.'),frame('terminal',{status:'completed',read_receipt:true})));
 assert.deepEqual(events,[{kind:'text',sequence:1,text:'We '},{kind:'text',sequence:2,text:'decided.'},{kind:'terminal',status:'completed'}]);
 assert.equal(answerAddress('run-1','find'),'/v1/agent-runs/run-1/steps/find/text/stream');
});

test('withdraw, gap and end are events the pane can act on',async()=>{
 const events=await collect(stream(text(1,'Looking that up.'),frame('withdraw',{sequence:2},2),frame('gap',{after:2,next_sequence:7}),text(7,'We decided.'),frame('end',{reason:'observation_window_ended'})));
 assert.deepEqual(events.map(event=>event.kind),['text','withdraw','gap','text','end']);
 assert.deepEqual(events[2],{kind:'gap',after:2,next:7});
 assert.deepEqual(events[4],{kind:'end',reason:'observation_window_ended'});
});

test('a resumed reader requires continuity with its cursor',async()=>{
 assert.deepEqual((await collect(stream(text(4,'more'),frame('end',{reason:'observation_window_ended'})),3)).map(event=>event.kind),['text','end']);
 await assert.rejects(collect(stream(text(5,'skipped'),frame('end',{reason:'observation_window_ended'})),3),/sequence/i);
});

for(const [label,body,match] of [
 ['an id that does not name its sequence',frame('text',{sequence:1,text:'x'},2),/id/i],
 ['a repeated sequence',text(1,'x')+text(1,'again'),/sequence/i],
 ['an error frame',frame('error',{reason:'text_unavailable'}),/text_unavailable/],
 ['a stream cut mid-frame',text(1,'x')+'event: text\nid: 2\n',/ended/i],
 ['a kind this pane does not read',frame('other',{sequence:1},1),/kind/i],
 ['a frame carrying more than its fields',frame('text',{sequence:1,text:'x',reasoning:'private'},1),/fields/i],
 ['a terminal without a receipt',frame('terminal',{status:'completed',read_receipt:false}),/receipt/i],
 ['a gap that does not follow the cursor',text(1,'x')+frame('gap',{after:0,next_sequence:5}),/gap/i],
] as const)test(`refused: ${label}`,async()=>{await assert.rejects(collect(stream(body)),match);});

test('the text stream capability is read like the others',()=>{
 const features={...fixtures.python.features};delete (features as Record<string,unknown>)['agents.text_stream'];
 assert.equal(parseCapabilities({...fixtures.python,features}).features['agents.text_stream'],false);
 assert.equal(parseCapabilities({...fixtures.python,features:{...features,'agents.text_stream':true}}).features['agents.text_stream'],true);
 assert.throws(()=>parseCapabilities({...fixtures.python,features:{...features,'agents.text_stream':'yes'}}));
});
