let ctx: AudioContext | null = null;
let running = false;
let masterGain: GainNode | null = null;
let _muted = false;
let _volume = 0.18;
let _birdsEnabled = true;

export function isMuted(): boolean { return _muted; }

export function setMuted(muted: boolean) {
  _muted = muted;
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : _volume;
  }
}

export function toggleMute(): boolean {
  setMuted(!_muted);
  return _muted;
}

export function areBirdsEnabled(): boolean { return _birdsEnabled; }

export function toggleBirds(): boolean {
  _birdsEnabled = !_birdsEnabled;
  return _birdsEnabled;
}

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.18;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Short FM-synthesis bird chirp
function chirp(
  audioCtx: AudioContext,
  dest: AudioNode,
  time: number,
  baseFreq: number,
  freqSweep: number,
  duration: number,
  volume: number
) {
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(baseFreq, time);
  osc.frequency.linearRampToValueAtTime(baseFreq + freqSweep, time + duration * 0.6);
  osc.frequency.linearRampToValueAtTime(baseFreq + freqSweep * 0.5, time + duration);

  gainNode.gain.setValueAtTime(0, time);
  gainNode.gain.linearRampToValueAtTime(volume, time + 0.01);
  gainNode.gain.linearRampToValueAtTime(volume * 0.6, time + duration * 0.5);
  gainNode.gain.linearRampToValueAtTime(0, time + duration);

  osc.connect(gainNode);
  gainNode.connect(dest);

  osc.start(time);
  osc.stop(time + duration + 0.01);
}

// A "bird call" = series of chirps
function scheduleBirdCall(audioCtx: AudioContext, dest: AudioNode, startTime: number) {
  const species = Math.floor(Math.random() * 4);

  if (species === 0) {
    // Warbler: rapid ascending trill
    const base = 2400 + Math.random() * 600;
    const notes = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      chirp(audioCtx, dest, startTime + i * 0.09, base + i * 120, 200, 0.07, 0.25);
    }
  } else if (species === 1) {
    // Robin: two-note whistle
    const base = 1800 + Math.random() * 400;
    chirp(audioCtx, dest, startTime, base, 350, 0.18, 0.3);
    chirp(audioCtx, dest, startTime + 0.22, base - 150, -100, 0.15, 0.25);
  } else if (species === 2) {
    // Sparrow: short chipping
    const base = 3200 + Math.random() * 800;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      chirp(audioCtx, dest, startTime + i * 0.07, base + (Math.random() - 0.5) * 300, 100, 0.05, 0.2);
    }
  } else {
    // Finch: descending glissando
    const base = 2800 + Math.random() * 500;
    chirp(audioCtx, dest, startTime, base, -600, 0.3, 0.28);
  }
}

// Gentle wind ambient using filtered noise
function scheduleWind(audioCtx: AudioContext, dest: AudioNode, startTime: number, duration: number) {
  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.3;
  }

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 400;
  filter.Q.value = 0.3;

  const windGain = audioCtx.createGain();
  windGain.gain.setValueAtTime(0, startTime);
  windGain.gain.linearRampToValueAtTime(0.04, startTime + 1);
  windGain.gain.linearRampToValueAtTime(0.02, startTime + duration * 0.5);
  windGain.gain.linearRampToValueAtTime(0, startTime + duration);

  src.connect(filter);
  filter.connect(windGain);
  windGain.connect(dest);
  src.start(startTime);
  src.stop(startTime + duration);
}

let nextScheduleTime = 0;

function scheduleAmbience() {
  if (!running || !ctx || !masterGain) return;

  const now = ctx.currentTime;
  // Schedule ~1.5 seconds ahead (short lookahead so toggle takes effect quickly)
  const scheduleUntil = now + 1.5;

  while (nextScheduleTime < scheduleUntil) {
    // Bird call every 1.5–4 seconds
    const gap = 1.5 + Math.random() * 2.5;
    if (_birdsEnabled) {
      scheduleBirdCall(ctx, masterGain, nextScheduleTime);
    }
    nextScheduleTime += gap;
  }

  // Also scatter some wind
  if (Math.random() < 0.3) {
    scheduleWind(ctx, masterGain, now + Math.random() * 3, 3 + Math.random() * 4);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startAmbience() {
  if (running) return;
  running = true;
  const audioCtx = getCtx();
  nextScheduleTime = audioCtx.currentTime + 0.1;

  // Schedule immediately and then every second
  scheduleAmbience();
  intervalId = setInterval(scheduleAmbience, 1000);
}

export function stopAmbience() {
  running = false;
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (ctx) {
    ctx.suspend();
  }
}

export function playSwingSound() {
  const audioCtx = getCtx();
  const dest = masterGain ?? audioCtx.destination;
  const now = audioCtx.currentTime;

  // Whoosh: filtered noise sweep (the swing through air)
  const whooshLen = 0.15;
  const whooshBuf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * whooshLen), audioCtx.sampleRate);
  const whooshData = whooshBuf.getChannelData(0);
  for (let i = 0; i < whooshData.length; i++) whooshData[i] = Math.random() * 2 - 1;
  const whooshSrc = audioCtx.createBufferSource();
  whooshSrc.buffer = whooshBuf;
  const whooshFilter = audioCtx.createBiquadFilter();
  whooshFilter.type = 'bandpass';
  whooshFilter.frequency.setValueAtTime(600, now);
  whooshFilter.frequency.linearRampToValueAtTime(2000, now + whooshLen);
  whooshFilter.Q.value = 2;
  const whooshGain = audioCtx.createGain();
  whooshGain.gain.setValueAtTime(0, now);
  whooshGain.gain.linearRampToValueAtTime(0.6, now + 0.03);
  whooshGain.gain.linearRampToValueAtTime(0, now + whooshLen);
  whooshSrc.connect(whooshFilter);
  whooshFilter.connect(whooshGain);
  whooshGain.connect(dest);
  whooshSrc.start(now);
  whooshSrc.stop(now + whooshLen);

  // Impact: sharp click/crack (club face hitting ball)
  const impactTime = now + 0.06;
  const impactOsc = audioCtx.createOscillator();
  impactOsc.type = 'square';
  impactOsc.frequency.setValueAtTime(3200, impactTime);
  impactOsc.frequency.exponentialRampToValueAtTime(800, impactTime + 0.02);
  const impactGain = audioCtx.createGain();
  impactGain.gain.setValueAtTime(0.8, impactTime);
  impactGain.gain.exponentialRampToValueAtTime(0.001, impactTime + 0.06);
  impactOsc.connect(impactGain);
  impactGain.connect(dest);
  impactOsc.start(impactTime);
  impactOsc.stop(impactTime + 0.07);

  // Low thump (satisfying weight)
  const thumpOsc = audioCtx.createOscillator();
  thumpOsc.type = 'sine';
  thumpOsc.frequency.setValueAtTime(150, impactTime);
  thumpOsc.frequency.exponentialRampToValueAtTime(60, impactTime + 0.08);
  const thumpGain = audioCtx.createGain();
  thumpGain.gain.setValueAtTime(0.5, impactTime);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, impactTime + 0.1);
  thumpOsc.connect(thumpGain);
  thumpGain.connect(dest);
  thumpOsc.start(impactTime);
  thumpOsc.stop(impactTime + 0.12);
}

