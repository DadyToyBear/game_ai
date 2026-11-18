import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, clipRange, exportName, frameCount, gifPlan, MAX_FRAMES, timecode } from '../src/conversion.js';

test('GIF delays use centiseconds but preserve the time of a trimmed 24 fps clip', () => {
  const plan = gifPlan({ from: 0.25, to: 2.25, fps: 24, loop: true });
  assert.equal(plan.length, 48);
  assert.equal(plan[0].time, 0.25);
  assert.ok(plan.at(-1).time < 2.25);
  assert.ok(plan.every(({ delay }) => delay === 40 || delay === 50));
  assert.equal(plan.reduce((total, { delay }) => total + delay, 0), 2000);
});

test('a one-shot ends on its final pose and an extremely short clip still renders a frame', () => {
  const plan = gifPlan({ from: 0.4, to: 0.9, fps: 10, loop: false });
  assert.equal(plan.at(-1).time, 0.9);
  assert.deepEqual(gifPlan({ from: 0, to: 0.01, fps: 20, loop: false }), [{ time: 0, delay: 20 }]);
  assert.equal(frameCount(1.067, 20), 21);
});

test('trim bounds clamp invalid values, never collapse, and keep the edited endpoint within the clip', () => {
  assert.deepEqual(clipRange(2, -1, 6), { from: 0, to: 2 });
  assert.deepEqual(clipRange(2, Number.NaN, Number.NaN), { from: 0, to: 2 });
  assert.deepEqual(clipRange(2, 0.8, 1.3), { from: 0.8, to: 1.3 });
  const repaired = clipRange(2, 1.5, 0.5, 'start');
  assert.equal(repaired.to, 0.5);
  assert.ok(repaired.from < repaired.to);
  assert.deepEqual(clipRange(0.02, 2, -3), { from: 0, to: 0.02 });
});

test('export capacity, file name, and timeline formatting', () => {
  assert.throws(() => gifPlan({ from: 0, to: 20, fps: 30, loop: true }), new RegExp(String(MAX_FRAMES)));
  assert.throws(() => gifPlan({ from: 0, to: 0, fps: 30, loop: true }));
  assert.equal(exportName('Воин 01.FBX', 'Take|Stand'), 'voin-01-take-stand.gif');
  assert.equal(exportName(' model!?.fbx', ''), 'model-clip.gif');
  assert.equal(timecode(75.25), '01:15.3');
});

test('playback wraps within the selected range or stops at its end', () => {
  assert.deepEqual(advance(1.75, 0.25, { from: 1, to: 2 }, true), { time: 1, ended: false });
  assert.deepEqual(advance(1.75, 0.50, { from: 1, to: 2 }, true), { time: 1.25, ended: false });
  assert.deepEqual(advance(1.75, 0.25, { from: 1, to: 2 }, false), { time: 2, ended: true });
});
