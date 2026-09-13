import {useEffect,useRef,useState} from 'react';
import {ApiError,type ApiClient} from '../api';
import {readAnswerStream} from './answer-stream';

const MAX_PREVIEW_BYTES=1024*1024;
type Phase='connecting'|'live'|'interrupted'|'waiting'|'ended'|'limited';
// The answer a running step is writing, shown as it arrives and labelled
// provisional until the run's verified result replaces it. Mirrors the
// conversation live preview: withdrawn text is cleared, a gap is said
// rather than papered over, and the receipt decides the outcome.
export function AnswerPane({api,runId,stepId,onTerminal}:{api:ApiClient;runId:string;stepId:string;onTerminal:()=>void}){
 const [attempt,setAttempt]=useState(0),[phase,setPhase]=useState<Phase>('connecting'),[text,setText]=useState(''),[missing,setMissing]=useState(false),[withdrawn,setWithdrawn]=useState(false),[retryable,setRetryable]=useState(true),[reason,setReason]=useState('');
 const cursor=useRef(0),received=useRef(''),bytes=useRef(0),owner=useRef(api),terminal=useRef(onTerminal);terminal.current=onTerminal;
 useEffect(()=>{
  if(owner.current!==api){owner.current=api;cursor.current=0;received.current='';bytes.current=0;setText('');setMissing(false);setWithdrawn(false);}
  const controller=new AbortController();let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const heartbeat=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),45000);};
  setPhase('connecting');setRetryable(true);setReason('');heartbeat();
  void(async()=>{
   try{
    const body=await api.answerStream(runId,stepId,cursor.current,controller.signal);
    if(disposed){await body.cancel();return;}
    for await(const event of readAnswerStream(body,cursor.current,heartbeat)){
     if(disposed)return;
     if(event.kind==='text'){
      const nextBytes=bytes.current+new TextEncoder().encode(event.text).length;
      if(nextBytes>MAX_PREVIEW_BYTES){setPhase('limited');return;}
      cursor.current=event.sequence;bytes.current=nextBytes;received.current+=event.text;setText(received.current);setWithdrawn(false);setPhase('live');
     }else if(event.kind==='withdraw'){
      // What was written was not the answer: a tool turn followed. Clear it
      // and say so, rather than leave it reading as the reply.
      cursor.current=event.sequence;received.current='';bytes.current=0;setText('');setWithdrawn(true);
     }else if(event.kind==='gap'){
      cursor.current=event.next-1;received.current='';bytes.current=0;setText('');setMissing(true);
     }else if(event.kind==='terminal'){
      setPhase('waiting');terminal.current();return;
     }else{setReason(event.reason);setPhase('ended');return;}
    }
   }catch(error){if(!disposed){
    setRetryable(!(error instanceof ApiError&&[401,403,404,409,422,501].includes(error.status)));
    setPhase('interrupted');
   }}finally{clearTimeout(timer);controller.abort();}
  })();
  return()=>{disposed=true;clearTimeout(timer);controller.abort();};
 // Not `onTerminal`: the run view hands a fresh function on every status
 // poll, and reconnecting on each would open a stream per poll.
 },[api,runId,stepId,attempt]);
 const status=phase==='connecting'?'Connecting to the answer as it is written…':phase==='live'?'Receiving the answer as it is written':phase==='interrupted'?'Live answer interrupted. Checking the saved result.':phase==='limited'?'Preview size limit reached. The saved result carries the full answer.':phase==='ended'?(reason==='observation_window_ended'?'The observation window ended. Reconnect to keep following.':'The live answer is no longer available here. The saved result carries the answer.'):'The run has a receipt. Reading the verified result.';
 return <section className="agent-answer-live" aria-label={`Answer being written for ${stepId}`}>
  <header><span className="agent-answer-badge"><span aria-hidden="true">◉</span> Live answer · {stepId}</span><span>Provisional, not the verified result</span></header>
  <div className="agent-answer-status" role="status">{status}</div>
  {withdrawn&&!text&&<p className="agent-notice">Text written before a tool call was withdrawn; it was not the answer.</p>}
  {missing&&<p className="agent-notice">Earlier live text is missing. Showing only the latest continuous segment.</p>}
  {text&&owner.current===api&&<div className="agent-output agent-answer-text" tabIndex={0} aria-label={`Provisional answer text for ${stepId}`}>{text}</div>}
  <footer><span>Public text as the model writes it, never a token count or a tool argument. The verified result decides the outcome.</span>
   {(phase==='interrupted'&&retryable||phase==='ended'&&reason==='observation_window_ended')&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>Reconnect</button>}
  </footer>
 </section>;
}
