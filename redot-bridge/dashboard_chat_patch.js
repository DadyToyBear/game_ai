// Replaces only chatList/chatRefresh in the pinned upstream dashboard.
// Listing is authoritative when available; chat-index is an unreliable fallback.
const AGENT_PREFIXES = ['chat-', 'dm-', 'assign-'];
const MCP_PREFIXES = ['task-', 'result-', 'event-'];
let chatGeneration = 0;
const filenameOK = (name, prefixes) => typeof name === 'string' && name !== 'chat-index.json' &&
  /^[A-Za-z0-9_.-]{1,180}\.json$/.test(name) && prefixes.some(p => name.startsWith(p));
async function chatList(prefixes){
  try {
    const r = await fetch(`${SHARE_URL}/?json=1`, {cache:'no-store'});
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.items)) return null;
    return j.items.filter(i => i && i.type === 'file' && filenameOK(i.name, prefixes)).map(i => i.name);
  } catch (_) { return null; }
}
async function chatRead(name){ return await fetchFile(name); }
function chatStamp(){ return new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+Math.random().toString(36).slice(2,7); }
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function readFiles(names) {
  const rows = new Array(names.length); let next = 0;
  async function worker() {
    while (next < names.length) {
      const i = next++, raw = await chatRead(names[i]);
      if (!raw || raw.length > 1024 * 1024) continue;
      try { const data = JSON.parse(raw); if (data && typeof data === 'object' && !Array.isArray(data)) rows[i] = {name:names[i], data}; } catch (_) {}
    }
  }
  await Promise.all(Array.from({length:Math.min(6,names.length)}, worker));
  return rows.filter(Boolean);
}
async function chatRefresh(){
  if(chatBusy)return; chatBusy=true;
  const generation = chatGeneration;
  try {
    const showTraffic = document.getElementById('chat-show-mcp').checked;
    let names = await chatList(showTraffic ? AGENT_PREFIXES.concat(MCP_PREFIXES) : AGENT_PREFIXES);
    const listingOK = names !== null;
    if (!listingOK) {
      const raw = await fetchFile('chat-index.json');
      try { const idx = JSON.parse(raw); names = Array.isArray(idx) ? idx.filter(n => filenameOK(n, AGENT_PREFIXES)) : []; }
      catch (_) { names = []; }
    }
    // Per-category bounds prevent legacy traffic from displacing chat or DMs.
    const byPrefix = p => [...new Set(names.filter(n => n.startsWith(p)))].sort().slice(-50);
    const agentNames = AGENT_PREFIXES.flatMap(byPrefix);
    const rows = await readFiles(agentNames);
    if (generation !== chatGeneration) return;
    const room = rows.filter(r => r.name.startsWith('chat-')).map(r => r.data);
    const dm = rows.filter(r => r.name.startsWith('dm-')).map(r => r.data);
    const assignments = rows.filter(r => r.name.startsWith('assign-')).map(r => r.data);
    const ordered = x => x.sort((a,b) => String(a.ts||'').localeCompare(String(b.ts||'')));
    ordered(room); ordered(dm); ordered(assignments);
    const message = m => `<div class="chat-msg"><span class="time">${esc(String(m.ts||'').slice(11,19))}</span><span class="who">${esc(m.from||'?')}</span>: ${esc(m.text||'')}</div>`;
    const task = m => `<div class="chat-msg task"><span class="time">${esc(String(m.ts||'').slice(11,19))}</span><span class="who">Назначение ${esc(m.agent||'?')}</span>: ${esc(m.method||m.task||'?')} · ${esc(m.status||'статус не указан')}</div>`;
    const rf = document.getElementById('room-feed');
    rf.innerHTML = room.map(message).join('') + assignments.map(task).join('') || '<div style="color:var(--muted);font-size:12px">Сообщений пока нет</div>';
    rf.scrollTop = rf.scrollHeight;
    document.getElementById('chat-count').textContent = room.length+' сообщ. / '+assignments.length+' назначений';
    const me = document.getElementById('chat-from').value.trim();
    const mine = dm.filter(m => (m.from===me&&m.to===selectedAgent)||(m.to===me&&m.from===selectedAgent));
    const df = document.getElementById('dm-feed');
    df.innerHTML = mine.map(m=>`<div class="chat-msg dm"><span class="time">${esc(String(m.ts||'').slice(11,19))}</span><span class="who">${esc(m.from)}</span> → ${esc(m.to)}: ${esc(m.text||'')}</div>`).join('') || '<div style="color:var(--muted);font-size:12px">ЛС пуста</div>';
    df.scrollTop = df.scrollHeight;
    document.getElementById('chat-list-status').textContent = listingOK ? 'Оглавление WebFTP; показаны до 50 файлов каждой категории.' : 'Оглавление недоступно: показан только возможный неполный индекс.';
    const traffic = document.getElementById('chat-mcp-feed');
    traffic.hidden = !showTraffic;
    if (showTraffic) {
      if (!listingOK) { traffic.textContent = 'MCP-трафик недоступен без оглавления.'; return; }
      const trafficNames = MCP_PREFIXES.flatMap(byPrefix).slice(-60);
      const trafficRows = await readFiles(trafficNames);
      if (generation !== chatGeneration) return;
      traffic.textContent = trafficRows.map(r => r.name+'\n'+JSON.stringify(r.data,null,2).slice(0,4000)).join('\n\n') || 'MCP-файлов нет в выбранной части списка.';
    } else traffic.textContent = '';
  } catch (_) {
    if (generation === chatGeneration) document.getElementById('chat-list-status').textContent = 'Не удалось обновить чат.';
  } finally { chatBusy=false; }
}
document.getElementById('chat-show-mcp').onchange = () => { chatGeneration++; document.getElementById('chat-mcp-feed').hidden = !document.getElementById('chat-show-mcp').checked; document.getElementById('chat-mcp-feed').textContent=''; if (!chatBusy) chatRefresh(); };
