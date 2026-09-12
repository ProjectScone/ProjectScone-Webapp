import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPartedRecall, partsSearchProblem} from '../src/memory/recall-parts.ts';

const question='  Where is 🚀? Who owns billing?  ';
const first='Where is 🚀?',second='Who owns billing?';
function fixture(){
 const item=(chunk_id:number,score:number)=>({chunk_id,episode_id:chunk_id,text:`Passage ${chunk_id}`,score,created_at:'2026-09-12T00:00:00Z',source:null,tags:[],metadata:{}});
 return {why:'Each part searched independently.',judged:false,
  decomposition:{whole:question.trim(),split:true,why:'Two questions.',parts_found:2,capped:false,parts:[{text:first,start:2,end:13},{text:second,start:14,end:31}]},
  items:[item(1,.2),item(2,.9)],placed_by:[0,1],by_chunk:{'1':[0,1],'2':[1]},unanswered:[],weak:[],
  per_part:[{part:first,found:1,contributed:1,weak:null,degraded:[]},{part:second,found:2,contributed:1,weak:null,degraded:['vector unavailable']}]};
}
test('parts preserve merge order, code-point spans, shared credit and unmeasured quality',()=>{
 const result=readPartedRecall(fixture(),question,25);
 assert.deepEqual(result.items.map(item=>item.chunk_id),[1,2]);
 assert.deepEqual(result.byChunk.get(1),[0,1]);
 assert.equal(result.judged,false);assert.equal(result.parts[1].weak,null);
 assert.deepEqual(result.parts[1].degraded,['vector unavailable']);
});
test('found candidates outside merged limit retain credit without being called unanswered',()=>{
 const value=fixture();value.items.pop();value.placed_by.pop();value.per_part[1].contributed=0;
 value.by_chunk['1']=[0];value.per_part[1].found=1;
 const result=readPartedRecall(value,question,1);
 assert.equal(result.parts[1].found,1);assert.equal(result.parts[1].contributed,0);
});
test('reject receipts belonging to a different question or wrong Unicode offsets',()=>{
 assert.throws(()=>readPartedRecall(fixture(),'Who is elsewhere?',25));
 for(const mutate of [(v:ReturnType<typeof fixture>)=>v.decomposition.parts[1].start++,v=>v.decomposition.parts[0].text='Forged question',v=>v.decomposition.parts.reverse(),v=>v.decomposition.whole='Different']){
  const value=fixture();mutate(value);assert.throws(()=>readPartedRecall(value,question,25));
 }
});
test('reject inconsistent merge, membership, quality and cap receipts',()=>{
 const mutations:Array<(v:ReturnType<typeof fixture>)=>void>=[
  v=>v.items.push(v.items[0]),v=>v.placed_by[0]=2,v=>v.placed_by.pop(),v=>v.placed_by[0]=1,
  v=>v.by_chunk['1']=[0,0],v=>v.by_chunk['2']=[],v=>v.by_chunk['1']=[0],
  v=>v.per_part[0].found=0,v=>v.per_part[1].contributed=0,v=>v.judged=true,
  v=>v.decomposition.capped=true,v=>v.decomposition.split=false,v=>v.decomposition.parts_found=1,
  v=>v.items[0].score=Infinity,v=>v.items[0].episode_id=-1,v=>v.items[0].created_at='yesterday',
 ];
 for(const mutate of mutations){const value=fixture();mutate(value);assert.throws(()=>readPartedRecall(value,question,25));}
 assert.throws(()=>readPartedRecall(fixture(),question,1));
 const extra={...fixture(),unanswered:[first]};assert.throws(()=>readPartedRecall(extra,question,25));
 assert.throws(()=>readPartedRecall({...fixture(),weak:[second]},question,25));
});
test('report capped decomposition, empty results and measured weak evidence honestly',()=>{
 const value=fixture();value.items=[];value.placed_by=[];
 const empty={...value,judged:true,by_chunk:{},unanswered:[first,second],weak:[second],per_part:value.per_part.map((p,i)=>({...p,found:0,contributed:0,weak:i===1})),decomposition:{...value.decomposition,capped:true,parts_found:5}};
 const result=readPartedRecall(empty,question,25);
 assert.equal(result.partsFound,5);assert.equal(result.capped,true);assert.equal(result.parts[1].weak,true);assert.equal(result.items.length,0);
});
test('blank questions pause parts mode while supported narrowing stays applied',()=>{
 const state={q:question,where:{},tags:['work'],asOf:'2026-01-01'};
 assert.equal(partsSearchProblem(state),null);
 assert.match(partsSearchProblem({...state,q:' '})!,/question/i);
 assert.equal(partsSearchProblem({...state,where:{team:'alpha'}}),null);
 assert.equal(partsSearchProblem({...state,metadataFilter:{json:'{}'}} as Parameters<typeof partsSearchProblem>[0]),null);
});

test('reject missing merged passages when unique candidates fit inside the limit',()=>{
 const value=fixture();value.items=[];value.placed_by=[];value.per_part.forEach(part=>part.contributed=0);
 assert.throws(()=>readPartedRecall(value,question,25));
});
test('valid empty and whitespace source labels do not discard search results',()=>{
 for(const source of ['', '   ']){
  const value=fixture();const payload={...value,items:value.items.map(item=>({...item,source}))};
  assert.equal(readPartedRecall(payload,question,25).items[0].source,source);
 }
});
test('parts bind authenticated space and every applied narrowing and retrieval option',async()=>{
 const {readPartedSearch}=await import('../src/memory/recall-parts.ts');
 const state={q:question,where:{team:'alpha'},tags:['work'],asOf:'2026-01-01',graphBoost:true};
 const applied={tags:['work'],as_of:'2026-01-01',where:{team:'alpha'}};
 const value={...fixture(),space:'alpha',applied,rerank:true,graph_boost:true};
 assert.equal(readPartedSearch(value,'alpha',state,25).items.length,2);
 for(const changed of [{space:'beta'},{space:null},{applied:{}},{applied:{...applied,kind:'note'}},{applied:{...applied,where:{team:'beta'}}},{rerank:false},{graph_boost:false}])
  assert.throws(()=>readPartedSearch({...value,...changed},'alpha',state,25));
 assert.throws(()=>readPartedSearch(fixture(),'alpha',state,25));
});
test('nested conditions compare structurally without depending on object key order',async()=>{
 const {readPartedSearch}=await import('../src/memory/recall-parts.ts');
 const state={q:question,where:{},tags:[],asOf:'',metadataFilter:{json:'{"all":[{"field":"team","is":"alpha"}]}'}} as Parameters<typeof readPartedSearch>[2];
 const value={...fixture(),space:'alpha',applied:{conditions:{all:[{is:'alpha',field:'team'}]}},rerank:true,graph_boost:false};
 assert.equal(readPartedSearch(value,'alpha',state,25).parts.length,2);
 assert.throws(()=>readPartedSearch({...value,applied:{conditions:{all:[{field:'team',is:'beta'}]}}},'alpha',state,25));
});
