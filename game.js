// Saber-Tea — game loop, collision and rendering.
//
// Reads hand (or pointer) positions from tracker.js and a chart from
// beatmap.js, and owns everything that touches the canvas or the clock.

import { hands, status, startTracking, usePointer, update as updateTracking } from './tracker.js';
import { detectOnsets, onsetsToBlocks, toMono, judgeHit, multiplier, DIRECTIONS, JUDGE } from './beatmap.js';

const COLOR  = { left: '#ff4d6d', right: '#a8cf8e' };
const TRAVEL = 2.0;    // seconds a block spends flying at the player
const DEPTH  = 5;      // perspective strength; higher means a longer tunnel
const LANES  = 4;
const ROWS   = 3;

const canvas   = document.getElementById('stage');
const ctx      = canvas.getContext('2d');
const overlay  = document.getElementById('overlay');
const startBtn = document.getElementById('start');
const statusEl = document.getElementById('status');
const songBox  = document.getElementById('song');
const fileInput = document.getElementById('file');
const demoBtn  = document.getElementById('demo');
const pointerBtn = document.getElementById('pointer');
const modeBtn  = document.getElementById('mode');
const resultEl = document.getElementById('result');

const BEST_KEY = 'saber-tea-best';

// The canvas is laid out in CSS pixels but backed by device pixels, otherwise
// everything is blurry on retina. setTransform means every draw call below
// still works in CSS pixels and can ignore this entirely.
let W = 0, H = 0;

function resize() {
  // Cap DPR at 2: 3x triples fill rate for no visible gain on a moving target.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);
resize();

const logo = new Image();
logo.src = 'assets/Icon Transparent.png';

let video = null;
let audioCtx = null;
let blocks = [];
let cursor = 0;        // first block not yet past the hit plane
let startedAt = 0;     // audioCtx.currentTime when the song began
let playing = false;
let current = null;    // the AudioBufferSourceNode that owns the current run

const score = { points: 0, combo: 0, best: 0, hits: 0, misses: 0 };
const particles = [];
let lastMs = 0;
let lastInput = null;

// --- setup -----------------------------------------------------------------

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  statusEl.textContent = 'Opening camera…';
  try {
    video = await startTracking();
    showSongs('');
  } catch (err) {
    // Denied permission, no camera, insecure origin — all land here, and all
    // mean the same thing to the player: the camera is not happening. Hand
    // them the pointer instead of a dead end.
    usePointer(true);
    showSongs(`Camera unavailable (${err.name || err}). Playing with the mouse.`);
  }
});

pointerBtn.addEventListener('click', () => {
  usePointer(true);
  showSongs('');
});

function showSongs(message) {
  startBtn.hidden = true;
  pointerBtn.hidden = true;
  songBox.hidden = false;
  statusEl.textContent = message;
}

// The auto-switch can fire mid-song when the light goes bad, so the way back
// has to be reachable without finishing the track.
modeBtn.addEventListener('click', () => {
  usePointer(status.input === 'hands');
  syncModeButton();
});

function syncModeButton() {
  // With no camera there is nothing to switch back to, so hide the control.
  modeBtn.hidden = !video;
  modeBtn.textContent = status.input === 'pointer' ? 'Use hands' : 'Use mouse';
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  // Clear it, or picking the same song twice in a row fires no change event.
  fileInput.value = '';
  await begin(() => file.arrayBuffer().then(b => audioCtx.decodeAudioData(b)));
});

demoBtn.addEventListener('click', () => begin(() => makeDemoTrack(audioCtx)));

async function begin(getBuffer) {
  songBox.hidden = true;
  statusEl.textContent = 'Analysing the track…';
  overlay.hidden = false;

  audioCtx ??= new AudioContext();
  await audioCtx.resume();

  let buffer;
  try {
    buffer = await getBuffer();
  } catch (err) {
    statusEl.textContent = `Could not read that audio file: ${err.name || err}`;
    songBox.hidden = false;
    return;
  }

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const onsets = detectOnsets(toMono(channels), buffer.sampleRate);
  blocks = onsetsToBlocks(onsets);
  cursor = 0;
  particles.length = 0;
  Object.assign(score, { points: 0, combo: 0, best: 0, hits: 0, misses: 0 });

  if (!blocks.length) {
    statusEl.textContent = 'No beat found in that file. Try another track.';
    songBox.hidden = false;
    return;
  }

  // Stop whatever was playing before taking ownership. Without the identity
  // guard below, a previous source's onended would fire later and drop the
  // player out of the run they are in the middle of.
  current?.stop();

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);

  // Both onended callbacks are queued, never synchronous, so by the time any of
  // them runs `current` already names the run that owns the screen.
  source.onended = () => { if (current === source) finish(); };

  // The first block must still get its full flight time, so the music starts
  // TRAVEL seconds late and the clock is anchored to that same moment.
  startedAt = audioCtx.currentTime + TRAVEL;
  source.start(startedAt);

  // Assigned last so `current` only ever names a source that was started —
  // stop() on a source that never started throws.
  current = source;

  playing = true;
  overlay.hidden = true;
  resultEl.hidden = true;
  syncModeButton();
}

