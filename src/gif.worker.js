import { makeGifEncoder } from './gif-encoder.js';

let encoder;
self.onmessage = ({ data }) => {
  try {
    switch (data.type) {
      case 'init':
        encoder = makeGifEncoder(data.options, data.samples);
        self.postMessage({});
        break;
      case 'frame':
        encoder.addFrame(data.buffer, data.delay);
        self.postMessage({});
        break;
      case 'finish': {
        const bytes = encoder.finish();
        self.postMessage({ buffer: bytes.buffer }, [bytes.buffer]);
        encoder = null;
        break;
      }
    }
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
