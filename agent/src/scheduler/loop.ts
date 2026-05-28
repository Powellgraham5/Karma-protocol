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
 *   5. Re-score wallets that had new activity this cycle.
 *   6. Enqueue score updates through the write-gate (delta threshold).
 *   7. Flush the batch if size/age thresholds are met.
 *   8. Advance the cursor.
 *   9. Release the lock.
 *  10. (Every DECAY_SWEEP_INTERVAL loops) Re-score inactive wallets so that
 *      scores decay once activity falls outside the scoring window.  (K-04)
 *
 * Decay sweep (K-04 fix)
 * ──────────────────────
 * Wallets that stop swapping were never re-scored, so their high karma scores
 * remained in the registry indefinitely — even after all their activity aged
 * out of the 90-day window.  The periodic sweep finds wallets whose
 * lastSeenAt timestamp is >= scoringWindowDays ago and re-computes their
 * score.  Because their recentTimestamps are all stale, the new score will be
 * much lower (or zero), which gets written to chain via the normal batch path.
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
import { computeScores } from "../scoring/engine";
import { enqueue, shouldFlush, drainBatch, markWritten, requeue } from "../registry/batcher";
import { writeBatch }       from "../registry/writer";
import { config }           from "../config";
import { sleep }            from "../utils/sleep";
import { childLogger }      from "../utils/logger";

const log = childLogger("loop");

// ─── Decay sweep config  (K-04) ───────────────────────────────────────────────

/**
 * Run the decay sweep every N main-loop iterations.
 * At pollIntervalMs=60 000 (1 min), 360 iterations ≈ every 6 hours.
 */
const DECAY_SWEEP_INTERVAL = 360;

// ─── Loop state ───────────────────────────────────────────────────────────────

let _running    = false;
let _loopCount  = 0;
let _lastLoopAt: number | null = null;
let _lastError: string | null  = null;

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
      decaySweepEvery: DECAY_SWEEP_INTERVAL,
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
  const redis = getRedis();
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
  } else {
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
    const touched = new Set<string>();

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
      const toScore       = allActivities.filter((a) => touched.has(a.address));
      const scored        = computeScores(toScore);

      log.debug({ scored: scored.length }, "Scores computed");

      let enqueued = 0;
      for (const s of scored) {
        const accepted = await enqueue(s);
        if (accepted) enqueued++;
      }

      if (enqueued > 0) {
        log.info({ enqueued }, "Entries enqueued for on-chain write");
      }
    }

    // 8. Advance cursor
    await setCursor(toBlock);
    log.debug({ cursor: toBlock.toString() }, "Cursor advanced");
  }

  // 7. Flush batch if thresholds met
  if (shouldFlush()) {
    await flushBatch();
  }

  // 10. Periodic decay sweep  (K-04)
  //     Run every DECAY_SWEEP_INTERVAL iterations so wallets whose activity
  //     has fallen outside the scoring window get their scores decremented.
  if (_loopCount > 0 && _loopCount % DECAY_SWEEP_INTERVAL === 0) {
    await sweepDecayedScores();
  }
}

// ─── Batch flush ──────────────────────────────────────────────────────────────

async function flushBatch(): Promise<void> {
  const entries = drainBatch(500);
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

// ─── Decay sweep  (K-04) ──────────────────────────────────────────────────────

/**
 * Finds wallets whose most-recent activity is older than the scoring window
 * and re-scores them.  Because all their recentTimestamps now fall outside
 * the window, the scoring factors will return low/zero values — and the
 * resulting decreased score will be enqueued for an on-chain write.
 *
 * This ensures that karma decays even for wallets that have stopped swapping,
 * rather than freezing at their peak score indefinitely.
 */
async function sweepDecayedScores(): Promise<void> {
  const windowSec = config.scoringWindowDays * 86_400;
  const nowSec    = Math.floor(Date.now() / 1000);

  const allActivities = await getAllWallets();

  // A wallet is "decayed" when its most-recent activity predates the window.
  const decayed = allActivities.filter(
    (a) => nowSec - a.lastSeenAt >= windowSec
  );

  if (decayed.length === 0) {
    log.debug("Decay sweep: no expired wallets found");
    return;
  }

  log.info({ count: decayed.length }, "Decay sweep: re-scoring expired wallets");

  // Re-score with minSwapCount = 0 so wallets with no recent swaps are included.
  const rescored = computeScores(decayed, 0);

  let enqueued = 0;
  for (const s of rescored) {
    const accepted = await enqueue(s);
    if (accepted) enqueued++;
  }

  log.info(
    { rescored: rescored.length, enqueued },
    "Decay sweep complete"
  );

  // Flush immediately if the sweep pushed us over the batch threshold.
  if (shouldFlush()) {
    await flushBatch();
  }
}
