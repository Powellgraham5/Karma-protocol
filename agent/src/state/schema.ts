/**
 * schema.ts
 * ---------
 * TypeScript types and Redis key factories for all persisted state.
 *
 * Redis namespace: `karma:`
 *
 * Keys
 * ────
 *   karma:cursor                   → string  (latest processed block number)
 *   karma:lock:loop                → string  "1"  (distributed loop lock, TTL 90s)
 *   karma:wallet:{addr}            → string  JSON<WalletActivity>
 *   karma:event:{txHash}:{logIdx}  → string  "1"  (dedup, TTL 7d)
 *   karma:score:{addr}             → string  (last written score as integer)
 */

// ─── Wallet activity ──────────────────────────────────────────────────────────

/**
 * Persisted per-wallet state accumulated from on-chain swap events.
 * All timestamps are Unix seconds.
 */
export interface WalletActivity {
  /** Lowercase checksummed address. */
  address: string;

  /** Unix-seconds of the first KarmaFeeApplied event seen for this wallet. */
  firstSeenAt: number;

  /** Unix-seconds of the most recent KarmaFeeApplied event. */
  lastSeenAt: number;

  /** Total swap count seen across all history. */
  swapCount: number;

  /**
   * Unique calendar dates (UTC, "YYYY-MM-DD") the wallet was active.
   * Stored as a sorted array; deduplication enforced on write.
   */
  activeDates: string[];

  /**
   * Ring buffer of the last 50 swap Unix-second timestamps.
   * Used for consistency-factor computation (inter-swap interval CV).
   */
  recentTimestamps: number[];
}

// ─── Scored result ────────────────────────────────────────────────────────────

/** Output of the scoring engine for a single wallet. */
export interface ScoredWallet {
  address: string;
  score: number;    // [0, 100] integer
  breakdown: {
    swapFrequency: number;
    activeDays:    number;
    accountAge:    number;
    consistency:   number;
  };
}

// ─── Pending batch entry ──────────────────────────────────────────────────────

export interface PendingEntry {
  address: string;
  score:   number;       // 0–100
  queuedAt: number;      // Unix-ms when this entry was added to the pending batch
}

// ─── Redis key helpers ────────────────────────────────────────────────────────

export const Keys = {
  cursor:        ()                          => "karma:cursor" as const,
  lock:          ()                          => "karma:lock:loop" as const,
  wallet:        (addr: string)              => `karma:wallet:${addr.toLowerCase()}`,
  event:         (txHash: string, idx: number) => `karma:event:${txHash}:${idx}`,
  score:         (addr: string)              => `karma:score:${addr.toLowerCase()}`,
} as const;

// ─── Constants ────────────────────────────────────────────────────────────────

/** TTL for event dedup keys (seconds). 7 days. */
export const EVENT_DEDUP_TTL_SEC = 7 * 24 * 60 * 60;

/** TTL for the loop distributed lock (seconds). */
export const LOCK_TTL_SEC = 90;

/** Max recent timestamps stored per wallet. */
export const MAX_RECENT_TIMESTAMPS = 50;
