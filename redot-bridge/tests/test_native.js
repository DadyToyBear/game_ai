const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const ids = ['screen', 'token', 'connect', 'status', 'play', 'stop', 'snapshot', 'delete', 'record'];
  const els = Object.fromEntries(ids.map(id => [id, {id, disabled: false, value: '', textContent: ''}]));
  let drawings = 0, clears = 0, frameAvailable = true, tick, frameDeferred = null;
  els.screen.width = 960; els.screen.height = 540;
  els.screen.getContext = () => ({drawImage: () => drawings++, clearRect: () => clears++});
  const requests = [];
  const context = {
    document: {getElementById: id => els[id]},
    window: {addEventListener: () => {}},
    Headers, Blob, URL, setTimeout, clearTimeout,
    setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {},
    createImageBitmap: async () => ({width: 4, height: 4, close() {}}),
    fetch: async (url, opts) => {
      requests.push([url, opts]);
      assert.equal(opts.headers.get('Authorization'), 'Bearer correct');
      if (url === '/api/frame' && !opts.method && frameDeferred) await frameDeferred;
      return {ok: true, json: async () => ({editor_connected: true, playing: true, pending: null, frame_available: frameAvailable, frame_source: 'native-game', frame_age_seconds: 0}), blob: async () => new Blob(['x'], {type: 'image/jpeg'})};
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/native.js'), 'utf8'), context);
  assert.equal(requests.length, 0, 'viewer must not connect automatically');
  els.token.value = 'correct'; els.connect.onclick();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(drawings, 1);
  assert.match(els.status.textContent, /Игра запущена/);
  await els.play.onclick();
  const play = requests.find(([url]) => url === '/api/command');
  assert.equal(play[1].method, 'POST');
  assert.equal(JSON.parse(play[1].body).command, 'play');
  frameAvailable = false; await tick();
  assert.equal(clears, 1, 'viewer clears frame deleted through MCP');
  frameAvailable = true;
  let releaseFrame;
  frameDeferred = new Promise(resolve => { releaseFrame = resolve; });
  const refreshing = tick();
  await new Promise(resolve => setTimeout(resolve, 0));
  await els.delete.onclick();
  releaseFrame(); await refreshing;
  assert.equal(drawings, 1, 'an in-flight stale frame cannot undo deletion');
  assert.equal(clears, 2);
  els.connect.onclick();
  assert.equal(clears, 3, 'disconnect clears visible frame');
  assert.equal(els.token.value, '');
  assert.equal(els.play.disabled, true);
  console.log('native viewer opt-in and play command test passed');
})().catch(err => {console.error(err); process.exitCode = 1;});
