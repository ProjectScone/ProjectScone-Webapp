// The independent UI host may supply an explicit runtime key to local browsers.
// Read only its explicit bootstrap field; never scrape settings or transcripts.
export function consoleAccessKey(html: string): string {
  const bootstrap = html.match(/<script id="scone-bootstrap" type="application\/json">([^<]*)<\/script>/);
  if (bootstrap) {
    try {
      const key: unknown = JSON.parse(bootstrap[1]).key;
      return typeof key === 'string' && !key.startsWith('__SCONE_') ? key : '';
    } catch { return ''; }
  }
  const attribute = html.match(/<script\s+data-token="([^"<>]+)"/);
  if (attribute) return attribute[1];
  const literal = html.match(/const TOKEN = document\.currentScript\.dataset\.token \|\| ("(?:[^"\\]|\\.)*")/);
  if (!literal) return '';
  try {
    const value = JSON.parse(literal[1]);
    return value.startsWith('__SCONE_') ? '' : value;
  } catch { return ''; }
}
export async function localSession(pathname: string): Promise<string> {
  if (/^\/(?:learn|docs)(?:\/|$)/.test(pathname)) return '';
  try {
    const response = await fetch('/__scone/session', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return '';
    const value: unknown = await response.json();
    return value !== null && typeof value === 'object' && 'key' in value && typeof value.key === 'string' && !value.key.startsWith('__SCONE_') ? value.key : '';
  } catch { return ''; }
}
