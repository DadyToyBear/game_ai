import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binaryVersion, normalizeBooleanTags } from '../src/fbx-compat.js';

function binary(version) {
  const word = version < 7500 ? 4 : 8;
  const header = 3 * word + 1;
  const props = Buffer.from([0x42, 1, 0x53, 1, 0, 0, 0, 0x42]);
  const end = 27 + header + 1 + props.length;
  const buffer = Buffer.alloc(end + header);
  buffer.write('Kaydara FBX Binary  \0\x1a\0', 0, 'binary');
  buffer.writeUInt32LE(version, 23);
  for (const [index, v] of [end, 2, props.length].entries()) {
    const offset = 27 + index * word;
    if (word === 4) buffer.writeUInt32LE(v, offset);
    else buffer.writeBigUInt64LE(BigInt(v), offset);
  }
  buffer.set([1, 0x50], 27 + 3 * word);
  buffer.set(props, 27 + header + 1);
  return { data: Uint8Array.from(buffer), tag: 27 + header + 1, string: end - 1 };
}

for (const version of [7400, 7500]) {
  test(`binary FBX ${version}: remap boolean tags without editing data that happens to contain B`, () => {
    const { data, tag, string } = binary(version);
    assert.equal(binaryVersion(data.buffer), version);
    assert.equal(normalizeBooleanTags(data.buffer), true);
    assert.equal(data[tag], 0x43);
    assert.equal(data[string], 0x42);
    assert.equal(normalizeBooleanTags(data.buffer), false);
  });
}

test('the compatibility pass rejects malformed nodes without editing their bytes', () => {
  const { data, tag } = binary(7400);
  data[27] = 255;
  assert.equal(normalizeBooleanTags(data.buffer), false);
  assert.equal(data[tag], 0x42);
  assert.equal(normalizeBooleanTags(new ArrayBuffer(0)), false);
  assert.equal(binaryVersion(new ArrayBuffer(0)), null);
});
