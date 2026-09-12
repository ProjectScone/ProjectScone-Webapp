// Exercise the shipped React source page at a controlled, read-only HTTP boundary.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright');
const contract=require('../tests/fixtures/http-capabilities.json');
let browser;
before(async()=>{browser=await engines[process.env.SCONE_BROWSER_ENGINE||'chromium'].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});});
after(async()=>{await browser?.close();});
const original={attachment_id:'a'.repeat(64),media_type:'text/html',bytes:200,filename:'revenue.html'};
const manifest={attachment_id:'b'.repeat(64),media_type:'application/json',bytes:900};
const evidence={original,manifest,filename:'revenue.html',format:'html',parser:'fixture',segments:[
 {locator:'row:1',text:'Revenue',metadata:{},table_cells:[{locator:'header',table_locator:'table:1',row:0,column:0,row_span:1,column_span:1,is_header:true,text:'Revenue',start:0,end:7,headers:[]}]},
 {locator:'row:2',text:'Revenue: €20',metadata:{},table_cells:[{locator:'value',table_locator:'table:1',row:1,column:0,row_span:1,column_span:1,is_header:false,text:'€20',start:9,end:14,headers:[{locator:'header',text:'Revenue',association:'column'}]}]},
]};
for(const failure of ['none','forgotten','text','binding'])test(`table source controls and final evidence validation: ${failure}`,async t=>{
 const html=fs.readFileSync(process.env.SCONE_DOCUMENTS_HTML||path.resolve(__dirname,'../dist/console.html'),'utf8').replaceAll('__SCONE_TOKEN__','table-fixture');
 let reads=0,hold=null,notify=null,change=false;const writes=[];
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://fixture').pathname;
  if(pathname==='/memory/sources/1'){res.setHeader('content-type','text/html');return res.end(html);}
  if(pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
  if(req.method!=='GET')writes.push(req.method+' '+pathname);
  res.setHeader('content-type','application/json');
  assert.equal(req.headers.authorization,'Bearer table-fixture');
  if(pathname==='/v1/status')return res.end(JSON.stringify({space:'table-test',episodes:1}));
  if(pathname==='/v1/capabilities')return res.end(JSON.stringify({...contract.rust,features:{...contract.rust.features,'episodes.read':true,'documents.provenance':true,'episodes.attachments':false}}));
  if(pathname==='/v1/episodes/1'&&change&&failure==='forgotten'){res.statusCode=410;return res.end('{"error":"forgotten"}');}
  if(pathname==='/v1/episodes/1')return res.end(JSON.stringify({episode_id:1,kind:'file',source:'revenue.html',created_at:'2026-09-11',content:change&&failure==='text'?'Changed source':'Revenue\n\nRevenue: €20',metadata:{document_original:original.attachment_id,document_manifest:change&&failure==='binding'?'c'.repeat(64):manifest.attachment_id,document_format:'html'},attachments:[original,manifest]}));
  if(pathname==='/v1/episodes/1/document'){reads++;notify?.();if(hold)await hold;return res.end(JSON.stringify(evidence));}
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(5000);
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 t.after(async()=>{await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{}}});});
 await page.goto(`http://127.0.0.1:${server.address().port}/memory/sources/1?space=table-test`);
 await page.getByText('Inspect document tables',{exact:true}).click();const panel=page.getByRole('region',{name:'Document table evidence'});
 assert.equal(reads,0);await panel.getByRole('button',{name:'Read table evidence'}).click();await panel.getByRole('button',{name:'Inspect row 2, column 1'}).click();
 const detail=panel.getByRole('complementary',{name:'Selected table cell'});await detail.waitFor();assert.equal(await detail.locator('mark').innerText(),'€20');
 await page.getByRole('button',{name:'Copy source link',exact:true}).click();await page.getByText('Link copied.',{exact:true}).waitFor();assert.equal(reads,1);assert.equal(await detail.count(),1);
 await detail.getByRole('button',{name:'Revenue',exact:true}).click();await detail.getByRole('heading',{name:'Row 1, column 1 · Header'}).waitFor();
 await detail.getByRole('button',{name:'Close cell inspection'}).click();await detail.waitFor({state:'hidden'});
 await panel.getByRole('button',{name:'Inspect row 2, column 1'}).click();await detail.waitFor();
 let release;hold=new Promise(resolve=>release=resolve);const began=new Promise(resolve=>notify=resolve);
 try{
  await panel.getByRole('button',{name:'Retry table evidence'}).click();await panel.getByRole('status').filter({hasText:'Checking document attachments'}).waitFor();await began;await detail.waitFor({state:'hidden'});
  await panel.getByRole('button',{name:'Cancel table evidence'}).click();release();hold=null;notify=null;
  await panel.getByRole('button',{name:'Read table evidence'}).waitFor();assert.equal(await panel.locator('table').count(),0);
  await panel.getByRole('button',{name:'Read table evidence'}).click();await panel.getByRole('heading',{name:'Table 1 of 1'}).waitFor();
  await panel.getByRole('button',{name:'Clear table evidence'}).click();await panel.getByRole('button',{name:'Read table evidence'}).waitFor();assert.equal(await panel.locator('table').count(),0);assert.deepEqual(writes,[]);
 }finally{release();}
 if(failure!=='none'){
  // Return valid retained table bytes, then change the final source read.
  change=true;await panel.getByRole('button',{name:'Read table evidence',exact:true}).click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await panel.locator('table').count(),0);
  assert.equal(await panel.getByRole('complementary',{name:'Selected table cell'}).count(),0);
 }
});
