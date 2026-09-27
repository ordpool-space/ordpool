/**
 * Whether the walk opens with its on-screen joysticks: on a pointer that
 * cannot hover, or on any device reporting touch points.
 *
 * One predicate for two decisions that must agree. The renderer uses it to
 * show the joysticks, the viewer to take the stage fullscreen on walk
 * entry; decided apart, a device with touch points but a fine primary
 * pointer (Android with a mouse or a stylus digitiser, a touch laptop) got
 * the joysticks inside a 600 px square.
 *
 * Deliberately NOT the question "can this pointer hover?", which decides
 * whether a tooltip is worth showing: a touch laptop has touch points AND a
 * mouse, and keeps its tooltips.
 */
export const walkStartsWithTouchUi = (): boolean =>
  (typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false)) ||
  (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0);