function finish() {
  playing = false;

  const total = score.hits + score.misses;
  const accuracy = total ? Math.round(score.hits / total * 100) : 0;
  const previous = Number(localStorage.getItem(BEST_KEY)) || 0;
  const isBest = score.points > previous;
  if (isBest) localStorage.setItem(BEST_KEY, String(score.points));

  resultEl.innerHTML = `
    <div class="big">${score.points.toLocaleString('en-US')}</div>
    <div class="row">${accuracy}% accuracy · ${score.hits}/${total} blocks · ${score.best} combo</div>
    <div class="row ${isBest ? 'best' : ''}">${
      isBest ? 'New high score!' : `Best: ${Math.max(previous, score.points).toLocaleString('en-US')}`
    }</div>`;

  resultEl.hidden = false;
  overlay.hidden = false;
  songBox.hidden = false;
  statusEl.textContent = '';
}

// Deterministic 120 BPM beat, built in a few lines rather than shipping an mp3:
// no copyright question, nothing to download, and it starts instantly.
//
// The kick pattern is syncopated on purpose. A kick on every beat charts as a
// metronome, which is a dull first impression for everyone who clicks "demo".
// Only the kick drives the chart — the lowpass rejects the hats, which are
// there for the ear alone.
const DEMO_KICKS = [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,1,0,0];   // 16th notes, one bar

function makeDemoTrack(ctx) {
  const sr = ctx.sampleRate;
  const seconds = 60;
  const buffer = ctx.createBuffer(1, sr * seconds, sr);
  const out = buffer.getChannelData(0);
  const step = 0.125;                       // a 16th note at 120 BPM

  const add = (at, dur, fn) => {
    const start = Math.round(at * sr);
    for (let i = 0; i < sr * dur && start + i < out.length; i++) out[start + i] += fn(i);
  };

  for (let s = 0; s * step < seconds - 1; s++) {
    const at = s * step;

    if (DEMO_KICKS[s % DEMO_KICKS.length]) {
      add(at, 0.1, i => Math.sin(2 * Math.PI * 80 * i / sr) * Math.exp(-i / (sr * 0.03)) * 0.8);
    }
    if (s % 8 === 4) {    // snare on the backbeat
      add(at, 0.08, i => (Math.random() - 0.5) * Math.exp(-i / (sr * 0.02)) * 0.4);
    }
    if (s % 2 === 1) {    // offbeat hat
      add(at, 0.03, i => (Math.random() - 0.5) * Math.exp(-i / (sr * 0.006)) * 0.18);
    }
  }
  return buffer;
}

// --- geometry --------------------------------------------------------------

// The camera is 4:3 but the canvas is any shape, so the video is cover-fitted.
// Hand landmarks are normalised to the VIDEO frame, so they must go through
// this exact same transform or the sabers drift away from the real hands.
function videoLayout() {
  const scale = Math.max(W / video.videoWidth, H / video.videoHeight);
  const dw = video.videoWidth  * scale;
  const dh = video.videoHeight * scale;
  return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh };
}

function toScreen(p, L) {
  return { x: L.dx + p.x * L.dw, y: L.dy + p.y * L.dh };
}

// Hand landmarks are normalised to the CAMERA frame; pointer coordinates are
// normalised to the WINDOW. Two genuinely different transforms, so the input
// mode picks which one aiming goes through. The video keeps its own.
function layout() {
  if (status.input === 'hands' && video) return videoLayout();
  return { dx: 0, dy: 0, dw: W, dh: H };
}

// The grid the blocks arrive on, in screen pixels.
function grid() {
  const w = Math.min(W * 0.72, 620);
  const cell = w / LANES;
  return { cx: W / 2, cy: H * 0.52, cell, w, h: cell * ROWS };
}

