// Live delivery of the same verified pages the history route returns, as
// text/event-stream frames. Each `history` frame carries a page as data
// and its next_after as the SSE id, so a page is accepted only when the
// id names it; `end` ends the observation; `error` is a refusal with the
// server's fixed reason and no exception text. Nothing here resumes on
// its own: the caller decides, with the last cursor it was given.
import {parseHistoryPage,type HistoryPage} from './history.ts';
import type {RunRequest} from './runs.ts';

const MAX_FRAME=1_048_576;

export async function* readHistoryFrames(body:ReadableStream<Uint8Array>,{request,after,limit}:{request:RunRequest;after:string|null;limit:number}):AsyncGenerator<HistoryPage>{
 const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let pending='',event='',id='',data:string[]=[],size=0,cursor=after;
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done){decoder.decode();throw Error('The run history stream ended before the server ended it.');}
   const decoded=decoder.decode(value,{stream:true});
   let offset=0;
   while(offset<decoded.length){
    const newline=decoded.indexOf('\n',offset),end=newline<0?decoded.length:newline;
    pending+=decoded.slice(offset,end);size+=end-offset;
    if(size>MAX_FRAME)throw Error('The run history stream frame exceeds its limit.');
    if(newline<0)break;
    offset=newline+1;size++;
    const line=pending.endsWith('\r')?pending.slice(0,-1):pending;pending='';
    if(line===''){
     if(data.length){
      if(event==='end')return;
      const wire:unknown=JSON.parse(data.join('\n'));
      if(event==='error'){
       const reason=wire&&typeof wire==='object'&&!Array.isArray(wire)&&typeof (wire as Record<string,unknown>).error==='string'?(wire as Record<string,unknown>).error as string:'unknown';
       throw Error('The run history stream was refused: '+reason+'.');
      }
      if(event!=='history')throw Error('The run history stream sent an event this console does not read.');
      const page=parseHistoryPage(wire,request,cursor,limit);
      if(id!==(page.next_after??''))throw Error('The run history stream id does not name the page it carries.');
      cursor=page.next_after;
      yield page;
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
 }finally{reader.releaseLock();}
}
