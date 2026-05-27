/**
 * engine.ts
 * ---------
 * Orchestrates the four scoring factors into a final [0, 100] karma score.
 *
 * Final score = Σ(factorScore × weight) — a weighted average.
 * Result is rounded and clamped to [0, 100] so it fits in a uint8 on-chain.
 */

import { WalletActivity } from "../state/schema";
import { ScoredWallet }   from "../state/schema";
import { WEIGHTS }        from "./weights";
import { clamp100 }       from "./normalizer";
import { swapFrequencyFactor } from "./factors/swapFrequency";
import { activeDaysFactor }    from "./factors/activeDays";
import { accountAgeFactor }    from "./factors/accountAge";
import { consistencyFactor }   from "./factors/consistency";

/**
 * Computes the karma score for a single wallet.
 *
 * @param activity  Persisted wallet activity from Redis.
 * @returns         Scored result with final score and per-factor breakdown.
 */
export function computeScore(activity: WalletActivity): ScoredWallet {
  const sf  = swapFrequencyFactor(activity);
  const ad  = activeDaysFactor(activity);
  const aa  = accountAgeFactor(activity);
  const con = consistencyFactor(activity);

  const raw = (
    sf  * WEIGHTS.swapFrequency +
    ad  * WEIGHTS.activeDays    +
    aa  * WEIGHTS.accountAge    +
    con * WEIGHTS.consistency
  );

  return {
    address: activity.address,
    score:   clamp100(raw),
    breakdown: {
      swapFrequency: sf,
      activeDays:    ad,
      accountAge:    aa,
      consistency:   con,
    },
  };
}

/**
 * Computes scores for a batch of wallet activities.
 * Returns only wallets with at least `minSwapCount` swaps (default: 1).
 */
export function computeScores(
  activities: WalletActivity[],
  minSwapCount = 1
): ScoredWallet[] {
  return activities
    .filter((a) => a.swapCount >= minSwapCount)
    .map(computeScore);
}
