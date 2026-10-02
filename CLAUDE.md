# Saber-Tea

A browser rhythm game in the spirit of Beat Saber, but **without VR**. Players
slash incoming blocks with their bare hands in front of a webcam. The blocks are
the club's tea-leaf logo.

Full design: [`docs/superpowers/specs/2026-10-02-saber-tea-design.md`](docs/superpowers/specs/2026-10-02-saber-tea-design.md)

## Running it

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

No build step. Native ES modules, served as-is.
`getUserMedia` only works on `localhost` or HTTPS — opening the file over
`file://` gives you no webcam.

## Tests

```bash
node beatmap.js
```

Only `beatmap.js` has tests, because only `beatmap.js` is pure logic. Tracking
and rendering are checked by eye.

While a song is playing, `window.saberTea` exposes `songTime`, `cursor`,
`blocks`, `score` and `playing` for checking from the console. Timing bugs in a
rhythm game are invisible in a screenshot; they have to be measured.

**Measure inside a `requestAnimationFrame` callback, never from `setTimeout`.**
`songTime` reads the audio clock fresh while `cursor` only updates once a frame,
so sampling out of phase reports failures that are not there. (This cost an
investigation once: 16 of 21 "violations" were the measurement, and re-measuring
inside rAF gave 180 of 180 clean.)

## Files

| File | Responsibility |
|---|---|
| `index.html` | canvas, hidden `<video>`, UI |
| `game.js` | loop, collision, drawing, scoring |
| `tracker.js` | MediaPipe Hands → two hand positions; pointer fallback |
| `beatmap.js` | PCM → blocks, and judging a cut. **Pure; imports no Web Audio** |
| `package.json` | exists only so `node` understands `export`. No dependencies. |

## Three traps — read before touching the code

**1. Time comes from the audio clock, never from accumulated rAF deltas.**
A block's position is a pure function of `audioCtx.currentTime - startedAt`.
Accumulate frame deltas instead and a dropped frame shifts every block off the
music permanently, with no way back. This is where rhythm games die.

**2. The video is mirrored: `x_screen = 1 - x_landmark`.**
Without the flip, the player moves right and the picture goes left.

**3. Do NOT swap MediaPipe's `"Left"`/`"Right"` labels — as long as you feed it
the raw frame.**
Handedness is inferred from the **shape** of the hand in frame, not its
position, so a raw camera feed already reports the player's real hand.

Verified against MediaPipe's own test photo: mirroring the image swaps the
labels (`Right@x=0.726` becomes `Left@x=0.274`). That is exactly why the
**unmirrored** frame is the correct input.

The trap is in the condition: if anyone ever flips the frame itself before
handing it to the detector, the labels **must** be swapped back. Today only the
output coordinates are flipped (trap 2), never the pixels going in. Keep it
that way.

## Two coordinate spaces — do not mix them

Hand landmarks are normalised to the **camera frame**. Pointer coordinates are
normalised to the **browser window**. These are genuinely different transforms;
`layout()` in `game.js` picks one based on `status.input`. The video keeps its
own (`videoLayout()`, cover-fit), which is why pointer mode can still draw the
camera behind a saber that tracks the mouse correctly.

Velocity must also be converted to **screen space** before it is compared
against an arrow (`vel.x * L.dw`, `vel.y * L.dh`). Leave it normalised and every
diagonal is skewed by the aspect ratio.

## Pointer mode

A single pointer drives **both** sabers at once, so a block of either colour is
reachable and `checkHits()` needs no special case whatsoever. It engages when
the camera fails or after 3 seconds with no hand in frame. The corner button
switches back; it is hidden when there is no camera to switch back to.

## Score bookkeeping — the correct invariant

Not `hits + misses === cursor`. A block cut **early** (in the half-window before
`block.time`) scores immediately, but the cursor does not pass it until its
window closes. The correct form is:

```
hits + misses === cursor + (blocks already cut whose window is still open)
```

`hits + misses === cursor` holds only once everything has settled.

## Knobs worth tuning

Real music is not ideal music and real webcams are not ideal webcams. These
numbers exist to be tuned by ear and by hand:

| Constant | Default | Where |
|---|---|---|
| Onset threshold | `1.3×` trailing average | `beatmap.js` |
| Minimum gap between onsets | `120ms` | `beatmap.js` |
| Minimum gap for the same hand | `200ms` | `beatmap.js` |
| Slash direction tolerance | `50°` | `beatmap.js` (`JUDGE`) |
| Hit window | `±0.15s` | `beatmap.js` (`JUDGE`) |
| Block flight time | `2.0s` | `game.js` |
| Minimum slash speed | `3` cells/second | `game.js` |

## Progress

- [x] **Phase 0** — canvas + GitHub Pages deploy
- [x] **Phase 1** — `tracker.js`, MediaPipe Hands
- [x] **Phase 2** — `beatmap.js`, onset detection + self-check
- [x] **Phase 3** — blocks flying in time with the music
- [x] **Phase 4** — collision + direction + scoring
- [x] **Phase 5** — pointer fallback, particles, UI

Convention: finish a phase, update this file, commit, push.
Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
