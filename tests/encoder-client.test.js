import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asGifBlob, connectEncoder } from '../src/encoder-client.js';
import { makeGifEncoder } from '../src/gif-encoder.js';

function fakeWorker() {
  return {
    messages: [],
    closed: false,
    postMessage(message, transfer) { this.messages.push({ message, transfer }); },
    terminate() { this.closed = true; },
  };
}

test('encoder replies resolve serial requests and preserve the transferred GIF buffer', async () => {
  const worker = fakeWorker();
  const client = connectEncoder(worker, new AbortController().signal);
  try {
    const init = client.send({ type: 'init' });
    worker.onmessage({ data: {} });
    await init;
    const buffer = new ArrayBuffer(10);
    const frame = client.send({ type: 'frame', buffer }, [buffer]);
    assert.deepEqual(worker.messages.at(-1).transfer, [buffer]);
    worker.onmessage({ data: {} });
    await frame;
    const finish = client.send({ type: 'finish' });
    worker.onmessage({ data: { buffer } });
    assert.equal(await finish, buffer);
  } finally {
    client.close();
  }
  assert.equal(worker.closed, true);
});

test('a missing final response ends in an error instead of leaving export pending', async () => {
  const worker = fakeWorker();
  const client = connectEncoder(worker, new AbortController().signal, 12);
  try {
    const frame = client.send({ type: 'frame' });
    worker.onmessage({ data: {} });
    await frame;
    await assert.rejects(client.send({ type: 'finish' }), /Кодировщик не ответил/);
    await assert.rejects(client.send({ type: 'finish' }), /Кодировщик не ответил/);
  } finally {
    client.close();
  }
});

test('cancel, message errors and a failed postMessage all settle outstanding work', async () => {
  for (const mode of ['abort', 'messageerror', 'posterror']) {
    const worker = fakeWorker();
    const controller = new AbortController();
    const client = connectEncoder(worker, controller.signal);
    try {
      if (mode === 'posterror') worker.postMessage = () => { throw new Error('Cannot post'); };
      const request = client.send({ type: 'finish' });
      if (mode === 'abort') controller.abort();
      if (mode === 'messageerror') worker.onmessageerror();
      const expected = mode === 'abort' ? { name: 'AbortError' }
        : mode === 'messageerror' ? /Не удалось получить данные/ : /Cannot post/;
      await assert.rejects(request, expected);
    } finally {
      client.close();
    }
  }
});

test('a downloadable GIF is published only if the encoder returns a finished GIF stream', async () => {
  const sample = Uint8Array.of(255, 160, 80, 255).buffer;
  const encoder = makeGifEncoder({ size: 1, transparent: true, loop: true }, [sample]);
  encoder.addFrame(sample, 50);
  const completed = encoder.finish().buffer;
  const blob = asGifBlob(completed);
  assert.equal(blob.type, 'image/gif');
  assert.equal(blob.size, completed.byteLength);
  assert.deepEqual(await blob.arrayBuffer(), completed);
  assert.throws(() => asGifBlob(completed.slice(0, -1)), /не вернул готовый GIF/);
  assert.throws(() => asGifBlob(undefined), /не вернул готовый GIF/);
});
