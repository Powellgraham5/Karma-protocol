/**
 * accountAge.ts
 * -------------
 * Factor: how long has this wallet been active in the system?
 *
 * Older wallets are inherently more trust-worthy: sybil accounts tend to be
 * short-lived and expendable.
 *
 * Algorithm:
 *   ageDays = (now - firstSeenAt) / 86400
 *   score   = normalize(ageDays, 0, ACCOUNT_AGE_CAP_DAYS)
 */

import { WalletActivity }         from "../../state/schema";
import { normalize }              from "../normalizer";
import { ACCOUNT_AGE_CAP_DAYS }   from "../weights";

export function accountAgeFactor(activity: WalletActivity): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = Math.max(0, nowSec - activity.firstSeenAt);
  const ageDays = ageSec / 86_400;

  return normalize(ageDays, 0, ACCOUNT_AGE_CAP_DAYS);
}
