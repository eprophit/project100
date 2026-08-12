/**
 * Chart palette.
 *
 * This lives in a plain module rather than in the (client-only) chart file on
 * purpose: server components import these values too, and a non-component
 * export pulled across the `'use client'` boundary does not survive as a plain
 * value — the series colours silently arrive as `undefined` and Recharts falls
 * back to its own default, painting every line the same blue.
 *
 * Values are the validated dark-mode categorical steps, in slot order. They are
 * assigned by series position and never cycled; a ninth series is not a
 * generated hue, it is a signal to facet or fold into "other".
 *
 * Verified with the palette validator against the #1a1a19 chart surface:
 * lightness band, chroma floor, adjacent-pair CVD separation (worst ΔE 8.4),
 * normal-vision floor (worst ΔE 19.3) and 3:1 contrast all pass.
 */
export const SERIES_COLORS = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
] as const;

export const MAX_SERIES = SERIES_COLORS.length;

/** Reserved status palette — never reused as a series colour. */
export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

export const CHART_SURFACE = '#1a1a19';
