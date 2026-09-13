import {useEffect,useRef,useState} from 'react';
import {ApiError,type ApiClient} from '../api';
import {isHandoffPlan,parseSavedEdit,planAddress,validatePlan,type AgentChoice,type HandoffAgent,type HandoffPlan,type SavedPlan} from './plans';
import {OutputRequirementsEditor} from './OutputRequirementsEditor';
import {requireOutputCapabilities} from './output-requirements';
const secureRequest={cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
export function HandoffEditor({api,space,catalog,initial,onSave,onDirty,handoffRequirementsAvailable,schemaAvailable}:{handoffRequirementsAvailable:boolean;schemaAvailable:boolean;api:ApiClient;space:string;catalog:AgentChoice[];initial:SavedPlan|null;onSave:(plan:SavedPlan)=>void;onDirty:()=>void}){
 const first=catalog[0];
 const [plan,setPlan]=useState<HandoffPlan>(initial&&isHandoffPlan(initial.plan)?initial.plan:{workflow_id:'',root_agent:first?.agent_id??'',max_handoffs:3,agents:first?[{agent_id:first.agent_id,model_id:first.default_model,can_handoff_to:[]}]:[]});
 const [revision,setRevision]=useState(initial?.revision??0),[busy,setBusy]=useState(false),[issue,setIssue]=useState(''),[notice,setNotice]=useState(''),[reviewRequired,setReviewRequired]=useState(initial?.configuration_current===false);
 const active=useRef<AbortController|null>(null);useEffect(()=>()=>active.current?.abort(),[]);
 const edit=(change:(value:HandoffPlan)=>HandoffPlan)=>{onDirty();setNotice('');setPlan(change);};
 const update=(index:number,change:Partial<HandoffAgent>)=>edit(value=>({...value,agents:value.agents.map((agent,i)=>i===index?{...agent,...change}:agent)}));
 const save=async()=>{
  if(busy)return;setIssue('');setNotice('');const controller=new AbortController();active.current=controller;
  try{
   const valid=validatePlan(plan,catalog);requireOutputCapabilities(valid,false,schemaAvailable,handoffRequirementsAvailable);setBusy(true);
   const saved=parseSavedEdit(await api.request<unknown>(planAddress(valid.workflow_id),{...secureRequest,method:'PUT',body:JSON.stringify({expected_revision:revision,plan:valid}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),space,valid,revision);
   if(!isHandoffPlan(saved.plan))throw Error('The server returned a different workflow type.');
   if(!controller.signal.aborted){setPlan(saved.plan);setRevision(saved.revision);setReviewRequired(!saved.configuration_current);onSave(saved);setNotice(`Saved revision ${saved.revision}.`);}
  }catch(error){if(!controller.signal.aborted)setIssue(error instanceof ApiError&&error.status===409?'This plan changed. Reload its saved version before editing again. Your draft has been kept.':error instanceof ApiError&&error.status===403?'This key cannot save this plan. Your draft has been kept.':error instanceof Error?error.message:'The save response is unavailable. Reload the saved plan to check whether it was saved.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 const unused=catalog.filter(choice=>!plan.agents.some(agent=>agent.agent_id===choice.agent_id));
 return <form className="agent-editor" onChange={onDirty} onSubmit={event=>{event.preventDefault();void save();}}>
  <h2>{initial?'Edit handoff workflow':'New handoff workflow'}</h2>
  <p>Agents choose when to finish or pass work to an allowed agent. Each keeps the model you select.</p>
  {reviewRequired&&<p className="agent-notice" role="status">The host changed an agent or model configuration. Review every agent and save a new revision before running it.</p>}
  <fieldset disabled={busy}>
   <label>Workflow identifier<input required maxLength={128} value={plan.workflow_id} disabled={revision>0} onChange={event=>edit(value=>({...value,workflow_id:event.target.value}))}/></label>
   <div className="agent-fields"><label>Starting agent<select aria-label="Starting agent" value={plan.root_agent} onChange={event=>edit(value=>({...value,root_agent:event.target.value}))}>{plan.agents.map(agent=><option key={agent.agent_id} value={agent.agent_id}>{agent.agent_id}</option>)}</select></label>
   <label>Maximum handoffs<input aria-label="Maximum handoffs" type="number" min={0} max={31} step={1} required value={Number.isFinite(plan.max_handoffs)?plan.max_handoffs:''} onChange={event=>edit(value=>({...value,max_handoffs:event.target.value===''?Number.NaN:Number(event.target.value)}))}/></label></div>
   <p>Up to {Number.isFinite(plan.max_handoffs)?plan.max_handoffs+1:'—'} agent steps. Repeated agents are allowed only through the targets below. Reaching the limit keeps partial work and returns no final answer.</p>
   {(handoffRequirementsAvailable||plan.answer_requirements)&&<section aria-label="Final answer contract">
    <h3>Final answer</h3><p>Requirements apply when an agent finishes the workflow. Agents can pass ordinary text notes between steps.</p>
    <OutputRequirementsEditor value={plan.answer_requirements} available={handoffRequirementsAvailable} schemaAvailable={schemaAvailable} onChange={answer_requirements=>edit(value=>({...value,answer_requirements}))}/>
   </section>}
   {plan.agents.map((selected,index)=>{
    const agent=catalog.find(choice=>choice.agent_id===selected.agent_id);
    return <section className="agent-task" key={selected.agent_id} aria-label={`Handoff agent ${selected.agent_id}`}>
     <div className="agent-task-heading"><h3>{selected.agent_id}{!agent?' (unavailable)':''}</h3><button type="button" disabled={plan.agents.length===1} onClick={()=>edit(value=>{
      const agents=value.agents.filter((_,i)=>i!==index).map(other=>({...other,can_handoff_to:other.can_handoff_to.filter(id=>id!==selected.agent_id)}));
      return {...value,agents,root_agent:value.root_agent===selected.agent_id?agents[0]?.agent_id??'':value.root_agent};
     })}>Remove agent {selected.agent_id}</button></div>
     <label>Model<select aria-label={`Model for ${selected.agent_id}`} value={selected.model_id} onChange={event=>update(index,{model_id:event.target.value})}>
      {!agent?.models.some(model=>model.model_id===selected.model_id)&&<option value={selected.model_id}>{selected.model_id} (unavailable)</option>}{agent?.models.map(model=><option key={model.model_id} value={model.model_id}>{model.label} · {model.model_id}</option>)}
     </select></label>
     <fieldset className="agent-dependencies"><legend>Allowed handoff targets</legend>{plan.agents.map(target=><label key={target.agent_id}><input type="checkbox" checked={selected.can_handoff_to.includes(target.agent_id)} onChange={event=>update(index,{can_handoff_to:event.target.checked?[...selected.can_handoff_to,target.agent_id]:selected.can_handoff_to.filter(id=>id!==target.agent_id)})}/>{target.agent_id}{target.agent_id===selected.agent_id?' (repeat this agent)':''}</label>)}</fieldset>
     {!selected.can_handoff_to.length&&<p>This agent must finish without handing off.</p>}
    </section>;
   })}
   <label>Add agent<select aria-label="Add agent" value="" disabled={!unused.length||plan.agents.length>=32} onChange={event=>{const choice=unused.find(agent=>agent.agent_id===event.target.value);if(choice)edit(value=>({...value,agents:[...value.agents,{agent_id:choice.agent_id,model_id:choice.default_model,can_handoff_to:[]}]}));}}><option value="">Choose an agent</option>{unused.map(agent=><option key={agent.agent_id} value={agent.agent_id}>{agent.agent_id}</option>)}</select></label>
   <div className="agent-actions"><button className="primary" disabled={!plan.agents.length}>{busy?'Saving…':'Save workflow'}</button><span>{revision?`Revision ${revision}`:'Not saved'}</span></div>
  </fieldset>
  {issue&&<p role="alert" className="agent-notice">{issue}</p>}{notice&&<p role="status">{notice}</p>}
 </form>;
}
