import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createApiClient} from '../src/api.ts';
import {parseDocumentFormats,importDocument,verifyDocumentImport} from '../src/memory/document-import.ts';
import {parsePdfOcrSelection,parsePdfOcrEvidence} from '../src/memory/document-ocr.ts';

const selection={mode:'missing_text',reading_order:'columns_ltr'} as const;
const discovery={available:true,modes:['missing_text','all_pages'],reading_orders:['provider','columns_ltr','columns_rtl']};
const formats=(pdf_ocr:unknown=discovery)=>parseDocumentFormats({max_input_bytes:1024,formats:{'.pdf':{available:true,parser:'pdf-text'}},pdf_ocr});

test('OCR discovery and selection are strict, bounded and opt-in',()=>{
 assert.deepEqual(parsePdfOcrSelection(selection),selection);
 assert.deepEqual(parsePdfOcrEvidence(JSON.stringify({...selection,dpi:150})),{...selection,dpi:150});
 assert.equal(formats().pdfOcr?.available,true);
 assert.equal(formats(undefined).formats.get('.pdf')?.available,true);
 for(const value of [true,{},null,{...selection,dpi:150},{...selection,mode:'auto'},{...selection,reading_order:'diagonal'}])assert.throws(()=>parsePdfOcrSelection(value));
 for(const value of [{...discovery,available:'yes'},{...discovery,modes:['all_pages','all_pages']},{...discovery,reading_orders:['unknown']},{...discovery,modes:[]}])assert.throws(()=>formats(value));
 for(const value of [{...selection,dpi:71},{...selection,dpi:301},{...selection,dpi:150,executable:'x'}])assert.throws(()=>parsePdfOcrEvidence(JSON.stringify(value)));
});

async function fixture(run:(api:ReturnType<typeof createApiClient>,calls:string[],change:(mode:string)=>void,file:File)=>Promise<void>){
 let mode='ok';const calls:string[]=[];
 const raw=Buffer.from('%PDF-local-fixture'),hash=createHash('sha256').update(raw).digest('hex');
 const file=new File([raw],'scan.pdf'),original={attachment_id:hash,bytes:raw.length,media_type:'application/pdf'};
 const manifest={attachment_id:'b'.repeat(64),bytes:123,media_type:'application/json'};
 const receipt={added:{episode_id:7,deduplicated:false},original,manifest,format:'pdf',filename:'scan.pdf',segments:1,pdf_ocr:selection};
 const episode={episode_id:7,kind:'file',content:'Café Polaris',metadata:{document_original:hash,document_manifest:manifest.attachment_id,document_format:'pdf'},attachments:[original,manifest]};
 const evidence={original,manifest,filename:'scan.pdf',format:'pdf',parser:'pypdf+scone-ocr-v1+columns_ltr-v1',metadata:{pdf_ocr:JSON.stringify({...selection,dpi:150})},segments:[{locator:'page:1',text:'Café Polaris',metadata:{extraction:'ocr',ocr_engine:'local'}}]};
 const server=createServer(async(req,res)=>{
  calls.push(`${req.method} ${req.url}`);const chunks:Buffer[]=[];for await(const part of req)chunks.push(part);
  res.setHeader('content-type','application/json');
  if(req.url==='/v1/status')return res.end(JSON.stringify({space:'alpha'}));
  if(req.url==='/v1/attachments')return res.end(JSON.stringify(original));
  if(req.url==='/v1/documents'){
   assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()),{attachment_id:hash,filename:'scan.pdf',pdf_ocr:selection});
   if(mode==='lost'){res.destroy();return;}
   return res.end(JSON.stringify(mode==='wrong-receipt'?{...receipt,pdf_ocr:{...selection,mode:'all_pages'}}:receipt));
  }
  if(req.url==='/v1/episodes/7')return res.end(JSON.stringify(episode));
  if(req.url==='/v1/episodes/7/document')return res.end(JSON.stringify(mode==='wrong-evidence'?{...evidence,metadata:{pdf_ocr:JSON.stringify({...selection,reading_order:'provider',dpi:150})}}:mode==='missing-evidence'?{...evidence,metadata:{}}:evidence));
  res.writeHead(404);res.end('{}');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No address');
 try{await run(createApiClient('writer',()=>{},`http://127.0.0.1:${address.port}`),calls,value=>{mode=value;},file);}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}

test('selected OCR survives upload, verified provenance and read-only reinspection',async()=>fixture(async(api,calls,_,file)=>{
 const result=await importDocument(api,file,formats(),new AbortController().signal,()=>{},selection);
 assert.equal(result.status,'verified');if(result.status!=='verified')return;
 assert.deepEqual(result.verified.receipt.pdfOcr,selection);
 assert.deepEqual(result.verified.evidence.pdfOcr,{...selection,dpi:150});
 assert.equal(result.verified.evidence.segments[0].extraction,'ocr');
 calls.length=0;await verifyDocumentImport(api,result.verified.receipt,new AbortController().signal);
 assert.deepEqual(calls,['GET /v1/status','GET /v1/episodes/7','GET /v1/episodes/7/document','GET /v1/episodes/7']);
}));

for(const mode of ['wrong-evidence','missing-evidence'])test(`OCR ${mode} keeps acknowledged source for read-only recovery`,async()=>fixture(async(api,calls,change,file)=>{
 change(mode);const result=await importDocument(api,file,formats(),new AbortController().signal,()=>{},selection);
 assert.equal(result.status,'unverified');if(result.status!=='unverified')return;
 calls.length=0;change('ok');await verifyDocumentImport(api,result.receipt,new AbortController().signal);
 assert.deepEqual(calls,['GET /v1/status','GET /v1/episodes/7','GET /v1/episodes/7/document','GET /v1/episodes/7']);
}));

for(const mode of ['wrong-receipt','lost'])test(`OCR ${mode} is uncertain and never repeated`,async()=>fixture(async(api,calls,change,file)=>{
 change(mode);const result=await importDocument(api,file,formats(),new AbortController().signal,()=>{},selection);
 assert.equal(result.status,'uncertain');assert.deepEqual(calls,['POST /v1/attachments','POST /v1/documents']);
}));

test('unavailable OCR and unadvertised choices fail before uploading',async()=>fixture(async(api,calls,_,file)=>{
 for(const catalog of [formats({...discovery,available:false}),formats({...discovery,modes:['all_pages']}),formats({...discovery,reading_orders:['provider']})]){
  const result=await importDocument(api,file,catalog,new AbortController().signal,()=>{},selection);
  assert.equal(result.status,'failed');assert.deepEqual(calls,[]);
 }
}));
