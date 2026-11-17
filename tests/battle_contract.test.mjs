import assert from 'node:assert/strict';
import test from 'node:test';
import { createBattleRequest, resolveBattleRequest } from '../src/battle_contract.mjs';
import { advanceBattle, createBattle, createScenarioTerrain, issueOrder, queueBattleReinforcements, setBattlePaused } from '../src/battle_simulation.mjs';

const battleRequest = () => createBattleRequest({
  battleId: 'test-crossing-19',
  seed: 19,
  scenarioId: 'river_crossing',
  map: {
    width: 9,
    height: 5,
    terrain: [{ x: 4, y: 2, type: 'ford' }, { x: 4, y: 1, type: 'river' }],
  },
  attacker: {
    generalId: 'marshal-test',
    regiments: [{
      id: 'crown-swords', class: 'swordsman', faction: '01_celtic_briton', count: 80,
      position: { x: 1, y: 2 }, morale: 86, stats: { attack: 90, defense: 35, range: 1.2, speed: 3 },
    }],
  },
  defender: {
    generalId: 'castellan-test',
    regiments: [{
      id: 'border-spears', class: '06_spearman_shield', faction: '03_gaulish_warrior', count: 80,
      position: { x: 7, y: 2 }, morale: 82, stats: { attack: 82, defense: 42, range: 1.2, speed: 3 },
    }],
  },
});

test('battle_request validates stable regiment IDs and preserves its versioned JSON shape', () => {
  const request = battleRequest();
  assert.equal(request.schemaVersion, 1);
  assert.equal(request.battleId, 'test-crossing-19');
  assert.equal(request.scenarioId, 'river_crossing');
  assert.deepEqual(JSON.parse(JSON.stringify(request)), request);
  assert.throws(() => createBattleRequest({ ...request, attacker: { regiments: [{ class: 'swordsman', count: 4 }] } }), /\.id is required/);
  assert.throws(() => createBattleRequest({ ...request, schemaVersion: 2 }), /Unsupported battle request schemaVersion/);
});

test('battle_result is a deterministic, serializable resolution from the shared simulation core', () => {
  const request = battleRequest();
  const first = resolveBattleRequest(request);
  const repeated = resolveBattleRequest(request);
  assert.deepEqual(first, repeated);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.battleId, request.battleId);
  assert.equal(first.scenarioId, request.scenarioId);
  assert.equal(first.status, 'resolved');
  assert.ok(['attacker', 'defender', 'draw'].includes(first.winner));
  assert.ok(first.durationTicks > 0);
  assert.equal(first.durationSeconds, first.durationTicks / 15);
  assert.deepEqual(Object.keys(first.casualties).sort(), ['border-spears', 'crown-swords']);
  assert.deepEqual(first.regiments.map((unit) => unit.id).sort(), ['border-spears', 'crown-swords']);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
});

test('manual and headless auto duels match exactly on the same seed and orders across all four scenarios', () => {
  for (const scenarioId of ['river_crossing', 'forest_ambush', 'bridge_defense', 'fortress_siege']) {
    const request = createBattleRequest({
      battleId: `parity-${scenarioId}-73`,
      seed: 73,
      scenarioId,
      map: { width: 9, height: 5, terrain: createScenarioTerrain(scenarioId) },
      attacker: { regiments: [{
        id: 'attacker', class: '03_sword_and_shield', count: 100, morale: 70,
        position: { x: 1.25, y: 0.75 }, stats: { attack: 65, defense: 45, range: 1.2, speed: 3.2 },
      }] },
      defender: { regiments: [{
        id: 'defender', class: '06_spearman_shield', count: 100, morale: 70,
        position: { x: 7.75, y: 0.75 }, stats: { attack: 65, defense: 45, range: 1.2, speed: 3.2 },
      }] },
    });
    let manual = createBattle(request);
    manual = issueOrder(manual, 'attacker', { type: 'attack', targetId: 'defender' });
    manual = issueOrder(manual, 'defender', { type: 'attack', targetId: 'attacker' });
    manual = advanceBattle(setBattlePaused(manual, false), 9000);
    const automatic = resolveBattleRequest(request);
    assert.ok(manual.result, `${scenarioId} manual duel should resolve`);
    assert.equal(automatic.status, 'resolved', `${scenarioId} headless duel should resolve`);
    assert.equal(automatic.winner, manual.result.winner, `${scenarioId} winner stays aligned`);
    assert.equal(automatic.durationTicks, manual.result.durationTicks, `${scenarioId} duration is identical`);
    for (const unit of manual.regiments) {
      const automaticUnit = automatic.regiments.find((candidate) => candidate.id === unit.id);
      assert.ok(automaticUnit, `${scenarioId} result preserves regiment IDs`);
      assert.equal(automaticUnit.count, unit.count, `${scenarioId} casualty delta for ${unit.id} is zero`);
      assert.equal(automaticUnit.morale, unit.morale, `${scenarioId} morale matches for ${unit.id}`);
    }
  }
});

