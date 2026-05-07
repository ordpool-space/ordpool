import { createRoot, insert, remove, packSlot, QuadNode } from './ordpool-quadtree-allocator';

const ATLAS = 1024;

function leaves(node: QuadNode): QuadNode[] {
  if (!node.budded) return [node];
  return node.children!.flatMap(leaves);
}

function filledLeaves(node: QuadNode): QuadNode[] {
  return leaves(node).filter((n) => n.filled);
}

describe('ordpool-quadtree-allocator', () => {

  describe('createRoot', () => {
    it('starts as a single empty leaf at origin', () => {
      const root = createRoot(ATLAS);
      expect(root.x).toBe(0);
      expect(root.y).toBe(0);
      expect(root.size).toBe(ATLAS);
      expect(root.budded).toBe(false);
      expect(root.filled).toBe(false);
      expect(root.full).toBe(false);
      expect(root.children).toBeNull();
      expect(root.parent).toBeNull();
    });
  });

  describe('insert at root size', () => {
    it('claims the root when the request matches root size exactly', () => {
      const root = createRoot(ATLAS);
      const node = insert(root, ATLAS);
      expect(node).toBe(root);
      expect(root.filled).toBe(true);
      expect(root.full).toBe(true);
      expect(root.budded).toBe(false);
    });

    it('rejects inserts after the root is fully claimed', () => {
      const root = createRoot(ATLAS);
      insert(root, ATLAS);
      expect(insert(root, ATLAS)).toBeNull();
      expect(insert(root, 32)).toBeNull();
    });
  });

  describe('insert smaller than root size', () => {
    it('buds the root into 4 quadrants when a smaller slot is requested', () => {
      const root = createRoot(ATLAS);
      const slot = insert(root, ATLAS / 2);

      expect(root.budded).toBe(true);
      expect(root.children).not.toBeNull();
      expect(root.children!.length).toBe(4);

      // Slot lands in the first quadrant (top-left, traversal order).
      expect(slot).not.toBeNull();
      expect(slot!.x).toBe(0);
      expect(slot!.y).toBe(0);
      expect(slot!.size).toBe(ATLAS / 2);
      expect(slot!.filled).toBe(true);
    });

    it('places 4 half-size slots in the 4 quadrants of the root', () => {
      const root = createRoot(ATLAS);
      const half = ATLAS / 2;

      const a = insert(root, half)!;
      const b = insert(root, half)!;
      const c = insert(root, half)!;
      const d = insert(root, half)!;

      const positions = [a, b, c, d].map((n) => `${n.x},${n.y}`).sort();
      expect(positions).toEqual([
        `0,0`,
        `0,${half}`,
        `${half},0`,
        `${half},${half}`,
      ]);

      expect(root.full).toBe(true);
      expect(insert(root, half)).toBeNull();
    });

    it('recurses through multiple levels for slots much smaller than the root', () => {
      const root = createRoot(ATLAS);
      const slot = insert(root, 32)!;

      // Smallest slot lives at depth log2(1024/32) = 5 below the root.
      expect(slot.size).toBe(32);
      expect(slot.x).toBe(0);
      expect(slot.y).toBe(0);

      let depth = 0;
      let n: QuadNode | null = slot;
      while (n && n.parent) {
        depth++;
        n = n.parent;
      }
      expect(depth).toBe(5);
    });

    it('rejects requests larger than the root size', () => {
      const root = createRoot(ATLAS);
      expect(insert(root, ATLAS * 2)).toBeNull();
      expect(root.budded).toBe(false);
    });
  });

  describe('full propagation', () => {
    it('marks a parent full only after all 4 children fill', () => {
      const root = createRoot(ATLAS);
      const half = ATLAS / 2;

      insert(root, half);
      expect(root.full).toBe(false);
      insert(root, half);
      expect(root.full).toBe(false);
      insert(root, half);
      expect(root.full).toBe(false);
      insert(root, half);
      expect(root.full).toBe(true);
    });

    it('skips fully-saturated subtrees on subsequent inserts', () => {
      const root = createRoot(ATLAS);
      const half = ATLAS / 2;
      const quarter = ATLAS / 4;

      // Saturate the first quadrant with quarter-size slots.
      insert(root, quarter);
      insert(root, quarter);
      insert(root, quarter);
      insert(root, quarter);

      // The first quadrant's child is now full; root is not.
      const firstQuadrant = root.children![0];
      expect(firstQuadrant.full).toBe(true);
      expect(root.full).toBe(false);

      // Next half-size insert must skip the saturated first quadrant
      // and land in the next available quadrant (top-right at half,0).
      const next = insert(root, half)!;
      expect(next.x).toBe(half);
      expect(next.y).toBe(0);
    });
  });

  describe('remove', () => {
    it('frees a leaf and clears its full flag', () => {
      const root = createRoot(ATLAS);
      const slot = insert(root, ATLAS)!;
      remove(slot);
      expect(slot.filled).toBe(false);
      expect(slot.full).toBe(false);
      expect(insert(root, ATLAS)).toBe(root);
    });

    it('collapses the parent when all 4 children are removed', () => {
      const root = createRoot(ATLAS);
      const half = ATLAS / 2;

      const a = insert(root, half)!;
      const b = insert(root, half)!;
      const c = insert(root, half)!;
      const d = insert(root, half)!;
      expect(root.budded).toBe(true);

      remove(a);
      expect(root.budded).toBe(true); // still has 3 filled siblings
      remove(b);
      remove(c);
      expect(root.budded).toBe(true);
      remove(d);
      expect(root.budded).toBe(false);
      expect(root.children).toBeNull();
      expect(root.full).toBe(false);

      // Whole atlas should now be reclaimable as a single slot.
      expect(insert(root, ATLAS)).toBe(root);
    });

    it('clears full propagation up the chain when a deep leaf is freed', () => {
      const root = createRoot(ATLAS);
      const half = ATLAS / 2;
      const quarter = ATLAS / 4;

      // Saturate the first quadrant with quarter-size slots.
      const q1 = insert(root, quarter)!;
      insert(root, quarter);
      insert(root, quarter);
      insert(root, quarter);
      // Saturate the rest of the atlas with half-size slots.
      insert(root, half);
      insert(root, half);
      insert(root, half);
      expect(root.full).toBe(true);

      // Free one quarter-size leaf in the first quadrant. The first quadrant
      // should drop its full flag and the root should follow.
      remove(q1);
      const firstQuadrant = root.children![0];
      expect(firstQuadrant.full).toBe(false);
      expect(root.full).toBe(false);

      // The freed quarter-size slot should be reusable.
      const reuse = insert(root, quarter)!;
      expect(reuse.x).toBe(0);
      expect(reuse.y).toBe(0);
      expect(reuse.size).toBe(quarter);
    });
  });

  describe('packSlot', () => {
    it('encodes (0, 0, 32) as 1', () => {
      const root = createRoot(ATLAS);
      const slot = insert(root, 32)!;
      // size/32 = 1, *262144 = 262144, plus x/32 + (y/32)*512 = 0 -> 262144
      expect(packSlot(slot)).toBe(262144);
    });

    it('encodes the size term in the high bits', () => {
      const node: QuadNode = {
        x: 0, y: 0, size: 1024,
        budded: false, filled: true, full: true, children: null, parent: null,
      };
      // size/32 = 32, *262144 = 8388608
      expect(packSlot(node)).toBe(32 * 262144);
    });

    it('encodes y in the middle band and x in the low band', () => {
      // Position (32, 64) with a 32px slot: x/32 = 1, y/32 = 2, size/32 = 1.
      const node: QuadNode = {
        x: 32, y: 64, size: 32,
        budded: false, filled: true, full: true, children: null, parent: null,
      };
      // 1 + 2*512 + 1*262144 = 263169
      expect(packSlot(node)).toBe(1 + 2 * 512 + 262144);
    });

    it('round-trips a slot through encode and bit-extract', () => {
      const root = createRoot(ATLAS);
      // First image-sized request that buds twice (1024 -> 512 -> 256).
      const slot = insert(root, 256)!;
      const packed = packSlot(slot);

      // Mirror the shader's decode.
      const decodedX = (packed % 512) * 32;
      const decodedY = (Math.floor(packed / 512) % 512) * 32;
      const decodedSize = Math.floor(packed / 262144) * 32;

      expect(decodedX).toBe(slot.x);
      expect(decodedY).toBe(slot.y);
      expect(decodedSize).toBe(slot.size);
    });
  });

  describe('packing pressure', () => {
    it('places exactly (atlas/slot)^2 minimum-size slots before refusing', () => {
      const root = createRoot(ATLAS);
      const placed: QuadNode[] = [];
      // The atlas has (1024/32)^2 = 1024 slots of the smallest size.
      for (let i = 0; i < 1024; i++) {
        const slot = insert(root, 32);
        if (slot) placed.push(slot);
      }
      expect(placed.length).toBe(1024);
      expect(filledLeaves(root).length).toBe(1024);
      expect(insert(root, 32)).toBeNull();
      expect(root.full).toBe(true);
    });

    it('all placed slots are unique non-overlapping rectangles', () => {
      const root = createRoot(ATLAS);
      const sizes = [32, 64, 128, 256, 512, 32, 64, 128, 32, 256];
      const placed = sizes.map((s) => insert(root, s)!).filter(Boolean);
      const seen = new Set<string>();
      for (const slot of placed) {
        // Every slot occupies a distinct (x,y,size) cell.
        const key = `${slot.x},${slot.y},${slot.size}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      // Pairwise: no two slots' rectangles overlap.
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i];
          const b = placed[j];
          const overlapX = a.x < b.x + b.size && b.x < a.x + a.size;
          const overlapY = a.y < b.y + b.size && b.y < a.y + a.size;
          expect(overlapX && overlapY).toBe(false);
        }
      }
    });
  });
});
