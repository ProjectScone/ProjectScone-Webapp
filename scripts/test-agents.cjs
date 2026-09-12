// Packaged workflow editor against a controlled local HTTP boundary.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');
const contract=require('../tests/fixtures/http-capabilities.json');let browser;
before(async()=>{browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});});
after(async()=>{await browser?.close();});
async function fixture(t,{mobile=false,supported=true,paged=false,runs=false,maxParallel=1,handoffs=false}={}){
 const html=fs.readFileSync(path.resolve(__dirname,'../dist/console.html'),'utf8').replaceAll('__SCONE_TOKEN__','agent-fixture');
 const state={handoffCapability:handoffs,saved:null,forged:false,hold:null,pageStarted:false,conflict:false,runs:new Map(),starts:0,cancels:0,complete:true,loseStart:false,forgeResult:false,substitute:false,forgeTarget:false,forgeFinal:false};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/agents'){res.setHeader('content-type','text/html');return res.end(html);}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  assert.equal(req.headers.authorization,'Bearer agent-fixture');res.setHeader('content-type','application/json');
  const send=value=>res.end(JSON.stringify(value));
  if(url.pathname==='/v1/status')return send({space:'alpha',episodes:0});
  if(url.pathname==='/v1/capabilities')return send({...contract.python,features:{...contract.python.features,'agents.handoffs':state.handoffCapability,'agents.catalog':supported,'agents.plans':supported,'agents.runs':runs,'agents.parallel':runs&&maxParallel>1}});
  if(url.pathname==='/v1/agents/run-policy')return send({space:'alpha',max_parallel_tasks:maxParallel,max_active_runs:4});
  if(url.pathname==='/v1/agents/catalog')return send({agents:(handoffs?['research','write']:['research']).map(agent_id=>({agent_id,default_model:'fast',models:[{model_id:'fast',label:'Fast local',revision:'1'},{model_id:'careful',label:'Careful local',revision:'1'}]}))});
  if(url.pathname==='/v1/agent-plans'){
   if(url.searchParams.has('after')){state.pageStarted=true;if(state.hold)await state.hold;return send({items:[],next_after:null});}
   return send({items:state.saved?[state.saved]:[],next_after:paged?'a'.repeat(64)+':'+'b'.repeat(64):null});
  }
  if(runs&&url.pathname==='/v1/agent-runs'){
   if(req.method==='GET')return send({items:[...state.runs.values()].map(run=>run.status),next_after:null});
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);state.starts++;
   assert.equal(body.plan_revision,state.saved.revision);assert.equal(body.workflow_id,state.saved.plan.workflow_id);
   const original={space:'alpha',run_id:body.run_id,question:body.question,max_parallel:body.max_parallel??1,created_at:'2026-09-11T00:00:00Z',scope:{},exclude_session_id:null,cancel_requested_at:null,plan:structuredClone(state.saved)};delete original.plan.configuration_current;
   if(state.substitute){original.question="Different question";original.plan.plan.tasks[0].model_id="fast";original.plan.plan.tasks[0].prompt="Different task";original.plan.bindings[original.plan.plan.tasks[0].task_id]="b".repeat(64);}
   const status={space:'alpha',run_id:body.run_id,created_at:original.created_at,workflow_id:body.workflow_id,plan_revision:body.plan_revision,max_parallel:original.max_parallel,status:state.complete?'completed':'running',active_local:!state.complete,completed_steps:state.complete?(original.plan.plan.agents?(original.plan.plan.max_handoffs===0?['hop-01']:['hop-01','hop-02']):original.plan.plan.tasks.map(task=>task.task_id)):[],inflight:state.complete?null:(original.plan.plan.agents?'hop-01':original.plan.plan.tasks[0].task_id),outcome_unknown:false,error_class:null};
   state.runs.set(body.run_id,{original,status});if(state.loseStart){res.writeHead(503);return send({error:'Admission response unavailable'});}res.writeHead(202);return send(status);
  }
  if(runs&&url.pathname.startsWith('/v1/agent-runs/')){
   const parts=url.pathname.split('/'),run=state.runs.get(decodeURIComponent(parts[3]));if(!run){res.writeHead(404);return send({error:'missing'});}
   if(parts[4]==='request')return send(run.original);
   if(parts[4]==='cancel'){state.cancels++;run.status={...run.status,status:'cancelled',active_local:false,outcome_unknown:true,error_class:'CancelledError'};return send(run.status);}
   if(parts[4]==='result'&&run.original.plan.plan.agents){
    const plan=run.original.plan.plan,first=plan.agents.find(agent=>agent.agent_id===plan.root_agent),target=first.can_handoff_to[0]??null,last=plan.agents.find(agent=>agent.agent_id===target);
    const output=(agent,index)=>({task_id:`hop-0${index}`,agent_id:agent.agent_id,model_id:agent.model_id,binding:run.original.plan.bindings[agent.agent_id],depends_on:index===1?[]:['hop-01'],text:`${agent.agent_id} output`,source_status:'none',evidence_ids:[],evidence_packets:[],model_calls:1,tool_calls:0});
    const hops=[{output:output(first,1),handoff_to:state.forgeTarget?'unregistered':target}];
    if(target&&plan.max_handoffs>0)hops.push({output:output(last,2),handoff_to:null});
    const finished=hops[hops.length-1].handoff_to===null;
    return send({space:'alpha',run_id:run.status.run_id,status:finished?'completed':'handoff_limit',hops,final:finished?{...hops[hops.length-1].output,...(state.forgeFinal?{text:'Substituted final'}:{})}:null,reused_hops:[]});
   }
   if(parts[4]==='result')return send({space:'alpha',run_id:run.status.run_id,status:'completed',reused_steps:[],results:Object.fromEntries(run.original.plan.plan.tasks.map(task=>[task.task_id,{...task,binding:state.forgeResult?'b'.repeat(64):run.original.plan.bindings[task.task_id],text:'Model output <script>never execute</script>',source_status:'none',evidence_ids:[],evidence_packets:[],model_calls:1,tool_calls:0}]))});
   return send(run.status);
  }
  if(url.pathname==='/v1/agent-plans/report'&&req.method==='PUT'){
   let raw='';for await(const part of req)raw+=part;
   const body=JSON.parse(raw);
   if(state.conflict||body.expected_revision!==(state.saved?.revision??0)){res.writeHead(409);return send({error:'conflict',code:'plan_revision_conflict'});}
   state.saved={space:'alpha',revision:body.expected_revision+1,plan:body.plan,bindings:Object.fromEntries(body.plan.agents?body.plan.agents.map(agent=>[agent.agent_id,'a'.repeat(64)]):body.plan.tasks.map(task=>[task.task_id,'a'.repeat(64)])),updated_at:'2026-09-11T00:00:00Z',configuration_current:true};
   const receipt=structuredClone(state.saved);if(state.forged)receipt.plan.tasks[0].model_id='fast';return send(receipt);
  }
  res.writeHead(404);send({error:'unknown route'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1380,height:1000}});page.setDefaultTimeout(7000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
 await page.goto(`http://127.0.0.1:${server.address().port}/agents`);return {page,state};
}
async function fill(page){await page.getByLabel('Workflow identifier',{exact:true}).fill('report');await page.getByLabel('Model',{exact:true}).selectOption('careful');await page.getByLabel('Task instructions',{exact:true}).fill('Find the decisions.');}
const save=page=>page.getByRole('button',{name:'Save workflow',exact:true}).click();
for(const mobile of [false,true])test(`save explicit models and reload task dependencies, mobile=${mobile}`,async t=>{
 const {page,state}=await fixture(t,{mobile});await fill(page);
 await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Task instructions',{exact:true}).nth(1).fill('Summarize the evidence.');
 await page.getByRole('region',{name:'Task 2',exact:true}).getByLabel('task-1',{exact:true}).check();await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 assert.equal(state.saved.plan.tasks[0].model_id,'careful');assert.deepEqual(state.saved.plan.tasks[1].depends_on,['task-1']);
 await page.reload();await page.getByRole('button',{name:/report.*Revision 1/}).click();assert.equal(await page.getByLabel('Model',{exact:true}).first().inputValue(),'careful');
 assert(await page.getByRole('region',{name:'Task 2',exact:true}).getByLabel('task-1',{exact:true}).isChecked());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
});
test('a forged model acknowledgement never replaces the selected model',async t=>{
 const {page,state}=await fixture(t);await fill(page);state.forged=true;await save(page);await page.getByRole('alert').filter({hasText:'Saved response does not match'}).waitFor();
 assert.equal(await page.getByLabel('Model',{exact:true}).inputValue(),'careful');assert.equal(await page.getByText('Saved revision 1.',{exact:true}).count(),0);
});
test('conflict retains draft and switching requires explicit discard',async t=>{
 const {page,state}=await fixture(t);await fill(page);state.conflict=true;await save(page);await page.getByRole('alert').filter({hasText:'This plan changed.'}).waitFor();
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'New workflow',exact:true}).click();assert.equal(await page.getByLabel('Workflow identifier',{exact:true}).inputValue(),'report');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'New workflow',exact:true}).click();assert.equal(await page.getByLabel('Workflow identifier',{exact:true}).inputValue(),'');
});
test('a late page cannot remove a newer acknowledged save',async t=>{
 const {page,state}=await fixture(t,{paged:true});let release;state.hold=new Promise(resolve=>release=resolve);
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.waitForFunction(()=>document.querySelector('aside').textContent.includes('Loading…'));await fill(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 assert(state.pageStarted);release();await page.getByRole('button',{name:'Loading…',exact:true}).waitFor({state:'detached'});assert.equal(await page.getByRole('complementary',{name:'Saved workflows'}).locator('li').count(),1);
});
test('unavailable capability exposes no workflow write control',async t=>{
 const {page}=await fixture(t,{supported:false});await page.getByRole('heading',{name:'Workflows unavailable',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Save workflow',exact:true}).count(),0);
});

for(const mobile of [false,true])test(`run saved model choices and show original verified output, mobile=${mobile}`,async t=>{
 const {page,state}=await fixture(t,{mobile,runs:true});await fill(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 await page.getByLabel('Question',{exact:true}).fill('What happened?');const id=await page.getByLabel('Run identifier',{exact:true}).inputValue();
 await page.getByRole('button',{name:'Start run',exact:true}).click();await page.getByLabel('Verified run results').waitFor();
 assert.equal(state.starts,1);assert.equal(state.runs.get(id).original.plan.plan.tasks[0].model_id,'careful');
 await page.getByRole('button',{name:'Check status',exact:true}).click();await page.getByLabel('Verified run results').waitFor();assert.equal(state.starts,1);
 assert(await page.getByText('Model output <script>never execute</script>',{exact:true}).isVisible());
 await page.getByLabel('Task instructions',{exact:true}).fill('An unsaved change');
 assert.equal(state.runs.get(id).original.plan.plan.tasks[0].prompt,'Find the decisions.');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
});
test('lost admission response keeps ID and only performs a read on check',async t=>{
 const {page,state}=await fixture(t,{runs:true});await fill(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();state.loseStart=true;
 await page.getByLabel('Question',{exact:true}).fill('What happened?');const id=await page.getByLabel('Run identifier',{exact:true}).inputValue();await page.getByRole('button',{name:'Start run',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Check this run identifier'}).waitFor();assert.equal(await page.getByLabel('Run identifier',{exact:true}).inputValue(),id);
 await page.getByRole('button',{name:'Check submitted run',exact:true}).click();await page.getByLabel('Verified run results').waitFor();assert.equal(state.starts,1);
});
test('cancel reports unknown outcome and never resubmits the run',async t=>{
 const {page,state}=await fixture(t,{runs:true});state.complete=false;await fill(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 await page.getByLabel('Question',{exact:true}).fill('What happened?');await page.getByRole('button',{name:'Start run',exact:true}).click();await page.getByRole('button',{name:'Cancel run',exact:true}).click();
 await page.getByText(/A model call was interrupted and its outcome is unknown/).waitFor();assert.equal(state.cancels,1);assert.equal(state.starts,1);assert.equal(await page.getByLabel('Verified run results').count(),0);
});
test('mismatched result binding is withheld',async t=>{
 const {page,state}=await fixture(t,{runs:true});state.forgeResult=true;await fill(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 await page.getByLabel('Question',{exact:true}).fill('What happened?');await page.getByRole('button',{name:'Start run',exact:true}).click();await page.getByRole('alert').filter({hasText:'run response could not be verified'}).waitFor();
 assert.equal(await page.getByLabel('Verified run results').count(),0);assert.equal(state.starts,1);
});

for(const lost of [false,true])test(`submitted request substitution is withheld, lost response=${lost}`,async t=>{
 const {page,state}=await fixture(t,{runs:true});state.substitute=true;state.loseStart=lost;
 await fill(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();await page.getByLabel('Question',{exact:true}).fill('Original question');
 await page.getByRole('button',{name:'Start run',exact:true}).click();
 if(lost){await page.getByRole('alert').filter({hasText:'Check this run identifier'}).waitFor();await page.getByRole('button',{name:'Check submitted run',exact:true}).click();}
 await page.getByRole('alert').filter({hasText:'recorded run does not match the submitted'}).waitFor();
 assert.equal(await page.getByLabel('Verified run results').count(),0);assert.equal(state.starts,1);
});

test('parallel run selection follows the host ceiling and survives inspection',async t=>{
 const {page,state}=await fixture(t,{runs:true,maxParallel:2});await fill(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 const selector=page.getByLabel('Maximum simultaneous tasks',{exact:true});assert.deepEqual(await selector.locator('option').evaluateAll(options=>options.map(option=>option.value)),['1','2']);
 await selector.selectOption('2');await page.getByLabel('Question',{exact:true}).fill('Compare evidence');const id=await page.getByLabel('Run identifier',{exact:true}).inputValue();
 await page.getByRole('button',{name:'Start run',exact:true}).click();await page.getByLabel('Verified run results').waitFor();
 assert.equal(state.runs.get(id).original.max_parallel,2);await page.getByText(/Up to 2 simultaneous tasks/).waitFor();assert.equal(state.starts,1);
});

test('history refreshes after a polled run finishes',async t=>{
 const {page,state}=await fixture(t,{runs:true});state.complete=false;await fill(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 await page.getByLabel('Question',{exact:true}).fill('Track completion');const id=await page.getByLabel('Run identifier',{exact:true}).inputValue();await page.getByRole('button',{name:'Start run',exact:true}).click();await page.getByRole('button',{name:'Cancel run',exact:true}).waitFor();
 const run=state.runs.get(id);run.status={...run.status,status:'completed',active_local:false,completed_steps:['task-1'],inflight:null};
 await page.getByLabel('Verified run results').waitFor();await page.getByLabel('Run history').getByText('completed · Revision 1',{exact:true}).waitFor();assert.equal(state.starts,1);
});

async function fillHandoff(page){
 await page.getByRole('button',{name:'New handoff workflow',exact:true}).click();
 await page.getByLabel('Workflow identifier',{exact:true}).fill('report');
 await page.getByLabel('Add agent',{exact:true}).selectOption('write');
 await page.getByLabel('Model for research',{exact:true}).selectOption('careful');
 await page.getByRole('region',{name:'Handoff agent research',exact:true}).getByLabel('write',{exact:true}).check();
}
for(const mobile of [false,true])test(`handoff editor retains edges and models, mobile=${mobile}`,async t=>{
 const {page,state}=await fixture(t,{mobile,runs:true,handoffs:true,maxParallel:2});await fillHandoff(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 assert.equal(state.saved.plan.agents[0].model_id,'careful');assert.deepEqual(state.saved.plan.agents[0].can_handoff_to,['write']);
 assert.equal(await page.getByLabel('Maximum simultaneous tasks',{exact:true}).count(),0);
 await page.getByLabel('Question',{exact:true}).fill('Explain the decision');await page.getByRole('button',{name:'Start run',exact:true}).click();
 await page.getByLabel('Verified run results').waitFor();await page.getByRole('heading',{name:'hop-02 · write · fast · Final answer',exact:true}).waitFor();
 assert.equal(state.starts,1);await page.reload();await page.getByRole('button',{name:/report.*Revision 1/}).first().click();
 assert.equal(await page.getByLabel('Model for research',{exact:true}).inputValue(),'careful');
 assert(await page.getByRole('region',{name:'Handoff agent research',exact:true}).getByLabel('write',{exact:true}).isChecked());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
});
test('handoff budget exhaustion displays partial work without a final answer',async t=>{
 const {page,state}=await fixture(t,{runs:true,handoffs:true});await fillHandoff(page);await page.getByLabel('Maximum handoffs',{exact:true}).fill('0');await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 await page.getByLabel('Question',{exact:true}).fill('Explain');await page.getByRole('button',{name:'Start run',exact:true}).click();
 await page.getByText('The handoff limit was reached. These are partial results; no final answer was produced.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:/Final answer/}).count(),0);assert.equal(state.starts,1);
});
for(const forged of ['forgeTarget','forgeFinal'])test(`invalid handoff ${forged} withholds all outputs`,async t=>{
 const {page,state}=await fixture(t,{runs:true,handoffs:true});await fillHandoff(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();state[forged]=true;
 await page.getByLabel('Question',{exact:true}).fill('Explain');await page.getByRole('button',{name:'Start run',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'run response could not be verified'}).waitFor();assert.equal(await page.getByLabel('Verified run results').count(),0);assert.equal(state.starts,1);
});

test('missing handoff capability prevents execution of a saved handoff',async t=>{
 const {page,state}=await fixture(t,{runs:true,handoffs:true});await fillHandoff(page);await save(page);await page.getByText('Saved revision 1.',{exact:true}).waitFor();
 state.handoffCapability=false;await page.reload();await page.getByRole('button',{name:/report.*Revision 1/}).click();
 await page.getByText('This server does not support handoff configuration.',{exact:true}).waitFor();
 await page.getByLabel('Question',{exact:true}).fill('Explain');assert(await page.getByRole('button',{name:'Start run',exact:true}).isDisabled());assert.equal(state.starts,0);
});
