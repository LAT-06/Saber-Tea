# Saber-Tea — Design

Date: 2026-10-02
Status: approved, built through phase 5

## 1. What the game is

A browser rhythm game in the spirit of Beat Saber. Players use **both bare
hands in front of a webcam** to slash blocks flying at them in time with the
music. The blocks are the club's tea-leaf logo.

No VR, no controllers. A browser and a webcam.

### Mechanics in the first release

| Mechanic | In | Notes |
|---|---|---|
| Slash the matching colour (two hands) | ✅ | The core |
| Slash in the arrow's direction | ✅ | ±50° tolerance |
| Mouse / touch fallback | ✅ | Mandatory for a public site |
| Dodge walls (duck, lean) | ❌ | Needs Pose Landmarker; unplayable seated at a desk |

Dropping walls drops **the second model entirely**. Only Hand Landmarker
remains.

## 2. Context and constraints

- **Public web.** Anyone opens a URL, on a laptop or a phone.
- Has to survive: poor webcams, bad light, denied camera permission,
  Safari/iOS.
- **`getUserMedia` only runs over HTTPS or on `localhost`.** A hard constraint,
  and it alone decides how this deploys.
- No backend, no accounts, no database.

## 3. Three core technical decisions

### 3.1 The Z axis is a clock, not a space

A block spawns at `t` and must be cut at `t + 2s`. MediaPipe returns **2D**
hand coordinates (x, y normalised 0–1). So collision is really a problem of
**2D plus time**. No genuine 3D arithmetic happens in this game.

Consequence: **render on a 2D canvas with fake perspective** (scale by the time
remaining, converge on a vanishing point). The logo is a flat sprite, so real
3D would produce nearly the same picture while adding a layer that projects 2D
hand coordinates into a 3D space — one more place to be wrong, for no visual
gain.

Considered and rejected: Three.js (+~170KB, buys only a nicer bloom) and CSS 3D
transforms (30–60 simultaneous divs bog down, and particles are impossible).

### 3.2 Everything runs off the audio clock

A block's position is a **pure function of the audio clock**. Frame deltas are
never accumulated.

This is where every rhythm game dies: a dropped frame shifts blocks off the
music permanently and nothing brings them back. Reading the clock from the
audio itself means a dropped frame only stutters the picture.

Implementation note: playback goes through an `AudioBufferSourceNode` and the
clock is `audioCtx.currentTime - startedAt`. The buffer was already decoded for
analysis, so playing it through the same context is free, sample-accurate, and
removes the need for an `<audio>` element.

### 3.3 Flip the coordinates, not the handedness labels

> **Correction to the first draft.** The draft said the hand labels must be
> swapped. That was wrong; MediaPipe's own test image proves the opposite.

Two things that sound alike but are separate:

**Coordinates: flip them.** `x_screen = 1 - x_landmark`. The player moves right,
the saber on screen moves right, as in a mirror.

**`"Left"`/`"Right"` labels: do NOT swap.** Handedness is inferred from the
**shape** of the hand in frame, not its position, so the raw feed already names
the player's real hand.

Evidence — running the detector on the test photo `woman_hands.jpg`:

| Image | Result |
|---|---|
| Original (unmirrored) | `Left@x=0.068`, `Right@x=0.726` — matches ground truth |
| Mirrored | `Left@x=0.274`, `Right@x=0.93` — labels swap |

The real trap is the condition: **if the frame itself is ever flipped before it
reaches the detector, the labels must be swapped back.** Only the output
coordinates are flipped here, never the input pixels — so no swap. The comment
lives in `tracker.js`.

## 4. Production architecture

### 4.1 Shape of the system

**A plain static site. No backend. No build step.**

```
Player's browser
├── index.html  ──┐
├── tracker.js    │  ES modules, served as-is
├── beatmap.js    │  <script type="module">
├── game.js     ──┘
├── assets/Icon Transparent.png
│
├── jsDelivr CDN ──→ @mediapipe/tasks-vision (JS + WASM, version pinned)
├── Google CDN   ──→ hand_landmarker.task (~7.5MB, cached after first load)
└── Audio file   ──→ chosen by the player, NEVER leaves their machine
```

No webpack, no vite, no bundler. Native ES modules are enough, and skipping the
build step means deploying is just pushing code.

### 4.2 Hosting

**GitHub Pages, deploy from branch `main`, root directory.**

- The repo is already on GitHub, so Pages is free
- **HTTPS automatically** — satisfies the `getUserMedia` constraint
- Zero config: switch it on in Settings → Pages, no workflow file
- Deploying is `git push`

Live at https://lat-06.github.io/Saber-Tea/

### 4.3 Music: the player brings their own file

`<input type="file" accept="audio/*">` → `decodeAudioData`.

This solves three things at once: no bandwidth spent hosting music, **no
copyright question**, and the audio never leaves the player's machine. A short
demo track ships with the game so anyone can press play without hunting for a
file.

### 4.4 Storage

`localStorage` for the high score. That is all. No server, no accounts, no
leaderboard.

### 4.5 Performance

- Hand Landmarker runs at ~30fps, rendering at 60fps; **the latest landmark
  result is reused, never interpolated**
- The ~7.5MB model loads from Google's CDN and is cached after the first visit
- A loading state covers the first load

## 5. Detailed design

### 5.1 Files

