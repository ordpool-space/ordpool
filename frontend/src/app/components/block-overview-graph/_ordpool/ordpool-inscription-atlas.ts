/*
  Inscription image atlas for the block-overview graph.

  Owns a 1024x1024 RGBA canvas, a matching WebGL texture, and a quadtree
  slot allocator. Block-scene tells us when an inscription tx becomes
  visible (`requestSlot`) or leaves the scene (`releaseSlot`). We fetch
  `/content/<txid>i0` for each request, draw the result into the slot
  rectangle, and tell the sprite to flip its texture flag once the upload
  is on the GPU. Failed fetches are remembered so a re-add doesn't retry.

  `/content/` stays a same-origin path on purpose: ordpool-backend serves
  it directly in dev (Angular proxy on :8999), and Cloudflare Pages
  rewrites it to api.ordpool.space in prod (`_redirects`). That route has
  permissive CORS (`Access-Control-Allow-Origin: *`), so the canvas stays
  un-tainted and texImage2D doesn't throw.

  No spinner texture for now — sprites without a loaded image keep their
  ordpool-tinted flat colour, which is honest about loading state and
  saves a sampler + an asset.
*/

import TxSprite from '@components/block-overview-graph/tx-sprite';
import * as quadtree from './ordpool-quadtree-allocator';

export const ATLAS_SIZE = 1024;
const SLOT_QUANTUM = 32;
const MIN_SLOT = 32;
const MAX_SLOT = 512;
const MAX_CONCURRENT_FETCHES = 8;
// Cap the failure set so cross-block browsing doesn't grow it unbounded over a session.
// 4096 fits the worst-case visible-tx count for several hundred blocks; older entries
// drop off via FIFO eviction and would simply re-fetch (cheap when /content/ 404s).
const MAX_FAILED_ENTRIES = 4096;

interface AtlasEntry {
  txid: string;
  node: quadtree.QuadNode;
  sprite: TxSprite | null;
  refCount: number;
  status: 'pending' | 'loaded' | 'failed';
  abort: () => void;
}

export class OrdpoolInscriptionAtlas {
  private gl: WebGLRenderingContext | null = null;
  private texture: WebGLTexture | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private root: quadtree.QuadNode;
  private entries = new Map<string, AtlasEntry>();
  private failed = new Set<string>();
  private fetchQueue: Array<() => void> = [];
  private inFlight = 0;
  private dirtyTexture = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.root = quadtree.createRoot(ATLAS_SIZE);
  }

  init(gl: WebGLRenderingContext): void {
    this.gl = gl;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ATLAS_SIZE, ATLAS_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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

  // Returns true if the atlas accepted ownership of this txid (caller should
  // pair it with a later releaseSlot). Returns false on previously-failed
  // fetches and on atlas-full conditions, so the caller knows not to release
  // a slot it never acquired.
  requestSlot(txid: string, vsize: number, sprite: TxSprite): boolean {
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
    const node = quadtree.insert(this.root, slotPx);
    if (!node) {
      // atlas full — sprite stays as flat colour, no retry on later free
      return false;
    }
    const entry: AtlasEntry = {
      txid,
      node,
      sprite,
      refCount: 1,
      status: 'pending',
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

  destroy(): void {
    for (const entry of this.entries.values()) {
      entry.abort();
    }
    this.entries.clear();
    this.failed.clear();
    this.fetchQueue = [];
    this.inFlight = 0;
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
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let aborted = false;
    entry.abort = () => {
      aborted = true;
      img.src = '';
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
      if (aborted) {
        return;
      }
      this.rememberFailure(entry.txid);
      if (this.entries.get(entry.txid) === entry) {
        quadtree.remove(entry.node);
        this.entries.delete(entry.txid);
      }
    };
    // Bare txid (no `iN`) is interpreted by the backend as "first image-bearing
    // inscription in this tx", so batch reveals where the image sits behind a JSON
    // or text inscription still resolve correctly.
    img.src = `/content/${entry.txid}`;
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
