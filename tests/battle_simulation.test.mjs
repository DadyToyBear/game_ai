import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceBattle,
  BATTLE_FIXED_DT,
  BATTLE_TICK_HZ,
  createBattle,
  issueOrder,
  previewBattleAttack,
  resolveHeadlessBattle,
  setBattlePaused,
  setBattleSpeed,
} from '../src/battle_simulation.mjs';

const encounter = (seed = 73) => createBattle({
  seed,
  map: { width: 7, height: 3, obstacles: [] },
  attacker: { regiments: [{
    id: 'crown-vanguard', class: 'swordsman', count: 8, max_count: 8,
    position: { x: 1, y: 1 }, stats: { attack: 100, defense: 10, range: 1.2, speed: 3 },
  }] },
  defender: { regiments: [{
    id: 'frontier-guard', class: 'spearman', count: 8, max_count: 8,
    position: { x: 5, y: 1 }, stats: { attack: 100, defense: 10, range: 1.2, speed: 3 },
  }] },
});

function orderBothSides(state) {
  let next = issueOrder(state, 'crown-vanguard', { type: 'attack', targetId: 'frontier-guard' });
  next = issueOrder(next, 'frontier-guard', { type: 'attack', targetId: 'crown-vanguard' });
  return setBattlePaused(next, false);
}

test('battle simulation advances only on fixed 15 Hz ticks and does not mutate inputs', () => {
  const initial = encounter();
  const ordered = orderBothSides(initial);
  const advanced = advanceBattle(ordered, 12);

  assert.equal(BATTLE_TICK_HZ, 15);
  assert.equal(BATTLE_FIXED_DT, 1 / 15);
  assert.equal(initial.tick, 0);
  assert.equal(initial.orders.length, 0);
  assert.equal(advanced.tick, 12);
  assert.equal(advanced.paused, false);
});

test('battle outcome and casualties are repeatable for the same seed and orders', () => {
  const resolve = (seed) => advanceBattle(orderBothSides(encounter(seed)), 1200);
  const first = resolve(73);
  const repeat = resolve(73);

  assert.ok(first.result, 'the two ordered regiments eventually resolve the battle');
  assert.deepEqual(first, repeat);
  assert.ok(['attacker', 'defender', 'draw'].includes(first.result.winner));
  assert.ok(first.result.durationTicks > 0);
  assert.ok(first.result.durationSeconds > 0);
  assert.deepEqual(Object.keys(first.result.casualties).sort(), ['crown-vanguard', 'frontier-guard']);
  assert.ok(Object.values(first.result.casualties).every((loss) => loss >= 0 && loss <= 8));
});

test('attack preview matches expected damage and ranged hold orders fire without advancing', () => {
  const battle = createBattle({
    seed: 9,
    map: { width: 7, height: 3 },
    attacker: { regiments: [{
      id: 'archers', class: 'archer', count: 100, position: { x: 1, y: 1 },
      morale: 100, stats: { attack: 100, defense: 20, range: 3, speed: 3 },
    }] },
    defender: { regiments: [{
      id: 'target', class: 'infantry', count: 100, position: { x: 2.5, y: 1 },
      stats: { attack: 30, defense: 30, range: 1, speed: 2 },
    }] },
  });
  const preview = previewBattleAttack(battle, 'archers', 'target');
  assert.equal(preview.inRange, true);
  assert.equal(preview.distance, 1.5);
  assert.ok(preview.expectedDamage > 0);

  const outOfRange = createBattle({
    attacker: { regiments: [{ id: 'archers', count: 10, position: { x: 1, y: 1 }, stats: { range: 1 } }] },
    defender: { regiments: [{ id: 'target', count: 10, position: { x: 4, y: 1 } }] },
  });
  assert.equal(previewBattleAttack(outOfRange, 'archers', 'target').inRange, false);
  assert.equal(previewBattleAttack(outOfRange, 'archers', 'target').expectedDamage, 0);

  const ordered = issueOrder(battle, 'archers', { type: 'hold', targetId: 'target' });
  const initialPosition = ordered.regiments.find((unit) => unit.id === 'archers').position;
  const fired = advanceBattle(setBattlePaused(ordered, false), 5);
  assert.deepEqual(fired.regiments.find((unit) => unit.id === 'archers').position, initialPosition,
    'hold-fire orders do not move the regiment toward a target');
  assert.equal(fired.regiments.find((unit) => unit.id === 'archers').state, 'holding');
  assert.ok(fired.regiments.find((unit) => unit.id === 'target').count < 100,
    'a held ranged regiment fires while its target remains in range');
});