export function playPutterSound() {
  const audioCtx = getCtx();
  const dest = masterGain ?? audioCtx.destination;
  const now = audioCtx.currentTime;

  // Soft tap: gentle high click
  const tapOsc = audioCtx.createOscillator();
  tapOsc.type = 'sine';
  tapOsc.frequency.setValueAtTime(2200, now);
  tapOsc.frequency.exponentialRampToValueAtTime(1200, now + 0.04);
  const tapGain = audioCtx.createGain();
  tapGain.gain.setValueAtTime(0.45, now);
  tapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  tapOsc.connect(tapGain);
  tapGain.connect(dest);
  tapOsc.start(now);
  tapOsc.stop(now + 0.1);

  // Soft metallic ring (putter face resonance)
  const ringOsc = audioCtx.createOscillator();
  ringOsc.type = 'sine';
  ringOsc.frequency.setValueAtTime(4400, now);
  const ringGain = audioCtx.createGain();
  ringGain.gain.setValueAtTime(0.12, now);
  ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  ringOsc.connect(ringGain);
  ringGain.connect(dest);
  ringOsc.start(now);
  ringOsc.stop(now + 0.3);
}

export function playHoleSunkSound() {
  const audioCtx = getCtx();
  const dest = masterGain ?? audioCtx.destination;
  const now = audioCtx.currentTime;

  // Ball rattling into cup — quick descending rattle
  for (let i = 0; i < 4; i++) {
    const rattleOsc = audioCtx.createOscillator();
    rattleOsc.type = 'triangle';
    const t = now + i * 0.035;
    rattleOsc.frequency.setValueAtTime(3000 - i * 400, t);
    rattleOsc.frequency.exponentialRampToValueAtTime(800, t + 0.03);
    const rattleGain = audioCtx.createGain();
    rattleGain.gain.setValueAtTime(0.35, t);
    rattleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    rattleOsc.connect(rattleGain);
    rattleGain.connect(dest);
    rattleOsc.start(t);
    rattleOsc.stop(t + 0.05);
  }

  // Hollow cup thunk
  const cupTime = now + 0.15;
  const cupOsc = audioCtx.createOscillator();
  cupOsc.type = 'sine';
  cupOsc.frequency.setValueAtTime(220, cupTime);
  cupOsc.frequency.exponentialRampToValueAtTime(120, cupTime + 0.12);
  const cupGain = audioCtx.createGain();
  cupGain.gain.setValueAtTime(0.5, cupTime);
  cupGain.gain.exponentialRampToValueAtTime(0.001, cupTime + 0.2);
  cupOsc.connect(cupGain);
  cupGain.connect(dest);
  cupOsc.start(cupTime);
  cupOsc.stop(cupTime + 0.25);

  // Celebratory ascending chime
  const chimeStart = now + 0.3;
  const chimeNotes = [523, 659, 784, 1047, 1319];
  chimeNotes.forEach((freq, i) => {
    const t = chimeStart + i * 0.08;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + 0.35);
  });
}

export function playSandSound() {
  const audioCtx = getCtx();
  const dest = masterGain ?? audioCtx.destination;
  const now = audioCtx.currentTime;
  // Muffled thud
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 300;
  osc.type = 'square';
  osc.frequency.setValueAtTime(80, now);
  osc.frequency.linearRampToValueAtTime(40, now + 0.15);
  g.gain.setValueAtTime(0.4, now);
  g.gain.linearRampToValueAtTime(0, now + 0.15);
  osc.connect(filter);
  filter.connect(g);
  g.connect(dest);
  osc.start(now);
  osc.stop(now + 0.2);
}

export function playWaterSound() {
  const audioCtx = getCtx();
  const dest = masterGain ?? audioCtx.destination;
  const now = audioCtx.currentTime;
  // Splash: filtered noise burst
  const bufSize = Math.floor(audioCtx.sampleRate * 0.4);
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filt = audioCtx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 800;
  filt.Q.value = 1.5;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.5, now);
  g.gain.linearRampToValueAtTime(0, now + 0.4);
  src.connect(filt);
  filt.connect(g);
  g.connect(dest);
  src.start(now);
  src.stop(now + 0.4);
}
