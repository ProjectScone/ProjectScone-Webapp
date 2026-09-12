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
async function fixture(t,{supported=true,mobile=false,ocr=false}={}){
 const html=fs.readFileSync(process.env.SCONE_DOCUMENTS_HTML||path.resolve(__dirname,'../dist/console.html'),'utf8').replaceAll('__SCONE_TOKEN__','import-fixture');
 const state={failRead:false,loseWrite:false,deny:false,hold:null,holdDownload:null,corruptDownload:false,wrongOcr:false},requests=[],uploads=new Map(),sources=new Map(),sourceKeys=new Map();
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/memory'){res.setHeader('content-type','text/html');return res.end(html);}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  requests.push({path:url.pathname,method:req.method});assert.equal(req.headers.authorization,'Bearer import-fixture');res.setHeader('content-type','application/json');
  if(url.pathname==='/v1/status')return res.end(JSON.stringify({space:'imports',episodes:sources.size}));
  if(url.pathname==='/v1/capabilities')return res.end(JSON.stringify({...contract.python,features:{...contract.python.features,'episodes.list':true,'episodes.read':true,'episodes.attachments':true,'documents.provenance':true,'documents.files':supported}}));
  if(url.pathname==='/v1/sources')return res.end('{"items":[],"has_more":false,"next_before":null}');
  if(url.pathname==='/v1/documents/formats')return res.end(JSON.stringify({max_input_bytes:100000,formats:{'.txt':{available:true,parser:'text'},'.pdf':{available:ocr,parser:'pdf-text'}},...(ocr?{pdf_ocr:{available:true,modes:['missing_text','all_pages'],reading_orders:['provider','columns_ltr','columns_rtl']}}:{})}));
  if(req.method==='POST'){
   if(state.deny){res.writeHead(403);return res.end('{"error":"read-only key"}');}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   if(url.pathname==='/v1/attachments'){
    assert.equal(req.headers['content-type'],'application/octet-stream');const id=createHash('sha256').update(body).digest('hex');
    const original={attachment_id:id,bytes:body.length,media_type:'application/octet-stream'};uploads.set(id,{original,text:body.toString('utf8')});return res.end(JSON.stringify(original));
   }
   if(url.pathname==='/v1/documents'){
    if(state.hold)await state.hold;
    const {attachment_id,filename,pdf_ocr}=JSON.parse(body.toString()),{original,text}=uploads.get(attachment_id),identity=JSON.stringify([attachment_id,filename]),previous=sourceKeys.get(identity),id=previous||sources.size+1;sourceKeys.set(identity,id);
    const manifest={attachment_id:createHash('sha256').update('manifest:'+attachment_id).digest('hex'),media_type:'application/json',bytes:100};
    requests[requests.length-1].ocr=pdf_ocr;const format=filename.endsWith('.pdf')?'pdf':'txt';
    const receipt={...(pdf_ocr?{pdf_ocr}:{}),added:{episode_id:id,deduplicated:Boolean(previous)},original,manifest,format,filename,segments:1};
    const episode={episode_id:id,kind:'file',content:text,metadata:{document_original:attachment_id,document_manifest:manifest.attachment_id,document_format:format},attachments:[original,manifest]};
    const evidence={original,manifest,filename,format,parser:'fixture-text',metadata:pdf_ocr?{pdf_ocr:JSON.stringify({...pdf_ocr,reading_order:state.wrongOcr?'provider':pdf_ocr.reading_order,dpi:150})}:{},segments:[{locator:'line:1',text,metadata:pdf_ocr?{extraction:'ocr',ocr_engine:'fixture-local'}:{}}]};sources.set(id,{episode,evidence});
    if(state.loseWrite){res.destroy();return;}return res.end(JSON.stringify(receipt));
   }
  }
  if(url.pathname.startsWith('/v1/attachments/')){
   const stored=uploads.get(url.pathname.split('/').at(-1));if(!stored){res.writeHead(404);return res.end('{}');}
   if(state.holdDownload)await state.holdDownload;
   res.setHeader('content-type','application/octet-stream');return res.end(state.corruptDownload?Buffer.alloc(Buffer.byteLength(stored.text)):stored.text);
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
for(const mobile of [false,true])test(`filename controls stay visible through import evidence and download, mobile=${mobile}`,async t=>{
 const {page,q,sources}=await fixture(t,{mobile});
 const raw='report\u202egnp.txt',shown='"report\\u202egnp.txt"';
 await choose(q,file(raw,'Retained table detail'));
 assert.equal(await q.locator('.import-row-heading strong').textContent(),shown);
 await start(q);await q.getByText('1 of 1 verified · 0 ready',{exact:true}).waitFor();
 assert.equal(sources.get(1).evidence.filename,raw);
 await q.getByText('Inspect extracted source',{exact:true}).click();
 assert.ok((await q.locator('details').filter({has:page.getByText('Inspect extracted source',{exact:true})}).textContent()).includes(shown));
 await q.getByText('Download original file',{exact:true}).click();
 const original=q.getByRole('region',{name:'Original document download'});
 await original.getByRole('button',{name:'Prepare original file',exact:true}).click();
 await original.getByRole('link',{name:'Save original file'}).waitFor();
 assert.equal(await original.locator('.document-original-ready strong').textContent(),shown);
 assert.equal((await original.textContent()).includes('\u202e'),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
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


test('original downloads are byte-exact, cancellable, digest checked and revoked when cleared',async t=>{
 const {page,q,state}=await fixture(t);const text='Original café <script>literal</script>';
 await choose(q,file('café.txt',text));await start(q);await q.getByText('1 of 1 verified · 0 ready',{exact:true}).waitFor();
 await page.evaluate(()=>{window.originalUrls={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);window.originalUrls.created.push(url);return url;};URL.revokeObjectURL=url=>{window.originalUrls.revoked.push(url);return revoke(url);};});
 await q.getByText('Download original file',{exact:true}).click();const original=q.getByRole('region',{name:'Original document download'});
 await original.getByRole('button',{name:'Prepare original file',exact:true}).click();const save=original.getByRole('link',{name:'Save original file'});await save.waitFor();
 const href=await save.getAttribute('href');assert.match(href,/^blob:/);
 const received=page.waitForEvent('download');await save.click();const download=await received;assert.equal(download.suggestedFilename(),'café.txt');assert.equal(fs.readFileSync(await download.path(),'utf8'),text);
 await original.getByRole('button',{name:'Clear original download'}).click();assert.equal(await save.count(),0);assert.ok((await page.evaluate(()=>window.originalUrls.revoked)).includes(href));
 let release;state.holdDownload=new Promise(resolve=>{release=resolve;});await original.getByRole('button',{name:'Prepare original file',exact:true}).click();await original.getByText('Verifying and receiving the original file…',{exact:true}).waitFor();await original.getByRole('button',{name:'Cancel original download'}).click();release();state.holdDownload=null;assert.equal(await save.count(),0);
 state.corruptDownload=true;await original.getByRole('button',{name:'Prepare original file',exact:true}).click();await original.getByRole('alert').filter({hasText:'digest'}).waitFor();assert.equal(await save.count(),0);
});

for(const mobile of [false,true])test(`OCR choices are per-file, frozen during writes and checked against retained extraction, mobile=${mobile}`,async t=>{
 const {page,q,state,requests}=await fixture(t,{mobile,ocr:true});
 await choose(q,[file('scan.pdf','Café Polaris'),file('native.pdf','Native text')]);
 const scan=q.getByLabel('PDF extraction for scan.pdf'),native=q.getByLabel('PDF extraction for native.pdf');
 assert.equal(await scan.inputValue(),'text');assert.equal(await native.inputValue(),'text');
 await scan.selectOption('all_pages');await q.getByLabel('OCR reading order for scan.pdf').selectOption('columns_ltr');
 let release;state.hold=new Promise(resolve=>{release=resolve;});await start(q);
 await q.getByText('Extracting and indexing',{exact:true}).waitFor();assert.equal(await scan.count(),0);assert.equal(await native.isDisabled(),true);
 release();state.hold=null;await q.getByText('2 of 2 verified · 0 ready',{exact:true}).waitFor();
 assert.deepEqual(requests.filter(r=>r.path==='/v1/documents'&&r.method==='POST').map(r=>r.ocr),[{mode:'all_pages',reading_order:'columns_ltr'},undefined]);
 await q.getByText('Inspect extracted source',{exact:true}).first().click();await q.getByText('OCR · fixture-local',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('OCR provenance mismatch preserves acknowledgment without retrying extraction',async t=>{
 const {q,state,requests}=await fixture(t,{ocr:true});state.wrongOcr=true;
 await choose(q,file('scan.pdf','Café Polaris'));await q.getByLabel('PDF extraction for scan.pdf').selectOption('missing_text');await q.getByLabel('OCR reading order for scan.pdf').selectOption('columns_rtl');await start(q);
 await q.getByRole('button',{name:'Retry source verification'}).waitFor();assert.equal(postCount(requests),1);
 await q.getByRole('button',{name:'Retry source verification'}).click();await q.getByRole('alert').filter({hasText:'OCR settings'}).waitFor();assert.equal(postCount(requests),1);
});
