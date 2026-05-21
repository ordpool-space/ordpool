import { HttpClient } from '@angular/common/http';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, Input, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { BitmapResponse } from '../../../../services/ordinals/bitmap-api.service';

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

  private http = inject(HttpClient);
  private zone = inject(NgZone);

  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  private _height: number | null = null;
  @Input()
  public set height(h: number | null | undefined) {
    const value = (typeof h === 'number') ? h : null;
    if (this._height === value) {
      return;
    }
    this._height = value;
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
    if (this._height === null || !this.host?.nativeElement) {
      return;
    }
    const sizes = await this.fetchSizes(this._height);
    if (sizes === null || this._height === null) {
      return;
    }
    await this.renderCubes(sizes);
  }

  private async fetchSizes(height: number): Promise<number[] | null> {
    try {
      const resp = await firstValueFrom(
        this.http.get<BitmapResponse | null>(`/api/v1/ordpool/bitmap/${height}`),
      );
      return resp?.sizes ?? null;
    } catch {
      return null;
    }
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

    if (this._height === null || !this.host?.nativeElement) {
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    const material = new THREE.MeshPhongMaterial();
    const instances = new THREE.InstancedMesh(cubeGeometry, material, sizes.length);
    instances.frustumCulled = false;
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instances.castShadow = true;
    instances.receiveShadow = true;
    const container = new THREE.Group();
    scene.add(container);
    container.add(instances);

    // CSS 'orange' (#ffa500), matching bitlodo's reference; Bitcoin-orange
    // (#F7931A) over-saturates under the SAO+SSAA pipeline.
    const orange = new THREE.Color('#ffa500');
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

    // Fit camera so the layout occupies most of the viewport with a small margin.
    const fitOffset = 1.5;
    const fitHeightDist = maxSize / (2 * Math.atan(Math.PI * camera.fov / 360));
    const fitWidthDist = fitHeightDist / camera.aspect;
    const distance = fitOffset * Math.max(fitHeightDist, fitWidthDist);
    controls.target.set(0, maxHeight / 2, 0);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    camera.position.set(distance / Math.SQRT2, distance / Math.SQRT2, distance / Math.SQRT2);
    controls.update();
    controls.saveState();

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

    // Render loop runs outside Angular's zone so it doesn't trigger CD.
    this.zone.runOutsideAngular(() => {
      const dummy = new THREE.Object3D();
      const m = new THREE.Matrix4();
      const animate = () => {
        this.animFrame = requestAnimationFrame(animate);
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
