// Saber-Tea — game loop and rendering.
// Phase 1: webcam in, sabers drawn on the player's hands. No blocks yet.

import { hands, status, startTracking, update as updateTracking } from './tracker.js';

const COLOR = { left: '#ff4d6d', right: '#a8cf8e' };

const canvas  = document.getElementById('stage');
const ctx     = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');
const statusEl = document.getElementById('status');

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

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    video = await startTracking();
    overlay.hidden = true;
  } catch (err) {
    // Denied permission, no camera, or insecure origin all land here. Phase 5
    // turns this into the mouse fallback; for now say why and let them retry.
    statusEl.textContent = `Không mở được camera: ${err.name || err}`;
    startBtn.disabled = false;
  }
});

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

function drawVideo(L) {
  // Mirrored so the player sees themselves as in a mirror. tracker.js already
  // flipped the landmark x to match, so screen space stays consistent.
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.globalAlpha = 0.35;
  ctx.drawImage(video, W - L.dx - L.dw, L.dy, L.dw, L.dh);
  ctx.restore();
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

  // Speed readout, so phase 1 can be eyeballed: it must spike on a fast slash.
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(hand.speed.toFixed(2), tip.x + 14, tip.y - 12);
  ctx.restore();
}

function frame(ms) {
  ctx.clearRect(0, 0, W, H);

  if (video && status.state === 'ready') {
    updateTracking();
    const L = videoLayout();
    drawVideo(L);
    drawSaber(hands.left,  COLOR.left,  L);
    drawSaber(hands.right, COLOR.right, L);

    if (!hands.left.active && !hands.right.active) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(232,240,232,.5)';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Giơ tay vào khung hình', W / 2, H - 40);
      ctx.restore();
    }
  } else if (logo.complete && logo.naturalWidth) {
    const size = 200 * (1 + 0.05 * Math.sin(ms / 500));
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.globalAlpha = 0.25;
    ctx.shadowColor = COLOR.right;
    ctx.shadowBlur = 50;
    ctx.drawImage(logo, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
