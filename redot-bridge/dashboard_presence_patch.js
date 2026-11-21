// Presence files are self-reported and can be forged on a writable share.
AGENTS.push(
  {id:'opencode-1',name:'OpenCode · 1',model:'агент'},
  {id:'opencode-2',name:'OpenCode · 2',model:'агент'},
  {id:'opencode-orchestrator',name:'OpenCode · orchestrator',model:'агент'}
);
const presenceById = new Map();
let presenceFetchAt = 0, presenceLoading = false;
function presenceDescription(id) {
  const data = presenceById.get(id);
  if (!data) return '⚪ Нет достоверных данных heartbeat';
  const age = Math.floor((Date.now() - data.at) / 1000);
  if (age < -60) return '⚪ Некорректное время heartbeat';
  const seconds = Math.max(0, age);
  const when = seconds < 60 ? `${seconds} с` : `${Math.floor(seconds/60)} мин`;
  const state = !data.alive ? '⚪ Заявлен offline' : seconds < 300 ? '🟢 Недавний сигнал' : seconds < 900 ? '🟡 Сигнал устарел' : '🔴 Сигнал давно не обновлялся';
  return `${state} · ${when} назад${data.status ? ' · '+data.status : ''}`;
}
function renderPresence() {
  document.querySelectorAll('#agent-list .presence').forEach(el => { el.textContent = presenceDescription(el.dataset.agent); });
}
function buildAgentList(){
  const el=document.getElementById('agent-list');
  el.innerHTML=AGENTS.map(a=>`<div class="agent-item ${a.id===selectedAgent?'active':''}" data-id="${esc(a.id)}">${esc(a.name)}<small>${esc(a.model)}</small><small class="presence" data-agent="${esc(a.id)}"></small></div>`).join('');
  el.querySelectorAll('.agent-item').forEach(x=>x.onclick=()=>{selectedAgent=x.dataset.id;document.getElementById('dm-with').textContent='с '+selectedAgent;buildAgentList();chatRefresh();});
  const sel=document.getElementById('task-agent');
  sel.innerHTML=AGENTS.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  sel.value=selectedAgent;
  document.getElementById('dm-with').textContent='с '+selectedAgent;
  renderPresence();
}
async function refreshPresence() {
  renderPresence();
  if (presenceLoading || Date.now()-presenceFetchAt < 30000) return;
  presenceLoading = true; presenceFetchAt = Date.now();
  try {
    const entries = await Promise.all(AGENTS.map(async a => {
      const raw = await fetchFile(`agent-${a.id}-heartbeat.json`);
      if (!raw || raw.length > 4096) return [a.id, null];
      try {
        const p=JSON.parse(raw), at=Date.parse(p.ts);
        if (p.agent!==a.id || typeof p.alive!=='boolean' || typeof p.status!=='string' || p.status.length>200 || /[\x00-\x1f]/.test(p.status) ||
            typeof p.ts!=='string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(p.ts) || !Number.isFinite(at) || at>Date.now()+60000) return [a.id,null];
        return [a.id,{at,alive:p.alive,status:p.status}];
      } catch (_) { return [a.id,null]; }
    }));
    for (const [id,data] of entries) presenceById.set(id,data);
    renderPresence();
  } finally { presenceLoading=false; }
}
