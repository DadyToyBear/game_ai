import assert from 'node:assert/strict';
import test from 'node:test';
import { createBattleRequest, resolveBattleRequest } from '../src/battle_contract.mjs';

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

test('headless resolution reports its tick limit rather than inventing a winner', () => {
  const result = resolveBattleRequest(battleRequest(), { maxTicks: 1 });
  assert.equal(result.status, 'limit_reached');
  assert.equal(result.winner, null);
  assert.equal(result.durationTicks, 1);
});
