/* Определения виртуальных машин (синтезаторов) и их пресетов.
   Параметры описываются декларативно — интерфейс строится автоматически. */
(function () {
  'use strict';

  const WAVES = [
    { v: 'sawtooth', n: 'Пила' },
    { v: 'square', n: 'Квадрат' },
    { v: 'triangle', n: 'Треугольник' },
    { v: 'sine', n: 'Синус' },
  ];

  const ADSR = [
    { k: 'a', label: 'Атака', min: 0.001, max: 2, step: 0.001, def: 0.005, unit: 'с', log: true },
    { k: 'd', label: 'Спад', min: 0.005, max: 2, step: 0.005, def: 0.18, unit: 'с', log: true },
    { k: 's', label: 'Сустейн', min: 0, max: 1, step: 0.01, def: 0.6 },
    { k: 'r', label: 'Затухание', min: 0.01, max: 3, step: 0.01, def: 0.25, unit: 'с', log: true },
  ];

  const ENGINES = {
    beatbox: {
      name: 'BeatBox',
      short: 'BB',
      accent: '#ff8a5c',
      poly: true,
      drums: true,
      sampler: true,
      desc: '8-канальная драм-машина (синтез + свои WAV-сэмплы)',
      pads: ['Kick', 'Snare', 'Hat CL', 'Hat OP', 'Clap', 'Tom LO', 'Tom HI', 'Rim'],
      params: [
        { k: 'tune', label: 'Строй', min: -12, max: 12, step: 0.5, def: 0 },
        { k: 'decay', label: 'Длина', min: 0.2, max: 2, step: 0.01, def: 1 },
        { k: 'snap', label: 'Атака', min: 0, max: 1, step: 0.01, def: 0.5 },
        { k: 'level', label: 'Уровень', min: 0, max: 1, step: 0.01, def: 0.9 },
      ],
      main: ['tune', 'decay', 'snap', 'level'],
      defaults: {},
      presets: [{ name: 'Init', values: {} }],
    },

    subsynth: {
      name: 'Subsynth',
      short: 'SUB',
      accent: '#4ee1c1',
      poly: true,
      desc: 'Виртуальный аналоговый субтрактивный синтезатор',
      params: [
        { k: 'wave', label: 'Волна', type: 'select', options: WAVES, def: 'sawtooth' },
        { k: 'detune', label: 'Расстройка', min: 0, max: 40, step: 0.5, def: 8, unit: 'c' },
        { k: 'sub', label: 'Суб-осц.', min: 0, max: 1, step: 0.01, def: 0.4 },
        { k: 'cutoff', label: 'Срез', min: 60, max: 14000, step: 1, def: 1800, unit: 'Гц', log: true },
        { k: 'res', label: 'Резонанс', min: 0.1, max: 24, step: 0.1, def: 7 },
        { k: 'env', label: 'Env фильтра', min: 0, max: 9000, step: 10, def: 2400, unit: 'Гц', log: false },
        ...ADSR,
        { k: 'level', label: 'Уровень', min: 0, max: 1, step: 0.01, def: 0.55 },
      ],
      main: ['cutoff', 'res', 'env', 'd'],
      defaults: {},
      presets: [
        { name: 'Init', values: {} },
        { name: 'Bass', values: { wave: 'sawtooth', cutoff: 320, res: 9, env: 1500, a: 0.004, d: 0.22, s: 0.35, r: 0.15, level: 0.6 } },
        { name: 'Lead', values: { wave: 'square', cutoff: 2600, res: 5, env: 3200, a: 0.01, d: 0.3, s: 0.7, r: 0.3, level: 0.45 } },
        { name: 'Pluck', values: { wave: 'sawtooth', detune: 14, cutoff: 900, res: 12, env: 4200, a: 0.002, d: 0.14, s: 0.05, r: 0.12, level: 0.5 } },
        { name: 'Чистый', values: { wave: 'triangle', sub: 0.2, cutoff: 5000, res: 1, env: 0, a: 0.01, d: 0.4, s: 0.8, r: 0.4, level: 0.5 } },
      ],
    },

    bassline: {
      name: 'BassLine',
      short: 'BASS',
      accent: '#ffd166',
      poly: false,
      desc: 'Монофонический 303-подобный синтезатор',
      params: [
        { k: 'wave', label: 'Волна', type: 'select', options: [WAVES[0], WAVES[1]], def: 'sawtooth' },
        { k: 'cutoff', label: 'Срез', min: 80, max: 6000, step: 1, def: 420, unit: 'Гц', log: true },
        { k: 'res', label: 'Резонанс', min: 0.1, max: 26, step: 0.1, def: 14 },
        { k: 'env', label: 'Env фильтра', min: 0, max: 6000, step: 10, def: 2000, unit: 'Гц' },
        { k: 'decay', label: 'Decay', min: 0.03, max: 1.5, step: 0.01, def: 0.22, unit: 'с' },
        { k: 'accent', label: 'Accent', min: 0, max: 1, step: 0.01, def: 0.5 },
        { k: 'slide', label: 'Slide', min: 0, max: 1, step: 0.01, def: 0.15 },
        { k: 'drive', label: 'Драйв', min: 0, max: 1, step: 0.01, def: 0.25 },
        { k: 'level', label: 'Уровень', min: 0, max: 1, step: 0.01, def: 0.6 },
      ],
      main: ['cutoff', 'res', 'env', 'decay'],
      defaults: {},
      presets: [
        { name: 'Init', values: {} },
        { name: 'Acid', values: { cutoff: 300, res: 20, env: 3200, decay: 0.18, accent: 0.75, slide: 0.2, drive: 0.3 } },
        { name: 'Sub', values: { wave: 'square', cutoff: 180, res: 4, env: 400, decay: 0.4, accent: 0.2, slide: 0, drive: 0.1 } },
      ],
    },

    pcmsynth: {
      name: 'PCMSynth',
      short: 'PCM',
      accent: '#6ea8ff',
      poly: true,
      sampler: true,
      desc: 'Сэмплер: играет ваши WAV, транспонируя по нотам',
      params: [
        { k: 'root', label: 'Корень', min: 36, max: 84, step: 1, def: 60 },
        { k: 'tune', label: 'Строй', min: -24, max: 24, step: 1, def: 0, unit: 'ст' },
        { k: 'start', label: 'Старт', min: 0, max: 0.9, step: 0.01, def: 0 },
        { k: 'a', label: 'Атака', min: 0.001, max: 1, step: 0.001, def: 0.005, unit: 'с', log: true },
        { k: 'd', label: 'Спад', min: 0.005, max: 3, step: 0.005, def: 0.5, unit: 'с', log: true },
        { k: 's', label: 'Сустейн', min: 0, max: 1, step: 0.01, def: 0.8 },
        { k: 'r', label: 'Затухание', min: 0.01, max: 3, step: 0.01, def: 0.15, unit: 'с', log: true },
        { k: 'cutoff', label: 'Срез', min: 200, max: 16000, step: 1, def: 16000, unit: 'Гц', log: true },
        { k: 'level', label: 'Уровень', min: 0, max: 1, step: 0.01, def: 0.8 },
      ],
      main: ['root', 'tune', 'start', 'cutoff'],
      defaults: {},
      presets: [{ name: 'Init', values: {} }],
    },

    fmsynth: {
      name: 'FMSynth',
      short: 'FM',
      accent: '#a78bfa',
      poly: true,
      desc: '3-операторный FM-синтезатор в стиле DX',
      params: [
        { k: 'ratio', label: 'Ratio', min: 0.5, max: 8, step: 0.01, def: 1 },
        { k: 'index', label: 'Индекс', min: 0, max: 12, step: 0.01, def: 3 },
        { k: 'ratio2', label: 'Ratio 2', min: 0.25, max: 6, step: 0.01, def: 2 },
        { k: 'index2', label: 'Индекс 2', min: 0, max: 6, step: 0.01, def: 0.8 },
        { k: 'decay', label: 'Decay FM', min: 0.02, max: 2, step: 0.01, def: 0.5, unit: 'с' },
        { k: 'wave', label: 'Несущая', type: 'select', options: [{ v: 'sine', n: 'Синус' }, WAVES[2], WAVES[1], WAVES[0]], def: 'sine' },
        ...ADSR,
        { k: 'level', label: 'Уровень', min: 0, max: 1, step: 0.01, def: 0.5 },
      ],
      main: ['ratio', 'index', 'decay', 'd'],
      defaults: {},
      presets: [
        { name: 'Init', values: {} },
        { name: 'E.Piano', values: { ratio: 1, index: 1.6, ratio2: 3, index2: 0.6, decay: 0.7, a: 0.002, d: 0.9, s: 0.25, r: 0.3 } },
        { name: 'Bell', values: { ratio: 3.5, index: 4.5, ratio2: 7, index2: 1.2, decay: 1.2, a: 0.002, d: 1.6, s: 0, r: 0.8 } },
        { name: 'Bass FM', values: { ratio: 1, index: 4, ratio2: 2, index2: 0.4, decay: 0.2, a: 0.003, d: 0.2, s: 0.3, r: 0.1 } },
      ],
    },

    padsynth: {
      name: 'PadSynth',
      short: 'PAD',
      accent: '#67e8f9',
      poly: true,
      desc: 'Синтезатор пэдов на растянутых детюн-волнах',
      params: [
        { k: 'voices', label: 'Голосов', min: 1, max: 6, step: 1, def: 4 },
        { k: 'spread', label: 'Разброс', min: 0, max: 60, step: 1, def: 22, unit: 'c' },
        { k: 'cutoff', label: 'Срез', min: 200, max: 12000, step: 1, def: 2400, unit: 'Гц', log: true },
        { k: 'res', label: 'Резонанс', min: 0.1, max: 16, step: 0.1, def: 2 },
        { k: 'a', label: 'Атака', min: 0.01, max: 4, step: 0.01, def: 0.6, unit: 'с', log: true },
        { k: 'd', label: 'Спад', min: 0.05, max: 4, step: 0.01, def: 1.2, unit: 'с', log: true },
        { k: 's', label: 'Сустейн', min: 0, max: 1, step: 0.01, def: 0.8 },
        { k: 'r', label: 'Затухание', min: 0.05, max: 5, step: 0.01, def: 1.4, unit: 'с', log: true },
        { k: 'level', label: 'Уровень', min: 0, max: 1, step: 0.01, def: 0.35 },
      ],
      main: ['spread', 'cutoff', 'a', 'r'],
      defaults: {},
      presets: [
        { name: 'Init', values: {} },
        { name: 'Тёплый', values: { voices: 4, spread: 18, cutoff: 1600, res: 1.5, a: 0.9, d: 1.5, s: 0.85, r: 2, level: 0.32 } },
        { name: 'Стекло', values: { voices: 5, spread: 40, cutoff: 6000, res: 4, a: 0.4, d: 1, s: 0.7, r: 3, level: 0.25 } },
      ],
    },

    eightbit: {
      name: '8BitSynth',
      short: '8BIT',
      accent: '#f472b6',
      poly: true,
      desc: 'Синтезатор в духе 8-битных звуковых чипов',
      params: [
        { k: 'duty', label: 'Скважность', min: 0.05, max: 0.95, step: 0.01, def: 0.5 },
        { k: 'vibrato', label: 'Вибрато', min: 0, max: 1, step: 0.01, def: 0.15 },
        { k: 'pitchEnv', label: 'Pitch env', min: -24, max: 24, step: 1, def: 0, unit: 'ст' },
        { k: 'bits', label: 'Биты', min: 2, max: 12, step: 1, def: 12 },
        ...ADSR,
        { k: 'level', label: 'Уровень', min: 0, max: 1, step: 0.01, def: 0.35 },
      ],
      main: ['duty', 'vibrato', 'bits', 'd'],
      defaults: {},
      presets: [
        { name: 'Init', values: {} },
        { name: 'Chip Lead', values: { duty: 0.25, vibrato: 0.3, a: 0.002, d: 0.2, s: 0.6, r: 0.1, level: 0.3 } },
        { name: 'Chip Bass', values: { duty: 0.5, vibrato: 0, a: 0.002, d: 0.15, s: 0.4, r: 0.08, level: 0.4 } },
      ],
    },
  };

  function defaultParams(engineKey, overrides) {
    const def = ENGINES[engineKey];
    const out = {};
    def.params.forEach((p) => { out[p.k] = p.def; });
    return Object.assign(out, def.presets[0].values, overrides || {});
  }

  window.ENGINES = ENGINES;
  window.defaultParams = defaultParams;
})();
