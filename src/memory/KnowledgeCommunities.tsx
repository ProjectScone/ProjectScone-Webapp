import {GROUP_COLORS} from './EvidenceNetworkCanvas';
import type {EvidenceGroups} from './evidence-network';
import type {KnowledgeAnalysis} from './knowledge-analysis';

export function KnowledgeCommunities({analysis,groups,selected,choose}:{analysis:KnowledgeAnalysis;groups:EvidenceGroups;selected:string;choose:(id:string)=>void}){
 return <section className="knowledge-analysis" aria-label="Computed communities">
  <div><strong>Computed communities</strong><p>{analysis.analysed} of {analysis.total} connected entities analysed · {analysis.isolated} isolated in the analysis input</p><p>{analysis.estimated?`Bridge scores estimated from ${analysis.betweenness.split(':')[1]} sampled sources.`:'Bridge scores computed exactly for the analysed graph.'} Scores describe network structure, not claim reliability.</p></div>
  {analysis.truncated&&<p role="status">Limited analysis: {analysis.reasons.length?analysis.reasons.map(reason=>reason.replaceAll('_',' ')).join(' · '):'Some entities were not analysed.'}</p>}
  <label><span>Community</span><select value={selected} onChange={event=>choose(event.target.value)}><option value="">All returned entities</option>{groups.groups.map(group=>{const whole=analysis.communities.find(community=>community.id===group.id);return <option key={group.id} value={group.id}>{group.label} · {group.nodeIds.length} shown{whole?` of ${whole.size}`:''}</option>;})}</select></label>
  <ul className="knowledge-community-legend" aria-label="Community colors">{groups.groups.map((group,index)=><li key={group.id}><span style={{background:group.isolated?'#8995a7':GROUP_COLORS[index%GROUP_COLORS.length]}} aria-hidden="true"/>{group.label}</li>)}</ul>
 </section>;
}
export function KnowledgeImportance({analysis,entityId}:{analysis:KnowledgeAnalysis;entityId:string}){
 const score=analysis.importance.get(entityId),community=analysis.communities.find(group=>group.id===score?.communityId);
 if(!score)return <p>No computed score returned for this entity.</p>;
 return <section className="knowledge-importance" aria-label="Computed importance"><h3>Computed importance</h3><p>{community?.label}</p><dl><dt>Degree</dt><dd>{score.degree}</dd><dt>PageRank</dt><dd>{score.pagerank.toPrecision(3)}</dd><dt>Bridge score{analysis.estimated?' (estimated)':''}</dt><dd>{score.betweenness.toPrecision(3)}</dd><dt>Participation</dt><dd>{score.participation.toPrecision(3)}</dd></dl><p>Degree counts connected neighbors; PageRank measures network influence. Bridge score measures shortest-path traffic; participation measures connections across groups.</p></section>;
}
