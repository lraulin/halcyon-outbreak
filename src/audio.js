// Fully synthesized sound effects (no audio assets).
let ctx = null;
let master, reverbIn, noiseBuf;

function makeImpulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);

  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(2.8, 3);
  reverbIn = ctx.createGain();
  reverbIn.gain.value = 1;
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  reverbIn.connect(conv);
  conv.connect(wet);
  wet.connect(master);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  startAmbience();
}

function route(node, wet = 0.3, pan = 0) {
  let n = node;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    n = p;
  }
  n.connect(master);
  if (wet > 0) {
    const s = ctx.createGain();
    s.gain.value = wet;
    n.connect(s);
    s.connect(reverbIn);
  }
}

function noise(dur, o = {}) {
  const t = ctx.currentTime + (o.when || 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = o.type || 'lowpass';
  f.frequency.setValueAtTime(o.freq || 1200, t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
  f.Q.value = o.q ?? 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain ?? 0.6, t + (o.attack ?? 0.002));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  route(g, o.wet ?? 0.3, o.pan);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, o = {}) {
  const t = ctx.currentTime + (o.when || 0);
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain ?? 0.3, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let last = g;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.filter;
    f.Q.value = o.q ?? 1;
    g.connect(f);
    last = f;
  }
  osc.connect(g);
  route(last, o.wet ?? 0.2, o.pan);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function startAmbience() {
  // low dread drone
  const g = ctx.createGain();
  g.gain.value = 0.05;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 180;
  [41.2, 41.7, 61.8].forEach((fr) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = fr;
    o.connect(f);
    o.start();
  });
  f.connect(g);
  g.connect(master);
  // wind
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 400;
  bp.Q.value = 0.6;
  const wg = ctx.createGain();
  wg.gain.value = 0.035;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lg = ctx.createGain();
  lg.gain.value = 250;
  lfo.connect(lg);
  lg.connect(bp.frequency);
  lfo.start();
  src.connect(bp);
  bp.connect(wg);
  route(wg, 0.5);
  src.start();
  // distant moans now and then
  const moan = () => {
    if (Math.random() < 0.7) sfx.groan(-0.8 + Math.random() * 1.6, 0.25);
    setTimeout(moan, 9000 + Math.random() * 14000);
  };
  setTimeout(moan, 6000);
}

const ok = () => ctx !== null;

