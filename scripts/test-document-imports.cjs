// Packaged import workflow at an isolated HTTP boundary; no live memory service.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');
const contract=require('../tests/fixtures/http-capabilities.json');
let browser;
before(async()=>{const engine=process.env.SCONE_BROWSER_ENGINE||'chromium';browser=await engines[engine].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});});
after(async()=>{await browser?.close();});
async function fixture(t,{supported=true,mobile=false}={}){
 const html=fs.readFileSync(process.env.SCONE_DOCUMENTS_HTML||path.resolve(__dirname,'../dist/console.html'),'utf8').replaceAll('__SCONE_TOKEN__','import-fixture');
 const state={failRead:false,loseWrite:false,deny:false,hold:null},requests=[],uploads=new Map(),sources=new Map(),sourceKeys=new Map();
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/memory'){res.setHeader('content-type','text/html');return res.end(html);}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  requests.push({path:url.pathname,method:req.method});assert.equal(req.headers.authorization,'Bearer import-fixture');res.setHeader('content-type','application/json');
  if(url.pathname==='/v1/status')return res.end(JSON.stringify({space:'imports',episodes:sources.size}));
  if(url.pathname==='/v1/capabilities')return res.end(JSON.stringify({...contract.python,features:{...contract.python.features,'episodes.list':true,'episodes.read':true,'episodes.attachments':true,'documents.provenance':true,'documents.files':supported}}));
  if(url.pathname==='/v1/sources')return res.end('{"items":[],"has_more":false,"next_before":null}');
  if(url.pathname==='/v1/documents/formats')return res.end(JSON.stringify({max_input_bytes:100000,formats:{'.txt':{available:true,parser:'text'},'.pdf':{available:false,parser:'pdf-text'}}}));
  if(req.method==='POST'){
   if(state.deny){res.writeHead(403);return res.end('{"error":"read-only key"}');}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   if(url.pathname==='/v1/attachments'){
    assert.equal(req.headers['content-type'],'application/octet-stream');const id=createHash('sha256').update(body).digest('hex');
    const original={attachment_id:id,bytes:body.length,media_type:'application/octet-stream'};uploads.set(id,{original,text:body.toString('utf8')});return res.end(JSON.stringify(original));
   }
   if(url.pathname==='/v1/documents'){
    if(state.hold)await state.hold;
    const {attachment_id,filename}=JSON.parse(body.toString()),{original,text}=uploads.get(attachment_id),identity=JSON.stringify([attachment_id,filename]),previous=sourceKeys.get(identity),id=previous||sources.size+1;sourceKeys.set(identity,id);
    const manifest={attachment_id:createHash('sha256').update('manifest:'+attachment_id).digest('hex'),media_type:'application/json',bytes:100};
    const receipt={added:{episode_id:id,deduplicated:Boolean(previous)},original,manifest,format:'txt',filename,segments:1};
    const episode={episode_id:id,kind:'file',content:text,metadata:{document_original:attachment_id,document_manifest:manifest.attachment_id,document_format:'txt'},attachments:[original,manifest]};
    const evidence={original,manifest,filename,format:'txt',parser:'fixture-text',segments:[{locator:'line:1',text}]};sources.set(id,{episode,evidence});
    if(state.loseWrite){res.destroy();return;}return res.end(JSON.stringify(receipt));
   }
  }
  const match=url.pathname.match(/^\/v1\/episodes\/(\d+)(\/document)?$/);
  if(match&&sources.has(Number(match[1]))){if(match[2]&&state.failRead){res.writeHead(503);return res.end('{"error":"read failed"}');}return res.end(JSON.stringify(sources.get(Number(match[1]))[match[2]?'evidence':'episode']));}
  res.writeHead(404);res.end('{}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
 await page.goto(`http://127.0.0.1:${server.address().port}/memory#documents`);
 if(supported)await page.getByRole('button',{name:'Import documents',exact:true}).click();
 return {page,q:page.getByRole('region',{name:'Document import queue'}),state,requests,sources};
}
const file=(name,text)=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(text)});
const choose=(q,files)=>q.getByLabel('Choose documents').setInputFiles(files);
const start=q=>q.getByRole('button',{name:/^Import \d+ ready file/}).click();
const postCount=requests=>requests.filter(r=>r.path==='/v1/documents'&&r.method==='POST').length;
for(const mobile of [false,true])test(`imports show checked source text and preserve read-only verification retries, mobile=${mobile}`,async t=>{
 const {page,q,state,requests}=await fixture(t,{mobile});state.failRead=true;
 await choose(q,file('café.txt','Friday <script>not markup</script>'));await start(q);
 await q.getByRole('button',{name:'Retry source verification'}).waitFor();assert.equal(postCount(requests),1);
 state.failRead=false;await q.getByRole('button',{name:'Retry source verification'}).click();await q.getByText('1 of 1 verified · 0 ready',{exact:true}).waitFor();
 assert.equal(postCount(requests),1);await q.getByText('Inspect extracted source',{exact:true}).click();assert.equal(await q.locator('pre').textContent(),'Friday <script>not markup</script>');assert.equal(await q.locator('script').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('pause completes the current document without starting the next; uncertain writes never offer retry',async t=>{
 const {q,state,requests,sources}=await fixture(t);let release;state.hold=new Promise(resolve=>{release=resolve;});
 await choose(q,[file('first.txt','One'),file('second.txt','Two')]);await start(q);await q.getByText('Extracting and indexing',{exact:true}).waitFor();
 await q.getByRole('button',{name:'Pause after this file',exact:true}).click();release();state.hold=null;
 await q.getByText('1 of 2 verified · 1 ready',{exact:true}).waitFor();assert.equal(postCount(requests),1);
 state.loseWrite=true;await start(q);await q.getByText('Save unconfirmed',{exact:true}).waitFor();assert.equal(sources.size,2);assert.equal(await q.getByRole('button',{name:'Queue retry'}).count(),0);
});
test('unsupported parsers and excessive selections never upload; explicit denial keeps the workspace',async t=>{
 const {q,state,requests}=await fixture(t);
 await choose(q,file('scan.pdf','scan'));await q.getByRole('alert').filter({hasText:'unavailable'}).waitFor();assert.equal(requests.some(r=>r.method==='POST'),false);
 await choose(q,Array.from({length:21},(_,i)=>file(`file-${i}.txt`,'text')));await q.getByRole('alert').filter({hasText:'20 files'}).waitFor();assert.equal(requests.some(r=>r.method==='POST'),false);
 state.deny=true;await choose(q,file('denied.txt','denied'));await start(q);await q.getByText('Import failed',{exact:true}).waitFor();assert.equal(postCount(requests),0);assert.equal(await q.getByRole('button',{name:'Queue retry'}).count(),1);
});
test('missing file capability never exposes import controls or probes format support',async t=>{
 const {page,requests}=await fixture(t,{supported:false});await page.getByRole('heading',{name:'Documents',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Import documents',exact:true}).count(),0);assert.equal(requests.some(r=>r.path==='/v1/documents/formats'),false);
});
