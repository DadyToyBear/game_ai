import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import * as BattleSimulation from '../src/battle_simulation.mjs';
import * as BattleContract from '../src/battle_contract.mjs';

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
  const canvasContexts = new Map();
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/, '<script></script>'));
  window.addEventListener('error', (event) => errors.push(event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => errors.push(event.reason));
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!canvasContexts.has(this.id)) canvasContexts.set(this.id, makeCanvasContext());
    return canvasContexts.get(this.id);
  };
  window.BattleSimulation = BattleSimulation;
  window.BattleContract = BattleContract;
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
  return { window, errors, canvasContexts };
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

test('browser DOM smoke: tax and harvest are once-per-day actions that persist and reset on the next day', async (t) => {
  const { window, errors } = await launchGame();
  t.after(() => window.happyDOM.abort());
  const tax = window.document.querySelector('#taxBtn');
  const harvest = window.document.querySelector('#harvestBtn');
  assert.equal(tax.disabled, false);
  assert.equal(harvest.disabled, false);
  tax.click();
  harvest.click();
  assert.equal(tax.disabled, true, 'tax collection locks after use');
  assert.equal(harvest.disabled, true, 'harvest locks after use');
  const once = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.deepEqual(once.dailyActions, { tax: true, harvest: true });
  const gold = once.gold, food = once.food;
  tax.click();
  harvest.click();
  assert.equal(JSON.parse(window.localStorage.getItem('crown-banner-save-v2')).gold, gold,
    'a second click cannot collect tax again');
  assert.equal(JSON.parse(window.localStorage.getItem('crown-banner-save-v2')).food, food,
    'a second click cannot harvest again');

  window.happyDOM.abort();
  const resumed = await launchGame(once);
  t.after(() => resumed.window.happyDOM.abort());
  assert.equal(resumed.window.document.querySelector('#taxBtn').disabled, true,
    'used actions remain locked after restoring a save');
  assert.equal(resumed.window.document.querySelector('#harvestBtn').disabled, true);
  resumed.window.document.querySelector('#endTurn').click();
  assert.equal(resumed.window.document.querySelector('#taxBtn').disabled, false,
    'daily actions refresh when the campaign day advances');
  assert.equal(resumed.window.document.querySelector('#harvestBtn').disabled, false);
  assert.deepEqual(JSON.parse(resumed.window.localStorage.getItem('crown-banner-save-v2')).dailyActions,
    { tax: false, harvest: false });
  assert.deepEqual([...errors, ...resumed.errors], []);
});

