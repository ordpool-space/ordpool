/*
  Quadtree slot allocator for the inscription image atlas.

  Pure, DOM-free, WebGL-free — easy to unit-test in isolation. Used only by
  OrdpoolInscriptionAtlas.

  Atlas is laid out as a square of `size` pixels. Allocation requests are
  power-of-two slot sizes (32, 64, 128, 256, 512). Free space is tracked as a
  tree of nodes; when a request lands deeper than the current subdivision, the
  parent is "budded" into 4 quadrants. The `full` flag propagates upward so
  we can short-circuit search through saturated subtrees.
*/

export interface QuadNode {
  x: number;
  y: number;
  size: number;
  budded: boolean;
  filled: boolean;
  full: boolean;
  children: QuadNode[] | null;
  parent: QuadNode | null;
}

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

export function packSlot(node: QuadNode): number {
  return node.x / 32 + (node.y / 32) * 512 + (node.size / 32) * 262144;
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
