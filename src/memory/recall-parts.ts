import type {RecallItem, SearchState} from './types';

export interface SearchPart {
  text: string;
  start: number;
  end: number;
  found: number;
  contributed: number;
  weak: boolean | null;
  degraded: string[];
}
export interface PartedRecall {
  why: string;
  decompositionWhy: string;
  partsFound: number;
  capped: boolean;
  judged: boolean;
  parts: SearchPart[];
  items: RecallItem[];
  placedBy: number[];
  byChunk: Map<number, number[]>;
}
const invalid = (): never => { throw Error('The server returned an inconsistent multi-part search receipt.'); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 32768): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid();
  return value;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
function strings(value: unknown, max: number): string[] { return array(value, max).map(item => text(item)); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function item(value: unknown): RecallItem {
  const raw = record(value), metadata = record(raw.metadata), lanes = raw.lanes == null ? undefined : record(raw.lanes);
  if (typeof raw.score !== 'number' || !Number.isFinite(raw.score)
    || raw.similarity != null && (typeof raw.similarity !== 'number' || !Number.isFinite(raw.similarity))) return invalid();
  if (raw.source != null && typeof raw.source !== 'string') return invalid();
  const createdAt = text(raw.created_at);
  if (!Number.isFinite(Date.parse(createdAt))) return invalid();
  return {
    chunk_id: integer(raw.chunk_id, 1), episode_id: integer(raw.episode_id, 1),
    text: text(raw.text, 2_000_000), score: raw.score,
    created_at: createdAt, source: raw.source == null ? null : raw.source as string,
    tags: strings(raw.tags, 1000), metadata: Object.fromEntries(Object.entries(metadata).map(([key, value]) => {
      if (typeof value !== 'string') return invalid();
      return [key, value];
    })),
    similarity: raw.similarity == null ? null : raw.similarity as number,
    lanes: lanes && Object.fromEntries(Object.entries(lanes).map(([key, value]) => [key, integer(value, 1)])),
  };
}

/** Offsets are Python Unicode code points in the original question, not UTF-16. */
export function readPartedRecall(value: unknown, question: string, limit: number): PartedRecall {
  integer(limit, 1, 50);
  const raw = record(value), decomposition = record(raw.decomposition);
  const codepoints = [...question];
  // Python's whitespace includes NEL and the four information separators, but not BOM.
  const whole = question.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, '');
  if (!whole || decomposition.whole !== whole) return invalid();
  const spans = array(decomposition.parts, 4), reports = array(raw.per_part, 4);
  if (!spans.length || reports.length !== spans.length) return invalid();
  const parts = spans.map((value, index): SearchPart => {
    const span = record(value), report = record(reports[index]);
    const start = integer(span.start, 0, codepoints.length), end = integer(span.end, start + 1, codepoints.length);
    const said = text(span.text);
    if (codepoints.slice(start, end).join('') !== said || report.part !== said
      || report.weak !== null && typeof report.weak !== 'boolean') return invalid();
    return {text: said, start, end, found: integer(report.found, 0, limit),
      contributed: integer(report.contributed, 0, limit), weak: report.weak,
      degraded: strings(report.degraded, 100)};
  });
  if (parts.some((part, index) => index > 0 && part.start < parts[index - 1].end)) return invalid();
  const partsFound = integer(decomposition.parts_found, parts.length);
  if (decomposition.split !== (parts.length > 1) || decomposition.capped !== (partsFound > parts.length)) return invalid();
  const items = array(raw.items, limit).map(item);
  if (new Set(items.map(item => item.chunk_id)).size !== items.length) return invalid();
  const placedBy = array(raw.placed_by, limit).map(value => integer(value, 0, parts.length - 1));
  if (placedBy.length !== items.length) return invalid();
  const memberships = Object.entries(record(raw.by_chunk));
  if (memberships.length > parts.length * limit) return invalid();
  const byChunk = new Map<number, number[]>();
  for (const [key, value] of memberships) {
    const id = integer(Number(key), 1);
    if (String(id) !== key) return invalid();
    const indices = array(value, parts.length).map(value => integer(value, 0, parts.length - 1));
    if (!indices.length || indices.some((part, index) => index > 0 && part <= indices[index - 1])) return invalid();
    byChunk.set(id, indices);
  }
  if (items.length !== Math.min(limit, byChunk.size)) return invalid();
  if (items.some((item, index) => !byChunk.get(item.chunk_id)?.includes(placedBy[index]))) return invalid();
  for (const [index, part] of parts.entries()) {
    if (part.contributed !== placedBy.filter(placed => placed === index).length
      || part.found !== [...byChunk.values()].filter(indices => indices.includes(index)).length
      || part.contributed > part.found) return invalid();
  }
  if (raw.judged !== parts.some(part => part.weak !== null)
    || !same(strings(raw.unanswered, 4), parts.filter(part => !part.found).map(part => part.text))
    || !same(strings(raw.weak, 4), parts.filter(part => part.weak).map(part => part.text))) return invalid();
  return {why: text(raw.why), decompositionWhy: text(decomposition.why), partsFound,
    capped: decomposition.capped as boolean, judged: raw.judged as boolean, parts, items, placedBy, byChunk};
}

export function partsSearchProblem(state: SearchState): string | null {
  if (!state.q.trim()) return 'Enter a question to search each part.';
  return null;
}

function canonical(value: unknown, depth = 0): unknown {
  if (depth > 16) return invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return array(value, 256).map(item => canonical(item, depth + 1));
  const entries = Object.entries(record(value));
  if (entries.length > 256) return invalid();
  return Object.fromEntries(entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, canonical(item, depth + 1)]));
}

/** Require the new endpoint acknowledgement; an older server cannot silently drop narrowing. */
export function readPartedSearch(value: unknown, space: string, state: SearchState, limit: number): PartedRecall {
  const raw = record(value), applied: Record<string, unknown> = {};
  if (state.asOf) applied.as_of = state.asOf;
  if (state.tags.length) applied.tags = state.tags;
  if (Object.keys(state.where).length) applied.where = state.where;
  if (state.metadataFilter) applied.conditions = JSON.parse(state.metadataFilter.json) as unknown;
  if (!space.trim() || raw.space !== space || raw.rerank !== true || raw.graph_boost !== (state.graphBoost === true)
    || !same(canonical(raw.applied), canonical(applied)))
    throw Error('The server did not confirm this space and every selected filter. No multi-part results are shown. Update the server or use whole-question search.');
  return readPartedRecall(raw, state.q, limit);
}
