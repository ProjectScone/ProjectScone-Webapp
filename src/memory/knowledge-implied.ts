export interface ImpliedRelation {
 id:string;source:string;target:string;predicate:string;factIds:number[];
 follows:'inverse'|'symmetric'|'transitive';premises:string[];
 periods:[string,string|null][];support:Record<string,number>;
}
export interface RelationMeanings {inverse:Record<string,string>;symmetric:string[];transitive:string[];maxSteps:number;maxImplied:number;maxWalked:number}
export interface KnowledgeInference {edges:ImpliedRelation[];meanings:RelationMeanings|null;total:number;capped:boolean}
export interface EntityInference extends ImpliedRelation {subjectLabel:string;objectLabel:string}
const invalid=()=>Error('Invalid inferred relationship evidence. Refresh the graph.');
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw invalid();return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string'||!v.trim()||v.length>100000)throw invalid();return v;};
const count=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw invalid();return v;};
const positive=(v:unknown):number=>{const n=count(v);if(!n)throw invalid();return n;};
const array=(v:unknown,max=50000):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw invalid();return v;};
const identity=(v:unknown,prefix:string):string=>{const s=text(v);if(!s.startsWith(prefix)||s.length===prefix.length||s.length>200)throw invalid();return s;};
const distinct=<T,>(items:T[]):T[]=>{if(new Set(items).size!==items.length)throw invalid();return items;};
const timestamp=(v:unknown):string=>{const s=text(v);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==s)throw invalid();return s;};
function meanings(value:unknown):RelationMeanings|null {
 if(value===null)return null;
 const v=record(value),opposites=record(v.inverse);
 const inverse=Object.fromEntries(Object.entries(opposites).map(([key,value])=>[text(key),text(value)]));
 const symmetric=distinct(array(v.symmetric,1000).map(text)),transitive=distinct(array(v.transitive,1000).map(text));
 if(Object.keys(inverse).length>2000||Object.entries(inverse).some(([key,value])=>inverse[value]!==key))throw invalid();
 return {inverse,symmetric,transitive,maxSteps:positive(v.max_steps),maxImplied:positive(v.max_implied),maxWalked:positive(v.max_walked)};
}
function edge(value:unknown,rules:RelationMeanings|null):ImpliedRelation {
 const v=record(value),source=identity(v.subject_id,'ent:'),target=identity(v.object_id,'ent:'),predicate=text(v.predicate);
 if(source===target||!rules)throw invalid();
 const follows=v.follows;
 if(follows!=='inverse'&&follows!=='symmetric'&&follows!=='transitive')throw invalid();
 if(follows==='transitive'&&!rules.transitive.includes(predicate)||follows==='symmetric'&&!rules.symmetric.includes(predicate)||follows==='inverse'&&!Object.hasOwn(rules.inverse,predicate))throw invalid();
 const premises=distinct(array(v.follows_from,32).map(v=>identity(v,'rel:')));
 if(follows==='transitive'?(premises.length<2||premises.length>rules.maxSteps):premises.length!==1)throw invalid();
 const factIds=distinct(array(v.fact_ids).map(positive));if(!factIds.length)throw invalid();
 const support=Object.fromEntries(Object.entries(record(v.support)).map(([k,v])=>[k,count(v)]));
 if(support.facts!==factIds.length)throw invalid();
 const periods=array(v.periods).map((value):[string,string|null]=>{const p=array(value,2);if(p.length!==2)throw invalid();const start=timestamp(p[0]),end=p[1]===null?null:timestamp(p[1]);if(end!==null&&end<=start)throw invalid();return [start,end];});
 if(!periods.length)throw invalid();
 for(let i=1;i<periods.length;i++){const previousEnd=periods[i-1][1];if(previousEnd===null||previousEnd>=periods[i][0])throw invalid();}
 if(v.first_valid_from!==periods[0][0]||v.last_valid_until!==periods.at(-1)![1])throw invalid();
 return {id:identity(v.id,'imp:'),source,target,predicate,factIds,follows,premises,periods,support};
}
export function parseKnowledgeInference(value:unknown,coverage:Record<string,unknown>,known:Set<string>):KnowledgeInference|null {
 if(value===undefined&&coverage.meanings===undefined&&coverage.implied_total===undefined&&coverage.implied_shown===undefined)return null;
 const rules=meanings(coverage.meanings),edges=array(value).map(v=>edge(v,rules));distinct(edges.map(e=>e.id));
 const total=count(coverage.implied_total),shown=count(coverage.implied_shown);
 if(shown!==edges.length||total<shown||edges.some(e=>!known.has(e.source)||!known.has(e.target)))throw invalid();
 if(!rules&&total||rules&&total>rules.maxImplied)throw invalid();
 if(coverage.implied_capped!==undefined&&typeof coverage.implied_capped!=='boolean')throw invalid();
 return {edges,meanings:rules,total,capped:coverage.implied_capped===true};
}
export function parseEntityInference(value:unknown,inference:KnowledgeInference|null,selected:string,coverage:Record<string,unknown>,known:Map<string,{key:string;label:string}>):EntityInference[] {
 if(value===undefined){if(coverage.follows_shown!==undefined)throw invalid();return [];}
 const edges=array(value).map(value=>{
  const v=record(value),subject=record(v.subject),object=record(v.object);
  for(const name of [subject,object]){const expected=known.get(identity(name.id,'ent:'));if(expected&&(name.label!==expected.label||name.key!==expected.key))throw invalid();}
  const item=edge({...v,id:v.relation_id,subject_id:subject.id,object_id:object.id},inference?.meanings??null);
  if(item.source!==selected&&item.target!==selected)throw invalid();
  return {...item,subjectLabel:text(subject.label),objectLabel:text(object.label)};
 });
 distinct(edges.map(e=>e.id));if(count(coverage.follows_shown)!==edges.length)throw invalid();
 return edges;
}

interface Premise {id:string;source:string;target:string;predicate:string;factIds:number[]}
export function validateInferenceContext(edges:ImpliedRelation[],rules:RelationMeanings|null,premises:Premise[],mode:string,asOf:string):void {
 const known=new Map(premises.map(r=>[r.id,r])),when=Date.parse(asOf);
 const said=new Set(premises.map(r=>JSON.stringify([r.source,r.predicate,r.target])));
 for(const item of edges){
  if(said.has(JSON.stringify([item.source,item.predicate,item.target])))throw invalid();
  if(mode==='current'&&!item.periods.some(([a,b])=>Date.parse(a)<=when&&(b===null||when<Date.parse(b))))throw invalid();
  if(mode==='history'&&Date.parse(item.periods[0][0])>when)throw invalid();
  const steps=item.premises.map(id=>known.get(id)),facts=new Set(item.factIds);
  for(const [i,step] of steps.entries()){
   if(!step)continue;
   if(step.factIds.some(id=>!facts.has(id)))throw invalid();
   if(item.follows==='transitive'){
    if(step.predicate!==item.predicate||i===0&&step.source!==item.source||i===steps.length-1&&step.target!==item.target||i>0&&steps[i-1]&&steps[i-1]!.target!==step.source)throw invalid();
   }else if(step.source!==item.target||step.target!==item.source||(item.follows==='symmetric'?step.predicate!==item.predicate:rules?.inverse[item.predicate]!==step.predicate))throw invalid();
  }
  if(steps.every(step=>step!==undefined)&&new Set(steps.flatMap(step=>step!.factIds)).size!==facts.size)throw invalid();
 }
}
