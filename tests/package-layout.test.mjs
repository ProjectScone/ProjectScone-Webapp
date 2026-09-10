import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scone-package-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const write = (relative, text) => {const file=path.join(root,relative); fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  write('scripts/package.mjs',fs.readFileSync(new URL('../scripts/package.mjs',import.meta.url)));
  write('dist/index.html','<html><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></html>');
  write('dist/assets/app.js','window.fixture = true;');
  write('dist/assets/app.css','body { color: olive; }');
  const run=(...args)=>spawnSync(process.execPath,[path.join(root,'scripts/package.mjs'),...args],{cwd:root,encoding:'utf8'});
  return {root,write,run,read:relative=>fs.readFileSync(path.join(root,relative),'utf8')};
}
test('packages a standalone artifact without any sibling repositories',t=>{
  const {run,read,write}=fixture(t);
  const result=run();assert.equal(result.status,0,result.stderr);
  assert.match(read('dist/console.html'),/window.fixture = true;/);
  assert.match(read('dist/console.html'),/body \{ color: olive; \}/);
  assert.doesNotMatch(read('dist/console.html'),/(?:src|href)="\/assets\//);
  assert.equal(run('--check').status,0);
  write('dist/console.html','drift');
  assert.equal(run('--check').status,1);
  assert.equal(read('dist/console.html'),'drift');
});
test('explicit output writes only the chosen artifact',t=>{
  const {run,read,root}=fixture(t);
  const result=run('--output',path.join(root,'preview.html'));
  assert.equal(result.status,0,result.stderr);assert.match(read('preview.html'),/window.fixture/);
  assert.equal(fs.existsSync(path.join(root,'dist/console.html')),false);
  assert.notEqual(run('--output').status,0);
  assert.notEqual(run('--output','preview.html','--check').status,0);
});
