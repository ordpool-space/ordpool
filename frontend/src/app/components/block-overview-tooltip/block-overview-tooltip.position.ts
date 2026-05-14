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
 * Output is viewport-relative `{x, y}`, consumed by a `position: fixed`
 * tooltip so it can escape parent stacking contexts and render above
 * the master-page header.
 *
 * Per-axis algorithm:
 *
 *   1. Compute `afterSpace` = room past the cursor in the chosen direction,
 *      and `beforeSpace` = room on the opposite side. Both viewport-relative,
 *      both with the 10 px gap already subtracted.
 *
 *   2. If the tooltip fits in `afterSpace`, place it there (east/south of
 *      cursor with the preferred 10 px gap). Report `maxSize = afterSpace`
 *      so the caller can clamp the rendered size if it ever needs to.
 *
 *   3. If `afterSpace` doesn't fit AND `beforeSpace` has more room, flip:
 *      place the tooltip before the cursor (west/north). `maxSize` becomes
 *      `beforeSpace`.
 *
 *   4. If `afterSpace` has more room than `beforeSpace` but neither side
 *      fits, stay on the after side and let the caller cap `maxSize`. This
 *      is the "tooltip is too tall to fit anywhere" case -- staying near
 *      the cursor with a clipped/scrollable tooltip is better than flipping
 *      far away.
 *
 * Both axes use the same `pickAxis` helper, so X and Y are independent.
 * Floating UI's `shift` middleware isn't needed here because shift moves
 * the tooltip *along* its main axis (sliding) -- with a 0×0 reference,
 * any shift toward the cursor would cross it and violate the master rule.
 * Flip is the only safe vertical adjustment.
 */

export interface TooltipPositionInputs {
  /** Cursor coordinates in offsetParent (canvas) local space. */
  cursor: { x: number; y: number };
  /** Rendered tooltip dimensions. */
  tooltip: { width: number; height: number };
  /** offsetParent's viewport-relative bounds (left/top come from getBoundingClientRect). */
  parent: { left: number; top: number; right: number; width: number };
  /** window.innerWidth / window.innerHeight. */
  viewport: { width: number; height: number };
}

export interface TooltipPositionResult {
  /** Viewport-relative `left` for the tooltip (consumed with `position: fixed`). */
  x: number;
  /** Viewport-relative `top` for the tooltip (consumed with `position: fixed`). */
  y: number;
  /** Available width in the viewport along the chosen X side. Caller may
   *  apply as `max-width` to keep the tooltip from running off-screen. */
  maxWidth: number;
  /** Available height in the viewport along the chosen Y side. Caller may
   *  apply as `max-height` (combined with `overflow: auto`) so the tooltip
   *  stays near the cursor instead of flipping far away when too tall. */
  maxHeight: number;
}

const GAP = 10;

export function computeTooltipPosition(input: TooltipPositionInputs): TooltipPositionResult {
  const { cursor, tooltip, parent, viewport } = input;
  const x = pickAxis(parent.left + cursor.x, tooltip.width,  viewport.width);
  const y = pickAxis(parent.top  + cursor.y, tooltip.height, viewport.height);
  return {
    x: x.position,
    y: y.position,
    maxWidth:  x.maxSize,
    maxHeight: y.maxSize,
  };
}

interface AxisResult { position: number; maxSize: number; }

function pickAxis(cursorVP: number, tooltipSize: number, viewportEnd: number): AxisResult {
  const afterSpace  = viewportEnd - cursorVP - GAP;
  const beforeSpace = cursorVP - GAP;

  // (1) Fits after cursor with the preferred gap.
  if (tooltipSize <= afterSpace) {
    return { position: cursorVP + GAP, maxSize: afterSpace };
  }

  // (2) Doesn't fit after. If before has more room, flip.
  if (beforeSpace > afterSpace) {
    return { position: cursorVP - tooltipSize - GAP, maxSize: beforeSpace };
  }

  // (3) After has more room (or equal) but still not enough.
  // Stay after; let the caller clamp via maxSize.
  return { position: cursorVP + GAP, maxSize: afterSpace };
}
