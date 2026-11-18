export const MAX_FBX_SIZE = 80 * 1024 * 1024;
export const MAX_FRAMES = 240;
export const SIZES = [256, 384, 512, 640, 768];
export const RATES = [10, 15, 20, 24, 30];

export function clipRange(duration, start = 0, end = duration, edited = 'end') {
  const minLength = Math.min(0.05, duration);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let from = clamp(Number.isFinite(start) ? start : 0, 0, duration - minLength);
  let to = clamp(Number.isFinite(end) ? end : duration, minLength, duration);
  if (to - from < minLength) {
    if (edited === 'start') from = Math.max(0, to - minLength);
    else to = Math.min(duration, from + minLength);
  }
  return { from, to };
}

export function frameCount(duration, fps) {
  return Math.max(1, Math.round(duration * fps));
}

// GIF stores delays as whole centiseconds. Rounded cumulative endpoints keep
// the total duration correct even when a frame interval is fractional (24 fps).
export function gifPlan({ from, to, fps, loop }) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || !RATES.includes(fps)) {
    throw new Error('Некорректный интервал или частота кадров.');
  }
  const duration = to - from;
  const frames = frameCount(duration, fps);
  if (frames > MAX_FRAMES) throw new Error(`Не более ${MAX_FRAMES} кадров. Обрежьте клип или снизьте частоту.`);
  const ticks = Math.max(2, Math.round(duration * 100));
  return Array.from({ length: frames }, (_, i) => ({
    time: from + duration * i / (loop ? frames : Math.max(1, frames - 1)),
    delay: 10 * (Math.round((i + 1) * ticks / frames) - Math.round(i * ticks / frames)),
  }));
}

export function advance(time, delta, { from, to }, loop) {
  const next = time + delta;
  if (next < to) return { time: next, ended: false };
  if (!loop) return { time: to, ended: true };
  return { time: from + (next - from) % (to - from), ended: false };
}

const cyrillic = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const transliteration = ['a', 'b', 'v', 'g', 'd', 'e', 'yo', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'kh', 'ts', 'ch', 'sh', 'shch', '', 'y', '', 'e', 'yu', 'ya'];

export function exportName(modelName, clipName) {
  // ASCII names are reliable across browsers and embedded preview downloads.
  const slug = (value) => String(value).normalize('NFC').toLowerCase()
    .replace(/[а-яё]/g, (letter) => transliteration[cyrillic.indexOf(letter)])
    .normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-')
    .slice(0, 56).replace(/^-|-$/g, '');
  return `${slug(modelName.replace(/\.fbx$/i, '')) || 'model'}-${slug(clipName) || 'clip'}.gif`;
}

export function timecode(seconds) {
  const ticks = Math.round(seconds * 10);
  return `${String(Math.floor(ticks / 600)).padStart(2, '0')}:${String(Math.floor(ticks / 10) % 60).padStart(2, '0')}.${ticks % 10}`;
}

export function number(value, digits = 1) {
  return new Intl.NumberFormat('ru', { maximumFractionDigits: digits }).format(value);
}

export function quantity(value, endings) {
  const tens = value % 100;
  const units = value % 10;
  return endings[tens >= 11 && tens <= 14 ? 2 : units === 1 ? 0 : units >= 2 && units <= 4 ? 1 : 2];
}

export function fileSize(bytes) {
  const mib = bytes / (1024 * 1024);
  return mib >= 1 ? `${number(mib)} МБ` : `${number(bytes / 1024, 0)} КБ`;
}
