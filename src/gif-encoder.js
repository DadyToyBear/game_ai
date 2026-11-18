import * as encoder from 'gifenc';

// Vite resolves the ESM build; Node tests use the package’s CommonJS entry.
const { GIFEncoder, nearestColorIndex, quantize } = Reflect.has(encoder, 'GIFEncoder')
  ? encoder : Reflect.get(encoder, 'default');

const ALPHA_THRESHOLD = 120;

function trainColors(buffers, transparent) {
  // Sample across the clip, not just the first pose. A fixed global palette avoids
  // flickering colors from frame to frame and keeps the GIF smaller.
  const colors = [];
  for (const buffer of buffers) {
    const pixels = new Uint8Array(buffer);
    const stride = Math.max(4, Math.ceil(pixels.length / 200_000) * 4);
    for (let i = 0; i < pixels.length; i += stride) {
      if (transparent && pixels[i + 3] < ALPHA_THRESHOLD) continue;
      colors.push(pixels[i], pixels[i + 1], pixels[i + 2], 255);
    }
  }
  return colors.length ? quantize(Uint8Array.from(colors), transparent ? 255 : 256) : [[0, 0, 0]];
}

export function makeGifEncoder({ size, transparent, loop }, colorSamples) {
  const encoder = GIFEncoder();
  const colors = trainColors(colorSamples, transparent);
  const palette = transparent ? [[0, 0, 0], ...colors] : colors;
  const lookup = new Uint16Array(1 << 16);
  let first = true;
  return {
    addFrame(buffer, delay) {
      const rgba = new Uint8Array(buffer);
      if (rgba.length !== size * size * 4) throw new Error('Некорректный размер кадра.');
      const indexes = new Uint8Array(size * size);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
        if (transparent && rgba[i + 3] < ALPHA_THRESHOLD) continue;
        const r = rgba[i] >> 3, g = rgba[i + 1] >> 2, b = rgba[i + 2] >> 3;
        const key = (r << 11) | (g << 5) | b;
        const index = lookup[key] || (lookup[key] = 1 + nearestColorIndex(colors, [r * 8 + 4, g * 4 + 2, b * 8 + 4]));
        indexes[j] = transparent ? index : index - 1;
      }
      encoder.writeFrame(indexes, size, size, {
        palette: first ? palette : undefined,
        delay,
        transparent,
        dispose: transparent ? 2 : 1,
        repeat: loop ? 0 : -1,
      });
      first = false;
    },
    finish() {
      encoder.finish();
      return encoder.bytes();
    },
  };
}
