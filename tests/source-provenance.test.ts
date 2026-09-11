import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSourceProvenance} from '../src/memory/source-provenance.ts';
const content='# Notes\nÉlodie uses Scone. 🥐\n';
const bytes=new TextEncoder().encode(content);
const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const quote='Élodie uses Scone.',start=8,end=start+new TextEncoder().encode(quote).length;
const source={space:'alpha',episodeId:1,content};
const fixture=()=>({schema_version:1,space:'alpha',consistent:true,episode:{id:1,bytes:bytes.length,content_sha256:digest},sections:[{id:'sec:1',title:'Notes',level:1,parent:null,start:0,end:bytes.length}],chunks:[{chunk_id:10,ordinal:0,start:0,end:bytes.length,section:'Notes'}],claims:[{fact_id:1,subject:'Élodie',predicate:'uses',object:'Scone',status:'active',excluded:false,quote,span:{start,end},occurrences:1,grounding:'quote_verified',section:'Notes',chunks:[10],entities:['ent:a','ent:b']}],entities:[{id:'ent:a',key:'élodie',label:'Élodie',kind:'person',claims:[1]},{id:'ent:b',key:'scone',label:'Scone',kind:'product',claims:[1]}],mentions:[],coverage:{chunks_total:1,chunks_shown:1,claims_shown:1,truncated:false,reasons:[],read:{reasons:[]}}});
test('source provenance verifies UTF-8 spans against the retained original',async()=>{
 const value=await parseSourceProvenance(fixture(),source);assert.equal(value.claims[0].quote,quote);assert.equal(value.claims[0].span?.text,quote);assert.equal(value.chunks[0].span.text,content);
});
test('source provenance rejects mixed sources, malformed spans and changed content',async()=>{
 for(const change of [(v:ReturnType<typeof fixture>)=>v.space='other',(v:ReturnType<typeof fixture>)=>v.episode.id=2,(v:ReturnType<typeof fixture>)=>v.consistent=false,(v:ReturnType<typeof fixture>)=>v.claims[0].span.start++,(v:ReturnType<typeof fixture>)=>v.claims[0].quote='Invented',(v:ReturnType<typeof fixture>)=>v.coverage.claims_shown=2]){
  const value=fixture();change(value);await assert.rejects(parseSourceProvenance(value,source));
 }
 await assert.rejects(parseSourceProvenance(fixture(),{...source,content:content.replace('Scone','Other')}));
});
test('source provenance checks reverse claim membership and chunk references',async()=>{
 const v=fixture();v.entities[0].claims=[];await assert.rejects(parseSourceProvenance(v,source));
 const w=fixture();w.claims[0].chunks=[99];await assert.rejects(parseSourceProvenance(w,source));
});
test('source span decoding preserves a byte-order mark in an exact quote',async()=>{
 const content='\uFEFFNote',bytes=new TextEncoder().encode(content),v=fixture();
 v.episode.bytes=bytes.length;v.episode.content_sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 v.sections=[];v.chunks[0].end=bytes.length;v.claims[0].quote=content;v.claims[0].span={start:0,end:bytes.length};
 assert.equal((await parseSourceProvenance(v,{...source,content})).claims[0].span?.text,content);
});
