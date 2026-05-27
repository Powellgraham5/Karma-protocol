/**
 * batcher.ts
 * ----------
 * Accumulates score-update entries and decides when to flush them to chain.
 *
 * Flush is triggered when EITHER:
 *   • The number of pending entries reaches `config.batchTargetSize` (200)
 *   • The oldest pending entry is >= `config.batchMaxAgeSec` seconds old (30 s)
 *
 * Write-gate: entries with a score delta <= `config.minScoreDelta` vs the last
 * written score are silently dropped to save gas on micro-fluctuations.
 */

import { config }               from "../config";
import { PendingEntry }         from "../state/schema";
import {
  getLastWrittenScore,
  setLastWrittenScore,
} from "../state/walletStore";
import { ScoredWallet }         from "../state/schema";
import { childLogger }          from "../utils/logger";

const log = childLogger("batcher");

// ─── State ────────────────────────────────────────────────────────────────────

const pending = new Map<string, PendingEntry>(); // address → entry

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Adds or updates a scored wallet in the pending batch after checking the
 * write-gate (last written score delta check).
 *
 * @returns `true` if the entry was accepted; `false` if gated out.
 */
export async function enqueue(scored: ScoredWallet): Promise<boolean> {
  const lastScore = await getLastWrittenScore(scored.address);
  const delta     = Math.abs(scored.score - lastScore);

  if (lastScore !== -1 && delta < config.minScoreDelta) {
    log.debug(
      { address: scored.address, score: scored.score, lastScore, delta },
      "Score delta below threshold — skipping"
    );
    return false;
  }

  pending.set(scored.address, {
    address:  scored.address,
    score:    scored.score,
    queuedAt: Date.now(),
  });

  log.debug(
    { address: scored.address, score: scored.score, pendingSize: pending.size },
    "Entry enqueued"
  );
  return true;
}

/**
 * Returns `true` if the batch should be flushed right now.
 */
export function shouldFlush(): boolean {
  if (pending.size === 0) return false;

  if (pending.size >= config.batchTargetSize) {
    log.info({ size: pending.size }, "Batch target size reached — flushing");
    return true;
  }

  const oldest = getOldestQueuedAt();
  const ageSec  = oldest ? (Date.now() - oldest) / 1000 : 0;

  if (ageSec >= config.batchMaxAgeSec) {
    log.info(
      { size: pending.size, ageSec: ageSec.toFixed(1) },
      "Batch max age reached — flushing"
    );
    return true;
  }

  return false;
}

/**
 * Drains and returns up to `maxSize` entries from the pending batch.
 * The returned entries are removed from the pending map.
 */
export function drainBatch(maxSize = 500): PendingEntry[] {
  const entries = [...pending.values()]
    .sort((a, b) => a.queuedAt - b.queuedAt)  // FIFO
    .slice(0, maxSize);

  for (const e of entries) pending.delete(e.address);

  log.info(
    { drained: entries.length, remaining: pending.size },
    "Batch drained"
  );
  return entries;
}

/**
 * Marks a list of entries as successfully written to the chain.
 * Persists the new scores to Redis so the write-gate works on next cycle.
 */
export async function markWritten(entries: PendingEntry[]): Promise<void> {
  await Promise.all(
    entries.map((e) => setLastWrittenScore(e.address, e.score))
  );
  log.debug({ count: entries.length }, "Written scores persisted to Redis");
}

/**
 * Re-queues entries that failed to write (e.g. RPC error).
 * The queuedAt timestamp is preserved so they age correctly.
 */
export function requeue(entries: PendingEntry[]): void {
  for (const e of entries) pending.set(e.address, e);
  log.warn({ count: entries.length }, "Entries re-queued after write failure");
}

/** Returns the current number of pending entries (for metrics / health). */
export function pendingSize(): number {
  return pending.size;
}

// ─── Internal ────────────────────────────────────────────────────────────────

function getOldestQueuedAt(): number | undefined {
  let oldest: number | undefined;
  for (const e of pending.values()) {
    if (oldest === undefined || e.queuedAt < oldest) oldest = e.queuedAt;
  }
  return oldest;
}
