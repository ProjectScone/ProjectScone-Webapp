import {useEffect,useMemo,useState} from 'react';
import type {ApiClient} from '../api';
import type {DocumentSource} from './document-evidence';
import type {OcrPage} from './document-ocr-evidence';
import {readOcrTables,type OcrTableInspection as Inspection} from './document-ocr-tables';
import './ocr-tables.css';

export function OcrTableInspection({api,source,page,episodeId,space,onSelect}:{api:ApiClient;source:DocumentSource;page:OcrPage;episodeId:number;space:string;onSelect:(index:number)=>void}){
 const [enabled,setEnabled]=useState(false),[attempt,setAttempt]=useState(0);
 const request=useMemo(()=>({api,source,page,episodeId,space,enabled,attempt}),[api,source,page,episodeId,space,enabled,attempt]);
 const [snapshot,setSnapshot]=useState<{request:object;data?:Inspection;error?:string}|null>(null);
 const result=enabled&&snapshot?.request===request?snapshot:null;
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
  void readOcrTables(api,{source,page,episodeId,space},signal).then(data=>{
   if(!signal.aborted)setSnapshot({request,data});
  }).catch(()=>{
   if(!controller.signal.aborted)setSnapshot({request,error:'Table analysis could not be verified. The source or connection may have changed, or this page may exceed the analysis limits. Retry checks the source again.'});
  });
  return()=>controller.abort();
 },[request]);
 return <section className="ocr-tables" aria-label="OCR table inspection">
  <header><span className="eyebrow">Page structure</span><h3>Inspect possible tables</h3></header>
  <p>Find aligned rows and columns in the retained OCR positions. Proposed cells link to the recorded text regions; this does not run OCR, change the source, or establish header meanings.</p>
  {page.regions.length>5000?<p>This page has more than the 5,000 regions supported by table analysis. Every region remains available in the OCR list.</p>:<div className="ocr-actions">
   <button className="btn quiet small" onClick={()=>{setEnabled(true);setAttempt(n=>n+1);}}>{enabled?'Retry table analysis':'Analyze table layout'}</button>
   {enabled&&<button className="btn quiet small" onClick={()=>{setEnabled(false);setSnapshot(null);}}>{result?'Clear table analysis':'Cancel table analysis'}</button>}
  </div>}
  {enabled&&!result&&<p role="status">Checking table candidates and their retained source…</p>}
  {result?.error&&<p role="alert">{result.error}</p>}
  {result?.data&&<TableResults key={attempt} data={result.data} page={page} episodeId={episodeId} onSelect={onSelect}/>}
 </section>;
}
function TableResults({data,page,episodeId,onSelect}:{data:Inspection;page:OcrPage;episodeId:number;onSelect:(index:number)=>void}){
 const [tableIndex,setTableIndex]=useState(0),[rowPage,setRowPage]=useState(0),[unassignedPage,setUnassignedPage]=useState(0),[url,setUrl]=useState('');
 useEffect(()=>{const value=URL.createObjectURL(new Blob([data.exportText],{type:'application/json'}));setUrl(value);return()=>URL.revokeObjectURL(value);},[data]);
 const table=data.tables[tableIndex];
 return <>
  <p role="status">{data.tables.length?`${data.tables.length} possible ${data.tables.length===1?'table':'tables'} found.`:'No aligned table grid was found.'} {data.unassigned.length} of {page.regions.length} regions are unassigned.</p>
  <p>Geometry is inferred. Headers, merged cells and missing values are not inferred. A cell joins its observed text regions with spaces; inspect those regions to check the original text and positions.</p>
  {table&&<>
   {data.tables.length>1&&<nav className="ocr-actions" aria-label="Table candidates"><button className="btn quiet small" disabled={!tableIndex} onClick={()=>{setTableIndex(i=>i-1);setRowPage(0);}}>Previous table</button><span>Candidate {tableIndex+1} of {data.tables.length}</span><button className="btn quiet small" disabled={tableIndex+1>=data.tables.length} onClick={()=>{setTableIndex(i=>i+1);setRowPage(0);}}>Next table</button></nav>}
   <div className="ocr-table-scroll" role="region" aria-label={`Table candidate ${tableIndex+1}`} tabIndex={0}>
    <table><caption>Candidate {tableIndex+1} · {table.rows} inferred rows × {table.columns} inferred columns</caption><thead><tr><th scope="col">Row</th>{Array.from({length:table.columns},(_,column)=><th key={column} scope="col">Column {column+1}</th>)}</tr></thead>
     <tbody>{Array.from({length:Math.min(20,table.rows-rowPage*20)},(_,offset)=>{const row=rowPage*20+offset;return <tr key={row}><th scope="row">{row+1}</th>{table.cells.slice(row*table.columns,(row+1)*table.columns).map(cell=><td key={cell.column}><button onClick={()=>onSelect(cell.regions[0])} title={`Inspect ${cell.regions.length} recorded ${cell.regions.length===1?'region':'regions'}`}><span>{cell.text}</span><small>{cell.regions.length} {cell.regions.length===1?'region':'regions'} ↗</small></button></td>)}</tr>;})}</tbody>
    </table>
   </div>
   {table.rows>20&&<nav className="ocr-actions" aria-label="Table rows"><button className="btn quiet small" disabled={!rowPage} onClick={()=>setRowPage(n=>n-1)}>Previous rows</button><span>Rows {rowPage*20+1}–{Math.min(table.rows,(rowPage+1)*20)} of {table.rows}</span><button className="btn quiet small" disabled={(rowPage+1)*20>=table.rows} onClick={()=>setRowPage(n=>n+1)}>Next rows</button></nav>}
  </>}
  {data.unassigned.length>0&&<details><summary>Inspect unassigned text ({data.unassigned.length} regions)</summary><ul className="ocr-unassigned">{data.unassigned.slice(unassignedPage*20,(unassignedPage+1)*20).map(index=><li key={index}><button className="btn quiet small" onClick={()=>onSelect(index)}>Region {index+1} · {page.regions[index].text.slice(0,120)}{page.regions[index].text.length>120?'…':''}</button></li>)}</ul>{data.unassigned.length>20&&<nav className="ocr-actions" aria-label="Unassigned regions"><button className="btn quiet small" disabled={!unassignedPage} onClick={()=>setUnassignedPage(n=>n-1)}>Previous unassigned</button><span>Page {unassignedPage+1} of {Math.ceil(data.unassigned.length/20)}</span><button className="btn quiet small" disabled={(unassignedPage+1)*20>=data.unassigned.length} onClick={()=>setUnassignedPage(n=>n+1)}>Next unassigned</button></nav>}</details>}
  {url&&<a className="btn quiet small" href={url} download={`ocr-table-episode-${episodeId}-page-${page.number}.json`}>Download analysis and source references</a>}
 </>;
}
