/**
 * consistency.ts
 * --------------
 * Factor: how evenly-spaced are the wallet's swap events?
 *
 * A wallet with highly regular swap intervals (low variance) looks like a
 * legitimate user with a trading routine, while a wallet that does everything
 * in one burst and disappears looks like an airdrop farmer.
 *
 * Algorithm:
 *   1. Take the last N timestamps from recentTimestamps.
 *   2. Compute inter-swap intervals (seconds between consecutive swaps).
 *   3. Compute coefficient of variation:  CV = stddev(intervals) / mean(intervals)
 *   4. Map CV to [0, 100]: low CV → high score, high CV → low score.
 *        score = normalize(CONSISTENCY_CV_MAX - CV, 0, CONSISTENCY_CV_MAX)
 *
 * Edge cases:
 *   < 2 timestamps → cannot compute intervals → return 50 (neutral).
 *   All same timestamp (mean = 0) → return 0 (degenerate).
 */

import { WalletActivity }       from "../../state/schema";
import { normalize }            from "../normalizer";
import { CONSISTENCY_CV_MAX }   from "../weights";

export function consistencyFactor(activity: WalletActivity): number {
  const ts = [...activity.recentTimestamps].sort((a, b) => a - b);

  if (ts.length < 2) return 50; // not enough data — neutral score

  // Compute inter-swap intervals
  const intervals: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    intervals.push(ts[i]! - ts[i - 1]!);
  }

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;

  if (mean === 0) return 0; // all same timestamp — degenerate

  const variance =
    intervals.reduce((sum, x) => sum + (x - mean) ** 2, 0) / intervals.length;
  const stddev = Math.sqrt(variance);
  const cv     = stddev / mean;

  // Low CV → high consistency → high score
  const adjusted = CONSISTENCY_CV_MAX - cv;
  return normalize(adjusted, 0, CONSISTENCY_CV_MAX);
}
