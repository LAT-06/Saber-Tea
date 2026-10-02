// beatmap.js — audio samples in, blocks out.
//
// Deliberately free of Web Audio and of the DOM: it takes a Float32Array and
// returns plain objects. That is the whole reason `node beatmap.js` can check
// it. Decoding lives in game.js.

export const DEFAULTS = {
  lowpassHz:   200,   // kick drums live down here; everything above is noise to us
  windowSize:  1024,
  hop:         512,   // ~11.6ms at 44.1kHz
  avgSeconds:  0.5,   // trailing window the threshold is measured against
  threshold:   1.3,   // how far above the local average counts as an onset
  minGap:      0.12,  // seconds between any two onsets
  floorRatio:  0.05,  // ignore frames this quiet vs the loudest; kills silence
};

// Eight slash directions, clockwise from up. Unit vectors in screen space,
// so +y points DOWN as canvas does.
export const DIRECTIONS = [
  { name: 'up',        x:  0,     y: -1     },
  { name: 'upRight',   x:  0.707, y: -0.707 },
  { name: 'right',     x:  1,     y:  0     },
  { name: 'downRight', x:  0.707, y:  0.707 },
  { name: 'down',      x:  0,     y:  1     },
  { name: 'downLeft',  x: -0.707, y:  0.707 },
  { name: 'left',      x: -1,     y:  0     },
  { name: 'upLeft',    x: -0.707, y: -0.707 },
];

/**
 * Find note onsets in mono PCM.
 *
 * Energy-based, no FFT. A one-pole lowpass leans the signal onto the kick
 * drum, then each short window is compared against the average of the half
 * second before it. Cheap, and on music with an audible beat it lands close
 * enough that nobody can hear the difference.
 *
 * @param {Float32Array} pcm
 * @param {number} sampleRate
 * @returns {number[]} onset times in seconds, ascending
 */
export function detectOnsets(pcm, sampleRate, opts = {}) {
  const o = { ...DEFAULTS, ...opts };

  // One-pole lowpass. a is the standard RC coefficient for this cutoff.
  const a = 1 - Math.exp(-2 * Math.PI * o.lowpassHz / sampleRate);
  const low = new Float32Array(pcm.length);
  let y = 0;
  for (let i = 0; i < pcm.length; i++) {
    y += a * (pcm[i] - y);
    low[i] = y;
  }

  // RMS per window.
  const frameCount = Math.max(0, Math.floor((low.length - o.windowSize) / o.hop) + 1);
  const energy = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    const start = f * o.hop;
    for (let i = start; i < start + o.windowSize; i++) sum += low[i] * low[i];
    energy[f] = Math.sqrt(sum / o.windowSize);
  }

  let peak = 0;
  for (let f = 0; f < frameCount; f++) if (energy[f] > peak) peak = energy[f];
  const floor = peak * o.floorRatio;

  const avgFrames = Math.max(1, Math.round(o.avgSeconds * sampleRate / o.hop));
  const onsets = [];
  let lastTime = -Infinity;

  // Running sum over the trailing window, excluding the frame under test —
  // a loud frame must not be allowed to raise its own bar.
  let runningSum = 0;
  for (let f = 1; f < frameCount - 1; f++) {
    runningSum += energy[f - 1];
    if (f - 1 - avgFrames >= 0) runningSum -= energy[f - 1 - avgFrames];
    const n = Math.min(f, avgFrames);
    const avg = runningSum / n;

    if (energy[f] <= floor) continue;
    if (energy[f] <= o.threshold * avg) continue;
    if (energy[f] < energy[f - 1] || energy[f] < energy[f + 1]) continue;  // local max

    // The attack is inside this window, so the window's start is the closest
    // honest estimate of when it happened.
    const time = (f * o.hop) / sampleRate;
    if (time - lastTime < o.minGap) continue;

    onsets.push(time);
    lastTime = time;
  }

  return onsets;
}

export const BLOCK_DEFAULTS = {
  lanes:       4,
  rows:        3,
  sameHandGap: 0.2,   // nobody swings the same hand faster than this
  seed:        1337,  // fixed so the same song always maps the same way
};

/**
 * Turn onsets into blocks.
 *
 * Hands alternate, each hand keeps to its own side (crossovers are miserable
 * to hit with a webcam), and an onset is dropped outright when the hand whose
 * turn it is swung too recently.
 *
 * @param {number[]} onsets
 * @returns {{time:number, hand:string, lane:number, row:number, dir:number}[]}
 */