test('pause freezes state and resuming continues from the same tick', () => {
  const moving = advanceBattle(orderBothSides(encounter()), 20);
  const paused = setBattlePaused(moving, true);
  const frozen = advanceBattle(paused, 100);
  assert.deepEqual(frozen, paused);

  const resumed = advanceBattle(setBattlePaused(frozen, false), 7);
  assert.equal(resumed.tick, paused.tick + 7);
});

test('battle speed changes are immutable, validated, and do not alter the fixed tick', () => {
  const initial = encounter();
  const doubled = setBattleSpeed(initial, 2);
  assert.equal(initial.speed, 1);
  assert.equal(doubled.speed, 2);
  assert.equal(doubled.tick_hz, BATTLE_TICK_HZ);
  assert.throws(() => setBattleSpeed(initial, 3), /x1 or x2/);
  const paused = setBattlePaused(doubled, true);
  assert.equal(setBattleSpeed(paused, 1).paused, true);
});

test('scenario terrain slows movement and improves cover against incoming attacks', () => {
  const makeDuel = (terrain = []) => {
    const initial = createBattle({
      seed: 19,
      map: { width: 6, height: 3, terrain },
      attacker: { regiments: [{
        id: 'archers', count: 100, position: { x: 1.2, y: 1.5 },
        stats: { attack: 100, defense: 30, range: 4, speed: 15 },
      }] },
      defender: { regiments: [{
        id: 'guard', count: 100, position: { x: 2.2, y: 1.5 },
        stats: { attack: 100, defense: 30, range: 4, speed: 15 },
      }] },
    });
    let ordered = issueOrder(initial, 'archers', { type: 'attack', targetId: 'guard' });
    ordered = issueOrder(ordered, 'guard', { type: 'attack', targetId: 'archers' });
    return setBattlePaused(ordered, false);
  };

  const plain = advanceBattle(makeDuel(), 20);
  const wooded = advanceBattle(makeDuel([{ x: 2, y: 1, type: 'woods' }]), 20);
  assert.ok(wooded.regiments.find((unit) => unit.id === 'guard').count > plain.regiments.find((unit) => unit.id === 'guard').count,
    'a regiment in woods takes reduced casualties');

  const mover = createBattle({
    map: { width: 6, height: 3, terrain: [{ x: 2, y: 1, type: 'river' }] },
    attacker: { regiments: [{ id: 'scout', count: 4, position: { x: 1.5, y: 1.5 }, stats: { speed: 15 } }] },
  });
  const moved = advanceBattle(setBattlePaused(issueOrder(mover, 'scout', { type: 'move', x: 5.5, y: 1.5 }), false), 1);
  assert.ok(moved.regiments.find((unit) => unit.id === 'scout').position.x < 2.5,
    'a river cell reduces the distance covered on the step into it');
});

