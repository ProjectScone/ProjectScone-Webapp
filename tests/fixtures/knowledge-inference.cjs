// Small authored HTTP fixture: two source relationships, one rule-derived edge.
const projection={version:'v1',classifier:'c1',kinds:'k1',id_scheme:'id1',digest:'inference-fixture',revision:2};
const periods=[['2020-01-01T00:00:00.000Z','2021-01-01T00:00:00.000Z'],['2024-01-01T00:00:00.000Z',null]];
const meanings={inverse:{},symmetric:[],transitive:['part_of'],max_steps:4,max_implied:50000,max_walked:200000};
function capture(mode){
 const filters={status:mode,as_of:'2026-09-11T00:00:00.000Z'};
 const entities=['Shelf','Aisle','Warehouse'].map((label,i)=>({id:'ent:'+i,key:label.toLowerCase(),label,kind:null,kind_status:'unknown',claims:mode==='current'?2:3}));
 const historical=mode==='history'||mode==='all';
 const ids=historical?[1,2,3]:[2,3];
 const support={facts:ids.length,active:2,closed:historical?1:0};
 const relations=[{id:'rel:01',subject_id:'ent:0',object_id:'ent:1',predicate:'part_of',fact_ids:historical?[1,2]:[2],support:{facts:historical?2:1}},{id:'rel:12',subject_id:'ent:1',object_id:'ent:2',predicate:'part_of',fact_ids:[3],support:{facts:1}}];
 const implied={id:'imp:02',subject_id:'ent:0',object_id:'ent:2',predicate:'part_of',fact_ids:ids,support,follows:'transitive',follows_from:['rel:01','rel:12'],periods:historical?periods:[periods[1]],first_valid_from:historical?periods[0][0]:periods[1][0],last_valid_until:null};
 const coverage={facts_read:3,facts_counted:ids.length,facts_limit:50000,truncated:false,reasons:[],meanings};
 const graph={schema_version:1,space:'alpha',projection,filters,entities,relations,implied:[implied],attributes:[],coverage:{...coverage,entities_total:3,entities_shown:3,relations_total:2,relations_shown:2,attributes_total:0,attributes_shown:0,implied_total:1,implied_shown:1}};
 const details={};
 for(const entity of entities){
  const named=id=>entities.find(e=>e.id===id);
  const groups=direction=>relations.filter(r=>r[direction==='outgoing'?'subject_id':'object_id']===entity.id).map(r=>({predicate:r.predicate,relations:[{relation_id:r.id,[direction==='outgoing'?'object':'subject']:named(r[direction==='outgoing'?'object_id':'subject_id']),fact_ids:r.fact_ids,support:r.support}]}));
  const follows=entity.id==='ent:1'?[]:[{...implied,relation_id:implied.id,subject:named(implied.subject_id),object:named(implied.object_id)}];
  details[entity.id]={schema_version:1,space:'alpha',projection,filters,entity,incoming:groups('incoming'),outgoing:groups('outgoing'),attributes:[],follows,facts:ids.map(id=>({fact_id:id,subject:id===3?'Aisle':'Shelf',predicate:'part_of',object:id===3?'Warehouse':'Aisle',status:id===1?'closed':'active',excluded:false,origin:'stated',source_episode_id:null,quote:null,grounding:'unsourced'})),consistent:true,complete:true,coverage:{...coverage,relations_total:entity.id==='ent:1'?2:1,relations_shown:entity.id==='ent:1'?2:1,follows_shown:follows.length,follows_total:follows.length}};
 }
 return {graph,details};
}
module.exports={capture};
