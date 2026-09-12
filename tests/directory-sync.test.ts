import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displaySyncPath,parseSyncCollections,parseSyncRun,parseSyncHistory,parseSyncResults,canResumeSync,canCancelSync,startSync,controlSync,readSyncHistory} from '../src/memory/directory-sync.ts';
import {parseCapabilities,FEATURE_KEYS} from '../src/capabilities.ts';

const digest='a'.repeat(64),stamp='2026-09-12T12:00:00+00:00';
const collection=()=>({collection_id:'notes',label:'Local notes',allow_delete_missing:false,configuration:digest});
const raw=()=>({record:{run_id:'sync-one',space:'alpha',spec:{collection_id:'notes',configuration:digest,delete_missing:false,deadline_s:300,max_attempts:3},created_at:stamp,revision:1,attempt:1,status:'running',last_started_at:stamp,cancel_requested_at:null,finished_at:null,error_code:null,collection_instance:null,source_count:0,issue_count:0,outcome_count:0,skipped:0},status:'running',active_local:true,active_elsewhere:false,outcome_unknown:false});
const terminal=()=>{const value=raw();return {...value,record:{...value.record,status:'partial',finished_at:stamp,collection_instance:'b'.repeat(32),source_count:1,issue_count:1,outcome_count:2},status:'partial',active_local:false};};

test('directory capability is optional, explicit and boolean',()=>{
 const base={schema_version:1,implementation:'native',features:Object.fromEntries(FEATURE_KEYS.map(key=>[key,true]))};
 assert.equal(parseCapabilities(base).features['documents.sync'],false);
 assert.equal(parseCapabilities({...base,features:{...base.features,'documents.sync':true}}).features['documents.sync'],true);
 assert.throws(()=>parseCapabilities({...base,features:{...base.features,'documents.sync':'yes'}}));
});
test('collection discovery validates identity, deletion policy and duplicate IDs',()=>{
 assert.equal(parseSyncCollections({items:[collection()]}).at(0)?.label,'Local notes');
 for(const changed of [{allow_delete_missing:1},{configuration:'x'},{collection_id:'a/b'},{label:''}])assert.throws(()=>parseSyncCollections({items:[{...collection(),...changed}]}));
 assert.throws(()=>parseSyncCollections({items:[collection(),collection()]}));
});
test('run decoder rejects foreign identities and inconsistent counts or control state',()=>{
 const value=raw();assert.equal(parseSyncRun(value,'alpha','sync-one').id,'sync-one');
 for(const changed of [{space:'beta'},{run_id:'other'},{revision:0},{attempt:true},{attempt:4},{source_count:1},{status:'completed'},{created_at:'tomorrow'}])assert.throws(()=>parseSyncRun({...value,record:{...value.record,...changed}},'alpha','sync-one'));
 for(const changed of [{active_elsewhere:true},{outcome_unknown:true},{status:'completed'},{active_local:'yes'}])assert.throws(()=>parseSyncRun({...value,...changed},'alpha'));
 const complete=parseSyncRun(terminal(),'alpha');assert.equal(complete.outcomeCount,2);assert.equal(canResumeSync(complete,[collection()]),false);assert.equal(canCancelSync(complete),false);
});
test('explicit resume requires idle ownership, budget and unchanged configured collection',()=>{
 const value=raw(),idle=parseSyncRun({...value,status:'interrupted',active_local:false,outcome_unknown:true},'alpha');
 assert.equal(canResumeSync(idle,[collection()]),true);
 assert.equal(canResumeSync(idle,[]),false);assert.equal(canResumeSync(idle,[{...collection(),configuration:'c'.repeat(64)}]),false);
 assert.equal(canResumeSync({...idle,attempt:3},[collection()]),false);
 const foreign=parseSyncRun({...value,active_local:false,active_elsewhere:true},'alpha');
 assert.equal(canResumeSync(foreign,[collection()]),false);assert.equal(canCancelSync(foreign),false);
 assert.equal(canCancelSync(parseSyncRun(value,'alpha')),true);
});
test('history rejects duplicate rows and nonadvancing cursors',()=>{
 const cursor='a'.repeat(64)+':'+ 'b'.repeat(64);
 assert.equal(parseSyncHistory({items:[raw()],next_after:cursor},'alpha').nextAfter,cursor);
 for(const page of [{items:[raw(),raw()],next_after:null},{items:[],next_after:cursor},{items:[raw()],next_after:'junk'}])assert.throws(()=>parseSyncHistory(page,'alpha'));
 assert.throws(()=>parseSyncHistory({items:[raw()],next_after:cursor},'alpha',cursor));
});
test('outcome pages preserve source receipts and escaped diagnostics with exact ordering',()=>{
 const run=parseSyncRun(terminal(),'alpha');
 const binding={space:'alpha',run_id:run.id};
 const source={index:0,source:{path:'\uFEFFnotes/😀.txt',status:'added',episode_id:2,previous_episode_id:null,code:null},issue:null};
 const issue={index:1,source:null,issue:{path:'"bad\\udcff"',path_escaped:true,code:'invalid_path'}};
 const page=parseSyncResults({...binding,items:[source,issue],next_after:null},run);
 assert.equal(page.items[0]?.source?.path,'\uFEFFnotes/😀.txt');assert.equal(page.items[1]?.issue?.pathEscaped,true);
 for(const changed of [{path:'../outside'},{path:'/outside'},{path:'x\\y'},{status:'updated'},{episode_id:Number.MAX_SAFE_INTEGER+1},{status:'deleted'},{code:'unexpected'}])assert.throws(()=>parseSyncResults({...binding,items:[{...source,source:{...source.source,...changed}},issue],next_after:null},run));
 for(const page of [{items:[issue,source],next_after:null},{items:[source],next_after:null},{items:[source,issue],next_after:1},{items:[{...source,issue:issue.issue},issue],next_after:null}])assert.throws(()=>parseSyncResults({...binding,...page},run));
 assert.equal(parseSyncResults({...binding,items:[issue],next_after:null},run,0).items.length,1);
});
test('admission binds selected configuration and immutable intent without automatic retries',async()=>{
 const calls:{path:string;options?:RequestInit}[]=[];
 const api={request:async<T>(path:string,options?:RequestInit):Promise<T>=>{calls.push({path,options});return raw() as T;}};
 const selected=collection(),signal=new AbortController().signal;
 await startSync(api,'alpha','sync-one',selected,false,signal);
 assert.deepEqual(JSON.parse(String(calls[0]?.options?.body)),{run_id:'sync-one',collection_id:'notes',delete_missing:false,expected_configuration:digest});
 assert.equal(calls[0]?.options?.cache,'no-store');
 await assert.rejects(()=>startSync(api,'alpha','sync-one',{...selected,configuration:'b'.repeat(64)},false,signal),/match/);
 const before=calls.length;await assert.rejects(()=>startSync(api,'alpha','sync-one',selected,true,signal));assert.equal(calls.length,before);
 await assert.rejects(()=>controlSync(api,parseSyncRun(raw(),'alpha'),'cancel',signal));
 assert.deepEqual(JSON.parse(String(calls.at(-1)?.options?.body)),{expected_revision:1});
});
test('history reads are passive and bind every row to authenticated space',async()=>{
 const calls:string[]=[];const signal=new AbortController().signal;
 const api={request:async<T>(path:string):Promise<T>=>{calls.push(path);return (path==='/v1/status'?{space:'alpha'}:{items:[raw()],next_after:null}) as T;}};
 assert.equal((await readSyncHistory(api,signal)).space,'alpha');
 assert.deepEqual(calls.sort(),['/v1/status','/v1/sync-runs?limit=20']);
});

