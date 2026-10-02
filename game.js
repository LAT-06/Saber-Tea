// Saber-Tea — game loop and rendering.
// Phase 0: canvas boot only. Proves the deploy path, the asset path, and
// retina-correct sizing before any game logic lands on top.

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// The canvas is laid out in CSS pixels but backed by device pixels, otherwise
// the logo is blurry on retina. setTransform means every draw call below still
// works in CSS pixels and can ignore this entirely.
let W = 0, H = 0;

function resize() {
  // Cap DPR at 2: 3x triples fill rate for no visible gain on a moving target.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);
resize();

const logo = new Image();
logo.src = 'assets/Icon Transparent.png';

function frame(ms) {
  const t = ms / 1000;

  ctx.clearRect(0, 0, W, H);

  if (logo.complete && logo.naturalWidth) {
    const size = 200 * (1 + 0.05 * Math.sin(t * 2));
    ctx.save();
    ctx.translate(W / 2, H / 2 - 40);
    ctx.shadowColor = '#a8cf8e';
    ctx.shadowBlur = 50;
    ctx.drawImage(logo, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#a8cf8e';
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.fillText('Saber-Tea', W / 2, H / 2 + 120);
  ctx.fillStyle = 'rgba(232,240,232,.45)';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('Phase 0 — canvas sống', W / 2, H / 2 + 148);
  ctx.restore();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
