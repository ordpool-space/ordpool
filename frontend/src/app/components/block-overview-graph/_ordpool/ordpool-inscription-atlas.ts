/**
 * Texture atlas for inscription / stamp / atomical image previews rendered
 * inside the block-overview graph's tx squares.
 *
 * # Why an atlas, not per-tx textures
 *
 * Each visible block can carry hundreds of image-bearing artifact txs. One
 * GL texture per tx would cost a draw-call per sprite (or at minimum a per-
 * frame texture-bind storm), neither of which fits the existing geometry-
 * only renderer. A single atlas lets us keep the existing one-draw-call-per-
 * frame pattern: every sprite samples a sub-rect of the *same* texture; the
 * vertex shader figures out which sub-rect from a packed integer carried in
 * the per-vertex `offset` attribute.
 *
 * # Pipeline
 *
 *   1. CPU side: HTMLCanvasElement (1024² → 2048² after first saturation).
 *      `requestSlot()` allocates a power-of-two pixel rectangle via the
 *      quadtree allocator and kicks off a fetch for `/content/<txid>` (or
 *      `/stamp-content/<txid>`, `/atomical-content/<txid>` depending on
 *      artifact kind).
 *   2. `Image()` arrives → `ctx.drawImage(img, …, slot.x+1, slot.y+1, slot.size-2, slot.size-2)`
 *      blits the image into the canvas, preserving aspect ratio with a
 *      cover-fit centre crop. The 1-px gutter prevents bilinear sampling
 *      bleed between neighbouring slots.
 *   3. `dirtyTexture = true`. The next `bind(unit)` call uploads the entire
 *      canvas via a single `texImage2D(gl.RGBA, gl.UNSIGNED_BYTE, canvas)` —
 *      one upload no matter how many images arrived in the same frame.
 *   4. `sprite.setTexture(packedSlot)` flips the sprite's tristate flag from
 *      "render flat colour" to "sample atlas at packedSlot". The shader
 *      decodes the slot back to UVs in the vertex stage.
 *
 * # Network posture
 *
 * `/content/`, `/stamp-content/`, `/atomical-content/` stay same-origin on
 * purpose: dev (Angular proxy → :8999), prod (Cloudflare Pages `_redirects`
 * → api.ordpool.space). Both endpoints reply with `Access-Control-Allow-
 * Origin: *`, so `<Image crossOrigin="anonymous">` keeps the canvas un-
 * tainted and `texImage2D(canvas)` is allowed to read the pixels. Failed
 * fetches retry twice (500 ms / 2 s) before being added to a FIFO failure
 * cache so transient flaps don't permanently blacklist a txid.
 *
 * # Saturation
 *
 * On first full, the atlas expands once from 1024² to 2048² (4× capacity)
 * by allocating a larger canvas, blitting the existing pixel buffer at
 * (0, 0) — slot positions are preserved — and recreating the GPU texture.
 * The second saturation is logged once via `console.error` and the
 * affected sprite stays at flat colour; further saturations are silent.
 *
 * # No spinner
 *
 * While a fetch is in flight the sprite keeps its ordpool-tinted flat
 * colour. That's honest about loading state, costs nothing, and saves a
 * second sampler + asset.
 */

import TxSprite from '@components/block-overview-graph/tx-sprite';
import * as quadtree from './ordpool-quadtree-allocator';

/** Initial atlas edge length in pixels. Used by the component as the default
 *  uniform value before any allocation has happened. */
export const ATLAS_SIZE = 1024;
/** Maximum atlas edge length. The atlas doubles once on first saturation;
 *  any further fills emit a one-shot console.error and fall back to the
 *  flat-colour rendering path. 2048² stays well below `gl.MAX_TEXTURE_SIZE`
 *  (≥ 4096 universally, typically 8192–16384) and uses ~16 MB of GPU memory. */
