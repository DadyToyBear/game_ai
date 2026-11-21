const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  let calls = 0;
  const canvas = {isConnected: true, width: 2, height: 2, getClientRects: () => [{}], toBlob: cb => cb(new Blob(['fake'], {type: 'image/png'}))};
  const context = {window: {}, Blob, AbortController, setTimeout, clearTimeout, fetch: async (url, options) => {
    assert.equal(url, '/api/frame');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.headers['Content-Type'], 'image/png');
    calls++;
    return {ok: true};
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/capture.js'), 'utf8'), context);
  const api = context.window.RedotFrameCapture;
  assert.equal(calls, 0, 'capture must not start without opt-in');
  let status = '';
  api.start({canvas: () => canvas, token: 'test-secret', onStatus: value => {status = value;}, interval: 1000});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.match(status, /передан/);
  api.stop();
  assert.equal(api.isRunning(), false);
  console.log('capture opt-in and stop test passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
