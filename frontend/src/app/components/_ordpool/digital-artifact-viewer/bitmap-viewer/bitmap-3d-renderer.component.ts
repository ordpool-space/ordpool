import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, inject, Input, NgZone, OnDestroy, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-bitmap-3d-renderer',
  template: `<div #host class="bitmap3d-host"></div>`,
  styles: [`
    :host { display: block; width: 100%; aspect-ratio: 1 / 1; max-width: 600px; }
    .bitmap3d-host { position: relative; width: 100%; height: 100%; }
    .bitmap3d-host > canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; display: block; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class Bitmap3dRendererComponent implements AfterViewInit, OnDestroy {

  private zone = inject(NgZone);

  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  private _sizes: number[] | null = null;
  @Input()
  public set sizes(s: number[] | null | undefined) {
    const value = Array.isArray(s) && s.length > 0 ? s : null;
    if (this._sizes === value) {
      return;
    }
    this._sizes = value;
    void this.rebuild();
  }

  // pfp / exit Inputs trigger STATE TRANSITIONS, not rebuilds. The scene
  // stays alive (cubes, octree, capsule, listeners) and the animate loop's
  // state machine handles the transition. Rebuilds are reserved for `sizes`
  // changes -- those genuinely need a fresh scene.
  private _pfp = false;
  @Input()
  public set pfp(v: boolean | null | undefined) {
    const value = v === true;
    if (this._pfp === value) return;
    this._pfp = value;
    this.dispatch?.();
  }

  private _exit = false;
  @Input()
  public set exit(v: boolean | null | undefined) {
    const value = v === true;
    if (this._exit === value) return;
    this._exit = value;
    this.dispatch?.();
  }

  // Emitted when an exit-to-iso back-fly finishes (because `exit` was set).
  // Parent uses this to tear the renderer down and flip to 2D mode.
  @Output() exitDone = new EventEmitter<void>();

  // Set inside renderCubes(): a closure that re-evaluates state when the
  // pfp/exit Inputs change. Lets the setters dispatch transitions without
  // having to wire through method args.
  private dispatch: (() => void) | null = null;


  // Cleanup handles. Animation frame + WebGL context disposal are critical;
  // without them three.js leaks GPU memory across height switches.
  private animFrame: number | null = null;
  private cleanup: (() => void) | null = null;

  async ngAfterViewInit(): Promise<void> {
    await this.rebuild();
  }

  ngOnDestroy(): void {
    this.disposeStage();
  }

  private async rebuild(): Promise<void> {
    this.disposeStage();
    if (this._sizes === null || !this.host?.nativeElement) {
      return;
    }
    await this.renderCubes(this._sizes);
  }

  private async renderCubes(sizes: number[]): Promise<void> {
    // Dynamic imports: three.js + addons land in a separate webpack chunk.
    // Visitors who never open a .bitmap inscription pay zero bytes for this.
    const [THREE, { OrbitControls }, { Octree }, { Capsule }, { EffectComposer }, { SAOPass }, { SSAARenderPass },
           { LineSegments2 }, { LineSegmentsGeometry }, { LineMaterial }, parser] = await Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      // FPS-demo pattern: Octree for the static world + Capsule for the player.
      // PointerLockControls is skipped on purpose -- the upstream games_fps
      // demo wires pointer lock by hand (4 lines) and integrates the substep
      // loop directly, which is what we follow below.
      import('three/examples/jsm/math/Octree.js'),
      import('three/examples/jsm/math/Capsule.js'),
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/SAOPass.js'),
      import('three/examples/jsm/postprocessing/SSAARenderPass.js'),
      import('three/examples/jsm/lines/LineSegments2.js'),
      import('three/examples/jsm/lines/LineSegmentsGeometry.js'),
      import('three/examples/jsm/lines/LineMaterial.js'),
      import('ordpool-parser'),
    ]);

    // Three.js r155 (July 2023) made ColorManagement.enabled = true and
    // outputColorSpace = SRGBColorSpace defaults. Both turn brand orange
    // into a muddy brown under the lighting pipeline. Bitlodo's reference
    // renderer explicitly disables ColorManagement; we mirror that AND
    // switch outputColorSpace to LinearSRGBColorSpace, which together
    // give us back the pre-r155 colour behaviour the bitmap aesthetic
    // was designed around.
    THREE.ColorManagement.enabled = false;

    if (this._sizes === null || !this.host?.nativeElement) {
      return;
    }

    const hostEl = this.host.nativeElement;
    const rect = hostEl.getBoundingClientRect();
    const width = Math.max(64, rect.width);
    const heightPx = Math.max(64, rect.height);

    const mondrian = new parser.MondrianLayout(sizes);
    const layoutSize = mondrian.getSize();
    const maxSize = Math.max(layoutSize.width, layoutSize.height);
    const maxHeight = sizes.reduce((m, s) => (s > m ? s : m), 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, heightPx);
    renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap throws a deprecation warning under the SSAA+SAO pipeline
    // ("Using PCFShadowMap instead") -- just ask for the non-soft variant up
    // front so the console stays quiet.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Pair with ColorManagement.enabled = false above to restore pre-r155
    // colour fidelity.
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild);
    hostEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Iso FOV (15°) is the default; we lerp to 75° during fly-to-pfp and
    // back to 15° during fly-to-iso so the perspective shift accompanies
    // the camera sweep.
    const FOV_ISO = 15;
    const FOV_PFP = 75;
    const camera = new THREE.PerspectiveCamera(FOV_ISO, width / heightPx, 0.05, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    // Polar = 0 is straight up, π/2 is at the horizon, π is straight down.
    // Cap at π/2 - 0.01 so the camera can't dip below the ground plane and
    // see the bitmap from underneath (breaks immersion when orbiting).
    controls.maxPolarAngle = Math.PI / 2 - 0.01;

    // One InstancedMesh, one cube per tx. Scaled in all three dimensions
    // by its log-size, so taller cubes = bigger txs.
    const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
    cubeGeometry.translate(0.5, 0.5, 0.5);
    // MeshLambert is matte -- no specular highlights. MeshPhong's default
    // shininess of 30 was the reason cube tops blew out under the
    // directional light during the grow phase.
    const material = new THREE.MeshLambertMaterial();
    const instances = new THREE.InstancedMesh(cubeGeometry, material, sizes.length);
    instances.frustumCulled = false;
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instances.castShadow = true;
    instances.receiveShadow = true;
    const container = new THREE.Group();
    scene.add(container);
    container.add(instances);

    // Ordpool orange (#FF9900, var(--primary)). Read the CSS variable so any
    // future theme change carries through.
    const cssOrange = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    const orange = new THREE.Color(cssOrange || '#FF9900');
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const sca = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    for (let i = 0; i < sizes.length; i++) {
      const slot = mondrian.slots[i];
      const s = slot.size - 0.5;
      pos.set(slot.position.x, 0, slot.position.y);
      sca.set(s, s, s);
      matrix.compose(pos, rot, sca);
      instances.setMatrixAt(i, matrix);
      instances.setColorAt(i, orange);
    }

    container.position.set(-layoutSize.width / 2, 0, -layoutSize.height / 2);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(maxSize * 2, maxSize * 2),
      new THREE.ShadowMaterial({ opacity: 0.1 }),
    );
    ground.receiveShadow = true;
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Tron-style grid on the floor. Each cell is one layout unit. The floor
    // extends 5x the bitmap on each side so the "edge of the world" stays
    // out of frame when the user orbits low. Lines drop just below y=0 so
    // they don't paint over the bottoms of the flat cubes during the intro.
    // Uses LineSegments2 + LineMaterial because LineBasicMaterial.linewidth
    // is silently ignored on WebGL (browsers cap it at 1px); the fat-line
    // shader-based variant gives us a real 2-pixel line.
    // Step the grid by 1/CELLS_PER_BITMAP of the bitmap's actual dimensions
    // on each axis, so the outer edges of the bitmap land exactly on grid
    // lines (otherwise non-square bitmaps -- the common case -- leave the
    // shorter edge floating between lines). The floor extends ~5x beyond
    // the bitmap on each side; we walk outward from the centre in step
    // increments until we leave that box.
    const CELLS_PER_BITMAP = 4;
    const FLOOR_RADIUS_MULT = 5;
    const stepX = layoutSize.width / CELLS_PER_BITMAP;
    const stepZ = layoutSize.height / CELLS_PER_BITMAP;
    const halfX = maxSize * FLOOR_RADIUS_MULT;
    const halfZ = maxSize * FLOOR_RADIUS_MULT;
    const stepsOutwardX = Math.ceil(halfX / stepX);
    const stepsOutwardZ = Math.ceil(halfZ / stepZ);
    const gridColor = orange.clone().multiplyScalar(0.3);
    const gridPositions: number[] = [];
    // Lines parallel to X (constant z)
    for (let i = -stepsOutwardZ; i <= stepsOutwardZ; i++) {
      const z = i * stepZ;
      gridPositions.push(-halfX, 0, z,  halfX, 0, z);
    }
    // Lines parallel to Z (constant x)
    for (let i = -stepsOutwardX; i <= stepsOutwardX; i++) {
      const x = i * stepX;
      gridPositions.push(x, 0, -halfZ,  x, 0,  halfZ);
    }
    const gridGeom = new LineSegmentsGeometry();
    gridGeom.setPositions(gridPositions);
    const gridMat = new LineMaterial({
      color: gridColor.getHex(),
      linewidth: 1,           // 1px screen-space (fat-line shader) -- thin Tron lines
      worldUnits: false,
      transparent: false,
    });
    gridMat.resolution.set(width, heightPx);
    const grid = new LineSegments2(gridGeom, gridMat);
    // Grid sits on the ground at y=0. Cubes always carry SCALE_MIN height,
    // so their bottoms occlude the grid below them; no need to drop the
    // grid into the basement anymore. Tiny +Y nudge to dodge z-fight with
    // the ShadowMaterial ground plane.
    grid.position.y = 0.001;
    scene.add(grid);

    // Static "sun" positioned upper-right of the layout relative to the
    // iso-corner camera (which sits at (+, +, +)). With this placement at
    // the final rotation:
    //   - top face   (+Y): receives the strongest light
    //   - +X side    : medium-lit (the "right" face from the iso camera)
    //   - +Z side    : in shadow (the "left" face from the iso camera)
    // Sun stays fixed in world space as the user orbits, which is what
    // real lighting does. Intensities are tuned for the post-r155 physical-
    // light model: lower ambient than legacy (3 -> 1.2) so unlit faces
    // actually read as shadow, higher directional (0.4 -> 1.6) so the lit
    // face stands out.
    const directional = new THREE.DirectionalLight(new THREE.Color('white'), 1.6);
    directional.position.set(maxSize * 0.6, maxSize * 2.2, -maxSize * 0.6);
    directional.target.position.set(0, 0, 0);
    directional.castShadow = true;
    directional.shadow.mapSize.set(2048, 2048);
    directional.shadow.camera.near = 0.1;
    directional.shadow.camera.far = maxSize * 6;
    directional.shadow.camera.left = -maxSize;
    directional.shadow.camera.right = maxSize;
    directional.shadow.camera.top = maxSize;
    directional.shadow.camera.bottom = -maxSize;
    scene.add(directional);
    scene.add(directional.target);
    scene.add(new THREE.AmbientLight(new THREE.Color('white'), 1.2));

    // fitDist = perpendicular distance needed to make the bitmap fit the
    // viewport exactly (apparent width = maxSize). The previous formula
    // used Math.atan instead of Math.tan -- at fov=15° the two are numerically
    // close, but it's the wrong identity. Fix while we're here.
    const fitHeightDist = maxSize / (2 * Math.tan((Math.PI * camera.fov) / 360));
    const fitWidthDist = fitHeightDist / camera.aspect;
    const fitDist = Math.max(fitHeightDist, fitWidthDist);
    // cameraDistance = fitDist puts the bitmap right up to the canvas edges
    // at top-down (matching the 2D SVG's viewBox-tight layout). The iso-
    // corner diamond is narrower than the square, so nothing clips when the
    // camera tilts. Tuned empirically; do not change without re-checking
    // both the top-down start frame and the iso-corner final pose.
    const cameraDistance = fitDist;

    controls.target.set(0, maxHeight / 2, 0);
    camera.near = cameraDistance / 100;
    camera.far = cameraDistance * 100;
    camera.updateProjectionMatrix();

    // Both start and final cameras sit at MAGNITUDE = cameraDistance from
    // target, so the apparent grid size stays constant through the tween.
    // Previously the iso corner was at magnitude sqrt(3/2)*distance ≈
    // 1.22*distance -- farther than the perpendicular fit distance, which
    // is the second reason the bitmap looked too small.
    const finalCamera = new THREE.Vector3(
      cameraDistance / Math.sqrt(3),
      cameraDistance / Math.sqrt(3),
      cameraDistance / Math.sqrt(3),
    );
    const startCamera = new THREE.Vector3(0, cameraDistance, 0);

    // OrbitControls would collapse our orientation cue (project to spherical
    // and back) -- the start state needs to be driven directly. We set
    // camera.up explicitly to (0, 0, -1), which forces screen-up to align
    // with world -Z, matching the 2D view (slot.y=0 at the top of the
    // screen). During the intro we lerp up FROM (0,0,-1) TO (0,1,0) so the
    // camera handoff to OrbitControls (phase 3) lands on its expected up.
    const startUp = new THREE.Vector3(0, 0, -1);
    const finalUp = new THREE.Vector3(0, 1, 0);
    camera.up.copy(startUp);
    camera.position.copy(startCamera);
    camera.lookAt(controls.target);
    controls.saveState();
    // Disable controls for the entire intro; phase 3 enables them.
    controls.enabled = false;
    // Cubes start tile-thin and grow upward in phase 2. Zero height makes
    // the geometry degenerate, so the directional sun can't differentiate
    // top from sides and the colour reads as ambient-only brown. SCALE_MIN
    // lifts the top face just clear of the ground so it catches the sun
    // properly -- the squares still look flat from the camera but render
    // in the intended orange.
    const SCALE_MIN = 0.05;
    container.scale.y = SCALE_MIN;

    // ---- PFP MACHINERY (always set up; activated via state machine) -------
    // Tron-world walk, ported from three.js's official games_fps demo.
    //   - Octree-from-throwaway-Group collision (InstancedMesh isn't
    //     traversed per-instance by Octree.fromGraphNode).
    //   - Capsule player. tiny radius 0.12 + height 0.5 -- a Tron citizen,
    //     towers feel huge.
    //   - Mouse-look + pointer lock wired by hand (4 lines, matches demo).
    //   - GRAVITY 8 + jump 18 = floaty arc.
    // Setup runs whether we're entering iso or pfp mode; activation gates
    // happen in the state machine below.
    camera.rotation.order = 'YXZ';                  // yaw + pitch, no roll

    const collisionRoot = new THREE.Group();
    const cubeColliderGeom = new THREE.BoxGeometry(1, 1, 1);
    cubeColliderGeom.translate(0.5, 0.5, 0.5);
    for (let i = 0; i < mondrian.slots.length; i++) {
      const slot = mondrian.slots[i];
      const s = slot.size - 0.5;
      const m = new THREE.Mesh(cubeColliderGeom);
      m.scale.set(s, s, s);
      m.position.set(slot.position.x - layoutSize.width / 2, 0, slot.position.y - layoutSize.height / 2);
      collisionRoot.add(m);
    }
    const groundColliderGeom = new THREE.BoxGeometry(maxSize * FLOOR_RADIUS_MULT * 2, 0.1, maxSize * FLOOR_RADIUS_MULT * 2);
    const groundCollider = new THREE.Mesh(groundColliderGeom);
    groundCollider.position.set(0, -0.05, 0);
    collisionRoot.add(groundCollider);
    collisionRoot.updateMatrixWorld(true);
    const worldOctree = new Octree();
    worldOctree.fromGraphNode(collisionRoot);
    cubeColliderGeom.dispose();
    groundColliderGeom.dispose();

    const PLAYER_HEIGHT = 0.5;
    const PLAYER_RADIUS = 0.12;
    const SPAWN_X = 0;
    const SPAWN_Z = layoutSize.height / 2 + 2;
    const SPAWN_EYE_Y = PLAYER_HEIGHT - PLAYER_RADIUS;
    const playerCollider = new Capsule(
      new THREE.Vector3(SPAWN_X, PLAYER_RADIUS, SPAWN_Z),
      new THREE.Vector3(SPAWN_X, SPAWN_EYE_Y, SPAWN_Z),
      PLAYER_RADIUS,
    );

    const GRAVITY = 8;
    const JUMP_VELOCITY = 18;
    const SPEED_ON_FLOOR = 25;
    const SPEED_IN_AIR = 8;
    const STEPS_PER_FRAME = 10;
    const playerVelocity = new THREE.Vector3();
    const playerDirection = new THREE.Vector3();
    let playerOnFloor = false;

    const keyStates: Record<string, boolean> = {};
    const KEY_ALIASES: Record<string, string> = {
      ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD',
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (state !== 'pfp') return;
      const code = KEY_ALIASES[e.code] ?? e.code;
      keyStates[code] = true;
      if (code === 'Space') e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const code = KEY_ALIASES[e.code] ?? e.code;
      keyStates[code] = false;
    };
    const onCanvasClick = () => {
      if (state !== 'pfp') return;
      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock?.();
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (state !== 'pfp') return;
      if (document.pointerLockElement !== renderer.domElement) return;
      camera.rotation.y -= e.movementX / 500;
      camera.rotation.x -= e.movementY / 500;
      camera.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, camera.rotation.x));
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('click', onCanvasClick);
    document.addEventListener('mousemove', onMouseMove);
    const pfpDetach = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer.domElement.removeEventListener('click', onCanvasClick);
      document.removeEventListener('mousemove', onMouseMove);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
    };

    const getForwardVector = () => {
      camera.getWorldDirection(playerDirection);
      playerDirection.y = 0;
      playerDirection.normalize();
      return playerDirection;
    };
    const getSideVector = () => {
      camera.getWorldDirection(playerDirection);
      playerDirection.y = 0;
      playerDirection.normalize();
      playerDirection.cross(camera.up);
      return playerDirection;
    };
    const applyControls = (dt: number) => {
      const speedDelta = dt * (playerOnFloor ? SPEED_ON_FLOOR : SPEED_IN_AIR);
      if (keyStates['KeyW']) playerVelocity.add(getForwardVector().multiplyScalar( speedDelta));
      if (keyStates['KeyS']) playerVelocity.add(getForwardVector().multiplyScalar(-speedDelta));
      if (keyStates['KeyA']) playerVelocity.add(getSideVector().multiplyScalar(-speedDelta));
      if (keyStates['KeyD']) playerVelocity.add(getSideVector().multiplyScalar( speedDelta));
      if (playerOnFloor && keyStates['Space']) playerVelocity.y = JUMP_VELOCITY;
    };
    const collidePlayer = () => {
      playerOnFloor = false;
      for (let i = 0; i < 4; i++) {
        const result = worldOctree.capsuleIntersect(playerCollider);
        if (!result) break;
        if (result.normal.y >= 0.15) playerOnFloor = true;
        if (result.normal.y < 0.15) {
          playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));
        }
        if (result.depth >= 1e-10) {
          playerCollider.translate(result.normal.multiplyScalar(result.depth));
        } else {
          break;
        }
      }
    };
    const updatePlayer = (dt: number) => {
      // Damping exponent controls how quickly the player decelerates when
      // input keys are released. Demo uses -4; with our tiny cubes that
      // reads as "slippery" -- you slide a noticeable distance after a
      // jump. Crank to -10 for snappier ground control. Air drag stays
      // small (×0.1) so jumps keep horizontal momentum.
      let damping = Math.exp(-10 * dt) - 1;
      if (!playerOnFloor) {
        playerVelocity.y -= GRAVITY * dt;
        damping *= 0.1;
      }
      playerVelocity.addScaledVector(playerVelocity, damping);
      const delta = playerVelocity.clone().multiplyScalar(dt);
      playerCollider.translate(delta);
      collidePlayer();
      camera.position.copy(playerCollider.end);
    };
    const teleportIfOob = () => {
      if (camera.position.y < -10) {
        playerCollider.start.set(SPAWN_X, PLAYER_RADIUS, SPAWN_Z);
        playerCollider.end.set(SPAWN_X, SPAWN_EYE_Y, SPAWN_Z);
        playerVelocity.set(0, 0, 0);
      }
    };
    const physicsClock = new THREE.Clock();

    // ---- STATE MACHINE ----------------------------------------------------
    // intro      -> orbit            (first 3.3s after mount, plays once)
    // orbit      -> fly-to-pfp       (when _pfp set true)
    // orbit/pfp  -> fly-to-iso(exit) (when _exit set true)
    // pfp        -> fly-to-iso(orbit)(when _pfp set false)
    // fly-to-pfp -> pfp              (when fly tween done)
    // fly-to-iso -> orbit or exit-done (per fly target)
    type State = 'intro' | 'orbit' | 'fly-to-pfp' | 'pfp' | 'fly-to-iso' | 'exit-done';
    let state: State = 'intro';
    let flyAfterIso: 'orbit' | 'exit' = 'orbit';
    const FLY_MS = 1500;
    let flyStartedAt = 0;
    const flyStartPos = new THREE.Vector3();
    const flyStartQuat = new THREE.Quaternion();
    const flyEndPos = new THREE.Vector3();
    const flyEndQuat = new THREE.Quaternion();
    let flyStartFov = FOV_ISO;
    let flyEndFov = FOV_ISO;
    const spawnEye = new THREE.Vector3(SPAWN_X, SPAWN_EYE_Y, SPAWN_Z);
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const easeOutBack = (t: number) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    };

    const beginFlyToPfp = () => {
      flyStartPos.copy(camera.position);
      flyStartQuat.copy(camera.quaternion);
      flyStartFov = camera.fov;
      // Compute end quat: place camera at spawn looking at centre, capture,
      // restore. Same trick as before.
      const savedPos = camera.position.clone();
      const savedQuat = camera.quaternion.clone();
      camera.position.copy(spawnEye);
      camera.up.copy(finalUp);
      camera.lookAt(0, spawnEye.y, 0);
      flyEndQuat.copy(camera.quaternion);
      camera.position.copy(savedPos);
      camera.quaternion.copy(savedQuat);
      flyEndPos.copy(spawnEye);
      flyEndFov = FOV_PFP;
      flyStartedAt = performance.now();
      controls.enabled = false;
      // Cubes must be at full height for PFP (they are during orbit;
      // during intro they're growing -- if we leave the intro before the
      // grow phase ends, force-finish the scale).
      container.scale.y = 1;
      state = 'fly-to-pfp';
    };

    const beginFlyToIso = (afterFly: 'orbit' | 'exit') => {
      flyStartPos.copy(camera.position);
      flyStartQuat.copy(camera.quaternion);
      flyStartFov = camera.fov;
      // exit -> fly all the way back to the top-down/intro-start frame,
      //         so the user sees the camera tilt back and the SVG flip in.
      //         (Going only to iso is a near-no-op when the user hasn't
      //         orbited away from iso, and 'nothing happens then SVG' was
      //         exactly the broken-feeling case.)
      // orbit -> we're returning from PFP; land at iso so OrbitControls
      //          has a sensible pose to take over.
      const targetPos = afterFly === 'exit' ? startCamera : finalCamera;
      const targetUp = afterFly === 'exit' ? startUp : finalUp;
      const savedPos = camera.position.clone();
      const savedQuat = camera.quaternion.clone();
      camera.position.copy(targetPos);
      camera.up.copy(targetUp);
      camera.lookAt(controls.target);
      flyEndQuat.copy(camera.quaternion);
      camera.position.copy(savedPos);
      camera.quaternion.copy(savedQuat);
      flyEndPos.copy(targetPos);
      flyEndFov = FOV_ISO;
      flyAfterIso = afterFly;
      flyStartedAt = performance.now();
      controls.enabled = false;
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
      // Clear keyStates so a held-down key doesn't carry over.
      Object.keys(keyStates).forEach(k => keyStates[k] = false);
      playerVelocity.set(0, 0, 0);
      state = 'fly-to-iso';
    };

    // The dispatch closure: setters call this when _pfp / _exit change.
    this.dispatch = () => {
      if (this._exit && state !== 'fly-to-iso' && state !== 'exit-done') {
        beginFlyToIso('exit');
        return;
      }
      if (this._pfp && (state === 'orbit' || state === 'intro')) {
        beginFlyToPfp();
        return;
      }
      if (!this._pfp && (state === 'pfp' || state === 'fly-to-pfp')) {
        beginFlyToIso('orbit');
        return;
      }
    };

    // Initial-mount case: if the consumer asked for pfp at mount time,
    // skip the intro and go straight to the fly-in. (Doesn't happen today
    // since parent always opens in 3D first, but worth keeping consistent.)
    if (this._pfp) {
      container.scale.y = 1;
      beginFlyToPfp();
    }
    // Pick up Inputs that were set during the async scene build. The setters
    // dispatch lazily (this.dispatch was null while we were awaiting the
    // dynamic imports), so we call it once here as a catch-up.
    this.dispatch();

    // Ambient occlusion + AA gives the soft shadows + clean edges. Without
    // it the cubes look harsh and flat.
    const composer = new EffectComposer(renderer);
    composer.setSize(width, heightPx);
    composer.addPass(new SSAARenderPass(scene, camera));
    const sao = new SAOPass(scene, camera);
    sao.params.saoIntensity = 1 / maxSize / 50;
    sao.params.saoScale = 50;
    sao.params.saoKernelRadius = 30;
    sao.params.saoMinResolution = 0.0000005;
    sao.params.saoBlurRadius = 10;
    sao.params.saoBlurStdDev = 5;
    sao.params.saoBlurDepthCutoff = 0.00001;
    composer.addPass(sao);

    // Intro sequence durations (used by the 'intro' state in the loop).
    //   0..HOLD_MS         : hold the top-down axis-aligned view
    //   ..+CAMERA_TWEEN_MS : tilt from top-down to isometric (cubes flat)
    //   ..+GROW_TWEEN_MS   : cubes grow from flat to full height
    //   beyond             : OrbitControls takes over (state -> 'orbit')
    const HOLD_MS = 600;
    const CAMERA_TWEEN_MS = 1300;
    const GROW_TWEEN_MS = 1400;
    const introStartedAt = performance.now();

    this.zone.runOutsideAngular(() => {
      const animate = () => {
        this.animFrame = requestAnimationFrame(animate);

        switch (state) {
          case 'intro': {
            const elapsed = performance.now() - introStartedAt;
            const tweenStart = HOLD_MS;
            const growStart = HOLD_MS + CAMERA_TWEEN_MS;
            const introEnd = HOLD_MS + CAMERA_TWEEN_MS + GROW_TWEEN_MS;
            if (elapsed < tweenStart) {
              camera.position.copy(startCamera);
              camera.up.copy(startUp);
              camera.lookAt(controls.target);
            } else if (elapsed < growStart) {
              const t = easeInOutCubic((elapsed - tweenStart) / CAMERA_TWEEN_MS);
              camera.position.lerpVectors(startCamera, finalCamera, t);
              camera.up.copy(startUp).lerp(finalUp, t).normalize();
              camera.lookAt(controls.target);
            } else if (elapsed < introEnd) {
              camera.position.copy(finalCamera);
              camera.up.copy(finalUp);
              camera.lookAt(controls.target);
              const t = (elapsed - growStart) / GROW_TWEEN_MS;
              container.scale.y = SCALE_MIN + (1 - SCALE_MIN) * easeOutBack(t);
            } else {
              // Hand off to orbit.
              camera.position.copy(finalCamera);
              camera.up.copy(finalUp);
              camera.lookAt(controls.target);
              container.scale.y = 1;
              controls.enabled = true;
              state = 'orbit';
            }
            break;
          }
          case 'orbit': {
            controls.update();
            break;
          }
          case 'fly-to-pfp':
          case 'fly-to-iso': {
            const elapsed = performance.now() - flyStartedAt;
            const t = Math.min(1, elapsed / FLY_MS);
            const eased = easeInOutCubic(t);
            camera.position.lerpVectors(flyStartPos, flyEndPos, eased);
            camera.quaternion.slerpQuaternions(flyStartQuat, flyEndQuat, eased);
            camera.fov = flyStartFov + (flyEndFov - flyStartFov) * eased;
            camera.updateProjectionMatrix();
            if (t >= 1) {
              if (state === 'fly-to-pfp') {
                // Snap capsule to spawn; clear physics state so first
                // physics frame starts cleanly.
                playerCollider.start.set(SPAWN_X, PLAYER_RADIUS, SPAWN_Z);
                playerCollider.end.set(SPAWN_X, SPAWN_EYE_Y, SPAWN_Z);
                playerVelocity.set(0, 0, 0);
                playerOnFloor = false;
                physicsClock.getDelta();
                state = 'pfp';
              } else if (flyAfterIso === 'orbit') {
                controls.enabled = true;
                state = 'orbit';
              } else {
                state = 'exit-done';
                this.zone.run(() => this.exitDone.emit());
              }
            }
            break;
          }
          case 'pfp': {
            const dt = Math.min(0.05, physicsClock.getDelta()) / STEPS_PER_FRAME;
            for (let i = 0; i < STEPS_PER_FRAME; i++) {
              applyControls(dt);
              updatePlayer(dt);
              teleportIfOob();
            }
            break;
          }
          case 'exit-done': {
            // Idle; parent will tear us down on its next CD pass.
            break;
          }
        }

        // Sun stays fixed in world space. Composer renders all states the
        // same way -- only the camera/state changed.
        composer.render();
      };
      animate();
    });

    // Resize handler keeps the renderer matched to the host element.
    const resize = () => {
      const r = hostEl.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      renderer.setSize(r.width, r.height);
      composer.setSize(r.width, r.height);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      // Fat-line shader needs the current viewport resolution to scale pixels.
      gridMat.resolution.set(r.width, r.height);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(hostEl);

    this.cleanup = () => {
      if (this.animFrame !== null) cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
      ro.disconnect();
      pfpDetach();
      this.dispatch = null;
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      cubeGeometry.dispose();
      material.dispose();
      instances.dispose();
      gridGeom.dispose();
      gridMat.dispose();
      controls.dispose();
      while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild);
    };
  }

  private disposeStage(): void {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  }
}
