// Packaged transcript controls with generated PCM on an isolated loopback server.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright'),contract=require('../tests/fixtures/http-capabilities.json');let browser;
before(async()=>{browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});});after(async()=>browser?.close());
for(const mode of ['desktop','mobile','corrupt','forgotten','cancel','legacy','malformed','coverage','coverage-unknown','coverage-invalid'])test(`transcript and checked audio: ${mode}`,async t=>{
 const wav=Buffer.alloc(96044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(96000,40);
 const original={attachment_id:'a'.repeat(64),bytes:100,media_type:'application/octet-stream'},manifest={attachment_id:'b'.repeat(64),bytes:500,media_type:'application/json'};
 const at=i=>mode.startsWith('coverage')?(i<11?i/20:2+(i-11)/20):i/10;
 const segments=Array.from({length:21},(_,i)=>({text:`Café transcript segment ${i+1}.`,locator:`audio:0/segment:${i+1}/seconds:${at(i).toFixed(2)}-${(at(i)+0.05).toFixed(2)}`,metadata:{extraction:'transcription',audio_stream:'0',start_seconds:at(i).toFixed(2),end_seconds:(at(i)+0.05).toFixed(2)}}));
 const metadata={extraction:'audio-only',sample_rate:'16000',duration_seconds:'3.0',transcriber_revision:'fixture-v1',...(mode==='legacy'?{}:{audio_wav_sha256:createHash('sha256').update(wav).digest('hex'),audio_wav_bytes:String(wav.length)})};
 if(mode.startsWith('coverage'))Object.assign(metadata,{transcription_windows:'quiet-audio-windows-v1',chunk_seconds:'1'},mode==='coverage-unknown'?{}:{transcription_window_count:'3',transcription_empty_windows:mode==='coverage-invalid'?'3':'1'});
 if(mode==='malformed')segments[1].metadata.end_seconds='NaN';
 const evidence={original,manifest,format:'wav',parser:'media-transcription',filename:'café.wav',metadata,segments},content=segments.map(s=>s.text).join('\n\n');
 const html=fs.readFileSync(path.resolve(__dirname,'../dist/console.html'),'utf8').replaceAll('__SCONE_TOKEN__','media-fixture');
 let notifyAudio;const audioStarted=new Promise(resolve=>notifyAudio=resolve);
 let audioReads=0,provenanceReads=0,release,held=mode==='cancel'?new Promise(resolve=>release=resolve):null;const writes=[];
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://fixture').pathname;
  if(pathname==='/memory/sources/7'){res.setHeader('content-type','text/html');return res.end(html);}if(pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
  if(req.method!=='GET')writes.push(req.method+' '+pathname);assert.equal(req.headers.authorization,'Bearer media-fixture');
  res.setHeader('content-type','application/json');const send=value=>res.end(JSON.stringify(value));
  if(pathname==='/v1/status')return send({space:'media-test',episodes:1});
  if(pathname==='/v1/capabilities')return send({...contract.python,features:{...contract.python.features,'episodes.read':true,'documents.provenance':true,'episodes.attachments':false}});
  if(pathname==='/v1/episodes/7/document'){provenanceReads++;return send(evidence);}
  if(pathname==='/v1/episodes/7/document/audio'){audioReads++;notifyAudio();if(held)await held;res.setHeader('content-type','audio/wav');return res.end(mode==='corrupt'?Buffer.alloc(wav.length):wav);}
  if(pathname==='/v1/episodes/7'){
   if(mode==='forgotten'&&audioReads){res.statusCode=410;return send({error:'forgotten'});}
   return send({episode_id:7,kind:'file',created_at:'2026-09-12',source:'café.wav',content,metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'wav'},attachments:[original,manifest]});
  }
  res.statusCode=404;send({error:'not found'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const page=await browser.newPage({viewport:mode==='mobile'?{width:390,height:844}:{width:1440,height:1000}}),errors=[];
 page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.mediaUrls=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const url=create(b);window.mediaUrls.add(url);return url;};URL.revokeObjectURL=url=>{window.mediaUrls.delete(url);revoke(url);};});
 t.after(async()=>{release?.();await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);});
 await page.goto(`http://127.0.0.1:${server.address().port}/memory/sources/7?space=media-test`);
 await page.getByText('Inspect transcript and audio',{exact:true}).click();const panel=page.getByRole('region',{name:'Media transcript evidence'});
 assert.equal(provenanceReads,0);assert.equal(audioReads,0);await panel.getByRole('button',{name:'Read transcript',exact:true}).click();
 if(mode==='malformed'||mode==='coverage-invalid'){await panel.getByRole('alert').waitFor();assert.equal(await panel.locator('audio').count(),0);assert.equal(audioReads,0);return;}
 await panel.getByText('21 transcript segments',{exact:false}).waitFor();assert.equal(await panel.locator('ol li').count(),20);assert.equal(audioReads,0);
 if(mode==='coverage')await panel.getByText('3 transcription windows · 1 returned no text.',{exact:false}).waitFor();
 if(mode==='coverage-unknown')await panel.getByText('Window counts were not recorded for this extraction.',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Next transcript segments'}).click();assert.equal(await panel.locator('ol li').count(),1);await panel.getByRole('button',{name:'Previous transcript segments'}).click();
 if(mode==='legacy'){await panel.getByText('Checked playback is unavailable',{exact:false}).waitFor();assert.equal(await panel.getByRole('button',{name:'Prepare checked audio'}).count(),0);return;}
 await panel.getByRole('button',{name:'Prepare checked audio'}).click();
 if(mode==='cancel'){
  await audioStarted;assert.equal(audioReads,1);
  await panel.getByRole('button',{name:'Cancel audio preparation'}).click();release();await panel.getByRole('button',{name:'Prepare checked audio'}).waitFor();assert.equal(await panel.locator('audio').count(),0);assert.equal(await page.evaluate(()=>window.mediaUrls.size),0);return;
 }
 if(mode==='corrupt'||mode==='forgotten'){await panel.getByRole('alert').waitFor();assert.equal(await panel.locator('audio').count(),0);assert.equal(await page.evaluate(()=>window.mediaUrls.size),0);return;}
 const audio=panel.locator('audio');await audio.waitFor();await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=1);
 assert.equal(await audio.evaluate(a=>a.paused),true);assert.equal(await audio.evaluate(a=>a.duration),3);
 await panel.getByRole('button',{name:'Seek to 0:00.100',exact:true}).click();assert.ok(Math.abs(await audio.evaluate(a=>a.currentTime)-0.1)<0.01);assert.equal(await audio.evaluate(a=>a.paused),true);
 assert.equal(audioReads,1);assert.equal(await page.evaluate(()=>window.mediaUrls.size),1);
 if(process.env.SCONE_MEDIA_SCREENSHOTS){fs.mkdirSync(process.env.SCONE_MEDIA_SCREENSHOTS,{recursive:true});await panel.screenshot({path:path.join(process.env.SCONE_MEDIA_SCREENSHOTS,mode+'.png')});}
 await panel.getByRole('button',{name:'Clear prepared audio'}).click();await audio.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.mediaUrls.size),0);
 await panel.getByRole('button',{name:'Clear transcript'}).click();assert.equal(await panel.locator('ol').count(),0);
});
