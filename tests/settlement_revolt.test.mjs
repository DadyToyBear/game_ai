import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sourceFiles = [
  ['browser game', new URL('../viewer/game.html', import.meta.url)],
  ['packaged runtime', new URL('../build/_game_runtime.js', import.meta.url)],
].filter(([, url]) => existsSync(url));
const sources = sourceFiles.map(([label, url]) => [label, readFileSync(url, 'utf8')]);

function extractLoyaltyFunction(source, label) {
  const start = source.indexOf('function updateSettlementLoyalty(){');
  const end = source.indexOf('function buildingYield(', start);
  assert.notEqual(start, -1, `${label}: settlement loyalty function exists`);
  assert.notEqual(end, -1, `${label}: following function marker exists`);
  return source.slice(start, end).trim();
}

function createScenario({ food, crownLoyalty, settlements, governors = {} }) {
  const state = {
    faction: 'crown',
    food,
    loyalty: crownLoyalty,
    population: 184,
    settlementPolicies: Object.fromEntries(settlements.map((s) => [s.id, 'market_focus'])),
  };
  const logs = [];
  const news = [];
  const context = {
    state,
    SETTLEMENT_GOVERNORS: governors,
    playerSettlements: () => settlements.filter(
      (s) => s.faction === state.faction && s.owner === 'player',
    ),
    settlementDevelopment: (s) => s.development,
    log: (message) => logs.push(message),
    showNewsSplash: (...args) => news.push(args),
  };
  return { context, state, settlements, logs, news };
}

function update(source, scenario) {
  const fn = extractLoyaltyFunction(source, 'runtime');
  vm.runInNewContext(`${fn}\nglobalThis.revoltChanged = updateSettlementLoyalty();`, scenario.context);
  return scenario.context.revoltChanged;
}

function settlement(id, name, loyalty, overrides = {}) {
  return {
    id,
    name,
    owner: 'player',
    faction: 'crown',
    development: { loyalty, specialty: 'market', governor: null },
    ...overrides,
  };
}

for (const [label, source] of sources) {
  test(`${label}: healthy provisions do not erode settlement loyalty`, () => {
    const scenario = createScenario({
      food: 80,
      crownLoyalty: 72,
      settlements: [settlement('keep', 'Восточная крепость', 58)],
    });

    assert.equal(update(source, scenario), false);
    assert.equal(scenario.settlements[0].development.loyalty, 58);
    assert.equal(scenario.settlements[0].owner, 'player');
    assert.equal(scenario.news.length, 0);
  });

  test(`${label}: prolonged famine triggers and records a settlement revolt`, () => {
    const keep = settlement('keep', 'Восточная крепость', 40);
    const scenario = createScenario({ food: 0, crownLoyalty: 20, settlements: [keep] });
    let days = 0;

    while (keep.owner === 'player' && days < 40) {
      assert.equal(update(source, scenario), true);
      days += 1;
    }

    assert.equal(days, 12, 'the documented daily loyalty penalties should reach zero in 12 turns');
    assert.equal(keep.owner, 'neutral');
    assert.equal(keep.faction, null);
    assert.equal(keep.development.loyalty, 0);
    assert.equal(keep.development.specialty, 'none');
    assert.equal(keep.development.governor, null);
    assert.equal(scenario.state.population, 180);
    assert.equal(Object.hasOwn(scenario.state.settlementPolicies, keep.id), false);
    assert.equal(scenario.logs.filter((line) => line.includes('подняло мятеж')).length, 1);
    assert.equal(scenario.news.length, 1);
    assert.equal(scenario.news[0][0], 'Мятеж в поселении');
    assert.match(scenario.news[0][1], /Восточная крепость/);
    assert.equal(scenario.news[0][5], 'assets/events/settlement_revolt.jpg');
    assert.equal(update(source, scenario), false, 'a neutral settlement must not revolt repeatedly');
    assert.equal(scenario.news.length, 1);
  });

  test(`${label}: restoring grain stops a famine-driven loyalty decline`, () => {
    const keep = settlement('keep', 'Восточная крепость', 40);
    const scenario = createScenario({ food: 20, crownLoyalty: 72, settlements: [keep] });

    for (let day = 0; day < 5; day += 1) update(source, scenario);
    assert.equal(keep.development.loyalty, 30);
    assert.equal(keep.owner, 'player');

    scenario.state.food = 60;
    for (let day = 0; day < 10; day += 1) update(source, scenario);
    assert.equal(keep.development.loyalty, 30, 'adequate grain should stop further losses');
    assert.equal(keep.owner, 'player');
    assert.equal(scenario.news.length, 0);
  });

  test(`${label}: a loyal governor offsets local decay without hunger`, () => {
    const keep = settlement('keep', 'Восточная крепость', 40, {
      development: { loyalty: 40, specialty: 'none', governor: 'alwen' },
    });
    const scenario = createScenario({
      food: 60,
      crownLoyalty: 72,
      settlements: [keep],
      governors: { alwen: { loyalty: 1 } },
    });

    for (let day = 0; day < 20; day += 1) update(source, scenario);
    assert.equal(keep.development.loyalty, 60);
    assert.equal(keep.owner, 'player');
  });

  test(`${label}: simultaneous revolts are all reported and accounted for`, () => {
    const east = settlement('east', 'Восточная крепость', 4);
    const west = settlement('west', 'Западный город', 4);
    const scenario = createScenario({ food: 0, crownLoyalty: 20, settlements: [east, west] });

    assert.equal(update(source, scenario), true);
    assert.equal(east.owner, 'neutral');
    assert.equal(west.owner, 'neutral');
    assert.equal(scenario.state.population, 176);
    assert.equal(scenario.logs.filter((line) => line.includes('подняло мятеж')).length, 2);
    assert.equal(scenario.news.length, 1);
    assert.equal(scenario.news[0][0], 'Мятеж в нескольких поселениях');
    assert.match(scenario.news[0][1], /Восточная крепость/);
    assert.match(scenario.news[0][1], /Западный город/);
  });
}

test('browser and packaged runtime keep settlement revolt logic synchronized', { skip: sources.length < 2 }, () => {
  const browser = extractLoyaltyFunction(sources[0][1], 'browser game').replace(/\s+/g, ' ');
  const packaged = extractLoyaltyFunction(sources[1][1], 'packaged runtime').replace(/\s+/g, ' ');
  assert.equal(browser, packaged);
});

test('the daily game turn runs settlement loyalty processing', () => {
  for (const [label, source] of sources) {
    const compact = source.replace(/\s+/g, ' ');
    assert.match(compact, /processArmyDaily\(\);updateSettlementLoyalty\(\);processNeighborDiplomacy\(\)/, label);
  }
});
