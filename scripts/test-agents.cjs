// Packaged workflow editor against a controlled local HTTP boundary.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');
const contract=require('../tests/fixtures/http-capabilities.json');let browser;
before(async()=>{browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});});
after(async()=>{await browser?.close();});
async function fixture(t,{mobile=false,supported=true,paged=false}={}){
 const html=fs.readFileSync(path.resolve(__dirname,'../dist/console.html'),'utf8').replaceAll('__SCONE_TOKEN__','agent-fixture');
 const state={saved:null,forged:false,hold:null,pageStarted:false,conflict:false};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/agents'){res.setHeader('content-type','text/html');return res.end(html);}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  assert.equal(req.headers.authorization,'Bearer agent-fixture');res.setHeader('content-type','application/json');
  const send=value=>res.end(JSON.stringify(value));
  if(url.pathname==='/v1/status')return send({space:'alpha',episodes:0});
  if(url.pathname==='/v1/capabilities')return send({...contract.python,features:{...contract.python.features,'agents.catalog':supported,'agents.plans':supported}});
  if(url.pathname==='/v1/agents/catalog')return send({agents:[{agent_id:'research',default_model:'fast',models:[{model_id:'fast',label:'Fast local',revision:'1'},{model_id:'careful',label:'Careful local',revision:'1'}]}]});
  if(url.pathname==='/v1/agent-plans'){
   if(url.searchParams.has('after')){state.pageStarted=true;if(state.hold)await state.hold;return send({items:[],next_after:null});}
   return send({items:state.saved?[state.saved]:[],next_after:paged?'a'.repeat(64)+':'+'b'.repeat(64):null});
  }
  if(url.pathname==='/v1/agent-plans/report'&&req.method==='PUT'){
   let raw='';for await(const part of req)raw+=part;
   const body=JSON.parse(raw);
   if(state.conflict||body.expected_revision!==(state.saved?.revision??0)){res.writeHead(409);return send({error:'conflict',code:'plan_revision_conflict'});}
   state.saved={space:'alpha',revision:body.expected_revision+1,plan:body.plan,bindings:Object.fromEntries(body.plan.tasks.map(task=>[task.task_id,'a'.repeat(64)])),updated_at:'2026-09-11T00:00:00Z',configuration_current:true};
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
