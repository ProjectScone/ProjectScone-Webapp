import {useEffect,useMemo,useRef,useState} from 'react';
import {readDocumentEvidence} from './document-evidence-read';
import type {ApiClient} from '../api';
import {cellExcerpt,type DocumentSource,type DocumentEvidence,type DocumentCell,type CellReference} from './document-evidence';
import './document-evidence.css';
const preview=(value:string,max=180)=>value.length>max?value.slice(0,max)+'…':value;
export function SourceDocumentEvidence({api,source,episodeId,space}:{api:ApiClient;source:DocumentSource;episodeId:number;space:string}){
 const [enabled,setEnabled]=useState(false),[attempt,setAttempt]=useState(0);
 const request=useMemo(()=>({api,source,episodeId,space,enabled,attempt}),[api,source,episodeId,space,enabled,attempt]);
 const [snapshot,setSnapshot]=useState<{request:object;data?:DocumentEvidence;error?:string}|null>(null);
 const [view,setView]=useState<{data:DocumentEvidence;table:number;page:number;notes:number;selected:string|null;mergedPage:number}|null>(null);
 const result=enabled&&snapshot?.request===request?snapshot:null,data=result?.data;
 const current=data&&view?.data===data?view:{table:0,page:0,notes:0,selected:null,mergedPage:0};
 const table=data?.tables[current.table],selected=current.selected?data?.cells.get(current.selected):undefined;
 const selectedSegment=selected&&data?data.segments[selected.segment]:null;
 const detail=useRef<HTMLElement>(null),excerpt=selected&&data?cellExcerpt(selected,data):null;
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
  void readDocumentEvidence(api,source,episodeId,space,signal)
   .then(data=>{if(!signal.aborted)setSnapshot({request,data});})
   .catch(()=>{if(!controller.signal.aborted)setSnapshot({request,error:'Document evidence could not be verified. Refresh the source if it changed, or retry this read.'});});
  return()=>controller.abort();
 },[request]);
 const update=(changes:Partial<typeof current>)=>{if(data)setView({data,...current,...changes});};
 const inspect=(cell:DocumentCell)=>{update({selected:cell.locator,mergedPage:0});requestAnimationFrame(()=>{detail.current?.focus({preventScroll:true});detail.current?.scrollIntoView({block:'nearest'});});};
 function refs(label:string,values:CellReference[]){return <section><h4>{label} ({values.length})</h4>{values.length?<ul>{values.map(ref=><li key={ref.locator}><button className="document-cell-link" onClick={()=>{const cell=data?.cells.get(ref.locator);if(cell)inspect(cell);}}>{preview(ref.text)}</button><small>{ref.association.replaceAll('_',' ')} · {ref.locator}</small></li>)}</ul>:<p>None recorded.</p>}</section>;}
 return <details className="document-evidence"><summary>Inspect document tables</summary><section aria-label="Document table evidence">
  <p>Inspect extracted values, declared headers, and merged-cell context. Positions describe the source table; this is not a reproduction of its visual layout.</p>
  <div className="document-controls"><button className="btn quiet" onClick={()=>{setEnabled(true);setAttempt(n=>n+1);setView(null);}}>{enabled?'Retry table evidence':'Read table evidence'}</button>{enabled&&<button className="btn quiet" onClick={()=>{setEnabled(false);setSnapshot(null);setView(null);}}>{result?'Clear table evidence':'Cancel table evidence'}</button>}</div>
  {enabled&&!result&&<p role="status">Checking document attachments and retained text…</p>}{result?.error&&<p role="alert">{result.error}</p>}
  {data&&<>
   <p role="status">{data.filename} · {data.tables.length} structured table{data.tables.length===1?'':'s'} · {data.cells.size} cells · {data.notes.length} extraction note{data.notes.length===1?'':'s'}</p>
   <p className="document-muted">{data.format} · {data.parser}. Text and cell references match this retained source.</p>
   {selected&&excerpt&&<aside ref={detail} tabIndex={-1} aria-label="Selected table cell" className="document-cell-detail">
    <h3>Row {selected.row+1}, column {selected.column+1} · {selected.isHeader?'Header':'Data cell'}</h3>
    <p>{selected.tableLocator} · {selected.locator}</p><p>Spans {selected.rowSpan} row{selected.rowSpan===1?'':'s'} × {selected.columnSpan} column{selected.columnSpan===1?'':'s'}.</p>
    <p>Source segment: {data.segments[selected.segment].locator}{data.segments[selected.segment].member?` · ${data.segments[selected.segment].member}`:''}</p>
    {data.segments[selected.segment].headerBasis&&<p>Header basis: {data.segments[selected.segment].headerBasis.replaceAll('_',' ')}</p>}
    {selectedSegment?.tableName&&<p>Declared table: {selectedSegment.tableName}{selectedSegment.tableRange?` · ${selectedSegment.tableRange}`:''}</p>}
    {selectedSegment?.tableRole&&<p>Table role: {selectedSegment.tableRole==='totals'?'Totals row':selectedSegment.tableRole}</p>}
    {selectedSegment?.cachedFormula&&<p>Value from the formula’s stored result. Recalculation is not performed during ingestion.</p>}
    <p>Retained text bytes {selected.start}–{selected.end} (UTF-8, end exclusive).</p>
    <pre aria-label="Cell in retained text">{excerpt.clippedBefore?'…':''}{excerpt.before}<mark>{preview(excerpt.value,8000)||'(empty cell)'}</mark>{excerpt.after}{excerpt.clippedAfter?'…':''}</pre>
    {selected.text.length>8000&&<details><summary>Read complete cell value ({selected.text.length} characters)</summary><pre>{selected.text}</pre></details>}
    {refs('Headers',selected.headers)}{refs('Merged row context',selected.context)}
    <section><h4>Additional merged source cells ({selected.mergedLocators.length})</h4>{selected.mergedLocators.length?<><ul>{selected.mergedLocators.slice(current.mergedPage*20,(current.mergedPage+1)*20).map(locator=><li key={locator}>{locator}</li>)}</ul>{selected.mergedLocators.length>20&&<nav aria-label="Merged source pages"><button className="btn quiet" disabled={!current.mergedPage} onClick={()=>update({mergedPage:current.mergedPage-1})}>Previous merged sources</button><span>Page {current.mergedPage+1} of {Math.ceil(selected.mergedLocators.length/20)}</span><button className="btn quiet" disabled={(current.mergedPage+1)*20>=selected.mergedLocators.length} onClick={()=>update({mergedPage:current.mergedPage+1})}>Next merged sources</button></nav>}</>:<p>None recorded.</p>}</section>
    <button className="btn quiet" onClick={()=>update({selected:null})}>Close cell inspection</button>
   </aside>}
   {!table?<p>No structured table cells were retained. Plain text may still contain table content; no header or merge relationships can be inferred here.</p>:<section aria-label="Table cells">
    <div className="document-controls"><h3>Table {current.table+1} of {data.tables.length}</h3>{data.tables.length>1&&<nav aria-label="Document tables"><button className="btn quiet" disabled={!current.table} onClick={()=>update({table:current.table-1,page:0,selected:null})}>Previous table</button><button className="btn quiet" disabled={current.table+1>=data.tables.length} onClick={()=>update({table:current.table+1,page:0,selected:null})}>Next table</button><label>Go to table<input aria-label="Go to table" type="number" min="1" max={data.tables.length} value={current.table+1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=data.tables.length)update({table:n-1,page:0,selected:null});}}/></label></nav>}</div>
    <p>{table.locator} · Cells {current.page*20+1}–{Math.min((current.page+1)*20,table.cells.length)} of {table.cells.length}</p>
    <div className="document-table-scroll" tabIndex={0} role="region" aria-label="Table cell inventory"><table><caption>Source positions and extracted values</caption><thead><tr><th scope="col">Position</th><th scope="col">Value</th><th scope="col">Evidence</th></tr></thead><tbody>{table.cells.slice(current.page*20,(current.page+1)*20).map(cell=><tr key={cell.locator}><th scope="row">Row {cell.row+1}<br/>Column {cell.column+1}<small>{cell.rowSpan} × {cell.columnSpan} span</small></th><td><button className="document-cell-link" onClick={()=>inspect(cell)} aria-label={`Inspect row ${cell.row+1}, column ${cell.column+1}`}>{preview(cell.text,300)||'(empty cell)'}</button><small>{cell.isHeader?'Header':'Data cell'}</small></td><td>{cell.headers.length} headers<br/>{cell.context.length} row contexts{cell.mergedLocators.length>0&&<><br/>{cell.mergedLocators.length} merged sources</>}</td></tr>)}</tbody></table></div>
    {table.cells.length>20&&<nav aria-label="Table cell pages"><button className="btn quiet" disabled={!current.page} onClick={()=>update({page:current.page-1,selected:null})}>Previous cells</button><span>Page {current.page+1} of {Math.ceil(table.cells.length/20)}</span><button className="btn quiet" disabled={(current.page+1)*20>=table.cells.length} onClick={()=>update({page:current.page+1,selected:null})}>Next cells</button></nav>}
   </section>}
   {data.notes.length>0&&<section aria-label="Table extraction notes"><h3>Extraction notes</h3><p>Fallback text does not establish table structure. Other notes describe limits in the retained extraction.</p><ul>{data.notes.slice(current.notes*20,(current.notes+1)*20).map((note,index)=><li key={`${note.locator}:${index}`}><strong>{note.status.replaceAll('_',' ')}</strong> · {note.reason.replaceAll('_',' ')}<small>{note.locator}</small></li>)}</ul>{data.notes.length>20&&<nav aria-label="Extraction note pages"><button className="btn quiet" disabled={!current.notes} onClick={()=>update({notes:current.notes-1})}>Previous notes</button><span>Page {current.notes+1} of {Math.ceil(data.notes.length/20)}</span><button className="btn quiet" disabled={(current.notes+1)*20>=data.notes.length} onClick={()=>update({notes:current.notes+1})}>Next notes</button></nav>}</section>}
  </>}
 </section></details>;
}
