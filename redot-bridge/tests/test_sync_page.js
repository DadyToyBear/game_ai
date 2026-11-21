const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const ids = ['token', 'connect', 'status', 'export', 'import', 'file'];
  const els = Object.fromEntries(ids.map(id => [id, {id, disabled: false, value: '', textContent: '', files: []}]));
  const requests = [];
  let confirms = 0;
  const context = {
    document: {getElementById: id => els[id], createElement: () => ({click() {}, remove() {}}), body: {append() {}}},
    Headers, Blob, setTimeout: fn => {fn();}, URL: {createObjectURL: () => 'blob:test', revokeObjectURL() {}},
    confirm: () => {confirms++; return true;},
    fetch: async (url, opts) => {
      assert.equal(opts.headers.get('Authorization'), 'Bearer secret');
      requests.push([url, opts]);
      return {ok: true, json: async () => url.includes('status') ? {configured: true, name: 'game'} : {imported_to: '/game-web-import-1'}, blob: async () => new Blob(['x'], {type: 'application/zip'})};
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/sync.js'), 'utf8'), context);
  assert.equal(requests.length, 0, 'must not access projects before consent');
  els.token.value = 'secret'; await els.connect.onclick();
  assert.equal(requests[0][0], '/api/project/status');
  assert.equal(els.token.value, '');
  await els.export.onclick();
  assert.equal(requests[1][0], '/api/project/export');
  els.file.files = [new Blob(['zip'], {type: 'application/zip'})];
  await els.import.onclick();
  assert.equal(requests[2][0], '/api/project/import');
  assert.equal(requests[2][1].method, 'POST');
  assert.equal(confirms, 2);
  assert.match(els.status.textContent, /game-web-import-1/);
  await els.connect.onclick();
  assert.equal(els.export.disabled, true);
  console.log('snapshot page explicit connect and confirmation test passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
