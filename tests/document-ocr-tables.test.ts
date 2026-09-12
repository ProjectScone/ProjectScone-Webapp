import test from 'node:test';
import assert from 'node:assert/strict';
import {pageDigest,parseOcrTables,type OcrTableAddress} from '../src/memory/document-ocr-tables.ts';
import type {OcrRegion} from '../src/memory/document-ocr-evidence.ts';

async function fixture(){
 const regions:OcrRegion[]=[];let offset=0;
 for(let row=0;row<3;row++)for(let column=0;column<2;column++){
  const text=`Café ${row}:${column}`,start=offset,end=start+new TextEncoder().encode(text).length;offset=end+1;
  regions.push({text,start,end,box:[.1+column*.4,.1+row*.1,.3+column*.4,.15+row*.1],score:null,block:0,line:row,providerIndex:null,column:null});
 }
 const content=regions.map(r=>r.text).join(' '),original={attachment_id:'a'.repeat(64),media_type:'application/pdf',bytes:100},manifest={attachment_id:'b'.repeat(64),media_type:'application/json',bytes:1000};
 const address:OcrTableAddress={space:'alpha',episodeId:7,source:{content,binding:{original,manifest,format:'pdf'}},page:{number:2,text:content,extraction:'ocr',engine:'fixture',displayWidth:600,displayHeight:800,regions,order:null}};
 const value={space:'alpha',episode_id:7,page:2,original_sha256:original.attachment_id,manifest_sha256:manifest.attachment_id,page_text_sha256:await pageDigest(content),layout:{schema_version:1,strategy:'aligned-rows-v1',origin:'geometry_inferred',region_count:6,notes:['geometry_only'],unassigned:[] as number[],tables:[{rows:3,columns:2,cells:regions.map((r,i)=>({row:Math.floor(i/2),column:i%2,text:r.text,box:[...r.box],regions:[i]}))}]}};
 return {address,value};
}
test('table cells and export retain exact OCR references and source identity',async()=>{
 const {address,value}=await fixture(),parsed=await parseOcrTables(value,address);
 assert.equal(parsed.tables[0].cells[0].text,'Café 0:0');
 const output=JSON.parse(parsed.exportText);assert.equal(output.origin,'geometry_inferred');assert.equal(output.regions[0].start,0);assert.equal(output.manifest_sha256,address.source.binding.manifest.attachment_id);
});
test('table inspection rejects incorrect binding, invented text and incomplete coverage',async()=>{
 for(const damage of ['space','episode','page','manifest','textHash','origin','regionCount','text','box','duplicate','order','missing','notes','extra']){
  const {address,value}=await fixture();
  if(damage==='space')value.space='beta';
  if(damage==='episode')value.episode_id=8;
  if(damage==='page')value.page=3;
  if(damage==='manifest')value.manifest_sha256='c'.repeat(64);
  if(damage==='textHash')value.page_text_sha256='c'.repeat(64);
  if(damage==='origin')value.layout.origin='source_declared';
  if(damage==='regionCount')value.layout.region_count=5;
  if(damage==='text')value.layout.tables[0].cells[0].text='Invented';
  if(damage==='box')value.layout.tables[0].cells[0].box[0]=.5;
  if(damage==='duplicate')value.layout.tables[0].cells[1].regions=[0];
  if(damage==='order')value.layout.tables[0].cells[0].row=1;
  if(damage==='missing')value.layout.tables[0].cells.pop();
  if(damage==='notes')value.layout.notes=[];
  if(damage==='extra')value.layout.unassigned=[0];
  await assert.rejects(parseOcrTables(value,address),undefined,damage);
 }
});
test('no grid remains an explicit complete unassigned inventory',async()=>{
 const {address,value}=await fixture();value.layout.tables=[];value.layout.unassigned=[0,1,2,3,4,5];value.layout.notes=['geometry_only','unassigned_regions','no_aligned_grid'];
 const result=await parseOcrTables(value,address);assert.equal(result.tables.length,0);assert.equal(result.unassigned.length,6);
 value.layout.unassigned.pop();await assert.rejects(parseOcrTables(value,address));
});

test('aligned-row strategy requires common separating column gaps',async()=>{
 const {address,value}=await fixture();
 address.page.regions[2].box=[.4,.2,.55,.25];
 value.layout.tables[0].cells[2].box=[.4,.2,.55,.25];
 address.page.regions[3].box=[.6,.2,.8,.25];
 value.layout.tables[0].cells[3].box=[.6,.2,.8,.25];
 await assert.rejects(parseOcrTables(value,address),/common separating gap/);
});

for(const tied of [false,true])test(`cell word order follows geometry and source index: tied=${tied}`,async()=>{
 const {address,value}=await fixture(),first=address.page.regions[0];
 const start=new TextEncoder().encode(address.page.text).length+1;
 const extra:OcrRegion={...first,text:'Smith',start,end:start+5,box:tied?[...first.box]:[.31,.1,.4,.15]};
 address.page.regions.push(extra);address.page.text+=' Smith';address.source.content=address.page.text;
 value.page_text_sha256=await pageDigest(address.page.text);value.layout.region_count++;
 const cell=value.layout.tables[0].cells[0];cell.regions=[0,6];cell.text=first.text+' Smith';
 cell.box=[first.box[0],first.box[1],extra.box[2],first.box[3]];
 assert.equal((await parseOcrTables(value,address)).tables[0].cells[0].text,cell.text);
 cell.regions=[6,0];cell.text='Smith '+first.text;
 await assert.rejects(parseOcrTables(value,address),/region.*order/i);
});
