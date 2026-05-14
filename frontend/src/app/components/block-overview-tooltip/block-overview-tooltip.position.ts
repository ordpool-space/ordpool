/**
 * Tooltip-placement logic for the block-overview-graph hover panel.
 *
 * Extracted from Floating UI's `flip` + `size` middlewares, simplified
 * for our use case:
 *   - reference is a single point (the cursor), so it's a 0×0 virtual rect
 *   - tooltip prefers placement "after" cursor on each axis (east + south)
 *   - never overlap the cursor (master rule, equivalent to Floating UI's
 *     `limitShift` keeping the tooltip on one side of the reference)
 *
 * All coordinates are viewport-relative. The tooltip itself is consumed
 * with `position: fixed`, and the caller hands us the cursor's viewport
 * coordinates (from `canvas.getBoundingClientRect()` + canvas-local CSS
 * offset, or from a tap-point in viewport space).
 *
 * Per-axis algorithm:
 *
 *   1. Compute `afterSpace` = room past the cursor along the axis, with
 *      the 10 px gap already subtracted. `beforeSpace` = room on the
 *      opposite side, same gap.
 *
 *   2. If the tooltip fits in `afterSpace`, place it there (east/south
 *      of cursor with the preferred 10 px gap). Report
 *      `maxSize = afterSpace`.
 *
 *   3. If it doesn't fit AND `beforeSpace` has more room, flip: place
 *      before the cursor (west/north). `maxSize = beforeSpace`.
 *
 *   4. If `afterSpace` has more room than `beforeSpace` but neither side
 *      fits, stay on the after side and let the caller cap `maxSize`.
 *      This is the "tooltip is too tall to fit anywhere" case --
 *      staying near the cursor with a clipped/scrollable tooltip is
 *      better than flipping far away.
 *
 * Floating UI's `shift` middleware isn't needed: shift slides the tooltip
 * along its main axis -- with a 0×0 reference, any shift toward the
 * cursor would cross it and violate the master rule. Flip is the only
 * safe vertical adjustment.
 */

export interface TooltipPositionInputs {
  /** Cursor coordinates in viewport space. */
  cursor: { x: number; y: number };
  /** Rendered tooltip dimensions. */
  tooltip: { width: number; height: number };
  /** window.innerWidth / window.innerHeight. */
  viewport: { width: number; height: number };
}

export interface TooltipPositionResult {
  /** Viewport-relative `left` (consumed with `position: fixed`). */
  x: number;
  /** Viewport-relative `top` (consumed with `position: fixed`). */
  y: number;
  /** Available width on the chosen X side. Caller may apply as `max-width`. */
  maxWidth: number;
  /** Available height on the chosen Y side. Caller may apply as
   *  `max-height` (with `overflow-y: auto`) so the tooltip shrinks
   *  instead of flipping far from the cursor when too tall. */
  maxHeight: number;
}

const GAP = 10;

export function computeTooltipPosition(input: TooltipPositionInputs): TooltipPositionResult {
  const { cursor, tooltip, viewport } = input;
  const x = pickAxis(cursor.x, tooltip.width,  viewport.width);
  const y = pickAxis(cursor.y, tooltip.height, viewport.height);
  return { x: x.position, y: y.position, maxWidth: x.maxSize, maxHeight: y.maxSize };
}

interface AxisResult { position: number; maxSize: number; }

function pickAxis(cursor: number, tooltipSize: number, viewportEnd: number): AxisResult {
  const afterSpace  = viewportEnd - cursor - GAP;
  const beforeSpace = cursor - GAP;

  // (1) Fits after cursor with the preferred gap.
  if (tooltipSize <= afterSpace) {
    return { position: cursor + GAP, maxSize: afterSpace };
  }

  // (2) Doesn't fit after. If before has more room, flip.
  if (beforeSpace > afterSpace) {
    return { position: cursor - tooltipSize - GAP, maxSize: beforeSpace };
  }

  // (3) After has more room (or equal) but still not enough.
  // Stay after; let the caller clamp via maxSize.
  return { position: cursor + GAP, maxSize: afterSpace };
}
