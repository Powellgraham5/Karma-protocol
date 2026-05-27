/**
 * walletStore.ts
 * --------------
 * CRUD operations for per-wallet activity records stored in Redis.
 *
 * Each wallet's activity is serialised as a JSON string under the key
 * `karma:wallet:{lowerCaseAddress}`.
 *
 * The store is append-only from the event-ingestion side: `recordSwap`
 * merges a new swap event into the existing record.
 */

import { getRedis }    from "./redis";
import {
  Keys,
  WalletActivity,
  EVENT_DEDUP_TTL_SEC,
  MAX_RECENT_TIMESTAMPS,
} from "./schema";
import { childLogger } from "../utils/logger";

const log = childLogger("walletStore");

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Records a single swap event for `address`.
 * Idempotent: returns false (and skips the write) if the event was already
 * processed (dedup via `karma:event:{txHash}:{logIndex}`).
 *
 * @param address    Swapper address (lower-cased internally).
 * @param timestamp  Unix-seconds of the block that included the swap.
 * @param txHash     Transaction hash — used for dedup key.
 * @param logIndex   Log index — used for dedup key.
 * @returns          `true` if the event was new and written; `false` if skipped.
 */
export async function recordSwap(
  address:   string,
  timestamp: number,
  txHash:    string,
  logIndex:  number
): Promise<boolean> {
  const redis = getRedis();
  const dedup = Keys.event(txHash, logIndex);

  // SET key value NX EX <ttl>  — returns "OK" if set, null if already exists
  // ioredis SET NX EX order: key value "EX" seconds "NX"
  const result = await redis.set(dedup, "1", "EX", EVENT_DEDUP_TTL_SEC, "NX");

  if (result === null) {
    log.debug({ txHash, logIndex }, "Event already processed — skipping");
    return false;
  }

  const key      = Keys.wallet(address);
  const existing = await getWallet(address);

  const date   = utcDate(timestamp);
  const merged = mergeActivity(existing, address, timestamp, date);

  await redis.set(key, JSON.stringify(merged));
  log.debug(
    { address: address.toLowerCase(), swapCount: merged.swapCount, date },
    "Swap recorded"
  );
  return true;
}

/**
 * Retrieves the full activity record for a wallet, or `null` if unknown.
 */
export async function getWallet(address: string): Promise<WalletActivity | null> {
  const redis = getRedis();
  const raw   = await redis.get(Keys.wallet(address));

  if (!raw) return null;

  try {
    return JSON.parse(raw) as WalletActivity;
  } catch (err) {
    log.error({ err, address }, "Failed to parse wallet activity — resetting");
    return null;
  }
}

/**
 * Returns ALL wallet activity records stored in Redis.
 * Paginates via SCAN to avoid blocking the server on large datasets.
 */
export async function getAllWallets(): Promise<WalletActivity[]> {
  const redis   = getRedis();
  const pattern = "karma:wallet:*";
  const results: WalletActivity[] = [];

  let cursor = "0";
  do {
    // ioredis scan returns [nextCursor: string, keys: string[]]
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH", pattern,
      "COUNT", 500
    );
    cursor = nextCursor;

    if (keys.length > 0) {
      const values = await redis.mget(...keys);
      for (const v of values) {
        if (!v) continue;
        try {
          results.push(JSON.parse(v) as WalletActivity);
        } catch {
          // skip corrupt entries
        }
      }
    }
  } while (cursor !== "0");

  log.debug({ count: results.length }, "Loaded all wallet activities");
  return results;
}

/**
 * Reads and returns the last score written to the chain for `address`.
 * Returns -1 if no score has been written yet (forces first write).
 */
export async function getLastWrittenScore(address: string): Promise<number> {
  const redis = getRedis();
  const raw   = await redis.get(Keys.score(address));
  if (raw === null) return -1;
  return parseInt(raw, 10);
}

/**
 * Persists the score that was just written to the chain.
 */
export async function setLastWrittenScore(
  address: string,
  score:   number
): Promise<void> {
  const redis = getRedis();
  await redis.set(Keys.score(address), String(score));
}

// ─── Internals ────────────────────────────────────────────────────────────────

function mergeActivity(
  existing:  WalletActivity | null,
  address:   string,
  timestamp: number,
  date:      string
): WalletActivity {
  const addr = address.toLowerCase();

  if (!existing) {
    return {
      address:          addr,
      firstSeenAt:      timestamp,
      lastSeenAt:       timestamp,
      swapCount:        1,
      activeDates:      [date],
      recentTimestamps: [timestamp],
    };
  }

  // Merge activeDates (sorted unique)
  const datesSet = new Set(existing.activeDates);
  datesSet.add(date);
  const activeDates = Array.from(datesSet).sort();

  // Append to recent timestamps ring buffer
  const ts = [...existing.recentTimestamps, timestamp]
    .slice(-MAX_RECENT_TIMESTAMPS);

  return {
    address:          addr,
    firstSeenAt:      Math.min(existing.firstSeenAt, timestamp),
    lastSeenAt:       Math.max(existing.lastSeenAt,  timestamp),
    swapCount:        existing.swapCount + 1,
    activeDates,
    recentTimestamps: ts,
  };
}

/** Returns "YYYY-MM-DD" string for a Unix-seconds timestamp (UTC). */
function utcDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}
