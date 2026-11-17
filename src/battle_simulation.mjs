export const BATTLE_TICK_HZ = 15;
export const BATTLE_FIXED_DT = 1 / BATTLE_TICK_HZ;

const DEFAULT_MAP = Object.freeze({ width: 9, height: 5, obstacles: [] });
const DAMAGE_SCALE = 0.00015;
const clone = (value) => structuredClone(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizedRegiment(input, side, index, map) {
  const id = String(input.id ?? `${side}-${index + 1}`);
  const count = Math.max(0, Math.floor(finite(input.count, 1)));
  const maxCount = Math.max(count, Math.floor(finite(input.max_count ?? input.maxCount, count)));
  const fallbackX = side === 'attacker' ? 1 : map.width - 2;
  const fallbackY = Math.min(map.height - 1, 1 + (index % Math.max(1, map.height - 2)));
  const stats = input.stats ?? {};

  return {
    id,
    side,
    class: String(input.class ?? 'infantry'),
    faction: String(input.faction ?? (side === 'attacker' ? '01_celtic_briton' : '03_gaulish_warrior')),
    count,
    max_count: maxCount,
    position: {
      x: clamp(finite(input.position?.x ?? input.x, fallbackX), 0, map.width - 1),
      y: clamp(finite(input.position?.y ?? input.y, fallbackY), 0, map.height - 1),
    },
    facing: finite(input.facing, side === 'attacker' ? 0 : Math.PI),
    formation: String(input.formation ?? 'line'),
    rank: input.rank === 'rear' ? 'rear' : 'front',
    state: count > 0 ? 'ready' : 'destroyed',
    target_id: null,
    order: null,
    morale: clamp(finite(input.morale, 100), 0, 100),
    fatigue: clamp(finite(input.fatigue, 0), 0, 100),
    health: count > 0 ? clamp(finite(input.health, 100), 0, 100) : 0,
    discipline: clamp(finite(input.discipline, 50), 0, 100),
    damage_remainder: 0,
    has_charged: false,
    stats: {
      attack: clamp(finite(stats.attack, 50), 0, 100),
      defense: clamp(finite(stats.defense, 30), 0, 100),
      range: Math.max(0.5, finite(stats.range, 1.2)),
      speed: Math.max(0, finite(stats.speed, 2.4)),
      charge: Math.max(0, finite(stats.charge, 0)),
    },
  };
}

export function battleTerrainAt(scenario, x, y) {
  const cellX = Math.floor(finite(x, -1));
  const cellY = Math.floor(finite(y, -1));
  if (cellX < 0 || cellX >= 9 || cellY < 0 || cellY >= 5) return '';
  if (scenario === 'river_crossing') return cellX === 4 ? (cellY === 2 ? 'ford' : 'river') : cellY === 2 ? 'road' : '';
  if (scenario === 'forest_ambush') return (cellX <= 1 || cellX >= 7) && cellY !== 2 ? 'woods' : cellY === 2 ? 'road' : '';
  if (scenario === 'fortress_siege') return cellX === 6 && cellY === 2 ? 'gate' : cellX === 6 || cellX === 5 && cellY !== 2 ? 'rampart' : cellY === 2 ? 'road' : cellX === 5 ? 'river' : '';
  return cellX === 4 ? 'bridge' : cellX === 3 || cellX === 5 ? 'river' : cellY === 2 ? 'road' : cellX >= 6 && cellY > 0 && cellY < 4 ? 'rampart' : '';
}

export function createScenarioTerrain(scenario, width = 9, height = 5) {
  const cells = [];
  for (let y = 0; y < Math.min(5, Math.max(0, Math.floor(height))); y += 1) {
    for (let x = 0; x < Math.min(9, Math.max(0, Math.floor(width))); x += 1) {
      const type = battleTerrainAt(scenario, x, y);
      if (type) cells.push({ x, y, type });
    }
  }
  return cells;
}

function normalizeMap(input = {}) {
  const width = Math.max(3, Math.floor(finite(input.width, DEFAULT_MAP.width)));
  const height = Math.max(3, Math.floor(finite(input.height, DEFAULT_MAP.height)));
  const inBounds = (cell) => cell.x >= 0 && cell.x < width && cell.y >= 0 && cell.y < height;
  const obstacles = Array.isArray(input.obstacles) ? input.obstacles.map((cell) => ({
    x: Math.floor(finite(cell.x, -1)),
    y: Math.floor(finite(cell.y, -1)),
  })).filter(inBounds) : [];
  const terrainTypes = new Set(['road', 'river', 'ford', 'woods', 'rampart', 'gate', 'bridge']);
  const terrain = Array.isArray(input.terrain) ? input.terrain.map((cell) => ({
    x: Math.floor(finite(cell.x, -1)),
    y: Math.floor(finite(cell.y, -1)),
    type: String(cell.type ?? ''),
  })).filter((cell) => inBounds(cell) && terrainTypes.has(cell.type)) : [];
  return { width, height, obstacles, terrain };
}

export function createBattle(input = {}) {
  const map = normalizeMap(input.map);
  const attacker = Array.isArray(input.attacker?.regiments) ? input.attacker.regiments : [];
  const defender = Array.isArray(input.defender?.regiments) ? input.defender.regiments : [];
  const regiments = [
    ...attacker.map((unit, index) => normalizedRegiment(unit, 'attacker', index, map)),
    ...defender.map((unit, index) => normalizedRegiment(unit, 'defender', index, map)),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set();
  for (const regiment of regiments) {
    if (ids.has(regiment.id)) throw new Error(`Duplicate regiment id: ${regiment.id}`);
    ids.add(regiment.id);
  }

  const seed = Math.floor(finite(input.seed, 1)) >>> 0;
  return {
    seed,
    rng_state: seed || 0x6d2b79f5,
    tick: 0,
    tick_hz: BATTLE_TICK_HZ,
    paused: true,
    speed: 1,
    map,
    regiments,
    orders: [],
    result: null,
  };
}

export function setBattlePaused(state, paused) {
  if (!state || typeof state !== 'object') throw new TypeError('Battle state is required');
  if (state.result && !paused) return state;
  const next = clone(state);
  next.paused = Boolean(paused);
  return next;
}

export function setBattleSpeed(state, speed) {
  if (!state || typeof state !== 'object') throw new TypeError('Battle state is required');
  if (![1, 2].includes(Number(speed))) throw new RangeError('Battle speed must be x1 or x2');
  if (state.result) return state;
  const next = clone(state);
  next.speed = Number(speed);
  return next;
}

export function issueOrder(state, regimentId, order) {
  if (!state || typeof state !== 'object') throw new TypeError('Battle state is required');
  if (state.result) throw new Error('Cannot issue orders after the battle has ended');
  const next = clone(state);
  const regiment = next.regiments.find((unit) => unit.id === String(regimentId));
  if (!regiment || regiment.count <= 0 || ['routed', 'withdrawn'].includes(regiment.state)) throw new Error(`Unknown or defeated regiment: ${regimentId}`);
  if (!order || !['move', 'attack', 'hold', 'retreat'].includes(order.type)) {
    throw new Error(`Unsupported order: ${order?.type ?? 'none'}`);
  }

  let normalizedOrder;
  if (order.type === 'move') {
    const x = finite(order.x, NaN);
    const y = finite(order.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Move order requires finite x and y');
    normalizedOrder = { type: 'move', x: clamp(x, 0, next.map.width - 1), y: clamp(y, 0, next.map.height - 1) };
  } else if (order.type === 'attack') {
    const target = next.regiments.find((unit) => unit.id === String(order.targetId));
    if (!target || target.side === regiment.side || target.count <= 0 || ['routed', 'withdrawn'].includes(target.state)) throw new Error(`Invalid attack target: ${order.targetId}`);
    normalizedOrder = { type: 'attack', targetId: target.id };
    if (order.flank) normalizedOrder.flank = true;
    regiment.target_id = target.id;
    regiment.facing = Math.atan2(target.position.y - regiment.position.y, target.position.x - regiment.position.x);
  } else if (order.type === 'hold') {
    normalizedOrder = { type: 'hold' };
    if (order.targetId != null) {
      const target = next.regiments.find((unit) => unit.id === String(order.targetId));
      if (!target || target.side === regiment.side || target.count <= 0 || ['routed', 'withdrawn'].includes(target.state)) {
        throw new Error(`Invalid hold target: ${order.targetId}`);
      }
      normalizedOrder.targetId = target.id;
      regiment.target_id = target.id;
      regiment.facing = Math.atan2(target.position.y - regiment.position.y, target.position.x - regiment.position.x);
    } else {
      regiment.target_id = null;
    }
  } else {
    normalizedOrder = { type: order.type };
    regiment.target_id = null;
  }
  regiment.order = normalizedOrder;
  regiment.state = order.type === 'hold' ? 'holding' : order.type === 'retreat' ? 'retreating' : 'moving';
  next.orders.push({ tick: next.tick, regimentId: regiment.id, ...normalizedOrder });
  return next;
}

function nextRandom(state) {
  let value = state.rng_state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng_state = value >>> 0;
  return state.rng_state / 0x100000000;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function terrainAt(state, x, y) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  return state.map.terrain.find((cell) => cell.x === cellX && cell.y === cellY)?.type ?? '';
}

function movementMultiplier(type) {
  return ({ road: 1.15, bridge: 1, ford: 0.8, river: 0.55, woods: 0.78, rampart: 0.62, gate: 0.85 })[type] ?? 1;
}

function terrainDefense(type) {
  return ({ woods: 0.12, rampart: 0.2, gate: 0.12, river: 0.08, ford: 0.03, bridge: 0.02 })[type] ?? 0;
}

function formationAttack(unit) {
  if (unit.formation === 'shieldwall') return -0.12;
  if (unit.formation === 'wedge') return 0.12 + (unit.class === '08_cavalryman' ? 0.08 : 0);
  return 0;
}

function formationDamageTaken(unit) {
  if (unit.formation === 'shieldwall') return 0.85;
  if (unit.formation === 'wedge') return 1.05;
  return 1;
}

function flankMultiplier(attacker, target) {
  const angleToAttacker = Math.atan2(attacker.position.y - target.position.y, attacker.position.x - target.position.x);
  const difference = Math.abs(Math.atan2(Math.sin(angleToAttacker - target.facing), Math.cos(angleToAttacker - target.facing)));
  if (difference >= Math.PI * 2 / 3) return 1.3;
  if (difference >= Math.PI / 3) return 1.15;
  return 1;
}

function hasFrontRankSupport(state, attacker, target) {
  if (target.rank !== 'rear' || flankMultiplier(attacker, target) > 1) return false;
  const dx = attacker.position.x - target.position.x;
  const dy = attacker.position.y - target.position.y;
  const attackDistance = Math.hypot(dx, dy);
  if (attackDistance < 1e-9) return false;
  return state.regiments.some((ally) => {
    if (ally.id === target.id || ally.side !== target.side || ally.rank !== 'front' || ally.count <= 0 || ['routed', 'withdrawn'].includes(ally.state)) return false;
    const ax = ally.position.x - target.position.x;
    const ay = ally.position.y - target.position.y;
    const along = (ax * dx + ay * dy) / attackDistance;
    const across = Math.abs(ax * dy - ay * dx) / attackDistance;
    return along > 0.15 && along < attackDistance - 0.15 && across <= 0.55;
  });
}

function expectedAttackDamage(state, unit, target, variation = 1, consumeCharge = false) {
  const moraleFactor = 0.5 + unit.morale / 200;
  const targetTerrain = terrainAt(state, target.position.x, target.position.y);
  const attackerTerrain = terrainAt(state, unit.position.x, unit.position.y);
  const rankCover = hasFrontRankSupport(state, unit, target) ? 0.88 : 1;
  const defenseFactor = 1 / (1 + target.stats.defense / 100 + terrainDefense(targetTerrain)) * formationDamageTaken(target) * rankCover;
  const rangedCover = attackerTerrain === 'woods' && unit.stats.range > 1.5 ? 1.08 : 1;
  const formationFactor = 1 + formationAttack(unit);
  const roleCounter = unit.class === '06_spearman_shield' && target.class === '08_cavalryman' ? 1.25 : 1;
  const flankBonus = flankMultiplier(unit, target);
  const chargeBonus = unit.stats.charge > 0 && !unit.has_charged ? unit.count * Math.min(0.05, unit.stats.charge * 0.02) : 0;
  if (consumeCharge && unit.stats.charge > 0) unit.has_charged = true;
  return unit.count * unit.stats.attack * DAMAGE_SCALE * moraleFactor * defenseFactor * rangedCover * formationFactor * roleCounter * flankBonus * variation + chargeBonus;
}

export function previewBattleAttack(state, attackerId, targetId) {
  const attacker = state?.regiments?.find((unit) => unit.id === String(attackerId));
  const target = state?.regiments?.find((unit) => unit.id === String(targetId));
  if (!attacker || !target || attacker.side === target.side || attacker.count <= 0 || target.count <= 0 ||
      ['routed', 'withdrawn'].includes(attacker.state) || ['routed', 'withdrawn'].includes(target.state)) return null;
  const distance = Math.hypot(attacker.position.x - target.position.x, attacker.position.y - target.position.y);
  const inRange = distance <= attacker.stats.range;
  return { distance, range: attacker.stats.range, inRange, expectedDamage: inRange ? expectedAttackDamage(state, attacker, target) : 0 };
}

function cellKey(x, y) {
  return `${Math.floor(x)},${Math.floor(y)}`;
}

function canOccupy(state, unit, x, y) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  if (cellX < 0 || cellY < 0 || cellX >= state.map.width || cellY >= state.map.height) return false;
  if (state.map.obstacles.some((cell) => cell.x === cellX && cell.y === cellY)) return false;
  return !state.regiments.some((other) => other.id !== unit.id && other.count > 0 &&
    cellKey(other.position.x, other.position.y) === cellKey(x, y) && distance(other.position, { x, y }) < 0.3);
}

function flankWaypoint(state, unit, target) {
  const radius = clamp(unit.stats.range * 0.65, 0.75, 1.5);
  const normal = { x: -Math.sin(target.facing), y: Math.cos(target.facing) };
  const candidates = [1, -1].map((side) => ({
    x: clamp(target.position.x + normal.x * radius * side, 0, state.map.width - 1),
    y: clamp(target.position.y + normal.y * radius * side, 0, state.map.height - 1),
  }));
  const available = candidates.filter((point) => canOccupy(state, unit, point.x, point.y));
  return (available.length ? available : candidates).sort((a, b) =>
    distance(unit.position, a) - distance(unit.position, b) || a.x - b.x || a.y - b.y)[0];
}

function moveToward(state, unit, target, maxDistance) {
  const dx = target.x - unit.position.x;
  const dy = target.y - unit.position.y;
  const remaining = Math.hypot(dx, dy);
  if (remaining < 1e-9) return;
  unit.facing = Math.atan2(dy, dx);
  const requestedTravel = Math.min(remaining, Math.max(0, maxDistance));
  const probe = {
    x: unit.position.x + dx / remaining * requestedTravel,
    y: unit.position.y + dy / remaining * requestedTravel,
  };
  const terrainScale = (movementMultiplier(terrainAt(state, unit.position.x, unit.position.y)) +
    movementMultiplier(terrainAt(state, probe.x, probe.y))) / 2;
  const travel = requestedTravel * terrainScale;
  const x = unit.position.x + dx / remaining * travel;
  const y = unit.position.y + dy / remaining * travel;
  if (canOccupy(state, unit, x, y)) unit.position = { x, y };
}

function finishResult(state) {
  const liveSides = new Set(state.regiments.filter((unit) => unit.count > 0 && !['routed', 'withdrawn'].includes(unit.state)).map((unit) => unit.side));
  if (liveSides.size > 1) return;
  const winner = liveSides.size === 1 ? [...liveSides][0] : 'draw';
  state.result = {
    winner,
    casualties: Object.fromEntries(state.regiments.map((unit) => [unit.id, unit.max_count - unit.count])),
    routed: state.regiments.filter((unit) => unit.state === 'routed').map((unit) => unit.id),
    withdrawn: state.regiments.filter((unit) => unit.state === 'withdrawn').map((unit) => unit.id),
    durationTicks: state.tick,
    durationSeconds: state.tick / BATTLE_TICK_HZ,
  };
  state.paused = true;
}

export function stepBattle(state) {
  if (!state || typeof state !== 'object') throw new TypeError('Battle state is required');
  if (state.paused || state.result) return state;
  const next = clone(state);
  next.tick += 1;
  const units = next.regiments;
  const intents = [];

  for (const unit of units) {
    if (unit.count <= 0 || ['routed', 'withdrawn'].includes(unit.state)) continue;
    const order = unit.order;
    if (!order || (order.type === 'hold' && !order.targetId)) continue;
    const holdingPosition = order.type === 'hold';
    if (order.type === 'retreat') {
      const exit = { x: unit.side === 'attacker' ? 0 : next.map.width - 1, y: unit.position.y };
      moveToward(next, unit, exit, unit.stats.speed * BATTLE_FIXED_DT);
      if (distance(unit.position, exit) < 0.08) unit.state = 'withdrawn';
      else unit.state = 'retreating';
      continue;
    }
    if (order.type === 'move') {
      moveToward(next, unit, order, unit.stats.speed * BATTLE_FIXED_DT);
      unit.state = distance(unit.position, order) < 0.08 ? 'ready' : 'moving';
      continue;
    }
    if (order.type !== 'attack' && !holdingPosition) continue;
    const target = units.find((candidate) => candidate.id === order.targetId && candidate.count > 0 && !['routed', 'withdrawn'].includes(candidate.state));
    if (!target) {
      unit.order = null;
      unit.target_id = null;
      unit.state = 'ready';
      continue;
    }
    const range = unit.stats.range;
    const currentDistance = distance(unit.position, target.position);
    if (order.flank && flankMultiplier(unit, target) === 1) {
      moveToward(next, unit, flankWaypoint(next, unit, target), unit.stats.speed * BATTLE_FIXED_DT);
      unit.state = 'moving';
      continue;
    }
    if (currentDistance > range) {
      if (!holdingPosition) {
        moveToward(next, unit, order.flank ? flankWaypoint(next, unit, target) : target.position, unit.stats.speed * BATTLE_FIXED_DT);
        unit.state = 'moving';
      } else {
        unit.state = 'holding';
      }
      continue;
    }
    unit.state = holdingPosition ? 'holding' : 'engaged';
    const variation = 0.9 + nextRandom(next) * 0.2;
    const damage = expectedAttackDamage(next, unit, target, variation, true);
    intents.push({ targetId: target.id, damage });
  }

  const incoming = new Map();
  for (const intent of intents) incoming.set(intent.targetId, (incoming.get(intent.targetId) ?? 0) + intent.damage);
  for (const [targetId, damage] of incoming) {
    const target = units.find((unit) => unit.id === targetId);
    if (!target || target.count <= 0) continue;
    const total = target.damage_remainder + damage;
    const casualties = Math.min(target.count, Math.floor(total));
    target.count -= casualties;
    if (casualties > 0) {
      target.morale = clamp(target.morale - casualties / Math.max(1, target.max_count) * 35 - 0.2, 0, 100);
    }
    target.damage_remainder = target.count > 0 ? total - casualties : 0;
    target.health = target.count > 0 ? clamp(100 * (1 - target.damage_remainder), 0, 100) : 0;
    if (target.count > 0 && target.morale <= 10) {
      target.state = 'routed';
      target.order = null;
      target.target_id = null;
    }
    if (target.count === 0) {
      target.state = 'destroyed';
      target.order = null;
      target.target_id = null;
    }
  }

  finishResult(next);
  return next;
}

export function advanceBattle(state, ticks = 1) {
  const count = Math.max(0, Math.floor(finite(ticks, 1)));
  let current = state;
  for (let index = 0; index < count && !current.paused && !current.result; index += 1) {
    current = stepBattle(current);
  }
  return current;
}

export function runBattle(state, maxTicks = BATTLE_TICK_HZ * 60) {
  return advanceBattle(state, maxTicks);
}

export function resolveHeadlessBattle(state, maxTicks = BATTLE_TICK_HZ * 60 * 10) {
  if (!state || typeof state !== 'object') throw new TypeError('Battle state is required');
  const limit = Math.max(1, Math.floor(finite(maxTicks, BATTLE_TICK_HZ * 60 * 10)));
  let current = clone(state);
  current.paused = false;
  for (let tick = 0; tick < limit && !current.result; tick += 1) {
    for (const unit of current.regiments) {
      if (unit.count <= 0 || ['routed', 'withdrawn'].includes(unit.state)) continue;
      if (unit.order?.type === 'retreat' || unit.order?.type === 'move' || unit.order?.type === 'hold' && !unit.order.targetId) continue;
      const existingTarget = current.regiments.find((candidate) => candidate.id === unit.order?.targetId &&
        candidate.side !== unit.side && candidate.count > 0 && !['routed', 'withdrawn'].includes(candidate.state));
      if ((unit.order?.type === 'attack' || unit.order?.type === 'hold') && existingTarget) continue;
      const target = current.regiments.filter((candidate) => candidate.side !== unit.side && candidate.count > 0 &&
        !['routed', 'withdrawn'].includes(candidate.state)).sort((a, b) =>
        Math.hypot(a.position.x - unit.position.x, a.position.y - unit.position.y) -
        Math.hypot(b.position.x - unit.position.x, b.position.y - unit.position.y) || a.id.localeCompare(b.id))[0];
      if (target) current = issueOrder(current, unit.id, { type: 'attack', targetId: target.id });
    }
    current.paused = false;
    current = stepBattle(current);
  }
  return current;
}
