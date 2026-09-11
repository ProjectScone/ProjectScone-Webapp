import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readDocumentOriginal,downloadFilename} from '../src/memory/document-download.ts';
const bytes=new TextEncoder().encode('<html>original café</html>');
const original={attachment_id:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,media_type:'text/html'};
const response=(data:Uint8Array=bytes,headers:Record<string,string>={})=>new Response(data,{headers:{'content-type':'text/html',...headers}});
test('document download verifies exact original bytes and uses an inert download blob',async()=>{
 const file=await readDocumentOriginal(response(),original);
 assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);assert.equal(file.type,'application/octet-stream');
});
test('unsafe identities, changed MIME, corrupted bytes and truncated or excessive streams fail closed',async()=>{
 for(const bad of [{...original,attachment_id:'../../secret'},{...original,bytes:0},{...original,bytes:100*1024*1024+1}])await assert.rejects(readDocumentOriginal(response(),bad));
 await assert.rejects(readDocumentOriginal(response(bytes,{'content-type':'application/pdf'}),original),/type/i);
 await assert.rejects(readDocumentOriginal(response(new Uint8Array(bytes.length)),original),/digest/i);
 await assert.rejects(readDocumentOriginal(response(bytes.subarray(1)),original),/size/i);
 await assert.rejects(readDocumentOriginal(response(new Uint8Array(bytes.length+1)),original),/size/i);
 for(const length of ['nonsense',String(bytes.length+1)])await assert.rejects(readDocumentOriginal(response(bytes,{'content-length':length}),original),/size/i);
});
test('stream cancellation releases stalled reads and cannot return a partial original',async()=>{
 const controller=new AbortController();let cancelled=false;
 const stream=new ReadableStream({start(c){c.enqueue(bytes.subarray(0,3));},cancel(){cancelled=true;}});
 const pending=readDocumentOriginal(new Response(stream,{headers:{'content-type':'text/html'}}),original,controller.signal);
 controller.abort();await assert.rejects(pending);assert.equal(cancelled,true);
});
test('download names preserve Unicode basenames while removing local paths and controls',()=>{
 assert.equal(downloadFilename('café.csv'),'café.csv');assert.equal(downloadFilename('../private/report.pdf'),'report.pdf');
 assert.equal(downloadFilename('C:\\private\\report.docx'),'report.docx');assert.equal(downloadFilename('bad\u0000name.txt'),'bad_name.txt');
 assert.equal(downloadFilename('..'),'original-document');assert.equal(downloadFilename(''),'original-document');
 assert.ok(new TextEncoder().encode(downloadFilename('é'.repeat(200)+'.pdf')).length<=240);
 assert.match(downloadFilename('é'.repeat(200)+'.pdf'),/\.pdf$/);
});

test('a source forgotten while bytes download cannot become a prepared file',async()=>{
 const {prepareDocumentOriginal}=await import('../src/memory/document-download.ts');
 const manifest={attachment_id:'b'.repeat(64),bytes:50,media_type:'application/json'};
 const source={content:'extracted',binding:{original,manifest,format:'html'}};
 const episode={episode_id:7,kind:'file',content:'extracted',metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'html'},attachments:[original,manifest]};
 const evidence={original,manifest,filename:'original.html',format:'html',parser:'text',segments:[{locator:'line:1',text:'extracted'}]};
 let removed=false,reads=0;
 const api={async request<T>(path:string):Promise<T>{if(path.endsWith('/document'))return evidence as T;reads++;if(removed)throw Error('source forgotten');return episode as T;},async documentOriginal(){removed=true;return new Blob([bytes]);}};
 await assert.rejects(prepareDocumentOriginal(api,source,7,new AbortController().signal),/forgotten/);assert.equal(reads,2);
});

test('the native server may deliver a typed original as an inert binary attachment',async()=>{
 const result=await readDocumentOriginal(response(bytes,{'content-type':'application/octet-stream'}),original);
 assert.deepEqual(new Uint8Array(await result.arrayBuffer()),bytes);assert.equal(result.type,'application/octet-stream');
});
