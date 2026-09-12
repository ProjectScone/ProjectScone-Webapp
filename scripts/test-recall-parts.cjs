const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.SCONE_BROWSER_ENGINE||'chromium',app=require('node:path').resolve(__dirname,'..');
const contract=require(app+'/tests/fixtures/http-capabilities.json'),{receipt}=require('../tests/fixtures/recall-parts.cjs');
for(const mobile of [false,true])test(`multi-part search preserves evidence, filters and query lifecycle, mobile=${mobile}`,async t=>{
 const browser=await engines[engine].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});
 const html=fs.readFileSync(app+'/dist/console.html','utf8').replaceAll('__SCONE_TOKEN__','parts-fixture');
 const requests=[],writes=[],errors=[];let damaged=false,available=true,wrongSpace=false,dropFilters=false,release=null;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');if(!url.pathname.startsWith('/v1/')){res.setHeader('content-type','text/html');return res.end(html);}
  res.setHeader('content-type','application/json');if(req.method!=='GET')writes.push(req.method+' '+url.pathname);
  if(url.pathname==='/v1/capabilities')return res.end(JSON.stringify({...contract.rust,features:{...contract.rust.features,'recall.parts':available,'recall.conditions':true}}));
  if(url.pathname==='/v1/status')return res.end(JSON.stringify({space:'alpha',episodes:2}));
  if(url.pathname==='/v1/scopes')return res.end('{"scopes":{}}');
  if(url.pathname==='/v1/recall')return res.end(JSON.stringify({items:[],facts:[],degraded:[],returned_bytes:0,space_bytes:0}));
  if(url.pathname==='/v1/recall/parts'){
   requests.push(url);const value=receipt(url.searchParams.get('q'));
   value.space=wrongSpace?'other':'alpha';value.rerank=true;value.graph_boost=url.searchParams.get('graph_boost')==='true';value.applied={};
   if(!dropFilters){
    if(url.searchParams.has('tags'))value.applied.tags=url.searchParams.get('tags').split(',');
    if(url.searchParams.has('as_of'))value.applied.as_of=url.searchParams.get('as_of');
    if(url.searchParams.has('where'))value.applied.where=Object.fromEntries(url.searchParams.get('where').split(',').map(pair=>{const at=pair.indexOf(':');return [pair.slice(0,at),pair.slice(at+1)];}));
    if(url.searchParams.has('conditions'))value.applied.conditions=JSON.parse(url.searchParams.get('conditions'));
   }
   if(damaged)value.placed_by=[];
   const send=()=>res.end(JSON.stringify(value));
   if(url.searchParams.get('q').includes('delayed')){release=send;return;}return send();
  }
  if(url.pathname.startsWith('/v1/episodes/'))return res.end(JSON.stringify({episode_id:Number(url.pathname.split('/').at(-1)),kind:'note',content:'Saved source.',source:null,tags:[],metadata:{},created_at:'2026-09-12T00:00:00Z'}));
  res.statusCode=404;res.end('{}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{release?.();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
 const base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base+'/memory#search');
 const toggle=page.getByRole('checkbox',{name:/Search each question part/});await toggle.check();
 await page.getByRole('alert').filter({hasText:'Enter a question'}).waitFor();assert.equal(requests.length,0);
 const search=page.getByRole('search'),input=page.getByRole('searchbox',{name:'Search your memory'});
 const submit=async text=>{await input.fill(text);await search.getByRole('button',{name:'Search',exact:true}).click();};
 await submit('What is 🚀 billing? Who maintains the observatory? Where is the submarine?');
 const results=page.getByRole('region',{name:'Multi-part search results'});await results.waitFor();
 assert.equal(await results.getByRole('list',{name:'Searched question parts'}).locator('li').count(),3);
 assert.deepEqual(await results.locator('.parted-excerpt .text').allTextContents(),['excerptBilling was approved by Ada.','excerptBen maintains the observatory.']);
 await results.getByText('No passages found.',{exact:true}).waitFor();
 assert.match(await results.innerText(),/Evidence quality was not measured/);
 assert.match(await results.locator('.parted-credit').first().innerText(),/Found by part 1, part 2/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.SCONE_SCREENSHOT_DIR)await page.screenshot({path:require('node:path').join(process.env.SCONE_SCREENSHOT_DIR,`parts-${mobile?'mobile':'desktop'}.png`),fullPage:true});
 await page.getByRole('button',{name:'+ filter',exact:true}).click();
 await page.locator('.addrow select').selectOption('tag');await page.locator('.addrow input').fill('work');await page.getByRole('button',{name:'Add',exact:true}).click();
 await results.waitFor();await page.waitForFunction(()=>document.querySelector('.parted-excerpt'));
 assert.equal(requests.at(-1).searchParams.get('tags'),'work');
 await page.getByRole('button',{name:'+ filter',exact:true}).click();await page.locator('.addrow select').selectOption('where');
 await page.locator('.addrow input').nth(0).fill('team');await page.locator('.addrow input').nth(1).fill('alpha');
 await page.getByRole('button',{name:'Add',exact:true}).click();await results.waitFor();
 assert.equal(requests.at(-1).searchParams.get('where'),'team:alpha');
 await page.getByRole('button',{name:'Metadata filters',exact:true}).click();
 const editor=page.getByRole('region',{name:'Metadata filter editor',exact:true});
 await editor.getByLabel('Metadata field 1',{exact:true}).fill('status');await editor.getByLabel('Value 1',{exact:true}).fill('published');
 await editor.getByRole('button',{name:'Apply metadata filter',exact:true}).click();await results.waitFor();
 assert.deepEqual(JSON.parse(requests.at(-1).searchParams.get('conditions')),{all:[{field:'status',is:'published'}]});
 dropFilters=true;await submit('Who manages billing? Who maintains the observatory?');
 await page.getByRole('alert').filter({hasText:'did not confirm this space'}).waitFor();assert.equal(await results.count(),0);
 dropFilters=false;wrongSpace=true;await page.getByRole('button',{name:'Retry multi-part search'}).click();
 await page.getByRole('alert').filter({hasText:'did not confirm this space'}).waitFor();assert.equal(await results.count(),0);
 wrongSpace=false;await page.getByRole('button',{name:'Retry multi-part search'}).click();await results.waitFor();
 await submit('What is delayed? Who will wait?');await page.getByRole('status').filter({hasText:'Searching each'}).waitFor();assert.equal(await results.count(),0);
 await toggle.uncheck();release?.();release=null;await page.getByText('Nothing matched.',{exact:false}).waitFor();assert.equal(await results.count(),0);
 damaged=true;await submit('What is billing? Who is Ben?');await toggle.check();await page.getByRole('alert').filter({hasText:'inconsistent multi-part'}).waitFor();assert.equal(await results.count(),0);
 damaged=false;await page.getByRole('button',{name:'Retry multi-part search'}).click();await results.waitFor();
 await submit('Who is Ada? Who is Ben? Where is Mars? Where is Venus? What is Saturn?');await results.getByRole('status').filter({hasText:'Only 4 of 5'}).waitFor();
 available=false;await page.reload();assert.equal(await page.getByRole('checkbox',{name:/Search each question part/}).count(),0);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
