import test from 'node:test';
import assert from 'node:assert/strict';
import {readVideoFrame,type VideoFrameReference} from '../src/memory/document-video-frame.ts';

const pixels=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=','base64'));
async function fixture(){
 const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',pixels)).toString('hex');
 const expected:VideoFrameReference={ordinal:4,presentationTimestamp:'9007199254740993',timeBase:'1/16384',width:1,height:1,sha256,bytes:pixels.length};
 const headers={'content-type':'image/png','content-length':String(pixels.length),'x-scone-video-frame-sha256':sha256,
  'x-scone-video-frame-ordinal':'4','x-scone-video-pts':'9007199254740993','x-scone-video-time-base':'1/16384'};
 return {expected,headers};
}
test('frame bytes bind exact timestamp, hash, dimensions and ordinal',async()=>{
 const {expected,headers}=await fixture();
 const blob=await readVideoFrame(new Response(pixels,{headers}),expected,new AbortController().signal);
 assert.equal(blob.type,'image/png');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),pixels);
});
test('same pixels at a different time or ordinal cannot satisfy a frame citation',async()=>{
 const {expected,headers}=await fixture();
 for(const change of [{'x-scone-video-pts':'9007199254740992'},{'x-scone-video-time-base':'1/8192'},{'x-scone-video-frame-ordinal':'5'},{'content-type':'application/octet-stream'}]){
  await assert.rejects(readVideoFrame(new Response(pixels,{headers:{...headers,...change}}),expected,new AbortController().signal));
 }
});
test('reject changed bytes, dimensions and excess streamed data',async()=>{
 const {expected,headers}=await fixture(),signal=new AbortController().signal;
 const changed=pixels.slice();changed[changed.length-1]^=1;
 await assert.rejects(readVideoFrame(new Response(changed,{headers}),expected,signal));
 await assert.rejects(readVideoFrame(new Response(pixels,{headers}),{...expected,width:2},signal));
 const noLength={...headers};delete (noLength as Record<string,string>)['content-length'];
 await assert.rejects(readVideoFrame(new Response(new Uint8Array(pixels.length+1),{headers:noLength}),expected,signal));
});
test('invalid and cancelled frame requests close the response body',async()=>{
 const {expected,headers}=await fixture();
 for(const bad of [{...expected,ordinal:-1},{...expected,bytes:10000001},{...expected,presentationTimestamp:'1e3'}]){
  let cancelled=false;
  const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
  await assert.rejects(readVideoFrame(new Response(body,{headers}),bad,new AbortController().signal));
  assert.equal(cancelled,true);
 }
 const controller=new AbortController();controller.abort();
 await assert.rejects(readVideoFrame(new Response(pixels,{headers}),expected,controller.signal));
});
