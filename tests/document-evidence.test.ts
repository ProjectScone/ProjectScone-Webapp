import test from 'node:test';
import assert from 'node:assert/strict';
import {documentBinding,parseDocumentEvidence} from '../src/memory/document-evidence.ts';
const original={attachment_id:'a'.repeat(64),media_type:'text/html',bytes:200};
const manifest={attachment_id:'b'.repeat(64),media_type:'application/json',bytes:900};
function fixture(){
 const cell=(locator:string,row:number,text:string,start:number,is_header=false)=>({table_locator:'table:1',locator,row,column:0,row_span:1,column_span:1,is_header,text,start,end:start+new TextEncoder().encode(text).length,headers:[] as object[]});
 const header=cell('h',0,'Revenue',0,true),value=cell('v',1,'€20',10);value.headers=[{locator:'h',text:'Revenue',association:'column'}];
 const segments=[{locator:'row:1',text:'Revenue',metadata:{table_status:'structured'},table_cells:[header]},{locator:'row:2',text:'Revenue: €20',metadata:{table_status:'structured'},table_cells:[value]}];
 // The value begins after the nine ASCII prefix bytes.
 value.start=9;value.end=14;
 const episode={metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'html'},attachments:[original,manifest]};
 return {episode,source:{content:'Revenue\n\nRevenue: €20',binding:documentBinding(episode)!},response:{original,manifest,filename:'sales.html',format:'html',parser:'scone-html',segments}};
}
test('document identities must be linked to the retained episode',()=>{
 const f=fixture();assert.equal(f.source.binding.original.attachment_id,original.attachment_id);
 assert.equal(documentBinding({metadata:{}}),null);
 assert.throws(()=>documentBinding({...f.episode,attachments:[original]}));
 assert.throws(()=>documentBinding({...f.episode,metadata:{...f.episode.metadata,document_manifest:'bad'}}));
});
test('table values retain UTF-8 spans and resolved header references',()=>{
 const f=fixture(),d=parseDocumentEvidence(f.response,f.source);assert.equal(d.tables.length,1);
 const v=d.cells.get('v')!;assert.equal(v.text,'€20');assert.equal(v.start,18);assert.equal(v.end,23);assert.equal(v.headers[0].locator,'h');
});
test('reject mismatched source text, original identity, manifest and format',()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.source.content+='!';},(f:ReturnType<typeof fixture>)=>{f.response.original={...original,bytes:201};},(f:ReturnType<typeof fixture>)=>{f.response.manifest={...manifest,attachment_id:'c'.repeat(64)};},(f:ReturnType<typeof fixture>)=>{f.response.format='docx';}]){const f=fixture();change(f);assert.throws(()=>parseDocumentEvidence(f.response,f.source));}
});
test('reject malformed UTF-8 spans and geometry before exposing cells',()=>{
 for(const change of [(c:Record<string,unknown>)=>{c.start=10;},(c:Record<string,unknown>)=>{c.end=13;},(c:Record<string,unknown>)=>{c.row=0;},(c:Record<string,unknown>)=>{c.column_span=1001;},(c:Record<string,unknown>)=>{c.row_span=20000;}]){const f=fixture();change(f.response.segments[1].table_cells[0]);assert.throws(()=>parseDocumentEvidence(f.response,f.source));}
});
test('reject absent, conflicting, duplicate and wrong-geometry headers',()=>{
 for(const headers of [[{locator:'missing',text:'Revenue',association:'column'}],[{locator:'h',text:'Fake',association:'column'}],[{locator:'h',text:'Revenue',association:'row'}],[{locator:'h',text:'Revenue',association:'column'},{locator:'h',text:'Revenue',association:'column'}]]){const f=fixture();f.response.segments[1].table_cells[0].headers=headers;assert.throws(()=>parseDocumentEvidence(f.response,f.source));}
});
test('merged row context remains distinct from declared headers',()=>{
 const f=fixture();const h=f.response.segments[0].table_cells[0];h.is_header=false;h.row_span=2;
 const v=f.response.segments[1].table_cells[0];v.column=1;v.headers=[];
 Object.assign(h,{merged_locators:['continuation']});Object.assign(v,{context:[{locator:'h',text:'Revenue',association:'row_span'}]});
 const d=parseDocumentEvidence(f.response,f.source);assert.equal(d.cells.get('v')!.context[0].locator,'h');assert.deepEqual(d.cells.get('h')!.mergedLocators,['continuation']);
 h.row_span=1;assert.throws(()=>parseDocumentEvidence(f.response,f.source));
});
test('duplicate merged source identities and unknown associations are rejected',()=>{
 const f=fixture();Object.assign(f.response.segments[0].table_cells[0],{merged_locators:['v']});assert.throws(()=>parseDocumentEvidence(f.response,f.source));
 delete (f.response.segments[0].table_cells[0] as Record<string,unknown>).merged_locators;
 f.response.segments[1].table_cells[0].headers=[{locator:'h',text:'Revenue',association:'guess'}];assert.throws(()=>parseDocumentEvidence(f.response,f.source));
});
test('plain text fallback retains parser notes without inventing a table',()=>{
 const f=fixture();for(const s of f.response.segments){s.table_cells=[];s.metadata={table_status:'text_fallback',table_notes:'nested_table'} as typeof s.metadata;}
 const d=parseDocumentEvidence(f.response,f.source);assert.equal(d.tables.length,0);assert.equal(d.notes.length,2);assert.equal(d.notes[0].reason,'nested_table');
});

test('empty cell spans must also land on UTF-8 boundaries',()=>{
 const f=fixture(),v=f.response.segments[1].table_cells[0];v.text='';v.start=10;v.end=10;
 assert.throws(()=>parseDocumentEvidence(f.response,f.source),/UTF-8/);
 v.start=9;v.end=9;assert.equal(parseDocumentEvidence(f.response,f.source).cells.get('v')!.text,'');
});
test('multiple fallback segments may share the same source line locator',()=>{
 const f=fixture();for(const s of f.response.segments){s.locator='line:1';s.table_cells=[];s.metadata={table_status:'text_fallback'};}
 assert.equal(parseDocumentEvidence(f.response,f.source).segments.length,2);
});
test('spreadsheet table ranges, totals and cached formula provenance remain inspectable',()=>{
 const f=fixture();Object.assign(f.response.segments[1].metadata,{table_range:'B4:C6',table_name:'RevenueTable',table_role:'totals',formula:'cached-value'});
 const segment=parseDocumentEvidence(f.response,f.source).segments[1];
 assert.equal(segment.tableRange,'B4:C6');assert.equal(segment.tableName,'RevenueTable');assert.equal(segment.tableRole,'totals');assert.equal(segment.cachedFormula,true);
});