test('shield wall and wedge formations modify attack and defense in the simulation', () => {
  const resolve = ({ attackerFormation = 'line', defenderFormation = 'line', attackerClass = 'infantry' } = {}) => {
    const initial = createBattle({
      seed: 31,
      attacker: { regiments: [{
        id: 'attacker', class: attackerClass, count: 100, formation: attackerFormation,
        position: { x: 1, y: 1 }, stats: { attack: 80, defense: 30, range: 4, speed: 0 },
      }] },
      defender: { regiments: [{
        id: 'defender', count: 100, formation: defenderFormation,
        position: { x: 2, y: 1 }, stats: { attack: 80, defense: 30, range: 4, speed: 0 },
      }] },
    });
    let ordered = issueOrder(initial, 'attacker', { type: 'attack', targetId: 'defender' });
    ordered = issueOrder(ordered, 'defender', { type: 'attack', targetId: 'attacker' });
    return advanceBattle(setBattlePaused(ordered, false), 20);
  };
  const line = resolve();
  const shieldwall = resolve({ defenderFormation: 'shieldwall' });
  const wedge = resolve({ attackerFormation: 'wedge' });
  const cavalryWedge = resolve({ attackerFormation: 'wedge', attackerClass: '08_cavalryman' });
  const survivors = (state, id) => state.regiments.find((unit) => unit.id === id).count;

  assert.ok(survivors(shieldwall, 'defender') > survivors(line, 'defender'), 'shield wall reduces incoming casualties');
  assert.ok(survivors(wedge, 'defender') < survivors(line, 'defender'), 'wedge inflicts additional casualties');
  assert.ok(survivors(cavalryWedge, 'defender') < survivors(wedge, 'defender'), 'cavalry gets the extra wedge attack bonus');
});

test('spearmen counter cavalry and cavalry charge adds a one-time first-hit bonus', () => {
  const resolveSingleAttacker = ({ attackerClass, targetClass, charge = 0 }) => {
    const initial = createBattle({
      seed: 42,
      attacker: { regiments: [{
        id: 'attacker', class: attackerClass, count: 100, position: { x: 1, y: 1 },
        stats: { attack: 80, defense: 30, range: 4, speed: 0, charge },
      }] },
      defender: { regiments: [{
        id: 'target', class: targetClass, count: 100, position: { x: 2, y: 1 },
        stats: { attack: 0, defense: 30, range: 4, speed: 0 },
      }] },
    });
    return advanceBattle(setBattlePaused(issueOrder(initial, 'attacker', { type: 'attack', targetId: 'target' }), false), 20)
      .regiments.find((unit) => unit.id === 'target').count;
  };
  assert.ok(resolveSingleAttacker({ attackerClass: '06_spearman_shield', targetClass: '08_cavalryman' }) <
    resolveSingleAttacker({ attackerClass: '06_spearman_shield', targetClass: '03_sword_and_shield' }),
  'spearmen deal extra damage to cavalry');
  assert.ok(resolveSingleAttacker({ attackerClass: '08_cavalryman', targetClass: '03_sword_and_shield', charge: 1 }) <
    resolveSingleAttacker({ attackerClass: '08_cavalryman', targetClass: '03_sword_and_shield', charge: 0 }),
  'the cavalry charge improves its first contact');
});