export const MAX_ATLAS_SIZE = 2048;
const SLOT_QUANTUM = 32;
const MIN_SLOT = 32;
const MAX_SLOT = 512;
const MAX_CONCURRENT_FETCHES = 8;
// Cap the failure set so cross-block browsing doesn't grow it unbounded over a session.
// 4096 fits the worst-case visible-tx count for several hundred blocks; older entries
// drop off via FIFO eviction and would simply re-fetch (cheap when /content/ 404s).
const MAX_FAILED_ENTRIES = 4096;
// Each fetch gets up to RETRY_DELAYS.length retries before going to the failure cache.
// Backoff grows so a flapping origin doesn't get hammered. ms.
const RETRY_DELAYS = [500, 2000];

// Three artifact kinds map to three backend routes that all return a single
// renderable image. The atlas doesn't care about the kind beyond URL building;
// the cache key stays the txid (a tx is exactly one of the three in practice).
export type OrdpoolArtifactKind = 'inscription' | 'stamp' | 'atomical';

const ARTIFACT_PATHS: Record<OrdpoolArtifactKind, string> = {
  inscription: '/content/',
  stamp: '/stamp-content/',
  atomical: '/atomical-content/',
};

interface AtlasEntry {
  txid: string;
  kind: OrdpoolArtifactKind;
  node: quadtree.QuadNode;
  sprite: TxSprite | null;
  refCount: number;
  status: 'pending' | 'loaded' | 'failed';
  attempts: number;
  abort: () => void;
}

