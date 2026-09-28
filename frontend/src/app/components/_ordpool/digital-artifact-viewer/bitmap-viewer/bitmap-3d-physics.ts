/**
 * Pure helpers for the bitmap 3D PFP physics + state machine.
 *
 * Kept zero-dependency on three.js / Angular so they're unit-testable in
 * isolation. The renderer composes them inside its substep loop; the spec
 * pins behaviour without spinning up a WebGL context.
 */

export type PlayerState = 'idle' | 'walking' | 'running' | 'jumping' | 'falling';

/**
 * Horizontal-speed thresholds (squared, so the hot path skips sqrt).
 * Shared with the renderer's derivePlayerState call AND the jest spec,
 * so threshold changes are a single edit.
 */
export const SPEED_RUN_SQ = 1.5 * 1.5;
export const SPEED_WALK_SQ = 0.5 * 0.5;

/**
 * Player state derivation.
 *
 * On floor: 'running' (sprinting AND moving fast), 'walking' (moving), 'idle'.
 * In air: 'jumping' (rising), 'falling' (descending or apex with vy <= 0).
 *
 * Speeds are compared squared so the hot path avoids a per-frame sqrt.
 */
export const derivePlayerState = (
  velX: number,
  velY: number,
  velZ: number,
  onFloor: boolean,
  sprinting: boolean,
  runSq: number,
  walkSq: number,
): PlayerState => {
  if (!onFloor) return velY > 0 ? 'jumping' : 'falling';
  const hSpeedSq = velX * velX + velZ * velZ;
  if (sprinting && hSpeedSq > runSq) return 'running';
  if (hSpeedSq > walkSq) return 'walking';
  return 'idle';
};

/**
 * Falling-gravity multiplier (ecctrl :1428-1442 idiom).
 *
 * On the way up, base gravity. On the way down (vy < 0), gravity is
 * scaled by `fallMult` for a snappier descent. Apex stays floaty;
 * landing feels controlled.
 */
export const gravityForStep = (vy: number, baseG: number, fallMult: number): number => {
  return vy < 0 ? baseG * fallMult : baseG;
};

/**
 * Variable jump: releasing Space mid-ascent caps the upward velocity to
 * the min-jump value. Tap = small hop; hold = full arc. Returns the new
 * y-velocity (unchanged if already at or below the cap).
 */
export const capVariableJump = (vy: number, minJumpVel: number): number => {
  return vy > minJumpVel ? minJumpVel : vy;
};

/**
 * Combine keyboard + joystick axes into a clamped move vector.
 *
 * Keyboard contributes ±1 per direction; joystick adds analog [-1, 1].
 * The COMBINED magnitude is clamped to 1 so W+A doesn't move √2 faster
 * than W alone (needle:401-403 idiom).
 */
export const computeMoveInput = (
  keyW: boolean, keyS: boolean, keyA: boolean, keyD: boolean,
  joyFwd: number, joyRight: number,
): { fwd: number; side: number } => {
  const fwdRaw = (keyW ? 1 : 0) - (keyS ? 1 : 0) + joyFwd;
  const sideRaw = (keyD ? 1 : 0) - (keyA ? 1 : 0) + joyRight;
  const mag = Math.hypot(fwdRaw, sideRaw);
  if (mag <= 1) return { fwd: fwdRaw, side: sideRaw };
  const scale = 1 / mag;
  return { fwd: fwdRaw * scale, side: sideRaw * scale };
};

/**
 * Clamp camera pitch to ±(π/2 - margin) so the player can't flip over
 * the pole. `margin` keeps a small gap from the singularity (default 0.01).
 */
export const clampPitch = (rotX: number, margin: number = 0.01): number => {
  const limit = Math.PI / 2 - margin;
  if (rotX > limit) return limit;
  if (rotX < -limit) return -limit;
  return rotX;
};

/**
 * Target FOV for the FOV-on-sprint ease. Sprinting + on-floor lifts FOV
 * to the wider sprint value; otherwise (idle, walking, in-air) stays at
 * the resting PFP value. Air sprint is intentionally excluded — sprinting
 * mid-jump shouldn't visually punch the world out.
 */
export const fovTarget = (
  sprinting: boolean,
  onFloor: boolean,
  fovIdle: number,
  fovSprint: number,
): number => {
  return sprinting && onFloor ? fovSprint : fovIdle;
};

/**
 * Lerp alpha for the FOV ease (and similar exponential-decay smoothing).
 * `rate * frameDt` capped at 1 so a 60Hz frame at rate=10 gives ~0.16
 * per frame (≈100ms settle). At rate=10 with a 200ms hitch the alpha
 * saturates at 1 — we snap rather than over-shoot.
 */
export const easeAlpha = (frameDt: number, rate: number): number => {
  const a = rate * frameDt;
  return a > 1 ? 1 : a < 0 ? 0 : a;
};

/** The part of a Mondrian slot the spawn needs: its corner and its size. */
export interface SpawnSlot {
  position: { x: number; y: number };
  size: number;
}

/**
 * Z at which the walk starts, in front of the layout's +Z edge, looking
 * towards -Z.
 *
 * Far enough back that no cube's top rises more than `maxElevation`
 * radians above eye level, so the first frame shows the skyline and the
 * streets rather than the face of whichever cube happens to stand at the
 * front. Every slot counts, not only the front row: a tall cube two rows
 * in is just as much a wall. Never closer than `minGap` to the edge.
 *
 * Slot geometry matches the renderer's: a cube of side `size - 0.5`
 * spans z from `position.y - layoutHeight / 2` to that plus its side,
 * and rises from y = 0.
 */
export const spawnZ = (
  slots: readonly SpawnSlot[],
  layoutHeight: number,
  eyeY: number,
  maxElevation: number,
  minGap: number,
): number => {
  const edge = layoutHeight / 2;
  const tan = Math.tan(maxElevation);
  let z = edge + minGap;
  for (const slot of slots) {
    // A cube below eye level asks for a spot behind its own near face,
    // which the edge gap already clears, so it never moves the spawn.
    const side = slot.size - 0.5;
    const nearFace = slot.position.y - edge + side;
    z = Math.max(z, nearFace + (side - eyeY) / tan);
  }
  return z;
};
