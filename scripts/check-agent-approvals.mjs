/** Real packaged React regressions; configure a locally installed browser and Playwright. */
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.SCONE_PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const html=fs.readFileSync(root+'/dist/console.html','utf8').replaceAll('__SCONE_TOKEN__','review');
assert(html.includes('Tool approval requests'));
const time='2026-09-13T10:00:00Z';
const call={step_id:'send',selection_id:'send',agent_id:'worker',model_id:'careful',binding:'a'.repeat(64),tool_name:'send_note',tool_revision:'.',tool_digest:'b'.repeat(64),arguments_json:'{"message":"hello"}',operation_digest:'c'.repeat(64)};
const decided={space:'alpha',run_id:'one',request_id:'d'.repeat(64),call,revision:2,created_at:time,decision:'approve',decided_by:'key:owner',decided_at:time,decision_digest:'e'.repeat(64),activation_id:null,activated_at:null,consumed_at:null};
const status={space:'alpha',run_id:'one',created_at:time,workflow_id:'job',plan_revision:1,status:'paused',active_local:false,completed_steps:[],inflight:null,outcome_unknown:false,error_class:null,paused_steps:['send']};
const request={space:'alpha',run_id:'one',created_at:time,question:'Hello',plan:{space:'alpha',revision:1,updated_at:time,plan:{workflow_id:'job',tasks:[{task_id:'send',agent_id:'worker',model_id:'careful',prompt:'Send a note',depends_on:[]}]},bindings:{send:'a'.repeat(64)}}};
const caps=JSON.parse(fs.readFileSync(root+'/tests/fixtures/http-capabilities.json')).python;
for(const k of Object.keys(caps.features))if(k.startsWith('agents.'))caps.features[k]=false;
for(const k of ['catalog','plans','runs','approvals'])caps.features['agents.'+k]=true;
const posts=[],unexpected=[];let records=[decided];
const server=http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(path==='/agents'||path==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}
 if(path==='/v1/status')return json({space:'alpha',episodes:0});
 if(path==='/v1/capabilities')return json(caps);
 if(path==='/v1/agents/catalog')return json({agents:[{agent_id:'worker',default_model:'careful',models:[{model_id:'careful',label:'Careful',revision:'1'}]}]});
 if(path==='/v1/agent-plans'||path==='/v1/agent-runs')return json({items:[],next_after:null});
 if(path==='/v1/agent-runs/one/request'){await new Promise(resolve=>setTimeout(resolve,100));return json(request);}
 if(path==='/v1/agent-runs/one')return json(status);
 if(path==='/v1/agent-runs/one/approvals')return json({space:'alpha',run_id:'one',items:records});
 if(path==='/v1/agent-runs/one/approval-continuations') {let body='';for await(const chunk of req)body+=chunk;posts.push(JSON.parse(body));res.statusCode=503;return json({error:"acknowledgement unavailable"});}
 unexpected.push(path);res.statusCode=404;json({error:'missing'});
});
(async()=>{let browser;try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,...(process.env.SCONE_BROWSER_EXECUTABLE?{executablePath:process.env.SCONE_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage();page.setDefaultTimeout(7000);
 await page.goto('http://127.0.0.1:'+server.address().port+'/agents');
 await page.getByLabel('Find run by identifier').fill('one');await page.getByRole('button',{name:'Open run',exact:true}).click();
 await page.getByLabel('Continue with this approval').check();await page.getByRole('button',{name:'Continue with selected decisions (1)',exact:true}).click();
 await page.getByText(/Continuation not confirmed/).waitFor();assert.equal(posts.length,1);const first=posts[0].continuation_id;
 assert.equal(await page.getByRole('button',{name:'Retry same tool continuation',exact:true}).count(),1);
 await page.getByRole('button',{name:'Check status',exact:true}).click();await page.getByLabel('Continue with this approval').waitFor({state:'hidden'});await page.getByLabel('Continue with this approval').waitFor();
 const retrySurvived=await page.getByRole('button',{name:'Retry same tool continuation',exact:true}).count();
 assert.equal(retrySurvived,1,'Check status must preserve the exact pending continuation');
 await page.getByRole('button',{name:'Retry same tool continuation',exact:true}).click();
 await page.getByText(/Continuation not confirmed/).waitFor();assert.equal(posts.length,2);
 assert.deepEqual(posts[1],posts[0]);
 console.log('Status refresh preserves the exact ambiguous continuation ID and batch.');
 const raw=JSON.stringify({destination:'\u202emoc.elpmaxe@nimda\u202c'});
 const bidi={...decided,call:{...call,arguments_json:raw}};
 records=[bidi,{...bidi,request_id:'f'.repeat(64),revision:4,activation_id:'history',activated_at:time,consumed_at:time}];
 await page.getByRole('button',{name:'Check status',exact:true}).click();
 await page.getByText('Directional control characters are shown as Unicode escapes.',{exact:true}).first().waitFor();
 const displayed=await page.locator('.agent-arguments').allTextContents();
 assert.equal(displayed.length,2);
 for(const value of displayed){assert.ok(value.includes('\\u202e'));assert.ok(!/[\u202a-\u202e]/.test(value));assert.deepEqual(JSON.parse(value),JSON.parse(raw));}
 assert.equal(posts.length,2,'Displaying bidi requests must not submit decisions or continuations');
 console.log('Pending and admitted argument displays reveal directional controls without changing their values.');
 }catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}})();
