const fs = require('node:fs');
const {once} = require('node:events');

exports.fixtureHost = async function fixtureHost(t, {backend, html, uiKey = ''}) {
  const {createUiHost,closeUiHost} = await import('./host.mjs');
  const server = createUiHost({backend, html:fs.readFileSync(html,'utf8'), uiKey});
  t.after(()=>new Promise(resolve=>closeUiHost(server,resolve)));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return `http://127.0.0.1:${server.address().port}`;
};
exports.testPython = function testPython() {
  if (!process.env.SCONE_TEST_PYTHON) throw new Error('Set SCONE_TEST_PYTHON to an explicit Python interpreter with the standalone Scone API installed');
  return process.env.SCONE_TEST_PYTHON;
};
