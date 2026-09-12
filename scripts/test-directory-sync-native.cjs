// Packaged React against standard native configuration, SQLite and source journals.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright'),{testPython}=require('./fixture-host.cjs');
async function availablePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
for(const mobile of [false,true])test(`native directory controls, paging and restart, mobile=${mobile}`,{timeout:90000},async t=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'scone-directory-browser-')),port=await availablePort(),base=`http://127.0.0.1:${port}`;
 let server,closed,browser,logs='';
 const stop=async(kill=false)=>{if(!server)return;if(server.exitCode===null&&server.signalCode===null){if(kill)server.kill('SIGKILL');else server.stdin.end('stop\n');}const timer=setTimeout(()=>server.kill('SIGKILL'),5000);try{await closed;}finally{clearTimeout(timer);}if(!kill)assert.equal(server.exitCode,0,logs);server=null;};
 const start=async()=>{
  server=spawn(testPython(),['-u',path.join(__dirname,'fixtures/directory-sync-server.py'),state,path.join(__dirname,'../dist/console.html'),String(port)],{stdio:['pipe','pipe','pipe']});closed=once(server,'close');server.stdout.resume();server.stderr.on('data',part=>{logs=(logs+part).slice(-10000);});
  for(let i=0;i<200;i++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/healthz',{signal:AbortSignal.timeout(300)})).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Native directory fixture unavailable: '+logs);
 };
 t.after(async()=>{try{await browser?.close();}finally{try{await stop();}finally{fs.rmSync(state,{recursive:true,force:true});}}});
 const get=async endpoint=>{const response=await fetch(base+endpoint,{headers:{authorization:'Bearer directory-writer'}});assert.equal(response.status,200,await response.clone().text());return response.json();};
 const calls=()=>fs.existsSync(path.join(state,'parser-calls'))?fs.readFileSync(path.join(state,'parser-calls'),'utf8').trim().split('\n').length:0;
 await start();browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1380,height:1000}}),errors=[],writes=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().startsWith(base+'/v1/')&&request.method()!=='GET')writes.push({url:request.url(),body:request.postDataJSON()});});
 const panel=page.getByRole('region',{name:'Local directory synchronization'}),results=panel.getByRole('region',{name:'Historical sync results'});
 const open=async()=>{await page.goto(base+'/memory#documents');await panel.getByText('No saved sync runs on this page.',{exact:true}).or(panel.locator('.sync-run').first()).waitFor();};
 const refresh=async()=>{await panel.getByRole('button',{name:'Refresh sync history',exact:true}).click();await panel.getByText('Loading sync history…',{exact:true}).waitFor({state:'hidden'});};
 const startRun=async()=>{
  const before=writes.length;await panel.getByRole('button',{name:'Start directory sync',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.sync-pending'));
  assert.equal(writes.length,before+1);assert.match(writes.at(-1).body.expected_configuration,/^[a-f0-9]{64}$/);return writes.at(-1).body.run_id;
 };
 const completed=async id=>{
  for(let i=0;i<300;i++){const run=await get('/v1/sync-runs/'+id);if(!run.active_local){assert.equal(run.status,'completed',JSON.stringify(run));await refresh();return run;}await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Sync did not settle');
 };
 const outcomes=async id=>{const all=[];let cursor;do{const page=await get('/v1/sync-runs/'+id+'/result?limit=20'+(cursor===undefined?'':'&after='+cursor));all.push(...page.items);cursor=page.next_after;}while(cursor!==null);return all;};
 await open();assert.equal(calls(),0);assert.equal(writes.length,0);assert.equal(await panel.getByRole('checkbox').isChecked(),false);
 const first=await startRun();await completed(first);assert.equal(calls(),21);
 await panel.getByRole('button',{name:'Inspect results for '+first,exact:true}).click();await results.getByText('note-00.txt',{exact:true}).waitFor();assert.equal(await results.locator('li').count(),20);
 await results.getByRole('button',{name:'More results',exact:true}).click();await results.getByText('note-20.txt',{exact:true}).waitFor();assert.equal(await results.locator('li').count(),1);
 await results.getByRole('button',{name:'Previous results',exact:true}).click();await results.getByText('note-00.txt',{exact:true}).waitFor();await results.getByRole('button',{name:'Close sync results',exact:true}).click();
 fs.writeFileSync(path.join(state,'notes/note-00.txt'),'Changed source content for a new revision.');fs.unlinkSync(path.join(state,'notes/note-01.txt'));fs.writeFileSync(path.join(state,'notes/new.txt'),'A newly discovered document.');
 const second=await startRun();await completed(second);assert.equal(calls(),23);
 const changed=await outcomes(second);assert.equal(changed.find(item=>item.source?.path==='note-00.txt').source.status,'updated');assert.equal(changed.some(item=>item.source?.path==='note-01.txt'),false);const old=(await outcomes(first)).find(item=>item.source?.path==='note-01.txt').source.episode_id;assert.equal((await get('/v1/episodes/'+old)).episode_id,old);assert.equal(changed.find(item=>item.source?.path==='new.txt').source.status,'added');
 await panel.getByRole('checkbox').check();const third=await startRun();await completed(third);assert.equal(calls(),23);assert.equal((await outcomes(third)).find(item=>item.source?.path==='note-01.txt').source.status,'deleted');
 const beforeRestart=JSON.stringify(await get('/v1/sync-runs')),beforeWrites=writes.length;await stop();await start();await open();assert.equal(calls(),23);assert.equal(writes.length,beforeWrites);assert.equal(JSON.stringify(await get('/v1/sync-runs')),beforeRestart);
 fs.writeFileSync(path.join(state,'pause'),'pause');fs.writeFileSync(path.join(state,'notes/note-00.txt'),'Interrupted replacement survives explicit recovery.');const interrupted=await startRun();
 for(let i=0;i<100&&calls()===23;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls(),24);await stop(true);fs.unlinkSync(path.join(state,'pause'));await start();await open();
 const row=panel.locator('.sync-run').filter({has:page.locator('code',{hasText:interrupted})});await row.getByText('Interrupted',{exact:true}).waitFor();assert.equal(calls(),24);
 await row.getByRole('button',{name:'Resume '+interrupted,exact:true}).click();await completed(interrupted);assert.equal(calls(),25);assert.equal((await get('/v1/sync-runs/'+interrupted)).record.attempt,2);
 // Cancellation is acknowledged independently of the worker's eventual idle state.
 fs.writeFileSync(path.join(state,'pause'),'pause');fs.writeFileSync(path.join(state,'notes/note-00.txt'),'Cancellation recovery uses this new revision.');const cancelled=await startRun();await refresh();
 await panel.getByRole('button',{name:'Cancel '+cancelled,exact:true}).click();
 for(let i=0;i<100;i++){const run=await get('/v1/sync-runs/'+cancelled);if(!run.active_local){assert.equal(run.status,'cancelled');break;}await new Promise(resolve=>setTimeout(resolve,20));}
 fs.unlinkSync(path.join(state,'pause'));await refresh();await panel.getByRole('button',{name:'Resume '+cancelled,exact:true}).click();await completed(cancelled);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await panel.locator('.sync-actions .btn').evaluateAll(buttons=>buttons.every(button=>button.scrollHeight<=button.clientHeight)));assert.deepEqual(errors,[]);
 if(process.env.SCONE_SYNC_SCREENSHOTS){fs.mkdirSync(process.env.SCONE_SYNC_SCREENSHOTS,{recursive:true});await panel.screenshot({path:path.join(process.env.SCONE_SYNC_SCREENSHOTS,`directory-${mobile?'mobile':'desktop'}.png`)});}
 assert.equal(writes.filter(item=>item.url.endsWith('/resume')).length,2);assert.equal(writes.filter(item=>item.url.endsWith('/cancel')).length,1);
});
