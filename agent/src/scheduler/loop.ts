/**
 * loop.ts
 * -------
 * Main orchestration loop — runs every `config.pollIntervalMs` milliseconds.
 *
 * Each iteration:
 *   1. Acquire distributed lock (prevents duplicate runs across replicas).
 *   2. Determine the block range to scan (cursor → latest).
 *   3. Fetch KarmaFeeApplied events via getLogs.
 *   4. Record each swap event in Redis (dedup-safe).
 *   5. Re-score all wallets with recent activity.
 *   6. Enqueue score updates through the write-gate (delta threshold).
 *   7. Flush the batch if size/age thresholds are met.
 *   8. Advance the cursor.
 *   9. Release the lock.
 *
 * The lock TTL (90 s) is intentionally longer than the loop interval so a
 * stuck iteration times out naturally.  A healthy iteration should complete
 * well within 60 s.
 */

import { getRedis }         from "../state/redis";
import { Keys, LOCK_TTL_SEC } from "../state/schema";
import { getCursor, setCursor } from "../state/cursor";
import { recordSwap, getAllWallets } from "../state/walletStore";
import {
  pollEvents,
  clearBlockTimestampCache,
} from "../chain/events/poller";
import { getPublicClient }  from "../chain/providers";
import { computeScores }    from "../scoring/engine";
import { enqueue, shouldFlush, drainBatch, markWritten, requeue } from "../registry/batcher";
import { writeBatch }       from "../registry/writer";
import { config }           from "../config";
import { sleep }            from "../utils/sleep";
import { childLogger }      from "../utils/logger";

const log = childLogger("loop");

// ─── Loop state ───────────────────────────────────────────────────────────────

let _running  = false;
let _loopCount = 0;
let _lastLoopAt: number | null = null;
let _lastError: string | null = null;

/** Returns a snapshot of loop health for the HTTP endpoint. */
export function getLoopHealth() {
  return {
    running:    _running,
    loopCount:  _loopCount,
    lastLoopAt: _lastLoopAt,
    lastError:  _lastError,
  };
}

// ─── Main loop ────────────────────────────────────────────────────────────────

/**
 * Starts the infinite polling loop.
 * Call once from index.ts; the loop runs until the process exits.
 */
export async function startLoop(): Promise<void> {
  log.info(
    {
      intervalMs:    config.pollIntervalMs,
      blockBatch:    config.blockBatchSize.toString(),
      scoringWindow: config.scoringWindowDays,
    },
    "Starting main loop"
  );

  while (true) {
    const start = Date.now();
    _running    = true;

    try {
      await runOnce();
      _lastError = null;
    } catch (err) {
      _lastError = err instanceof Error ? err.message : String(err);
      log.error({ err }, "Loop iteration failed");
    } finally {
      _running    = false;
      _lastLoopAt = Date.now();
      _loopCount++;
    }

    const elapsed = Date.now() - start;
    const wait    = Math.max(0, config.pollIntervalMs - elapsed);

    log.debug(
      { elapsed, waitMs: wait, loopCount: _loopCount },
      "Loop iteration complete"
    );

    if (wait > 0) await sleep(wait);
  }
}

// ─── Single iteration ─────────────────────────────────────────────────────────

async function runOnce(): Promise<void> {
  // 1. Acquire distributed lock
  const redis = getRedis();
  // ioredis SET NX EX order: key value "EX" ttl "NX"  — returns "OK" | null
  const lockAcquired = await redis.set(
    Keys.lock(), "1", "EX", LOCK_TTL_SEC, "NX"
  );

  if (lockAcquired !== "OK") {
    log.info("Loop lock held by another replica — skipping this cycle");
    return;
  }

  try {
    await runIteration();
  } finally {
    // Always release the lock so other replicas aren't blocked
    await redis.del(Keys.lock());
  }
}

async function runIteration(): Promise<void> {
  clearBlockTimestampCache();

  // 2. Determine block range
  const client  = getPublicClient();
  const latest  = await client.getBlockNumber();
  const cursor  = await getCursor();

  if (cursor >= latest) {
    log.debug({ cursor: cursor.toString(), latest: latest.toString() }, "No new blocks");
    return;
  }

  const fromBlock = cursor + 1n;
  const toBlock   = latest;

  log.info(
    {
      fromBlock: fromBlock.toString(),
      toBlock:   toBlock.toString(),
      blocks:    (toBlock - fromBlock + 1n).toString(),
    },
    "Scanning blocks"
  );

  // 3. Fetch events
  const events = await pollEvents(fromBlock, toBlock);
  log.info({ events: events.length }, "Events fetched");

  // 4. Record swaps
  let newSwaps  = 0;
  const touched = new Set<string>();  // wallets with at least 1 new event this cycle

  for (const ev of events) {
    const isNew = await recordSwap(
      ev.swapper,
      ev.blockTimestamp,
      ev.txHash,
      ev.logIndex
    );
    if (isNew) {
      newSwaps++;
      touched.add(ev.swapper);
    }
  }

  log.info({ newSwaps, touched: touched.size }, "Swaps recorded");

  // 5. Re-score wallets that had new activity this cycle
  if (touched.size > 0) {
    const allActivities = await getAllWallets();
    const toScore = allActivities.filter((a) => touched.has(a.address));
    const scored  = computeScores(toScore);

    log.debug({ scored: scored.length }, "Scores computed");

    // 6. Enqueue through write-gate
    let enqueued = 0;
    for (const s of scored) {
      const accepted = await enqueue(s);
      if (accepted) enqueued++;
    }

    if (enqueued > 0) {
      log.info({ enqueued }, "Entries enqueued for on-chain write");
    }
  }

  // 7. Flush batch if thresholds met
  if (shouldFlush()) {
    await flushBatch();
  }

  // 8. Advance cursor
  await setCursor(toBlock);
  log.debug({ cursor: toBlock.toString() }, "Cursor advanced");
}

// ─── Batch flush ──────────────────────────────────────────────────────────────

async function flushBatch(): Promise<void> {
  const entries = drainBatch(500);  // max 500 per KarmaRegistry.MAX_BATCH_SIZE
  if (entries.length === 0) return;

  try {
    const txHash = await writeBatch(entries);
    await markWritten(entries);
    log.info(
      { txHash, count: entries.length },
      "Batch written to chain"
    );
  } catch (err) {
    log.error({ err, count: entries.length }, "Batch write failed — re-queueing");
    requeue(entries);
  }
}
