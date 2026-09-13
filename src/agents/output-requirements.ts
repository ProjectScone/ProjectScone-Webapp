import type {WorkflowPlan} from './plans';

type JsonValue=null|boolean|number|string|readonly JsonValue[]|{readonly [key:string]:JsonValue};
export interface OutputRequirements {
 instructions:string;max_bytes:number;max_lines:number|null;format:'text'|'json_object';
 output_schema?:Readonly<Record<string,JsonValue>>;
}
const encoder=new TextEncoder();
function fail(message:string):never{throw Error(message);}
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Output requirements and schemas must be objects.');
 return value as Record<string,unknown>;
}
function unicode(value:string):void{
 for(let i=0;i<value.length;i++){
  const code=value.charCodeAt(i);
  if(code>=0xD800&&code<=0xDBFF){
   const next=value.charCodeAt(++i);
   if(!(next>=0xDC00&&next<=0xDFFF))fail('Use valid Unicode text.');
  }else if(code>=0xDC00&&code<=0xDFFF)fail('Use valid Unicode text.');
 }
}
function integer(value:unknown,max:number):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>max)fail(`Use a whole number between 1 and ${max.toLocaleString()}.`);
 return value;
}
function schemaSnapshot(value:unknown):Readonly<Record<string,JsonValue>>{
 object(value);let nodes=0,bytes=0;
 const charge=(size:number)=>{bytes+=size;if(bytes>32768)fail('The schema must fit within 32,768 UTF-8 bytes.');};
 const string=(text:string)=>{if(text.length>32768)fail('The schema is too large.');unicode(text);charge(encoder.encode(JSON.stringify(text)).length);};
 const visit=(item:unknown,depth:number):JsonValue=>{
  if(++nodes>4096||depth>32)fail('The schema exceeds its nesting or size limit.');
  if(item===null||typeof item==='boolean'){charge(JSON.stringify(item).length);return item;}
  if(typeof item==='string'){string(item);return item;}
  if(typeof item==='number'){
   if(!Number.isFinite(item)||(Number.isInteger(item)&&!Number.isSafeInteger(item)))fail('This schema contains a number the console cannot preserve exactly.');
   charge(JSON.stringify(item).length);return item;
  }
  if(Array.isArray(item)){charge(2+Math.max(0,item.length-1));return Object.freeze(item.map(child=>visit(child,depth+1)));}
  const entries=Object.entries(object(item));charge(2+Math.max(0,entries.length-1));
  return Object.freeze(Object.fromEntries(entries.map(([key,child])=>{string(key);charge(1);return [key,visit(child,depth+1)];})));
 };
 return visit(value,0) as Readonly<Record<string,JsonValue>>;
}
export function parseOutputRequirements(value:unknown):OutputRequirements{
 const row=object(value);
 if(Object.keys(row).some(key=>!['instructions','max_bytes','max_lines','format','output_schema'].includes(key)))fail('Unknown output requirement field.');
 const instructions=row.instructions===undefined?'':row.instructions;
 if(typeof instructions!=='string'||instructions.length>8000)fail('Answer instructions must fit within 8,000 UTF-8 bytes.');
 unicode(instructions);if(encoder.encode(instructions).length>8000)fail('Answer instructions must fit within 8,000 UTF-8 bytes.');
 const format=row.format===undefined?'text':row.format;if(format!=='text'&&format!=='json_object')fail('Choose text or a JSON object.');
 const result:OutputRequirements={instructions,max_bytes:integer(row.max_bytes===undefined?64000:row.max_bytes,128000),max_lines:row.max_lines==null?null:integer(row.max_lines,1000),format};
 if(row.output_schema!=null){if(format!=='json_object')fail('Schemas require JSON-object output.');result.output_schema=schemaSnapshot(row.output_schema);}
 return result;
}
function decimalIdentity(text:string):string{
 const [mantissa,exponent='0']=text.toLowerCase().split('e');
 const fraction=mantissa.split('.')[1]?.length??0;
 const digits=mantissa.replace(/[-.]/g,'').replace(/^0+/,'');
 if(!digits)return '0';
 const significant=digits.replace(/0+$/,'');
 return `${mantissa.startsWith('-')?'-':''}${significant}e${Number(exponent)-fraction+digits.length-significant.length}`;
}
export function parseSchemaDraft(text:string):Readonly<Record<string,JsonValue>>|undefined{
 if(!text.trim())return undefined;
 if(encoder.encode(text).length>128000)fail('The schema draft is too large.');
 let parsed:unknown;try{parsed=JSON.parse(text);}catch{fail('Enter a valid JSON schema object.');}
 // JSON syntax is already checked. Check source keys because JSON.parse hides duplicates.
 const stack:(Set<string>|null)[]=[],expectKey:boolean[]=[];
 for(const match of text.matchAll(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/g)){
  const token=match[0],index=stack.length-1;
  if(/^-?\d/.test(token)){
   const number=Number(token);
   if(!Number.isFinite(number)||decimalIdentity(token)!==decimalIdentity(JSON.stringify(number)))fail('This schema draft contains a number the console cannot preserve exactly.');
  }
  else if(token==='{'){stack.push(new Set());expectKey.push(true);}
  else if(token==='['){stack.push(null);expectKey.push(false);}
  else if(token==='}'||token===']'){stack.pop();expectKey.pop();}
  else if(token===','){if(stack[index])expectKey[index]=true;}
  else if(token===':')expectKey[index]=false;
  else if(stack[index]&&expectKey[index]){const key=JSON.parse(token) as string;if(stack[index]!.has(key))fail('Schema objects must not contain duplicate keys.');stack[index]!.add(key);expectKey[index]=false;}
 }
 return schemaSnapshot(parsed);
}
export function requireOutputCapabilities(plan:WorkflowPlan,requirements:boolean,schema:boolean):void{
 if('agents' in plan)return;
 for(const task of plan.tasks){
  if('kind' in task||!task.answer_requirements)continue;
  if(!requirements)fail('This server does not support task output requirements.');
  if(task.answer_requirements.output_schema&&!schema)fail('This server does not support task output schemas.');
 }
}
