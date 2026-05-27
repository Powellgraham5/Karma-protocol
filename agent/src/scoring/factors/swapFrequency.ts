/**
 * swapFrequency.ts
 * ----------------
 * Factor: how actively does the wallet swap within the scoring window?
 *
 * Algorithm:
 *   1. Filter activeDates to only those within the scoring window.
 *   2. Compute swaps per active day within the window:
 *        windowSwapCount / max(windowActiveDays, 1)
 *   3. Normalise against SWAP_FREQ_CAP (10 swaps/day → score 100).
 *
 * Rationale: raw swap count would favour bots with millions of micro-swaps.
 * Dividing by active days normalises for "how intense is each active day",
 * not "how many total swaps".
 */

import { WalletActivity }       from "../../state/schema";
import { normalize }            from "../normalizer";
import { SWAP_FREQ_CAP }        from "../weights";
import { config }               from "../../config";

export function swapFrequencyFactor(activity: WalletActivity): number {
  const windowStart = windowStartTimestamp();

  // Count swaps within the window using activeDates as a proxy.
  // recentTimestamps gives us actual event timestamps for a precise count.
  const windowTimestamps = activity.recentTimestamps.filter(
    (ts) => ts >= windowStart
  );

  // Active days within window
  const windowDates = new Set(
    activity.activeDates.filter((d) => d >= utcDate(windowStart))
  );
  const activeDaysInWindow = Math.max(windowDates.size, 1);

  // Avg swaps per active day
  const avgSwapsPerDay = windowTimestamps.length / activeDaysInWindow;

  return normalize(avgSwapsPerDay, 0, SWAP_FREQ_CAP);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function windowStartTimestamp(): number {
  const windowMs = config.scoringWindowDays * 24 * 60 * 60 * 1000;
  return Math.floor((Date.now() - windowMs) / 1000);
}

function utcDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}
