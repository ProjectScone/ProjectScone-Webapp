import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocumentFormats,validateDocumentSelection,parseReceipt} from '../src/memory/document-import.ts';
import {parseDocumentJob,parseDocumentJobRequest} from '../src/memory/document-jobs.ts';

const catalogue=()=>({max_input_bytes:1000,formats:{'.ts':{available:true,parser:'code'}},video_ocr:{available:true,selection:{video_ocr:true},extensions:['.mp4','.mpegts'],extraction:'sampled-frame-text',includes_audio:false}});
test('a video-only server admits a video only with explicit visible-text selection',()=>{
 const parsed=parseDocumentFormats(catalogue()),file=new File(['video'],'slides.mp4');
 assert.throws(()=>validateDocumentSelection([file],parsed));
 assert.doesNotThrow(()=>validateDocumentSelection([file],parsed,[true]));
 assert.throws(()=>validateDocumentSelection([new File(['code'],'main.ts')],parsed,[true]));
 assert.doesNotThrow(()=>validateDocumentSelection([new File(['code'],'main.ts')],parsed));
});
test('video discovery refuses changed extraction, nonboolean availability and TypeScript takeover',()=>{
 for(const patch of [{includes_audio:true},{selection:{video_ocr:false}},{available:1},{extensions:['.ts']},{extraction:'speech'}]){
  const v=catalogue();Object.assign(v.video_ocr,patch);assert.throws(()=>parseDocumentFormats(v));
 }
});
test('receipt must explicitly acknowledge the selected video extraction mode',()=>{
 const original={attachment_id:'a'.repeat(64),media_type:'video/mp4',bytes:100},manifest={attachment_id:'b'.repeat(64),media_type:'application/json',bytes:200};
 const receipt={original,manifest,filename:'slides.mp4',format:'mp4',segments:1,added:{episode_id:1,deduplicated:false},video_ocr:true};
 assert.equal(parseReceipt(receipt,original,'slides.mp4',undefined,true).videoOcr,true);
 assert.throws(()=>parseReceipt(receipt,original,'slides.mp4'));
 for(const value of [undefined,false,null,1,'true'])assert.throws(()=>parseReceipt({...receipt,video_ocr:value},original,'slides.mp4',undefined,true));
});
test('retained jobs bind video choice to local submission and reject conflicting PDF mode',()=>{
 const job=parseDocumentJob({import_id:'one',space:'alpha',filename:'slides.mp4',attachment_id:'a'.repeat(64),created_at:'2026-09-12T00:00:00Z',attempt:1,max_attempts:3,revision:1,status:'running',active_local:true,completed_steps:[],inflight:'extract',outcome_unknown:false,error_class:null},'alpha');
 const spec={attachment_id:job.attachmentId,filename:job.filename,parser_revision:'v1',max_attempts:3,video_ocr:true};
 const body={space:'alpha',import_id:'one',spec},submitted={space:'alpha',filename:job.filename,attachmentId:job.attachmentId,videoOcr:true};
 assert.equal(parseDocumentJobRequest(body,job,submitted).videoOcr,true);
 assert.throws(()=>parseDocumentJobRequest(body,job,{...submitted,videoOcr:false}));
 for(const value of [undefined,false,null,1,'true'])assert.throws(()=>parseDocumentJobRequest({...body,spec:{...spec,video_ocr:value}},job,submitted));
 assert.throws(()=>parseDocumentJobRequest({...body,spec:{...spec,pdf_ocr:{mode:'all_pages',reading_order:'provider'}}},job,submitted));
});

test('zero text receipt requires explicit video OCR and zero chunks',()=>{
 const original={attachment_id:'a'.repeat(64),media_type:'video/mp4',bytes:100},manifest={attachment_id:'b'.repeat(64),media_type:'application/json',bytes:200};
 const receipt={original,manifest,filename:'slides.mp4',format:'mp4',segments:0,added:{episode_id:1,deduplicated:false,chunks:0},video_ocr:true};
 assert.equal(parseReceipt(receipt,original,'slides.mp4',undefined,true).segments,0);
 for(const chunks of [undefined,null,-1,1,'0'])assert.throws(()=>parseReceipt({...receipt,added:{...receipt.added,chunks}},original,'slides.mp4',undefined,true));
 assert.throws(()=>parseReceipt({...receipt,video_ocr:false},original,'slides.mp4'));
});
