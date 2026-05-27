/**
 * activeDays.ts
 * -------------
 * Factor: how many distinct calendar days did the wallet interact with the
 * pool within the scoring window?
 *
 * A wallet that swaps every day for 30+ days looks very different from one
 * that did 30 swaps in a single day.
 *
 * Algorithm:
 *   count = activeDates within the window
 *   score = normalize(count, 0, ACTIVE_DAYS_CAP)
 */

import { WalletActivity }     from "../../state/schema";
import { normalize }          from "../normalizer";
import { ACTIVE_DAYS_CAP }    from "../weights";
import { config }             from "../../config";

export function activeDaysFactor(activity: WalletActivity): number {
  const windowStart = windowStartDate();

  const daysInWindow = activity.activeDates.filter(
    (d) => d >= windowStart
  ).length;

  return normalize(daysInWindow, 0, ACTIVE_DAYS_CAP);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function windowStartDate(): string {
  const windowMs = config.scoringWindowDays * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - windowMs).toISOString().slice(0, 10);
}
