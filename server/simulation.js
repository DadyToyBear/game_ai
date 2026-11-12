export const seasons = ['Весна', 'Лето', 'Осень', 'Зима'];
export const season = day => seasons[Math.floor((day - 1) / 10) % 4];
export const MAP = [
  'TTTGGGGTTTTT',
  'TTGGGHGGGTTT',
  'TGGGPPPPGGTT',
  'GGGGPBBPGGTG',
  'GGLPPPPPSDGG',
  'GGGGPFFFFFGG',
  'TTGGPFFFFFGG',
  'TTGGPPPPPGGG',
  'TTTGGGGGGGTT',
];
export const LOCATIONS = { home: [4, 2], pantry: [4, 4], stockpile: [2, 4], site: [8, 4], houseSite: [9, 4], field: [6, 5], forest: [2, 3] };
export const BARN_WOOD = 24;
export const BARN_WORK = 6;
export const BARN_CAPACITY = 160;
export const HOUSE_WOOD = 18;
export const HOUSE_WORK = 5;
export const HOUSE_BEDS = 6;
const names = ['Эдмунд', 'Матильда', 'Томас', 'Агнес', 'Генрих', 'Роза', 'Уильям', 'Элеонора', 'Роберт', 'Маргарет', 'Освальд', 'Алиса'];
const colors = ['#bf945f', '#b97958', '#9d805f', '#c9a681', '#9a715a', '#b8896b'];
const traits = ['Трудолюбивый', 'Заботливая', 'Терпеливый', 'Любознательная', 'Упорный', 'Добрая', 'Рассудительный', 'Смелая', 'Дружелюбный', 'Практичная', 'Спокойный', 'Внимательная'];
const clamp = n => Math.max(0, Math.min(100, n));
const round = n => Math.round(n * 10) / 10;
export function initialWorld() {
  return { version: 4, map: MAP, day: 1, grain: 284, grainCapacity: 320, wood: 126, gold: 86, loyalty: 78, focus: 'balanced', ration: 'normal', playing: true, speed: 1,
    field: { planted: 0, care: 0, harvestRemaining: 0, harvested: 0 },
    barn: { status: 'available', delivered: 0, progress: 0 },
    house: { status: 'available', delivered: 0, progress: 0 },
    reply: 'Мой лорд, земли Грейнхолда ждут вашего мудрого слова.',
    villagers: names.map((name, i) => ({ id: i + 1, name, age: 20 + (i * 7) % 35, trait: traits[i], farmingSkill: i % 3 === 2 ? 2 : 4 + i % 3, woodSkill: i % 3 === 2 ? 5 : 2, constructionSkill: 3 + (i * 3) % 6, homeId: i < 6 ? 'old' : null, mood: 75, role: i % 3 === 2 ? 'Дровосек' : 'Фермер', color: colors[i % colors.length], hunger: 12 + (i * 3) % 15, energy: 70 + (i * 5) % 25, task: 'resting', x: [4,5,6,7][i % 4], y: 2, carriedWood: 0, carriedLogs: 0 })),
    events: [ { id: 'start-1', day: 1, text: 'Поселенцы приступили к своим повседневным делам.', kind: 'info' }, { id: 'start-2', day: 1, text: 'Весна пришла: пора засеять поля.', kind: 'good' }, { id: 'start-3', day: 1, text: 'Начинается летопись Грейнхолда.', kind: 'info' } ] };
}
// Preserve existing saves while introducing map positions and the new systems.
export function migrateWorld(old) {
  const fresh = initialWorld();
  if ((old.version === 2 || old.version === 3 || old.version === 4) && old.barn && old.field) {
    const villagers = fresh.villagers.map((v, i) => {
      const previous = old.villagers?.find(p => p.id === v.id) || old.villagers?.[i];
      return previous ? { ...v, ...previous } : v;
    });
    return { ...fresh, ...old, version: 4, map: MAP, house: old.house || fresh.house, villagers };
  }
  const villagers = fresh.villagers.map((v, i) => {
    const previous = old.villagers?.find(p => p.id === v.id) || old.villagers?.[i];
    return previous ? { ...v, name: previous.name || v.name, hunger: clamp(previous.hunger ?? v.hunger), energy: clamp(previous.energy ?? v.energy), role: previous.role || v.role, color: previous.color || v.color } : v;
  });
  return { ...fresh, day: old.day || 1, grain: old.grain ?? fresh.grain, grainCapacity: Math.max(fresh.grainCapacity, Math.ceil(old.grain || 0)), wood: old.wood ?? fresh.wood, gold: old.gold ?? fresh.gold, loyalty: old.loyalty ?? fresh.loyalty, focus: old.focus || fresh.focus, ration: old.ration || fresh.ration, playing: old.playing ?? true, speed: old.speed || 1, reply: old.reply || fresh.reply, events: Array.isArray(old.events) ? old.events : fresh.events, villagers };
}
export function addEvent(w, text, kind = 'info') { w.events.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, day: w.day, text, kind }); w.events = w.events.slice(0, 30); }
export function isWalkable(x, y) { return y >= 0 && y < MAP.length && x >= 0 && x < MAP[0].length && !'THB'.includes(MAP[y][x]); }
// Breadth-first search: four-direction movement around impassable trees and buildings.
export function findPath(start, end) {
  if (!isWalkable(...start) || !isWalkable(...end)) return [];
  const queue = [[start]], seen = new Set([start.join(',')]);
  while (queue.length) {
    const path = queue.shift(), [x,y] = path[path.length - 1];
    if (x === end[0] && y === end[1]) return path.slice(1);
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const next = [x+dx,y+dy], key = next.join(',');
      if (isWalkable(...next) && !seen.has(key)) { seen.add(key); queue.push([...path,next]); }
    }
  }
  return [];
}
function moveTo(v, target) {
  // Up to two straight grid steps per day; never cut a corner through obstacles.
  if (v.x === target[0] && v.y === target[1]) return true;
  const path = findPath([v.x,v.y], target);
  if (!path.length) return false;
  const step = path.length > 1 && (path[1][0] - path[0][0] === path[0][0] - v.x) && (path[1][1] - path[0][1] === path[0][1] - v.y) ? path[1] : path[0]; [v.x,v.y] = step;
  return v.x === target[0] && v.y === target[1];
}
function startProject(w, kind) {
  const project = w[kind], other = w[kind === 'barn' ? 'house' : 'barn'];
  if (project.status !== 'available') return 'already';
  if (other.status === 'building') return 'busy';
  project.status = 'building';
  addEvent(w, `Заложен ${kind === 'barn' ? 'новый амбар' : 'новый дом'}. Строители несут древесину со склада.`, 'good');
  return 'started';
}
// Traits affect output only for the traits explicitly covered here.
export function workFactor(v, skill) {
  const traitBonus = v.trait === 'Трудолюбивый' ? 1.2 : v.trait === 'Упорный' || v.trait === 'Практичная' ? 1.1 : 1;
  return (0.6 + Math.max(1, Math.min(10, skill)) * 0.1) * traitBonus * (0.75 + clamp(v.mood ?? 75) / 400);
}
function farming(w, v) {
  const s = season(w.day), f = w.field, factor = workFactor(v, v.farmingSkill);
  if (s === 'Весна' && f.planted < 12 && w.grain > 0) {
    const amount = Math.min(factor, 12 - f.planted, w.grain);
    w.grain = round(w.grain - amount); f.planted = round(f.planted + amount);
  } else if (s === 'Лето' && f.planted > 0) f.care = round(Math.min(24, f.care + factor));
  else if (s === 'Осень' && f.harvestRemaining > 0) {
    const amount = Math.min(round(12 * factor), f.harvestRemaining), space = Math.max(0, w.grainCapacity - w.grain);
    const stored = Math.min(amount, space); w.grain = round(w.grain + stored); f.harvested = round(f.harvested + stored); f.harvestRemaining = round(f.harvestRemaining - amount);
    if (stored < amount) addEvent(w, `Амбар полон: ${round(amount-stored)} мешков урожая потеряно.`, 'warn');
    if (f.harvestRemaining === 0) addEvent(w, `Урожай собран: в амбар доставлено ${round(f.harvested)} мешков.`, 'good');
  }
}
function doConstruction(w, v, kind) {
  const b = w[kind], cost = kind === 'barn' ? BARN_WOOD : HOUSE_WOOD, work = kind === 'barn' ? BARN_WORK : HOUSE_WORK, site = kind === 'barn' ? LOCATIONS.site : LOCATIONS.houseSite;
  if (v.carriedWood > 0) {
    v.task = 'hauling';
    if (moveTo(v, site)) { b.delivered += v.carriedWood; v.carriedWood = 0; }
  } else {
    const inTransit = w.villagers.reduce((sum,p) => sum + p.carriedWood, 0);
    if (b.delivered + inTransit < cost && w.wood >= 1) {
      v.task = 'fetching';
      if (moveTo(v, LOCATIONS.stockpile)) {
        const amount = Math.min(6, cost - b.delivered - inTransit, Math.floor(w.wood));
        if (amount > 0) { w.wood = round(w.wood - amount); v.carriedWood = amount; }
      }
    } else if (b.delivered >= cost) {
      v.task = 'building';
      if (moveTo(v, site)) {
        b.progress = round(Math.min(work, b.progress + workFactor(v, v.constructionSkill)));
        if (b.progress >= work) {
          b.status = 'complete';
          if (kind === 'barn') { w.grainCapacity += BARN_CAPACITY; addEvent(w, `Амбар построен! Вместимость зерна выросла до ${w.grainCapacity} мешков.`, 'good'); }
          else { let beds = HOUSE_BEDS; for (const person of w.villagers) if (!person.homeId && beds > 0) { person.homeId = 'new'; beds--; } addEvent(w, `Новый дом построен: ${HOUSE_BEDS - beds} жителей получили жильё.`, 'good'); }
        }
      }
    } else { v.task = 'waiting'; }
  }
}
export function advance(w) {
  const oldSeason = season(w.day), oldGrain = w.grain; w.day++;
  const s = season(w.day);
  if (s !== oldSeason) {
    if (s === 'Весна') w.field = { planted: 0, care: 0, harvestRemaining: 0, harvested: 0 };
    if (s === 'Осень') { w.field.harvestRemaining = round(w.field.planted * 12 + w.field.care); w.field.harvested = 0; }
    if (s === 'Зима' && w.field.harvestRemaining > 0) { addEvent(w, `Наступили холода: несобранный урожай (${w.field.harvestRemaining} мешков) потерян.`, 'warn'); w.field.harvestRemaining = 0; }
    const info = { 'Весна':'Пора сеять: каждый посев расходует зерно.', 'Лето':'Крестьяне ухаживают за полями.', 'Осень':`Урожай готов к сбору: ${w.field.harvestRemaining} мешков.`, 'Зима':'Поля отдыхают до весны.' };
    addEvent(w, `Смена сезона: ${s.toLowerCase()}. ${info[s]}`, 'info');
  }
  let hungry = 0;
  for (const v of w.villagers) {
    v.hunger = clamp(v.hunger + (w.ration === 'half' ? 8 : 6)); v.energy = clamp(v.energy - 3);
    const foodNeed = v.hunger >= 55, restNeed = v.energy <= 30;
    v.mood = clamp(v.mood + (v.hunger >= 75 ? -3 : 0) + (!v.homeId ? -1 : v.hunger < 55 ? (v.trait === 'Заботливая' ? 2 : 1) : 0));
    if (foodNeed && w.grain >= (w.ration === 'half' ? 0.5 : 1)) {
      v.task = 'eating';
      if (moveTo(v, LOCATIONS.pantry)) { w.grain = round(w.grain - (w.ration === 'half' ? 0.5 : 1)); v.hunger = clamp(v.hunger - (w.ration === 'half' ? 35 : 65)); }
    } else if (restNeed) {
      v.task = 'resting'; if (moveTo(v, v.homeId === 'new' ? LOCATIONS.houseSite : LOCATIONS.home)) v.energy = clamp(v.energy + (v.homeId ? 55 : 25));
    } else if (v.carriedLogs > 0) {
      v.task = 'deliveringLogs';
      if (moveTo(v, LOCATIONS.stockpile)) { w.wood = round(w.wood + v.carriedLogs); v.carriedLogs = 0; }
      v.energy = clamp(v.energy - 1);
    } else if ((w.barn.status === 'building' || w.house.status === 'building') && (v.id <= 3 || v.carriedWood > 0)) {
      doConstruction(w, v, w.barn.status === 'building' ? 'barn' : 'house'); v.energy = clamp(v.energy - 1);
    } else {
      const preferred = w.focus === 'balanced' ? (v.role === 'Дровосек' ? 'logging' : 'farming') : w.focus;
      v.task = preferred; v.energy = clamp(v.energy - 1);
      if (preferred === 'farming') { if (moveTo(v, LOCATIONS.field)) farming(w, v); }
      else if (moveTo(v, LOCATIONS.forest)) v.carriedLogs = round(3 * workFactor(v, v.woodSkill));
    }
    if (v.hunger >= 75) hungry++;
  }
  const unhoused = w.villagers.filter(v => !v.homeId).length;
  w.loyalty = clamp(w.loyalty + (hungry >= 6 ? -3 : w.ration === 'half' || unhoused >= 4 ? -1 : w.loyalty < 78 ? 1 : 0));
  if (unhoused >= 4 && w.day % 10 === 0) addEvent(w, `${unhoused} жителей без жилья. Их настроение и верность королевству снижаются.`, 'warn');
  if (hungry >= 6 && w.day % 3 === 0) addEvent(w, 'Многие жители голодают. Верность народа падает.', 'warn');
  else if (w.grain < 50 && oldGrain >= 50) addEvent(w, 'Запасы зерна на исходе. Пора позаботиться о народе.', 'warn');
  return w;
}
export function applyOrders(w, orders, reply) {
  if (orders.focus !== 'unchanged') w.focus = orders.focus;
  if (orders.ration !== 'unchanged') w.ration = orders.ration;
  const requested = orders.buildBarn ? 'barn' : orders.buildHouse ? 'house' : null;
  const result = requested ? startProject(w, requested) : null;
  const label = requested === 'house' ? 'дом' : 'амбар';
  w.reply = result === 'busy' ? 'Мой лорд, сначала нужно завершить уже начатую стройку.' : result === 'already' ? `Мой лорд, ${label} уже построен или строительство уже началось.` : reply;
  const description = [orders.focus === 'farming' ? 'приоритет — поля' : orders.focus === 'logging' ? 'приоритет — лес' : orders.focus === 'balanced' ? 'сбалансированные работы' : '', orders.ration === 'half' ? 'половинный паёк' : orders.ration === 'normal' ? 'обычный паёк' : '', result === 'started' ? `построить ${label}` : ''].filter(Boolean).join(', ');
  addEvent(w, description ? `Указ принят: ${description}.` : 'Лорд рассмотрел указ, но не изменил распоряжения.', description ? 'good' : 'info');
}
