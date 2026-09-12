import type {RecallEntity} from './recall-entities';
export function RecallEntities({entities}:{entities:RecallEntity[]|undefined}){
 if(entities===undefined)return null;
 return <section className="recall-entities" aria-label="Entity-assisted retrieval"><h3>Entity-assisted retrieval</h3><p>{entities.length?`${entities.length} recorded entities considered for search expansion. Passage matches appear under “why this”; returned passages retain your search filters.`:'No expansion entities were reported for this query.'}</p>{entities.length>0&&<ul>{entities.map(entity=><li key={entity.entity_id}><strong>{entity.label}</strong><span>{entity.role==='seed'?'From the query':'Connected entity'}</span><small>{entity.role==='seed'?'Matched name':'Relationship'}: {entity.role==='seed'?entity.matched:entity.matched.replaceAll('_',' ')}</small></li>)}</ul>}</section>;
}