test('browser DOM smoke: local settlement loyalty changes its daily production', async (t) => {
  const seedSession = await launchGame();
  seedSession.window.document.querySelector('#saveBtn').click();
  const template = JSON.parse(seedSession.window.localStorage.getItem('crown-banner-save-v2'));
  seedSession.window.happyDOM.abort();

  const dailyGoldAtLoyalty = async (loyalty) => {
    const save = structuredClone(template);
    save.structures.push({ id: 'loyalty-test-town', type: 'town', name: 'Опытный город', x: 21, y: 12,
      level: 3, owner: 'player', faction: save.faction });
    save.settlementDevelopment = { ...(save.settlementDevelopment || {}),
      'loyalty-test-town': { loyalty, specialty: 'none', governor: null } };
    const { window, errors } = await launchGame(save);
    const before = JSON.parse(window.localStorage.getItem('crown-banner-save-v2')).gold;
    window.document.querySelector('#endTurn').click();
    const after = JSON.parse(window.localStorage.getItem('crown-banner-save-v2')).gold;
    window.happyDOM.abort();
    assert.deepEqual(errors, []);
    return after - before;
  };

  const loyalIncome = await dailyGoldAtLoyalty(70);
  const middlingIncome = await dailyGoldAtLoyalty(35);
  const disloyalIncome = await dailyGoldAtLoyalty(10);
  assert.equal(loyalIncome - middlingIncome, 1,
    'positive settlement production is reduced by one quarter at 35% loyalty');
  assert.equal(middlingIncome - disloyalIncome, 1,
    'positive settlement production is halved below 20% loyalty');
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

test('browser DOM smoke: minimap click and drag move the world camera', async (t) => {
  const { window, errors, canvasContexts } = await launchGame();
  t.after(() => window.happyDOM.abort());
  const minimap = window.document.querySelector('#minimap');
  const world = window.document.querySelector('#world');
  assert.match(minimap.getAttribute('aria-label'), /перетащите/);
  Object.defineProperties(minimap, { clientWidth: { configurable: true, value: 100 }, clientHeight: { configurable: true, value: 80 } });
  Object.defineProperties(world, { clientWidth: { configurable: true, value: 400 }, clientHeight: { configurable: true, value: 300 } });
  minimap.getBoundingClientRect = () => ({ left: 100, top: 200, width: 100, height: 80, right: 200, bottom: 280 });

  const viewportRects = [];
  canvasContexts.get('minimap').strokeRect = (...rect) => viewportRects.push(rect);
  const renderFrame = () => window.__frameCallback(window.performance.now() + 16);
  renderFrame();
  const before = viewportRects.at(-1);

  const pointer = (type, x, y, pointerId = 7) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    minimap.dispatchEvent(event);
  };
  pointer('pointerdown', 120, 220);
  pointer('pointermove', 180, 260);
  renderFrame();
  const afterDrag = viewportRects.at(-1);
  assert.ok(afterDrag[0] > before[0], 'dragging right pans the map viewport right');
  assert.ok(afterDrag[1] > before[1], 'dragging down pans the map viewport down');

  pointer('pointerup', 180, 260);
  pointer('pointermove', 110, 210);
  renderFrame();
  const afterRelease = viewportRects.at(-1);
  assert.deepEqual(afterRelease, afterDrag, 'pointer movement after release does not continue panning');
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: clicking a friendly settlement opens its council controls', async (t) => {
  const { window, errors } = await launchGame();
  t.after(() => window.happyDOM.abort());
  const world = window.document.querySelector('#world');
  Object.defineProperties(world, { clientWidth: { configurable: true, value: 400 }, clientHeight: { configurable: true, value: 300 } });
  world.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
  world.setPointerCapture = () => {};

  const mapWidth = 45 * 64, mapHeight = 30 * 64;
  const scale = Math.min(400 / mapWidth, 300 / mapHeight) * 1.28;
  const x = (9.5 * 64 - mapWidth * .49) * scale + 200;
  const y = (16.5 * 64 - mapHeight * .49) * scale + 150;
  const pointer = (type) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 3 });
    world.dispatchEvent(event);
  };
  pointer('pointerdown');
  pointer('pointerup');

  assert.equal(window.document.querySelector('[data-tab="council"]').classList.contains('active'), true);
  assert.match(window.document.querySelector('#settlementManager').textContent, /Замок Серых Долин/);
  assert.match(window.document.querySelector('#toast').textContent, /Совет открыт/);
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: wheel zoom keeps its map anchor under the pointer', async (t) => {
  const { window, errors, canvasContexts } = await launchGame();
  t.after(() => window.happyDOM.abort());
  const world = window.document.querySelector('#world');
  const minimap = window.document.querySelector('#minimap');
  Object.defineProperties(minimap, { clientWidth: { configurable: true, value: 100 }, clientHeight: { configurable: true, value: 80 } });
  Object.defineProperties(world, { clientWidth: { configurable: true, value: 400 }, clientHeight: { configurable: true, value: 300 } });
  world.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
  minimap.getBoundingClientRect = () => ({ left: 100, top: 200, width: 100, height: 80, right: 200, bottom: 280 });
  const viewportRects = [];
  canvasContexts.get('minimap').strokeRect = (...rect) => viewportRects.push(rect);
  const renderFrame = () => window.__frameCallback(window.performance.now() + 16);
  renderFrame();
  const before = viewportRects.at(-1);

  const wheel = new window.MouseEvent('wheel', { bubbles: true, cancelable: true, clientX: 350, clientY: 150 });
  Object.defineProperties(wheel, { deltaY: { value: -100 }, clientX: { value: 350 }, clientY: { value: 150 } });
  world.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, true);
  renderFrame();
  const after = viewportRects.at(-1);
  assert.ok(after[2] < before[2], 'zooming in narrows the visible map region');
  assert.ok(after[0] + after[2] / 2 > before[0] + before[2] / 2, `zooming near the right edge moves the camera anchor right: before=${before}, after=${after}`);
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
  assert.ok(window.document.querySelector('#battleTacticalPreview'), 'selected regiment gets a range and damage preview panel');
  assert.ok(window.document.querySelector('#battleModal .sim-in-range'), 'selected regiment range is highlighted on the battlefield');
  const field = window.document.querySelector('#battleModal .tactical-field[data-scenario]');
  assert.ok(field.style.getPropertyValue('--battle-map').includes('assets/battle_scenarios/'), 'the tactical board uses one continuous scenario landscape behind its grid');
  assert.ok(window.document.querySelector('#battleModal .battle-cell .token.token-defender'), 'enemy regiments have distinct red tactical markers');
  const holdPosition = window.document.querySelector('#battleModal [data-action="hold-position"]');
  assert.equal(holdPosition.disabled, false, 'selected archers can receive a hold-position order');
  holdPosition.click();
  assert.match(window.document.querySelector('#battleModal .unit-state').textContent, /Держит позицию/);
  assert.match(window.document.querySelector('#battleModal .battle-command-help').textContent, /Щёлкни по врагу/);
  window.document.querySelector('#battleModal [aria-label*="отряд противника"]')?.click();
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /держит позицию и обстреливает выбранную цель/);
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
  window.document.querySelector('#battleModal [data-action="pause"]').click();
  assert.match(window.document.querySelector('#battleModal [data-action="pause"]').textContent, /Продолжить/);
  window.document.querySelector('#battleModal [data-action="attack"]').click();
  assert.match(window.document.querySelector('#battleModal [data-action="pause"]').textContent, /Пауза/,
    'issuing an attack order resumes a paused fight instead of silently doing nothing');
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /симуляция возобновлена/);
  window.document.querySelector('#battleModal [aria-label*="ваш отряд"]')?.click();
  window.document.querySelector('#battleModal [data-cell-x="4"][data-cell-y="4"]')?.click();
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /приказ двигаться к выбранной клетке/);
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: siege gate integrity is shown and a selected attacker can order an assault', async (t) => {
  const seedSession = await launchGame();
  t.after(() => seedSession.window.happyDOM.abort());
  seedSession.window.document.querySelector('#saveBtn').click();
  const save = JSON.parse(seedSession.window.localStorage.getItem('crown-banner-save-v2'));
  const keep = save.structures.find(structure => structure.id === 'eastkeep');
  assert.ok(keep, 'campaign includes the hostile fortress');
  save.diplomacy[keep.faction] = { ...(save.diplomacy[keep.faction] || {}), war: true };
  for (const enemy of save.units.filter(unit => unit.enemy)) {
    enemy.x = (keep.x + 0.5) * 64;
    enemy.y = (keep.y + 0.5) * 64;
    enemy.faction = keep.faction;
  }

  const { window, errors } = await launchGame(save);
  t.after(() => window.happyDOM.abort());
  const friendly = window.document.querySelector('#armyRoster [data-roster]');
  assert.ok(friendly);
  friendly.click();
  window.document.querySelector('#battleBtn').click();
  assert.match(window.document.querySelector('#battleModal .battle-scenario-scene b').textContent, /Осада Восточной крепости/);
  const gate = window.document.querySelector('#battleModal [data-cell-x="6"][data-cell-y="2"]');
  assert.match(gate.getAttribute('aria-label'), /Ворота · 100%/);
  gate.click();
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /приказ штурмовать ворота/);
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
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /наступают на ближайшего противника/);
  window.document.querySelector('#battleModal [data-action="speed"]').click();

  let sawVisibleCasualty = false;
  let frameTime = window.performance.now();
  for (let frame = 0; frame < 1200 && !window.document.querySelector('#battleOutcome').classList.contains('show'); frame += 1) {
    const callback = window.__frameCallback;
    assert.equal(typeof callback, 'function', 'battle keeps scheduling simulation/render frames');
    callback(frameTime += 50);
    sawVisibleCasualty ||= /потерял \d+ бойцов/.test(window.document.querySelector('#battleModal .feed')?.textContent || '');
  }

  assert.equal(sawVisibleCasualty, true, 'live simulation reports casualty ticks while the battle is still being played');
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

