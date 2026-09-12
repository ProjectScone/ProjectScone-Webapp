import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayFilename} from '../src/memory/filename-display.ts';

test('filename display exposes every direction control and round-trips exact names',()=>{
 for(const code of [0x061c,0x200e,0x200f,0x202a,0x202b,0x202c,0x202d,0x202e,0x2066,0x2067,0x2068,0x2069]){
  const raw='report'+String.fromCodePoint(code)+'gnp.exe',display=displayFilename(raw);
  assert.equal(display.includes(String.fromCodePoint(code)),false);
  assert.ok(display.includes('\\u'+code.toString(16).padStart(4,'0')));
  assert.equal(JSON.parse(display),raw);
 }
});
test('filename display preserves ordinary scripts, accents, emoji and literal escape text',()=>{
 for(const raw of ['café.txt','e\u0301.txt','ملاحظات/😀.txt','報告.txt','report\\u202egnp.txt','\uFEFFnotes.txt'])assert.equal(displayFilename(raw),raw);
});
test('filename diagnostics quote control characters and malformed surrogate text exactly',()=>{
 for(const raw of ['line\nname','tab\tname','nul\0name','del\x7fname','bad\udcff']){
  const display=displayFilename(raw);assert.equal(JSON.parse(display),raw);
  assert.equal(/[\x00-\x1f\x7f]/.test(display),false);assert.equal(display.isWellFormed(),true);
 }
});