function laneCenter(g, lane, row) {
  return {
    x: g.cx + (lane - (LANES - 1) / 2) * g.cell,
    y: g.cy + ((ROWS - 1) / 2 - row) * g.cell,   // row 0 is the bottom row
  };
}

// A block at depth d (1 = just spawned, 0 = at the hit plane) sits on the ray
// from the vanishing point out to its lane. Pure perspective, no 3D needed.
function project(target, d, g) {
  const scale = 1 / (1 + d * DEPTH);
  return {
    x: g.cx + (target.x - g.cx) * scale,
    y: g.cy + (target.y - g.cy) * scale,
    scale,
  };
}

// --- drawing ---------------------------------------------------------------

function drawVideo(L) {
  // Mirrored so the player sees themselves as in a mirror. tracker.js already
  // flipped the landmark x to match, so screen space stays consistent.
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.globalAlpha = 0.28;
  ctx.drawImage(video, W - L.dx - L.dw, L.dy, L.dw, L.dh);
  ctx.restore();
}

function drawGrid(g) {
  ctx.save();
  ctx.strokeStyle = 'rgba(168,207,142,.13)';
  ctx.lineWidth = 1;
  for (let lane = 0; lane < LANES; lane++) {
    for (let row = 0; row < ROWS; row++) {
      const c = laneCenter(g, lane, row);
      ctx.strokeRect(c.x - g.cell / 2, c.y - g.cell / 2, g.cell, g.cell);
    }
  }
  ctx.restore();
}

function drawBlock(block, songTime, g) {
  const d = (block.time - songTime) / TRAVEL;
  const p = project(laneCenter(g, block.lane, block.row), d, g);
  const size = g.cell * 0.82 * p.scale;
  const color = COLOR[block.hand];

  // Fade in on spawn so blocks do not pop into existence at the vanishing point.
  ctx.save();
  ctx.globalAlpha = Math.min(1, (1 - d) * 3);
  ctx.translate(p.x, p.y);

  // The club logo is never tinted — the two hands are told apart by the frame
  // and glow around it, which also sidesteps patchy ctx.filter support.
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18 * p.scale;
  ctx.lineWidth = Math.max(1, 3 * p.scale);
  roundRect(-size / 2, -size / 2, size, size, size * 0.18);
  ctx.stroke();

  ctx.shadowBlur = 0;
  if (logo.complete && logo.naturalWidth) {
    const inner = size * 0.74;
    ctx.drawImage(logo, -inner / 2, -inner / 2, inner, inner);
  }

  // Cut direction, drawn on the face like Beat Saber's arrow.
  const dir = DIRECTIONS[block.dir];
  const a = size * 0.26;
  ctx.translate(dir.x * size * 0.3, dir.y * size * 0.3);
  ctx.rotate(Math.atan2(dir.y, dir.x) + Math.PI / 2);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -a * 0.55);
  ctx.lineTo(a * 0.45, a * 0.3);
  ctx.lineTo(-a * 0.45, a * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function drawSaber(hand, color, L) {
  if (!hand.active) return;

  const tip   = toScreen(hand.tip, L);
  const wrist = toScreen(hand.wrist, L);

  // Extend the wrist->fingertip line past the fingertip so it reads as a blade
  // rather than a finger.
  const bx = tip.x + (tip.x - wrist.x) * 0.8;
  const by = tip.y + (tip.y - wrist.y) * 0.8;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;

  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.moveTo(wrist.x, wrist.y); ctx.lineTo(bx, by); ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(wrist.x, wrist.y); ctx.lineTo(bx, by); ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(tip.x, tip.y, 9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// --- loop ------------------------------------------------------------------

function frame(ms) {
  ctx.clearRect(0, 0, W, H);

  // Particles are cosmetic, so a frame delta is the right clock for them —
  // unlike blocks, nothing about them has to stay in step with the music.
  const dt = Math.min(0.05, (ms - lastMs) / 1000) || 0;
  lastMs = ms;

  updateTracking();

  // The mode can flip on its own when the camera stops seeing hands, so the
  // button is resynced on change rather than rewritten every frame.
  if (status.input !== lastInput) {
    lastInput = status.input;
    syncModeButton();
  }

  if (video) drawVideo(videoLayout());
  const L = layout();

  if (playing) {
    // Every block position below is a pure function of this one number.
    // Accumulating rAF deltas instead would drift out of the music and never
    // recover.
    const songTime = audioCtx.currentTime - startedAt;
    const g = grid();
    drawGrid(g);

    retire(songTime);
    checkHits(songTime, g, L);

    // Painter's algorithm: the farthest block is drawn first, so nearer ones
    // overlap it correctly.
    let last = cursor;
    while (last < blocks.length && blocks[last].time - songTime < TRAVEL) last++;
    for (let i = last - 1; i >= cursor; i--) {
      if (!blocks[i].hit) drawBlock(blocks[i], songTime, g);
    }
  }

  else drawIdle(ms);

  updateParticles(dt);

  if (status.input === 'pointer') {
    // One pointer, one blade. It cuts either colour, so the core is neutral
    // rather than claiming to be a hand.
    drawSaber(hands.right, '#e8f0e8', L);
  } else {
    drawSaber(hands.left,  COLOR.left,  L);
    drawSaber(hands.right, COLOR.right, L);
    if (!hands.left.active && !hands.right.active) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(232,240,232,.5)';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Raise your hands into frame', W / 2, H - 40);
      ctx.restore();
    }
  }

  if (playing) drawHud();

  requestAnimationFrame(frame);
}

// --- scoring ---------------------------------------------------------------

// A block whose window has closed is gone, hit or not. Walking the cursor here
// rather than scanning the whole chart keeps this O(blocks that just expired).
function retire(songTime) {
  while (cursor < blocks.length && songTime > blocks[cursor].time + JUDGE.window) {
    if (!blocks[cursor].hit) {
      score.misses++;
      score.combo = 0;
    }
    cursor++;
  }
}

function checkHits(songTime, g, L) {
  const reach = g.cell * 0.6;
  const minSpeed = g.cell * 3;   // must cross three cells a second to count

  for (let i = cursor; i < blocks.length && blocks[i].time - songTime <= JUDGE.window; i++) {
    const block = blocks[i];
    if (block.hit) continue;

    const hand = hands[block.hand];
    if (!hand.active) continue;

    // Velocity is normalised to the video frame; the arrow is drawn in screen
    // space. Converting here keeps the angle test honest on any aspect ratio.
    const vel = { x: hand.vel.x * L.dw, y: hand.vel.y * L.dh };
    const target = laneCenter(g, block.lane, block.row);

    if (judgeHit(block, songTime, toScreen(hand.tip, L), vel, target, reach, minSpeed) !== 'hit') continue;

    block.hit = true;
    score.hits++;
    score.combo++;
    score.best = Math.max(score.best, score.combo);
    score.points += 100 * multiplier(score.combo);
    burst(target.x, target.y, COLOR[block.hand]);
  }
}

function burst(x, y, color) {
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 120 + Math.random() * 280;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color });
  }
}

