import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { initialWorld, migrateWorld, advance, applyOrders, addEvent } from './simulation.js';
import { askLord, templates } from './ai.js';
import { trade, treasurerAdvice, refreshMarket } from './market.js';
import { diplomacy } from './kingdoms.js';
import { hireGuard, marshalAdvice } from './defense.js';
import { improve, elderAdvice } from './improvements.js';
const worldView = world => ({ ...world, treasurer: treasurerAdvice(world), marshal: marshalAdvice(world), elder: elderAdvice(world) });

const port = Number(process.env.PORT || 5173);
const dataDir = resolve(process.env.DATA_DIR || '.game-data');
mkdirSync(dataDir, { recursive: true });
const sessions = new Map();
function persist(id, session) { const path = join(dataDir, `${id}.json`); writeFileSync(path + '.tmp', JSON.stringify(session.world)); renameSync(path + '.tmp', path); }
function getSession(req, res) {
  const match = /(?:^|;\s*)kingdom_session=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '');
  const id = match ? match[1] : randomBytes(24).toString('hex');
  if (!match) res.setHeader('Set-Cookie', `kingdom_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
  if (!sessions.has(id)) {
    let world; try { world = JSON.parse(readFileSync(join(dataDir, `${id}.json`), 'utf8')); if (!Array.isArray(world.villagers)) throw new Error('invalid'); world = migrateWorld(world); } catch { world = initialWorld(); }
    sessions.set(id, { world, lastTick: Date.now(), epoch: 0, busy: false });
  }
  return [id, sessions.get(id)];
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(body)); }
async function readBody(req) { let body = ''; for await (const part of req) { body += part; if (body.length > 4096) throw new Error('too_large'); } return JSON.parse(body || '{}'); }
async function api(req, res) {
  if (req.method === 'POST') {
    if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Требуется JSON.' });
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Недопустимый источник запроса.' });
  }
  const [id, session] = getSession(req, res);
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/api/world') return json(res, 200, { world: worldView(session.world), aiConfigured: !!process.env.OPENROUTER_API_KEY });
  if (req.method !== 'POST') return json(res, 404, { error: 'Не найдено.' });
  let data; try { data = await readBody(req); } catch { return json(res, 400, { error: 'Некорректный запрос.' }); }
  if (path === '/api/control') {
    if (data.action === 'toggle') session.world.playing = !session.world.playing;
    else if (data.action === 'speed') session.world.speed = session.world.speed === 1 ? 2 : 1;
    else if (data.action === 'next') advance(session.world);
    else if (data.action === 'reset') { session.epoch++; session.world = initialWorld(); }
    else return json(res, 400, { error: 'Неизвестное действие.' });
    session.lastTick = Date.now(); persist(id, session); return json(res, 200, { world: worldView(session.world) });
  }
  if (path === '/api/diplomacy' || path === '/api/guard' || path === '/api/improvement') {
    const outcome = path === '/api/diplomacy' ? diplomacy(session.world, data.target, data.action, addEvent) : path === '/api/guard' ? hireGuard(session.world, addEvent) : improve(session.world, data.kind, addEvent);
    if (!outcome.ok) return json(res, 400, { error:outcome.message, world:worldView(session.world) });
    if (path === '/api/diplomacy') refreshMarket(session.world);
    persist(id, session); return json(res, 200, { world:worldView(session.world), result:outcome });
  }
  if (path === '/api/trade') {
    const outcome = trade(session.world, data.direction, data.amount, data.expectedPrice, addEvent);
    if (!outcome.ok) return json(res, outcome.code === 'stale' ? 409 : 400, { error:outcome.message, world:worldView(session.world) });
    persist(id, session); return json(res, 200, { world:worldView(session.world), trade:outcome.record });
  }
  if (path === '/api/decrees') {
    let decision;
    if (typeof data.template === 'string' && Object.hasOwn(templates, data.template)) decision = templates[data.template];
    else {
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 300) return json(res, 400, { error: 'Введите указ длиной до 300 символов.' });
      if (session.busy) return json(res, 429, { error: 'Лорд уже рассматривает указ. Дождитесь ответа.' });
      session.busy = true; const epoch = session.epoch;
      try { decision = await askLord(data.text.trim(), session.world); }
      catch { return json(res, 503, { error: process.env.OPENROUTER_API_KEY ? 'Не удалось получить ответ OpenRouter. Попробуйте позже или используйте готовый указ.' : 'OpenRouter не настроен. Используйте готовый указ или добавьте ключ на сервер.' }); }
      finally { session.busy = false; }
      if (epoch !== session.epoch) return json(res, 409, { error: 'Мир был сброшен, пока лорд рассматривал указ.' });
    }
    applyOrders(session.world, decision, decision.reply); persist(id, session); return json(res, 200, { world: worldView(session.world) });
  }
  return json(res, 404, { error: 'Не найдено.' });
}
const isProd = process.env.NODE_ENV === 'production';
const vite = !isProd ? await (await import('vite')).createServer({ server: { middlewareMode: true, allowedHosts: true }, appType: 'spa' }) : null;
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };
const server = http.createServer((req,res) => {
  if (req.url?.startsWith('/api/')) { api(req,res).catch(() => { if (!res.headersSent) json(res, 500, { error:'Ошибка сервера.' }); else res.end(); }); return; }
  // Never serve server code, save files, or environment files through the dev middleware.
  let requestedPath; try { requestedPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  if (/^\/(?:server|\.game-data)(?:\/|$)/.test(requestedPath) || /(?:^|\/)\.env(?:\.|$)/.test(requestedPath)) { res.writeHead(403); return res.end(); }
  if (vite) return vite.middlewares(req,res);
  let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  const root = resolve('dist'); let path = resolve(root, '.' + pathname); if (!path.startsWith(root + '/') && path !== root) { res.writeHead(403); return res.end(); }
  if (!existsSync(path) || pathname === '/') path = join(root, 'index.html');
  try { res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); res.end(readFileSync(path)); } catch { res.writeHead(404); res.end(); }
});
setInterval(() => { const now = Date.now(); for (const [id, session] of sessions) { if (session.world.playing && now - session.lastTick >= (session.world.speed === 2 ? 1800 : 5000)) { advance(session.world); session.lastTick = now; persist(id, session); } } }, 500).unref();
server.listen(port, '0.0.0.0', () => console.log(`King Grain server listening on port ${port}`));
