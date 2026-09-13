const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');
const {testPython}=require('./fixture-host.cjs');
async function availablePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
for(const mode of ['desktop','mobile','legacy'])test(`native agent tool catalog remains scoped in ${mode} editor`,{timeout:60000},async t=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'scone-tool-catalog-browser-')),port=await availablePort(),base=`http://127.0.0.1:${port}`;
 let browser,logs='';
 const server=spawn(testPython(),['-u',path.join(__dirname,'fixtures/agent-output-server.py'),state,path.join(__dirname,'../dist/console.html'),String(port)],{env:{...process.env,SCONE_TEST_AGENT_TOOLS:'1'},stdio:['pipe','pipe','pipe']});
 const closed=once(server,'close');server.stderr.on('data',part=>{logs=(logs+part).slice(-8000);});server.stdout.resume();
 t.after(async()=>{await browser?.close();if(server.exitCode===null&&server.signalCode===null)server.stdin.end('stop\n');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);try{await closed;}finally{clearTimeout(timer);fs.rmSync(state,{recursive:true,force:true});}assert.equal(server.exitCode,0,logs);});
 let ready=false;
 for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/healthz',{signal:AbortSignal.timeout(300)})).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
 assert(ready,logs);
 browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});
 const page=await browser.newPage({viewport:mode==='mobile'?{width:390,height:844}:{width:1380,height:1000}});page.setDefaultTimeout(7000);
 const errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(['POST','PUT'].includes(request.method()))writes.push(request.url());});
 if(mode==='legacy')await page.route('**/v1/agents/catalog',async route=>{const response=await route.fetch(),body=await response.json();delete body.tools;body.agents.forEach(agent=>delete agent.tools);await route.fulfill({response,json:body});});
 await page.goto(base+'/agents');await page.getByLabel('Agent',{exact:true}).waitFor();
 if(mode==='legacy'){
  assert.equal(await page.locator('.agent-tools,.agent-tools-empty').count(),0);
  await page.getByRole('button',{name:'New handoff workflow',exact:true}).click();
  assert.equal(await page.locator('.agent-tools,.agent-tools-empty').count(),0);
 }else{
  await page.locator('.agent-tools summary').click();
  await page.getByText('Count local records. <img src=x onerror=alert(1)>',{exact:true}).waitFor();
  assert.equal(await page.locator('.agent-tools img').count(),0);
  await page.getByLabel('Model',{exact:true}).selectOption('careful');
  assert.equal(await page.getByLabel('Model',{exact:true}).inputValue(),'careful');
  assert.equal(await page.locator('.agent-tools strong').textContent(),'count_records');
  if(process.env.SCONE_TOOL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.SCONE_TOOL_SCREENSHOTS,`tools-task-${mode}.png`),fullPage:true});
  await page.getByLabel('Agent',{exact:true}).selectOption('writer');
  await page.getByText('No application tools configured.',{exact:true}).waitFor();
  assert.equal(await page.locator('.agent-tools').count(),0);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'New handoff workflow',exact:true}).click();
  await page.locator('.agent-tools summary').click();
  await page.getByLabel('Add agent',{exact:true}).selectOption('writer');
  await page.getByRole('region',{name:'Handoff agent writer',exact:true}).getByText('No application tools configured.',{exact:true}).waitFor();
  await page.getByLabel('Model for worker',{exact:true}).selectOption('careful');
  assert.equal(await page.getByRole('region',{name:'Handoff agent worker',exact:true}).locator('.agent-tools strong').textContent(),'count_records');
  if(process.env.SCONE_TOOL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.SCONE_TOOL_SCREENSHOTS,`tools-handoff-${mode}.png`),fullPage:true});
 }
 assert.equal(writes.length,0);assert(!fs.existsSync(path.join(state,'calls.jsonl')));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
});
