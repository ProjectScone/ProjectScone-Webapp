// Authored wire receipt for browser lifecycle checks; source evidence is inert.
function receipt(question){
 const points=[...question],parts=[];let start=0;
 for(let index=0;index<=points.length;index++){
  if(index<points.length&&points[index]!=='?')continue;
  let end=index<points.length?index+1:index;
  while(start<end&&/\s/.test(points[start]))start++;
  while(end>start&&/\s/.test(points[end-1]))end--;
  if(end>start)parts.push({text:points.slice(start,end).join(''),start,end});
  start=index+1;
 }
 const kept=parts.slice(0,4),count=kept.length;
 const items=[{chunk_id:1,episode_id:1,text:'Billing was approved by Ada.',score:.2,source:'',created_at:'2026-09-12T00:00:00Z',metadata:{},tags:['work']}];
 if(count>1)items.push({...items[0],chunk_id:2,episode_id:2,text:'Ben maintains the observatory.',score:.9});
 const by_chunk=count>1?{'1':[0,1],'2':[1]}:{'1':[0]},placed_by=count>1?[0,1]:[0];
 const per_part=kept.map((part,index)=>({part:part.text,found:index===0?1:index===1?2:0,contributed:index<2?1:0,weak:null,degraded:[]}));
 return {why:'Parts searched separately.',judged:false,decomposition:{whole:question.trim(),parts:kept,parts_found:parts.length,capped:parts.length>kept.length,split:count>1,why:`${count} parts searched.`},items,by_chunk,placed_by,per_part,unanswered:per_part.filter(p=>!p.found).map(p=>p.part),weak:[]};
}
module.exports={receipt};