| File | Responsibility | Depends on |
|---|---|---|
| `index.html` | canvas, hidden `<video>`, UI | — |
| `tracker.js` | MediaPipe Hands → two hand positions; pointer fallback | tasks-vision |
| `beatmap.js` | PCM → blocks, and judging a cut. **Pure, node-testable** | nothing |
| `game.js` | loop, collision, drawing, scoring | tracker, beatmap |
| `package.json` | contains only `{"type":"module"}` | — |

`beatmap.js` imports nothing from Web Audio — it takes a `Float32Array` and
returns plain objects. Decoding lives in `game.js`. That boundary is the entire
reason `node beatmap.js` can check it.

`package.json` exists for **one reason**: so `node beatmap.js` understands
`export`. No dependencies, no scripts, no install step.

### 5.2 Which landmarks are tracked

- **Landmark 8 (index fingertip)** = blade tip → used for collision and velocity
- **Landmark 0 (wrist)** = hilt → the wrist→fingertip vector draws the blade

Both come from the same detect call, so the second costs nothing.

### 5.3 Onset detection — no FFT required

```
1. PCM → mono
2. One-pole lowpass (leans on the kick drum)
3. RMS over 1024-sample windows, hop 512  (~86 frames/second at 44.1kHz)
4. Mark an onset when ALL THREE hold:
     - energy > 1.3 × the trailing 0.5s average
     - it is a local maximum
     - at least 120ms since the last onset
```

About 40 lines, no DSP library. The lowpass stands in for an FFT: enough to
catch the kick, far cheaper.

The trailing average deliberately **excludes the frame under test**, so a loud
frame cannot raise its own bar. A floor at 5% of peak stops a quiet intro from
charting hiss.

`1.3` and `120ms` are **knobs**, exposed as named constants.

### 5.4 Onsets → blocks

Hands alternate. Each hand keeps to its own half of the grid (crossovers are
miserable to hit on a webcam). Arrow direction rotates from the previous one,
avoiding a meaningless random sequence.

**Hard rule: 200ms minimum between swings of the same hand**, and an onset that
breaks it is dropped. Nobody swings faster than that.

A 4-column × 3-row grid, as in Beat Saber.

A seeded PRNG keeps charts reproducible: the same song always maps the same
way, so a bug is the same bug every run.

### 5.5 One frame

```
landmarks ← tracker (latest result)
t ← audio clock

for each live block:
    depth    = (block.time - t) / 2.0           # 2 seconds of flight
    position = perspective(depth, lane, row)

    if |t - block.time| < 0.15:                 # hit window
        if the fingertip is near the block
           and finger speed > threshold
           and angle(velocity, required direction) < 50°:
               score, burst particles, remove the block

    if t > block.time + 0.15:  count a miss, remove the block

draw
```

Finger velocity spans the last 3 frames (a slash lasts roughly 4–6 frames at
30fps).

**50° of tolerance** — wide on purpose. Webcams are noisy; tighten it and
nobody connects, and the game becomes an irritation. Another knob.

### 5.6 Colour

The logo is green. The convention:

- **Left hand** = pink-red
- **Right hand** = the logo's native green

Importantly, **the logo itself is never tinted** — hands are told apart by the
frame and glow around the block. That keeps the logo on-brand and sidesteps
patchy `ctx.filter` support.

### 5.7 Fallback

Switches to mouse/touch when the camera is refused, or after **3 continuous
seconds with no hand detected**.

In fallback, one pointer drives **both** sabers, so blocks of either colour are
reachable and the collision code needs no special case. A button switches back
to hands.

On a public site this is not a nice-to-have: without it, a large share of
visitors see a black screen.

## 6. Testing

`detectOnsets(pcm, sampleRate)` and `judgeHit(...)` are pure, so one runnable
self-check covers both:

```bash
node beatmap.js
```

22 checks. A synthetic click track verifies onset count and timing; the judging
checks pin **both sides** of every threshold (49° hits and 51° misses, 140ms
hits and 160ms misses, 69px hits and 71px misses). No framework, no fixtures.

Everything else — tracking, rendering — is checked by eye, phase by phase.
Writing tests for a webcam and a canvas costs more than it returns at this size.

## 7. Work breakdown

**Rule: finish a phase → update `CLAUDE.md` → commit → push.**

No dumping the whole game in one pass. Each phase has to run and be verifiable
before the next begins.

| Phase | Content | How it was verified |
|---|---|---|
| **0** | `index.html` + canvas. Enable GitHub Pages. | Pages URL renders |
| **1** | `tracker.js`: MediaPipe Hands, mirrored video, fingertip tracking | Test photo through a fake camera; coordinates and labels correct |
| **2** | `beatmap.js`: `detectOnsets` + `onsetsToBlocks` + self-check | `node beatmap.js` passes |
| **3** | `game.js`: pick a song, blocks fly in time. No collision. | Cursor/clock invariant, 180/180 samples |
| **4** | Collision + direction + score + combo | Threshold checks; bookkeeping balances exactly |
| **5** | Pointer fallback, particles, UI, localStorage high score | Playable with no camera at all |

Phase 0 came first on purpose: prove the deploy path works **before** writing
game logic, rather than discovering "works locally, dead on Pages" at the end.

### Commit convention

Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`.
At least one commit per phase, pushed immediately.

## 8. Deliberately not built

| Dropped | Add it when |
|---|---|
| Walls / dodging | Someone actually plays standing well back from the camera |
| Server leaderboard | Someone asks where their score ranks |
| Difficulty levels | The single difficulty has been played enough |
| Online song library | Picking a local file proves inconvenient |
| User accounts | Never, barring a clear reason |
| Service worker / offline | A real person complains about reloads |
| Build step (vite/webpack) | Native ES modules prove insufficient |
