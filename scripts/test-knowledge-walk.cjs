// Exercise the packaged walk controls against a controlled read-only graph API.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');
const contract=require('../tests/fixtures/http-capabilities.json');
const names=['Alice Chen','Bob Hart','Carol Reed','Dana Cole','Eve Park'];
const nodes=names.map((label,index)=>({id:`ent:${index}`,key:label.toLowerCase(),label,kind:'person',kind_status:'known',claims:2}));
const relations=[[0,1],[1,2],[3,0],[4,3]].map(([a,b],index)=>({id:`rel:${index}`,subject_id:`ent:${a}`,object_id:`ent:${b}`,predicate:'knows',fact_ids:[index+1],support:{facts:1}}));
function graph(params){
 const seeded=params.has('seed'),direction=params.get('direction')||'both',hops=params.has('hops')?Number(params.get('hops')):null;
 const levels=direction==='out'?[0,1,2,null,null]:direction==='in'?[0,null,null,1,2]:[0,1,2,1,2];
 const entities=nodes.filter((_,i)=>!seeded||(levels[i]!==null&&(hops===null||levels[i]<=hops))).map(node=>({...node,...(seeded?{hop:levels[Number(node.id.slice(4))]}:{})}));
 const ids=new Set(entities.map(node=>node.id)),shown=relations.filter(relation=>ids.has(relation.subject_id)&&ids.has(relation.object_id));
 return {schema_version:1,space:'walk-test',projection:{version:'fixture',classifier:'fixture',kinds:'fixture',id_scheme:'fixture',digest:'fixture',revision:1},filters:{status:'current',as_of:'2026-09-11T12:00:00.000Z',...(seeded?{seeds:params.getAll('seed'),hub_degree:Number(params.get('hub_degree')),direction,hops}:{})},entities,relations:shown,attributes:[],coverage:{facts_read:4,facts_counted:4,facts_limit:50000,entities_total:5,entities_shown:entities.length,relations_total:4,relations_shown:shown.length,attributes_total:0,attributes_shown:0,truncated:entities.length<5,reasons:entities.length<5?['outside_walk']:[]}};
}
test('packaged graph walks bind direction, depth, response evidence and cancellation',async t=>{
 const browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});
 const html=fs.readFileSync(path.resolve(__dirname,'../dist/console.html'),'utf8').replaceAll('__SCONE_TOKEN__','walk-fixture');
 let capability=true,mutate=null,hold=null,arrive=null;const reads=[],writes=[],errors=[];
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/memory'){res.setHeader('content-type','text/html');return res.end(html);}
  if(url.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
  if(req.method!=='GET')writes.push(req.method+' '+url.pathname);
  res.setHeader('content-type','application/json');
  if(req.headers.authorization!=='Bearer walk-fixture'){res.statusCode=401;return res.end('{}');}
  if(url.pathname==='/v1/status')return res.end(JSON.stringify({space:'walk-test',episodes:4}));
  if(url.pathname==='/v1/capabilities')return res.end(JSON.stringify({...contract.rust,features:{...contract.rust.features,'graph.knowledge':true,'graph.knowledge_seeds':true,...(capability===undefined?{}:{'graph.knowledge_walk':capability})}}));
  if(url.pathname==='/v1/graph/knowledge'){
   const value=graph(url.searchParams);
   if(url.searchParams.has('seed')){reads.push(url);mutate?.(value);arrive?.();if(hold)await hold;}
   return res.end(JSON.stringify(value));
  }
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const open=async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/memory#knowledge`);await page.getByText('Explore around entities',{exact:true}).click();
  const panel=page.getByRole('region',{name:'Connected neighborhood',exact:true});await panel.getByRole('combobox',{name:/^Add starting entity/}).selectOption('ent:0');return {page,panel};
 };
 const {page,panel}=await open();assert.equal(reads.length,0);
 await panel.getByLabel('Follow connections').selectOption('in');await panel.getByLabel('Step limit').selectOption('2');await panel.getByRole('button',{name:'Explore neighborhood',exact:true}).click();
 await panel.locator('.knowledge-neighborhood-map').waitFor();assert.deepEqual(await panel.locator('.knowledge-neighborhood-directory strong').allTextContents(),['Alice Chen','Dana Cole','Eve Park']);
 assert.match(await panel.getByRole('list',{name:'Neighborhood entities'}).innerText(),/2 steps from start/);assert.equal(reads.at(-1).searchParams.get('direction'),'in');assert.equal(reads.at(-1).searchParams.get('hops'),'2');
 let release;hold=new Promise(resolve=>release=resolve);const began=new Promise(resolve=>arrive=resolve);
 await panel.getByLabel('Follow connections').selectOption('out');await panel.getByRole('button',{name:'Explore neighborhood',exact:true}).click();await began;
 await panel.getByLabel('Step limit').selectOption('1');release();hold=null;arrive=null;
 await panel.getByRole('button',{name:'Explore neighborhood',exact:true}).waitFor({state:'visible'});assert.equal(await panel.locator('.knowledge-neighborhood-map').count(),0);
 await panel.getByRole('button',{name:'Explore neighborhood',exact:true}).click();await panel.locator('.knowledge-neighborhood-map').waitFor();assert.deepEqual(await panel.locator('.knowledge-neighborhood-directory strong').allTextContents(),['Alice Chen','Bob Hart']);
 for(const change of [value=>value.filters.direction='in',value=>value.filters.hops=8,value=>value.entities[1].hop=0]){
  mutate=change;await panel.getByRole('button',{name:'Explore neighborhood',exact:true}).click();await panel.getByRole('alert').waitFor();assert.equal(await panel.locator('.knowledge-neighborhood-map').count(),0);
 }
 mutate=null;await page.close();
 for(const flag of [false,undefined]){
  capability=flag;const {page, panel}=await open();assert.equal(await panel.getByLabel('Follow connections').count(),0);assert.equal(await panel.getByLabel('Step limit').count(),0);
  await panel.getByRole('button',{name:'Explore neighborhood',exact:true}).click();await panel.locator('.knowledge-neighborhood-map').waitFor();assert.equal(reads.at(-1).searchParams.has('direction'),false);assert.equal(reads.at(-1).searchParams.has('hops'),false);assert.equal(await panel.locator('.knowledge-neighborhood-directory li').count(),5);await page.close();
 }
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
