import { AnimationMixer, Box3, Group, Vector3 } from 'three';

export function poseSampler(rig, clip) {
  const mixer = new AnimationMixer(rig);
  const action = mixer.clipAction(clip).play();
  action.paused = true;
  return {
    pose(time) {
      // A zero-delta update samples precise positions without wrapping the last key.
      action.time = Math.min(clip.duration, Math.max(0, time));
      mixer.update(0);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig);
    },
  };
}

export function drawableMeshes(model) {
  const meshes = [];
  model.traverseVisible((node) => {
    if (node.isMesh && node.geometry.getAttribute('position')?.count >= 3) meshes.push(node);
  });
  return meshes;
}

const finitePoint = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const finiteBounds = (box) => !box.isEmpty() && finitePoint(box.min) && finitePoint(box.max);

function meshBounds(root, meshes, target) {
  target.makeEmpty();
  root.updateMatrixWorld(true);
  const scratch = new Box3();
  const vertex = new Vector3();
  for (const mesh of meshes) {
    if (!mesh.isSkinnedMesh && !mesh.morphTargetInfluences?.length) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      scratch.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      if (finiteBounds(scratch)) target.union(scratch);
      continue;
    }
    const count = mesh.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
      if (finitePoint(vertex)) target.expandByPoint(vertex);
    }
  }
  return target;
}

export function normalizeActor(model, meshes = drawableMeshes(model)) {
  if (!meshes.length) throw new Error('В FBX нет видимого меша (геометрии персонажа).');
  model.traverse((node) => {
    if (node.isLight) node.intensity = 0;
  });
  let vertexCount = 0;
  const materials = new Set();
  for (const mesh of meshes) {
    vertexCount += mesh.geometry.getAttribute('position').count;
    if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
    for (const material of [mesh.material].flat()) if (material) materials.add(material);
  }

  const restoredVisibility = materials.size > 0 && [...materials].every((m) => !m.visible || m.opacity <= 0.001);
  if (restoredVisibility) {
    // A common FBX material export mistake makes the whole actor transparent.
    // Preserve textures and make the geometry visible rather than a blank stage.
    for (const material of materials) {
      material.visible = true;
      material.opacity = 1;
      material.transparent = false;
      material.alphaTest = 0;
      material.needsUpdate = true;
    }
  }

  const bounds = meshBounds(model, meshes, new Box3());
  const origin = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (!finiteBounds(bounds) || !Number.isFinite(extent) || extent <= 0) throw new Error('Не удалось определить размеры меша. Проверьте геометрию и скелет в исходной модели.');
  const scale = Math.min(2.3 / Math.max(size.y, extent * 0.001), 3.1 / extent);
  const actor = new Group();
  actor.scale.setScalar(scale);
  actor.position.set(-origin.x * scale, -bounds.min.y * scale, -origin.z * scale);
  actor.add(model);
  actor.updateMatrix();
  return { actor, rig: model, vertexCount, meshes, bounds: bounds.applyMatrix4(actor.matrix), restoredVisibility };
}

export function motionBounds(actor, vertexCount, sampler, range, meshes = drawableMeshes(actor), fallback) {
  if (!sampler) return fallback?.clone() ?? meshBounds(actor, meshes, new Box3());
  const bounds = new Box3();
  const scratch = new Box3();
  const samples = Math.max(3, Math.min(10, Math.floor(800_000 / vertexCount)));
  for (let i = 0; i < samples; i++) {
    sampler.pose(range.from + (range.to - range.from) * i / (samples - 1));
    meshBounds(actor, meshes, scratch);
    if (finiteBounds(scratch)) bounds.union(scratch);
  }
  return finiteBounds(bounds) ? bounds : (fallback?.clone() ?? bounds);
}

export function fitDistance(bounds, direction, fov, aspect = 1, fill = 0.83) {
  const center = bounds.getCenter(new Vector3());
  const right = new Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right);
  const aperture = Math.tan(fov * Math.PI / 360) * fill;
  const point = new Vector3();
  let distance = 0.1;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        point.set(x, y, z).sub(center);
        distance = Math.max(distance, point.dot(direction) + Math.max(
          Math.abs(point.dot(right)) / (aperture * aspect), Math.abs(point.dot(up)) / aperture,
        ));
      }
    }
  }
  return { center, distance };
}
