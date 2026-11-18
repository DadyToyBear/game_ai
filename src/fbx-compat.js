const MAGIC = 'Kaydara FBX Binary  \0\x1a\0';
const fixedBytes = { B: 1, C: 1, Y: 2, I: 4, F: 4, D: 8, L: 8 };
const arrays = new Set(['b', 'c', 'd', 'f', 'i', 'l']);

// Some FBX writers use B for a binary boolean, while FBXLoader accepts C.
// Scan only node property tags (not strings, compressed arrays or image bytes).
// Offsets stay valid because the replacement is exactly one byte wide.
export function normalizeBooleanTags(buffer) {
  const bytes = new Uint8Array(buffer);
  const version = binaryVersion(buffer);
  if (version === null) return false;
  const view = new DataView(buffer);
  const wide = version >= 7500;
  const word = wide ? 8 : 4;
  const header = word * 3 + 1;
  const uint = (offset) => wide ? Number(view.getBigUint64(offset, true)) : view.getUint32(offset, true);
  const tags = [];

  function scan(offset, end, depth) {
    if (depth > 96) return false;
    while (offset + header <= end) {
      const next = uint(offset);
      if (next === 0) return true;
      if (next <= offset || next > end) return false;
      const count = uint(offset + word);
      const length = uint(offset + word * 2);
      const start = offset + header + bytes[offset + word * 3];
      const stop = start + length;
      if (stop > next || count > length) return false;
      let cursor = start;
      for (let i = 0; i < count; i++) {
        if (cursor >= stop) return false;
        const type = String.fromCharCode(bytes[cursor]);
        if (type === 'B') tags.push(cursor);
        cursor++;
        if (fixedBytes[type]) cursor += fixedBytes[type];
        else if (type === 'S' || type === 'R') {
          if (cursor + 4 > stop) return false;
          cursor += 4 + view.getUint32(cursor, true);
        } else if (arrays.has(type)) {
          if (cursor + 12 > stop) return false;
          cursor += 12 + view.getUint32(cursor + 8, true);
        } else return false;
      }
      if (cursor !== stop || (stop < next && !scan(stop, next, depth + 1))) return false;
      offset = next;
    }
    return offset === end;
  }

  if (!scan(27, bytes.length, 0) || !tags.length) return false;
  for (const offset of tags) bytes[offset] = 0x43;
  return true;
}

export function binaryVersion(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 27 || [...MAGIC].some((ch, index) => bytes[index] !== ch.charCodeAt(0))) return null;
  return new DataView(buffer).getUint32(23, true);
}

export function normalizeAsciiFbx(buffer) {
  if (binaryVersion(buffer) !== null) return buffer;
  const text = new TextDecoder().decode(buffer);
  if (!/^\s*FBXVersion\s*:\s*\d+/m.test(text)) return buffer;
  // Three's ASCII reader uses indentation to recognize the node tree and
  // expects literal tabs; valid ASCII exporters can emit spaces instead.
  let depth = 0;
  const lines = text.split(/\r\n|[\r\n]/).map((original) => {
    const line = original.trim();
    if (!line || line.startsWith(';')) return line;
    if (line.startsWith('}')) {
      depth = Math.max(0, depth - 1);
      return `${'\t'.repeat(depth)}${line}`;
    }
    const property = /^([\w]+):\s*(.*)$/.exec(line);
    // Large numeric arrays and encoded images may continue on the next line.
    if (!property) return line;
    const formatted = `${'\t'.repeat(depth)}${property[1]}: ${property[2]}`;
    if (/\{\s*(?:;.*)?$/.test(property[2])) depth = Math.min(256, depth + 1);
    return formatted;
  });
  const formatted = lines.join('\n');
  return formatted === text ? buffer : new TextEncoder().encode(formatted).buffer;
}
