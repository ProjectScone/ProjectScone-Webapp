import type {ToolChoice} from './plans';

export function AgentTools({tools}:{tools:readonly ToolChoice[]|undefined}){
 if(tools===undefined)return null;
 if(!tools.length)return <p className="agent-tools-empty">No application tools configured.</p>;
 return <details className="agent-tools">
  <summary>Application tools ({tools.length})</summary>
  <p>These tools are configured by the host and stay the same when you change models.</p>
  <ul>{tools.map(tool=><li key={tool.name}>
   <strong>{tool.name}</strong><p>{tool.description}</p><small>Revision {tool.revision}</small>
  </li>)}</ul>
 </details>;
}
