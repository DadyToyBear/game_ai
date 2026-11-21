const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  let calls = 0, delayedFetch = null, deadline = null, retry = null;
  const sources = [];
  const canvas = {isConnected: true, width: 2, height: 2, getClientRects: () => [{}], toBlob: cb => cb(new Blob(['fake'], {type: 'image/png'}))};
  let fakeTimers = false;
  const context = {window: {}, Blob, AbortController,
    setTimeout: (callback, delay) => {
      if (fakeTimers && delay === 10000) { deadline = callback; return 10001; }
      if (fakeTimers && delay === 1000) { retry = callback; return 10002; }
      return setTimeout(callback, delay);
    },
    clearTimeout: id => { if (id !== 10001 && id !== 10002) clearTimeout(id); }, fetch: async (url, options) => {
    assert.equal(url, '/api/frame');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.headers['Content-Type'], 'image/png');
    sources.push(options.headers['X-Redot-Source']);
    calls++;
    if (delayedFetch) await delayedFetch;
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
  assert.equal(sources[0], 'unspecified', 'demo/default must not be labeled as a game');
  api.start({canvas: () => canvas, token: 'test-secret', source: 'web-game'});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sources[1], 'web-game');
  api.stop();
  let releaseFetch;
  delayedFetch = new Promise(resolve => { releaseFetch = resolve; });
  const staleStatuses = [];
  api.start({canvas: () => canvas, token: 'test-secret', source: 'web-game', onStatus: value => staleStatuses.push(value)});
  await new Promise(resolve => setTimeout(resolve, 10));
  api.stop(); releaseFetch();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(staleStatuses, [], 'a completed old upload must not update a stopped session');
  delayedFetch = null;
  // Canvas serialization can itself hang; timeout retries without allowing a
  // late callback to publish or overwrite the status of the newer attempt.
  fakeTimers = true;
  let lateBlob;
  const blockedCanvas = {...canvas, toBlob: callback => { lateBlob = callback; }};
  const beforeTimeout = calls;
  api.start({canvas: () => blockedCanvas, token: 'test-secret', interval: 1000, onStatus: value => {status = value;}});
  deadline();
  assert.match(status, /время ожидания/);
  blockedCanvas.toBlob = callback => callback(new Blob(['fresh'], {type: 'image/png'}));
  retry(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, beforeTimeout + 1, 'next capture succeeds after canvas timeout');
  lateBlob(new Blob(['stale'], {type: 'image/png'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, beforeTimeout + 1, 'old timed-out canvas must never upload');
  assert.match(status, /передан/);
  api.stop(); fakeTimers = false;
  const elements = [];
  const createElement = tag => {
    const element = {tag, style: {}, textContent: '', value: '', addEventListener: (_name, callback) => { element.click = callback; }, setAttribute() {}, append() {}};
    elements.push(element); return element;
  };
  let overlayOptions;
  const overlay = {window: {RedotFrameCapture: {isRunning: () => false, start: options => { overlayOptions = options; }}}, document: {createElement, getElementById: () => canvas, body: {append() {}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/redot-overlay.js'), 'utf8'), overlay);
  elements.find(e => e.tag === 'input').value = 'test-secret';
  elements.find(e => e.tag === 'button').click();
  assert.equal(overlayOptions.source, 'web-game', 'editor overlay must explicitly identify the game canvas');
  assert.equal(overlayOptions.canvas(), canvas);
  const workspace = elements.find(e => e.tag === 'a');
  assert.equal(workspace.href, '/workspace.html');
  assert.equal(workspace.rel, 'noopener noreferrer');
  console.log('capture opt-in and stop test passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
