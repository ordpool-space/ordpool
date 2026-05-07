/**
 * Quadtree slot allocator for the inscription image atlas.
 *
 * Pure, DOM-free, WebGL-free — easy to unit-test in isolation. Used only by
 * `OrdpoolInscriptionAtlas`.
 *
 * # Layout
 *
 * The atlas is a square of `size` pixels (currently 1024, expandable to 2048
 * on first saturation). Allocation requests are power-of-two slot sizes
 * (32, 64, 128, 256, 512). Free space is tracked as a tree of nodes; when a
 * request lands deeper than the current subdivision, the parent node is
 * "budded" into 4 equal quadrants and recursion continues into them. The
 * `full` flag propagates upward so we can short-circuit search through
 * saturated subtrees.
 *
 * # Coordinate convention
 *
 * `(x, y)` is the top-left corner of the slot in pixel space. `(0, 0)` is the
 * canvas's top-left corner; the y-axis grows downward (canvas convention).
 * The vertex shader flips y when computing UVs because GL textures sample
 * from a bottom-left origin without `UNPACK_FLIP_Y_WEBGL`.
 *
 * # Expansion
 *
 * `expand(root)` doubles the atlas in both dimensions by wrapping the
 * existing root as the top-left child of a fresh, larger root. Every
 * existing leaf keeps its `(x, y, size)` — they're still valid pixel
 * coordinates in the new canvas after a `drawImage(oldCanvas, 0, 0)` blit.
 * The other three quadrants of the new root are empty leaves available for
 * fresh allocations.
 *
 * # Slot encoding (used by the shader)
 *
 * `packSlot(node)` encodes `(x, y, size)` as a single integer:
 *
 *     packed = x/32 + (y/32) * 512 + (size/32) * 262144
 *
 * The vertex shader decodes it via integer division and modulo. `512` and
 * `262144 = 512²` are dimensionless constants that work for any atlas size
 * up to 16384×16384 (well past `gl.MAX_TEXTURE_SIZE` on every realistic
 * device); they don't change when the atlas expands.
 */

/**
 * A node in the allocator tree. Either a leaf (no children) or a parent that
 * has been "budded" into four equal quadrants. The mutually-exclusive states
 * are:
 *
 *  - **empty leaf** — `!budded && !filled && !full`. Available for allocation.
 *  - **filled leaf** — `!budded && filled && full`. Holds one allocation.
 *  - **internal** — `budded && !filled`. Has 4 children; `full` reflects whether
 *    every leaf in this subtree is filled.
 */
export interface QuadNode {
  /** Top-left x in pixels (0 ≤ x < atlasSize, multiple of 32). */
  x: number;
  /** Top-left y in pixels (0 ≤ y < atlasSize, multiple of 32). */
  y: number;
  /** Edge length in pixels. Power of two: 32, 64, 128, 256, 512, 1024 (or 2048 after expand). */
  size: number;
  /** True when the node has been split into 4 equal-size children. */
  budded: boolean;
  /** True when the node holds an allocation (only meaningful on leaves). */
  filled: boolean;
  /** Saturation flag — true when this subtree has zero free leaves. Used to short-circuit insert(). */
  full: boolean;
  /** Four equal-size sub-quadrants (top-left, top-right, bottom-left, bottom-right) when budded. */
  children: QuadNode[] | null;
  /** Pointer back up the tree. `null` only on the current root. */
  parent: QuadNode | null;
}

/**
 * Build a fresh root covering an atlas of `size × size` pixels. The root is a
 * single empty leaf; subsequent `insert()` calls will subdivide it on demand.
 */
export function createRoot(size: number): QuadNode {
  return {
    x: 0,
    y: 0,
    size,
    budded: false,
    filled: false,
    full: false,
    children: null,
    parent: null,
  };
}

