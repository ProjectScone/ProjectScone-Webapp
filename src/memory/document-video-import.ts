export const VIDEO_FORMATS=new Set(['mp4','m4v','mov','webm','mkv','avi','mpeg','mpg','mpegts']);
export interface VideoOcrCatalog {available:boolean;extensions:string[]}
export function videoFilename(filename:string):boolean{return VIDEO_FORMATS.has(filename.slice(filename.lastIndexOf('.')+1).toLowerCase());}
export function videoOcrChoice(value:unknown):boolean{
 if(value===undefined)return false;if(typeof value!=='boolean')throw Error('Video OCR selection must be a boolean.');return value;
}
export function parseVideoOcrCatalog(value:unknown):VideoOcrCatalog{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid video OCR catalogue.');
 const v=value as Record<string,unknown>,selection=v.selection;
 if(typeof v.available!=='boolean'||v.extraction!=='sampled-frame-text'||v.includes_audio!==false
  ||!selection||typeof selection!=='object'||Array.isArray(selection)||(selection as Record<string,unknown>).video_ocr!==true
  ||!Array.isArray(v.extensions)||!v.extensions.length||v.extensions.length>VIDEO_FORMATS.size
  ||v.extensions.some(extension=>typeof extension!=='string'||!extension.startsWith('.')||!VIDEO_FORMATS.has(extension.slice(1)))
  ||new Set(v.extensions).size!==v.extensions.length)throw Error('Invalid video OCR availability or extraction contract.');
 return {available:v.available,extensions:[...v.extensions] as string[]};
}
export function validateVideoOcr(filename:string,catalog:VideoOcrCatalog|undefined,selected:boolean):void{
 if(typeof selected!=='boolean')throw Error('Video OCR selection must be a boolean.');
 if(selected&&(!catalog?.available||!catalog.extensions.includes(filename.slice(filename.lastIndexOf('.')).toLowerCase())))
  throw Error('Visible-text video OCR is unavailable for this file on the connected server.');
}
