import {record} from './plans.ts';

export interface ModelTokenUsage {
  readonly prompt_tokens: number | null;
  readonly completion_tokens: number | null;
  readonly total_tokens: number | null;
}
export interface ToolTokenUsage {readonly calls: readonly ModelTokenUsage[]}
export interface TokenUsageRow {label:string; tokens:number|null; reportedCalls:number; modelCalls:number}

function invalid(): never {throw Error('The model token usage could not be verified.');}
function count(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1e9) invalid();
  return value;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
export function parseTokenUsage(value: unknown, modelCalls: number): ToolTokenUsage | null {
  if (!Number.isSafeInteger(modelCalls) || modelCalls < 1 || modelCalls > 17) invalid();
  if (value === null) return null;
  const row = record(value);
  exact(row, ['calls']);
  if (!Array.isArray(row.calls) || row.calls.length !== modelCalls) invalid();
  const calls = row.calls.map((raw: unknown): ModelTokenUsage => {
    const call = record(raw);
    exact(call, ['prompt_tokens', 'completion_tokens', 'total_tokens']);
    const prompt = count(call.prompt_tokens), completion = count(call.completion_tokens), total = count(call.total_tokens);
    const known = [prompt, completion].filter((value): value is number => value !== null);
    const sum = known.reduce((sum, value) => sum + value, 0);
    if (total !== null && (total < sum || (known.length === 2 && total !== sum))) invalid();
    return Object.freeze({prompt_tokens:prompt, completion_tokens:completion, total_tokens:total});
  });
  return Object.freeze({calls:Object.freeze(calls)});
}
export function usageFields(row: Record<string, unknown>, modelCalls: number, includeUsage: boolean): {usage?: ToolTokenUsage | null} {
  if (typeof includeUsage !== 'boolean') invalid();
  if (!includeUsage) {
    if (Object.hasOwn(row, 'usage')) invalid();
    return {};
  }
  if (!Object.hasOwn(row, 'usage')) invalid();
  return {usage:parseTokenUsage(row.usage, modelCalls)};
}
export function tokenUsageRows(usage: ToolTokenUsage | null): TokenUsageRow[] {
  if (usage === null) return [];
  const fields = [['Prompt', 'prompt_tokens'], ['Completion', 'completion_tokens'], ['Total', 'total_tokens']] as const;
  return fields.map(([label, field]) => {
    const counts = usage.calls.map(call => call[field]).filter((value): value is number => value !== null);
    return {label, tokens:usage.calls.length > 0 && counts.length === usage.calls.length ? counts.reduce((sum, value) => sum + value, 0) : null,
      reportedCalls:counts.length, modelCalls:usage.calls.length};
  });
}
