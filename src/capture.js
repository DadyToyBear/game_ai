import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { gifPlan, SIZES } from './conversion.js';
import { asGifBlob, connectEncoder } from './encoder-client.js';
import { poseSampler } from './framing.js';
import { litScene, makeRenderer } from './studio.js';

function renderSession(actor, clip, camera, { size, transparent, color }) {
  const renderer = makeRenderer({ preserveDrawingBuffer: true, powerPreference: 'default' });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  if (!transparent) renderer.setClearColor(color, 1);
  const copy = clone(actor);
  const scene = litScene();
  scene.add(copy);
  // Bind tracks to the cloned FBX root, not the outer framing transform.
  const sampler = poseSampler(copy.children[0], clip);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  const bitmap = document.createElement('canvas');
  bitmap.width = bitmap.height = size;
  const ctx = bitmap.getContext('2d', { willReadFrequently: true });
  ctx.globalCompositeOperation = 'copy';

  return {
    at(time) {
      sampler.pose(time);
      renderer.render(scene, camera);
      if (renderer.getContext().isContextLost()) throw new Error('3D-контекст потерян. Попробуйте меньший размер кадра.');
      ctx.drawImage(renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, size, size).data.buffer;
    },
    dispose() {
      sampler.dispose();
      const skeletons = new Set();
      copy.traverse((node) => { if (node.skeleton) skeletons.add(node.skeleton); });
      for (const skeleton of skeletons) skeleton.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export async function renderGif({ actor, clip, camera, options, signal, onProgress }) {
  if (!SIZES.includes(options.size)) throw new Error('Некорректный размер GIF.');
  const plan = gifPlan(options);
  signal.throwIfAborted();
  let session;
  let client;
  try {
    session = renderSession(actor, clip, camera, options);
    const worker = new Worker(new URL('./gif.worker.js', import.meta.url), { type: 'module' });
    client = connectEncoder(worker, signal);
    const sampleIndexes = new Set([0, 0.25, 0.5, 0.75, 1].map((part) => Math.round((plan.length - 1) * part)));
    const samples = [...sampleIndexes].map((index) => session.at(plan[index].time));
    await client.send({ type: 'init', options, samples }, samples);
    for (const [index, { time, delay }] of plan.entries()) {
      signal.throwIfAborted();
      const buffer = session.at(time);
      await client.send({ type: 'frame', buffer, delay }, [buffer]);
      onProgress?.((index + 1) / plan.length, index + 1, plan.length);
    }
    const result = await client.send({ type: 'finish' });
    signal.throwIfAborted();
    return asGifBlob(result);
  } finally {
    client?.close();
    session?.dispose();
  }
}
