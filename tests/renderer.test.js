import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, NumberKeyframeTrack, AnimationClip, PerspectiveCamera, Vector3 } from 'three';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { normalizeActor, fitDistance, motionBounds, poseSampler } from '../src/framing.js';
import { makeGifEncoder } from '../src/gif-encoder.js';
import { splitUpload } from '../src/fbx.js';
import { MAX_FBX_SIZE } from '../src/conversion.js';

test('the clip sampler seeks to exact times, and framing includes the root motion', () => {
  const root = new Group();
  const child = new Mesh(new BoxGeometry(1, 2, 1));
  child.name = 'character';
  root.add(child);
  const clip = new AnimationClip('Walk', 2, [new NumberKeyframeTrack('character.position[x]', [0, 2], [0, 3])]);
  const { actor, rig, vertexCount } = normalizeActor(root);
  const sampler = poseSampler(rig, clip);
  sampler.pose(2);
  assert.equal(child.position.x, 3);
  sampler.pose(1);
  assert.equal(child.position.x, 1.5);
  const bounds = motionBounds(actor, vertexCount, sampler, { from: 0, to: 2 });
  assert.ok(bounds.max.x - bounds.min.x > 4);
  sampler.dispose();
  assert.equal(child.position.x, 0);
});

test('a static preview frames the visible geometry rather than distant helpers', () => {
  const root = new Group();
  const body = new Mesh(new BoxGeometry(1, 2, 1));
  const hidden = new Mesh(new BoxGeometry(1, 1, 1));
  hidden.visible = false;
  hidden.position.x = 5000;
  const camera = new PerspectiveCamera();
  camera.position.y = 6000;
  root.add(body, hidden, camera);
  const { actor, bounds, meshes, vertexCount } = normalizeActor(root);
  assert.deepEqual(meshes, [body]);
  assert.ok(Math.abs(bounds.getSize(new Vector3()).y - 2.3) < 0.00001);
  assert.deepEqual(motionBounds(actor, vertexCount, null, null, meshes, bounds), bounds);
});

test('make an entirely invisible model viewable without overriding other transparency', () => {
  const root = new Group();
  const material = new MeshBasicMaterial({ opacity: 0, transparent: true });
  root.add(new Mesh(new BoxGeometry(), material));
  assert.equal(normalizeActor(root).restoredVisibility, true);
  assert.equal(material.opacity, 1);
  assert.equal(material.transparent, false);

  const partial = new Group();
  const glass = new MeshBasicMaterial({ opacity: 0.5, transparent: true });
  partial.add(new Mesh(new BoxGeometry(), glass));
  assert.equal(normalizeActor(partial).restoredVisibility, false);
  assert.equal(glass.opacity, 0.5);
  assert.equal(glass.transparent, true);
});

test('the automatically framed square fits an oriented animated extent', () => {
  const bounds = new Box3(new Vector3(-1, 0, -0.4), new Vector3(1, 2, 0.4));
  const direction = new Vector3(0.4, 0.2, 1).normalize();
  const fov = 34;
  const { center, distance } = fitDistance(bounds, direction, fov, 1);
  const camera = new PerspectiveCamera(fov, 1);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const p = new Vector3(x, y, z).project(camera);
        assert.ok(Math.max(Math.abs(p.x), Math.abs(p.y)) < 0.84);
      }
    }
  }
});

for (const transparent of [true, false]) {
  test(`the encoder writes correct delays and ${transparent ? 'transparent' : 'opaque'} frames`, () => {
    const frame = (color) => Uint8Array.of(12, 20, 30, 0, ...color, 255, ...color, 255, 50, 60, 70, 255).buffer;
    const a = frame([230, 130, 41]);
    const b = frame([22, 190, 100]);
    const writer = makeGifEncoder({ size: 2, transparent, loop: transparent }, [a, b]);
    writer.addFrame(a, 40);
    writer.addFrame(b, 60);
    const gif = parseGIF(writer.finish().buffer);
    const frames = decompressFrames(gif, true);
    assert.equal(gif.lsd.width, 2);
    assert.deepEqual(frames.map(({ delay }) => delay), [40, 60]);
    assert.notDeepEqual(frames[0].patch, frames[1].patch);
    assert.equal(frames[0].patch[3], transparent ? 0 : 255);
    assert.equal(frames[0].disposalType, transparent ? 2 : 1);
  });
}

test('uploads must contain one nonempty FBX inside the size limit, with optional local textures', () => {
  const fbx = { name: 'Actor.FBX', size: 200 };
  const image = { name: 'Texture.PNG', size: 20 };
  assert.deepEqual(splitUpload([fbx, image]), { file: fbx, textures: [image] });
  assert.throws(() => splitUpload([image]), /один файл/);
  assert.throws(() => splitUpload([fbx, fbx]), /один файл/);
  assert.throws(() => splitUpload([{ ...fbx, size: 0 }]), /пуст/);
  assert.throws(() => splitUpload([{ ...fbx, size: MAX_FBX_SIZE + 1 }]), /80 МБ/);
});
