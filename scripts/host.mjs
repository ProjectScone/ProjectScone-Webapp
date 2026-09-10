import http from 'node:http';
import https from 'node:https';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const upgradedSockets = new WeakMap();
export function closeUiHost(server, callback) {
  server.close(callback);
  server.closeAllConnections();
  for (const socket of upgradedSockets.get(server) || []) socket.destroy();
}

const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i;
export function trustedLocalRequest(request) {
  const rawHosts = request.rawHeaders?.filter((_, index) => index % 2 === 0).filter(name => name.toLowerCase() === 'host');
  if (!rawHosts || rawHosts.length !== 1) return false;
  const host = request.headers.host;
  const match = typeof host === 'string' && host.match(localHost);
  if (!localAddresses.has(request.socket.remoteAddress) || !match || (match[1] && (+match[1] < 1 || +match[1] > 65535))) return false;
  const origin = request.headers.origin;
  return !origin || origin === 'http://' + host || origin === 'https://' + host;
}
export function backendAddress(value) {
  if (!value) throw new Error('SCONE_API_URL must explicitly name a local API origin');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SCONE_API_URL must be a loopback HTTP(S) origin without credentials, path or query');
  }
  return url;
}
const isApi = pathname => pathname === '/healthz' || pathname === '/v1' || pathname.startsWith('/v1/');
const isPublic = pathname => /^\/(?:learn|docs)(?:\/|$)/.test(pathname);
const isPage = pathname => /^(?:\/|\/memory\/?|\/playground\/?|\/memory\/sources\/[^/]+\/?|\/conversations(?:\/[^/]+)?\/?)$/.test(pathname) || isPublic(pathname);
const bootstrapPattern = /<script id="scone-bootstrap" type="application\/json">[^<]*<\/script>/;
const encodeBootstrap = key => '<script id="scone-bootstrap" type="application/json">' + JSON.stringify({key}).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029') + '</script>';
const hopHeaders = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
function forwardedHeaders(headers, upgrade = false) {
  const nominated = new Set(String(headers.connection || '').toLowerCase().split(',').map(value=>value.trim()));
  return Object.fromEntries(Object.entries(headers).filter(([name]) => {
    if (upgrade && (name === 'connection' || name === 'upgrade')) return true;
    return !hopHeaders.has(name) && !nominated.has(name) && name !== 'forwarded' && !name.startsWith('x-forwarded-');
  }));
}
function send(response, status, body, headers = {}, head = false) {
  const bytes = Buffer.from(body);
  response.writeHead(status, {'content-type':'text/plain; charset=utf-8', 'content-length':bytes.length, 'x-content-type-options':'nosniff', ...headers});
  response.end(head ? undefined : bytes);
}
export function createUiHost({html, backend, uiKey = ''}) {
  const target = backendAddress(backend);
  const transport = target.protocol === 'https:' ? https : http;
  const requestOptions = (request, upgrade = false) => ({
    protocol:target.protocol, hostname:target.hostname.replace(/^\[|\]$/g,''), port:target.port,
    path:request.url, method:request.method, headers:{...forwardedHeaders(request.headers,upgrade),host:target.host},
  });
  const server = http.createServer((request,response)=>{
    const pathname = (request.url || '').split('?')[0];
    if (!pathname.startsWith('/') || pathname.startsWith('//')) return send(response,400,'Invalid request target');
    if (isApi(pathname)) {
      const upstream = transport.request(requestOptions(request),incoming=>{
        response.writeHead(incoming.statusCode || 502, forwardedHeaders(incoming.headers));
        response.flushHeaders();
        incoming.on('error',()=>response.destroy());
        incoming.pipe(response);
      });
      upstream.on('error',()=>{if (!response.headersSent) send(response,502,'API unavailable');else response.destroy();});
      request.on('aborted',()=>upstream.destroy());
      response.on('close',()=>upstream.destroy());
      request.pipe(upstream);
      return;
    }
    const head = request.method === 'HEAD';
    if (request.method !== 'GET' && !head) return send(response,405,'Method not allowed',{allow:'GET, HEAD'});
    if (pathname === '/__scone/session') {
      if (!trustedLocalRequest(request)) return send(response,403,'Local bootstrap unavailable',{'cache-control':'no-store'},head);
      return send(response,200,JSON.stringify({key:uiKey}),{'content-type':'application/json','cache-control':'no-store'},head);
    }
    if (!isPage(pathname)) return send(response,404,'Not found',{},head);
    const key = !isPublic(pathname) && trustedLocalRequest(request) ? uiKey : '';
    const page = html.replace(bootstrapPattern,()=>encodeBootstrap(key));
    const etag = '"' + createHash('sha256').update(page).digest('hex') + '"';
    const headers = {'content-type':'text/html; charset=utf-8','cache-control':uiKey && !isPublic(pathname) ? 'no-store' : 'no-cache',etag,'referrer-policy':'same-origin'};
    if (!key && request.headers['if-none-match']?.split(/\s*,\s*/).some(value=>value === etag || value === 'W/'+etag || value === '*')) {
      response.writeHead(304,headers);response.end();return;
    }
    send(response,200,page,headers,head);
  });
  const upgrades = new Set();
  upgradedSockets.set(server, upgrades);
  const trackUpgrade = socket => {upgrades.add(socket);socket.on('close',()=>upgrades.delete(socket));};
  server.on('upgrade',(request,socket,head)=>{
    trackUpgrade(socket);
    const pathname = (request.url || '').split('?')[0];
    if (!isApi(pathname) || request.headers.upgrade?.toLowerCase() !== 'websocket') {socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
    const upstream = transport.request(requestOptions(request,true));
    upstream.on('upgrade',(response,peer,upstreamHead)=>{
      trackUpgrade(peer);
      const headers = forwardedHeaders(response.headers,true);
      socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(headers).map(([name,value])=>`${name}: ${value}\r\n`).join('')+'\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
      peer.on('close',()=>socket.destroy());socket.on('close',()=>peer.destroy());
      peer.pipe(socket);socket.pipe(peer);
    });
    upstream.on('response',response=>{
      socket.end(`HTTP/1.1 ${response.statusCode || 502} Upstream rejected upgrade\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);response.resume();
    });
    upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
    upstream.end();
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = readFileSync(process.env.SCONE_UI_HTML || new URL('../dist/console.html',import.meta.url),'utf8');
  const port = Number(process.env.SCONE_UI_PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SCONE_UI_PORT');
  const server = createUiHost({html,backend:process.env.SCONE_API_URL,uiKey:process.env.SCONE_UI_KEY || ''});
  server.listen(port,'127.0.0.1',()=>process.stdout.write(`Scone Webapp: http://127.0.0.1:${port}/memory\n`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>closeUiHost(server));
}