test('signalled reinforcements remain off-field until their travel tick, then join the deterministic battle', () => {
  const initial = createBattle({
    seed: 12,
    attacker: { regiments: [{ id: 'front', class: 'infantry', count: 20, position: { x: 1, y: 1 }, stats: { attack: 0, speed: 0, range: 0.5 } }] },
    defender: { regiments: [{ id: 'foe', class: 'infantry', count: 20, position: { x: 7, y: 3 }, stats: { attack: 0, speed: 0, range: 0.5 } }] },
  });
  const queued = queueBattleReinforcements(initial, [{
    side: 'attacker', arrivalTick: 3,
    regiment: { id: 'reserve', class: 'cavalry', count: 12, position: { x: 0.5, y: 2 }, stats: { attack: 50, speed: 3 } },
  }]);
  assert.equal(initial.regiments.some((unit) => unit.id === 'reserve'), false, 'queueing does not mutate or deploy into the source state');
  let running = setBattlePaused(queued, false);
  running = advanceBattle(running, 2);
  assert.equal(running.regiments.some((unit) => unit.id === 'reserve'), false, 'the reserve stays off-field before its ETA');
  running = advanceBattle(running, 1);
  const arrived = running.regiments.find((unit) => unit.id === 'reserve');
  assert.ok(arrived, 'the reserve joins on its scheduled tick');
  assert.equal(arrived.state, 'moving', 'an arriving unit immediately receives an attack march');
  assert.equal(running.reinforcement_queue.length, 0);
  assert.ok(running.orders.some((order) => order.regimentId === 'reserve' && order.reinforcement));
  assert.throws(() => queueBattleReinforcements(running, [{ side: 'attacker', arrivalTick: 4, regiment: { id: 'front', count: 1 } }]), /Duplicate regiment id/);
});

test('headless contract accepts and resolves delayed reinforcements', () => {
  const request = createBattleRequest({
    ...battleRequest(),
    reinforcements: [
      { side: 'attacker', arrivalTick: 45, regiment: {
        id: 'reserve', class: '03_sword_and_shield', count: 36,
        position: { x: 0.5, y: 1.5 }, stats: { attack: 70, defense: 40, range: 1.2, speed: 3.2 },
      } },
      { side: 'attacker', arrivalTick: 80, regiment: {
        id: 'reserve-two', class: '06_spearman_shield', count: 30,
        position: { x: 0.5, y: 3.5 }, stats: { attack: 65, defense: 45, range: 1.2, speed: 3 },
      } },
    ],
  });
  assert.equal(request.reinforcements[0].arrivalTick, 45);
  const result = resolveBattleRequest(request);
  assert.equal(result.status, 'resolved');
  assert.ok(result.regiments.some((unit) => unit.id === 'reserve'));
  assert.ok(result.regiments.some((unit) => unit.id === 'reserve-two'));
  assert.ok(result.durationTicks >= 80, 'the battle cannot finish before the last scheduled wave can arrive');
});

test('headless resolution reports its tick limit rather than inventing a winner', () => {
  const result = resolveBattleRequest(battleRequest(), { maxTicks: 1 });
  assert.equal(result.status, 'limit_reached');
  assert.equal(result.winner, null);
  assert.equal(result.durationTicks, 1);
});
