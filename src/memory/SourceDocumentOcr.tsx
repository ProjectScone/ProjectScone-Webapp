import {useEffect,useMemo,useState} from 'react';
import type {ApiClient} from '../api';
import {documentBinding,type DocumentSource} from './document-evidence';
import {drawnRegions,parseOcrDocument,type OcrDocument,type OcrPage} from './document-ocr-evidence';
import {ocrModeLabel,ocrOrderLabel} from './document-ocr';
import './document-ocr-evidence.css';

export function SourceDocumentOcr({api,source,episodeId}:{api:ApiClient;source:DocumentSource;episodeId:number}){
 const [enabled,setEnabled]=useState(false),[attempt,setAttempt]=useState(0);
 const request=useMemo(()=>({api,source,episodeId,enabled,attempt}),[api,source,episodeId,enabled,attempt]);
 const [snapshot,setSnapshot]=useState<{request:object;data?:OcrDocument;error?:string}|null>(null);
 const result=enabled&&snapshot?.request===request?snapshot:null;
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
  const options={signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
  void(async()=>{
   try{
    const data=parseOcrDocument(await api.request<unknown>(`/v1/episodes/${episodeId}/document`,options),source);
    const current=await api.request<unknown>(`/v1/episodes/${episodeId}`,options);
    if(!current||typeof current!=='object'||Array.isArray(current))throw Error('Invalid source');
    const record=current as Record<string,unknown>,binding=documentBinding(current);
    if(record.episode_id!==episodeId||record.kind!=='file'||record.content!==source.content||!binding||JSON.stringify(binding)!==JSON.stringify(source.binding))throw Error('Source changed');
    if(!signal.aborted)setSnapshot({request,data});
   }catch{if(!controller.signal.aborted)setSnapshot({request,error:'PDF extraction could not be verified. The source may have changed, been forgotten, or exceeded the inspection limits. Refresh the source or retry this read.'});}
  })();
  return()=>controller.abort();
 },[request]);
 return <details className="document-ocr-evidence"><summary>Inspect PDF text and OCR regions</summary><section aria-label="PDF extraction evidence">
  <p>Read retained page text and recorded OCR positions. This view does not run OCR again. Pages without retained text are omitted.</p>
  <div className="ocr-actions"><button className="btn quiet" onClick={()=>{setEnabled(true);setAttempt(n=>n+1);}}>{enabled?'Retry PDF extraction read':'Read PDF extraction'}</button>{enabled&&<button className="btn quiet" onClick={()=>{setEnabled(false);setSnapshot(null);}}>{result?'Clear PDF extraction':'Cancel PDF extraction read'}</button>}</div>
  {enabled&&!result&&<p role="status">Verifying retained PDF extraction…</p>}{result?.error&&<p role="alert">{result.error}</p>}
  {result?.data&&<OcrPages key={attempt} data={result.data}/>}
 </section></details>;
}
function OcrPages({data}:{data:OcrDocument}){
 const [index,setIndex]=useState(0),[regionPage,setRegionPage]=useState(0),[selected,setSelected]=useState<number|null>(null);
 const page=data.pages[index],region=selected===null?null:page?.regions[selected];
 const move=(next:number)=>{setIndex(next);setRegionPage(0);setSelected(null);};
 if(!page)return <p>No retained PDF pages.</p>;
 return <>
  <p>{data.filename} · {data.pages.length} retained {data.pages.length===1?'page':'pages'}</p>
  {data.selection&&<p>{ocrModeLabel(data.selection.mode)} · {ocrOrderLabel(data.selection.reading_order)} · {data.selection.dpi} DPI.</p>}
  <nav className="ocr-actions" aria-label="Retained PDF pages"><button className="btn quiet small" disabled={!index} onClick={()=>move(index-1)}>Previous PDF page</button><span>PDF page {page.number} · {index+1} of {data.pages.length} retained</span><button className="btn quiet small" disabled={index+1>=data.pages.length} onClick={()=>move(index+1)}>Next PDF page</button>{data.pages.length>2&&<label>Retained page position<input type="number" min="1" max={data.pages.length} value={index+1} onChange={event=>{const next=Number(event.target.value);if(Number.isInteger(next)&&next>=1&&next<=data.pages.length)move(next-1);}}/></label>}</nav>
  <p>{page.extraction==='ocr'?`OCR · ${page.engine} · ${page.regions.length} recorded regions`:'Embedded text · no OCR geometry recorded'}</p>
  {page.order&&<p>{page.order.columns?`${page.order.columns} inferred columns`:'No separating column gap inferred'} · {page.order.direction==='ltr'?'Left to right':'Right to left'}. {page.order.notes.filter(n=>n!=='geometry_inferred'&&n!=='no_separating_gutter').map(n=>n==='candidate_limit'?'Column candidates reached their limit.':'Column count reached its limit.').join(' ')}</p>}
  {page.regions.length>0&&<>
   <OcrMap page={page} selected={selected}/>
   {region&&<aside className="ocr-selection" aria-label="Selected OCR region"><h3>Region {selected!+1}</h3><pre>{region.text}</pre><p>Retained page text bytes {region.start}–{region.end} · UTF-8, end exclusive.</p><p>{region.score===null?'Recognizer score not recorded':`Recognizer score ${(region.score*100).toFixed(1)}%`}. This score does not establish factual correctness.</p><p>Position: {region.box.map(value=>(value*100).toFixed(2)+'%').join(', ')} · left, top, right, bottom.</p>{region.column!==null&&<p>{region.column?`Inferred column ${region.column}`:'Spans columns or is outside a column'} · original recognizer position {region.providerIndex!+1}.</p>}</aside>}
   <ol className="ocr-regions" start={regionPage*20+1}>{page.regions.slice(regionPage*20,(regionPage+1)*20).map((region,offset)=>{const number=regionPage*20+offset;return <li key={number}><button className="btn quiet small" aria-pressed={selected===number} onClick={()=>setSelected(number)}><span>Region {number+1}</span><span>{region.text.length>160?region.text.slice(0,160)+'…':region.text}</span></button></li>;})}</ol>
   {page.regions.length>20&&<nav className="ocr-actions" aria-label="OCR region pages"><button className="btn quiet small" disabled={!regionPage} onClick={()=>setRegionPage(regionPage-1)}>Previous regions</button><span>Regions {regionPage*20+1}–{Math.min((regionPage+1)*20,page.regions.length)} of {page.regions.length}</span><button className="btn quiet small" disabled={(regionPage+1)*20>=page.regions.length} onClick={()=>setRegionPage(regionPage+1)}>Next regions</button><label>Region page<input type="number" min="1" max={Math.ceil(page.regions.length/20)} value={regionPage+1} onChange={event=>{const n=Number(event.target.value);if(Number.isInteger(n)&&n>=1&&n<=Math.ceil(page.regions.length/20))setRegionPage(n-1);}}/></label></nav>}
  </>}
  <details><summary>Read complete retained page text</summary><pre className="ocr-page-text">{page.text}</pre></details>
 </>;
}
function OcrMap({page,selected}:{page:OcrPage;selected:number|null}){
 const indices=drawnRegions(page.regions.length,selected),height=1000*(page.displayHeight/page.displayWidth);
 return <figure className="ocr-map"><figcaption>Recorded region map · displayed page coordinates, not the original PDF image. Select a text region below to highlight it.</figcaption><svg role="img" aria-label={`Recorded OCR region map for PDF page ${page.number}`} viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid meet">
  <rect x="0" y="0" width="1000" height={height} className="ocr-page-outline"/>
  {indices.map(index=>{const [left,top,right,bottom]=page.regions[index].box;return <rect key={index} x={left*1000} y={top*height} width={(right-left)*1000} height={(bottom-top)*height} className={index===selected?'ocr-box selected':'ocr-box'}/>;})}
 </svg>{indices.length<page.regions.length&&<p>The map draws {indices.length} of {page.regions.length} regions, including your selection. Every region remains available in the paged text list.</p>}</figure>;
}
