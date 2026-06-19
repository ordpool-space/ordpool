import {
  capVariableJump,
  clampPitch,
  computeMoveInput,
  derivePlayerState,
  easeAlpha,
  fovTarget,
  gravityForStep,
  SPEED_RUN_SQ as RUN_SQ,
  SPEED_WALK_SQ as WALK_SQ,
} from './bitmap-3d-physics';

describe('derivePlayerState', () => {

  it('rising velocity in air -> jumping', () => {
    expect(derivePlayerState(0, 5, 0, false, false, RUN_SQ, WALK_SQ)).toBe('jumping');
  });

  it('descending velocity in air -> falling', () => {
    expect(derivePlayerState(0, -3, 0, false, false, RUN_SQ, WALK_SQ)).toBe('falling');
  });

  it('apex (vy=0) in air -> falling, not jumping', () => {
    // The descent branch (vy <= 0) is the textbook "we are no longer rising"
    // state. Jumping is reserved for vy > 0.
    expect(derivePlayerState(0, 0, 0, false, false, RUN_SQ, WALK_SQ)).toBe('falling');
  });

  it('grounded + below walk threshold -> idle', () => {
    // hSpeedSq = 0.2^2 + 0.2^2 = 0.08, below WALK_SQ = 0.25
    expect(derivePlayerState(0.2, 0, 0.2, true, false, RUN_SQ, WALK_SQ)).toBe('idle');
  });

  it('grounded + above walk threshold + not sprinting -> walking', () => {
    // hSpeedSq = 1^2 + 0^2 = 1, above WALK_SQ
    expect(derivePlayerState(1, 0, 0, true, false, RUN_SQ, WALK_SQ)).toBe('walking');
  });

  it('grounded + sprinting + above run threshold -> running', () => {
    // hSpeedSq = 2^2 + 0^2 = 4, above RUN_SQ
    expect(derivePlayerState(2, 0, 0, true, true, RUN_SQ, WALK_SQ)).toBe('running');
  });

  it('sprinting but below run threshold -> walking (not running)', () => {
    // hSpeedSq = 1^2 + 0^2 = 1, above WALK but below RUN -- Shift held while
    // creeping shouldn't tag as 'running'. Animation/audio code reads this
    // for footstep cadence; a false 'running' would speed it up.
    expect(derivePlayerState(1, 0, 0, true, true, RUN_SQ, WALK_SQ)).toBe('walking');
  });

  it('horizontal speed uses x AND z, not just x', () => {
    // Pure-z motion must classify the same as pure-x motion. A bug that
    // only summed x² would tag a straight-Z walker as 'idle'.
    expect(derivePlayerState(0, 0, 1, true, false, RUN_SQ, WALK_SQ)).toBe('walking');
  });

  it('y-velocity does not bleed into horizontal speed', () => {
    // Grounded with vy = 99 but no horizontal motion: 'idle', not 'walking'.
    // Pin against an accidental hSpeedSq = vx² + vy² + vz² regression.
    expect(derivePlayerState(0, 99, 0, true, false, RUN_SQ, WALK_SQ)).toBe('idle');
  });
});

describe('gravityForStep', () => {
  it('rising velocity -> base gravity', () => {
    expect(gravityForStep(5, 8, 1.5)).toBe(8);
  });

  it('zero velocity (apex) -> base gravity', () => {
    // Apex is not yet descending; let it stay floaty for one tick.
    expect(gravityForStep(0, 8, 1.5)).toBe(8);
  });

  it('descending velocity -> base * fallMult', () => {
    expect(gravityForStep(-0.001, 8, 1.5)).toBe(12);
  });

  it('multiplier scales linearly', () => {
    expect(gravityForStep(-1, 10, 2)).toBe(20);
  });
});

describe('capVariableJump', () => {
  it('caps velocity above the min-jump value', () => {
    expect(capVariableJump(18, 4)).toBe(4);
  });

  it('leaves velocity at the cap unchanged', () => {
    expect(capVariableJump(4, 4)).toBe(4);
  });

  it('leaves velocity below the cap unchanged', () => {
    // Player released Space late, after the rise has already slowed below
    // min-jump: don't snap UPWARD to the cap.
    expect(capVariableJump(2, 4)).toBe(2);
  });

  it('leaves negative velocity unchanged', () => {
    // Releasing Space while already falling must not bump back to min-jump.
    expect(capVariableJump(-5, 4)).toBe(-5);
  });
});

