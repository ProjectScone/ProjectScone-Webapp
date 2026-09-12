const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const baseFeatures=require('../tests/fixtures/http-capabilities.json').python.features;
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');let browser;
before(async()=>{browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});});
after(async()=>{await browser?.close();});
async function fixture(t,{mobile=false,regions=25,advertised=true,dimension=null}={}){
 const html=fs.readFileSync('dist/console.html','utf8').replaceAll('__SCONE_TOKEN__','ocr-fixture'),calls=[],state={hold:null,bad:false,gone:false,forgetAfterEvidence:false};
 const original={attachment_id:'a'.repeat(64),media_type:'application/pdf',bytes:100},manifest={attachment_id:'b'.repeat(64),media_type:'application/json',bytes:1000};
 let offset=0;const observed=Array.from({length:regions},(_,i)=>{const text=i===0?'Café':'word'+(i+1),start=offset;offset+=Buffer.byteLength(text)+1;return {text,start,end:offset-1,box:[.1,.1,.9,.2],score:i===0?.92:null,block:0,line:0,coordinate_space:'normalized_displayed_page_top_left'};});
 const filename=mobile?'scan\u2066.pdf':'scan.pdf',displayName=mobile?'"scan\\u2066.pdf"':'scan.pdf';
 const content=observed.map(r=>r.text).join(' '),episode={episode_id:1,kind:'file',content,source:'attachment:'+original.attachment_id,created_at:'2026-09-11T00:00:00Z',metadata:{document_filename:filename,document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'pdf'},attachments:[original,manifest]};
 const evidence={original,manifest,filename,format:'pdf',parser:'fixture-ocr',segments:[{locator:'page:3',text:content,metadata:{page:'3',width_points:dimension||'612',height_points:dimension||'792',rotation:'90',extraction:'ocr',ocr_engine:'fixture-local'},regions:observed}]};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');if(url.pathname.startsWith('/memory')){res.setHeader('content-type','text/html');return res.end(html);}if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  calls.push({method:req.method,path:url.pathname});res.setHeader('content-type','application/json');
  if(url.pathname==='/v1/status')return res.end('{"space":"alpha"}');
  if(url.pathname==='/v1/capabilities')return res.end(JSON.stringify({schema_version:1,implementation:'python',features:{...baseFeatures,'episodes.read':true,'documents.provenance':advertised,'episodes.attachments':true}}));
  if(url.pathname==='/v1/episodes/1/document'){
   if(state.hold)await state.hold;
   const value=structuredClone(evidence);if(state.bad)value.segments[0].regions[0].end=4;
   if(state.forgetAfterEvidence)state.gone=true;
   return res.end(JSON.stringify(value));
  }
  if(url.pathname==='/v1/episodes/1'){
   if(state.gone){res.writeHead(410);return res.end('{"error":"forgotten"}');}return res.end(JSON.stringify(episode));
  }
  res.writeHead(404);res.end('{}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1380,height:1000}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
 await page.goto(`http://127.0.0.1:${server.address().port}/memory/sources/1?space=alpha`);await page.getByRole('heading',{name:displayName,exact:true}).waitFor();
 if(advertised)await page.getByText('Inspect PDF text and OCR regions',{exact:true}).click();
 return {page,q:page.getByRole('region',{name:'PDF extraction evidence'}),state,calls};
}
for(const mobile of [false,true])test(`saved OCR inspection is lazy, paged and read-only, mobile=${mobile}`,async t=>{
 const {page,q,calls}=await fixture(t,{mobile});assert(!calls.some(c=>c.path.endsWith('/document')));
 await q.getByRole('button',{name:'Read PDF extraction',exact:true}).click();await q.getByText('PDF page 3 · 1 of 1 retained',{exact:true}).waitFor();assert.equal((await q.textContent()).includes('\u2066'),false);
 await q.getByRole('button',{name:'Region 1 Café',exact:true}).click();const detail=q.getByRole('complementary',{name:'Selected OCR region'});await detail.getByText('Recognizer score 92.0%. This score does not establish factual correctness.',{exact:true}).waitFor();assert.equal(await detail.locator('pre').textContent(),'Café');
 await q.getByRole('button',{name:'Next regions',exact:true}).click();await q.getByRole('button',{name:'Region 25 word25',exact:true}).click();await detail.getByRole('heading',{name:'Region 25',exact:true}).waitFor();
 assert.equal(await q.locator('svg .selected').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert(calls.every(c=>c.method==='GET'));await q.getByRole('button',{name:'Clear PDF extraction',exact:true}).click();assert.equal(await q.locator('svg').count(),0);
});
test('malformed or forgotten source evidence never draws a map',async t=>{
 const {q,state,calls}=await fixture(t);state.bad=true;await q.getByRole('button',{name:'Read PDF extraction',exact:true}).click();await q.getByRole('alert').waitFor();assert.equal(await q.locator('svg').count(),0);
 state.bad=false;state.forgetAfterEvidence=true;await q.getByRole('button',{name:'Retry PDF extraction read',exact:true}).click();await q.getByRole('alert').waitFor();assert.equal(await q.locator('svg').count(),0);assert(calls.every(c=>c.method==='GET'));
});
test('cancelled extraction read cannot publish its delayed response',async t=>{
 const {q,state,calls}=await fixture(t);let release;state.hold=new Promise(resolve=>{release=resolve;});
 await q.getByRole('button',{name:'Read PDF extraction',exact:true}).click();await q.getByText('Verifying retained PDF extraction…',{exact:true}).waitFor();await q.getByRole('button',{name:'Cancel PDF extraction read',exact:true}).click();release();state.hold=null;
 await q.getByRole('button',{name:'Read PDF extraction',exact:true}).waitFor();assert.equal(await q.locator('svg').count(),0);assert(calls.every(c=>c.method==='GET'));
});
test('drawing limit preserves access and highlight for every retained region',async t=>{
 const {q}=await fixture(t,{regions:2103});await q.getByRole('button',{name:'Read PDF extraction',exact:true}).click();await q.getByText(/The map draws 2000 of 2103 regions/).waitFor();
 await q.getByLabel('Region page',{exact:true}).fill('106');await q.getByRole('button',{name:'Region 2103 word2103',exact:true}).click();await q.getByRole('heading',{name:'Region 2103',exact:true}).waitFor();assert.equal(await q.locator('svg .ocr-box').count(),2000);assert.equal(await q.locator('svg .selected').count(),1);
});
test('absent document provenance capability exposes no OCR read control',async t=>{
 const {page,calls}=await fixture(t,{advertised:false});assert.equal(await page.getByText('Inspect PDF text and OCR regions',{exact:true}).count(),0);assert(!calls.some(c=>c.path.endsWith('/document')));
});

test('finite extreme page dimensions cannot overflow the normalized region map',async t=>{
 const {q}=await fixture(t,{dimension:'1e307'});await q.getByRole('button',{name:'Read PDF extraction',exact:true}).click();await q.getByText('PDF page 3 · 1 of 1 retained',{exact:true}).waitFor();assert.equal((await q.textContent()).includes('\u2066'),false);
 assert.equal(await q.locator('svg').getAttribute('viewBox'),'0 0 1000 1000');
 assert(await q.locator('svg rect').evaluateAll(nodes=>nodes.every(node=>['x','y','width','height'].every(name=>Number.isFinite(Number(node.getAttribute(name)))))));
});
