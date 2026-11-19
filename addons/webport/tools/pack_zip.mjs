#!/usr/bin/env node
/**
 * pack_zip.mjs — упаковка плагина в ZIP для установки «как есть».
 *
 *   node addons/webport/tools/pack_zip.mjs --out dist/webport-addon.zip
 *
 * Внутри архива путь addons/webport/... — такой ZIP распаковывается прямо в корень
 * проекта Redot, после чего плагин включается в Project → Project Settings → Plugins.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDON_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(ADDON_ROOT, "..", "..");

const SKIP = new Set([".git", "node_modules", "__pycache__", "dist", ".venv"]);
const TEXT_EXT = new Set([".md", ".mjs", ".js", ".gd", ".cfg", ".tscn", ".json", ".txt", ".html"]);

function collect(dir, base, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, base, out);
    else out.push({ full, rel: relative(base, full).split("\\").join("/") });
  }
  return out;
}

// ── минимальный ZIP-writer (deflate), чтобы не тащить зависимости ───────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, day } = dosTime();

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.rel, "utf8");
    const data = entry.data;
    // В ZIP лежит raw deflate (без zlib-заголовка), иначе архивы не читаются.
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, compressed);

    central.push({ nameBuf, crc, compressed: compressed.length, size: data.length, offset, time, day });
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralStart = offset;
  for (const c of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(c.time, 12);
    header.writeUInt16LE(c.day, 14);
    header.writeUInt32LE(c.crc, 16);
    header.writeUInt32LE(c.compressed, 20);
    header.writeUInt32LE(c.size, 24);
    header.writeUInt16LE(c.nameBuf.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(c.offset, 42);
    chunks.push(header, c.nameBuf);
    offset += header.length + c.nameBuf.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);
  return Buffer.concat(chunks);
}

export function packAddon({ out, includeExamples = true } = {}) {
  const entries = [];
  const addonFiles = collect(ADDON_ROOT, ADDON_ROOT);
  for (const file of addonFiles) {
    entries.push({ rel: `addons/webport/${file.rel}`, data: readFileSync(file.full) });
  }
  if (includeExamples) {
    // маленькие примеры: тестовая веб-игра и готовая демо-площадка
    for (const dirName of ["examples/webgame_min"]) {
      const dir = join(REPO_ROOT, dirName);
      if (!existsSync(dir)) continue;
      for (const file of collect(dir, REPO_ROOT)) {
        entries.push({ rel: file.rel, data: readFileSync(file.full) });
      }
    }
  }
  // верхнеуровневые копии инструкций: их видно сразу после распаковки
  for (const doc of ["БЫСТРЫЙ_СТАРТ.md", "УСТАНОВКА.md", "РАБОТА_С_ПЛАГИНОМ.md", "README.md"]) {
    const path = join(ADDON_ROOT, doc);
    if (!existsSync(path)) continue;
    entries.push({
      rel: doc === "README.md" ? "WEBPORT_README.md" : doc,
      data: readFileSync(path),
    });
  }

  const zip = buildZip(entries);
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), zip);
  }
  return { zip, entries: entries.length, bytes: zip.length };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : "dist/webport-addon.zip";
  const result = packAddon({ out, includeExamples: !args.includes("--no-examples") });
  console.log(`Файлов: ${result.entries}, архив: ${(result.bytes / 1024).toFixed(1)} КБ → ${out}`);
}