describe('computeMoveInput', () => {
  it('all keys/joystick neutral -> {0, 0}', () => {
    expect(computeMoveInput(false, false, false, false, 0, 0)).toEqual({ fwd: 0, side: 0 });
  });

  it('W alone -> full forward', () => {
    expect(computeMoveInput(true, false, false, false, 0, 0)).toEqual({ fwd: 1, side: 0 });
  });

  it('S alone -> full backward', () => {
    expect(computeMoveInput(false, true, false, false, 0, 0)).toEqual({ fwd: -1, side: 0 });
  });

  it('D alone -> full right', () => {
    expect(computeMoveInput(false, false, false, true, 0, 0)).toEqual({ fwd: 0, side: 1 });
  });

  it('A alone -> full left', () => {
    expect(computeMoveInput(false, false, true, false, 0, 0)).toEqual({ fwd: 0, side: -1 });
  });

  it('opposing keys cancel (W+S, A+D)', () => {
    expect(computeMoveInput(true, true, true, true, 0, 0)).toEqual({ fwd: 0, side: 0 });
  });

  it('W+D clamps combined magnitude to 1 (not √2)', () => {
    // Raw (1, 1) has mag √2. Result vector must have length 1.
    const r = computeMoveInput(true, false, false, true, 0, 0);
    const mag = Math.hypot(r.fwd, r.side);
    expect(mag).toBeCloseTo(1, 10);
    expect(r.fwd).toBeCloseTo(Math.SQRT1_2, 10);
    expect(r.side).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('joystick at half deflection passes through unscaled', () => {
    // Below mag=1, no normalisation. Half-stick = half-speed.
    expect(computeMoveInput(false, false, false, false, 0.5, 0.0)).toEqual({ fwd: 0.5, side: 0 });
  });

  it('joystick adds to keyboard (combined ≤ 1 unchanged)', () => {
    // W (1) + joystick fwd=-0.3 = 0.7, no clamp triggered.
    expect(computeMoveInput(true, false, false, false, -0.3, 0)).toEqual({ fwd: 0.7, side: 0 });
  });

  it('keyboard + joystick combined past mag 1 -> clamped to 1', () => {
    // W (fwd=1) + joystick fwd=1 = raw fwd=2; clamped to length 1.
    const r = computeMoveInput(true, false, false, false, 1, 0);
    expect(r.fwd).toBeCloseTo(1, 10);
    expect(r.side).toBe(0);
  });
});

describe('clampPitch', () => {
  it('leaves a small positive pitch unchanged', () => {
    expect(clampPitch(0.5)).toBe(0.5);
  });

  it('leaves zero unchanged', () => {
    expect(clampPitch(0)).toBe(0);
  });

  it('caps near +π/2 to the limit', () => {
    expect(clampPitch(Math.PI)).toBeCloseTo(Math.PI / 2 - 0.01, 10);
  });

  it('caps near -π/2 to the negative limit', () => {
    expect(clampPitch(-Math.PI)).toBeCloseTo(-(Math.PI / 2 - 0.01), 10);
  });

  it('respects a custom margin', () => {
    expect(clampPitch(Math.PI, 0.1)).toBeCloseTo(Math.PI / 2 - 0.1, 10);
  });
});

describe('fovTarget', () => {
  it('sprinting + on-floor -> sprint FOV', () => {
    expect(fovTarget(true, true, 75, 90)).toBe(90);
  });

  it('not sprinting -> resting FOV', () => {
    expect(fovTarget(false, true, 75, 90)).toBe(75);
  });

  it('sprinting in the air -> resting FOV (no mid-jump punch)', () => {
    // Air sprint must NOT trigger the wide FOV. Sprinting mid-jump
    // visually punching the world out feels bad in playtest.
    expect(fovTarget(true, false, 75, 90)).toBe(75);
  });

  it('both flags off -> resting FOV', () => {
    expect(fovTarget(false, false, 75, 90)).toBe(75);
  });
});

describe('easeAlpha', () => {
  it('typical 60Hz frame at rate=10 -> ~0.167', () => {
    expect(easeAlpha(1 / 60, 10)).toBeCloseTo(10 / 60, 10);
  });

  it('caps at 1 on a long hitch', () => {
    // A 0.3s frame at rate=10 would give 3 — must saturate to 1, not
    // over-shoot the target.
    expect(easeAlpha(0.3, 10)).toBe(1);
  });

  it('clamps negative inputs to 0', () => {
    expect(easeAlpha(-0.01, 10)).toBe(0);
  });

  it('returns 0 for zero dt', () => {
    expect(easeAlpha(0, 10)).toBe(0);
  });
});
