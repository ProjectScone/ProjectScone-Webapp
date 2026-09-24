import test from 'node:test';
import assert from 'node:assert/strict';
import {readPerformance,duration} from '../src/conversations/performance.ts';
const trace={schema_version:1,total_ms:2000,first_text_ms:1400,truncated:false,spans:[{stage:'embedding',start_ms:0,duration_ms:900,outcome:'completed',model:'qwen/qwen3-embedding-8b',provider:'openrouter'}]};
test('performance preserves observed spans without converting missing observations to zero',()=>{
  assert.deepEqual(readPerformance(trace),trace);
  assert.equal(readPerformance({...trace,first_text_ms:null})?.first_text_ms,null);
  assert.equal(readPerformance(undefined),undefined);
  assert.equal(duration(900),'900 ms');assert.equal(duration(1400),'1.40 s');
});
test('malformed optional diagnostics never invalidate an otherwise readable reply',()=>{
  for(const value of [{...trace,total_ms:NaN},{...trace,first_text_ms:3000},{...trace,spans:Array(65).fill(trace.spans[0])},
    {...trace,spans:[{...trace.spans[0],duration_ms:-1}]},{...trace,spans:[{...trace.spans[0],model:'https://user:secret@host'}]},
    {...trace,spans:[{...trace.spans[0],stage:'constructor'}]},{...trace,spans:[{...trace.spans[0],start_ms:2000}]}])assert.equal(readPerformance(value),undefined);
});
