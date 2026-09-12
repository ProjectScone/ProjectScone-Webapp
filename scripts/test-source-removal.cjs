// Packaged source removal against a controlled local HTTP boundary.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');
const contract=require('../tests/fixtures/http-capabilities.json');
let browser;
before(async()=>{browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});});
after(async()=>{await browser?.close();});
async function fixture(t,{mobile=false,supported=true,space='alpha',initial='present'}={}){
 const html=fs.readFileSync(path.resolve(__dirname,'../dist/console.html'),'utf8').replaceAll('__SCONE_TOKEN__','removal-fixture');
 const requests=[],state={status:initial,mode:'normal',hold:null,badReceipt:false,badImpact:false};
 const impact={episode_id:7,chunks:3,attachments_released:['a'.repeat(64)],attachments_kept:['b'.repeat(64)],facts_citing:Array.from({length:25},(_,i)=>i+1),links_citing:[40],forgotten_at:null};
 const time='2026-09-11T21:00:00Z';
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname.startsWith('/memory')){res.setHeader('content-type','text/html');return res.end(html);}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  requests.push({path:url.pathname,method:req.method});assert.equal(req.headers.authorization,'Bearer removal-fixture');res.setHeader('content-type','application/json');
  const send=data=>res.end(JSON.stringify(data));
  if(url.pathname==='/v1/status')return send({space,episodes:1});
  if(url.pathname==='/v1/capabilities')return send({...contract.python,features:{...contract.python.features,'episodes.read':true,'episodes.forget':supported}});
  if(url.pathname==='/v1/episodes/7/forget-status'){
   if(state.hold)await state.hold;
   return send({episode_id:7,state:state.status,impact:state.status==='pending'?impact:null,requested_at:state.status==='pending'?time:null,forgotten_at:state.status==='forgotten'?time:null});
  }
  if(url.pathname==='/v1/episodes/7'&&req.method==='DELETE'){
   if(state.mode==='denied'){res.writeHead(403);return send({error:'read-only key'});}
   state.status=state.mode==='pending'?'pending':'forgotten';
   if(['pending','lost'].includes(state.mode)){res.writeHead(200);res.write('{');setTimeout(()=>res.destroy(),10);return;}
   return send({...impact,forgotten:state.badReceipt?8:7,forgotten_at:time});
  }
  if(url.pathname==='/v1/episodes/7/impact')return send({...impact,episode_id:state.badImpact?8:7});
  if(url.pathname==='/v1/episodes/7'){
   if(state.status!=='present'){res.writeHead(410);return send({error:'gone'});}
   return send({episode_id:7,kind:'file',content:'retained text',source:mobile?'report\u202egnp.txt':'Unsafe <script>not markup</script>',created_at:time});
  }
  res.writeHead(404);send({error:'unknown route'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 await page.goto(origin+'/memory/sources/7/forget?space=alpha');
 return {page,state,requests,origin};
}
const deletes=requests=>requests.filter(r=>r.method==='DELETE').length;
const confirm=async page=>{await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Remove this source',exact:true}).click();};
for(const mobile of [false,true])test(`preview, confirmation, paged retained evidence and completion, mobile=${mobile}`,async t=>{
 const {page,requests}=await fixture(t,{mobile});const button=page.getByRole('button',{name:'Remove this source',exact:true});await button.waitFor();assert.equal(await button.isDisabled(),true);assert.equal(deletes(requests),0);if(mobile)assert.equal(await page.locator('.removal-title').textContent(),'"report\\u202egnp.txt"');
 await page.getByText('Citing claims · 25',{exact:true}).click();assert.equal(await page.locator('.removal-inventory').first().locator('li').count(),20);
 await page.getByRole('button',{name:'Next citing claims'}).click();assert.equal(await page.locator('.removal-inventory').first().locator('li').count(),5);
 assert.equal(await page.locator('article script').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.SCONE_REMOVAL_SCREENSHOTS)await page.screenshot({path:`/private/tmp/scone-source-removal-${mobile?'mobile':'desktop'}.png`,fullPage:true});
 await confirm(page);await page.getByRole('heading',{name:'Source removed',exact:true}).waitFor();assert.equal(deletes(requests),1);
 await page.getByRole('region',{name:'Removal receipt'}).getByText(/Claims and links.*remain/).waitFor();
});
test('lost completion response is resolved by reads without a second DELETE',async t=>{
 const {page,state,requests}=await fixture(t);state.mode='lost';await confirm(page);await page.getByRole('heading',{name:'Removal unconfirmed'}).waitFor();assert.equal(deletes(requests),1);
 await page.getByRole('button',{name:'Check removal status'}).click();await page.getByRole('heading',{name:'Source removed',exact:true}).waitFor();assert.equal(deletes(requests),1);await page.getByText(/full receipt with counts is unavailable/).waitFor();
});
test('interrupted cleanup is observed without writes and resumes only after a fresh confirmation',async t=>{
 const {page,state,requests}=await fixture(t);state.mode='pending';await confirm(page);await page.getByRole('button',{name:'Check removal status'}).click();
 const resume=page.getByRole('button',{name:'Resume source cleanup'});await resume.waitFor();assert.equal(deletes(requests),1);assert.equal(await resume.isDisabled(),true);
 await page.reload();await resume.waitFor();assert.equal(deletes(requests),1);state.mode='normal';await page.getByRole('checkbox').check();await resume.click();await page.getByRole('heading',{name:'Source removed',exact:true}).waitFor();assert.equal(deletes(requests),2);
});
test('read-only denial keeps the connection and malformed receipt cannot claim completion',async t=>{
 const {page,state,requests}=await fixture(t);state.mode='denied';await confirm(page);await page.getByText(/Your key does not allow source removal/).waitFor();
 await page.getByRole('button',{name:'Check removal status'}).click();await page.getByRole('checkbox').waitFor();assert.equal(deletes(requests),1);
 state.mode='normal';state.badReceipt=true;await confirm(page);await page.getByRole('heading',{name:'Removal unconfirmed'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Source removed',exact:true}).count(),0);assert.equal(deletes(requests),2);
});
for(const settings of [{supported:false},{space:'bravo'}])test(`unsupported or foreign space never reads removal data: ${JSON.stringify(settings)}`,async t=>{
 const {page,requests}=await fixture(t,settings);await page.getByRole('heading',{name:'Source could not be checked'}).waitFor();assert.equal(requests.some(r=>r.path.startsWith('/v1/episodes/')),false);assert.equal(await page.getByRole('checkbox').count(),0);
});
test('obsolete source reads cannot publish controls after navigation',async t=>{
 const {page,state,requests,origin}=await fixture(t);await page.getByRole('checkbox').waitFor();let release;state.hold=new Promise(resolve=>{release=resolve;});await page.getByRole('button',{name:'Refresh impact and status'}).click();
 await page.getByRole('heading',{name:'Checking source removal…'}).waitFor();await page.goto(origin+'/memory/sources/7/forget?space=bravo');release();state.hold=null;
 await page.getByText(/different space/).waitFor();assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(deletes(requests),0);
});
