// Packaged UI against real local decode, retained SQLite evidence and native HTTP.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright'),{testPython}=require('./fixture-host.cjs');
async function availablePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
for(const mobile of [false,true])test(`native transcript playback survives restart without transcription, mobile=${mobile}`,{timeout:60000},async t=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'scone-media-native-')),port=await availablePort(),base=`http://127.0.0.1:${port}`;
 let server,closed,browser,logs='';
 const stop=async()=>{if(!server)return;if(server.exitCode===null&&server.signalCode===null)server.stdin.end('stop\n');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);try{await closed;}finally{clearTimeout(timer);}assert.equal(server.exitCode,0,logs);server=null;};
 const start=async()=>{
  server=spawn(testPython(),['-u',path.join(__dirname,'fixtures/media-document-server.py'),state,path.join(__dirname,'../dist/console.html'),String(port)],{stdio:['pipe','pipe','pipe']});closed=once(server,'close');server.stdout.resume();server.stderr.on('data',part=>{logs=(logs+part).slice(-10000);});
  for(let i=0;i<200;i++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/healthz',{signal:AbortSignal.timeout(300)})).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Native fixture unavailable: '+logs);
 };
 t.after(async()=>{try{await browser?.close();}finally{try{await stop();}finally{fs.rmSync(state,{recursive:true,force:true});}}});
 await start();const identity=fs.readFileSync(path.join(state,'episode-id'),'utf8');
 browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1380,height:1000}}),errors=[],requests=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().startsWith(base+'/v1/'))requests.push([request.method(),request.url()]);});
 const panel=page.getByRole('region',{name:'Media transcript evidence'});
 const open=async()=>{await page.goto(base+`/memory/sources/${identity}?space=alpha`);await page.getByRole('heading',{name:'café.wav',exact:true}).waitFor();await page.getByText('Inspect transcript and audio',{exact:true}).click();await panel.getByRole('button',{name:'Read transcript',exact:true}).click();await panel.getByText('2 transcript segments',{exact:false}).waitFor();};
 const prepare=async()=>{await panel.getByRole('button',{name:'Prepare checked audio'}).click();await panel.locator('audio').waitFor();await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=1);};
 await open();assert.equal(requests.filter(request=>request[1].endsWith('/document/audio')).length,0);
 await prepare();const audio=panel.locator('audio');assert.equal(await audio.evaluate(value=>value.duration),1);assert.equal(await audio.evaluate(value=>value.paused),true);
 await panel.getByRole('button',{name:'Seek to 0:00.500',exact:true}).click();assert.ok(Math.abs(await audio.evaluate(value=>value.currentTime)-0.5)<0.01);assert.equal(await audio.evaluate(value=>value.paused),true);
 const played=await audio.evaluate(async value=>Array.from(new Uint8Array(await (await fetch(value.src)).arrayBuffer())));
 assert.deepEqual(Buffer.from(played),fs.readFileSync(path.join(state,'transcribed.wav')));
 assert.equal(fs.readFileSync(path.join(state,'transcription-calls'),'utf8'),'transcribe\n');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.SCONE_MEDIA_SCREENSHOTS){fs.mkdirSync(process.env.SCONE_MEDIA_SCREENSHOTS,{recursive:true});await panel.screenshot({path:path.join(process.env.SCONE_MEDIA_SCREENSHOTS,`native-${mobile?'mobile':'desktop'}.png`)});}
 await stop();await start();await open();await prepare();assert.equal(fs.readFileSync(path.join(state,'transcription-calls'),'utf8'),'transcribe\n');
 const removed=await fetch(base+`/v1/episodes/${identity}`,{method:'DELETE',headers:{authorization:'Bearer media-admin'}});assert.equal(removed.status,200);
 await panel.getByRole('button',{name:'Clear prepared audio'}).click();await panel.getByRole('button',{name:'Prepare checked audio'}).click();await panel.getByRole('alert').waitFor();assert.equal(await panel.locator('audio').count(),0);
 assert(requests.every(request=>request[0]==='GET'));assert.deepEqual(errors,[]);
});
