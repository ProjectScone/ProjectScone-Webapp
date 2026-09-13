// The answer a running step is writing, read as events off the host's
// text/event-stream route. Provisional by design: the terminal says the
// run has a receipt, and the verified result is what /result returns.
// Sequences are contiguous from the cursor -- a gap is the only sanctioned
// jump -- and a frame's id must name its sequence, because it is what a
// reconnect sends back. Nothing but content is ever in these frames, and a
// frame carrying more than its own fields is refused.
import {runAddress} from './runs.ts';

export type AnswerEvent={kind:'text';sequence:number;text:string}|{kind:'withdraw';sequence:number}
  |{kind:'gap';after:number;next:number}|{kind:'terminal';status:string}|{kind:'end';reason:string};
const MAX_FRAME=1_048_576;
const MAX_SEQUENCE=Number.MAX_SAFE_INTEGER;

function invalid(what:string):never{throw Error('The answer stream could not be verified: '+what+'.');}
function sequence(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>MAX_SEQUENCE)invalid('sequence');return value;}
function exact(row:Record<string,unknown>,fields:string[]):void{const keys=Object.keys(row);if(keys.length!==fields.length||fields.some(field=>!Object.hasOwn(row,field)))invalid('frame fields');}
export function answerAddress(runId:string,stepId:string):string{
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(stepId)||stepId==='.'||stepId==='..')throw Error('Use letters, numbers, dots, colons, underscores or hyphens for identifiers.');
 return runAddress(runId)+'/steps/'+encodeURIComponent(stepId)+'/text/stream';
}

export async function* readAnswerStream(body:ReadableStream<Uint8Array>,after:number,onActivity=()=>{}):AsyncGenerator<AnswerEvent>{
 const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let pending='',event='',id='',data:string[]=[],size=0,cursor=after;
 const sequenced=(row:Record<string,unknown>):number=>{
  const value=sequence(row.sequence);
  if(value!==cursor+1)invalid('sequence');
  if(id!==String(value))invalid('frame id does not name its sequence');
  return value;
 };
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done){decoder.decode();throw Error('The answer stream ended before the host ended it.');}
   onActivity();
   const decoded=decoder.decode(value,{stream:true});
   let offset=0;
   while(offset<decoded.length){
    const newline=decoded.indexOf('\n',offset),end=newline<0?decoded.length:newline;
    pending+=decoded.slice(offset,end);size+=end-offset;
    if(size>MAX_FRAME)throw Error('The answer stream frame exceeds its limit.');
    if(newline<0)break;
    offset=newline+1;size++;
    const line=pending.endsWith('\r')?pending.slice(0,-1):pending;pending='';
    if(line===''){
     if(data.length){
      const wire:unknown=JSON.parse(data.join('\n'));
      if(!wire||typeof wire!=='object'||Array.isArray(wire))invalid('frame');
      const row=wire as Record<string,unknown>;
      if(event==='error'){throw Error('The answer stream was refused: '+(typeof row.reason==='string'?row.reason:'unknown')+'.');}
      if(event==='text'){
       exact(row,['sequence','text']);const value=sequenced(row);
       if(typeof row.text!=='string'||!row.text.length)invalid('text');
       cursor=value;yield {kind:'text',sequence:value,text:row.text};
      }else if(event==='withdraw'){
       exact(row,['sequence']);const value=sequenced(row);cursor=value;yield {kind:'withdraw',sequence:value};
      }else if(event==='gap'){
       exact(row,['after','next_sequence']);
       if(id||row.after!==cursor)invalid('gap');
       const next=sequence(row.next_sequence);if(next<=cursor+1)invalid('gap');
       const previous=cursor;cursor=next-1;yield {kind:'gap',after:previous,next};
      }else if(event==='terminal'){
       exact(row,['status','read_receipt']);
       if(id||row.read_receipt!==true||typeof row.status!=='string'||!row.status)invalid('terminal without a read_receipt');
       yield {kind:'terminal',status:row.status};return;
      }else if(event==='end'){
       exact(row,['reason']);
       if(id||typeof row.reason!=='string'||!row.reason)invalid('end');
       yield {kind:'end',reason:row.reason};return;
      }else invalid('frame kind');
     }
     event='';id='';data=[];size=0;
    }else if(!line.startsWith(':')){
     const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon);
     let content=colon<0?'':line.slice(colon+1);if(content.startsWith(' '))content=content.slice(1);
     if(field==='event')event=content;
     else if(field==='id')id=content;
     else if(field==='data')data.push(content);
    }
   }
  }
 }finally{try{await reader.cancel();}finally{reader.releaseLock();}}
}