test('pike brace reduces cavalry damage and stays deterministic in the manual/headless battle path', () => {
  const createEncounter = () => createBattle({
    seed: 809,
    map: { width: 7, height: 3 },
    attacker: { regiments: [{ id: 'cavalry', class: '08_cavalryman', count: 1000,
      position: { x: 2, y: 1 }, morale: 100,
      stats: { attack: 100, defense: 20, range: 1.2, speed: 0, charge: 1 } }] },
    defender: { regiments: [{ id: 'pikes', class: '06_spearman_shield', count: 1000,
      position: { x: 3, y: 1 }, morale: 100,
      stats: { attack: 80, defense: 20, range: 1.2, speed: 0 } }] },
  });
  const orderCavalry = state => issueOrder(state, 'cavalry', { type: 'attack', targetId: 'pikes' });
  const unbraced = advanceBattle(setBattlePaused(orderCavalry(createEncounter()), false), 1);
  const initial = orderCavalry(createEncounter());
  const bracedOrder = issueOrder(initial, 'pikes', { type: 'brace' });
  const ordinaryPikesOrder = issueOrder(initial, 'pikes', { type: 'attack', targetId: 'cavalry' });
  const bracedDamage = previewBattleAttack(bracedOrder, 'cavalry', 'pikes').expectedDamage;
  const ordinaryDamage = previewBattleAttack(ordinaryPikesOrder, 'cavalry', 'pikes').expectedDamage;
  assert.ok(Math.abs(bracedDamage / ordinaryDamage - 0.55) < 1e-10,
    'brace reduces all cavalry damage, including the one-time charge bonus, by exactly 45%');
  const braced = advanceBattle(setBattlePaused(bracedOrder, false), 1);
  const casualties = state => 1000 - state.regiments.find(unit => unit.id === 'pikes').count;

  assert.ok(casualties(braced) < casualties(unbraced),
    'braced spearmen take less damage from a cavalry charge');
  assert.equal(braced.regiments.find(unit => unit.id === 'pikes').state, 'bracing');
  assert.throws(() => issueOrder(initial, 'cavalry', { type: 'brace' }), /Only spearmen/,
    'non-spearmen cannot issue a pike-brace order');
  const released = issueOrder(bracedOrder, 'pikes', { type: 'hold' });
  assert.equal(released.regiments.find(unit => unit.id === 'pikes').order.type, 'hold',
    'a normal order replaces and clears the brace stance');

  const resolveManual = advanceBattle(setBattlePaused(bracedOrder, false), 1200);
  const resolveHeadless = resolveHeadlessBattle(bracedOrder, 1200);
  assert.ok(resolveManual.result, 'the control fight reaches an outcome');
  assert.deepEqual(resolveHeadless, resolveManual,
    'the brace order and its defensive effect are identical in the headless resolver');
});

test('front rank protects a rear regiment from direct attacks, but not a flank', () => {
  const resolve = ({ withScreen, flanking = false }) => {
    const targetPosition = flanking ? { x: 7, y: 2 } : { x: 8, y: 2 };
    const attackerPosition = flanking ? { x: 7, y: 1 } : { x: 4.5, y: 2 };
    const initial = createBattle({
      seed: 63,
      attacker: { regiments: [{
        id: 'attacker', count: 100, position: attackerPosition,
        stats: { attack: 80, range: 5, speed: 0 },
      }] },
      defender: { regiments: [
        ...(withScreen ? [{ id: 'screen', count: 100, rank: 'front', position: { x: 6, y: 2 }, stats: { defense: 30 } }] : []),
        { id: 'rear', count: 100, rank: 'rear', position: targetPosition, stats: { defense: 30 } },
      ] },
    });
    return advanceBattle(setBattlePaused(issueOrder(initial, 'attacker', { type: 'attack', targetId: 'rear' }), false), 20)
      .regiments.find((unit) => unit.id === 'rear').count;
  };
  assert.ok(resolve({ withScreen: true }) > resolve({ withScreen: false }),
    'a front-rank ally reduces direct damage to the reserve');
  assert.equal(resolve({ withScreen: true, flanking: true }), resolve({ withScreen: false, flanking: true }),
    'a side attack bypasses a screen that is not on its line of approach');
});

test('rear and flank attacks deal more damage than a frontal attack', () => {
  const resolve = (position) => {
    const initial = createBattle({
      seed: 17,
      attacker: { regiments: [{
        id: 'flanker', count: 100, position, stats: { attack: 80, range: 5, speed: 0 },
      }] },
      defender: { regiments: [{
        id: 'shield-line', count: 100, position: { x: 2, y: 2 }, stats: { defense: 30, range: 1, speed: 0 },
      }] },
    });
    return advanceBattle(setBattlePaused(issueOrder(initial, 'flanker', { type: 'attack', targetId: 'shield-line' }), false), 20)
      .regiments.find((unit) => unit.id === 'shield-line').count;
  };
  const frontal = resolve({ x: 1, y: 2 });
  const flank = resolve({ x: 2, y: 1 });
  const rear = resolve({ x: 3, y: 2 });
  assert.ok(flank < frontal, 'side attacks receive the flanking bonus');
  assert.ok(rear < flank, 'rear attacks receive a larger bonus than side attacks');
});

