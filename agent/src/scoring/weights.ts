/**
 * weights.ts
 * ----------
 * Scoring factor weights and normalisation caps.
 *
 * Final score = Σ(factor × weight), clamped to [0, 100].
 * All weights must sum to 1.0.
 */

export const WEIGHTS = {
  /** How frequently the wallet swaps (swaps per active day in the window). */
  swapFrequency: 0.40,

  /** How many distinct calendar days the wallet was active. */
  activeDays:    0.20,

  /** How long ago the wallet first appeared (account age). */
  accountAge:    0.20,

  /** How evenly distributed the swap intervals are (low variance = high score). */
  consistency:   0.20,
} as const;

/** Sanity check — weights must sum to 1.0 */
const _sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(_sum - 1.0) > 1e-9) {
  throw new Error(`[weights] Weights must sum to 1.0; got ${_sum}`);
}

// ─── Normalisation caps ───────────────────────────────────────────────────────

/** Avg swaps/day that maps to a raw score of 100. Cap to prevent gaming. */
export const SWAP_FREQ_CAP = 10;  // 10 swaps/day → full score

/** Number of active days (in window) that maps to 100. */
export const ACTIVE_DAYS_CAP = 45; // active half the 90-day window → full score

/** Account age in days that maps to 100. */
export const ACCOUNT_AGE_CAP_DAYS = 365; // 1 year of history → full score

/**
 * Coefficient of variation threshold below which consistency = 100.
 * CV = stddev / mean of inter-swap intervals.
 * CV = 0 means perfectly regular; CV = 1 means very erratic.
 */
export const CONSISTENCY_CV_MAX = 1.5;  // CV >= 1.5 → consistency score of 0