test('browser DOM smoke: headless autobattle preserves issued orders through the JSON contract', async (t) => {
  const { window, errors } = await launchGame();
  t.after(() => window.happyDOM.abort());
  window.Math.random = () => 0.5;
  const archer = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Лучник'))
    || window.document.querySelector('#armyRoster [data-roster]');
  assert.ok(archer);
  archer.click();
  window.document.querySelector('#battleBtn').click();
  const attack = window.document.querySelector('#battleModal [data-action="attack"]');
  assert.ok(attack && !attack.disabled);
  attack.click();
  const autobattle = window.document.querySelector('#battleModal [data-action="autobattle"]');
  assert.ok(autobattle && !autobattle.disabled, 'autobattle is available while both armies have active regiments');
  autobattle.click();
  assert.equal(window.document.querySelector('#battleOutcome').classList.contains('show'), true,
    'headless simulation returns a campaign battle outcome');
  assert.equal(window.document.querySelector('#battleOverlay').classList.contains('show'), false);
  assert.match(window.document.querySelector('#battleOutcome').textContent, /Потери короны:/);
  const saved = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.ok(saved.units.some((unit) => !unit.enemy && unit.count >= 0), 'headless casualties are persisted to the campaign');
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: routed survivors leave the campaign roster and return after two saved days', async (t) => {
  const seedSession = await launchGame();
  t.after(() => seedSession.window.happyDOM.abort());
  seedSession.window.document.querySelector('#saveBtn').click();
  const save = JSON.parse(seedSession.window.localStorage.getItem('crown-banner-save-v2'));
  for (const unit of save.units) unit.count = 0;
  const crown = save.units.find((unit) => !unit.enemy && unit.cls === '03_sword_and_shield');
  const foe = save.units.find((unit) => unit.enemy && unit.cls === '03_sword_and_shield');
  assert.ok(crown && foe);
  crown.count = 10;
  crown.morale = 10;
  foe.count = 32;
  foe.morale = 100;

  const { window, errors } = await launchGame(save);
  t.after(() => window.happyDOM.abort());
  window.Math.random = () => 0.5;
  const swordsmen = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Мечник'));
  assert.ok(swordsmen);
  swordsmen.click();
  window.document.querySelector('#battleBtn').click();
  window.document.querySelector('#battleModal [data-action="autobattle"]').click();

  let saved = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.equal(saved.routedReturns.length, 1, 'surviving routed regiment is stored in the campaign return queue');
  const pending = saved.routedReturns[0];
  assert.equal(pending.enemy, false);
  assert.ok(pending.count > 0, 'routed survivors are distinguished from casualties');
  assert.equal(pending.returnTurn, saved.campaignTurn + 2);
  assert.match(window.document.querySelector('#battleOutcome').textContent, /вернутся в кампанию через 2 дня/);
  assert.equal(saved.units.some((unit) => !unit.enemy && unit.cls === pending.cls && unit.count > 0), false,
    'routed soldiers are temporarily absent from active campaign armies');

  window.document.querySelector('#endTurn').click();
  saved = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.equal(saved.routedReturns.length, 1, 'the return queue survives the first saved campaign day');
  window.happyDOM.abort();
  const resumed = await launchGame(saved);
  t.after(() => resumed.window.happyDOM.abort());
  resumed.window.document.querySelector('#endTurn').click();
  saved = JSON.parse(resumed.window.localStorage.getItem('crown-banner-save-v2'));
  assert.equal(saved.routedReturns.length, 0, 'due return entry is removed after restoration from the saved campaign');
  assert.ok(saved.units.some((unit) => !unit.enemy && unit.cls === pending.cls && unit.count === pending.count),
    'survivors rejoin the campaign roster with their remaining count');
  assert.deepEqual([...errors, ...resumed.errors], []);
});

