import assert from 'node:assert/strict';
import test from 'node:test';
import { createBattleRequest, resolveBattleRequest } from '../src/battle_contract.mjs';
import {
  advanceBattle,
  battleTerrainAt,
  createBattle,
  createScenarioTerrain,
  issueOrder,
  setBattlePaused,
} from '../src/battle_simulation.mjs';

const scenarios = [
  ['river_crossing', { x: 4, y: 2, type: 'ford' }],
  ['forest_ambush', { x: 7, y: 0, type: 'woods' }],
  ['bridge_defense', { x: 4, y: 0, type: 'bridge' }],
  ['fortress_siege', { x: 6, y: 2, type: 'gate' }],
];

function encounter(scenario) {
  const initial = createBattle({
    seed: 123,
    scenarioId: scenario,
    map: { width: 9, height: 5, terrain: createScenarioTerrain(scenario) },
    attacker: { regiments: [{
      id: 'attacker', class: '03_sword_and_shield', count: 100, morale: 70,
      position: { x: 1.25, y: 0.75 },
      stats: { attack: 65, defense: 45, range: 1.2, speed: 3.2 },
    }] },
    defender: { regiments: [{
      id: 'defender', class: '06_spearman_shield', count: 100, morale: 70,
      position: { x: 7.75, y: 0.75 },
      stats: { attack: 65, defense: 45, range: 1.2, speed: 3.2 },
    }] },
  });
  let ordered = issueOrder(initial, 'attacker', { type: 'attack', targetId: 'defender' });
  ordered = issueOrder(ordered, 'defender', { type: 'attack', targetId: 'attacker' });
  return setBattlePaused(ordered, false);
}

for (const [scenario, landmark] of scenarios) {
  test(`${scenario}: scenario terrain matches the rendered landmark`, () => {
    const terrain = createScenarioTerrain(scenario);
    assert.ok(terrain.some((cell) => cell.x === landmark.x && cell.y === landmark.y && cell.type === landmark.type));
    assert.equal(battleTerrainAt(scenario, landmark.x, landmark.y), landmark.type);
    assert.ok(terrain.every((cell) => cell.x >= 0 && cell.x < 9 && cell.y >= 0 && cell.y < 5));
  });
}

test('siege gate assault has integrity, a breach state, counterplay time, and exact headless parity', () => {
  const request = createBattleRequest({
    battleId: 'siege-gate-breach-201',
    seed: 201,
    scenarioId: 'fortress_siege',
    map: { width: 9, height: 5, terrain: createScenarioTerrain('fortress_siege') },
    attacker: { regiments: [{
      id: 'assault-infantry', class: '03_sword_and_shield', count: 80, position: { x: 5.45, y: 2.5 },
      order: { type: 'attack_gate' }, stats: { attack: 70, defense: 40, range: 1.2, speed: 3 },
    }] },
    defender: { regiments: [{
      id: 'gate-guard', class: '06_spearman_shield', count: 40, position: { x: 7.5, y: 2.5 },
      order: { type: 'hold' }, stats: { attack: 0, defense: 48, range: 1.2, speed: 0 },
    }] },
  });
  let manual = setBattlePaused(createBattle(request), false);
  manual = advanceBattle(manual, 150);
  const automatic = resolveBattleRequest(request, { maxTicks: 150 });
  assert.equal(automatic.status, 'limit_reached', 'the comparison stops at the same fixed tick while both armies remain alive');
  assert.equal(manual.tick, 150);
  assert.equal(manual.siege.gate.status, 'breached');
  assert.equal(manual.siege.gate.integrity, 0);
  assert.deepEqual(automatic.siege, manual.siege, 'headless returns the same gate state as manual play');
  assert.deepEqual(automatic.regiments.map(unit => [unit.id, unit.count, unit.morale, unit.state]),
    manual.regiments.map(unit => [unit.id, unit.count, unit.morale, unit.state]));
  assert.throws(() => issueOrder(manual, 'gate-guard', { type: 'attack_gate' }), /Only attackers/);
  assert.throws(() => issueOrder(createBattle({ attacker: { regiments: [{ id: 'field', count: 5 }] } }), 'field', { type: 'attack_gate' }), /Only attackers/);

  let intact = createBattle({
    scenarioId: 'fortress_siege', map: { width: 9, height: 5, terrain: createScenarioTerrain('fortress_siege') },
    attacker: { regiments: [{ id: 'approach', count: 30, position: { x: 1.5, y: 2.5 }, order: { type: 'move', x: 7.5, y: 2.5 }, stats: { speed: 3 } }] },
    defender: { regiments: [{ id: 'inside-guard', count: 1, position: { x: 8.25, y: 4 }, order: { type: 'hold' }, stats: { attack: 0, speed: 0 } }] },
  });
  intact = advanceBattle(setBattlePaused(intact, false), 120);
  assert.ok(intact.regiments.find(unit => unit.id === 'approach').position.x < 6.5,
    'an intact wall stops attackers from crossing outside the gate approach');

  manual = issueOrder(manual, 'assault-infantry', { type: 'move', x: 7.5, y: 2.5 });
  manual = advanceBattle(setBattlePaused(manual, false), 20);
  assert.ok(manual.regiments.find(unit => unit.id === 'assault-infantry').position.x > 6.5,
    'breaching opens the gate passage through the fortress wall');
});

test('same-seed duels resolve reproducibly on all four battlefield layouts', () => {
  const metrics = [];
  const defenderSurvivors = new Map();
  for (const [scenario] of scenarios) {
    const resolve = () => advanceBattle(encounter(scenario), 1200);
    const first = resolve();
    const repeat = resolve();
    assert.ok(first.result, `${scenario} battle reaches a result within 80 simulated seconds`);
    assert.deepEqual(first, repeat, `${scenario} result is deterministic`);
    assert.ok(first.result.durationTicks >= 300 && first.result.durationTicks <= 1000,
      `${scenario} should be a substantial but finite engagement`);
    assert.ok(first.regiments.every((unit) => unit.count >= 0 && unit.count <= 100));
    assert.ok(first.regiments.every((unit) => unit.count < 100), `${scenario} should involve both sides in the exchange`);
    defenderSurvivors.set(scenario, first.regiments.find((unit) => unit.id === 'defender').count);
    metrics.push(`${first.result.winner}:${first.result.durationTicks}:${first.regiments.map((unit) => unit.count).join(',')}`);
  }
  assert.ok(new Set(metrics).size > 1, 'scenario layouts produce different combat outcomes');
  assert.ok(defenderSurvivors.get('forest_ambush') > defenderSurvivors.get('river_crossing'),
    'cover in the forest should improve defender survival over the ford approach');
  assert.ok(defenderSurvivors.get('fortress_siege') > defenderSurvivors.get('bridge_defense'),
    'fortress terrain should improve defender survival over the open bridge approach');
});
