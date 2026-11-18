import { LoadingManager } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MAX_FBX_SIZE } from './conversion.js';
import { drawableMeshes, normalizeActor } from './framing.js';
import { binaryVersion, normalizeAsciiFbx, normalizeBooleanTags } from './fbx-compat.js';
import { modelMotionNodes, playableClips } from './motion.js';

const fallback = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"%3E%3Cpath fill="white" d="M0 0h1v1H0z"/%3E%3C/svg%3E';
const textureFile = /\.(?:png|jpe?g|webp|bmp)$/i;

export function splitUpload(files) {
  const models = [...files].filter((file) => /\.fbx$/i.test(file.name));
  if (models.length !== 1) throw new Error('Выберите один файл .fbx. Текстуры PNG, JPG или WebP можно добавить вместе с ним.');
  if (!models[0].size) throw new Error('Файл FBX пуст.');
  if (models[0].size > MAX_FBX_SIZE) throw new Error('Файл больше 80 МБ. Уменьшите его размер и попробуйте снова.');
  const textures = [...files].filter(({ name }) => textureFile.test(name));
  if (textures.reduce((total, file) => total + file.size, 0) > MAX_FBX_SIZE) {
    throw new Error('Внешние текстуры должны занимать не больше 80 МБ суммарно.');
  }
  return { file: models[0], textures };
}

function filename(reference) {
  const leaf = reference.replaceAll('\\', '/').split('/').at(-1).split(/[?#]/, 1)[0];
  try { return decodeURIComponent(leaf); } catch { return leaf; }
}

export function disposeModel(root) {
  const materials = new Set(), geometries = new Set(), textures = new Set(), skeletons = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    if (node.skeleton) skeletons.add(node.skeleton);
    if (node.material) for (const material of [node.material].flat()) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const item of [...geometries, ...textures, ...skeletons]) item.dispose();
}

async function waitForImages(ready) {
  let timer;
  try {
    return await Promise.race([
      ready.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), 8_000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function readScene(loader, buffer) {
  try {
    return loader.parse(buffer, '');
  } catch (original) {
    if (binaryVersion(buffer) !== null) {
      if (/Unknown property type B$/.test(original.message) && normalizeBooleanTags(buffer)) return loader.parse(buffer, '');
    } else if (!/version not supported/i.test(original.message)) {
      const ascii = normalizeAsciiFbx(buffer);
      if (ascii !== buffer) return loader.parse(ascii, '');
    }
    throw original;
  }
}

export async function parseModel(buffer, name, textures = []) {
  const manager = new LoadingManager();
  const files = new Map(textures.map((file) => [file.name.toLowerCase(), file]));
  const urls = new Set();
  const textureURLs = new Map();
  const missing = new Set();
  const imagesReady = new Promise((resolve) => { manager.onLoad = resolve; });
  manager.onError = (url) => missing.add(textureURLs.get(url) ?? 'встроенное изображение');
  manager.setURLModifier((reference) => {
    if (reference.startsWith('blob:')) {
      urls.add(reference);
      return reference;
    }
    if (/^data:image\/(?:png|jpeg|webp|bmp);/i.test(reference)) return reference;
    const leaf = filename(reference);
    const supplied = files.get(leaf.toLowerCase());
    if (supplied) {
      const url = URL.createObjectURL(supplied);
      urls.add(url);
      textureURLs.set(url, leaf);
      return url;
    }
    // Never request a remote URL or a path from the FBX author's machine.
    missing.add(leaf || 'изображение');
    return fallback;
  });

  let model;
  try {
    manager.itemStart('fbx-parse');
    try {
      model = readScene(new FBXLoader(manager), buffer);
    } catch (error) {
      const reason = /version not supported/i.test(error.message) ? 'Версия этого FBX не поддерживается.'
        : /Unknown format|Cannot find the version number/i.test(error.message) ? 'Файл не распознан как FBX.' : 'Не удалось прочитать структуру FBX.';
      throw new Error(`${reason} Попробуйте заново экспортировать модель как FBX Binary 7.x.`, { cause: error });
    } finally {
      manager.itemEnd('fbx-parse');
    }
    const texturesReady = await waitForImages(imagesReady);

    const raw = model.animations ?? [];
    const meshes = drawableMeshes(model);
    if (!meshes.length) {
      const instruction = 'Экспортируйте модель вместе с мешем и анимацией (With Skin).';
      throw new Error(playableClips(model, raw).length
        ? `В FBX есть движение, но нет видимого меша. ${instruction}`
        : `В FBX нет видимого меша и клипов с движением. ${instruction}`);
    }

    const normalized = normalizeActor(model, meshes);
    const clips = playableClips(model, raw, modelMotionNodes(meshes));
    model.animations = clips;
    return {
      ...normalized, name, clips, rawClipCount: raw.length,
      bytes: buffer.byteLength, missing: [...missing], texturesReady,
    };
  } catch (error) {
    if (model) disposeModel(model);
    throw error;
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
