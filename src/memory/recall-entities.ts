export interface RecallEntity {entity_id:string;key:string;label:string;role:'seed'|'neighbour';matched:string}
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid entity retrieval record.');return value as Record<string,unknown>;};
const text=(value:unknown):string=>{if(typeof value!=='string'||!value.trim()||value.length>100000)throw Error('Invalid entity retrieval text.');return value;};
const rank=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
export function readRecallEntities(value:unknown,requested:boolean):RecallEntity[]|undefined {
 if(!requested)return undefined;
 const raw=record(value);
 if(!Array.isArray(raw.entities)||raw.entities.length>12)throw Error('The server did not acknowledge the requested entity retrieval.');
 const entities=raw.entities.map((value):RecallEntity=>{const entity=record(value),id=text(entity.entity_id),role=entity.role;if(!/^ent:.{1,196}$/.test(id)||(role!=='seed'&&role!=='neighbour'))throw Error('Invalid entity retrieval identity or role.');return {entity_id:id,key:text(entity.key),label:text(entity.label),role,matched:text(entity.matched)};});
 const seeds=entities.filter(entity=>entity.role==='seed').length;
 if(new Set(entities.map(entity=>entity.entity_id)).size!==entities.length||seeds>4||entities.length>0&&!seeds)throw Error('Inconsistent entity retrieval expansion.');
 if(!Array.isArray(raw.items)||raw.items.length>25)throw Error('Invalid or oversized entity retrieval results.');
 for(const value of raw.items){const item=record(value);if(item.lanes==null)continue;const lanes=record(item.lanes);if(lanes.entity!==undefined&&(!rank(lanes.entity)||!entities.length))throw Error('Entity retrieval rank has no valid expansion evidence.');}
 return entities;
}
export function recallLaneLabels(value:unknown):string[] {
 if(!value||typeof value!=='object'||Array.isArray(value))return [];
 const lanes=value as Record<string,unknown>;
 return ['vector','text','entity'].filter(name=>rank(lanes[name])).map(name=>`${name} lane, rank ${lanes[name]}`);
}
