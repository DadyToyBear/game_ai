import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import * as BattleSimulation from '../src/battle_simulation.mjs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('../viewer/game.html', import.meta.url), 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript, 'game page contains its inline runtime');

function makeCanvasContext() {
  return new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    measureText: (text) => ({ width: String(text).length * 7 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }, {
    get(target, key) {
      return key in target ? target[key] : () => {};
    },
  });
}

async function launchGame(saveData) {
  const window = new Window({
    url: 'http://localhost/game',
    settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true },
  });
  const errors = [];
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/, '<script></script>'));
  window.addEventListener('error', (event) => errors.push(event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => errors.push(event.reason));
  window.HTMLCanvasElement.prototype.getContext = makeCanvasContext;
  window.BattleSimulation = BattleSimulation;
  window.requestAnimationFrame = (callback) => { window.__frameCallback = callback; return 1; };
  window.confirm = () => true;
  window.fetch = async (request) => {
    const relativePath = String(request).replace(/^\//, '');
    try {
      return new Response(readFileSync(resolve(root.pathname, relativePath)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch {
      return new Response('', { status: 404 });
    }
  };
  if (saveData) window.localStorage.setItem('crown-banner-save-v2', JSON.stringify(saveData));
  window.eval(inlineScript);
  await new Promise((resolveBoot) => setTimeout(resolveBoot, 60));
  return { window, errors };
}

function advanceDay(window) {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
}

test('tactical UI art and generated Celtic troop portraits are present and wired into battle', () => {
  for (const asset of ['battle_panel.png', 'battle_command_button.png', 'round_banner.png', 'hp_bar.png']) {
    assert.equal(existsSync(new URL(`../assets/ui/battle/${asset}`, import.meta.url)), true, `${asset} exists`);
    assert.ok(html.includes(`/assets/ui/battle/${asset}`), `${asset} is referenced by the game styles`);
  }
  for (const tile of ['grass', 'road', 'river', 'ford', 'forest', 'wall', 'gate', 'bridge']) {
    assert.equal(existsSync(new URL(`../assets/battle_tiles/${tile}.png`, import.meta.url)), true, `${tile} battlefield tile exists`);
    assert.ok(html.includes(`/assets/battle_tiles/${tile}.png`), `${tile} tile is connected to the tactical board`);
  }
  for (const [unit, file] of Object.entries({
    archer: 'archer_card.png', axeman: 'axeman_card.png', spearman: 'spearman_card.png', cavalry: 'cavalry_card.png', slinger: 'slinger_card.png',
  })) {
    for (const variant of [`../assets/units/cards/${file}`, `../assets/units/cards/battle/${file}`]) {
      assert.equal(existsSync(new URL(variant, import.meta.url)), true, `${unit} portrait asset exists`);
    }
    assert.ok(html.includes(`assets/units/cards/battle/${file}`), `${unit} portrait is mapped into tactical army cards`);
  }
  for (const [faction, file] of Object.entries({ viking: 'viking_card.png', gaul: 'gaul_card.png', slavic: 'slavic_card.png', roman: 'roman_card.png' })) {
    for (const variant of [`../assets/units/champions/${file}`, `../assets/units/champions/battle/${file}`]) {
      assert.equal(existsSync(new URL(variant, import.meta.url)), true, `${faction} champion asset exists`);
    }
    assert.ok(html.includes(`assets/units/champions/battle/${file}`), `${faction} champion is mapped into battle UI`);
  }
  assert.ok(html.includes('<option value="07_stone_slinger">Пращники</option>'), 'slinger can be recruited');
  assert.ok(html.includes("RANGED_CLASSES=['01_archer','07_stone_slinger']"), 'slinger is included in ranged combat');
  for (const art of ['codex_cover.png', 'muster_scene.png', 'siege_aftermath.png']) {
    assert.equal(existsSync(new URL(`../assets/events/${art}`, import.meta.url)), true, `${art} exists`);
    assert.ok(html.includes(`assets/events/${art}`), `${art} is connected to a game view or event`);
  }
});

test('existing sprite sheets already satisfy the eight-frame walk and combat prompts', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/animations/_manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.frames_per_clip, 8);
  assert.equal(manifest.units.length, 75);
  for (const unit of manifest.units) {
    for (const clipName of ['walk', 'combat']) {
      const clip = unit.clips[clipName];
      assert.equal(clip.frames, 8, `${unit.faction}/${unit.class} ${clipName} has eight frames`);
      assert.equal(existsSync(resolve(root.pathname, 'assets/animations', clip.sheet)), true, `${clip.sheet} exists`);
      assert.equal(existsSync(resolve(root.pathname, 'assets/animations', clip.gif)), true, `${clip.gif} exists`);
    }
  }
});

test('packaged runtime mirrors the browser inline runtime when the build artifact is present', { skip: !existsSync(new URL('../build/_game_runtime.js', import.meta.url)) }, () => {
  const packaged = readFileSync(new URL('../build/_game_runtime.js', import.meta.url), 'utf8').trim();
  assert.equal(packaged, inlineScript.trim());
});

test('browser DOM smoke: campaign loads, tabs work, and a daily turn is saved', async (t) => {
  const { window, errors } = await launchGame();
  t.after(() => window.happyDOM.abort());

  assert.match(window.document.title, /Корона и знамя/);
  assert.match(window.document.querySelector('#settlementManager').textContent, /Замок Серых Долин/);
  assert.equal(window.document.querySelectorAll('.roster-card').length > 0, true);
  assert.ok(window.document.querySelector('#panel-compendium .codex-cover'), 'Codex cover art is present in the compendium');

  window.document.querySelector('[data-tab="quests"]').click();
  assert.equal(window.document.querySelector('.panel.active')?.id, 'panel-quests');

  advanceDay(window);
  assert.match(window.document.querySelector('#resourceBar').textContent, /118/);
  const saved = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.equal(saved.day, 2);
  assert.equal(saved.food, 118);
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: default provisions sustain two full years without a settlement crisis', async (t) => {
  const { window, errors } = await launchGame();
  t.after(() => window.happyDOM.abort());
  for (let day = 0; day < 16; day += 1) advanceDay(window);

  const saved = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.equal(saved.year, 3);
  assert.ok(saved.food > 112, `food should remain sustainable after two years; got ${saved.food}`);
  assert.equal(saved.structures.find((s) => s.id === 'home').owner, 'player');
  assert.equal(saved.settlementDevelopment.home.loyalty, 36);
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: tactical battle renders and resolves a player turn', async (t) => {
  const { window, errors } = await launchGame();
  t.after(() => window.happyDOM.abort());
  window.Math.random = () => 0.5;

  const firstUnit = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Лучник'))
    || window.document.querySelector('#armyRoster [data-roster]');
  assert.ok(firstUnit);
  firstUnit.click();
  assert.equal(window.document.querySelector('#battleBtn').disabled, false);
  window.document.querySelector('#battleBtn').click();

  const overlay = window.document.querySelector('#battleOverlay');
  assert.equal(overlay.classList.contains('show'), true);
  assert.equal(window.document.querySelectorAll('#battleModal .battle-cell').length, 45);
  assert.ok(window.document.querySelectorAll('#battleModal .unit-portrait').length >= 1, 'generated archer portrait appears in friendly battle roster');
  assert.ok(window.document.querySelector('#battleModal .battle-round-banner'), 'round is drawn over its dedicated banner');
  assert.ok(window.document.querySelector('#battleModal .enemy-champion'), 'enemy faction champion portrait is shown');
  assert.ok(window.document.querySelectorAll('#battleModal .unit-strength').length >= 2, 'both armies display a current-strength meter');
  assert.equal(window.document.querySelector('#battleModal').dataset.battleMode, 'simulation');
  assert.match(window.document.querySelector('#battleModal .battle-briefing').textContent, /15 обновлений/);
  assert.ok(window.document.querySelector('#battleModal .unit-morale'), 'simulation roster exposes live morale');
  assert.match(window.document.querySelector('#battleModal .unit-morale').textContent, /резерв|передний ряд/,
    'each regiment is labeled as front rank or reserve');
  const frame = window.__frameCallback;
  assert.equal(typeof frame, 'function', 'the campaign animation loop schedules frames');
  let frameTime = window.performance.now();
  for (let i = 0; i < 4; i += 1) { window.__frameCallback(frameTime += 100); }
  const advancedTick = Number(window.document.querySelector('#battleModal').dataset.tick);
  assert.ok(advancedTick > 0, 'battle state advances through the animation loop at fixed ticks');
  window.document.querySelector('#battleModal [data-action="speed"]').click();
  assert.match(window.document.querySelector('#battleModal [data-action="speed"]').textContent, /x2/);
  let speedFrameTime = frameTime;
  const x2Tick = Number(window.document.querySelector('#battleModal').dataset.tick);
  for (let i = 0; i < 2; i += 1) { window.__frameCallback(speedFrameTime += 100); }
  assert.ok(Number(window.document.querySelector('#battleModal').dataset.tick) >= x2Tick + 2, 'x2 advances at twice the fixed-tick rate');
  window.document.querySelector('#battleModal [data-action="speed"]').click();
  assert.match(window.document.querySelector('#battleModal [data-action="speed"]').textContent, /x1/);
  window.document.querySelector('#battleModal [data-action="attack"]').click();
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /наступают/);
  window.document.querySelector('#battleModal [data-action="pause"]').click();
  assert.match(window.document.querySelector('#battleModal [data-action="pause"]').textContent, /Продолжить/);
  window.document.querySelector('#battleModal [data-action="pause"]').click();
  assert.match(window.document.querySelector('#battleModal [data-action="pause"]').textContent, /Пауза/);
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /Симуляция продолжена/);
  window.document.querySelector('#battleModal [aria-label*="ваш отряд"]')?.click();
  window.document.querySelector('#battleModal [data-cell-x="4"][data-cell-y="4"]')?.click();
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /приказ двигаться к выбранной клетке/);
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: a long tactical battle resolves and saves its campaign outcome', async (t) => {
  const { window, errors } = await launchGame();
  t.after(() => window.happyDOM.abort());
  window.Math.random = () => 0.5;
  const archer = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Лучник'))
    || window.document.querySelector('#armyRoster [data-roster]');
  assert.ok(archer);
  archer.click();
  const before = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  window.document.querySelector('#battleBtn').click();
  assert.match(window.document.querySelector('#battleModal .unit-morale').textContent, /резерв/,
    'ranged regiments start behind the front rank');
  window.document.querySelector('#battleModal [data-action="attack"]').click();
  window.document.querySelector('#battleModal [data-action="speed"]').click();

  let frameTime = window.performance.now();
  for (let frame = 0; frame < 1200 && !window.document.querySelector('#battleOutcome').classList.contains('show'); frame += 1) {
    const callback = window.__frameCallback;
    assert.equal(typeof callback, 'function', 'battle keeps scheduling simulation/render frames');
    callback(frameTime += 50);
  }

  assert.equal(window.document.querySelector('#battleOverlay').classList.contains('show'), false, 'battle closes when the simulation produces a result');
  const outcome = window.document.querySelector('#battleOutcome');
  assert.equal(outcome.classList.contains('show'), true, 'a battle result is presented to the player');
  assert.match(outcome.textContent, /Потери короны:/);
  const saved = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.ok(saved.units.some((unit) => !unit.enemy && unit.count >= 0), 'post-battle troop state is persisted');
  assert.notDeepEqual(
    saved.units.map(({ cls, count, enemy }) => `${cls}:${enemy}:${count}`),
    before.units.map(({ cls, count, enemy }) => `${cls}:${enemy}:${count}`),
    'battle losses or routed enemies are written back to the campaign save',
  );
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: slingers can be recruited and use the ranged command', async (t) => {
  const { window, errors } = await launchGame();
  t.after(() => window.happyDOM.abort());
  window.Math.random = () => 0.5;

  const recruitClass = window.document.querySelector('#recruitClass');
  recruitClass.value = '07_stone_slinger';
  recruitClass.dispatchEvent(new window.Event('change', { bubbles: true }));
  window.document.querySelector('#recruitBtn').click();
  const slinger = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Пращник'));
  assert.ok(slinger, 'recruited slinger appears in the army roster');
  slinger.click();
  window.document.querySelector('#battleBtn').click();
  const ranged = window.document.querySelector('#battleModal [data-action="ranged"]');
  assert.ok(ranged && !ranged.disabled, 'slinger enables the ranged order');
  assert.ok(window.document.querySelector('#battleModal .unit-portrait[src*="slinger_card.png"]'), 'generated slinger portrait is used in battle');
  ranged.click();
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /дальний залп/);
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: onboarding follows real controls and advances responsively', async (t) => {
  const { window, errors } = await launchGame({
    faction: '01_celtic_briton',
    tutorialStep: 0,
    tutorialComplete: false,
    day: 1,
    year: 1,
    food: 112,
    wood: 58,
    stone: 36,
    gold: 126,
    population: 184,
    loyalty: 72,
    structures: [],
    units: [],
    settlementPolicies: {},
    settlementDevelopment: {},
  });
  t.after(() => window.happyDOM.abort());
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 });

  window.document.querySelector('#continueGame').click();
  assert.equal(window.document.querySelector('#tutorialOverlay').classList.contains('show'), true);
  assert.equal(window.document.querySelector('[data-tab="realm"]').classList.contains('active'), true);
  assert.equal(window.document.querySelector('#tutorialSpotlight').hidden, false);
  assert.match(window.document.querySelector('#tutorialModal').textContent, /1 из 6/);

  const next = () => window.document.querySelector('[data-tutorial-next]').click();
  next();
  assert.equal(window.document.querySelector('[data-tab="realm"]').classList.contains('active'), true);
  assert.match(window.document.querySelector('#tutorialModal').textContent, /2 из 6/);
  next();
  assert.equal(window.document.querySelector('[data-tab="army"]').classList.contains('active'), true);
  assert.equal(window.document.querySelector('#tutorialSpotlight').hidden, false);
  next();
  next();
  assert.equal(window.document.querySelector('[data-tab="council"]').classList.contains('active'), true);
  assert.equal(window.document.querySelector('#tutorialSpotlight').hidden, false);
  assert.match(window.document.querySelector('#tutorialModal').textContent, /5 из 6/);
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: sustained starvation ends in a persisted settlement revolt', async (t) => {
  const faction = '01_celtic_briton';
  const home = {
    id: 'home', name: 'Замок Серых Долин', type: 'castle', x: 9, y: 16,
    faction, owner: 'player', level: 1,
  };
  const { window, errors } = await launchGame({
    faction,
    capitalId: 'home',
    day: 1,
    year: 1,
    campaignTurn: 0,
    food: 0,
    wood: 58,
    stone: 36,
    gold: 126,
    population: 184,
    loyalty: 20,
    settlementPolicies: {},
    settlementDevelopment: { home: { loyalty: 36, specialty: 'none', governor: null } },
    structures: [home],
    units: [{
      cls: '03_sword_and_shield', x: 9 * 32, y: 16 * 32, count: 1000,
      capacity: 1000, faction, enemy: false, morale: 70, fatigue: 0, illDays: 0,
    }],
    diplomacy: {},
  });
  t.after(() => window.happyDOM.abort());

  assert.match(window.document.querySelector('#settlementManager').textContent, /36%/);
  let saved;
  for (let day = 0; day < 16; day += 1) {
    advanceDay(window);
    saved = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
    if (saved.structures[0].owner === 'neutral') break;
  }

  assert.equal(saved.structures[0].owner, 'neutral');
  assert.equal(saved.structures[0].faction, null);
  assert.equal(saved.settlementDevelopment.home.loyalty, 0);
  assert.equal(Object.hasOwn(saved.settlementPolicies, 'home'), false);
  assert.match(window.document.querySelector('#chronicle').textContent, /подняло мятеж/);
  assert.match(window.document.querySelector('#settlementManager').textContent, /пока нет городов/);
  assert.deepEqual(errors, []);
});
