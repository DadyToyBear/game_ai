import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const files = [
  ['browser game', new URL('../viewer/game.html', import.meta.url)],
  ['packaged runtime', new URL('../build/_game_runtime.js', import.meta.url)],
].filter(([, url]) => existsSync(url));
const sources = files.map(([name, url]) => [name, readFileSync(url, 'utf8')]);
const functionNames = ['combatReadiness', 'formationAttack', 'formationDefense', 'combatDefensePenalty'];
const nextNames = ['formationAttack', 'formationDefense', 'combatDefensePenalty', 'atFriendlySettlement'];

function combatFunctions(source) {
  const declarations = functionNames.map((name, index) => {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${nextNames[index]}(`, start);
    assert.notEqual(start, -1, `runtime has ${name}`);
    assert.notEqual(end, -1, `runtime has following function ${nextNames[index]}`);
    return source.slice(start, end).trim();
  });
  const context = {};
  vm.runInNewContext(`${declarations.join('\n')}\nglobalThis.combat = { combatReadiness, formationAttack, formationDefense, combatDefensePenalty };`, context);
  return context.combat;
}

for (const [label, source] of sources) {
  test(`${label}: readiness effects are bounded and ordered`, () => {
    const { combatReadiness } = combatFunctions(source);
    const ready = combatReadiness({ morale: 70, fatigue: 0, illDays: 0 });
    const tired = combatReadiness({ morale: 70, fatigue: 70, illDays: 0 });
    const ill = combatReadiness({ morale: 70, fatigue: 70, illDays: 3 });
    const worst = combatReadiness({ morale: 0, fatigue: 100, illDays: 3 });
    const best = combatReadiness({ morale: 100, fatigue: 0, illDays: 0 });

    assert.ok(Math.abs(ready - 0.995) < 1e-9);
    assert.ok(tired < ready);
    assert.ok(ill < tired);
    assert.equal(worst, 0.55, 'the hard floor prevents a troop from becoming unusable');
    assert.equal(best, 1.1, 'readiness is capped above base strength');
  });

  test(`${label}: formations trade attack for defense as documented`, () => {
    const { formationAttack, formationDefense } = combatFunctions(source);
    const infantry = { cls: '03_sword_and_shield', formation: 'line' };
    const cavalry = { cls: '08_cavalryman', formation: 'wedge' };

    assert.equal(formationAttack(infantry), 0);
    assert.equal(formationDefense(infantry), 0);
    assert.equal(formationAttack({ ...infantry, formation: 'shieldwall' }), -0.12);
    assert.equal(formationDefense({ ...infantry, formation: 'shieldwall' }), 0.15);
    assert.equal(formationAttack(cavalry), 0.2);
    assert.equal(formationDefense(cavalry), -0.05);
  });

  test(`${label}: morale, fatigue, and sickness defense penalties stay within limits`, () => {
    const { combatDefensePenalty } = combatFunctions(source);
    const rested = combatDefensePenalty({ morale: 100, fatigue: 0, illDays: 0 });
    const exhausted = combatDefensePenalty({ morale: 0, fatigue: 100, illDays: 0 });
    const sickAndExhausted = combatDefensePenalty({ morale: 0, fatigue: 100, illDays: 3 });

    assert.equal(rested, -0.1, 'high morale gives a modest defensive benefit');
    assert.equal(exhausted, 0.24, 'maximum penalties are capped');
    assert.equal(sickAndExhausted, 0.24, 'stacked penalties cannot exceed the cap');
  });
}
