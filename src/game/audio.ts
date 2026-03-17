let ctx: AudioContext | null = null;
let running = false;
let masterGain: GainNode | null = null;

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
  // Schedule ~4 seconds ahead
  const scheduleUntil = now + 4;

  while (nextScheduleTime < scheduleUntil) {
    // Bird call every 1.5–4 seconds
    const gap = 1.5 + Math.random() * 2.5;
    scheduleBirdCall(ctx, masterGain, nextScheduleTime);
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

  // Schedule immediately and then every 2 seconds
  scheduleAmbience();
  intervalId = setInterval(scheduleAmbience, 2000);
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

export function playHoleSunkSound() {
  const audioCtx = getCtx();
  const dest = masterGain ?? audioCtx.destination;
  const now = audioCtx.currentTime;
  // Short ascending fanfare
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    chirp(audioCtx, dest, now + i * 0.12, freq, 50, 0.15, 0.5);
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