export function onsetsToBlocks(onsets, opts = {}) {
  const o = { ...BLOCK_DEFAULTS, ...opts };
  const rand = mulberry32(o.seed);

  const blocks = [];
  const lastSwing = { left: -Infinity, right: -Infinity };
  const lastDir   = { left: -1, right: -1 };
  let turn = 'right';

  for (const time of onsets) {
    if (time - lastSwing[turn] < o.sameHandGap) continue;

    // Left hand owns the left half of the grid, right hand the right half.
    const half = o.lanes / 2;
    const lane = turn === 'left'
      ? Math.floor(rand() * half)
      : half + Math.floor(rand() * half);

    const row = Math.floor(rand() * o.rows);

    let dir = Math.floor(rand() * DIRECTIONS.length);
    // Two identical cuts in a row for one hand reads as a stutter; nudge it.
    if (dir === lastDir[turn]) dir = (dir + 2) % DIRECTIONS.length;

    blocks.push({ time, hand: turn, lane, row, dir });
    lastSwing[turn] = time;
    lastDir[turn] = dir;
    turn = turn === 'left' ? 'right' : 'left';
  }

  return blocks;
}

/** Mix a stereo (or any-channel) AudioBuffer down to one Float32Array. */
export function toMono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i];
  for (let i = 0; i < out.length; i++) out[i] /= channels.length;
  return out;
}

// Deterministic PRNG so a song always produces the same chart. Five lines
// beats pulling in a dependency, and Math.random would make bugs unrepeatable.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Self-check: `node beatmap.js`

function ok(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  ', msg);
}

function demo() {
  const sr = 44100;
  const seconds = 10;
  const period = 0.5;                       // a kick every half second
  const pcm = new Float32Array(sr * seconds);

  // Noise floor, so the threshold logic has to actually discriminate rather
  // than just find "any sound at all".
  let n = 12345;
  const rnd = () => (n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  for (let i = 0; i < pcm.length; i++) pcm[i] = rnd() * 0.02;

  // Kicks: 80Hz sine with a fast exponential decay, which is roughly what a
  // kick drum is and sits squarely under the 200Hz lowpass.
  const truth = [];
  for (let t = period; t < seconds - period; t += period) {
    truth.push(t);
    const start = Math.round(t * sr);
    for (let i = 0; i < sr * 0.08; i++) {
      pcm[start + i] += Math.sin(2 * Math.PI * 80 * i / sr) * Math.exp(-i / (sr * 0.02));
    }
  }

  const onsets = detectOnsets(pcm, sr);

  ok(onsets.length === truth.length,
     `found ${onsets.length} onsets, expected ${truth.length}`);

  let worst = 0;
  for (let i = 0; i < Math.min(onsets.length, truth.length); i++) {
    worst = Math.max(worst, Math.abs(onsets[i] - truth[i]));
  }
  ok(worst < 0.03, `worst timing error ${(worst * 1000).toFixed(1)}ms < 30ms`);

  // Silence must produce nothing. The floor guard exists for the quiet intro
  // of a real track, where the trailing average is near zero and any hiss
  // would otherwise clear the threshold.
  ok(detectOnsets(new Float32Array(sr * 3), sr).length === 0,
     'silence yields no onsets');

  const blocks = onsetsToBlocks(onsets);
  ok(blocks.length > 0, `mapped ${blocks.length} blocks`);
  ok(blocks.every(b => b.hand === 'left' ? b.lane < 2 : b.lane >= 2),
     'each hand keeps to its own side of the grid');

  const gaps = { left: -Infinity, right: -Infinity };
  let tooFast = 0;
  for (const b of blocks) {
    if (b.time - gaps[b.hand] < BLOCK_DEFAULTS.sameHandGap) tooFast++;
    gaps[b.hand] = b.time;
  }
  ok(tooFast === 0, 'no hand is asked to swing twice within 200ms');

  ok(blocks.every(b => b.dir >= 0 && b.dir < DIRECTIONS.length), 'directions in range');

  // Same seed, same chart — otherwise a bug is a different bug every run.
  ok(JSON.stringify(onsetsToBlocks(onsets)) === JSON.stringify(blocks),
     'mapping is deterministic');
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('beatmap.js')) demo();
