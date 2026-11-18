import { AnimationClip, PropertyBinding } from 'three';

export function modelMotionNodes(meshes) {
  const nodes = new Set();
  function include(node) {
    for (let current = node; current && !nodes.has(current); current = current.parent) nodes.add(current);
  }
  for (const mesh of meshes) {
    include(mesh);
    for (const bone of mesh.skeleton?.bones ?? []) include(bone);
  }
  return nodes;
}

function nodeLookup(root) {
  const cache = new Map();
  return (track) => {
    try {
      const { nodeName, objectName, propertyName, propertyIndex } = PropertyBinding.parseTrackName(track.name);
      if (objectName) return null;
      if (!cache.has(nodeName)) cache.set(nodeName, PropertyBinding.findNode(root, nodeName));
      const node = cache.get(nodeName);
      const property = node?.[propertyName];
      if (!node || node.isCamera || node.isLight || property === undefined) return null;
      if (propertyIndex !== undefined && property[propertyIndex] === undefined) {
        const morph = propertyName === 'morphTargetInfluences' && node.morphTargetDictionary?.[propertyIndex];
        if (!Number.isInteger(morph) || property[morph] === undefined) return null;
      }
      return node;
    } catch {
      return null;
    }
  };
}

function usableTrack(track) {
  const size = track.getValueSize();
  if (!Number.isInteger(size) || size < 1) return false;
  let prior = -Infinity;
  for (const time of track.times) {
    if (!Number.isFinite(time) || time < prior) return false;
    prior = time;
  }
  return track.values.every(Number.isFinite);
}

function changesPose(track) {
  if (track.times.length < 2 || track.times.at(-1) <= track.times[0]) return false;
  const values = track.values;
  const size = track.getValueSize();
  for (let offset = size; offset < values.length; offset += size) {
    if (track.ValueTypeName === 'quaternion') {
      // q and -q encode the same orientation.
      let same = 0, opposite = 0;
      for (let j = 0; j < 4; j++) {
        same += (values[offset + j] - values[j]) ** 2;
        opposite += (values[offset + j] + values[j]) ** 2;
      }
      if (Math.min(same, opposite) > 1e-12) return true;
    } else {
      for (let j = 0; j < size; j++) if (values[offset + j] !== values[j]) return true;
    }
  }
  return false;
}

function tracksFor(raw, lookup, allowed) {
  return raw.tracks.flatMap((track) => {
    const node = lookup(track);
    if (!node || (allowed && !allowed.has(node)) || !usableTrack(track)) return [];
    return [{ track, node, moves: changesPose(track) }];
  });
}

function buildClip(raw, tracks) {
  let from = Infinity;
  let to = -Infinity;
  for (const { track, moves } of tracks) {
    if (!moves) continue;
    from = Math.min(from, track.times[0]);
    to = Math.max(to, track.times.at(-1));
  }
  if (!(to > from) || !Number.isFinite(to - from)) return null;
  // FBX takes can retain the absolute positions of their keys on the authoring
  // timeline. Rebase on the first key of the moving tracks, not the scene's 0.
  const relative = tracks.map(({ track }) => track.clone().shift(-from));
  return new AnimationClip(raw.name, to - from, relative, raw.blendMode).optimize();
}

export function playableClips(root, animations, nodes) {
  const lookup = nodeLookup(root);
  return animations.flatMap((raw) => buildClip(raw, tracksFor(raw, lookup, nodes)) ?? []);
}
