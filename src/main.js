import '@fontsource-variable/manrope';
import '@fontsource/cormorant-garamond/cyrillic-600.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/ibm-plex-mono/cyrillic-400.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './style.css';
import { advance, clipRange, exportName, fileSize, frameCount, MAX_FRAMES, number, quantity, timecode } from './conversion.js';
import { disposeModel, parseModel, splitUpload } from './fbx.js';
import { motionBounds, poseSampler } from './framing.js';
import { icon } from './icons.js';
import { createStudio } from './studio.js';

const DEMO_NAME = 'skeleton-warrior.fbx';
const demoNames = new Map([
  ['Idle', 'Стойка'], ['Walking_A', 'Ходьба'], ['Running_A', 'Бег'],
  ['1H_Melee_Attack_Chop', 'Удар'], ['Block', 'Блок'], ['Death_A', 'Гибель'], ['Cheer', 'Победа'],
]);
const byId = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'viewport', 'stage-surface', 'scene-message', 'stage-caption', 'reframe', 'fullscreen', 'seek', 'time-now', 'time-end',
  'play', 'restart', 'loop', 'speed', 'angle', 'file', 'upload', 'demo', 'asset-line', 'asset-name', 'asset-meta', 'demo-tag',
  'import-notice', 'clip', 'size', 'fps', 'trim', 'trim-start', 'trim-end', 'trim-label', 'transparent', 'color-wrap',
  'background', 'export', 'export-label', 'export-detail', 'export-announcement', 'progress-line', 'progress', 'cancel',
  'result', 'result-label', 'result-image', 'result-name', 'save-result', 'save-previous', 'open-result',
].map((key) => [key, byId(key)]));
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const pipeline = [...document.querySelectorAll('.pipeline li')];
const iconSizes = { 'arrow-right': 40, 'arrow-up-right': 16, 'chevron-down': 14, cube: 15, layers: 15, mouse: 15, lock: 14, scissors: 15, check: 16 };
for (const target of document.querySelectorAll('[data-icon]')) target.innerHTML = icon(target.dataset.icon, iconSizes[target.dataset.icon]);

const state = {
  model: null, clip: null, sampler: null, range: { from: 0, to: 0 }, bounds: null,
  time: 0, playing: false, loop: true, speed: 1, loading: false, job: null, result: null, outputRevision: 0,
};
let studio;
let gpuReady = true;
let resumeAfterContextLoss = false;
let lastTick = 0;
let raf = 0;
let exportError = '';

function requestDraw() {
  if (!raf) raf = requestAnimationFrame(tick);
}

function tick(now) {
  raf = 0;
  if (state.playing) {
    const delta = lastTick ? Math.min(0.10, (now - lastTick) / 1000) : 0;
    lastTick = now;
    const { time, ended } = advance(state.time, delta * state.speed, state.range, state.loop);
    setTime(time);
    if (ended) setPlaying(false);
  }
  studio?.draw();
  if (state.playing) requestDraw();
}

function setPlaying(playing) {
  state.playing = Boolean(playing && gpuReady && state.clip && !state.loading);
  lastTick = 0;
  const label = state.playing ? 'Пауза' : 'Воспроизвести';
  el.play.innerHTML = icon(state.playing ? 'pause' : 'play', 17);
  el.play.setAttribute('aria-label', label);
  el.play.title = `${label} (Пробел)`;
  if (state.playing) requestDraw();
}

function syncTimeline() {
  const { from, to } = state.range;
  const position = to > from ? (state.time - from) / (to - from) : 0;
  const stamp = timecode(state.time);
  el.seek.value = String(state.time);
  el.seek.style.setProperty('--progress', `${position * 100}%`);
  if (el['time-now'].textContent !== stamp) {
    el['time-now'].textContent = stamp;
    el.seek.setAttribute('aria-valuetext', `${number(state.time, 2)} секунды`);
  }
}

function setTime(time) {
  state.time = time;
  state.sampler?.pose(time);
  studio?.invalidate();
  syncTimeline();
}

function togglePlay() {
  if (el.play.disabled) return;
  if (state.playing) setPlaying(false);
  else {
    if (state.time >= state.range.to) setTime(state.range.from);
    setPlaying(true);
  }
}