test('controls refuse an unchanged acknowledgement and changed immutable run limits',async()=>{
 const run=parseSyncRun(raw(),'alpha'),signal=new AbortController().signal;
 const unchanged={request:async<T>():Promise<T>=>raw() as T};
 await assert.rejects(()=>controlSync(unchanged,run,'cancel',signal));
 const value=raw(),idle=parseSyncRun({...value,status:'interrupted',active_local:false,outcome_unknown:true},'alpha');
 await assert.rejects(()=>controlSync(unchanged,idle,'resume',signal));
 const accepted={...raw(),record:{...raw().record,revision:2,cancel_requested_at:stamp}};
 const api={request:async<T>():Promise<T>=>accepted as T};
 assert.equal((await controlSync(api,run,'cancel',signal)).cancelRequested,true);
 accepted.record.spec.deadline_s=100;
 await assert.rejects(()=>controlSync(api,run,'cancel',signal));
});
test('results require the exact space and run envelope and reject failed completed receipts',()=>{
 const run=parseSyncRun(terminal(),'alpha'),item={index:0,source:{path:'note.txt',status:'added',episode_id:1,previous_episode_id:null,code:null},issue:null};
 const issue={index:1,source:null,issue:{path:'bad',path_escaped:false,code:'invalid_path'}};
 for(const binding of [{space:'beta',run_id:run.id},{space:'alpha',run_id:'other'},{space:undefined,run_id:undefined}])assert.throws(()=>parseSyncResults({...binding,items:[item,issue],next_after:null},run));
 const complete={...run,status:'completed' as const,issueCount:0,sourceCount:1,outcomeCount:1};
 assert.throws(()=>parseSyncResults({space:'alpha',run_id:run.id,items:[{...item,source:{...item.source,status:'failed',episode_id:null,code:'parse_failed'}}],next_after:null},complete));
});
test('collection labels with filesystem-style Unicode diagnostics remain displayable',()=>{
 const items=parseSyncCollections({items:[{...collection(),label:'Notes\ud800'}]});assert.match(items[0].label,/\\ud800/);
});

test('bidi controls are visible in labels and filename displays without changing source identity',()=>{
 for(const code of [0x61c,0x200e,0x200f,0x202a,0x202b,0x202c,0x202d,0x202e,0x2066,0x2067,0x2068,0x2069]){
  const control=String.fromCharCode(code),path=`report${control}gnp.exe`,escaped='\\u'+code.toString(16).padStart(4,'0');
  assert.deepEqual(displaySyncPath(path),{text:`"report${escaped}gnp.exe"`,escaped:true});
  const label=parseSyncCollections({items:[{...collection(),label:path}]}).at(0)?.label;
  assert.equal(label,`Escaped label: "report${escaped}gnp.exe"`);
  const run={...parseSyncRun(terminal(),'alpha'),status:'completed' as const,sourceCount:1,issueCount:0,outcomeCount:1};
  const result=parseSyncResults({space:'alpha',run_id:run.id,items:[{index:0,source:{path,status:'added',episode_id:1,previous_episode_id:null,code:null},issue:null}],next_after:null},run);
  assert.equal(result.items[0].source?.path,path);
 }
 assert.deepEqual(displaySyncPath('ملاحظات/😀.txt'),{text:'ملاحظات/😀.txt',escaped:false});
 assert.deepEqual(displaySyncPath('line\nname'),{text:'"line\\nname"',escaped:true});
});