test('browser DOM smoke: separate reinforcement waves arrive at their individual ETAs', async (t) => {
  const seedSession = await launchGame();
  t.after(() => seedSession.window.happyDOM.abort());
  seedSession.window.document.querySelector('#saveBtn').click();
  const save = JSON.parse(seedSession.window.localStorage.getItem('crown-banner-save-v2'));
  const reserve = save.units.find((unit) => !unit.enemy && unit.cls === '06_spearman_shield');
  const secondReserve = save.units.find((unit) => !unit.enemy && unit.cls === '08_cavalryman');
  assert.ok(reserve && secondReserve);
  reserve.x = 35.5 * 64;
  reserve.y = 11.5 * 64;
  secondReserve.x = 37.5 * 64;
  secondReserve.y = 11.5 * 64;
  for (const foe of save.units.filter((unit) => unit.enemy)) {
    foe.count = 500;
    foe.capacity = 500;
  }
  const { window, errors } = await launchGame(save);
  t.after(() => window.happyDOM.abort());
  const sword = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Мечник'));
  assert.ok(sword);
  sword.click();
  window.document.querySelector('#battleBtn').click();
  const gold = () => Number([...window.document.querySelectorAll('#resourceBar .res')]
    .find((item) => item.title === 'Золото')?.querySelector('b')?.textContent);
  const goldBefore = gold();
  const dispatch = (className) => {
    const input = [...window.document.querySelectorAll('#battleModal [data-reinforcement-id]')]
      .find((candidate) => candidate.closest('.reinforcement-option')?.textContent.includes(className));
    assert.ok(input, `reinforcement ${className} is offered for selection`);
    const cost = Number(input.closest('.reinforcement-option').querySelector('small').textContent.match(/(\d+) зол\./)?.[1]);
    assert.ok(cost > 0);
    input.click();
    const signal = window.document.querySelector('#battleModal [data-action="signal-reinforcements"]');
    assert.ok(signal && !signal.disabled, 'selecting a regiment enables the next signal');
    signal.click();
    return cost;
  };
  const firstCost = dispatch('Копейщик');
  assert.equal(window.document.querySelectorAll('#battleModal [data-reinforcement-id]').length, 1,
    'a dispatched regiment cannot be selected into another wave');
  const secondCost = dispatch('Кавалерист');
  assert.equal(goldBefore - gold(), firstCost + secondCost, 'each wave deducts exactly its displayed price');
  assert.match(window.document.querySelector('#battleModal .feed').textContent, /Волна 2/);

  for (let frame = 1; frame <= 48; frame += 1) window.__frameCallback(window.performance.now() + frame * 50);
  assert.ok(Number(window.document.querySelector('#battleModal').dataset.tick) >= 30);
  assert.equal(window.document.querySelector('#battleModal [data-action="signal-reinforcements"]').textContent.includes('В пути'), true,
    'the farther reserve remains in transit after the first wave arrives');
  for (let frame = 49; frame <= 100; frame += 1) window.__frameCallback(window.performance.now() + frame * 50);
  assert.match(window.document.querySelector('#battleModal [data-action="signal-reinforcements"]').textContent, /Прибыли · 2/,
    'each wave arrives at its own scheduled tick');
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: headless autobattle can continue while multiple reinforcement waves are in transit', async (t) => {
  const seedSession = await launchGame();
  t.after(() => seedSession.window.happyDOM.abort());
  seedSession.window.document.querySelector('#saveBtn').click();
  const save = JSON.parse(seedSession.window.localStorage.getItem('crown-banner-save-v2'));
  const reserve = save.units.find((unit) => !unit.enemy && unit.cls === '06_spearman_shield');
  const secondReserve = save.units.find((unit) => !unit.enemy && unit.cls === '08_cavalryman');
  assert.ok(reserve && secondReserve);
  reserve.x = 35.5 * 64;
  reserve.y = 11.5 * 64;
  secondReserve.x = 37.5 * 64;
  secondReserve.y = 11.5 * 64;
  for (const foe of save.units.filter((unit) => unit.enemy)) {
    foe.count = 300;
    foe.capacity = 300;
  }
  const { window, errors } = await launchGame(save);
  t.after(() => window.happyDOM.abort());
  const sword = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Мечник'));
  sword.click();
  window.document.querySelector('#battleBtn').click();
  const dispatch = (className) => {
    const input = [...window.document.querySelectorAll('#battleModal [data-reinforcement-id]')]
      .find((candidate) => candidate.closest('.reinforcement-option')?.textContent.includes(className));
    assert.ok(input);
    input.click();
    window.document.querySelector('#battleModal [data-action="signal-reinforcements"]').click();
  };
  dispatch('Копейщик');
  for (let frame = 1; frame <= 8; frame += 1) window.__frameCallback(window.performance.now() + frame * 50);
  const currentTick = Number(window.document.querySelector('#battleModal').dataset.tick);
  assert.ok(currentTick > 0 && currentTick < 30, `the first wave is still in transit at tick ${currentTick}`);
  dispatch('Кавалерист');
  assert.match(window.document.querySelector('#battleModal [data-action="signal-reinforcements"]').textContent, /В пути/);
  window.document.querySelector('#battleModal [data-action="autobattle"]').click();
  assert.equal(window.document.querySelector('#battleOutcome').classList.contains('show'), true,
    'headless resolution continues from the current tick with both pending ETA values');
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: headless autobattle preserves a delayed reinforcement in the result', async (t) => {
  const seedSession = await launchGame();
  t.after(() => seedSession.window.happyDOM.abort());
  seedSession.window.document.querySelector('#saveBtn').click();
  const save = JSON.parse(seedSession.window.localStorage.getItem('crown-banner-save-v2'));
  const reserve = save.units.find((unit) => !unit.enemy && unit.cls === '06_spearman_shield');
  assert.ok(reserve);
  reserve.x = 35.5 * 64;
  reserve.y = 11.5 * 64;
  reserve.count = 800;
  reserve.capacity = 800;
  for (const foe of save.units.filter((unit) => unit.enemy)) {
    foe.count = 120;
    foe.capacity = 120;
  }
  const { window, errors } = await launchGame(save);
  t.after(() => window.happyDOM.abort());
  const sword = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Мечник'));
  sword.click();
  window.document.querySelector('#battleBtn').click();
  const reserveInput = [...window.document.querySelectorAll('#battleModal [data-reinforcement-id]')]
    .find((input) => input.closest('.reinforcement-option')?.textContent.includes('Копейщик'));
  assert.ok(reserveInput);
  const reserveId = reserveInput.dataset.reinforcementId;
  reserveInput.click();
  window.document.querySelector('#battleModal [data-action="signal-reinforcements"]').click();
  window.document.querySelector('#battleModal [data-action="autobattle"]').click();
  assert.equal(window.document.querySelector('#battleOutcome').classList.contains('show'), true,
    `headless resolution completes with an in-flight reserve: ${window.document.querySelector('#toast').textContent}`);
  const result = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.ok(result.units.some((unit) => unit.cls === reserve.cls && unit.count > 0)
    || result.routedReturns.some((item) => String(item.id) === reserveId),
  'the headless result retains the reinforcement as an active or routed campaign regiment');
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: an early headless victory refunds a reserve that is still far away', async (t) => {
  const seedSession = await launchGame();
  t.after(() => seedSession.window.happyDOM.abort());
  seedSession.window.document.querySelector('#saveBtn').click();
  const save = JSON.parse(seedSession.window.localStorage.getItem('crown-banner-save-v2'));
  const sword = save.units.find((unit) => !unit.enemy && unit.cls === '03_sword_and_shield');
  const reserve = save.units.find((unit) => !unit.enemy && unit.cls === '08_cavalryman');
  assert.ok(sword && reserve);
  sword.count = 120;
  sword.capacity = 120;
  reserve.x = 43.4 * 64;
  reserve.y = 11.5 * 64;
  for (const foe of save.units.filter((unit) => unit.enemy)) {
    foe.count = 1;
    foe.capacity = 1;
  }
  const { window, errors } = await launchGame(save);
  t.after(() => window.happyDOM.abort());
  const selectedSword = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Мечник'));
  selectedSword.click();
  window.document.querySelector('#battleBtn').click();
  const reserveInput = [...window.document.querySelectorAll('#battleModal [data-reinforcement-id]')]
    .find((input) => input.closest('.reinforcement-option')?.textContent.includes('Кавалерист'));
  assert.ok(reserveInput, 'the distant reserve is still inside the signal radius');
  const reserveId = reserveInput.dataset.reinforcementId;
  const before = Number([...window.document.querySelectorAll('#resourceBar .res')]
    .find((item) => item.title === 'Золото')?.querySelector('b')?.textContent);
  reserveInput.click();
  window.document.querySelector('#battleModal [data-action="signal-reinforcements"]').click();
  window.document.querySelector('#battleModal [data-action="autobattle"]').click();
  assert.equal(window.document.querySelector('#battleOutcome').classList.contains('show'), true);
  assert.match(window.document.querySelector('#battleOutcome').textContent, /Победа/,
    'the main army wins before the distant signal ETA');
  const result = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.equal(Number(result.gold), before + 25, 'the reserve fee is refunded while the normal victory reward remains');
  assert.ok(result.units.some((unit) => unit.cls === reserve.cls && unit.count === reserve.count)
    || result.routedReturns.some((item) => String(item.id) === reserveId),
  'the reserve that did not arrive remains in the campaign');
  assert.deepEqual(errors, []);
});

