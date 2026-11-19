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

test('battle_request preserves explicit opening orders and validates their targets', () => {
  const input = battleRequest();
  input.attacker.regiments[0].order = { type: 'attack', targetId: 'border-spears', flank: true };
  input.defender.regiments[0].order = { type: 'hold', targetId: 'crown-swords' };
  const request = createBattleRequest(input);
  assert.deepEqual(request.attacker.regiments[0].order, { type: 'attack', targetId: 'border-spears', flank: true });
  const state = createBattle(request);
  assert.deepEqual(state.regiments.find(unit => unit.id === 'crown-swords').order, request.attacker.regiments[0].order);
  assert.deepEqual(state.regiments.find(unit => unit.id === 'border-spears').order, request.defender.regiments[0].order);
  assert.throws(() => createBattleRequest({
    ...request,
    attacker: { ...request.attacker, regiments: [{ ...request.attacker.regiments[0], order: { type: 'attack', targetId: 'missing' } }] },
  }), /Invalid attack target/);
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

test('manual tactical orders and headless auto match 2v2 with a delayed reserve on all scenarios', () => {
  for (const scenarioId of ['river_crossing', 'forest_ambush', 'bridge_defense', 'fortress_siege']) {
    const request = createBattleRequest({
      battleId: `parity-multiregiment-${scenarioId}-91`,
      seed: 91,
      scenarioId,
      map: { width: 9, height: 5, terrain: createScenarioTerrain(scenarioId) },
      attacker: { regiments: [
        { id: 'a-swords', class: '03_sword_and_shield', count: 90, position: { x: 1.25, y: 1 }, formation: 'shieldwall', order: { type: 'attack', targetId: 'd-spears' }, stats: { attack: 68, defense: 45, range: 1.2, speed: 3.2 } },
        { id: 'a-archers', class: '01_archer', count: 60, position: { x: 1.25, y: 3 }, rank: 'rear', order: { type: 'hold', targetId: 'd-cavalry' }, stats: { attack: 58, defense: 28, range: 3.2, speed: 2.8 } },
      ] },
      defender: { regiments: [
        { id: 'd-spears', class: '06_spearman_shield', count: 80, position: { x: 7.75, y: 1 }, formation: 'shieldwall', order: { type: 'attack', targetId: 'a-swords' }, stats: { attack: 62, defense: 48, range: 1.2, speed: 3 } },
        { id: 'd-cavalry', class: '08_cavalryman', count: 45, position: { x: 7.75, y: 3 }, formation: 'wedge', order: { type: 'attack', targetId: 'a-archers', flank: true }, stats: { attack: 70, defense: 35, range: 1.2, speed: 3.6, charge: 1 } },
      ] },
      reinforcements: [{ side: 'attacker', arrivalTick: 18, regiment: {
        id: 'a-reserve', class: '08_cavalryman', count: 35, position: { x: 0.5, y: 2 },
        stats: { attack: 72, defense: 38, range: 1.2, speed: 3.6, charge: 1 },
      } }],
    });
    let manual = setBattlePaused(createBattle(request), false);
    for (let tick = 0; tick < 15 * 60 * 10 && !manual.result; tick += 1) {
      const scheduled = manual.regiments;
      for (const unit of scheduled) {
        if (unit.count <= 0 || ['routed', 'withdrawn'].includes(unit.state)) continue;
        if (unit.order?.type === 'retreat' || unit.order?.type === 'move' || unit.order?.type === 'hold' && !unit.order.targetId) continue;
        const existing = manual.regiments.find(candidate => candidate.id === unit.order?.targetId && candidate.side !== unit.side && candidate.count > 0 && !['routed', 'withdrawn'].includes(candidate.state));
        if ((unit.order?.type === 'attack' || unit.order?.type === 'hold') && existing) continue;
        const target = manual.regiments.filter(candidate => candidate.side !== unit.side && candidate.count > 0 && !['routed', 'withdrawn'].includes(candidate.state))
          .sort((a, b) => Math.hypot(a.position.x - unit.position.x, a.position.y - unit.position.y) - Math.hypot(b.position.x - unit.position.x, b.position.y - unit.position.y) || a.id.localeCompare(b.id))[0];
        if (target) manual = issueOrder(manual, unit.id, { type: 'attack', targetId: target.id });
      }
      manual = advanceBattle(manual, 1);
    }
    const automatic = resolveBattleRequest(request);
    assert.ok(manual.result, 'the manual control loop resolves the multi-regiment engagement');
    assert.equal(automatic.status, 'resolved');
    assert.equal(automatic.winner, manual.result.winner);
      assert.equal(automatic.durationTicks, manual.result.durationTicks);
      assert.ok(automatic.regiments.some(unit => unit.id === 'a-reserve'), `${scenarioId} includes the arrived reserve`);
      for (const unit of manual.regiments) {
      const result = automatic.regiments.find(candidate => candidate.id === unit.id);
      assert.ok(result, `headless result preserves ${unit.id}`);
      assert.equal(result.count, unit.count, `${unit.id} losses match`);
      assert.equal(result.morale, unit.morale, `${unit.id} morale matches`);
      assert.equal(result.state, unit.state, `${scenarioId} ${unit.id} final status matches`);
    }
  }
});

test('manual/headless parity covers movement, retreat, mixed regiments, and two reserve waves on every battlefield', () => {
  for (const [scenarioIndex, scenarioId] of ['river_crossing', 'forest_ambush', 'bridge_defense', 'fortress_siege'].entries()) {
    const cavalry = scenarioIndex % 2 === 0;
    const request = createBattleRequest({
      battleId: `parity-orders-waves-${scenarioId}-117`,
      seed: 117 + scenarioIndex,
      scenarioId,
      map: { width: 9, height: 5, terrain: createScenarioTerrain(scenarioId) },
      attacker: { regiments: [
        { id: 'a-withdraw', class: '03_sword_and_shield', count: 24 + scenarioIndex, position: { x: 1.25, y: 0.75 }, order: { type: 'retreat' }, stats: { attack: 60, defense: 42, range: 1.2, speed: 3.2 } },
        { id: 'a-march', class: '03_sword_and_shield', count: 30, position: { x: 1.25, y: 3 }, order: { type: 'move', x: 1.6, y: 4 }, stats: { attack: 62, defense: 44, range: 1.2, speed: 3.2 } },
        { id: 'a-front', class: cavalry ? '08_cavalryman' : '03_sword_and_shield', count: 54, position: { x: 1.25, y: 2 }, formation: cavalry ? 'wedge' : 'shieldwall', order: { type: 'attack', targetId: 'd-swords', flank: cavalry }, stats: { attack: 66, defense: 40, range: 1.2, speed: cavalry ? 3.6 : 3.2, charge: cavalry ? 1 : 0 } },
      ] },
      defender: { regiments: [
        { id: 'd-swords', class: '03_sword_and_shield', count: 50, position: { x: 7.75, y: 0.75 }, order: { type: 'attack', targetId: 'a-front' }, stats: { attack: 65, defense: 42, range: 1.2, speed: 3.2 } },
        { id: 'd-archers', class: '01_archer', count: 40, position: { x: 7.75, y: 4 }, rank: 'rear', order: { type: 'hold', targetId: 'a-front' }, stats: { attack: 55, defense: 28, range: 3.2, speed: 2.8 } },
      ] },
      reinforcements: [
        { side: 'attacker', arrivalTick: 12, regiment: { id: 'a-wave-one', class: '06_spearman_shield', count: 42, position: { x: 0.5, y: 1.5 }, stats: { attack: 64, defense: 44, range: 1.2, speed: 3 } } },
        { side: 'defender', arrivalTick: 28, regiment: { id: 'd-wave-two', class: cavalry ? '01_archer' : '08_cavalryman', count: 26, position: { x: 8.5, y: 3.5 }, rank: cavalry ? 'rear' : 'front', stats: { attack: 70, defense: 36, range: cavalry ? 3.2 : 1.2, speed: cavalry ? 2.8 : 3.6, charge: cavalry ? 0 : 1 } } },
      ],
    });
    let manual = setBattlePaused(createBattle(request), false);
    for (let tick = 0; tick < 15 * 60 * 10 && !manual.result; tick += 1) {
      for (const unit of manual.regiments) {
        if (unit.count <= 0 || ['routed', 'withdrawn'].includes(unit.state)) continue;
        if (unit.order?.type === 'retreat' || unit.order?.type === 'move' || unit.order?.type === 'hold' && !unit.order.targetId) continue;
        const existing = manual.regiments.find(candidate => candidate.id === unit.order?.targetId && candidate.side !== unit.side && candidate.count > 0 && !['routed', 'withdrawn'].includes(candidate.state));
        if ((unit.order?.type === 'attack' || unit.order?.type === 'hold') && existing) continue;
        const target = manual.regiments.filter(candidate => candidate.side !== unit.side && candidate.count > 0 && !['routed', 'withdrawn'].includes(candidate.state))
          .sort((a, b) => Math.hypot(a.position.x - unit.position.x, a.position.y - unit.position.y) - Math.hypot(b.position.x - unit.position.x, b.position.y - unit.position.y) || a.id.localeCompare(b.id))[0];
        if (target) manual = issueOrder(manual, unit.id, { type: 'attack', targetId: target.id });
      }
      manual = advanceBattle(manual, 1);
    }
    const automatic = resolveBattleRequest(request);
    assert.ok(manual.result, `${scenarioId}: the manual state machine resolves the engagement`);
    assert.equal(automatic.status, 'resolved', `${scenarioId}: headless engagement resolves`);
    assert.equal(automatic.winner, manual.result.winner, `${scenarioId}: winner matches`);
    assert.equal(automatic.durationTicks, manual.result.durationTicks, `${scenarioId}: duration matches`);
    assert.deepEqual(automatic.regiments.map(unit => [unit.id, unit.count, unit.morale, unit.state]),
      manual.regiments.map(unit => [unit.id, unit.count, unit.morale, unit.state]), `${scenarioId}: all regiment outcomes match`);
    assert.ok(automatic.regiments.some(unit => unit.id === 'a-wave-one'), `${scenarioId}: attacker reserve arrived`);
    assert.ok(automatic.regiments.some(unit => unit.id === 'd-wave-two'), `${scenarioId}: defender reserve arrived`);
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

test('a signalled reserve delays defeat until its ETA, then fights and may still lose', () => {
  const request = createBattleRequest({
    seed: 31,
    attacker: { regiments: [{ id: 'broken-front', class: 'infantry', count: 0, position: { x: 1, y: 2 } }] },
    defender: { regiments: [{ id: 'pursuers', class: 'infantry', count: 12, position: { x: 7, y: 2 } }] },
    reinforcements: [{ side: 'attacker', arrivalTick: 5, regiment: {
      id: 'last-reserve', class: 'infantry', count: 1, position: { x: 0.5, y: 2 },
      stats: { attack: 0, defense: 0, range: 0.5, speed: 0 },
    } }],
  });
  const result = resolveBattleRequest(request);
  assert.equal(result.status, 'resolved');
  assert.equal(result.winner, 'defender');
  assert.ok(result.regiments.some((unit) => unit.id === 'last-reserve'));
  assert.ok(result.durationTicks >= 5, 'the battle waits for the attacker reserve before declaring defeat');
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