function clipLabel(clip, index) {
  const name = clip.name?.trim() || `Клип ${index + 1}`;
  return state.model?.demo ? demoNames.get(name) ?? name : name;
}

function showSceneMessage(message, busy = false) {
  el['scene-message'].textContent = message;
  el['scene-message'].hidden = !message;
  el.viewport.setAttribute('aria-busy', String(busy));
}

function showImportNotice(text, kind = 'error') {
  el['import-notice'].textContent = text;
  el['import-notice'].dataset.kind = kind;
  el['import-notice'].hidden = !text;
}

function options() {
  return {
    ...state.range, size: Number(el.size.value), fps: Number(el.fps.value), transparent: el.transparent.checked,
    color: el.background.value, loop: state.loop,
  };
}

function currentResult() {
  return state.result?.revision === state.outputRevision;
}

function syncControls() {
  const modelAvailable = Boolean(studio && gpuReady && state.model && !state.loading);
  const available = modelAvailable && Boolean(state.clip);
  const exporting = Boolean(state.job);
  const { size, fps, from, to, transparent } = options();
  const count = available ? frameCount(to - from, fps) : 0;
  const tooLong = count > MAX_FRAMES;
  for (const key of ['seek', 'play', 'restart', 'loop', 'speed']) el[key].disabled = !available;
  for (const key of ['angle', 'reframe']) el[key].disabled = !modelAvailable;
  for (const key of ['clip', 'trim-start', 'trim-end']) el[key].disabled = !available || exporting;
  el.trim.hidden = Boolean(state.model && !state.clip);
  for (const key of ['size', 'fps', 'transparent', 'background']) el[key].disabled = exporting;
  el.upload.disabled = !studio || !gpuReady || state.loading || exporting;
  el.demo.disabled = el.upload.disabled;
  el.demo.hidden = Boolean(state.model?.demo);
  const canSaveCurrent = currentResult() && !exporting;
  el.export.disabled = !available || exporting || tooLong;
  el.export.hidden = canSaveCurrent;
  el['save-result'].hidden = !canSaveCurrent;
  el['save-previous'].hidden = !state.result || canSaveCurrent;
  el['progress-line'].hidden = !exporting;
  el.export.setAttribute('aria-busy', String(exporting));
  if (!exporting) el['export-label'].textContent = 'Создать GIF';
  if (state.result) {
    const label = `${currentResult() ? 'GIF готов' : 'Последний GIF'} · ${state.result.sizeLabel}`;
    if (el['result-label'].textContent !== label) el['result-label'].textContent = label;
  }
  const detail = el['export-detail'];
  const missingClip = modelAvailable && !state.clip;
  detail.dataset.warning = String(tooLong || missingClip || Boolean(exportError));
  detail.textContent = exportError || (missingClip ? 'Для GIF нужен клип с движением.' : tooLong
    ? `${count} кадров · не более ${MAX_FRAMES}. Снизьте частоту или обрежьте клип.`
    : `${size} × ${size} px · ${available ? `${count} ${quantity(count, ['кадр', 'кадра', 'кадров'])} · ` : ''}${transparent ? 'Прозрачный фон' : 'Цветной фон'}`);
  const currentStep = state.loading || !state.model ? 0 : exporting || canSaveCurrent ? 2 : 1;
  pipeline.forEach((step, index) => {
    if (index === currentStep) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
}

function setRange(range) {
  state.range = range;
  const trimmed = range.from > 0 || Math.abs(range.to - state.clip.duration) > 0.0001;
  el['trim-start'].max = state.clip.duration;
  el['trim-end'].max = state.clip.duration;
  el['trim-start'].value = Number(range.from.toFixed(3));
  el['trim-end'].value = Number(range.to.toFixed(3));
  el['trim-label'].textContent = trimmed ? `${number(range.from, 2)}–${number(range.to, 2)} с` : 'Весь клип';
  el.seek.min = range.from;
  el.seek.max = range.to;
  el['time-end'].textContent = timecode(range.to);
  setTime(Math.max(range.from, Math.min(range.to, state.time)));
  syncControls();
}

function outputChanged(sync = false) {
  const refresh = currentResult() || Boolean(exportError);
  state.outputRevision++;
  exportError = '';
  if (sync && refresh) syncControls();
}

function publishResult(blob, name, revision) {
  const previous = state.result;
  const url = URL.createObjectURL(blob);
  state.result = { url, revision, sizeLabel: fileSize(blob.size) };
  for (const target of [el['save-result'], el['save-previous']]) {
    target.href = url;
    target.download = name;
  }
  el['open-result'].href = url;
  el['result-image'].src = url;
  el['result-name'].textContent = name;
  el['result-name'].title = name;
  el.result.hidden = false;
  el['export-announcement'].textContent = 'GIF готов. Скачайте файл отдельной кнопкой.';
  // A browser may still be opening or saving the old URL. Revoke it later,
  // not on a change of settings or immediately after a save click.
  if (previous) setTimeout(() => URL.revokeObjectURL(previous.url), 30_000);
}

function measureBounds() {
  const { actor, vertexCount, meshes, bounds } = state.model;
  return motionBounds(actor, vertexCount, state.sampler, state.range, meshes, bounds);
}

function selectClip(index) {
  const clip = state.model?.clips[index];
  if (!clip) return;
  outputChanged();
  state.sampler?.dispose();
  state.clip = clip;
  state.sampler = poseSampler(state.model.rig, clip);
  state.time = 0;
  setRange(clipRange(clip.duration));
  state.bounds = measureBounds();
  setTime(state.range.from);
  studio.frame(state.bounds, el.angle.value);
  el['stage-surface'].setAttribute('aria-label', `3D предпросмотр: ${state.model.name}, ${clipLabel(clip, index)}`);
  setPlaying(true);
}

function showStaticModel() {
  outputChanged();
  state.sampler = null;
  state.clip = null;
  state.range = { from: 0, to: 0 };
  state.bounds = state.model.bounds.clone();
  el.seek.min = 0;
  el.seek.max = 1;
  el['time-end'].textContent = timecode(0);
  el['trim-label'].textContent = 'Нет клипа';
  el['trim-start'].value = 0;
  el['trim-end'].value = 0;
  setTime(0);
  studio.frame(state.bounds, el.angle.value);
  el['stage-surface'].setAttribute('aria-label', `3D предпросмотр: ${state.model.name}, исходная поза`);
  setPlaying(false);
}

function showAsset(model) {
  el['asset-line'].hidden = false;
  el['asset-name'].textContent = model.name;
  el['asset-name'].title = model.name;
  const motion = model.clips.length ? `${model.clips.length} ${quantity(model.clips.length, ['клип', 'клипа', 'клипов'])}` : 'Исходная поза';
  el['asset-meta'].textContent = `${fileSize(model.bytes)} · ${motion}`;
  el['demo-tag'].hidden = !model.demo;
  el['stage-caption'].textContent = model.demo ? 'Демомодель' : '3D-сцена';
  const choices = model.clips.map((clip, index) => new Option(`${clipLabel(clip, index)} · ${number(clip.duration, 2)} с`, index));
  el.clip.replaceChildren(...(choices.length ? choices : [new Option('Нет клипов с движением', '')]));
}

function modelWarnings(model) {
  const warnings = [];
  if (!model.clips.length) {
    warnings.push(model.rawClipCount
      ? 'Показана исходная поза: в FBX нет клипов, которые двигают этот меш.'
      : 'Показана исходная поза: в FBX не записана анимация. При экспорте включите Bake Animation.');
  }
  if (model.missing.length) {
    const names = model.missing.slice(0, 2).join(', ');
    warnings.push(`Не загрузились текстуры: ${names}${model.missing.length > 2 ? '…' : ''}. Загрузите FBX вместе с изображениями.`);
  } else if (!model.texturesReady) warnings.push('Не все текстуры загрузились. Модель доступна для просмотра.');
  if (model.restoredVisibility) warnings.push('Материалы модели были полностью прозрачными. Включили их видимость.');
  return warnings.join(' ');
}

async function loadAsset(factory, demo = false) {
  if (!studio || !gpuReady || state.loading || state.job) return;
  const resume = state.playing;
  state.loading = true;
  setPlaying(false);
  showImportNotice('');
  showSceneMessage(demo ? 'Загружаем демомодель…' : 'Читаем модель и анимации…', true);
  syncControls();
  try {
    const asset = await factory();
    state.loading = false;
    asset.demo = demo;
    if (demo) {
      const order = [...demoNames.keys()];
      asset.clips.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    }
    state.sampler?.dispose();
    state.sampler = null;
    const previous = state.model;
    state.model = asset;
    studio.setActor(asset.actor);
    if (previous) disposeModel(previous.actor);
    el.angle.value = 'quarter';
    el.trim.open = false;
    showAsset(asset);
    if (asset.clips.length) selectClip(0);
    else showStaticModel();
    if (demo && motionPreference.matches) setPlaying(false);
    showImportNotice(modelWarnings(asset), 'warning');
    if (gpuReady) showSceneMessage('');
  } catch (error) {
    state.loading = false;
    showImportNotice(error.message);
    if (gpuReady) showSceneMessage(state.model ? '' : 'Загрузите FBX для предпросмотра.');
    setPlaying(resume);
  } finally {
    syncControls();
  }
}

function loadDemo() {
  return loadAsset(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let buffer;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/${DEMO_NAME}`, { signal: controller.signal });
      if (!response.ok) throw new Error();
      buffer = await response.arrayBuffer();
    } catch {
      throw new Error('Не загрузилась демомодель. Можно выбрать свой FBX.');
    } finally {
      clearTimeout(timer);
    }
    return parseModel(buffer, DEMO_NAME);
  }, true);
}

function importFiles(files) {
  if (!files?.length || state.loading || state.job || !studio || !gpuReady) return;
  try {
    const { file, textures } = splitUpload(files);
    loadAsset(async () => parseModel(await file.arrayBuffer(), file.name, textures));
  } catch (error) {
    showImportNotice(error.message);
  }
}

function toggleBackground() {
  const transparent = el.transparent.checked;
  el['color-wrap'].hidden = transparent;
  el.viewport.classList.toggle('is-opaque', !transparent);
  el.viewport.style.setProperty('--output-bg', el.background.value);
  outputChanged();
  syncControls();
}

async function createGif() {
  if (el.export.disabled || state.job || currentResult()) return;
  exportError = '';
  el['export-announcement'].textContent = '';
  const params = options();
  const { model, clip, outputRevision } = state;
  const focusWasOnExport = document.activeElement === el.export;
  const camera = studio.snapshotCamera();
  const controller = new AbortController();
  state.job = controller;
  el.progress.value = 0;
  el['export-label'].textContent = 'Подготовка кадров…';
  syncControls();
  try {
    const { renderGif } = await import('./capture.js');
    const blob = await renderGif({
      actor: model.actor, clip, camera, options: params, signal: controller.signal,
      onProgress(ratio, done, total) {
        el.progress.value = ratio;
        el['export-label'].textContent = done === total ? 'Собираем GIF…' : `Экспорт · ${Math.round(ratio * 100)}%`;
      },
    });
    controller.signal.throwIfAborted();
    // Do not start a download here: the original click's user activation may
    // be gone, and previews can sandbox downloads. Keep the file available.
    publishResult(blob, exportName(model.name, clip.name ?? ''), outputRevision);
  } catch (error) {
    exportError = error.name === 'AbortError' ? 'Экспорт отменён.' : `Не удалось создать GIF. ${error.message}`;
    el['export-announcement'].textContent = exportError;
  } finally {
    state.job = null;
    syncControls();
    if (focusWasOnExport && currentResult() && [el.export, document.body].includes(document.activeElement)) {
      el['save-result'].focus({ preventScroll: true });
    }
  }
}

function syncFullscreen() {
  const active = document.fullscreenElement === el.viewport || el.viewport.classList.contains('is-expanded');
  const label = active ? 'Выйти из полноэкранного режима' : 'Во весь экран';
  el.fullscreen.setAttribute('aria-pressed', String(active));
  el.fullscreen.setAttribute('aria-label', label);
  el.fullscreen.title = label;
  el.fullscreen.innerHTML = icon(active ? 'minimize' : 'maximize');
}

function fallbackFullscreen(active) {
  el.viewport.classList.toggle('is-expanded', active);
  document.body.classList.toggle('stage-expanded', active);
  syncFullscreen();
}

async function toggleFullscreen() {
  if (document.fullscreenElement === el.viewport) await document.exitFullscreen();
  else if (el.viewport.classList.contains('is-expanded')) fallbackFullscreen(false);
  else {
    try { await el.viewport.requestFullscreen(); } catch { fallbackFullscreen(true); }
  }
}

el.upload.addEventListener('click', () => el.file.click());
el.file.addEventListener('change', () => {
  importFiles([...el.file.files]);
  el.file.value = '';
});
el.demo.addEventListener('click', loadDemo);

let dragDepth = 0;
for (const name of ['dragenter', 'dragover', 'dragleave', 'drop']) {
  document.addEventListener(name, (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    if (name === 'dragenter') dragDepth++;
    if (name === 'dragleave') dragDepth = Math.max(0, dragDepth - 1);
    if (name === 'dragover') event.dataTransfer.dropEffect = el.upload.disabled ? 'none' : 'copy';
    if (name === 'drop') {
      dragDepth = 0;
      importFiles(event.dataTransfer.files);
    }
    el.upload.classList.toggle('is-dragover', dragDepth > 0 && !el.upload.disabled);
  });
}

el.clip.addEventListener('change', () => selectClip(Number(el.clip.value)));
el.seek.addEventListener('input', () => { setPlaying(false); setTime(Number(el.seek.value)); });
el.play.addEventListener('click', togglePlay);
el.restart.addEventListener('click', () => { setTime(state.range.from); setPlaying(true); });
el.loop.addEventListener('click', () => {
  state.loop = !state.loop;
  el.loop.setAttribute('aria-pressed', String(state.loop));
  outputChanged();
  syncControls();
});
el.speed.addEventListener('change', () => { state.speed = Number(el.speed.value); });
el.angle.addEventListener('change', () => {
  studio.frame(state.bounds, el.angle.value);
  outputChanged(true);
});
el.reframe.addEventListener('click', () => {
  el.angle.value = 'quarter';
  state.bounds = measureBounds();
  setTime(state.time);
  studio.frame(state.bounds);
  outputChanged(true);
});
for (const [key, edited] of [['trim-start', 'start'], ['trim-end', 'end']]) {
  el[key].addEventListener('change', () => {
    if (!state.clip || el[key].disabled) return;
    outputChanged();
    setRange(clipRange(state.clip.duration, el['trim-start'].valueAsNumber, el['trim-end'].valueAsNumber, edited));
  });
}
for (const key of ['size', 'fps']) el[key].addEventListener('change', () => { outputChanged(); syncControls(); });
el.transparent.addEventListener('change', toggleBackground);
el.background.addEventListener('input', toggleBackground);
el.export.addEventListener('click', createGif);
el.cancel.addEventListener('click', () => state.job?.abort());
el.fullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('visibilitychange', () => { lastTick = 0; });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && el.viewport.classList.contains('is-expanded')) {
    fallbackFullscreen(false);
    el.fullscreen.focus();
    return;
  }
  if (event.code !== 'Space' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof Element && event.target.closest('input, button, select, textarea, summary, a, [contenteditable]')) return;
  if (!el.play.disabled) {
    event.preventDefault();
    if (!event.repeat) togglePlay();
  }
});
window.addEventListener('pagehide', () => { state.job?.abort(); });

function onContextStatus(ready) {
  gpuReady = ready;
  if (!ready) {
    resumeAfterContextLoss = state.playing;
    setPlaying(false);
    showSceneMessage('3D-контекст потерян. Если сцена не восстановится, обновите вкладку.', true);
  } else {
    showSceneMessage(state.loading ? 'Читаем модель и анимации…' : state.model ? '' : 'Загрузите FBX для предпросмотра.', state.loading);
    setPlaying(resumeAfterContextLoss);
  }
  syncControls();
}

try {
  studio = createStudio(el['stage-surface'], requestDraw, () => {
    el.angle.value = 'custom';
    outputChanged(true);
  }, onContextStatus);
  loadDemo();
} catch {
  showSceneMessage('WebGL 2 недоступен. Откройте превью в отдельной вкладке или включите аппаратное ускорение в браузере.');
  syncControls();
}
