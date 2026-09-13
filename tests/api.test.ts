import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApiClient, ApiError } from '../src/api.ts';
import { createHash } from 'node:crypto';

for(const operation of ['request','upload','document','original','image','stream','export'] as const)test(`a ${operation} permission denial preserves credentials but an invalid key expires them`,async()=>{
  let status=403,expired=0;
  const server=createServer((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer reader');
    res.setHeader('content-type','application/json');
    if(req.url==='/v1/status')return res.end('{"space":"alpha"}');
    res.statusCode=status;res.end('{"error":"key role read cannot write","code":"operation_forbidden"}');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('missing local address');
  const client=createApiClient('reader',()=>{expired++;},`http://127.0.0.1:${address.port}`);
  const attempt=()=>operation==='request'?client.request('/v1/episodes',{method:'POST',body:'{"content":"denied"}'}):
    operation==='upload'?client.uploadImage(new File(['opaque fixture'],'test.png',{type:'image/png'})):
    operation==='document'?client.uploadDocument(new File(['document fixture'],'test.csv')):
    operation==='original'?client.documentOriginal({attachment_id:'a'.repeat(64),media_type:'application/pdf',bytes:1}):
    operation==='image'?client.image({attachment_id:'a'.repeat(64),media_type:'image/png',bytes:1}):
    operation==='export'?client.graphExport({format:'json',space:'alpha',status:'current',asOf:'2026-09-11T12:00:00Z',digest:'a'.repeat(64),revision:1}):
    client.conversationStream('session','turn',0,new AbortController().signal);
  try{
    await assert.rejects(attempt(),e=>e instanceof ApiError&&e.status===403);
    assert.equal(expired,0,'A valid key with a restricted role must not trigger a global disconnect.');
    assert.deepEqual(await client.request('/v1/status'),{space:'alpha'});
    status=401;await assert.rejects(attempt(),e=>e instanceof ApiError&&e.status===401);
    assert.equal(expired,1,'Invalid credentials must still expire the session.');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('conversation streams authenticate a read-only cursor and reject redirects, unsafe paths and non-SSE responses',async()=>{
  let status=200,type='text/event-stream; charset=utf-8',denied=false,calls=0;
  const server=createServer((req,res)=>{
    calls++;assert.equal(req.method,'GET');assert.equal(req.url,'/v1/conversations/session/turns/turn/stream?after=7');
    assert.equal(req.headers.authorization,'Bearer allowed');assert.equal(req.headers.accept,'text/event-stream');
    res.writeHead(status,{'content-type':type,location:'/unexpected'});res.end(': keep-alive\n\n');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('missing address');
  const client=createApiClient('allowed',()=>{denied=true;},`http://127.0.0.1:${address.port}`);
  const controller=new AbortController();
  try{
    assert.equal(typeof client.conversationStream,'function');
    const stream=await client.conversationStream('session','turn',7,controller.signal);
    assert.equal(await new Response(stream).text(),': keep-alive\n\n');
    for(const bad of ['../secret','..','.','https://elsewhere','with/slash'])await assert.rejects(client.conversationStream(bad,'turn',7,controller.signal));
    await assert.rejects(client.conversationStream('session','turn',-1,controller.signal));assert.equal(calls,1);
    type='application/json';await assert.rejects(client.conversationStream('session','turn',7,controller.signal),/stream/i);
    type='text/event-stream';status=302;await assert.rejects(client.conversationStream('session','turn',7,controller.signal));assert.equal(calls,3);
    status=401;await assert.rejects(client.conversationStream('session','turn',7,controller.signal),e=>e instanceof ApiError&&e.status===401);assert.equal(denied,true);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('an acknowledged no-content delete succeeds but an empty read still fails', async()=>{
  const server=createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer allowed');res.writeHead(204);res.end();});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('missing address');
  const client=createApiClient('allowed',()=>{},`http://127.0.0.1:${address.port}`);
  try{
    assert.equal(await client.request('/v1/conversations/ended',{method:'DELETE'}),undefined);
    await assert.rejects(client.request('/v1/status'),/invalid JSON/);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('typed client sends the selected key and reports permission failure', async () => {
  let denied = false;
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer allowed') { res.statusCode = 401; return res.end('{"error":"unknown key"}'); }
    res.end('{"space":"private"}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('missing local address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(await createApiClient('allowed', () => {}, base).request('/v1/status'), { space: 'private' });
    await assert.rejects(createApiClient('wrong', () => { denied = true; }, base).request('/v1/status'), (error: unknown) => error instanceof ApiError && error.status === 401);
    assert.equal(denied, true);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('image downloads authenticate, validate bytes and reject unsafe content', async () => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
  const id = createHash('sha256').update(bytes).digest('hex');
  let type='image/png', status=200, calls=0, denied=false;
  const server=createServer((req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer allowed');res.writeHead(status,{'content-type':type});res.end(bytes);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('missing address');
  const client=createApiClient('allowed',()=>{denied=true;},`http://127.0.0.1:${address.port}`);
  const attachment={attachment_id:id,media_type:'image/png',bytes:bytes.length,filename:'pixel.png'};
  try {
    const blob=await client.image(attachment);
    assert.equal(blob.type,'image/png');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);
    await assert.rejects(client.image({...attachment,attachment_id:'../../etc/passwd'}));assert.equal(calls,1);
    await assert.rejects(client.image({...attachment,media_type:'image/svg+xml'}));assert.equal(calls,1);
    await assert.rejects(client.image({...attachment,bytes:26*1024*1024}));assert.equal(calls,1);
    type='text/html';await assert.rejects(client.image(attachment),/type/i);
    type='image/png';await assert.rejects(client.image({...attachment,bytes:bytes.length-1}),/size/i);
    await assert.rejects(client.image({...attachment,attachment_id:'a'.repeat(64)}),/digest/i);
    status=404;await assert.rejects(client.image(attachment),error=>error instanceof ApiError&&error.status===404);assert.equal(denied,false);
    status=401;await assert.rejects(client.image(attachment));assert.equal(denied,true);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('image uploads send exact bytes and validate the receipt before linking', async () => {
  const bytes=Buffer.from('an opaque raster fixture');
  const digest=createHash('sha256').update(bytes).digest('hex');let bad=false,calls=0;
  const server=createServer((req,res)=>{
    calls++;assert.equal(req.method,'POST');assert.equal(req.url,'/v1/attachments');
    assert.equal(req.headers.authorization,'Bearer allowed');assert.equal(req.headers['content-type'],'image/png');
    const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
      assert.deepEqual(Buffer.concat(chunks),bytes);
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({attachment_id:bad?'a'.repeat(64):digest,bytes:bytes.length,media_type:'image/png',filename:'source.png'}));
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('missing address');
  const client=createApiClient('allowed',()=>{},`http://127.0.0.1:${address.port}`);
  const file=new File([bytes],'source.png',{type:'image/png'});
  try {
    assert.equal((await client.uploadImage(file)).attachment_id,digest);
    await assert.rejects(client.uploadImage(new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'})),/image|type/i);
    await assert.rejects(client.uploadImage(new File([],'empty.png',{type:'image/png'})),/size|empty/i);
    assert.equal(calls,1);
    bad=true;await assert.rejects(client.uploadImage(file),/receipt|digest/i);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('graph exports authenticate a fixed native route and reject redirects',async()=>{
 const request={format:'json' as const,space:'alpha',status:'current' as const,asOf:'2026-09-11T12:00:00Z',digest:'a'.repeat(64),revision:3};let redirect=false,calls=0;
 const server=createServer((req,res)=>{calls++;assert.equal(req.method,'GET');assert.equal(req.headers.authorization,'Bearer export-key');const url=new URL(req.url!,'http://local');assert.equal(url.pathname,'/v1/graph/export');assert.equal(url.searchParams.get('format'),'json');assert.equal(url.searchParams.get('as_of'),request.asOf);
  if(redirect){res.writeHead(302,{location:'/unexpected'});return res.end();}
  res.writeHead(200,{'content-type':'application/json','x-scone-space':'alpha','x-scone-status':'current','x-scone-as-of':request.asOf,'x-scone-projection-digest':request.digest,'x-scone-projection-revision':'3','x-scone-truncated':'false'});res.end('{"nodes":[]}');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No local address');
 const api=createApiClient('export-key',()=>{},`http://127.0.0.1:${address.port}`);
 try{const file=await api.graphExport(request);assert.equal(await file.blob.text(),'{"nodes":[]}');redirect=true;await assert.rejects(api.graphExport(request));assert.equal(calls,2);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test('original-file download authenticates a fixed attachment path and refuses redirects',async()=>{
 const bytes=Buffer.from('exact original file'),attachment_id=createHash('sha256').update(bytes).digest('hex');let redirect=false,calls=0;
 const server=createServer((req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer original-key');assert.equal(req.method,'GET');assert.equal(req.url,'/v1/attachments/'+attachment_id);
  if(redirect){res.writeHead(307,{location:'/unexpected'});return res.end();}
  res.writeHead(200,{'content-type':'application/pdf'});res.end(bytes);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No address');
 const api=createApiClient('original-key',()=>{},`http://127.0.0.1:${address.port}`),original={attachment_id,bytes:bytes.length,media_type:'application/pdf'};
 try{assert.deepEqual(Buffer.from(await (await api.documentOriginal(original)).arrayBuffer()),bytes);redirect=true;await assert.rejects(api.documentOriginal(original));assert.equal(calls,2);await assert.rejects(api.documentOriginal({...original,attachment_id:'../elsewhere'}));assert.equal(calls,2);}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('history streams send the cursor both ways and refuse non-SSE responses, redirects and bad cursors',async()=>{
  let status=200,type='text/event-stream; charset=utf-8',denied=false,calls=0,lastEventId:string|undefined;
  const cursor='0'.repeat(32)+'.'+'0'.repeat(15)+'3.'+'b'.repeat(64);
  const server=createServer((req,res)=>{
    calls++;assert.equal(req.method,'GET');assert.equal(req.headers.authorization,'Bearer allowed');assert.equal(req.headers.accept,'text/event-stream');
    lastEventId=req.headers['last-event-id'] as string|undefined;
    res.writeHead(status,{'content-type':type,location:'/unexpected'});res.end(': keep-alive\n\n');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('missing address');
  const client=createApiClient('allowed',()=>{denied=true;},`http://127.0.0.1:${address.port}`);
  const controller=new AbortController();
  try{
    const stream=await client.historyStream('run-1',cursor,50,controller.signal);
    assert.equal(await new Response(stream).text(),': keep-alive\n\n');
    assert.equal(lastEventId,cursor,'the cursor travels as Last-Event-ID as well as the query');
    await client.historyStream('run-1',null,25,controller.signal);
    assert.equal(lastEventId,undefined,'no cursor, no Last-Event-ID');
    for(const bad of ['../secret','..','with/slash'])await assert.rejects(client.historyStream(bad,null,50,controller.signal));
    await assert.rejects(client.historyStream('run-1','not-a-cursor',50,controller.signal),/cursor/i);
    await assert.rejects(client.historyStream('run-1',null,0,controller.signal));
    await assert.rejects(client.historyStream('run-1',null,101,controller.signal));
    assert.equal(calls,2);
    type='application/json';await assert.rejects(client.historyStream('run-1',null,50,controller.signal),/stream/i);
    type='text/event-stream';status=302;await assert.rejects(client.historyStream('run-1',null,50,controller.signal));
    status=401;await assert.rejects(client.historyStream('run-1',null,50,controller.signal),e=>e instanceof ApiError&&e.status===401);assert.equal(denied,true);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
