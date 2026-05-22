import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, Input, NgZone, OnDestroy, ViewChild } from '@angular/core';

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

  // DEV TUNING -- live-bound from the bitmap-viewer's inputs. Each change
  // forces a full scene rebuild (cheap enough, ~50ms for 3k cubes).
  private _fitOffset = 0.97;
  @Input()
  public set fitOffset(v: number | null | undefined) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return;
    if (this._fitOffset === v) return;
    this._fitOffset = v;
    void this.rebuild();
  }

  private _skipIntro = false;
  @Input()
  public set skipIntro(v: boolean | null | undefined) {
    const value = v === true;
    if (this._skipIntro === value) return;
    this._skipIntro = value;
    void this.rebuild();
  }

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
    const [THREE, { OrbitControls }, { EffectComposer }, { SAOPass }, { SSAARenderPass }, parser] = await Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/SAOPass.js'),
      import('three/examples/jsm/postprocessing/SSAARenderPass.js'),
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
    const camera = new THREE.PerspectiveCamera(15, width / heightPx, 0.1, 1000);
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

    // Tron-style grid on the floor. Each cell is one layout unit, so the
    // lines pass through cube edges; what you see is the band of grid
    // outside the bitmap's footprint when the camera orbits low. Slightly
    // dimmed orange so it reads as ambient ground texture, not a UI element.
    const gridDivisions = Math.max(2, Math.round(maxSize * 2));
    const gridColor = orange.clone().multiplyScalar(0.6);
    const grid = new THREE.GridHelper(maxSize * 2, gridDivisions, gridColor, gridColor);
    grid.position.y = 0.001;  // lift a hair so z-fighting with the ground plane stays away
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
    // fitOffset < 1.0 crops into the bitmap's edges. Live-tunable via the
    // dev input in bitmap-viewer; default 0.97 sits close enough to match
    // the 2D viewport without clipping when the iso-corner diamond swings
    // into view.
    const cameraDistance = this._fitOffset * fitDist;

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
    // Cubes start flat (height = 0) and grow upward in phase 2.
    container.scale.y = 0;

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

    // Intro sequence:
    //   0..HOLD_MS         : hold the top-down axis-aligned view -- this is
    //                        the moment the user clocks "this matches 2D".
    //   ..+CAMERA_TWEEN_MS : tilt from top-down to isometric (cubes flat).
    //   ..+GROW_TWEEN_MS   : cubes grow from flat to full height.
    //   beyond             : OrbitControls takes over.
    // DEV TUNING: skipIntro=true holds the render LOCKED at the start frame
    // (axis-aligned top-down, cubes flat). Lets us tune the initial zoom
    // without the animation moving the target every rebuild.
    const HOLD_MS = 600;
    const CAMERA_TWEEN_MS = 1300;
    const GROW_TWEEN_MS = 1400;
    const startedAt = performance.now();
    const lockToStart = this._skipIntro;

    // easeInOutCubic for the camera (symmetric, settles smoothly),
    // easeOutBack for the cubes (small overshoot = satisfying snap).
    const easeInOutCubic = (t: number): number =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const easeOutBack = (t: number): number => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    };

    // Render loop runs outside Angular's zone so it doesn't trigger CD.
    this.zone.runOutsideAngular(() => {
      const animate = () => {
        this.animFrame = requestAnimationFrame(animate);

        const elapsed = performance.now() - startedAt;
        const tweenStart = HOLD_MS;
        const growStart = HOLD_MS + CAMERA_TWEEN_MS;
        const introEnd = HOLD_MS + CAMERA_TWEEN_MS + GROW_TWEEN_MS;

        if (lockToStart) {
          // DEV: freeze in the top-down start frame. No camera tween, no
          // cube growth, no OrbitControls -- just the initial pose.
          camera.position.copy(startCamera);
          camera.up.copy(startUp);
          camera.lookAt(controls.target);
          container.scale.y = 0.001;
          composer.render();
          return;
        }

        if (elapsed < tweenStart) {
          // Phase 0: hold the axis-aligned top-down view.
          camera.position.copy(startCamera);
          camera.up.copy(startUp);
          camera.lookAt(controls.target);
        } else if (elapsed < growStart) {
          // Phase 1: tilt camera from top-down to isometric. Lerp position
          // AND up vector so screen-up rolls smoothly from world -Z to +Y.
          const t = easeInOutCubic((elapsed - tweenStart) / CAMERA_TWEEN_MS);
          camera.position.lerpVectors(startCamera, finalCamera, t);
          camera.up.copy(startUp).lerp(finalUp, t).normalize();
          camera.lookAt(controls.target);
        } else if (elapsed < introEnd) {
          // Phase 2: cubes grow at the final isometric camera position.
          camera.position.copy(finalCamera);
          camera.up.copy(finalUp);
          camera.lookAt(controls.target);
          const t = (elapsed - growStart) / GROW_TWEEN_MS;
          container.scale.y = Math.max(0.001, easeOutBack(t));
        } else if (!controls.enabled) {
          // Phase 3 (one-shot): lock the final state and hand off to
          // OrbitControls.
          camera.position.copy(finalCamera);
          camera.up.copy(finalUp);
          camera.lookAt(controls.target);
          container.scale.y = 1;
          controls.enabled = true;
        }

        // OrbitControls only updates while it owns the camera (phase 3+).
        if (controls.enabled) {
          controls.update();
        }
        // Sun stays fixed in world space -- it's set once at scene build and
        // we don't touch it here. As the user orbits, the bright/medium/dark
        // faces shift naturally, which is the realistic "sun at a fixed
        // place in the sky" feel.
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
    };
    const ro = new ResizeObserver(resize);
    ro.observe(hostEl);

    this.cleanup = () => {
      if (this.animFrame !== null) cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
      ro.disconnect();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      cubeGeometry.dispose();
      material.dispose();
      instances.dispose();
      grid.geometry.dispose();
      // GridHelper always carries a single LineBasicMaterial; cast through any
      // so we don't have to drag in three's type module just for this line.
      (grid.material as { dispose: () => void }).dispose();
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
