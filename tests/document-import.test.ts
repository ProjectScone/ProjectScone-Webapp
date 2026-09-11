import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createApiClient} from '../src/api.ts';
import {parseDocumentFormats,validateDocumentSelection,importDocument,verifyDocumentImport} from '../src/memory/document-import.ts';

const formats=()=>parseDocumentFormats({max_input_bytes:1024,formats:{'.csv':{available:true,parser:'text'},'.pdf':{available:false,parser:'pdf-text',requires:'pdf extra; OCR is opt-in'}}});
const file=()=>new File(['name,day\nlaunch,Friday\n'],'café.csv');

test('format discovery distinguishes installed parsers and validates selection limits',()=>{
 const catalog=formats();assert.equal(catalog.formats.get('.pdf')?.available,false);
 assert.equal(validateDocumentSelection([file()],catalog),undefined);
 assert.throws(()=>validateDocumentSelection([new File(['scan'],'scan.pdf')],catalog),/unavailable/i);
 assert.throws(()=>validateDocumentSelection([new File(['x'],'unknown.bin')],catalog),/supported/i);
 assert.throws(()=>validateDocumentSelection([new File([],'empty.csv')],catalog),/empty/i);
 assert.throws(()=>validateDocumentSelection([new File(['x'.repeat(1025)],'large.csv')],catalog),/limit/i);
 assert.throws(()=>validateDocumentSelection(Array.from({length:21},file),catalog),/20/);
 for(const name of ['bad\u0000.csv','é'.repeat(513)+'.csv'])assert.throws(()=>validateDocumentSelection([new File(['x'],name)],catalog),/filename/i);
 for(const value of [{max_input_bytes:0,formats:{}},{max_input_bytes:1024,formats:{'.csv':{available:'yes',parser:'text'}}},{max_input_bytes:1024,formats:{csv:{available:true,parser:'text'}}}])assert.throws(()=>parseDocumentFormats(value));
});

