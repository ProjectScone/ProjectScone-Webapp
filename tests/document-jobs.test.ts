import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDocumentJob,parseDocumentJobPage,parseDocumentJobRequest,canResumeDocumentJob,canVerifyDocumentJob} from '../src/memory/document-jobs.ts';

const raw=()=>({import_id:'one',space:'alpha',filename:'notes.md',attachment_id:'a'.repeat(64),created_at:'2026-09-12T00:00:00+00:00',attempt:1,max_attempts:3,revision:1,status:'running',active_local:true,completed_steps:[],inflight:'extract',outcome_unknown:false,error_class:null});

test('job progress preserves identity and rejects foreign or inconsistent execution claims',()=>{
 const job=parseDocumentJob(raw(),'alpha','one');assert.equal(job.filename,'notes.md');assert.equal(canResumeDocumentJob(job),false);
 for(const change of [{space:'beta'},{import_id:'two'},{attempt:true},{revision:0},{max_attempts:0},{attempt:4},{active_local:'yes'},{status:'made-up'},{completed_steps:['index']},{completed_steps:['extract','extract']},{inflight:'other'},{status:'completed',inflight:null},{status:'completed',completed_steps:['extract','index'],inflight:'index'}]){
  assert.throws(()=>parseDocumentJob({...raw(),...change},'alpha','one'));
 }
 assert.equal(canResumeDocumentJob(parseDocumentJob({...raw(),status:'cancelled',active_local:false,outcome_unknown:true},'alpha')),true);
 assert.equal(canResumeDocumentJob(parseDocumentJob({...raw(),status:'failed',active_local:false,attempt:3,revision:3},'alpha')),false);
});

test('history rejects duplicate IDs, cross-space rows and broken cursor bounds',()=>{
 assert.equal(parseDocumentJobPage({items:[raw()],next_after:null},'alpha').items.length,1);
 for(const page of [{items:[raw(),raw()],next_after:null},{items:[{...raw(),space:'beta'}],next_after:null},{items:[],next_after:'cursor'},{items:[raw()],next_after:7}])assert.throws(()=>parseDocumentJobPage(page,'alpha'));
});

test('saved invocation must bind original filename, input and OCR to the selected job',()=>{
 const job=parseDocumentJob(raw(),'alpha');
 const request={space:'alpha',import_id:'one',spec:{attachment_id:job.attachmentId,filename:job.filename,parser_revision:'parser-v1',pdf_ocr:null,max_attempts:3,deadline_s:120}};
 assert.equal(parseDocumentJobRequest(request,job).pdfOcr,undefined);
 for(const change of [{space:'beta'},{import_id:'two'},{spec:{...request.spec,attachment_id:'b'.repeat(64)}},{spec:{...request.spec,filename:'another.md'}},{spec:{...request.spec,pdf_ocr:{mode:'all_pages',reading_order:'provider'}}}])assert.throws(()=>parseDocumentJobRequest({...request,...change},job));
});

test('temporary verification outages offer a read even with exhausted attempt budget',()=>{
 const job=parseDocumentJob({...raw(),status:'verification_unavailable',active_local:false,completed_steps:['extract','index'],inflight:null,max_attempts:1},'alpha');
 assert.equal(canVerifyDocumentJob(job),true);assert.equal(canResumeDocumentJob(job),false);
 assert.equal(canVerifyDocumentJob(parseDocumentJob({...raw(),status:'verification_unavailable',active_local:false,completed_steps:['extract'],inflight:'index'},'alpha')),false);
});

test('local submission binds OCR selection and explicit opt-out independently of server history',()=>{
 const job=parseDocumentJob({...raw(),filename:'scan.pdf'},'alpha');
 const chosen={mode:'all_pages' as const,reading_order:'columns_rtl' as const};
 const request={space:'alpha',import_id:'one',spec:{attachment_id:job.attachmentId,filename:job.filename,parser_revision:'parser-v1',pdf_ocr:null,max_attempts:3}};
 const expected={space:'alpha',attachmentId:job.attachmentId,filename:job.filename,pdfOcr:chosen};
 assert.throws(()=>parseDocumentJobRequest(request,job,expected),/submitted/);
 const saved={...request,spec:{...request.spec,pdf_ocr:chosen}};
 assert.deepEqual(parseDocumentJobRequest(saved,job,expected).pdfOcr,chosen);
 assert.throws(()=>parseDocumentJobRequest(saved,job,{...expected,pdfOcr:undefined}),/submitted/);
 assert.throws(()=>parseDocumentJobRequest(saved,job,{...expected,attachmentId:'b'.repeat(64)}));
});
