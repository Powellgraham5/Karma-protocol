/**
 * normalizer.ts
 * -------------
 * Maps a raw value to a [0, 100] score using linear normalisation.
 *
 *   score = clamp((value - min) / (max - min), 0, 1) × 100
 */

export function normalize(
  value: number,
  min:   number,
  max:   number
): number {
  if (max <= min) return 0;
  const ratio = (value - min) / (max - min);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** Clamps a value to [0, 100] and rounds to nearest integer. */
export function clamp100(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}
