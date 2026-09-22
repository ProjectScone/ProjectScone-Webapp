import {duration,stageLabels,type TurnPerformance} from './performance';

export function PerformanceDetails({value}:{value:TurnPerformance|undefined}){
  if(!value)return <p className="conversation-caption">Timing details are unavailable for this reply.</p>;
  const generation=[...value.spans].reverse().find(span=>span.stage==='generation'&&span.mode==='stream');
  const assessments=value.spans.filter(span=>span.stage==='assessment');
  const reused=value.spans.some(span=>span.stage==='decision_memory'&&span.outcome==='reused');
  return <section className="reply-performance" aria-label="Reply performance">
    <h3>Reply timeline</h3>
    <dl className="performance-summary">
      <div><dt>First text</dt><dd>{value.first_text_ms===null?'Not observed':duration(value.first_text_ms)}</dd></div>
      <div><dt>Total</dt><dd>{duration(value.total_ms)}</dd></div>
    </dl>
    {generation?.model&&<p className="performance-provider"><strong>{generation.model}</strong><span>{generation.provider??'Provider not recorded'}</span></p>}
    <p className="performance-assessment">{reused?'Jev · saved judgment reused':assessments.length?`Jev · ${assessments.length} call${assessments.length===1?'':'s'} · ${assessments.at(-1)?.outcome}`:'Jev · no call recorded'}</p>
    <details className="performance-details"><summary>Inspect all stages <span>{value.spans.length}</span></summary>
      <ol>{value.spans.map((span,index)=><li key={index} data-stage={span.stage}>
        <div className="performance-stage"><span>{stageLabels[span.stage]}</span><strong>{duration(span.duration_ms)}</strong></div>
        <div className="performance-track" aria-hidden="true"><i style={{marginLeft:`${Math.min(100,span.start_ms/Math.max(1,value.total_ms)*100)}%`,width:`${Math.min(100,span.duration_ms/Math.max(1,value.total_ms)*100)}%`}}/></div>
        <small>{span.outcome.replaceAll('_',' ')}{span.mode?` · ${span.mode}`:''}{span.model?` · ${span.model}`:''}{span.first_text_ms!==undefined?` · first text ${duration(span.first_text_ms)}`:''}</small>
      </li>)}</ol>
      <p>Stages overlap: embeddings are included in saving or retrieval. Total is elapsed time, not the sum of stages.</p>
      {value.truncated&&<p>Some operations were omitted because the timeline reached its limit.</p>}
    </details>
  </section>;
}