test('flank orders approach the target side before attacking', () => {
  const initial = createBattle({
    attacker: { regiments: [{
      id: 'flanker', count: 100, position: { x: 1, y: 2 },
      stats: { attack: 100, defense: 30, range: 1.2, speed: 15 },
    }] },
    defender: { regiments: [{
      id: 'guard', count: 100, position: { x: 4, y: 2 }, facing: Math.PI,
      stats: { attack: 0, defense: 30, range: 1, speed: 0 },
    }] },
  });
  const ordered = setBattlePaused(issueOrder(initial, 'flanker', { type: 'attack', targetId: 'guard', flank: true }), false);
  const approach = advanceBattle(ordered, 1);
  assert.notEqual(approach.regiments.find((unit) => unit.id === 'flanker').position.y, 2,
    'the flanker leaves the frontal lane while approaching');
  assert.equal(approach.regiments.find((unit) => unit.id === 'guard').count, 100,
    'the order does not attack before reaching a flank angle');
  const engaged = advanceBattle(approach, 15);
  assert.ok(engaged.regiments.find((unit) => unit.id === 'guard').count < 100,
    'the flanking unit attacks after taking a side position');
});

test('casualties lower morale and a broken regiment routes separately from an orderly withdrawal', () => {
  const pressured = createBattle({
    attacker: { regiments: [{
      id: 'overwhelming-force', count: 1000, position: { x: 1, y: 1 },
      stats: { attack: 200, range: 4, speed: 0 },
    }] },
    defender: { regiments: [{
      id: 'low-morale-guard', count: 100, position: { x: 2, y: 1 }, morale: 10.5,
      stats: { attack: 0, range: 4, speed: 0 },
    }] },
  });
  const attack = setBattlePaused(issueOrder(pressured, 'overwhelming-force', { type: 'attack', targetId: 'low-morale-guard' }), false);
  const broken = advanceBattle(attack, 1);
  const routedGuard = broken.regiments.find((unit) => unit.id === 'low-morale-guard');
  assert.equal(routedGuard.state, 'routed');
  assert.ok(routedGuard.morale < 10.5);
  assert.deepEqual(broken.result.routed, ['low-morale-guard']);
  assert.deepEqual(broken.result.withdrawn, []);
  assert.throws(() => issueOrder(broken, 'low-morale-guard', { type: 'hold' }), /Cannot issue orders after the battle has ended/);

  const retreating = createBattle({
    attacker: { regiments: [{ id: 'scout', count: 5, position: { x: 0.4, y: 1 }, stats: { speed: 15 } }] },
    defender: { regiments: [{ id: 'pursuer', count: 5, position: { x: 3, y: 1 } }] },
  });
  const withdrawing = advanceBattle(setBattlePaused(issueOrder(retreating, 'scout', { type: 'retreat' }), false), 1);
  assert.deepEqual(withdrawing.result.withdrawn, ['scout']);
  assert.deepEqual(withdrawing.result.routed, []);
});

test('orders reject invalid targets and fixed-step movement cannot enter obstacles', () => {
  const state = createBattle({
    map: { width: 5, height: 3, obstacles: [{ x: 2, y: 1 }] },
    attacker: { regiments: [{ id: 'scout', count: 4, position: { x: 1.5, y: 1.5 }, stats: { speed: 15 } }] },
    defender: { regiments: [{ id: 'guard', count: 4, position: { x: 4, y: 1 } }] },
  });
  assert.throws(() => issueOrder(state, 'scout', { type: 'attack', targetId: 'missing' }), /Invalid attack target/);

  const ordered = issueOrder(state, 'scout', { type: 'move', x: 3.5, y: 1.5 });
  const running = advanceBattle(setBattlePaused(ordered, false), 1);
  assert.deepEqual(running.regiments.find((unit) => unit.id === 'scout').position, { x: 1.5, y: 1.5 });
});
