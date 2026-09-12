import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOcrDocument,drawnRegions} from '../src/memory/document-ocr-evidence.ts';

const original={attachment_id:'a'.repeat(64),bytes:100,media_type:'application/pdf'},manifest={attachment_id:'b'.repeat(64),bytes:1000,media_type:'application/json'};
const source={content:'Café Polaris',binding:{original,manifest,format:'pdf'}};
function fixture(){return {original,manifest,filename:'scan.pdf',format:'pdf',parser:'local-ocr',metadata:{pdf_ocr:JSON.stringify({mode:'missing_text',reading_order:'provider',dpi:150})},segments:[{locator:'page:2',text:source.content,metadata:{page:'2',width_points:'612.0',height_points:'792.0',rotation:'0',extraction:'ocr',ocr_engine:'local'},regions:[
 {text:'Café',start:0,end:5,box:[.1,.1,.4,.2],score:.9,block:0,line:0,coordinate_space:'normalized_displayed_page_top_left'},
 {text:'Polaris',start:6,end:13,box:[.5,.1,.9,.2],score:null,block:0,line:0,coordinate_space:'normalized_displayed_page_top_left'},
]}]};}

test('retained OCR page identity, Unicode coverage and confidence stay separate from source truth',()=>{
 const data=parseOcrDocument(fixture(),source);assert.equal(data.pages[0].number,2);assert.equal(data.pages[0].regions[0].text,'Café');assert.equal(data.pages[0].regions[0].score,.9);assert.equal(data.pages[0].regions[1].score,null);assert.equal(data.pages[0].displayWidth,612);assert.equal(data.pages[0].displayHeight,792);
 assert.equal(data.selection?.reading_order,'provider');
 const rotated=fixture();rotated.segments[0].metadata.rotation='90';const page=parseOcrDocument(rotated,source).pages[0];assert.equal(page.displayWidth,792);assert.equal(page.displayHeight,612);
});

test('malformed source, page, box, score and partial Unicode coverage are refused',()=>{
 const changes:((value:ReturnType<typeof fixture>)=>void)[]=[
  value=>{value.original={...original,attachment_id:'c'.repeat(64)};},
  value=>{value.segments[0].locator='page:3';},
  value=>{value.segments[0].metadata.page='02';},
  value=>{value.segments[0].metadata.width_points='NaN';},
  value=>{value.segments[0].metadata.rotation='45';},
  value=>{value.segments[0].metadata.rotation='';},
  value=>{value.segments[0].metadata.extraction='text_layer';},
  value=>{value.segments[0].regions[0].box=[.4,.1,.1,.2];},
  value=>{value.segments[0].regions[0].box=[.1,.1,Infinity,.2];},
  value=>{value.segments[0].regions[0].score=1.1;},
  value=>{value.segments[0].regions[0].end=4;},
  value=>{value.segments[0].regions[0].text='Cafe';},
  value=>{value.segments[0].regions[0].coordinate_space='normalized_displayed_frame_top_left';},
  value=>{value.segments[0].regions.pop();},
 ];
 for(const change of changes){const value=fixture();change(value);assert.throws(()=>parseOcrDocument(value,source));}
});

test('legacy OCR remains inspectable and embedded text has no invented geometry',()=>{
 const {metadata:_,...value}=fixture();assert.equal(parseOcrDocument(value,source).selection,undefined);
 const {ocr_engine:__,...pageMetadata}=value.segments[0].metadata;
 const plain={...value,segments:[{...value.segments[0],metadata:{...pageMetadata,extraction:'text_layer'},regions:[]}]};
 const data=parseOcrDocument(plain,source);assert.equal(data.pages[0].regions.length,0);assert.equal(data.pages[0].extraction,'text_layer');
});

test('inferred order requires complete unique provider indices and matching columns',()=>{
 const value=fixture();value.metadata.pdf_ocr=JSON.stringify({mode:'all_pages',reading_order:'columns_ltr',dpi:150});
 const ordered={...value,segments:value.segments.map(s=>({...s,metadata:{...s.metadata,ocr_reading_order:JSON.stringify({strategy:'whitespace-columns-v1',direction:'ltr',columns:2,notes:['geometry_inferred']})},regions:s.regions.map((r,i)=>({...r,provider_index:i,reading_column:i+1}))}))};
 const page=parseOcrDocument(ordered,source).pages[0];assert.equal(page.order?.columns,2);assert.equal(page.regions[1].column,2);
 ordered.segments[0].regions[1].provider_index=0;assert.throws(()=>parseOcrDocument(ordered,source));
 ordered.segments[0].regions[1].provider_index=1;ordered.segments[0].regions[1].reading_column=0;assert.throws(()=>parseOcrDocument(ordered,source));
});

test('geometry drawing is bounded while an out-of-window selection is always included',()=>{
 const ids=drawnRegions(3000,2700);assert.equal(ids.length,2000);assert(ids.includes(2700));assert.equal(new Set(ids).size,2000);
 assert.deepEqual(drawnRegions(2,null),[0,1]);
});

test('all-pages selection cannot describe an embedded-text extraction',()=>{
 const value=fixture(),{ocr_engine:_,...metadata}=value.segments[0].metadata;
 const changed={...value,metadata:{pdf_ocr:JSON.stringify({mode:'all_pages',reading_order:'provider',dpi:150})},segments:[{...value.segments[0],metadata:{...metadata,extraction:'text_layer'},regions:[]}]};
 assert.throws(()=>parseOcrDocument(changed,source));
});

test('legacy inferred direction must be an exact string, never a coerced value',()=>{
 const {metadata:_,...value}=fixture();
 for(const direction of [['ltr'],['rtl'],{toString:()=> 'ltr'}]){
  const changed={...value,segments:value.segments.map(s=>({...s,metadata:{...s.metadata,ocr_reading_order:JSON.stringify({strategy:'whitespace-columns-v1',direction,columns:0,notes:['no_separating_gutter']})},regions:s.regions.map((r,i)=>({...r,provider_index:i,reading_column:0}))}))};
  assert.throws(()=>parseOcrDocument(changed,source));
 }
});
