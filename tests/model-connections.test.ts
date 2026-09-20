import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseModelConnections,parseModelProbe,readModelConnections,saveModelConnection,probeModelConnection,connectionFromDraft,connectionDraft} from '../src/memory/model-connections.ts';

const config={base_url:'http://127.0.0.1:8080/v1',model:'local-model',timeout_s:180,api_key_env:null,voice:null,sample_rate:24000};
const snapshot={schema_version:1,revision:3,connections:{chat:config,extraction:null,vision:null,transcription:null,speech:null}};
test('connection snapshots preserve each explicit role and revision',()=>{
  const parsed=parseModelConnections(snapshot);
  assert.equal(parsed.connections.chat?.model,'local-model');assert.equal(parsed.connections.vision,null);assert.equal(parsed.revision,3);
  for(const invalid of [null,{}, {...snapshot,schema_version:2},{...snapshot,revision:-1},{...snapshot,connections:{chat:config}},
    {...snapshot,connections:{...snapshot.connections,vision:{...config,model:''}}},
    {...snapshot,connections:{...snapshot.connections,chat:{...config,api_key:'secret'}}},
  ])assert.throws(()=>parseModelConnections(invalid));
});
test('draft validation does not erase edits or accept credential URLs and raw keys',()=>{
  const draft=connectionDraft(config);assert.deepEqual(connectionFromDraft(draft,'chat'),config);
  for(const bad of [{...draft,base_url:'http://user:secret@localhost/v1'},{...draft,base_url:'file:///tmp/service'},
    {...draft,base_url:'http://localhost/v1?q=secret'},{...draft,model:''},{...draft,timeout_s:'0'},
    {...draft,timeout_s:'Infinity'},{...draft,api_key_env:'sk-secret-key'},
  ])assert.throws(()=>connectionFromDraft(bad,'chat'));
  assert.throws(()=>connectionFromDraft(draft,'speech'),/voice/i);
  assert.equal(connectionFromDraft({...draft,voice:'local-voice'},'speech').voice,'local-voice');
  assert.equal(draft.model,'local-model');
});
test('discovery validates the model inventory without claiming inference capability',()=>{
  assert.deepEqual(parseModelProbe({models:['local-model'],model_available:true}),{models:['local-model'],model_available:true});
  for(const invalid of [{models:'bad',model_available:true},{models:[null],model_available:false},{models:[],model_available:'true'}])assert.throws(()=>parseModelProbe(invalid));
});
test('API boundary sends revision-checked explicit writes and no implicit disconnects',async()=>{
  const calls:Array<{path:string;options?:RequestInit}>=[];
  const api={async request<T>(path:string,options?:RequestInit):Promise<T>{calls.push({path,options});return snapshot as T;}};
  const signal=new AbortController().signal;
  await readModelConnections(api,signal);
  await saveModelConnection(api,'vision',config,3,signal);
  await saveModelConnection(api,'vision',null,3,signal);
  assert.equal(calls[0].path,'/v1/model-connections');
  assert.equal(calls[1].path,'/v1/model-connections/vision');assert.equal(calls[1].options?.method,'PUT');
  assert.deepEqual(JSON.parse(String(calls[1].options?.body)),{expected_revision:3,connection:config});
  assert.deepEqual(JSON.parse(String(calls[2].options?.body)),{expected_revision:3,connection:null});
  assert.equal(calls[1].options?.signal,signal);assert.equal(calls[1].options?.redirect,'error');
});
test('discovery is an explicit models-only request and errors propagate unchanged',async()=>{
  let called=0;
  const api={async request<T>(path:string,options?:RequestInit):Promise<T>{called++;assert.equal(path,'/v1/model-connections/probe');assert.equal(options?.method,'POST');assert.deepEqual(JSON.parse(String(options?.body)),{connection:config});return {models:['local-model'],model_available:true} as T;}};
  assert.equal(called,0);await probeModelConnection(api,config,new AbortController().signal);assert.equal(called,1);
  const conflict=Object.assign(new Error('Changed elsewhere'),{status:409});
  await assert.rejects(saveModelConnection({async request(){throw conflict;}},'chat',config,3,new AbortController().signal),error=>error===conflict);
});

test('explicit cloud selection survives reads and draft saves',async()=>{
  const cloud={...config,provider:'openrouter' as const,base_url:'https://openrouter.ai/api/v1/',model:'google/gemma-4-31b-it',api_key_env:'SCONE_OPEN_ROUTER_API'};
  const value={...snapshot,connections:{...snapshot.connections,chat:cloud}};
  const parsed=parseModelConnections(value);
  assert.equal(parsed.connections.chat?.provider,'openrouter');
  assert.deepEqual(connectionFromDraft(connectionDraft(parsed.connections.chat),'chat'),cloud);
  const calls:Array<{path:string;options?:RequestInit}>=[];
  const api={async request<T>(path:string,options?:RequestInit):Promise<T>{calls.push({path,options});return value as T;}};
  await saveModelConnection(api,'chat',cloud,3,new AbortController().signal);
  assert.deepEqual(JSON.parse(String(calls[0].options?.body)),{expected_revision:3,connection:cloud});
  for(const change of [{provider:'unknown'}, {model:'google/gemma-4-31b-it:free'},
    {model:'../gemma'}, {model:'./gemma'},
    {base_url:'https://openrouter.ai.evil.test/api/v1/'}, {api_key_env:null}]){
    assert.throws(()=>parseModelConnections({...value,connections:{...value.connections,chat:{...cloud,...change}}}));
  }
  for(const role of ['extraction','vision','transcription','speech'] as const){
    assert.throws(()=>connectionFromDraft(connectionDraft(cloud),role));
    assert.throws(()=>parseModelConnections({...value,connections:{...value.connections,[role]:cloud}}));
  }
});
