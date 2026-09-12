// Authored contract fixture; all traffic stays on an ephemeral loopback server.
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{createHash}=require('node:crypto');
const engines=require(process.env.SCONE_PLAYWRIGHT_MODULE||'playwright'),engine=process.env.SCONE_BROWSER_ENGINE||'chromium';
const app=path.resolve(__dirname,'..'),contract=require(app+'/tests/fixtures/http-capabilities.json');
for(const mobile of [false,true])test(`durable imports survive navigation with explicit controls, mobile=${mobile}`,async t=>{
 const browser=await engines[engine].launch({headless:true,executablePath:process.env.SCONE_BROWSER_PATH});
 const html=fs.readFileSync(app+'/dist/console.html','utf8').replaceAll('__SCONE_TOKEN__','jobs-fixture');
 let job=null,original=null,content='',wrongSpace=false,loseAdmission=false;const writes=[],errors=[],resultReads=[];
 const filename=mobile?'report\u202egnp.txt':'notes.txt',displayName=mobile?'"report\\u202egnp.txt"':'notes.txt';
 const manifest={attachment_id:'b'.repeat(64),bytes:123,media_type:'application/json'};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');if(!url.pathname.startsWith('/v1/')){res.setHeader('content-type','text/html');return res.end(html);}
  assert.equal(req.headers.authorization,'Bearer jobs-fixture');res.setHeader('content-type','application/json');
  const send=value=>res.end(JSON.stringify(value));
  if(req.method==='POST'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);writes.push(url.pathname);
   if(url.pathname==='/v1/attachments'){content=raw.toString();original={attachment_id:createHash('sha256').update(raw).digest('hex'),bytes:raw.length,media_type:'application/octet-stream'};return send(original);}
   const body=JSON.parse(raw);
   if(url.pathname==='/v1/document-jobs'){
    job={space:'alpha',import_id:body.import_id,filename:body.filename,attachment_id:body.attachment_id,created_at:'2026-09-12T00:00:00+00:00',attempt:1,max_attempts:3,revision:1,status:'running',active_local:true,completed_steps:[],inflight:'extract',outcome_unknown:false,error_class:null};
    if(loseAdmission){res.destroy();return;}res.statusCode=202;return send(job);
   }
   assert.equal(body.expected_revision,job.revision);
   job.revision++;
   if(url.pathname.endsWith('/resume')){job.attempt++;job.status='running';job.active_local=true;job.outcome_unknown=false;res.statusCode=202;}
   else if(url.pathname.endsWith('/cancel')){job.status='cancelled';job.active_local=false;job.outcome_unknown=true;}
   else throw Error('Unexpected write');
   return send(job);
  }
  if(url.pathname==='/v1/capabilities')return send({...contract.python,features:{...contract.python.features,'episodes.list':true,'episodes.read':true,'episodes.attachments':true,'documents.provenance':true,'documents.files':true,'documents.jobs':true}});
  if(url.pathname==='/v1/status')return send({space:'alpha',episodes:job?1:0});
  if(url.pathname==='/v1/scopes')return send({scopes:{}});
  if(url.pathname==='/v1/recall')return send({items:[],facts:[],degraded:[],returned_bytes:0,space_bytes:0});
  if(url.pathname==='/v1/sources')return send({items:[],has_more:false,next_before:null});
  if(url.pathname==='/v1/documents/formats')return send({max_input_bytes:100000,formats:{'.txt':{available:true,parser:'text'},'.pdf':{available:true,parser:'pdf-text'}},pdf_ocr:{available:true,modes:['missing_text','all_pages'],reading_orders:['provider','columns_ltr','columns_rtl']}});
  if(url.pathname==='/v1/document-jobs')return send({items:job?[{...job,space:wrongSpace?'beta':'alpha'}]:[],next_after:null});
  if(url.pathname.endsWith('/request'))return send({space:'alpha',import_id:job.import_id,spec:{attachment_id:job.attachment_id,filename:job.filename,parser_revision:'parser-v1',max_attempts:job.max_attempts,pdf_ocr:null}});
  if(url.pathname.endsWith('/result')){resultReads.push(url.pathname);return send({space:'alpha',import_id:job.import_id,added:{episode_id:7,deduplicated:false},original,manifest,format:'text',filename:job.filename,segments:1});}
  if(url.pathname==='/v1/episodes/7')return send({episode_id:7,kind:'file',content,metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'text'},attachments:[original,manifest]});
  if(url.pathname==='/v1/episodes/7/document')return send({original,manifest,filename:job.filename,format:'text',parser:'text',segments:[{locator:'text:1',text:content}]});
  res.statusCode=404;send({error:'not found'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
 const base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base+'/memory#documents');
 const region=page.getByRole('region',{name:'Background document imports'});
 await region.getByText('No saved import jobs on this page.').waitFor();
 await region.getByRole('button',{name:'Import documents',exact:true}).click();
 await region.locator('input[type=file]').setInputFiles({name:filename,mimeType:'text/plain',buffer:Buffer.from('Ada maintains the observatory.')});
 await region.getByRole('button',{name:'Start 1 ready file',exact:true}).click();
 await region.getByText('Acknowledged by server',{exact:true}).waitFor();
 assert.equal(writes.filter(value=>value==='/v1/document-jobs').length,1);assert.equal(job.filename,filename);assert.equal((await region.textContent()).includes('\u202e'),false);
 await page.goto(base+'/memory#search');await page.goto(base+'/memory#documents');
 await region.getByText('Working',{exact:true}).waitFor();assert.equal(writes.length,2);
 job={...job,status:'completed',active_local:false,completed_steps:['extract','index'],inflight:null};
 await region.getByText('Indexing completed',{exact:true}).waitFor();
 await region.getByRole('button',{name:'Verify source for '+displayName}).click();
 await region.getByText('Source #7 · 1 extracted segment',{exact:false}).waitFor();
 await region.getByText('Inspect extracted source',{exact:true}).click();await region.getByText(content,{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.SCONE_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCONE_SCREENSHOT_DIR,`document-jobs-${mobile?'mobile':'desktop'}.png`),fullPage:true});
 await page.reload();await region.getByRole('button',{name:'Verify source for '+displayName}).waitFor();assert.equal(writes.length,2);
 job={...job,status:'verification_unavailable',max_attempts:1};
 await region.getByRole('button',{name:'Refresh import history'}).click();
 await region.getByText('Source verification unavailable',{exact:true}).waitFor();
 assert.equal(await region.getByRole('button',{name:'Resume '+displayName}).count(),0);
 await region.getByRole('button',{name:'Verify source for '+displayName}).click();
 await region.getByText('Source #7 · 1 extracted segment',{exact:false}).waitFor();assert.equal(writes.length,2);
 job.max_attempts=3;
 job={...job,status:'cancelled',completed_steps:[],inflight:'extract',outcome_unknown:true,revision:2};
 await region.getByRole('button',{name:'Refresh import history'}).click();
 await region.getByRole('button',{name:'Resume '+displayName}).click();
 await region.getByRole('button',{name:'Cancel '+displayName}).click();
 await region.getByText('Cancelled',{exact:true}).waitFor();assert.equal(job.revision,4);assert.equal(job.attempt,2);
 wrongSpace=true;await region.getByRole('button',{name:'Refresh import history'}).click();await region.getByRole('alert').filter({hasText:'inconsistent document job'}).waitFor();
 assert.equal(await region.getByRole('button',{name:'Resume '+displayName}).isDisabled(),true);
 wrongSpace=false;await page.reload();await region.getByText('Cancelled',{exact:true}).waitFor();
 loseAdmission=true;await region.getByRole('button',{name:'Import documents',exact:true}).click();
 await region.locator('input[type=file]').setInputFiles({name:'lost.txt',mimeType:'text/plain',buffer:Buffer.from('A retained original.')});
 await region.getByRole('button',{name:'Start 1 ready file'}).click();await region.getByText('Admission unconfirmed',{exact:true}).waitFor();
 const admittedId=job.import_id,writeCount=writes.length;
 page.once('dialog',dialog=>dialog.accept());await page.reload();await region.getByText('lost.txt',{exact:true}).waitFor();
 assert.equal(job.import_id,admittedId);assert.equal(writes.length,writeCount);
 loseAdmission=false;await region.getByRole('button',{name:'Import documents',exact:true}).click();
 await region.locator('input[type=file]').setInputFiles({name:'scan.pdf',mimeType:'application/pdf',buffer:Buffer.from('fixture PDF bytes')});
 await region.getByLabel('PDF extraction for scan.pdf').selectOption('all_pages');
 await region.getByLabel('OCR reading order for scan.pdf').selectOption('columns_rtl');
 await region.getByRole('button',{name:'Start 1 ready file'}).click();
 await region.getByText('Admission unconfirmed',{exact:true}).waitFor();
 await region.getByRole('alert').filter({hasText:'submitted file and OCR choice'}).waitFor();
 const beforeVerify=resultReads.length;job={...job,status:'completed',active_local:false,completed_steps:['extract','index'],inflight:null};
 await page.goto(base+'/memory#search');await page.goto(base+'/memory#documents');
 await region.getByRole('button',{name:'Verify source for scan.pdf'}).click();
 await region.getByRole('alert').filter({hasText:'submitted file and OCR choice'}).waitFor();
 assert.equal(resultReads.length,beforeVerify);assert.equal(await region.getByText('Source #7',{exact:false}).count(),0);assert.deepEqual(errors,[]);
});
