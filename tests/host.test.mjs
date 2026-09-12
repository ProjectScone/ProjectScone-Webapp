import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';

import * as hostModule from '../scripts/host.mjs';
const html='<!doctype html><html><body><div id="root"></div><script id="scone-bootstrap" type="application/json">{"key":"__SCONE_TOKEN__"}</script></body></html>';
async function listen(t,server) {
  const sockets=new Set();server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{for(const socket of sockets)socket.destroy();server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(t,options={}) {
  assert.equal(typeof hostModule.createUiHost,'function','standalone UI host is exported');
  const backend=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({path:req.url,authorization:req.headers.authorization??null,forwarded:req.headers['x-forwarded-host']??null}));});
  const backendUrl=await listen(t,backend);
  const ui=hostModule.createUiHost({html,backend:backendUrl,...options});
  const base=await listen(t,ui);return {base,backend,ui};
}
function raw(base,path,headers={},method='GET') {
  return new Promise((resolve,reject)=>{
    const req=http.request(base+path,{headers,method},res=>{let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();
  });
}
test('serves named SPA deep links, HEAD and ETags without embedding a key',async t=>{
  const {base}=await fixture(t);
  for(const path of ['/','/memory','/memory/sources/123','/memory/sources/123/forget?space=alpha','/playground','/agents','/conversations/saved-session','/learn','/learn/how-it-works','/learn/graph-memory','/docs','/docs/quickstart']) {
    const response=await raw(base,path);assert.equal(response.status,200,path);assert.match(response.body,/<div id="root">/);assert.doesNotMatch(response.body,/__SCONE_TOKEN__/);
  }
  const response=await raw(base,'/memory');assert.ok(response.headers.etag);
  assert.equal((await raw(base,'/memory',{'if-none-match':response.headers.etag})).status,304);
  const head=await raw(base,'/memory',{},'HEAD');assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(head.headers.etag,response.headers.etag);
  assert.equal((await raw(base,'/not-a-page')).status,404);
  assert.equal((await raw(base,'/memory',{},'POST')).status,405);
});
test('runtime bootstrap is no-store, local peer and raw Host constrained; guides are keyless',async t=>{
  const key='secret</script>\u2028token';const {base}=await fixture(t,{uiKey:key});
  const session=await raw(base,'/__scone/session');assert.equal(session.status,200);assert.equal(JSON.parse(session.body).key,key);assert.equal(session.headers['cache-control'],'no-store');
  const page=await raw(base,'/memory');assert.equal(page.headers['cache-control'],'no-store');assert.doesNotMatch(page.body,/secret<\/script>/);assert.match(page.body,/secret\\u003c/);
  for(const host of ['evil.example','127.0.0.1.evil.example','localhost@evil.example','127.0.0.1:bad']) {
    const rejected=await raw(base,'/__scone/session',{host,'x-forwarded-host':'localhost','x-forwarded-for':'127.0.0.1'});assert.equal(rejected.status,403);assert.doesNotMatch(rejected.body,/secret/);
    assert.doesNotMatch((await raw(base,'/memory',{host})).body,/secret/);
  }
  for(const route of ['/learn','/docs/quickstart']) assert.doesNotMatch((await raw(base,route)).body,/secret/);
  assert.equal(hostModule.trustedLocalRequest({socket:{remoteAddress:'192.168.1.5'},headers:{host:'localhost'},rawHeaders:['Host','localhost']}),false);
  assert.equal((await raw(base,'/__scone/session',{origin:'http://evil.example'})).status,403);
});
test('API proxy forwards bearer and paths without injecting the optional UI key',async t=>{
  const {base}=await fixture(t,{uiKey:'bootstrap-only'});
  const response=await fetch(base+'/v1/conversations/a?after=3',{headers:{authorization:'Bearer manual-key','x-forwarded-host':'evil.example'}});
  assert.deepEqual(await response.json(),{path:'/v1/conversations/a?after=3',authorization:'Bearer manual-key',forwarded:null});
  assert.equal((await(await fetch(base+'/v1/capabilities')).json()).authorization,null);
  assert.equal((await fetch(base+'/healthz')).status,200);
});
test('SSE reaches the browser before the upstream finishes and cancellation closes upstream',async t=>{
  const {base,backend}=await fixture(t);backend.removeAllListeners('request');
  let upstreamClosed;const closed=new Promise(resolve=>upstreamClosed=resolve);
  backend.on('request',(req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');res.on('close',upstreamClosed);});
  const response=await fetch(base+'/v1/events',{signal:AbortSignal.timeout(3000)});
  const reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'data: first\n\n');
  await reader.cancel();await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('upstream not closed')),1000);timer.unref();})]);
});
test('WebSocket upgrade forwards protocol, authentication and binary frames',async t=>{
  const {base,backend}=await fixture(t);
  let protocol;
  backend.on('upgrade',(req,socket,head)=>{
    protocol=req.headers['sec-websocket-protocol'];
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\nSec-WebSocket-Protocol: scone.voice\r\n\r\n');
    socket.on('data',data=>{assert.ok(data.length>2);socket.write(Buffer.from([0x82,3,1,2,3]));});
    t.after(()=>socket.destroy());
  });
  const ws=new WebSocket(base.replace('http:','ws:')+'/v1/voice',['scone.voice','scone.key.manual']);
  t.after(()=>ws.close());await once(ws,'open');
  const received=once(ws,'message');ws.send(new Uint8Array([4,5]));
  const [event]=await received;assert.deepEqual([...new Uint8Array(await event.data.arrayBuffer())],[1,2,3]);assert.equal(protocol,'scone.voice, scone.key.manual');
});

test('duplicate and missing raw Host fields never receive the runtime key',async t=>{
  const {base}=await fixture(t,{uiKey:'never-leak'});
  assert.equal(hostModule.trustedLocalRequest({socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost'},rawHeaders:['Host','localhost','Host','evil.example']}),false);
  assert.equal(hostModule.trustedLocalRequest({socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost'},rawHeaders:[]}),false);
  const response=await raw(base,'/memory',['Host','localhost','Host','evil.example']);assert.doesNotMatch(response.body,/never-leak/);
});
test('backend configuration rejects implicit, credentialed and nonlocal origins',()=>{
  for(const backend of [undefined,'https://example.com','http://name:secret@localhost','http://localhost/path','http://localhost/?key=secret']) assert.throws(()=>hostModule.createUiHost({html,backend}));
});

test('CLI shutdown closes an active WebSocket and exits promptly',async t=>{
  const {spawn}=await import('node:child_process');
  const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'scone-host-shutdown-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=path.join(folder,'console.html');fs.writeFileSync(file,html);
  const backend=http.createServer();const backendUrl=await listen(t,backend);
  backend.on('upgrade',(req,socket)=>{
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  });
  const reservation=http.createServer();const reserved=await listen(t,reservation);const port=new URL(reserved).port;
  await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[new URL('../scripts/host.mjs',import.meta.url).pathname],{env:{...process.env,SCONE_API_URL:backendUrl,SCONE_UI_PORT:port,SCONE_UI_HTML:file},stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const exit=once(child,'exit');
  await Promise.race([once(child.stdout,'data'),exit.then(()=>{throw Error('Host exited before ready');})]);
  const ws=new WebSocket(reserved.replace('http:','ws:')+'/v1/voice');await once(ws,'open');
  t.after(()=>ws.close());child.kill('SIGTERM');
  const [code,signal]=await Promise.race([exit,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Host did not exit with an active WebSocket')),1000);timer.unref();})]);
  assert.equal(code,0);assert.equal(signal,null);
});
