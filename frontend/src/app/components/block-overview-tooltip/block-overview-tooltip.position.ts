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
 *      of cursor) at its NATURAL size, `maxSize = null` (no clamp).
 *
 *   3. Else if it fits in `beforeSpace`, flip before the cursor
 *      (west/north) at natural size, `maxSize = null` (no clamp).
 *
 *   4. Else (larger than both sides -- rare): use the side with more
 *      room, pin the position to the viewport edge so it stays on-screen
 *      without covering the cursor, and clamp `maxSize` to that room so
 *      it scrolls internally.
 *
 * The key property: a tooltip that fits gets NO max-size clamp, so it
 * keeps a stable size as the cursor moves (it simply flips between
 * below/above at a threshold). Clamping to the shrinking after-space --
 * the previous behaviour -- made the panel visibly resize on every mouse
 * move, which is worse than an occasional flip.
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
  /** `max-width` to apply, or null for no clamp. Non-null only when the tooltip
   *  is wider than the room on both sides of the cursor. */
  maxWidth: number | null;
  /** `max-height` to apply (with `overflow-y: auto`), or null for no clamp.
   *  Non-null only when the tooltip is taller than the room on both sides of the
   *  cursor -- so a tooltip that fits is placed at its natural size and does NOT
   *  resize as the cursor moves. */
  maxHeight: number | null;
}

const GAP = 10;

export function computeTooltipPosition(input: TooltipPositionInputs): TooltipPositionResult {
  const { cursor, tooltip, viewport } = input;
  const x = pickAxis(cursor.x, tooltip.width,  viewport.width);
  const y = pickAxis(cursor.y, tooltip.height, viewport.height);
  return { x: x.position, y: y.position, maxWidth: x.maxSize, maxHeight: y.maxSize };
}

interface AxisResult { position: number; maxSize: number | null; }

function pickAxis(cursor: number, tooltipSize: number, viewportEnd: number): AxisResult {
  const afterSpace  = viewportEnd - cursor - GAP;
  const beforeSpace = cursor - GAP;

  // (1) Fits after the cursor: place there at natural size, no clamp. Placing
  // without a clamp is what keeps the tooltip a STABLE size as the cursor moves
  // -- clamping to the shrinking after-space is what made it resize.
  if (tooltipSize <= afterSpace) {
    return { position: cursor + GAP, maxSize: null };
  }

  // (2) Doesn't fit after but fits before: flip there at natural size, no clamp.
  if (tooltipSize <= beforeSpace) {
    return { position: cursor - tooltipSize - GAP, maxSize: null };
  }

  // (3) Larger than both sides (rare, and made rarer by capping the artifact
  // preview): keep the cursor uncovered by placing on the side with more room
  // and clamp `maxSize` to that room so the panel scrolls internally.
  if (beforeSpace > afterSpace) {
    return { position: cursor - tooltipSize - GAP, maxSize: beforeSpace };
  }
  return { position: cursor + GAP, maxSize: afterSpace };
}
