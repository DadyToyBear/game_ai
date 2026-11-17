import assert from 'node:assert/strict';
import test from 'node:test';
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