test('browser DOM smoke: a retreat before the reserve ETA refunds its signal cost', async (t) => {
  const seedSession = await launchGame();
  t.after(() => seedSession.window.happyDOM.abort());
  seedSession.window.document.querySelector('#saveBtn').click();
  const save = JSON.parse(seedSession.window.localStorage.getItem('crown-banner-save-v2'));
  const reserve = save.units.find((unit) => !unit.enemy && unit.cls === '06_spearman_shield');
  assert.ok(reserve);
  reserve.x = 35.5 * 64;
  reserve.y = 11.5 * 64;
  const { window, errors } = await launchGame(save);
  t.after(() => window.happyDOM.abort());
  const sword = [...window.document.querySelectorAll('#armyRoster [data-roster]')]
    .find((button) => button.closest('.roster-card')?.textContent.includes('Мечник'));
  sword.click();
  window.document.querySelector('#battleBtn').click();
  const gold = () => Number([...window.document.querySelectorAll('#resourceBar .res')]
    .find((item) => item.title === 'Золото')?.querySelector('b')?.textContent);
  const before = gold();
  const itemCost = Number(window.document.querySelector('#battleModal .reinforcement-option small').textContent.match(/(\d+) зол\./)?.[1]);
  window.document.querySelector('#battleModal [data-reinforcement-id]').click();
  window.document.querySelector('#battleModal [data-action="signal-reinforcements"]').click();
  assert.equal(before - gold(), itemCost, 'the signal charges the listed amount');
  window.document.querySelector('#battleModal #battleExit').click();
  assert.equal(gold(), before, 'a reserve that never deployed is refunded on early retreat');
  const saved = JSON.parse(window.localStorage.getItem('crown-banner-save-v2'));
  assert.ok(saved.units.some((unit) => unit.cls === reserve.cls && unit.count === reserve.count),
    'the undeparted regiment remains in the campaign roster');
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
