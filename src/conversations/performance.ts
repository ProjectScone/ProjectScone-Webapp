export const stageLabels = {
  capture_user:'Save message', recall:'Retrieve memory', embedding:'Embedding',
  assessment:'Jev assessment', decision_memory:'Decision memory',
  generation:'Model call', capture_assistant:'Save reply', model_start_timeout:'Model start timeout',
} as const;
export type PerformanceStage = keyof typeof stageLabels;
export interface PerformanceSpan {stage:PerformanceStage;start_ms:number;duration_ms:number;outcome:string;model?:string;provider?:string;first_text_ms?:number;mode?:'stream'|'structured'|'chat'}
export interface TurnPerformance {schema_version:1;total_ms:number;first_text_ms:number|null;truncated:boolean;spans:PerformanceSpan[]}
const outcomes=new Set(['completed','failed','cancelled','timeout','timed_out','prepared','empty','skipped','unavailable','degraded','reused','recorded','write_unavailable','read_unavailable','unknown']);
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid performance details');
  return value as Record<string,unknown>;
}
function milliseconds(value:unknown):number{
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Invalid duration');
  return value;
}
export function readPerformance(value:unknown):TurnPerformance|undefined{
  if(value==null)return undefined;
  // Optional diagnostics must never make a valid saved reply unreadable.
  try{
    const record=object(value);
    if(record.schema_version!==1||typeof record.truncated!=='boolean'||!Array.isArray(record.spans)||record.spans.length>64)return undefined;
    const total_ms=milliseconds(record.total_ms);
    const first_text_ms=record.first_text_ms===null?null:milliseconds(record.first_text_ms);
    if(first_text_ms!==null&&first_text_ms>total_ms)return undefined;
    const spans=record.spans.map((item):PerformanceSpan=>{
      const span=object(item);
      if(typeof span.stage!=='string'||!Object.hasOwn(stageLabels,span.stage)||typeof span.outcome!=='string'||!outcomes.has(span.outcome))throw Error('Invalid performance stage');
      const result:PerformanceSpan={stage:span.stage as PerformanceStage,start_ms:milliseconds(span.start_ms),duration_ms:milliseconds(span.duration_ms),outcome:span.outcome};
      if(result.start_ms>total_ms+.01||result.start_ms+result.duration_ms>total_ms+.01)throw Error('Stage exceeds turn');
      if(span.model!==undefined){if(typeof span.model!=='string'||!/^[A-Za-z0-9_./:+-]{1,160}$/.test(span.model))throw Error('Invalid model');result.model=span.model;}
      if(span.provider!==undefined){if(typeof span.provider!=='string'||!['typesafe','openrouter','ollama','remote'].includes(span.provider))throw Error('Invalid provider');result.provider=span.provider;}
      if(span.mode!==undefined){if(span.mode!=='stream'&&span.mode!=='structured'&&span.mode!=='chat')throw Error('Invalid model mode');result.mode=span.mode;}
      if(span.first_text_ms!==undefined){result.first_text_ms=milliseconds(span.first_text_ms);if(result.first_text_ms>result.duration_ms)throw Error('Invalid model first text');}
      return result;
    });
    return {schema_version:1,total_ms,first_text_ms,truncated:record.truncated,spans};
  }catch{return undefined;}
}
export function duration(milliseconds:number):string{
  return milliseconds<1000?`${Math.round(milliseconds)} ms`:`${(milliseconds/1000).toFixed(2)} s`;
}
