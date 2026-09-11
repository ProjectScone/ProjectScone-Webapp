export interface DocumentAttachment {attachment_id:string;media_type:string;bytes:number}
export interface DocumentBinding {original:DocumentAttachment;manifest:DocumentAttachment;format:string}
export interface DocumentSource {content:string;binding:DocumentBinding}
export interface CellReference {locator:string;text:string;association:string}
export interface DocumentCell {
 locator:string;tableLocator:string;row:number;column:number;rowSpan:number;columnSpan:number;
 isHeader:boolean;text:string;start:number;end:number;segment:number;
 headers:CellReference[];context:CellReference[];mergedLocators:string[];
}
export interface EvidenceSegment {locator:string;text:string;start:number;member:string;headerBasis:string}
export interface DocumentEvidence {
 filename:string;format:string;parser:string;segments:EvidenceSegment[];cells:Map<string,DocumentCell>;
 tables:{locator:string;cells:DocumentCell[]}[];notes:{locator:string;status:string;reason:string}[];
}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid document evidence record');return value as Record<string,unknown>;}
function text(value:unknown,max=4096,empty=false):string {
 if(typeof value!=='string'||value.length>max||(!empty&&!value.length)||decoder.decode(encoder.encode(value))!==value)throw Error('Invalid document evidence text');return value;
}
function count(value:unknown,max:number,min=0):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error('Invalid document evidence count');return value;}
function list(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||value.length>max)throw Error('Document evidence exceeds its list limit');return value;}
function attachment(value:unknown):DocumentAttachment {
 const v=record(value),id=text(v.attachment_id,64);if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid document attachment identity');
 return {attachment_id:id,media_type:text(v.media_type,256),bytes:count(v.bytes,Number.MAX_SAFE_INTEGER)};
}
export function documentBinding(episode:unknown):DocumentBinding|null {
 const v=record(episode),metadata=v.metadata==null?{}:record(v.metadata);
 if(metadata.document_original===undefined&&metadata.document_manifest===undefined)return null;
 const linked=list(v.attachments,10000).map(attachment),original=linked.find(a=>a.attachment_id===metadata.document_original),manifest=linked.find(a=>a.attachment_id===metadata.document_manifest);
 if(!original||!manifest||manifest.media_type!=='application/json')throw Error('Document evidence is not linked to this source');
 return {original,manifest,format:text(metadata.document_format,64)};
}
function sameAttachment(value:unknown,expected:DocumentAttachment){const actual=attachment(value);if(actual.attachment_id!==expected.attachment_id||actual.bytes!==expected.bytes||actual.media_type!==expected.media_type)throw Error('Document attachment does not match this source');}
function references(value:unknown,allowed:string[]):CellReference[]{return list(value,128).map(value=>{const v=record(value),association=text(v.association,16);if(!allowed.includes(association))throw Error('Unknown table association');return {locator:text(v.locator),text:text(v.text,2000000),association};});}
export function parseDocumentEvidence(value:unknown,source:DocumentSource):DocumentEvidence {
 const v=record(value);sameAttachment(v.original,source.binding.original);sameAttachment(v.manifest,source.binding.manifest);
 const format=text(v.format,64);if(format!==source.binding.format)throw Error('Document format does not match this source');
 const filename=text(v.filename,1024),parser=text(v.parser,128),segments:EvidenceSegment[]=[],cells=new Map<string,DocumentCell>();
 const occupied=new Set<string>(),identities=new Set<string>(),tables=new Map<string,DocumentCell[]>();
 const notes:DocumentEvidence['notes']=[];let offset=0,evidenceBytes=0;
 for(const value of list(v.segments,20000)){
  const s=record(value),content=text(s.text,2000000),locator=text(s.locator),metadata=s.metadata===undefined?{}:record(s.metadata),encoded=encoder.encode(content);
  if(offset+encoded.length>2000000)throw Error('Document text exceeds its byte limit');
  const member=metadata.member===undefined?'':text(metadata.member),headerBasis=metadata.header_basis===undefined?'':text(metadata.header_basis);
  const segment=segments.length;segments.push({locator,text:content,start:offset,member,headerBasis});
  if(metadata.table_notes!==undefined||metadata.table_status==='text_fallback')notes.push({locator,status:metadata.table_status===undefined?'':text(metadata.table_status),reason:metadata.table_notes===undefined?'Structure unavailable':text(metadata.table_notes)});
  let previous=0;
  for(const value of list(s.table_cells??[],20000)){
   const c=record(value);if(typeof c.is_header!=='boolean')throw Error('Invalid table header flag');
   const cell:DocumentCell={locator:text(c.locator),tableLocator:text(c.table_locator),row:count(c.row,19999),column:count(c.column,999),rowSpan:count(c.row_span,20000,1),columnSpan:count(c.column_span,1000,1),isHeader:c.is_header,text:text(c.text,2000000,true),start:count(c.start,encoded.length),end:count(c.end,encoded.length),segment,headers:references(c.headers,['explicit','row','column','rowgroup','colgroup']),context:references(c.context??[],['row_span']),mergedLocators:list(c.merged_locators??[],20000).map(value=>text(value))};
   evidenceBytes+=encoder.encode(JSON.stringify(c)).length;if(evidenceBytes>8000000)throw Error('Table evidence exceeds its byte limit');
   if((cell.start<encoded.length&&(encoded[cell.start]&0xc0)===0x80)||(cell.end<encoded.length&&(encoded[cell.end]&0xc0)===0x80))throw Error('Table cell splits a UTF-8 character');
   if(cell.start<previous||cell.end<cell.start||decoder.decode(encoded.subarray(cell.start,cell.end))!==cell.text)throw Error('Table value does not match its retained UTF-8 span');previous=cell.end;
   for(const id of [cell.locator,...cell.mergedLocators]){if(identities.has(id))throw Error('Duplicate table source identity');identities.add(id);}
   if(cell.row+cell.rowSpan>20000||cell.column+cell.columnSpan>1000||occupied.size+cell.rowSpan*cell.columnSpan>100000)throw Error('Table geometry exceeds its limit');
   for(let row=cell.row;row<cell.row+cell.rowSpan;row++)for(let col=cell.column;col<cell.column+cell.columnSpan;col++){
    const slot=JSON.stringify([cell.tableLocator,row,col]);if(occupied.has(slot))throw Error('Table cells overlap');occupied.add(slot);
   }
   cell.start+=offset;cell.end+=offset;cells.set(cell.locator,cell);
   let table=tables.get(cell.tableLocator);if(!table){table=[];tables.set(cell.tableLocator,table);}table.push(cell);
  }
  offset+=encoded.length+2;
 }
 if(segments.map(s=>s.text).join('\n\n')!==source.content)throw Error('Document evidence does not match the retained text. Refresh the source.');
 for(const cell of cells.values()){
  for(const kind of ['headers','context'] as const){const seen=new Set<string>();for(const ref of cell[kind]){
   const origin=cells.get(ref.locator);
   if(!origin||origin.tableLocator!==cell.tableLocator||origin.locator===cell.locator||origin.text!==ref.text||seen.has(ref.locator))throw Error('Table reference does not match its source cell');seen.add(ref.locator);
   if(kind==='context'){
    if(origin.isHeader||!(origin.row<cell.row&&cell.row<origin.row+origin.rowSpan))throw Error('Table context is not a spanning data cell');
   }else{
    if(!origin.isHeader)throw Error('Table header points to a data cell');
    if(ref.association==='row'&&!(origin.column<cell.column&&origin.row<cell.row+cell.rowSpan&&cell.row<origin.row+origin.rowSpan))throw Error('Table row header does not intersect this row');
    if(ref.association==='column'&&!(origin.row<cell.row&&origin.column<cell.column+cell.columnSpan&&cell.column<origin.column+origin.columnSpan))throw Error('Table column header does not intersect this column');
   }
  }}
 }
 return {filename,format,parser,segments,cells,tables:Array.from(tables,([locator,cells])=>({locator,cells:cells.sort((a,b)=>a.row-b.row||a.column-b.column)})),notes};
}
export function cellExcerpt(cell:DocumentCell,evidence:DocumentEvidence){
 const segment=evidence.segments[cell.segment],bytes=encoder.encode(segment.text),start=cell.start-segment.start,end=cell.end-segment.start;
 const before=decoder.decode(bytes.subarray(0,start)),after=decoder.decode(bytes.subarray(end));
 return {before:before.slice(-300),value:cell.text,after:after.slice(0,300),clippedBefore:before.length>300,clippedAfter:after.length>300};
}
