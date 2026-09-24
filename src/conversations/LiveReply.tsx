import {useEffect,useRef,useState} from 'react';
import {ApiError,type ApiClient} from '../api';
import {readTextStream} from './text-stream';
import {ReplyContent} from './ReplyContent';

const MAX_PREVIEW_BYTES=1024*1024;
type Phase='connecting'|'awaiting-text'|'live'|'interrupted'|'waiting'|'limited';
export function LiveReply({api,sid,requestId,onTerminal}:{api:ApiClient;sid:string;requestId:string;onTerminal:(id:string)=>void}){
  const [attempt,setAttempt]=useState(0),[phase,setPhase]=useState<Phase>('connecting');
  const [text,setText]=useState(''),[missing,setMissing]=useState(false),[retryable,setRetryable]=useState(true);
  const [waitSeconds,setWaitSeconds]=useState(0);
  useEffect(()=>{
    if(phase!=='awaiting-text')return;
    const started=Date.now();setWaitSeconds(0);
    const timer=setInterval(()=>setWaitSeconds(Math.floor((Date.now()-started)/1000)),1000);
    return()=>clearInterval(timer);
  },[phase,requestId,attempt]);
  const cursor=useRef(0),received=useRef(''),bytes=useRef(0),owner=useRef(api);
  useEffect(()=>{
    if(owner.current!==api){owner.current=api;cursor.current=0;received.current='';bytes.current=0;setText('');setMissing(false);}
    const controller=new AbortController();let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
    const heartbeat=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),30000);};
    setPhase('connecting');setRetryable(true);heartbeat();
    void(async()=>{
      try{
        const body=await api.conversationStream(sid,requestId,cursor.current,controller.signal);
        if(disposed){await body.cancel();return;}
        setPhase('awaiting-text');
        for await(const event of readTextStream(body,requestId,cursor.current,heartbeat)){
          if(disposed)return;
          if(event.kind==='text'){
            const nextBytes=bytes.current+new TextEncoder().encode(event.text).length;
            if(nextBytes>MAX_PREVIEW_BYTES){setPhase('limited');return;}
            cursor.current=event.sequence;bytes.current=nextBytes;received.current+=event.text;
            setText(received.current);setPhase('live');
          }else if(event.kind==='gap'){
            // Do not concatenate non-contiguous passages as though nothing was lost.
            cursor.current=event.next-1;received.current='';bytes.current=0;setText('');setMissing(true);
          }else{
            // Completed transport is not yet a saved message. Keep its labelled
            // preview until the matching assistant episode reaches the transcript.
            if(event.kind!=='terminal'||event.status!=='completed'){received.current='';bytes.current=0;setText('');}
            setPhase('waiting');
            if(event.kind==='terminal')onTerminal(requestId);
            return;
          }
        }
      }catch(error){if(!disposed){
        setRetryable(!(error instanceof ApiError&&[401,403,404,409,422,501].includes(error.status)));
        setPhase('interrupted');
      }}finally{clearTimeout(timer);controller.abort();}
    })();
    return()=>{disposed=true;clearTimeout(timer);controller.abort();};
  },[api,sid,requestId,attempt,onTerminal]);
  const status=phase==='connecting'?'Connecting…':phase==='awaiting-text'?(waitSeconds>=8?`Still working · ${waitSeconds}s`:'Thinking…'):phase==='live'?'Replying…':phase==='interrupted'?'Connection interrupted · checking reply':phase==='limited'?'Long reply · waiting for it to finish':text?'Saving…':'Checking reply…';
  return <section className="conversation-live" aria-label="Live reply preview">
    <header className="conversation-message-label"><span>Assistant</span><span className="conversation-live-status" role="status"><i aria-hidden="true"/>{status}</span></header>
    {missing&&<p className="conversation-live-gap">Earlier live text is missing. Showing only the latest continuous segment.</p>}
    {text&&owner.current===api&&<div className="conversation-live-text" aria-label="Provisional reply text"><ReplyContent text={text}/></div>}
    {phase==='interrupted'&&retryable&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>Reconnect reply</button>}
  </section>;
}
