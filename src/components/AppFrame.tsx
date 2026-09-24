import type {ReactNode} from 'react';
import {NavLink} from 'react-router-dom';
import {WorkspaceIcon,type WorkspaceIconName} from './WorkspaceIcon';
import mark from '../assets/scone-mark-small.png';

const destinations:{path:string;label:string;icon:WorkspaceIconName}[]=[
  {path:'/conversations',label:'Conversations',icon:'chat'},
  {path:'/memory',label:'Memory',icon:'memory'},
  {path:'/playground',label:'Explore',icon:'graph'},
  {path:'/agents',label:'Workflows',icon:'scopes'},
];

export function AppFrame({children,space,connected,checking,onConnect}:{children:ReactNode;space:string;connected:boolean;checking:boolean;onConnect:()=>void}){
  return <div className="app-shell">
    <a className="skip" href="#main" onClick={event=>{
      const main=document.getElementById('main');if(!main)return;
      event.preventDefault();if(!main.hasAttribute('tabindex'))main.tabIndex=-1;main.focus({preventScroll:true});main.scrollIntoView({block:'start'});
    }}>Skip to workspace</a>
    <header className="topbar">
      <NavLink className="brand" to="/conversations" aria-label="Scone console"><img src={mark} alt="" width={26} height={26}/><span>Scone</span></NavLink>
      <span className="workspace-divider" aria-hidden="true">/</span>
      <button className="workspace-connection" onClick={onConnect} title="Memory connection"><span className={connected?'connection-dot connected':'connection-dot'} aria-hidden="true"/><span>{space}</span><span className="sr-only"> · {connected?'Connected':checking?'Checking connection':'Not connected'} · Memory connection</span></button>
      <nav aria-label="Workspace">{destinations.map(item=><NavLink key={item.path} to={item.path}><WorkspaceIcon name={item.icon}/><span>{item.label}</span></NavLink>)}</nav>
      <NavLink className="workspace-guide" to="/learn" aria-label="Guide"><WorkspaceIcon name="guide"/></NavLink>
    </header>
    <div className="app-pane">{children}</div>
  </div>;
}
