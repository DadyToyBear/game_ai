const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const ids = ['screen', 'token', 'connect', 'status', 'play', 'stop', 'snapshot', 'delete', 'record', 'load-logs', 'delete-logs', 'logs', 'share-url', 'share-consent', 'share-frame', 'share-status'];
  const els = Object.fromEntries(ids.map(id => [id, {id, disabled: false, value: '', textContent: ''}]));
  let drawings = 0, clears = 0, frameAvailable = true, tick, frameDeferred = null, refreshTimeout;
  let stateSource = 'native-game', responseSource = 'native-game', frameAge = '0.0', commandDeferred = null;
  const recordings = [], tracks = [];
  class FakeRecorder {
    constructor(stream) { this.stream = stream; this.state = 'inactive'; recordings.push(this); }
    static isTypeSupported(type) { return type === 'video/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; } // onstop is intentionally deferred
  }
  els.screen.captureStream = () => { const track = {stopped:false, stop() { this.stopped = true; }}; tracks.push(track); return {getTracks: () => [track]}; };
  els.screen.width = 960; els.screen.height = 540;
  els.screen.getContext = () => ({drawImage: () => drawings++, clearRect: () => clears++});
  const requests = []; let failNotice = false;
  const context = {
    document: {getElementById: id => els[id]},
    window: {addEventListener: () => {}},
    Headers, Blob, URL, Response, AbortController, TextDecoder, crypto: require('node:crypto').webcrypto, location: new URL('http://127.0.0.1:8765/native.html'), MediaRecorder: FakeRecorder,
    setTimeout: (callback, delay) => { if (delay === 10000) { refreshTimeout = callback; return 0; } return setTimeout(callback, delay); },
    clearTimeout,
    setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {},
    createImageBitmap: async () => ({width: 4, height: 4, close() {}}),
    fetch: async (url, opts) => {
      requests.push([url, opts]);
      if (url.startsWith('https://share.example/')) {
        assert.equal(opts.headers.Authorization, undefined, 'bridge secret must not be sent to WebFTP');
        assert.equal(opts.credentials, 'omit'); assert.equal(opts.redirect, 'error');
        const ok = !(failNotice && decodeURIComponent(url).includes('name=chat-'));
        return new Response(JSON.stringify({ok}), {status:200});
      }
      assert.equal(opts.headers.get('Authorization'), 'Bearer correct');
      if (url === '/api/frame' && !opts.method && frameDeferred) await frameDeferred;
      if (url === '/api/command' && commandDeferred) await commandDeferred;
      return {ok: true, headers: new Headers({'X-Redot-Source': responseSource, ...(frameAge === null ? {} : {'X-Redot-Frame-Age': frameAge})}), json: async () => url === '/api/logs' ? ({entries: [{source: 'game', level: 'info', message: '<img src=x onerror=alert(1)>', received_at: 0}]}) : ({editor_connected: true, playing: true, pending: null, frame_available: frameAvailable, frame_source: stateSource, frame_age_seconds: 0}), blob: async () => new Blob(['x'], {type: 'image/jpeg'})};
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/native.js'), 'utf8'), context);
  assert.equal(requests.length, 0, 'viewer must not connect automatically');
  els.token.value = 'correct'; els.connect.onclick();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(drawings, 1);
  assert.match(els.status.textContent, /Игра запущена/);
  assert.match(els.status.textContent, /получен мостом 0\.0 с назад/);
  els['share-url'].value = 'https://share.example/s/test';
  await els['share-frame'].onclick();
  assert.equal(requests.filter(([url]) => url.startsWith('https://share.example/')).length, 0, 'explicit consent required');
  els['share-consent'].checked = true;
  els['share-url'].value = 'http://share.example/s/test';
  await els['share-frame'].onclick();
  assert.match(els['share-status'].textContent, /HTTPS/);
  els['share-url'].value = 'https://share.example/s/test';
  await els['share-frame'].onclick();
  const writes = requests.filter(([url]) => url.startsWith('https://share.example/'));
  assert.equal(writes.length, 2);
  assert.match(writes[0][0], /name=screenshot-live-[0-9a-f]{32}\.jpg$/);
  assert.equal(writes[0][1].body.type, 'image/jpeg');
  assert.match(writes[1][0], /name=chat-\d{14}-[0-9a-f]{12}\.json$/);
  const notice = JSON.parse(await writes[1][1].body.text());
  assert.match(notice.text, /@chat-zai/);
  assert.ok(notice.text.includes(decodeURIComponent(writes[0][0].split('name=')[1])));
  assert.ok(!notice.text.includes('share.example'), 'chat message must not expose the share capability URL');
  assert.match(els['share-status'].textContent, /Отправлены/);
  failNotice = true; await els['share-frame'].onclick();
  assert.match(els['share-status'].textContent, /сообщение не подтверждено/);
  failNotice = false;
  frameAge = '12.3'; await tick();
  assert.match(els.status.textContent, /12\.3 с назад \(возможно устарел\)/);
  frameAge = null; await tick();
  assert.match(els.status.textContent, /возраст кадра неизвестен/);
  frameAge = '0.0'; drawings = 1;
  stateSource = 'web-game'; responseSource = 'web-game'; await tick();
  assert.equal(drawings, 2, 'Web game frames are displayed');
  assert.match(els.status.textContent, /web-game/);
  responseSource = 'unspecified'; await tick();
  assert.equal(drawings, 2, 'frame source is checked on the response, not only status');
  assert.equal(clears, 1);
  stateSource = 'unspecified'; responseSource = 'web-game'; await tick();
  assert.equal(drawings, 2, 'unknown status source is not displayed');
  assert.equal(clears, 2);
  stateSource = 'web-game';
  await els.play.onclick();
  const play = requests.find(([url]) => url === '/api/command');
  assert.equal(play[1].method, 'POST');
  assert.equal(JSON.parse(play[1].body).command, 'play');
  await els['load-logs'].onclick();
  assert.match(els.logs.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(els.logs.innerHTML, undefined, 'log text must not become HTML');
  await els['delete-logs'].onclick();
  assert.equal(els.logs.textContent, '');
  assert.equal(requests.find(([url, opts]) => url === '/api/logs' && opts.method === 'DELETE')[1].method, 'DELETE');
  await els['load-logs'].onclick();
  frameAvailable = false; await tick();
  assert.equal(clears, 3, 'viewer clears frame deleted through MCP');
  frameAvailable = true;
  let releaseFrame;
  frameDeferred = new Promise(resolve => { releaseFrame = resolve; });
  const refreshing = tick();
  await new Promise(resolve => setTimeout(resolve, 0));
  await els.delete.onclick();
  releaseFrame(); await refreshing;
  assert.equal(drawings, 2, 'an in-flight stale frame cannot undo deletion');
  assert.equal(clears, 4);
  els.connect.onclick();
  assert.equal(clears, 5, 'disconnect clears visible frame');
  assert.equal(els.logs.textContent, '', 'disconnect clears visible logs');
  assert.equal(els.token.value, '');
  assert.equal(els.play.disabled, true);
  // Disconnect an unresolved HTTP response and reconnect before it finishes.
  // Old work must not keep the new session busy or paint a stale frame.
  let releaseOldFrame;
  frameDeferred = new Promise(resolve => { releaseOldFrame = resolve; });
  els.token.value = 'correct'; els.connect.onclick();
  await new Promise(resolve => setTimeout(resolve, 0));
  const oldFrameRequest = requests.filter(([url, opts]) => url === '/api/frame' && !opts.method).at(-1);
  els.connect.onclick();
  assert.equal(oldFrameRequest[1].signal.aborted, true, 'disconnect aborts the in-flight refresh');
  frameDeferred = null; const beforeReconnect = drawings;
  els.token.value = 'correct'; els.connect.onclick();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(drawings, beforeReconnect + 1, 'a hung old refresh cannot block reconnect');
  releaseOldFrame(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(drawings, beforeReconnect + 1, 'late old frame cannot overwrite new session');
  // Even a fetch implementation that ignores abort must not prevent retry.
  let releaseHungFrame;
  frameDeferred = new Promise(resolve => { releaseHungFrame = resolve; });
  const hungRefresh = tick(); await new Promise(resolve => setTimeout(resolve, 0));
  refreshTimeout();
  assert.match(els.status.textContent, /время ожидания истекло/);
  frameDeferred = null;
  const beforeRetry = drawings;
  await tick();
  assert.equal(drawings, beforeRetry + 1, 'a timed-out refresh does not block retries');
  releaseHungFrame(); await hungRefresh;
  assert.equal(drawings, beforeRetry + 1, 'timed-out response must not overwrite retry');
  els.connect.onclick();
  // A late command response must not overwrite disconnected UI state.
  frameDeferred = null; els.token.value = 'correct'; els.connect.onclick();
  await new Promise(resolve => setTimeout(resolve, 20));
  let releaseCommand;
  commandDeferred = new Promise(resolve => { releaseCommand = resolve; });
  const command = els.play.onclick();
  els.connect.onclick();
  releaseCommand(); await command;
  assert.equal(els.status.textContent, 'Отключено');
  commandDeferred = null;
  // Reconnecting during asynchronous MediaRecorder finalization must not
  // start a second recording that the old onstop handler could corrupt.
  els.token.value = 'correct'; els.connect.onclick();
  await new Promise(resolve => setTimeout(resolve, 20));
  els.record.onclick();
  assert.equal(recordings.length, 1);
  els.connect.onclick();
  els.token.value = 'correct'; els.connect.onclick();
  await new Promise(resolve => setTimeout(resolve, 20));
  els.record.onclick();
  assert.equal(recordings.length, 1, 'wait for previous recording to finish');
  assert.match(els.status.textContent, /ещё сохраняется/);
  recordings[0].onstop();
  assert.equal(tracks[0].stopped, true);
  els.record.onclick();
  assert.equal(recordings.length, 2, 'recording can restart after finalization');
  els.record.onclick(); recordings[1].onstop();
  assert.equal(tracks[1].stopped, true);
  els.connect.onclick();
  console.log('native viewer opt-in, frame age, command and recording race tests passed');
})().catch(err => {console.error(err); process.exitCode = 1;});
