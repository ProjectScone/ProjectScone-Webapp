import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consoleAccessKey } from '../src/local-session.ts';

test('local development bootstrap accepts only the explicit native console token', () => {
  assert.equal(consoleAccessKey('<script id="scone-bootstrap" type="application/json">{"key":"local-react-test"}</script>'), 'local-react-test');
  assert.equal(consoleAccessKey('<script id="scone-bootstrap" type="application/json">{"key":"__SCONE_TOKEN__"}</script>'), '');
  assert.equal(consoleAccessKey('<script data-token="local-test">x()</script>'), 'local-test');
  assert.equal(consoleAccessKey('const TOKEN = document.currentScript.dataset.token || "rust-test";'), 'rust-test');
  assert.equal(consoleAccessKey('<p>key=unrelated-text</p>'), '');
  assert.equal(consoleAccessKey('const TOKEN = document.currentScript.dataset.token || "__SCONE_TOKEN__";'), '');
});

test('development bootstrap uses its own UI host JSON contract',async t=>{
  const {localSession}=await import('../src/local-session.ts');
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  let requested;
  globalThis.fetch=async(url,options)=>{requested={url,options};return new Response(JSON.stringify({key:'ui-host-key'}),{headers:{'content-type':'application/json'}});};
  assert.equal(await localSession('/memory'),'ui-host-key');
  assert.equal(requested.url,'/__scone/session');assert.equal(requested.options.cache,'no-store');
  requested=undefined;assert.equal(await localSession('/learn'),'');assert.equal(await localSession('/docs/quickstart'),'');assert.equal(requested,undefined);
  globalThis.fetch=async()=>new Response(JSON.stringify({key:123}));assert.equal(await localSession('/memory'),'');
});
