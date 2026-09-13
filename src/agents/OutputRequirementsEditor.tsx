import {useEffect,useRef,useState} from 'react';
import {parseOutputRequirements,parseSchemaDraft,type OutputRequirements} from './output-requirements';

export function OutputRequirementsEditor({value,onChange,available,schemaAvailable}:{value:OutputRequirements|undefined;onChange:(value:OutputRequirements|undefined)=>void;available:boolean;schemaAvailable:boolean}){
 const [draft,setDraft]=useState(()=>value?.output_schema?JSON.stringify(value.output_schema,null,2):'');
 const [issue,setIssue]=useState('');
 const schemaField=useRef<HTMLTextAreaElement|null>(null),accepted=useRef(value?.output_schema);
 useEffect(()=>{
  if(value?.output_schema===accepted.current)return;
  accepted.current=value?.output_schema;setDraft(value?.output_schema?JSON.stringify(value.output_schema,null,2):'');
  setIssue('');schemaField.current?.setCustomValidity('');
 },[value?.output_schema]);
 if(!available&&!value)return null;
 const choose=(mode:string)=>{
  setIssue('');schemaField.current?.setCustomValidity('');setDraft('');accepted.current=undefined;
  if(mode==='none'){onChange(undefined);return;}
  onChange({...parseOutputRequirements({}),...value,format:mode==='json_object'?'json_object':'text',output_schema:undefined});
 };
 return <fieldset className="agent-output-requirements" disabled={!available}>
  <legend>Output requirements</legend>
  {!available&&<p>This server cannot edit output requirements.</p>}
  <label>Answer format<select aria-label="Answer format" value={value?.format??'none'} onChange={event=>choose(event.target.value)}><option value="none">No additional requirements</option><option value="text">Text</option><option value="json_object">JSON object</option></select></label>
  {value&&<>
   <div className="agent-fields"><label>Maximum answer bytes<input type="number" required min={1} max={128000} value={value.max_bytes} onChange={event=>onChange({...value,max_bytes:Number(event.target.value)})}/></label>
   <label>Maximum answer lines (optional)<input type="number" min={1} max={1000} value={value.max_lines??''} onChange={event=>onChange({...value,max_lines:event.target.value===''?null:Number(event.target.value)})}/></label></div>
   <label>Answer instructions (optional)<textarea aria-label="Answer instructions (optional)" maxLength={8000} rows={2} value={value.instructions} onChange={event=>onChange({...value,instructions:event.target.value})}/></label>
   {value.format==='json_object'&&<>
    <label>JSON schema (optional)<textarea aria-label="JSON schema (optional)" ref={schemaField} rows={7} spellCheck={false} disabled={!schemaAvailable} value={draft} aria-invalid={!!issue} onChange={event=>{
     const text=event.target.value;setDraft(text);
     try{const schema=parseSchemaDraft(text);accepted.current=schema;event.target.setCustomValidity('');setIssue('');onChange({...value,output_schema:schema});}
     catch(error){const message=error instanceof Error?error.message:'Check the JSON schema.';setIssue(message);event.target.setCustomValidity(message);}
    }}/></label>
    {!schemaAvailable&&<p>This server does not support JSON schemas.</p>}
    <p>The server validates schema fields and values. An invalid answer stops execution; it is not automatically rewritten.</p>
   </>}
   <p>Output requirements do not establish factual accuracy. The host’s existing answer limits still apply.</p>
  </>}
  {issue&&<p role="alert">{issue}</p>}
 </fieldset>;
}
