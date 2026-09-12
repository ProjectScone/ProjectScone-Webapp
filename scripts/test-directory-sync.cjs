// Shipped UI at a controlled HTTP boundary for faults and permission edges.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright'),contract=require('../tests/fixtures/http-capabilities.json');
let browser;
before(async()=>{browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});});
after(async()=>{await browser?.close();});
const stamp='2026-09-12T12:00:00+00:00',digest='a'.repeat(64),cursor='c'.repeat(64)+':'+ 'd'.repeat(64);
function run(id='scan'){return {record:{run_id:id,space:'alpha',spec:{collection_id:'notes',configuration:digest,delete_missing:false,deadline_s:300,max_attempts:3},created_at:stamp,revision:1,attempt:1,status:'running',last_started_at:stamp,cancel_requested_at:null,finished_at:null,error_code:null,collection_instance:null,source_count:0,issue_count:0,outcome_count:0,skipped:0},status:'running',active_local:true,active_elsewhere:false,outcome_unknown:false};}
function completed(id='scan'){const value=run(id);return {...value,record:{...value.record,status:'completed',finished_at:stamp,collection_instance:'b'.repeat(32)},status:'completed',active_local:false};}
async function fixture(t,changes={}){
 const state={supported:true,allowDelete:false,loseAdmission:false,refuseStart:false,unchangedControl:false,foreignResults:false,foreignOwner:false,rows:[],...changes},requests=[];
 const html=fs.readFileSync(path.join(__dirname,'../dist/console.html'),'utf8').replaceAll('__SCONE_TOKEN__','directory-fixture');
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');if(url.pathname==='/memory'){res.setHeader('content-type','text/html');return res.end(html);}if(url.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
  let text='';for await(const part of req)text+=part;const body=text?JSON.parse(text):undefined;requests.push({path:url.pathname,method:req.method,body,after:url.searchParams.get('after')});
  assert.equal(req.headers.authorization,'Bearer directory-fixture');res.setHeader('content-type','application/json');const send=value=>res.end(JSON.stringify(value));
  if(url.pathname==='/v1/capabilities')return send({...contract.rust,features:{...contract.rust.features,'documents.sync':state.supported,'documents.files':false,'episodes.attachments':false}});
  if(url.pathname==='/v1/status')return send({space:'alpha',episodes:0});
  if(url.pathname==='/v1/sources')return send({items:[],has_more:false,next_before:null});
  if(url.pathname==='/v1/sync-collections')return send({items:[{collection_id:'notes',label:'Notes\ud800',allow_delete_missing:state.allowDelete,configuration:digest}]});
  if(url.pathname==='/v1/sync-runs'&&req.method==='POST'){
   if(state.refuseStart){res.statusCode=409;return send({error:'sync_configuration_changed',code:'sync_configuration_changed'});}
   const value=completed(body.run_id);value.record.spec.delete_missing=body.delete_missing;if(!state.rows.some(row=>row.record.run_id===body.run_id))state.rows.push(value);
   if(state.loseAdmission){res.statusCode=202;return res.end('{');}res.statusCode=202;return send(value);
  }
  if(url.pathname==='/v1/sync-runs')return send({items:url.searchParams.has('after')?state.rows.slice(20):state.rows.slice(0,20),next_after:!url.searchParams.has('after')&&state.rows.length>20?cursor:null});
  const match=url.pathname.match(/^\/v1\/sync-runs\/([^/]+)(?:\/(result|resume|cancel))?$/);
  if(match){const value=state.rows.find(row=>row.record.run_id===match[1]);if(!value){res.statusCode=404;return send({error:'sync_not_found'});}
   if(match[2]==='result')return send({space:state.foreignResults?'beta':'alpha',run_id:value.record.run_id,items:[],next_after:null});
   if(match[2]==='cancel'||match[2]==='resume'){res.statusCode=202;return send(value);}
   return send(value);
  }
  res.statusCode=404;send({});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
 await page.goto(`http://127.0.0.1:${server.address().port}/memory#documents`);
 const panel=page.getByRole('region',{name:'Local directory synchronization'});
 if(state.supported){await panel.waitFor();await panel.getByText('Loading sync history…',{exact:true}).waitFor({state:'hidden'});await panel.getByText('Loading collections…',{exact:true}).waitFor({state:'hidden'});}
 return {page,panel,state,requests};
}
test('unsupported sync hosts are never probed',async t=>{
 const {page,requests}=await fixture(t,{supported:false});await page.getByRole('button',{name:'Refresh sources',exact:true}).waitFor();assert.equal(requests.some(value=>value.path.startsWith('/v1/sync')),false);
});
test('uncertain admission retains exact identity and checks without reissuing writes',async t=>{
 const {panel,requests}=await fixture(t,{loseAdmission:true});assert.equal(await panel.getByRole('checkbox').count(),0);
 await panel.getByRole('button',{name:'Start directory sync',exact:true}).click();await panel.getByRole('button',{name:'Check saved run',exact:true}).waitFor();await panel.getByRole('alert').waitFor();
 const writes=()=>requests.filter(value=>value.method==='POST');assert.equal(writes().length,1);const id=writes()[0].body.run_id;
 assert.equal(writes()[0].body.expected_configuration,digest);assert.equal(writes()[0].body.delete_missing,false);
 await panel.getByRole('button',{name:'Check saved run',exact:true}).click();await panel.getByText(`Run ${id} acknowledged. Completed.`,{exact:true}).waitFor();assert.equal(writes().length,1);assert.equal(await panel.locator('.sync-pending').count(),0);
});
test('stale configuration refuses admission and retries only the same explicit intent',async t=>{
 const {panel,state,requests}=await fixture(t,{refuseStart:true,allowDelete:true});await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Start directory sync',exact:true}).click();await panel.getByRole('alert').getByText('sync_configuration_changed',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Check saved run',exact:true}).click();await panel.getByRole('button',{name:'Retry same run',exact:true}).waitFor();state.refuseStart=false;
 await panel.getByRole('button',{name:'Retry same run',exact:true}).click();await panel.locator('.sync-pending').waitFor({state:'hidden'});
 const writes=requests.filter(value=>value.method==='POST');assert.equal(writes.length,2);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(writes[1].body.delete_missing,true);
});
for(const action of ['cancel','resume'])test(`unchanged ${action} response is refused without a false acknowledgement`,async t=>{
 const value=run();if(action==='resume'){value.active_local=false;value.outcome_unknown=true;value.status='interrupted';}
 const {panel}=await fixture(t,{rows:[value]});await panel.getByRole('button',{name:(action==='cancel'?'Cancel ':'Resume ')+'scan',exact:true}).click();await panel.getByRole('alert').getByText('The server returned inconsistent directory sync details.',{exact:true}).waitFor();
 assert.equal(await panel.getByText(/Cancellation requested for|Resume acknowledged for/).count(),0);
});
test('foreign process ownership offers inspection without local resume or cancel',async t=>{
 const value={...run(),active_local:false,active_elsewhere:true};const {panel,requests}=await fixture(t,{rows:[value]});await panel.getByText('Running · Owned by another server process',{exact:true}).waitFor();
 assert.equal(await panel.getByRole('button',{name:'Cancel scan',exact:true}).count(),0);assert.equal(await panel.getByRole('button',{name:'Resume scan',exact:true}).count(),0);assert.equal(requests.some(value=>value.method==='POST'),false);
});
test('history cursor navigation preserves stable pages and rejects foreign result envelopes',async t=>{
 const {panel,requests}=await fixture(t,{rows:Array.from({length:21},(_,index)=>completed('run-'+index)),foreignResults:true});assert.equal(await panel.locator('.sync-run').count(),20);
 await panel.getByRole('button',{name:'More runs',exact:true}).click();await panel.locator('.sync-run code').getByText('run-20',{exact:true}).waitFor();assert.equal(await panel.locator('.sync-run').count(),1);assert(requests.some(value=>value.after===cursor));
 await panel.getByRole('button',{name:'Inspect results for run-20',exact:true}).click();const results=panel.getByRole('region',{name:'Historical sync results'});await results.getByRole('alert').waitFor();assert.equal(await results.getByText('This scan recorded no source outcomes or issues.',{exact:true}).count(),0);
 await panel.getByRole('button',{name:'Previous runs',exact:true}).click();await panel.locator('.sync-run code').getByText('run-0',{exact:true}).waitFor();assert.equal(await panel.locator('.sync-run').count(),20);
});
