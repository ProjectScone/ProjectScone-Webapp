const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.SCONE_BROWSER_ENGINE||'chromium';
const app=require('node:path').resolve(__dirname,'..');
const contract=require(app+'/tests/fixtures/http-capabilities.json');
const {capture}=require('../tests/fixtures/knowledge-inference.cjs');
const captures=Object.fromEntries(['current','history','all'].map(mode=>[mode,capture(mode)]));
for(const mobile of [false,true])test(`inference evidence and dashed map, mobile=${mobile}`,async t=>{
 const browser=await engines[engine].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});
 const html=fs.readFileSync(app+'/dist/console.html','utf8').replaceAll('__SCONE_TOKEN__','inference-fixture');
 let damaged=false,legacy=false,capped=false;const writes=[],errors=[];
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');if(!url.pathname.startsWith('/v1/')){res.setHeader('content-type','text/html');return res.end(html);}
  if(req.method!=='GET')writes.push(req.method+' '+url.pathname);res.setHeader('content-type','application/json');
  if(url.pathname==='/v1/status')return res.end(JSON.stringify({space:'alpha',episodes:0}));
  if(url.pathname==='/v1/capabilities')return res.end(JSON.stringify({...contract.rust,features:{...contract.rust.features,'graph.knowledge':true,'entities.read':true}}));
  const capture=captures[url.searchParams.get('status')||'current'];
  if(url.pathname==='/v1/graph/knowledge'){
   const value=structuredClone(capture.graph);if(capped)value.coverage.implied_capped=true;if(damaged)value.implied[0].periods[0][0]='bad';
   if(legacy){delete value.implied;for(const k of ['meanings','implied_total','implied_shown','implied_capped'])delete value.coverage[k];}
   return res.end(JSON.stringify(value));
  }
  if(url.pathname.startsWith('/v1/entities/'))return res.end(JSON.stringify(capture.details[decodeURIComponent(url.pathname.split('/').at(-1))]));
  res.statusCode=404;res.end('{}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/memory#knowledge`);
 const inferences=page.getByRole('region',{name:'Inferred relationships',exact:true});await inferences.waitFor();
 await inferences.getByText('Inspect inferred relationships and limits',{exact:true}).click();
 await inferences.getByText('Rule, periods and premises',{exact:true}).click();
 await inferences.getByLabel('Show dashed inferences on map').check();
 assert.equal(await page.locator('.knowledge-map .en-edge-line[stroke-dasharray]').count(),1);
 assert.match(await page.locator('.knowledge-map .en-canvas-note').innerText(),/2 recorded links · 1 inferred/);
 await inferences.getByRole('button',{name:'Inspect supporting claims',exact:true}).click();
 const inspector=page.getByRole('complementary',{name:'Entity inspection'});
 await inspector.getByRole('heading',{name:'Inferred connections',exact:true}).waitFor();
 assert.equal(await inspector.locator('.knowledge-fact').count(),2,'transitive premise beyond selected entity remains inspectable');
 await page.locator('.knowledge-toolbar select').first().selectOption('history');
 await inferences.getByLabel('Show dashed inferences on map').waitFor();
 assert.equal(await inferences.getByLabel('Show dashed inferences on map').isChecked(),false,'new graph resets inferred map choice');
 await inferences.getByText('Inspect inferred relationships and limits',{exact:true}).click();
 await inferences.getByText('Rule, periods and premises',{exact:true}).click();
 assert.equal(await inferences.getByRole('list',{name:'Inference validity periods'}).locator('li').count(),2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.SCONE_SCREENSHOT_DIR)await page.screenshot({path:require('node:path').join(process.env.SCONE_SCREENSHOT_DIR,`inferred-${mobile?'mobile':'desktop'}.png`),fullPage:true});
 capped=true;await page.getByRole('button',{name:'Refresh graph',exact:true}).click();await inferences.getByRole('status').filter({hasText:'Inference search stopped at a limit'}).waitFor();
 damaged=true;await page.getByRole('button',{name:'Refresh graph',exact:true}).click();await page.getByRole('alert').filter({hasText:'Knowledge could not be loaded'}).waitFor();assert.equal(await inferences.count(),0);
 damaged=false;legacy=true;await page.getByRole('button',{name:'Refresh graph',exact:true}).click();await page.getByRole('complementary',{name:'Entity directory'}).waitFor();assert.equal(await inferences.count(),0);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