async function fixture(run:(client:ReturnType<typeof createApiClient>,calls:string[],change:(mode:string)=>void)=>Promise<void>){
 let mode='ok';const calls:string[]=[];
 const raw=Buffer.from(await file().arrayBuffer()),hash=createHash('sha256').update(raw).digest('hex');
 // Content-addressed blobs keep the first upload's name and media type.
 const original={attachment_id:hash,bytes:raw.length,media_type:'text/csv',filename:'old-name.txt'};
 const manifest={attachment_id:'b'.repeat(64),bytes:123,media_type:'application/json'};
 const receipt={added:{episode_id:7,deduplicated:false},original,manifest,format:'csv',filename:'café.csv',segments:1};
 const episode={episode_id:7,kind:'file',content:'launch,Friday',metadata:{document_original:hash,document_manifest:manifest.attachment_id,document_format:'csv'},attachments:[original,manifest]};
 const evidence={original,manifest,filename:'café.csv',format:'csv',parser:'text',segments:[{locator:'row:2',text:'launch,Friday'}]};
 const server=createServer(async(req,res)=>{
  calls.push(`${req.method} ${req.url}`);assert.equal(req.headers.authorization,'Bearer writer');
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  res.setHeader('content-type','application/json');
  if(req.url==='/redirected'){res.writeHead(403);return res.end('{}');}
  if(mode==='denied'){res.writeHead(403);return res.end('{"error":"read-only key"}');}
  if(req.url==='/v1/attachments'){
   assert.equal(req.headers['content-type'],'application/octet-stream');assert.deepEqual(body,raw);
   return res.end(JSON.stringify(mode==='bad-upload'?{...original,attachment_id:'c'.repeat(64)}:original));
  }
  if(req.url==='/v1/documents'){
   assert.deepEqual(JSON.parse(body.toString()),{attachment_id:hash,filename:'café.csv'});
   if(mode==='redirect-write'){res.writeHead(307,{location:'/redirected'});return res.end();}
   if(mode==='lost-write'){res.destroy();return;}
   return res.end(JSON.stringify(mode==='bad-receipt'?{...receipt,original:{...original,bytes:1}}:receipt));
  }
  if(req.url==='/v1/episodes/7')return res.end(JSON.stringify(mode==='wrong-source'?{...episode,episode_id:8}:episode));
  if(req.url==='/v1/episodes/7/document'){
   if(mode==='lost-read'){res.destroy();return;}
   return res.end(JSON.stringify(mode==='wrong-evidence'?{...evidence,segments:[{locator:'row:2',text:'invented'}]}:evidence));
  }
  res.writeHead(404);res.end('{}');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No address');
 try{await run(createApiClient('writer',()=>{},`http://127.0.0.1:${address.port}`),calls,value=>{mode=value;});}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}

test('import verifies raw bytes, explicit Unicode filename, saved identity and extracted evidence',async()=>fixture(async(api,calls)=>{
 const phases:string[]=[];const result=await importDocument(api,file(),formats(),new AbortController().signal,phase=>phases.push(phase));
 assert.equal(result.status,'verified');if(result.status!=='verified')return;
 assert.equal(result.verified.receipt.episodeId,7);assert.equal(result.verified.evidence.filename,'café.csv');
 assert.equal(result.verified.source.content,'launch,Friday');
 assert.deepEqual(phases,['uploading','indexing','verifying']);
 assert.deepEqual(calls,['POST /v1/attachments','POST /v1/documents','GET /v1/episodes/7','GET /v1/episodes/7/document']);
}));

test('invalid upload receipts never index; ambiguous indexing never retries automatically',async()=>fixture(async(api,calls,change)=>{
 change('bad-upload');assert.equal((await importDocument(api,file(),formats(),new AbortController().signal,()=>{})).status,'failed');
 assert.deepEqual(calls,['POST /v1/attachments']);calls.length=0;
 change('lost-write');assert.equal((await importDocument(api,file(),formats(),new AbortController().signal,()=>{})).status,'uncertain');
 assert.deepEqual(calls,['POST /v1/attachments','POST /v1/documents']);
}));

for(const mode of ['lost-read','wrong-source','wrong-evidence'])test(`a ${mode} outcome preserves the saved receipt for a read-only retry`,async()=>fixture(async(api,calls,change)=>{
 change(mode);const result=await importDocument(api,file(),formats(),new AbortController().signal,()=>{});
 assert.equal(result.status,'unverified');if(result.status!=='unverified')return;
 calls.length=0;change('ok');const verified=await verifyDocumentImport(api,result.receipt,new AbortController().signal);
 assert.equal(verified.source.content,'launch,Friday');assert.deepEqual(calls,['GET /v1/episodes/7','GET /v1/episodes/7/document']);
}));

test('permission denial is a retryable failure and malformed indexed identity is uncertain',async()=>fixture(async(api,calls,change)=>{
 change('denied');assert.equal((await importDocument(api,file(),formats(),new AbortController().signal,()=>{})).status,'failed');
 change('bad-receipt');assert.equal((await importDocument(api,file(),formats(),new AbortController().signal,()=>{})).status,'uncertain');
}));


test('an indexing redirect cannot turn a completed write into a retryable permission failure',async()=>fixture(async(api,calls,change)=>{
 change('redirect-write');const result=await importDocument(api,file(),formats(),new AbortController().signal,()=>{});
 assert.equal(result.status,'uncertain');assert.deepEqual(calls,['POST /v1/attachments','POST /v1/documents']);
}));


test('combined queue bytes are bounded and an already-cancelled import makes no requests',async()=>{
 const catalog=parseDocumentFormats({max_input_bytes:25*1024*1024,formats:{'.csv':{available:true,parser:'text'}}});
 const sized=Array.from({length:5},()=>{const value=file();Object.defineProperty(value,'size',{value:21*1024*1024});return value;});
 assert.throws(()=>validateDocumentSelection(sized,catalog),/100 MiB/);
 await fixture(async(api,calls)=>{const controller=new AbortController();controller.abort();const phases:string[]=[];
  const result=await importDocument(api,file(),formats(),controller.signal,phase=>phases.push(phase));
  assert.equal(result.status,'failed');assert.deepEqual(calls,[]);assert.deepEqual(phases,[]);
 });
});
