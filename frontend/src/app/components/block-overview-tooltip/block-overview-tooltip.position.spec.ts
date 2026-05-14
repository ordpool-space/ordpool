import { computeTooltipPosition } from './block-overview-tooltip.position';

function cursorIsOutsideTooltip(
  cursorVP: { x: number; y: number },
  pos: { x: number; y: number },
  size: { width: number; height: number },
): boolean {
  const left = pos.x;
  const right = pos.x + size.width;
  const top = pos.y;
  const bottom = pos.y + size.height;
  return cursorVP.x < left || cursorVP.x > right || cursorVP.y < top || cursorVP.y > bottom;
}

describe('computeTooltipPosition', () => {

  describe('(1) fits east+south of cursor with the 10 px gap', () => {

    it('places tooltip 10 px east + 10 px south of cursor', () => {
      const r = computeTooltipPosition({
        cursor: { x: 50, y: 50 },
        tooltip: { width: 300, height: 200 },
        viewport: { width: 1200, height: 800 },
      });
      expect(r.x).toBe(60);
      expect(r.y).toBe(60);
    });

    it('reports maxWidth/maxHeight equal to the available space after cursor', () => {
      const r = computeTooltipPosition({
        cursor: { x: 50, y: 100 },
        tooltip: { width: 300, height: 200 },
        viewport: { width: 1200, height: 800 },
      });
      expect(r.maxWidth).toBe(1200 - 50 - 10);  // 1140
      expect(r.maxHeight).toBe(800 - 100 - 10); // 690
    });

    it('stays east+south as cursor moves across the viewport', () => {
      const inputs = (cursorX: number) => ({
        cursor: { x: cursorX, y: 100 },
        tooltip: { width: 300, height: 200 },
        viewport: { width: 1200, height: 800 },
      });
      expect(computeTooltipPosition(inputs(0)).x).toBe(10);
      expect(computeTooltipPosition(inputs(200)).x).toBe(210);
      expect(computeTooltipPosition(inputs(500)).x).toBe(510);
    });
  });

  describe('(2) flip when after-cursor doesn\'t fit and before-cursor has more room', () => {

    it('flips west when east overflows viewport and west has more room', () => {
      const r = computeTooltipPosition({
        cursor: { x: 1000, y: 50 },
        tooltip: { width: 300, height: 200 },
        viewport: { width: 1200, height: 800 },
      });
      // afterSpace  = 1200 - 1000 - 10 = 190 (tooltip 300 doesn't fit)
      // beforeSpace = 1000 - 10 = 990    (more than after, flip)
      // position    = 1000 - 300 - 10 = 690
      expect(r.x).toBe(690);
      expect(r.maxWidth).toBe(990);
    });

    it('flips north when south overflows viewport and north has more room', () => {
      const r = computeTooltipPosition({
        cursor: { x: 50, y: 700 },
        tooltip: { width: 300, height: 200 },
        viewport: { width: 1200, height: 800 },
      });
      // afterSpace  = 800 - 700 - 10 = 90 (tooltip 200 doesn't fit)
      // beforeSpace = 700 - 10 = 690     (more than after, flip)
      expect(r.y).toBe(490);
      expect(r.maxHeight).toBe(690);
    });
  });

  describe('(3) stays after-cursor when neither side fits but after has more room', () => {

    it('keeps tooltip east of cursor and reports the clamped maxWidth', () => {
      const r = computeTooltipPosition({
        cursor: { x: 100, y: 100 },
        tooltip: { width: 1500, height: 200 },
        viewport: { width: 1200, height: 800 },
      });
      // afterSpace  = 1200 - 100 - 10 = 1090 (doesn't fit 1500)
      // beforeSpace = 100 - 10 = 90          (much less than after)
      expect(r.x).toBe(110);
      expect(r.maxWidth).toBe(1090);
    });

    it('keeps tooltip south of cursor and reports the clamped maxHeight', () => {
      const r = computeTooltipPosition({
        cursor: { x: 100, y: 100 },
        tooltip: { width: 200, height: 900 },
        viewport: { width: 1200, height: 800 },
      });
      // afterSpace  = 800 - 100 - 10 = 690 (doesn't fit 900)
      // beforeSpace = 100 - 10 = 90        (less than after)
      expect(r.y).toBe(110);
      expect(r.maxHeight).toBe(690);
    });
  });

  describe('master rule — tooltip never overlaps the cursor', () => {

    const tooltip = { width: 300, height: 200 };
    const viewport = { width: 1200, height: 800 };

    const cursors = [
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      { x: 0, y: 800 },
      { x: 1200, y: 800 },
      { x: 600, y: 400 },
      { x: 50, y: 750 },
      { x: 1150, y: 50 },
    ];

    cursors.forEach((c) => {
      it(`cursor (${c.x},${c.y}): chosen position keeps cursor uncovered`, () => {
        const r = computeTooltipPosition({ cursor: c, tooltip, viewport });
        expect(cursorIsOutsideTooltip(c, { x: r.x, y: r.y }, tooltip)).toBe(true);
      });
    });

    it('exhaustive 50-px sweep across the viewport: cursor never under tooltip', () => {
      for (let cx = 0; cx <= 1200; cx += 50) {
        for (let cy = 0; cy <= 800; cy += 50) {
          const cursor = { x: cx, y: cy };
          const r = computeTooltipPosition({ cursor, tooltip, viewport });
          if (!cursorIsOutsideTooltip(cursor, { x: r.x, y: r.y }, tooltip)) {
            throw new Error(
              `tooltip covers cursor at (${cx},${cy}) → ` +
              `tooltip rect (${r.x},${r.y},${r.x + tooltip.width},${r.y + tooltip.height})`,
            );
          }
        }
      }
    });

    it('master rule holds when tooltip is too tall to fit anywhere (path 3)', () => {
      const tightTooltip = { width: 300, height: 900 };
      const tightViewport = { width: 1200, height: 600 };
      for (let cy = 0; cy <= 600; cy += 100) {
        const cursor = { x: 100, y: cy };
        const r = computeTooltipPosition({
          cursor, tooltip: tightTooltip, viewport: tightViewport,
        });
        if (!cursorIsOutsideTooltip(cursor, { x: r.x, y: r.y }, tightTooltip)) {
          throw new Error(
            `oversize tooltip covers cursor at (100,${cy}) → ` +
            `position (${r.x},${r.y})`,
          );
        }
      }
    });
  });

  describe('proximity — tooltip stays next to the cursor', () => {

    it('chosen position has at least one edge exactly 10 px from the cursor', () => {
      const tooltip = { width: 300, height: 200 };
      const viewport = { width: 1200, height: 800 };
      for (let cx = 0; cx <= 1200; cx += 100) {
        for (let cy = 0; cy <= 800; cy += 100) {
          const cursor = { x: cx, y: cy };
          const r = computeTooltipPosition({ cursor, tooltip, viewport });
          const eastGap = r.x - cursor.x;
          const westGap = cursor.x - (r.x + tooltip.width);
          const southGap = r.y - cursor.y;
          const northGap = cursor.y - (r.y + tooltip.height);
          const horizontalAttached = eastGap === 10 || westGap === 10;
          const verticalAttached = southGap === 10 || northGap === 10;
          if (!horizontalAttached || !verticalAttached) {
            throw new Error(
              `detached tooltip at cursor (${cx},${cy}) → ` +
              `gaps east=${eastGap} west=${westGap} south=${southGap} north=${northGap}`,
            );
          }
        }
      }
    });
  });
});
