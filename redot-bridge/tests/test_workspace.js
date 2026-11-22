const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const ids = ['dashboard-url', 'load-dashboard', 'open-dashboard', 'close-dashboard', 'dashboard-status', 'dashboard'];
const els = Object.fromEntries(ids.map(id => [id, {value:'', disabled: false, textContent:'', src:'about:blank'}]));
els['open-dashboard'].disabled = true; els['close-dashboard'].disabled = true;
const opened = [];
const location = new URL('http://127.0.0.1:8765/workspace.html');
const context = {document:{getElementById:id => els[id]}, window:{open:(...args)=>opened.push(args)}, location, URL};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/workspace.js'), 'utf8'), context);
assert.equal(els.dashboard.src, 'about:blank', 'no remote dashboard before consent');
assert.equal(opened.length, 0);
for (const bad of ['http://example.org/dashboard', 'javascript:alert(1)', 'https://user:pass@example.org/', 'https://example.org/#secret', 'http://127.0.0.1:8765/native.html']) {
  els['dashboard-url'].value = bad; els['load-dashboard'].onclick();
  assert.equal(els.dashboard.src, 'about:blank', `must reject ${bad}`);
  assert.equal(els['open-dashboard'].disabled, true);
}
els['dashboard-url'].value = 'https://dashboard.example/s/private/dashboard.html?view=1';
els['load-dashboard'].onclick();
assert.equal(els.dashboard.src, 'https://dashboard.example/s/private/dashboard.html?view=1');
assert.equal(els['dashboard-url'].value, '', 'address removed from visible field');
assert.equal(els['open-dashboard'].disabled, false);
els['open-dashboard'].onclick();
assert.deepEqual(opened[0], ['https://dashboard.example/s/private/dashboard.html?view=1', '_blank', 'noopener,noreferrer']);
els['close-dashboard'].onclick();
assert.equal(els.dashboard.src, 'about:blank');
assert.equal(els['open-dashboard'].disabled, true);
assert.match(els['dashboard-status'].textContent, /удалён/);
// HTTPS relay page cannot embed even localhost HTTP due to mixed content.
context.location = new URL('https://relay.example/workspace.html');
els['dashboard-url'].value = 'http://127.0.0.1:9000/dashboard.html';
els['load-dashboard'].onclick();
assert.equal(els.dashboard.src, 'about:blank');
assert.match(els['dashboard-status'].textContent, /HTTP/);
const html = fs.readFileSync(path.join(__dirname, '../web/workspace.html'), 'utf8');
assert.match(html, /sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"/);
assert.match(html, /referrerpolicy="no-referrer"/);
assert.doesNotMatch(html, /https?:\/\/[^…]/, 'page should not contain a hardcoded remote endpoint');
console.log('workspace explicit connection, origin validation and disconnect tests passed');
