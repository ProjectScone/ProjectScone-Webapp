export interface SourceSummary {
  document_filename?:string;
  episode_id:number; kind:string; source:string|null; created_at:string;
  byte_count:number; preview:string; preview_truncated:boolean;
}
export interface SourcePage {items:SourceSummary[];has_more:boolean;next_before:number|null}
export interface SourceFilter {kind?:string;before?:number}
const object=(value:unknown):value is Record<string,unknown> => !!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is number => typeof value==='number'&&Number.isSafeInteger(value)&&value>0;

export function documentDisplayName(value:unknown):string|null {
  if(typeof value!=='string'||!value||/[\u0000-\u001f\u007f]/.test(value))return null;
  const encoded=new TextEncoder().encode(value);
  return encoded.length<=1024&&new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(encoded)===value?value:null;
}

/** Validate pagination before using its cursor; unknown additive fields are ignored. */
export function parseSourcePage(value:unknown,filter:SourceFilter={}):SourcePage {
  const invalid=()=>Error('Invalid source page returned by the server.');
  if(!object(value)||!Array.isArray(value.items)||value.items.length>25||typeof value.has_more!=='boolean')throw invalid();
  let previous=filter.before??Infinity;
  for(const row of value.items){
    if(!object(row)||!id(row.episode_id)||row.episode_id>=previous
      ||typeof row.kind!=='string'||!row.kind||filter.kind&&row.kind!==filter.kind
      ||row.document_filename!==undefined&&documentDisplayName(row.document_filename)===null
      ||!(row.source===null||typeof row.source==='string')||typeof row.created_at!=='string'
      ||typeof row.byte_count!=='number'||!Number.isSafeInteger(row.byte_count)||row.byte_count<0
      ||typeof row.preview!=='string'||Array.from(row.preview).length>500||typeof row.preview_truncated!=='boolean')throw invalid();
    previous=row.episode_id;
  }
  if(value.has_more ? !value.items.length||value.next_before!==previous : value.next_before!==null)throw invalid();
  return value as unknown as SourcePage;
}
export function parseRetainedSource(value:unknown,episodeId:number):{episode_id:number;content:string} {
  if(!object(value)||value.episode_id!==episodeId||typeof value.content!=='string')throw Error('Invalid source response: retained text could not be verified.');
  return {episode_id:episodeId,content:value.content};
}