function updateParticles(dt) {
  ctx.save();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt * 1.8;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 420 * dt;            // a little gravity so sparks fall away

    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.restore();
}

function drawHud() {
  const total = score.hits + score.misses;
  const accuracy = total ? Math.round(score.hits / total * 100) : 100;
  const mult = multiplier(score.combo);

  ctx.save();
  ctx.fillStyle = '#e8f0e8';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.fillText(score.points.toLocaleString('en-US'), 20, 42);

  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = score.combo > 0 ? COLOR.right : 'rgba(232,240,232,.4)';
  ctx.fillText(`combo ${score.combo}  ×${mult}`, 20, 66);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(232,240,232,.5)';
  ctx.fillText(`${accuracy}%  ·  ${score.hits}/${total}`, W - 20, 42);
  ctx.restore();
}

function drawIdle(ms) {
  if (!logo.complete || !logo.naturalWidth) return;
  const size = 200 * (1 + 0.05 * Math.sin(ms / 500));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.globalAlpha = 0.25;
  ctx.shadowColor = COLOR.right;
  ctx.shadowBlur = 50;
  ctx.drawImage(logo, -size / 2, -size / 2, size, size);
  ctx.restore();
}

// Debug handle. Timing bugs in a rhythm game are invisible in a screenshot —
// this is how the sync invariant gets checked, from the console or a test.
window.saberTea = {
  get songTime() { return playing ? audioCtx.currentTime - startedAt : null; },
  get cursor()   { return cursor; },
  get blocks()   { return blocks; },
  get playing()  { return playing; },
  get score()    { return score; },
  grid, laneCenter, toScreen, videoLayout,
};

requestAnimationFrame(frame);
