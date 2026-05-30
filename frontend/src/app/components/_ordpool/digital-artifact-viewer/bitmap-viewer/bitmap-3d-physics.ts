/**
 * Pure helpers for the bitmap 3D PFP physics + state machine.
 *
 * Kept zero-dependency on three.js / Angular so they're unit-testable in
 * isolation. The renderer composes them inside its substep loop; the spec
 * pins behaviour without spinning up a WebGL context.
 */

export type PlayerState = 'idle' | 'walking' | 'running' | 'jumping' | 'falling';

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
