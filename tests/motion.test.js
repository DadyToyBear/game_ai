import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, Bone, Group, Mesh, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { modelMotionNodes, playableClips } from '../src/motion.js';
import { poseSampler } from '../src/framing.js';

function scene() {
  const root = new Group();
  const parent = new Group();
  parent.name = 'actor';
  const mesh = new Mesh();
  mesh.name = 'body';
  const helper = new Bone();
  helper.name = 'unused';
  parent.add(mesh);
  root.add(parent, helper);
  return { root, parent, mesh, nodes: modelMotionNodes([mesh]) };
}

test('rebasing keeps relative offsets and constant pose tracks without extending the take', () => {
  const { root, parent, mesh, nodes } = scene();
  const tracks = [
    new NumberKeyframeTrack('body.position[x]', [-2, 1], [0, 3]),
    new NumberKeyframeTrack('actor.position[z]', [0, 1], [0, 2]),
    new NumberKeyframeTrack('body.position[y]', [-5, 6], [3, 3]),
  ];
  const raw = new AnimationClip('Action', -1, tracks);
  const [clip] = playableClips(root, [raw], nodes);
  assert.equal(clip.duration, 3);
  assert.deepEqual(clip.tracks.map((track) => track.times[0]), [0, 2, -3]);
  assert.equal(raw.tracks[0].times[0], -2);
  const sampler = poseSampler(root, clip);
  sampler.pose(1);
  assert.deepEqual(mesh.position.toArray(), [1, 3, 0]);
  assert.equal(parent.position.z, 0);
  sampler.pose(2.5);
  assert.deepEqual(mesh.position.toArray(), [2.5, 3, 0]);
  assert.equal(parent.position.z, 1);
  sampler.dispose();
});

test('tracks with no visible target, invalid keys, or only a constant pose do not create playable clips', () => {
  const { root, nodes } = scene();
  const raw = new AnimationClip('No usable movement', -1, [
    new VectorKeyframeTrack('missing.position', [1, 2], [0, 0, 0, 1, 0, 0]),
    new NumberKeyframeTrack('unused.position[x]', [0, 1], [0, 1]),
    new NumberKeyframeTrack('body.position[y]', [0, 1], [0, NaN]),
    new VectorKeyframeTrack('body.badProperty', [0, 1], [0, 0, 0, 1, 1, 1]),
    new QuaternionKeyframeTrack('body.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, -1]),
  ]);
  assert.deepEqual(playableClips(root, [raw], nodes), []);
});

test('a usable morph track survives validation and can be sampled', () => {
  const { root, mesh, nodes } = scene();
  mesh.morphTargetDictionary = { Smile: 0 };
  mesh.morphTargetInfluences = [0];
  const raw = new AnimationClip('Smile', -1, [
    new NumberKeyframeTrack('body.morphTargetInfluences[Smile]', [2, 4], [0, 1]),
    new NumberKeyframeTrack('body.morphTargetInfluences[Unknown]', [0, 8], [0, 1]),
  ]);
  const [clip] = playableClips(root, [raw], nodes);
  assert.equal(clip.duration, 2);
  assert.equal(clip.tracks.length, 1);
  const sampler = poseSampler(root, clip);
  sampler.pose(1);
  assert.equal(mesh.morphTargetInfluences[0], 0.5);
  sampler.dispose();
});