export const sfx = {
  shot(kind, pan = 0) {
    if (!ok()) return;
    if (kind === 'shotgun') {
      noise(0.5, { freq: 2600, freqEnd: 200, gain: 1.0, pan, wet: 0.5 });
      tone(90, 0.3, { type: 'sine', freqEnd: 35, gain: 0.8, pan });
    } else if (kind === 'sniper') {
      noise(0.08, { type: 'highpass', freq: 2500, gain: 0.8, pan, wet: 0.2 });
      noise(0.7, { freq: 1800, freqEnd: 150, gain: 0.8, pan, wet: 0.7 });
      tone(70, 0.35, { freqEnd: 30, gain: 0.8, pan });
    } else if (kind === 'pistol') {
      noise(0.22, { freq: 3000, freqEnd: 400, gain: 0.6, pan, wet: 0.4 });
      tone(140, 0.12, { freqEnd: 60, gain: 0.4, pan });
    } else if (kind === 'smg') {
      noise(0.12, { freq: 3600, freqEnd: 600, gain: 0.5, pan, wet: 0.3 });
      tone(120, 0.08, { freqEnd: 60, gain: 0.3, pan });
    } else {
      noise(0.2, { freq: 3200, freqEnd: 400, gain: 0.7, pan, wet: 0.4 });
      tone(110, 0.14, { freqEnd: 45, gain: 0.5, pan });
    }
  },
  impact(kind, pan = 0) {
    if (!ok()) return;
    if (kind === 'flesh') {
      noise(0.12, { freq: 500, gain: 0.5, pan, wet: 0.1 });
      tone(80, 0.1, { gain: 0.3, freqEnd: 50, pan });
    } else if (kind === 'metal') {
      tone(1800 + Math.random() * 1500, 0.25, { type: 'triangle', freqEnd: 900, gain: 0.08, pan, wet: 0.4 });
      noise(0.05, { type: 'highpass', freq: 3000, gain: 0.3, pan });
    } else if (kind === 'wood') {
      noise(0.09, { freq: 900, gain: 0.4, q: 3, pan });
    } else {
      noise(0.07, { type: 'bandpass', freq: 1800, gain: 0.35, q: 1.5, pan, wet: 0.2 });
      if (Math.random() < 0.3) tone(2500 + Math.random() * 2500, 0.3, { type: 'sine', freqEnd: 1200, gain: 0.04, pan, wet: 0.5 });
    }
  },
  explosion(pan = 0) {
    if (!ok()) return;
    noise(1.8, { freq: 1200, freqEnd: 60, gain: 1.2, pan, wet: 0.8, attack: 0.005 });
    tone(55, 1.0, { freqEnd: 20, gain: 1.0, pan });
    noise(0.3, { type: 'highpass', freq: 1500, gain: 0.5, pan });
  },
  groan(pan = 0, vol = 0.5) {
    if (!ok()) return;
    const base = 70 + Math.random() * 50;
    const dur = 1.0 + Math.random() * 0.8;
    tone(base, dur, { type: 'sawtooth', freqEnd: base * (0.6 + Math.random() * 0.3), gain: 0.25 * vol, filter: 500 + Math.random() * 300, q: 6, attack: 0.25, pan, wet: 0.6 });
    tone(base * 1.51, dur * 0.8, { type: 'sawtooth', freqEnd: base * 0.9, gain: 0.08 * vol, filter: 900, q: 4, attack: 0.3, pan, wet: 0.6 });
  },
  growl(pan = 0) {
    if (!ok()) return;
    tone(60, 0.8, { type: 'sawtooth', freqEnd: 45, gain: 0.25, filter: 350, q: 8, attack: 0.05, pan, wet: 0.3 });
    noise(0.7, { type: 'bandpass', freq: 300, q: 4, gain: 0.3, pan, attack: 0.05 });
  },
  roar(pan = 0) {
    if (!ok()) return;
    tone(45, 1.6, { type: 'sawtooth', freqEnd: 30, gain: 0.5, filter: 400, q: 5, attack: 0.1, pan, wet: 0.7 });
    noise(1.4, { type: 'bandpass', freq: 250, q: 2, gain: 0.5, pan, attack: 0.1, wet: 0.6 });
  },
  spit(pan = 0) {
    if (!ok()) return;
    noise(0.35, { type: 'bandpass', freq: 900, freqEnd: 300, q: 3, gain: 0.5, pan });
    tone(200, 0.2, { type: 'square', freqEnd: 80, gain: 0.1, filter: 600, pan });
  },
  splat(pan = 0) {
    if (!ok()) return;
    noise(0.3, { freq: 700, freqEnd: 150, gain: 0.5, q: 2, pan, wet: 0.2 });
  },
  bite(pan = 0) {
    if (!ok()) return;
    noise(0.15, { type: 'bandpass', freq: 1200, q: 2, gain: 0.6, pan });
    tone(160, 0.25, { type: 'sawtooth', freqEnd: 70, gain: 0.2, filter: 700, pan });
  },
  hurt(pan = 0) {
    if (!ok()) return;
    tone(220 + Math.random() * 60, 0.35, { type: 'sawtooth', freqEnd: 140, gain: 0.15, filter: 1200, q: 4, attack: 0.02, pan });
  },
  step() {
    if (!ok()) return;
    noise(0.05, { freq: 600 + Math.random() * 300, gain: 0.12, wet: 0.05 });
  },
  reload() {
    if (!ok()) return;
    tone(800, 0.05, { type: 'square', gain: 0.08, filter: 2000 });
    tone(500, 0.06, { type: 'square', gain: 0.08, filter: 2000, when: 0.25 });
    noise(0.05, { type: 'highpass', freq: 3000, gain: 0.3, when: 0.45 });
  },
  pickup() {
    if (!ok()) return;
    tone(660, 0.12, { type: 'triangle', gain: 0.15 });
    tone(990, 0.2, { type: 'triangle', gain: 0.15, when: 0.08 });
  },
  click() {
    if (!ok()) return;
    tone(1200, 0.03, { type: 'square', gain: 0.04, filter: 3000, wet: 0 });
  },
  dry() {
    if (!ok()) return;
    tone(1500, 0.03, { type: 'square', gain: 0.1, filter: 4000 });
  },
  alarm() {
    if (!ok()) return;
    for (let i = 0; i < 4; i++) {
      tone(700, 0.4, { type: 'square', gain: 0.06, filter: 1500, when: i * 0.8, freqEnd: 500, wet: 0.6 });
    }
  },
  heal() {
    if (!ok()) return;
    noise(0.4, { type: 'highpass', freq: 4000, gain: 0.2 });
    tone(520, 0.4, { type: 'sine', gain: 0.1, when: 0.2 });
  },
  sting() {
    if (!ok()) return;
    tone(98, 2.2, { type: 'sawtooth', gain: 0.2, filter: 800, attack: 0.02, wet: 0.8 });
    tone(103.8, 2.2, { type: 'sawtooth', gain: 0.2, filter: 800, attack: 0.02, wet: 0.8 });
    noise(1.5, { type: 'highpass', freq: 5000, gain: 0.15, attack: 0.02, wet: 0.8 });
  },
};
