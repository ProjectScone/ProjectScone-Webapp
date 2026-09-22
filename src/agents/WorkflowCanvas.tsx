import {isInputTask,type TaskNode} from './plans';

/** The saved task dependencies are the drawing; there are no decorative edges. */
export function WorkflowCanvas({tasks,selected,onSelect}:{tasks:TaskNode[];selected:number;onSelect:(index:number)=>void}){
  const levels=new Map<string,number>();
  for(let pass=0;pass<tasks.length;pass++){
    let changed=false;
    for(const task of tasks){
      if(levels.has(task.task_id)||task.depends_on.some(id=>!levels.has(id)))continue;
      levels.set(task.task_id,task.depends_on.length?Math.max(...task.depends_on.map(id=>levels.get(id)??0))+1:0);changed=true;
    }
    if(!changed)break;
  }
  const used=new Map<number,number>();
  const positions=tasks.map(task=>{
    const level=levels.get(task.task_id)??0,row=used.get(level)??0;used.set(level,row+1);
    return {x:48+level*248,y:70+row*132};
  });
  const width=Math.max(620,...positions.map(p=>p.x+245)),height=Math.max(430,...positions.map(p=>p.y+155));
  return <section className="workflow-canvas" aria-label="Workflow diagram">
    <div className="workflow-canvas-caption"><span>WORKFLOW CANVAS</span><span>{tasks.length} task{tasks.length===1?'':'s'}</span></div>
    <div className="workflow-canvas-scroll"><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Tasks and dependencies">
      {tasks.flatMap((task,index)=>task.depends_on.flatMap(dependency=>{
        const source=tasks.findIndex(candidate=>candidate.task_id===dependency);if(source<0)return [];
        const a=positions[source],b=positions[index];
        return <path key={`${source}:${index}`} d={`M${a.x+196},${a.y+43} C${a.x+224},${a.y+43} ${b.x-28},${b.y+43} ${b.x},${b.y+43}`} className="workflow-wire"/>;
      }))}
      {tasks.map((task,index)=>{const p=positions[index];return <g key={index} className={`workflow-node${selected===index?' is-selected':''}`} transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0} aria-label={`Edit task ${index+1}: ${task.task_id}`} aria-pressed={selected===index} onClick={()=>onSelect(index)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(index);}}}>
        <rect width={196} height={86} rx={6}/><text x={15} y={23} className="workflow-node-type">{isInputTask(task)?'HUMAN INPUT':'MODEL TASK'}<tspan x={177} textAnchor="end">{String(index+1).padStart(2,'0')}</tspan></text>
        <text x={15} y={47} className="workflow-node-title">{(task.task_id||'Untitled task').slice(0,24)}</text><text x={15} y={68} className="workflow-node-model">{isInputTask(task)?'Wait for an answer':task.model_id.slice(0,28)}</text>
        <circle cx={0} cy={43} r={4}/><circle cx={196} cy={43} r={4}/>
      </g>;})}
    </svg></div>
    <div className="workflow-canvas-help">Select a task to configure it. Connections show which task outputs it receives.</div>
  </section>;
}
