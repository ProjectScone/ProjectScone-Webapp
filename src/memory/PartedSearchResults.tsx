import {useEffect, useState, type ReactNode} from 'react';
import type {ApiClient, RecallItem, SearchState} from './types';
import {readPartedSearch, type PartedRecall} from './recall-parts';
import './recall-parts.css';

interface Receipt {
  api: ApiClient;
  query: string;
  state: SearchState;
  attempt: number;
  refresh: number;
  data?: PartedRecall;
  error?: string;
}
export function PartedSearchResults({api, query, state, refresh, renderItem}: {
  api: ApiClient;
  query: string;
  refresh: number;
  state: SearchState;
  renderItem: (item: RecallItem) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0), [receipt, setReceipt] = useState<Receipt | null>(null);
  useEffect(() => {
    const controller = new AbortController(), params = new URLSearchParams(query);
    params.delete('evidence_graph');
    setReceipt(null);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
    Promise.all([
      api.request<unknown>('/v1/status', {signal}),
      api.request<unknown>('/v1/recall/parts?' + params.toString(), {signal}),
    ]).then(([status, value]) => {
      if (!status || typeof status !== 'object' || !('space' in status) || typeof status.space !== 'string')
        throw Error('Could not verify the current search space.');
      return readPartedSearch(value, status.space, state, Number(params.get('limit')));
    })
      .then(data => { if (!controller.signal.aborted) setReceipt({api, query, state, attempt, refresh, data}); })
      .catch(error => { if (!controller.signal.aborted) setReceipt({api, query, state, attempt, refresh,
        error: error instanceof Error ? error.message : 'Multi-part search is unavailable.'}); });
    return () => controller.abort();
  }, [api, query, state, attempt, refresh]);
  const current = receipt?.api === api && receipt.query === query && receipt.state === state && receipt.attempt === attempt
    && receipt.refresh === refresh ? receipt : null;
  if (current?.error) return <div role="alert"><p>{current.error}</p><button className="btn quiet" onClick={() => setAttempt(n => n + 1)}>Retry multi-part search</button></div>;
  if (!current?.data) return <p role="status">Searching each question part…</p>;
  const data = current.data;
  return <section className="parted-search" aria-label="Multi-part search results">
    <div className="parted-intro"><h2>What each part found</h2><p>{data.decompositionWhy}</p>
      <p>Passages appear in the server’s turn-by-turn merge order. Relevance scores belong to individual searches and are not compared across parts.</p>
      {!data.judged && <p>No similarity-floor assessment was reported. Evidence quality was not measured; finding passages does not establish that a question was answered.</p>}
      {data.capped && <p role="status">Only {data.parts.length} of {data.partsFound} detected parts were searched. The remaining parts were not searched; ask them separately.</p>}
    </div>
    <ol className="parted-questions" aria-label="Searched question parts">
      {data.parts.map((part, index) => <li key={part.start}>
        <h3><span>Part {index + 1}</span>{part.text}</h3>
        <p>{part.found === 0 ? 'No passages found.' : `${part.found} passage${part.found === 1 ? '' : 's'} found · ${part.contributed} placed in the combined results.`}</p>
        {part.found > 0 && part.contributed === 0 && <p>Returned passages were shared with another part or omitted by the combined result limit.</p>}
        <p>{part.weak === null ? 'Similarity floor: not measured.' : part.weak ? 'Evidence fell below this part’s similarity floor.' : 'Evidence did not fall below this part’s similarity floor. This does not verify an answer.'}</p>
        {part.degraded.length > 0 && <p className="err">Retrieval was limited: {part.degraded.join('; ')}</p>}
      </li>)}
    </ol>
    <h2>{data.items.length} combined excerpt{data.items.length === 1 ? '' : 's'}</h2>
    {!data.items.length && <p>No passages were returned for the searched parts.</p>}
    <div className="rows">{data.items.map((item, index) => <article className="parted-excerpt" key={item.chunk_id}>
      <p className="parted-credit">Placed by part {data.placedBy[index] + 1} · Found by {data.byChunk.get(item.chunk_id)!.map(part => `part ${part + 1}`).join(', ')}</p>
      {renderItem(item)}
    </article>)}</div>
  </section>;
}
