// tracker.js — webcam hands become saber tips.
//
// Exposes two landmarks per hand: the index fingertip is the blade tip (used
// for collision and slash velocity), the wrist is the hilt (used to draw the
// blade). Both arrive in a single detect call, so the second one is free.

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const TIP = 8;    // index fingertip
const WRIST = 0;

// Coordinates are normalised 0..1 with the mirror flip already applied, so
// everything downstream can treat them as screen space and forget the camera.
function emptyHand() {
  return {
    active: false,
    tip:   { x: 0, y: 0 },
    wrist: { x: 0, y: 0 },
    vel:   { x: 0, y: 0 },   // normalised units per second
    speed: 0,
    history: [],             // {x, y, t} ring, newest last, max 3
  };
}

export const hands = { left: emptyHand(), right: emptyHand() };

// `input` is how the player is actually aiming right now: 'hands' or 'pointer'.
export const status = { state: 'idle', message: '', input: 'hands' };

const NO_HANDS_SECONDS = 3;   // give up on the camera after this long with nothing

let video = null;
let landmarker = null;
let lastVideoTime = -1;
let lastHandAt = 0;
let pointerBound = false;

function setStatus(state, message = '') {
  status.state = state;
  status.message = message;
}

export async function startTracking() {
  setStatus('loading', 'Opening camera…');

  video = document.createElement('video');
  video.playsInline = true;      // iOS refuses to play inline without this
  video.muted = true;
  video.style.display = 'none';
  document.body.appendChild(video);

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  setStatus('loading', 'Loading hand tracking model…');

  const { FilesetResolver, HandLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);

  landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
  });

  lastHandAt = performance.now() / 1000;
  setStatus('ready');
  status.input = 'hands';
  return video;
}

// --- pointer fallback ------------------------------------------------------
//
// One pointer drives BOTH sabers, so a block of either colour is reachable and
// the collision code in game.js needs no special case for this mode.
//
// Pointer coordinates are normalised to the window, not to the camera frame.
// The caller picks the matching transform — see layout() in game.js.

export function usePointer(on) {
  status.input = on ? 'pointer' : 'hands';

  if (on && !pointerBound) {
    pointerBound = true;
    addEventListener('pointermove', onPointer, { passive: true });
    addEventListener('pointerdown', onPointer, { passive: true });
  }
  if (!on) {
    hands.left = emptyHand();
    hands.right = emptyHand();
    lastHandAt = performance.now() / 1000;
  }
}

function onPointer(event) {
  if (status.input !== 'pointer') return;

  const x = event.clientX / window.innerWidth;
  const y = event.clientY / window.innerHeight;
  const now = performance.now() / 1000;

  for (const key of ['left', 'right']) {
    const hand = hands[key];
    hand.active = true;
    hand.tip.x = x;
    hand.tip.y = y;
    pushHistory(hand, now);

    // Trail the hilt behind the swing so the blade reads as a blade. Falls
    // back to pointing straight up when the pointer is sitting still.
    if (hand.speed > 0.01) {
      hand.wrist.x = x - hand.vel.x / hand.speed * 0.12;
      hand.wrist.y = y - hand.vel.y / hand.speed * 0.12;
    } else {
      hand.wrist.x = x;
      hand.wrist.y = y + 0.12;
    }
  }
}

export function stopTracking() {
  video?.srcObject?.getTracks().forEach(t => t.stop());
  landmarker?.close();
  landmarker = null;
  hands.left = emptyHand();
  hands.right = emptyHand();
  setStatus('idle');
}

// Call once per rendered frame. The camera runs at ~30fps while rendering runs
// at 60, so most calls find no new camera frame and simply keep the last
// result — cheaper than interpolating, and a stale frame is 16ms old at worst.
export function update() {
  if (status.input === 'pointer') return;        // pointer events drive hands directly
  if (!landmarker || !video || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now() / 1000;
  ingest(landmarker.detectForVideo(video, performance.now()), now);

  // Bad light, no hands in shot, or a camera pointed at the ceiling all look
  // the same from here. Rather than leave the player staring at nothing, hand
  // them a pointer; the UI offers the way back.
  if (hands.left.active || hands.right.active) lastHandAt = now;
  else if (now - lastHandAt > NO_HANDS_SECONDS) usePointer(true);
}

function ingest(result, now) {
  const seen = { left: false, right: false };
  const labels = result.handednesses;

  for (let i = 0; i < result.landmarks.length; i++) {
    // Handedness comes from the SHAPE of the hand in the frame, not its
    // position, so the raw camera feed yields the player's true handedness —
    // do NOT swap it here. (Verified: mirroring the input image swaps the
    // labels, which is exactly why the raw, unmirrored feed is correct.)
    //
    // The corollary is the trap: if you ever flip the video itself before
    // handing it to the detector, you must swap the labels back. We flip only
    // the output coordinates below, never the pixels going in.
    const label = labels[i]?.[0]?.categoryName;
    const key = label === 'Left' ? 'left' : 'right';
    if (seen[key]) continue;        // two hands labelled the same: keep the first
    seen[key] = true;

    const lm = result.landmarks[i];
    const hand = hands[key];

    // Mirror: the player sees themselves as in a mirror, so x is flipped.
    hand.tip.x   = 1 - lm[TIP].x;
    hand.tip.y   = lm[TIP].y;
    hand.wrist.x = 1 - lm[WRIST].x;
    hand.wrist.y = lm[WRIST].y;
    hand.active  = true;

    pushHistory(hand, now);
  }

  for (const key of ['left', 'right']) {
    if (seen[key]) continue;
    hands[key].active = false;
    hands[key].history.length = 0;
    hands[key].speed = 0;
    hands[key].vel.x = hands[key].vel.y = 0;
  }
}

// Velocity spans two frame gaps (~66ms at 30fps). One gap is too noisy to give
// a stable slash direction; three lags far enough to clip the start of a slash.
// Deliberately unsmoothed — smoothing position would blunt exactly the fast
// motion the game needs to detect.
function pushHistory(hand, now) {
  hand.history.push({ x: hand.tip.x, y: hand.tip.y, t: now });
  if (hand.history.length > 3) hand.history.shift();

  const h = hand.history;
  if (h.length < 2) {
    hand.vel.x = hand.vel.y = hand.speed = 0;
    return;
  }

  const a = h[0];
  const b = h[h.length - 1];
  const dt = b.t - a.t;
  if (dt <= 0) return;

  hand.vel.x = (b.x - a.x) / dt;
  hand.vel.y = (b.y - a.y) / dt;
  hand.speed = Math.hypot(hand.vel.x, hand.vel.y);
}