export class OrdpoolInscriptionAtlas {
  private gl: WebGLRenderingContext | null = null;
  private texture: WebGLTexture | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private root: quadtree.QuadNode;
  private currentSize = ATLAS_SIZE;
  private entries = new Map<string, AtlasEntry>();
  private failed = new Set<string>();
  private fetchQueue: Array<() => void> = [];
  private inFlight = 0;
  private dirtyTexture = false;
  /** True after we've run out of room at MAX_ATLAS_SIZE. Used to suppress
   *  repeat console.error spam when many sprites can't fit in the same scene. */
  private saturationLogged = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.root = quadtree.createRoot(ATLAS_SIZE);
  }

  /** Current atlas edge length in pixels. Starts at `ATLAS_SIZE`, doubles to
   *  `MAX_ATLAS_SIZE` on first saturation. The shader's `atlasSize` uniform
   *  must track this — the component reads it every frame in the run loop. */
  get size(): number {
    return this.currentSize;
  }

  /**
   * Wire the atlas up to a live WebGL context. Allocates a `currentSize²`
   * RGBA texture at unit 0 and configures sampling parameters. Call once
   * after `useProgram()` and again after a context-loss restore.
   */
  init(gl: WebGLRenderingContext): void {
    this.gl = gl;
    this.allocateTexture();
  }

  /** Internal: allocate (or reallocate after expansion) the GPU texture at
   *  the atlas's current size. Called from init() and from expand(). */
  private allocateTexture(): void {
    if (!this.gl) {
      return;
    }
    if (this.texture) {
      this.gl.deleteTexture(this.texture);
    }
    this.texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.currentSize, this.currentSize, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.dirtyTexture = true;
  }

  bind(unit: number): void {
    if (!this.gl || !this.texture) {
      return;
    }
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    if (this.dirtyTexture) {
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.canvas);
      this.dirtyTexture = false;
    }
  }

  /**
   * Reserve an atlas slot for `txid` of artifact `kind` and start the
   * background fetch.
   *
   * Returns `true` when the atlas took ownership — the caller MUST pair this
   * with a later `releaseSlot(txid)`. Returns `false` when the atlas refuses:
   *
   *  - `txid` is in the failure cache (hard 404 from a prior session attempt)
   *  - the atlas can't fit a slot of the requested size, even after expansion
   *
   * On the second case the affected sprite stays at flat colour. Once the
   * atlas reaches `MAX_ATLAS_SIZE` and is genuinely full, a one-shot
   * `console.error` makes the situation observable in DevTools so we can
   * tell "no preview is showing" from "preview never even tried".
   */
  requestSlot(txid: string, vsize: number, sprite: TxSprite, kind: OrdpoolArtifactKind): boolean {
    if (this.failed.has(txid)) {
      return false;
    }
    const existing = this.entries.get(txid);
    if (existing) {
      existing.refCount++;
      existing.sprite = sprite;
      if (existing.status === 'loaded') {
        sprite.setTexture(quadtree.packSlot(existing.node));
      }
      return true;
    }
    const slotPx = computeSlotSize(vsize);
    let node = quadtree.insert(this.root, slotPx);
    if (!node && this.currentSize < MAX_ATLAS_SIZE) {
      // First saturation: double the atlas (1024 → 2048) and try again.
      // The expansion preserves every existing slot, so already-loaded
      // textures stay correctly addressed by their existing packed slots.
      this.expand();
      node = quadtree.insert(this.root, slotPx);
    }
    if (!node) {
      this.logSaturationOnce(slotPx);
      return false;
    }
    const entry: AtlasEntry = {
      txid,
      kind,
      node,
      sprite,
      refCount: 1,
      status: 'pending',
      attempts: 0,
      abort: () => undefined,
    };
    this.entries.set(txid, entry);
    this.queueFetch(entry);
    return true;
  }

  releaseSlot(txid: string): void {
    const entry = this.entries.get(txid);
    if (!entry) {
      return;
    }
    entry.refCount--;
    if (entry.refCount > 0) {
      return;
    }
    entry.abort();
    // Reset the sprite's texture flag so a leaked TxView (e.g. a future code
    // path that releases without destroying the sprite) doesn't render against
    // a freed slot that may now belong to a different inscription.
    entry.sprite?.clearTexture();
    quadtree.remove(entry.node);
    this.entries.delete(txid);
  }

  /**
   * Tear down: cancel in-flight fetches, drop the GPU texture, reset the
   * saturation log gate. Called from the component's `ngOnDestroy`.
   */
  destroy(): void {
    for (const entry of this.entries.values()) {
      entry.abort();
    }
    this.entries.clear();
    this.failed.clear();
    this.fetchQueue = [];
    this.inFlight = 0;
    this.saturationLogged = false;
    if (this.gl && this.texture) {
      this.gl.deleteTexture(this.texture);
    }
    this.gl = null;
    this.texture = null;
  }

  private queueFetch(entry: AtlasEntry): void {
    const run = () => this.runFetch(entry);
    if (this.inFlight < MAX_CONCURRENT_FETCHES) {
      run();
    } else {
      this.fetchQueue.push(run);
    }
  }

  private runFetch(entry: AtlasEntry): void {
    this.inFlight++;
    entry.attempts++;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let aborted = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    entry.abort = () => {
      aborted = true;
      img.src = '';
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
    img.onload = () => {
      this.inFlight--;
      this.drainQueue();
      if (aborted || this.entries.get(entry.txid) !== entry) {
        return;
      }
      this.drawIntoSlot(entry.node, img);
      entry.status = 'loaded';
      this.dirtyTexture = true;
      entry.sprite?.setTexture(quadtree.packSlot(entry.node));
    };
    img.onerror = () => {
      this.inFlight--;
      this.drainQueue();
      if (aborted || this.entries.get(entry.txid) !== entry) {
        return;
      }
      // Retry on the next backoff slot, then give up. Covers transient 502s,
      // network flaps, and the brief window between a tx hitting the mempool
      // and the backend's parser observing it.
      const backoffIndex = entry.attempts - 1;
      if (backoffIndex < RETRY_DELAYS.length) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (aborted || this.entries.get(entry.txid) !== entry) {
            return;
          }
          this.queueFetch(entry);
        }, RETRY_DELAYS[backoffIndex]);
        return;
      }
      this.rememberFailure(entry.txid);
      quadtree.remove(entry.node);
      this.entries.delete(entry.txid);
    };
    // For inscriptions a bare txid (no `iN`) is interpreted by the backend as
    // "first image-bearing inscription in this tx", so batch reveals where the
    // image sits behind a JSON or text inscription still resolve correctly.
    // Stamps and atomicals have their own routes that return the renderable
    // bytes directly.
    img.src = `${ARTIFACT_PATHS[entry.kind]}${entry.txid}`;
  }

  /**
   * Double the atlas in both dimensions. Allocates a `currentSize × 2` canvas,
   * copies the existing pixel buffer at (0, 0) — slot positions are preserved
   * since the quadtree expansion makes the old root the top-left child of
   * the new root — and recreates the GPU texture.
   *
   * Called once per atlas instance, on first saturation in `requestSlot`.
   * Beyond `MAX_ATLAS_SIZE` we don't expand further; further full conditions
   * are reported by `logSaturationOnce`.
   */
  private expand(): void {
    const newSize = this.currentSize * 2;
    const newCanvas = document.createElement('canvas');
    newCanvas.width = newSize;
    newCanvas.height = newSize;
    const newCtx = newCanvas.getContext('2d', { willReadFrequently: false })!;
    // Copy the existing pixel buffer into the top-left corner. Every loaded
    // image keeps its (slot.x, slot.y, slot.size), so existing AtlasEntry
    // node references and packed-slot integers stay valid.
    newCtx.drawImage(this.canvas, 0, 0);
    this.canvas = newCanvas;
    this.ctx = newCtx;
    this.root = quadtree.expand(this.root);
    this.currentSize = newSize;
    this.allocateTexture();
  }

  private logSaturationOnce(slotPx: number): void {
    if (this.saturationLogged) {
      return;
    }
    this.saturationLogged = true;
    // eslint-disable-next-line no-console
    console.error(
      `[ordpool-atlas] saturated at ${this.currentSize}×${this.currentSize}px ` +
      `(${this.entries.size} slots in flight); refusing slot of ${slotPx}px. ` +
      `Sprite will fall back to flat colour. Subsequent saturations are silent.`
    );
  }

  private rememberFailure(txid: string): void {
    if (this.failed.has(txid)) {
      return;
    }
    if (this.failed.size >= MAX_FAILED_ENTRIES) {
      // Set iteration order is insertion order, so the first key is the oldest.
      const oldest = this.failed.values().next().value;
      if (oldest !== undefined) {
        this.failed.delete(oldest);
      }
    }
    this.failed.add(txid);
  }

  private drainQueue(): void {
    while (this.fetchQueue.length && this.inFlight < MAX_CONCURRENT_FETCHES) {
      const next = this.fetchQueue.shift()!;
      next();
    }
  }

  private drawIntoSlot(node: quadtree.QuadNode, img: HTMLImageElement): void {
    const innerSize = Math.max(1, node.size - 2);
    const w = img.width || 1;
    const h = img.height || 1;
    const scale = Math.max(innerSize / w, innerSize / h);
    const sw = innerSize / scale;
    const sh = innerSize / scale;
    const sx = (w - sw) / 2;
    const sy = (h - sh) / 2;
    this.ctx.imageSmoothingEnabled = scale <= 1;
    this.ctx.clearRect(node.x, node.y, node.size, node.size);
    this.ctx.drawImage(img, sx, sy, sw, sh, node.x + 1, node.y + 1, innerSize, innerSize);
  }
}

// Map a tx's vsize onto a power-of-two slot size in pixels. The square that
// will be drawn on screen for a tx of vsize V is roughly sqrt(V) pixels at
// default zoom; the 1.4 factor leaves headroom so the inscription image
// doesn't show pixelation when the user zooms in. Bounded to [32, 512] so
// no single slot can swallow more than 1/4 of the atlas.
function computeSlotSize(vsize: number): number {
  const target = 1.4 * Math.sqrt(Math.max(vsize, 1));
  let pow = MIN_SLOT;
  while (pow < target && pow < MAX_SLOT) {
    pow *= 2;
  }
  return Math.min(Math.max(pow, MIN_SLOT), MAX_SLOT);
}
