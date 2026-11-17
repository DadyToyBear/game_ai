import { createBattle, resolveHeadlessBattle } from './battle_simulation.mjs';

const clone = (value) => structuredClone(value);
const DEFAULT_MAP = { width: 9, height: 5, obstacles: [], terrain: [] };
const DEFAULT_MAX_TICKS = 15 * 60 * 10;

function requireSide(side, name) {
  if (!side || typeof side !== 'object' || !Array.isArray(side.regiments) || side.regiments.length === 0) {
    throw new TypeError(`${name}.regiments must be a non-empty array`);
  }
  for (const [index, unit] of side.regiments.entries()) {
    if (!unit || typeof unit.id !== 'string' || !unit.id.trim()) throw new TypeError(`${name}.regiments[${index}].id is required`);
    if (typeof unit.class !== 'string' || !unit.class.trim()) throw new TypeError(`${name}.regiments[${index}].class is required`);
    if (!Number.isInteger(Number(unit.count)) || Number(unit.count) < 0) throw new TypeError(`${name}.regiments[${index}].count must be a non-negative integer`);
  }
}

/** Validate and normalize the versioned JSON boundary from campaign to battle. */
export function createBattleRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Battle request must be an object');
  if (input.schemaVersion != null && input.schemaVersion !== 1) throw new RangeError('Unsupported battle request schemaVersion');
  requireSide(input.attacker, 'attacker');
  requireSide(input.defender, 'defender');
  const seed = Number(input.seed);
  if (!Number.isFinite(seed)) throw new TypeError('Battle request seed must be finite');
  const scenarioId = String(input.scenarioId ?? 'bridge_defense');
  const attacker = clone(input.attacker);
  const defender = clone(input.defender);
  const map = clone(input.map ?? DEFAULT_MAP);
  const reinforcements = input.reinforcements == null ? undefined : clone(input.reinforcements);
  if (reinforcements !== undefined && (!Array.isArray(reinforcements) || reinforcements.some((item) =>
    !item || !['attacker', 'defender'].includes(item.side) || !Number.isInteger(Number(item.arrivalTick)) ||
    Number(item.arrivalTick) < 1 || !item.regiment || typeof item.regiment.id !== 'string' || !item.regiment.id.trim()))) {
    throw new TypeError('reinforcements must contain valid delayed regiments');
  }
  const battleId = String(input.battleId ?? `${scenarioId}-${Math.floor(seed) >>> 0}-${[...attacker.regiments, ...defender.regiments].map((unit) => unit.id).join('-')}`);
  const request = { schemaVersion: 1, battleId, seed: Math.floor(seed) >>> 0, scenarioId, map, attacker, defender };
  if (reinforcements !== undefined) request.reinforcements = reinforcements;
  // Reuse the simulation's normalization and duplicate-ID checks at the boundary.
  createBattle(request);
  return request;
}

/** Resolve a request headlessly through the same fixed-step simulation used by the tactical UI. */
export function resolveBattleRequest(input, { maxTicks = DEFAULT_MAX_TICKS } = {}) {
  const request = createBattleRequest(input);
  const initial = createBattle(request);
  const finalState = resolveHeadlessBattle(initial, maxTicks);
  const routed = finalState.regiments.filter((unit) => unit.state === 'routed').map((unit) => unit.id);
  const withdrawn = finalState.regiments.filter((unit) => unit.state === 'withdrawn').map((unit) => unit.id);
  const regiments = finalState.regiments.map((unit) => ({
    id: unit.id,
    side: unit.side,
    class: unit.class,
    count: unit.count,
    maxCount: unit.max_count,
    casualties: Math.max(0, unit.max_count - unit.count),
    morale: unit.morale,
    fatigue: unit.fatigue,
    state: unit.state,
  }));
  return {
    schemaVersion: 1,
    battleId: request.battleId,
    seed: request.seed,
    scenarioId: request.scenarioId,
    status: finalState.result ? 'resolved' : 'limit_reached',
    winner: finalState.result?.winner ?? null,
    casualties: Object.fromEntries(regiments.map((unit) => [unit.id, unit.casualties])),
    routed,
    routedSurvivors: Object.fromEntries(regiments.filter((unit) => routed.includes(unit.id)).map((unit) => [unit.id, unit.count])),
    withdrawn,
    siege: finalState.siege ? clone(finalState.siege) : null,
    regiments,
    durationTicks: finalState.tick,
    durationSeconds: finalState.tick / finalState.tick_hz,
  };
}
