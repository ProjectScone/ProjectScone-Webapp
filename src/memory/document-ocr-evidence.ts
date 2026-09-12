import {parseDocumentEvidence,type DocumentSource} from './document-evidence.ts';
import type {PdfOcrEvidence} from './document-ocr.ts';

export interface OcrRegion {text:string;start:number;end:number;box:[number,number,number,number];score:number|null;block:number;line:number;providerIndex:number|null;column:number|null}
export interface OcrOrder {direction:'ltr'|'rtl';columns:number;notes:string[]}
export interface OcrPage {number:number;text:string;extraction:'ocr'|'text_layer';engine:string;displayWidth:number;displayHeight:number;regions:OcrRegion[];order:OcrOrder|null}
export interface OcrDocument {filename:string;selection?:PdfOcrEvidence;pages:OcrPage[]}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid OCR evidence.');return value as Record<string,unknown>;}
function integer(value:unknown,max=Number.MAX_SAFE_INTEGER,min=0):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error('Invalid OCR evidence count.');return value;}
function text(value:unknown,max=100000):string{if(typeof value!=='string'||!value||value.length>max||decoder.decode(encoder.encode(value))!==value)throw Error('Invalid OCR evidence text.');return value;}
function items(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||value.length>max)throw Error('OCR inspection exceeds its region or page limit.');return value;}
function dimension(value:unknown):number{const n=typeof value==='string'&&value.trim()===value?Number(value):NaN;if(!Number.isFinite(n)||n<=0)throw Error('Invalid OCR page dimensions.');return n;}
function order(value:unknown):OcrOrder|null{
 if(value===undefined)return null;
 const v=record(JSON.parse(text(value,4096))),columns=integer(v.columns,8),notes=items(v.notes,4).map(value=>text(value,64));
 if(Object.keys(v).length!==4||v.strategy!=='whitespace-columns-v1'||(v.direction!=='ltr'&&v.direction!=='rtl')||columns===1||new Set(notes).size!==notes.length||notes.some(n=>!['geometry_inferred','no_separating_gutter','candidate_limit','column_limit'].includes(n))||!notes.includes(columns?'geometry_inferred':'no_separating_gutter')||notes.includes('geometry_inferred')===notes.includes('no_separating_gutter'))throw Error('Invalid inferred OCR order.');
 return {direction:v.direction,columns,notes};
}
function region(value:unknown,encoded:Uint8Array,previous:number):OcrRegion{
 const v=record(value),content=text(v.text),start=integer(v.start,encoded.length),end=integer(v.end,encoded.length),raw=items(v.box,4);
 if(raw.length!==4||raw.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1))throw Error('Invalid OCR rectangle.');
 const box=raw as [number,number,number,number];
 if(box[0]>=box[2]||box[1]>=box[3]||v.coordinate_space!=='normalized_displayed_page_top_left')throw Error('Invalid OCR coordinate space or rectangle.');
 if(start<previous||end<=start||decoder.decode(encoded.subarray(start,end))!==content||decoder.decode(encoded.subarray(previous,start)).trim())throw Error('OCR region does not match its retained UTF-8 span.');
 const score=v.score??null;if(score!==null&&(typeof score!=='number'||!Number.isFinite(score)||score<0||score>1))throw Error('Invalid recognizer score.');
 const providerIndex=v.provider_index==null?null:integer(v.provider_index,49999),column=v.reading_column==null?null:integer(v.reading_column,8);
 if((providerIndex===null)!==(column===null))throw Error('Incomplete inferred OCR position.');
 return {text:content,start,end,box,score,providerIndex,column,block:integer(v.block),line:integer(v.line)};
}
export function parseOcrDocument(value:unknown,source:DocumentSource):OcrDocument{
 const verified=parseDocumentEvidence(value,source);if(verified.format!=='pdf')throw Error('This inspector requires PDF evidence.');
 const v=record(value),pages:OcrPage[]=[];let lastPage=0,totalRegions=0;
 for(const [index,raw] of items(v.segments,1000).entries()){
  const s=record(raw),m=record(s.metadata),number=typeof m.page==='string'&&/^[1-9]\d{0,3}$/.test(m.page)?integer(Number(m.page),1000,1):0;
  if(number<=lastPage||s.locator!==`page:${number}`)throw Error('OCR page identity is inconsistent.');lastPage=number;
  const width=dimension(m.width_points),height=dimension(m.height_points),rotation=typeof m.rotation==='string'&&/^(0|90|180|270)$/.test(m.rotation)?Number(m.rotation):NaN;
  if(![0,90,180,270].includes(rotation))throw Error('Invalid OCR page rotation.');
  const displayWidth=rotation%180?height:width,displayHeight=rotation%180?width:height;
  if(!Number.isFinite(displayWidth/displayHeight)||displayWidth/displayHeight<.001||displayWidth/displayHeight>1000)throw Error('OCR page proportions exceed the inspection limit.');
  const extraction=m.extraction;if(extraction!=='ocr'&&extraction!=='text_layer')throw Error('Unknown page extraction method.');
  const content=verified.segments[index].text,encoded=encoder.encode(content),regions:OcrRegion[]=[],ordered=order(m.ocr_reading_order);
  for(const raw of items(s.regions??[],50000)){
   if(++totalRegions>100000)throw Error('OCR inspection exceeds its 100,000-region limit.');
   regions.push(region(raw,encoded,regions.at(-1)?.end??0));
  }
  const engine=m.ocr_engine===undefined||m.ocr_engine===''?'':text(m.ocr_engine,96);
  if(extraction==='text_layer'&&(regions.length||ordered||engine))throw Error('Embedded text cannot claim OCR geometry.');
  if(extraction==='text_layer'&&verified.pdfOcr?.mode==='all_pages')throw Error('All-page OCR selection cannot retain an embedded-text page.');
  if(extraction==='ocr'&&(!engine||!regions.length||decoder.decode(encoded.subarray(regions.at(-1)?.end??0)).trim()))throw Error('OCR evidence does not cover the retained page text.');
  const indices=new Set<number>(),columns=new Set<number>();
  for(const r of regions){
   if(ordered){
    if(r.providerIndex===null||r.column===null||r.providerIndex>=regions.length||r.column>ordered.columns||indices.has(r.providerIndex))throw Error('Inferred OCR order does not match its regions.');
    indices.add(r.providerIndex);if(r.column)columns.add(r.column);
   }else if(r.providerIndex!==null||r.column!==null)throw Error('OCR order receipt is missing.');
  }
  if(ordered&&columns.size!==ordered.columns)throw Error('Inferred OCR columns are incomplete.');
  if(extraction==='ocr'&&verified.pdfOcr){
   const selected=verified.pdfOcr.reading_order;
   if(selected==='provider'?ordered!==null:ordered?.direction!==(selected==='columns_ltr'?'ltr':'rtl'))throw Error('OCR order does not match the saved selection.');
  }
  pages.push({number,text:content,extraction,engine,displayWidth,displayHeight,regions,order:ordered});
 }
 return {filename:verified.filename,selection:verified.pdfOcr,pages};
}
export function drawnRegions(count:number,selected:number|null):number[]{
 const indices=Array.from({length:Math.min(count,2000)},(_,i)=>i);
 if(selected!==null&&selected>=indices.length&&selected<count)indices[indices.length-1]=selected;
 return indices;
}
