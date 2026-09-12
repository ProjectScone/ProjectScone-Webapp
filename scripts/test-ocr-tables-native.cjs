// Packaged React -> actual local Tesseract PDF -> persistent SQLite -> source-bound table analysis.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright'),{testPython}=require('./fixture-host.cjs');
async function availablePort(){const s=net.createServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
for(const mobile of [false,true])test(`OCR table inspection verifies real retained scan without rerun, mobile=${mobile}`,{timeout:60000},async t=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'scone-table-native-')),port=await availablePort(),base=`http://127.0.0.1:${port}`;
 let server,closed,browser,logs='';
 const stop=async()=>{if(!server)return;if(server.exitCode===null&&server.signalCode===null)server.stdin.end('stop\n');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);try{await closed;}finally{clearTimeout(timer);}assert.equal(server.exitCode,0,logs);server=null;};
 const start=async()=>{
  server=spawn(testPython(),['-u',path.join(__dirname,'fixtures/ocr-table-server.py'),state,path.join(__dirname,'../dist/console.html'),String(port)],{stdio:['pipe','pipe','pipe']});closed=once(server,'close');server.stdout.resume();server.stderr.on('data',p=>{logs=(logs+p).slice(-10000);});
  for(let i=0;i<200;i++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/healthz',{signal:AbortSignal.timeout(300)})).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Native fixture unavailable: '+logs);
 };
 t.after(async()=>{await browser?.close();await stop();fs.rmSync(state,{recursive:true,force:true});});
 await start();const identity=fs.readFileSync(path.join(state,'episode-id'),'utf8');
 browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1380,height:1100}}),errors=[],calls=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith(base+'/v1/'))calls.push([r.method(),r.url()]);});
 const open=async()=>{await page.goto(base+`/memory/sources/${identity}?space=alpha`);await page.getByRole('heading',{name:'table-scan.pdf',exact:true}).waitFor();await page.getByText('Inspect PDF text and OCR regions',{exact:true}).click();await page.getByRole('button',{name:'Read PDF extraction',exact:true}).click();await page.getByRole('button',{name:'Analyze table layout',exact:true}).waitFor();};
 await open();assert.equal(calls.filter(c=>c[1].includes('/ocr-tables')).length,0);
 const inspection=page.getByRole('region',{name:'OCR table inspection',exact:true});
 await inspection.getByRole('button',{name:'Analyze table layout',exact:true}).click();await inspection.getByText('Candidate 1 · 5 inferred rows × 3 inferred columns',{exact:true}).waitFor();
 await inspection.getByRole('button',{name:/Alpha.*region/}).click();await page.getByRole('complementary',{name:'Selected OCR region'}).locator('pre').getByText('Alpha',{exact:true}).waitFor();
 await inspection.getByText(/Inspect unassigned text/).click();assert.match(await inspection.locator('.ocr-unassigned').textContent(),/Inventory/);
 const downloadEvent=page.waitForEvent('download');await inspection.getByRole('link',{name:'Download analysis and source references',exact:true}).click();const download=await downloadEvent,exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
 assert.equal(exported.origin,'geometry_inferred');assert.equal(exported.tables[0].rows,5);assert(exported.regions.some(r=>r.text==='Alpha'));assert.equal(exported.episode_id,Number(identity));
 assert.equal(fs.readFileSync(path.join(state,'ocr-calls'),'utf8'),'recognize\n');assert(calls.every(c=>c[0]==='GET'));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.SCONE_SCREENSHOT_DIR){fs.mkdirSync(process.env.SCONE_SCREENSHOT_DIR,{recursive:true});await inspection.screenshot({path:path.join(process.env.SCONE_SCREENSHOT_DIR,`ocr-tables-${mobile?'mobile':'desktop'}.png`)});fs.copyFileSync(path.join(state,'table-scan.pdf'),path.join(process.env.SCONE_SCREENSHOT_DIR,'table-scan.pdf'));}
 // A completed native response held in transit must not resurrect cancelled analysis.
 let release,arrived;const held=new Promise(resolve=>{release=resolve;}),received=new Promise(resolve=>{arrived=resolve;});
 const tableRoute='**/document/ocr-tables?*';
 await page.route(tableRoute,async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});});
 await inspection.getByRole('button',{name:'Retry table analysis',exact:true}).click();await received;
 assert.equal(await inspection.locator('table').count(),0);assert.equal(await inspection.getByRole('link').count(),0);
 await inspection.getByRole('button',{name:'Cancel table analysis',exact:true}).click();release();await page.unrouteAll({behavior:'wait'});
 assert.equal(await inspection.locator('table').count(),0);assert.equal(await inspection.getByRole('link').count(),0);
 await inspection.getByRole('button',{name:'Analyze table layout',exact:true}).waitFor();
 // Capability absence hides the optional control even though retained OCR remains inspectable.
 await page.route('**/v1/capabilities',async route=>{const response=await route.fetch(),body=await response.json();body.features['documents.ocr.tables']=false;await route.fulfill({response,json:body});});
 await page.reload();await page.getByText('Inspect PDF text and OCR regions',{exact:true}).click();await page.getByRole('button',{name:'Read PDF extraction',exact:true}).click();
 await page.getByRole('img',{name:'Recorded OCR region map for PDF page 1'}).waitFor();assert.equal(await inspection.count(),0);
 await page.unrouteAll({behavior:'wait'});
 await stop();await start();await open();await inspection.getByRole('button',{name:'Analyze table layout',exact:true}).click();await inspection.getByText('Candidate 1 · 5 inferred rows × 3 inferred columns',{exact:true}).waitFor();assert.equal(fs.readFileSync(path.join(state,'ocr-calls'),'utf8'),'recognize\n');
 await fetch(base+`/v1/episodes/${identity}`,{method:'DELETE',headers:{authorization:'Bearer admin-fixture'}});
 await inspection.getByRole('button',{name:'Retry table analysis',exact:true}).click();await inspection.getByRole('alert').waitFor();assert.equal(await inspection.locator('table').count(),0);assert.equal(await inspection.getByRole('link').count(),0);
 assert.deepEqual(errors,[]);
});