/**
 * Find and claim a leaf of exactly `requestSize` pixels under `node`. Returns
 * the claimed leaf, or `null` if no slot of that size is available.
 *
 * `requestSize` must be a power of two ≤ `node.size`. Allocation is depth-
 * first into the lowest-index quadrant that still has capacity, so allocations
 * cluster in the top-left of the atlas — this is intentional, it leaves
 * larger contiguous free space for big slots that may arrive later.
 */
export function insert(node: QuadNode, requestSize: number): QuadNode | null {
  if (node.full || node.filled) {
    return null;
  }
  if (node.size < requestSize) {
    return null;
  }
  if (node.size === requestSize) {
    if (node.budded) {
      return null;
    }
    node.filled = true;
    propagateFull(node);
    return node;
  }
  if (!node.budded) {
    bud(node);
  }
  for (const child of node.children!) {
    const placed = insert(child, requestSize);
    if (placed) {
      return placed;
    }
  }
  return null;
}

/**
 * Free a previously-allocated leaf. Propagates the cleared state up the tree,
 * collapsing parents whose quadrants are now all empty so larger requests can
 * succeed again.
 */
export function remove(node: QuadNode): void {
  node.filled = false;
  node.full = false;
  let n: QuadNode | null = node.parent;
  while (n) {
    if (n.budded && n.children!.every((c) => !c.budded && !c.filled)) {
      n.budded = false;
      n.children = null;
    }
    n.full = n.budded
      ? n.children!.every((c) => c.full)
      : n.filled;
    n = n.parent;
  }
}

/**
 * Encode a leaf's (x, y, size) as a single integer the shader can decode in
 * the vertex stage. See the file-level docstring for the bit layout.
 */
export function packSlot(node: QuadNode): number {
  return node.x / 32 + (node.y / 32) * 512 + (node.size / 32) * 262144;
}

/**
 * Doubles the atlas size in both dimensions and returns the new root.
 *
 * The old root becomes the top-left child of the new root, so every leaf
 * already allocated keeps its `(x, y, size)` and the rendering caller can
 * preserve allocations by blitting the old pixel buffer at `(0, 0)` of the
 * new (larger) canvas. The other three quadrants of the new root are fresh
 * empty leaves available for further allocations.
 *
 * Idempotent on the leaf level: existing nodes are not copied, just re-
 * parented, so any external `QuadNode` references stay valid.
 */
export function expand(root: QuadNode): QuadNode {
  if (root.parent !== null) {
    throw new Error('expand() must be called on a root node (parent === null)');
  }
  const newSize = root.size * 2;
  const half = newSize / 2;
  const newRoot: QuadNode = {
    x: 0,
    y: 0,
    size: newSize,
    budded: true,
    filled: false,
    full: false,
    children: null,
    parent: null,
  };
  // Old root keeps its (x=0, y=0, size=oldSize) — that's exactly the top-left
  // quadrant of the new root. Just re-parent it; preserving its budded /
  // filled / children state preserves every existing allocation.
  root.parent = newRoot;
  newRoot.children = [
    root,
    makeChild(newRoot, half, 0, half),
    makeChild(newRoot, 0, half, half),
    makeChild(newRoot, half, half, half),
  ];
  // The new root is full only if all 4 quadrants are full. The 3 fresh
  // quadrants are empty by construction, so the new root is never full
  // immediately after expand().
  newRoot.full = false;
  return newRoot;
}

function bud(node: QuadNode): void {
  node.budded = true;
  const half = node.size / 2;
  node.children = [
    makeChild(node, node.x, node.y, half),
    makeChild(node, node.x + half, node.y, half),
    makeChild(node, node.x, node.y + half, half),
    makeChild(node, node.x + half, node.y + half, half),
  ];
}

function makeChild(parent: QuadNode, x: number, y: number, size: number): QuadNode {
  return {
    x,
    y,
    size,
    budded: false,
    filled: false,
    full: false,
    children: null,
    parent,
  };
}

function propagateFull(node: QuadNode): void {
  let n: QuadNode | null = node;
  while (n) {
    n.full = n.budded
      ? n.children!.every((c) => c.full)
      : n.filled;
    n = n.parent;
  }
}
