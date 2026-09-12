export const OCR_MODES=['missing_text','all_pages'] as const;
export const OCR_ORDERS=['provider','columns_ltr','columns_rtl'] as const;
export interface PdfOcrSelection {mode:typeof OCR_MODES[number];reading_order:typeof OCR_ORDERS[number]}
export interface PdfOcrEvidence extends PdfOcrSelection {dpi:number}
export interface PdfOcrCatalog {available:boolean;modes:PdfOcrSelection['mode'][];readingOrders:PdfOcrSelection['reading_order'][]}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid PDF OCR settings.');return value as Record<string,unknown>;}
function member<T extends string>(value:unknown,allowed:readonly T[]):T{if(typeof value!=='string'||!allowed.includes(value as T))throw Error('Unsupported PDF OCR choice.');return value as T;}
export function parsePdfOcrSelection(value:unknown):PdfOcrSelection{
 const v=record(value);if(Object.keys(v).length!==2)throw Error('Invalid PDF OCR selection.');
 return {mode:member(v.mode,OCR_MODES),reading_order:member(v.reading_order,OCR_ORDERS)};
}
export function parsePdfOcrEvidence(value:unknown):PdfOcrEvidence{
 if(typeof value!=='string'||value.length>4096)throw Error('Invalid retained PDF OCR settings.');
 const v=record(JSON.parse(value));
 if(Object.keys(v).length!==3||typeof v.dpi!=='number'||!Number.isSafeInteger(v.dpi)||v.dpi<72||v.dpi>300)throw Error('Invalid retained PDF OCR resolution.');
 return {...parsePdfOcrSelection({mode:v.mode,reading_order:v.reading_order}),dpi:v.dpi};
}
export function parsePdfOcrCatalog(value:unknown):PdfOcrCatalog{
 const v=record(value);if(typeof v.available!=='boolean')throw Error('Invalid PDF OCR availability.');
 function choices<T extends string>(value:unknown,allowed:readonly T[]):T[]{
  if(!Array.isArray(value)||!value.length||value.length>allowed.length||new Set(value).size!==value.length)throw Error('Invalid PDF OCR choices.');
  return value.map(value=>member(value,allowed));
 }
 return {available:v.available,modes:choices(v.modes,OCR_MODES),readingOrders:choices(v.reading_orders,OCR_ORDERS)};
}
export function samePdfOcr(left:PdfOcrSelection|undefined,right:PdfOcrSelection|undefined):boolean{
 return left?.mode===right?.mode&&left?.reading_order===right?.reading_order;
}
export function validatePdfOcr(filename:string,catalog:PdfOcrCatalog|undefined,selection:PdfOcrSelection|undefined):void{
 if(selection===undefined)return;
 const choice=parsePdfOcrSelection(selection);
 if(!filename.toLowerCase().endsWith('.pdf')||!catalog?.available||!catalog.modes.includes(choice.mode)||!catalog.readingOrders.includes(choice.reading_order))throw Error('This PDF OCR choice is unavailable on the connected server.');
}
export const ocrModeLabel=(mode:PdfOcrSelection['mode'])=>mode==='missing_text'?'OCR pages without text':'OCR all pages';
export const ocrOrderLabel=(order:PdfOcrSelection['reading_order'])=>order==='provider'?'Recognizer order':order==='columns_ltr'?'Infer columns left to right':'Infer columns right to left';
