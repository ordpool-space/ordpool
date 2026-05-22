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

    const directional = new THREE.DirectionalLight(new THREE.Color('white'), 0.4);
    directional.castShadow = true;
    directional.shadow.mapSize.set(2048, 2048);
    directional.shadow.camera.near = 0.1;
    directional.shadow.camera.far = 100;
    directional.shadow.camera.left = -maxSize;
    directional.shadow.camera.right = maxSize;
    directional.shadow.camera.top = maxSize;
    directional.shadow.camera.bottom = -maxSize;
    scene.add(directional);
    scene.add(new THREE.AmbientLight(new THREE.Color('white'), 3));

    // Fit camera so the layout occupies most of the viewport. fitOffset 1.1
    // sits closer than bitfeed/bitlodo's 1.5; the cubes fill more of the frame
    // and you see the texture detail without zooming in.
    const fitOffset = 1.1;
    const fitHeightDist = maxSize / (2 * Math.atan(Math.PI * camera.fov / 360));
    const fitWidthDist = fitHeightDist / camera.aspect;
    const distance = fitOffset * Math.max(fitHeightDist, fitWidthDist);
    controls.target.set(0, maxHeight / 2, 0);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();

    // Final (after-intro) camera position: standard isometric corner.
    // Distance from origin = distance * sqrt(3/2) ≈ 1.22 * distance.
    const finalCamera = new THREE.Vector3(
      distance / Math.SQRT2, distance / Math.SQRT2, distance / Math.SQRT2,
    );
    // Start straight above the layout. Tiny +Z offset (not equal X+Z) avoids
    // the 45° auto-roll the gimbal-resolver picks when both off-axis values
    // match; it also makes the camera's screen-up land along -Z, so the
    // bitmap appears axis-aligned with the 2D view (slot.y=0 at the top of
    // the screen). Magnitude matches finalCamera, so the apparent grid size
    // doesn't shrink during the camera tween -- only the angle changes.
    const startCameraY = distance * Math.sqrt(3 / 2);
    const startCamera = new THREE.Vector3(0, startCameraY, 0.001);
    camera.position.copy(startCamera);
    controls.update();
    controls.saveState();
    // Disable interaction during the intro -- otherwise a dragged camera
    // fights the tween.
    controls.enabled = false;
    // Cubes start flat (height = 0) and grow upward over the animation.
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

    // Intro sequence (matches bitmap.trade's reveal): camera tilts from
    // top-down to isometric, then the cubes grow upward from the ground.
    // Sequential, not simultaneous; the rotate-then-grow rhythm reads
    // cleanly without overwhelming the viewer.
    const CAMERA_TWEEN_MS = 1300;
    const GROW_TWEEN_MS = 1400;
    const startedAt = performance.now();

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
      const dummy = new THREE.Object3D();
      const m = new THREE.Matrix4();
      const animate = () => {
        this.animFrame = requestAnimationFrame(animate);

        const elapsed = performance.now() - startedAt;

        // Phase 1: camera tilt from top-down to isometric.
        if (elapsed < CAMERA_TWEEN_MS) {
          const t = easeInOutCubic(elapsed / CAMERA_TWEEN_MS);
          camera.position.lerpVectors(startCamera, finalCamera, t);
        }
        // Phase 2: cube growth (starts right after the camera tween).
        else if (elapsed < CAMERA_TWEEN_MS + GROW_TWEEN_MS) {
          camera.position.copy(finalCamera);
          const t = (elapsed - CAMERA_TWEEN_MS) / GROW_TWEEN_MS;
          container.scale.y = Math.max(0.001, easeOutBack(t));
        }
        // Phase 3: done — hand control over to OrbitControls (once).
        else if (!controls.enabled) {
          camera.position.copy(finalCamera);
          container.scale.y = 1;
          controls.enabled = true;
        }

        controls.update();
        // Light follows the camera so shadows stay alive while orbiting.
        m.extractRotation(camera.matrixWorld);
        dummy.position.set(10, 0, 0).applyMatrix4(m);
        directional.position.set(-dummy.position.x, 20, -dummy.position.z);
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
