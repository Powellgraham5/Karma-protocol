/**
 * poller.ts
 * ---------
 * Fetches KarmaFeeApplied events from KarmaHook using eth_getLogs.
 *
 * Polling (getLogs) is preferred over WebSocket subscriptions for Railway
 * because:
 *   • No long-lived TCP connection to manage / reconnect
 *   • Works with HTTP-only RPC providers (Infura, Alchemy REST tier)
 *   • Naturally handles missed blocks after restarts
 *
 * The caller is responsible for advancing the cursor; this module is
 * stateless and only handles I/O.
 */

import { getPublicClient }  from "../providers";
import { KARMA_HOOK_ABI }   from "../abi";
import { config }           from "../../config";
import { globalRateLimiter } from "../../utils/rateLimit";
import { withRetry }        from "../../utils/retry";
import { childLogger }      from "../../utils/logger";

const log = childLogger("poller");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SwapEvent {
  swapper:    string;   // lowercase address
  karma:      number;   // uint8 from event
  fee:        number;   // uint24 from event
  txHash:     string;
  logIndex:   number;
  blockNumber: bigint;
  blockTimestamp: number;  // Unix-seconds (fetched via eth_getBlockByNumber)
}

// ─── Internal cache ───────────────────────────────────────────────────────────

// Block timestamps are fetched on demand and cached for the current cycle.
// The cache is cleared at the start of each polling cycle.
const blockTimestampCache = new Map<bigint, number>();

export function clearBlockTimestampCache(): void {
  blockTimestampCache.clear();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches all KarmaFeeApplied events in [fromBlock, toBlock] (inclusive).
 *
 * Automatically paginates if the range exceeds `config.blockBatchSize`.
 * Rate-limited to prevent exhausting the RPC allowance.
 *
 * @returns Parsed events sorted by (blockNumber, logIndex).
 */
export async function pollEvents(
  fromBlock: bigint,
  toBlock:   bigint
): Promise<SwapEvent[]> {
  if (fromBlock > toBlock) return [];

  const client     = getPublicClient();
  const allEvents: SwapEvent[] = [];
  let   cursor     = fromBlock;

  while (cursor <= toBlock) {
    const end   = cursor + config.blockBatchSize - 1n < toBlock
      ? cursor + config.blockBatchSize - 1n
      : toBlock;

    log.debug(
      { from: cursor.toString(), to: end.toString() },
      "Fetching getLogs batch"
    );

    await globalRateLimiter.throttle();

    const logs = await withRetry(
      () =>
        client.getLogs({
          address:   config.karmaHookAddress,
          event:     KARMA_HOOK_ABI[0],       // KarmaFeeApplied
          fromBlock: cursor,
          toBlock:   end,
        }),
      { label: `getLogs(${cursor}-${end})`, maxAttempts: 4 }
    );

    for (const raw of logs) {
      const blockTs = await getBlockTimestamp(raw.blockNumber!);

      allEvents.push({
        swapper:        (raw.args.swapper as string).toLowerCase(),
        karma:          Number(raw.args.karma),
        fee:            Number(raw.args.fee),
        txHash:         raw.transactionHash!,
        logIndex:       raw.logIndex!,
        blockNumber:    raw.blockNumber!,
        blockTimestamp: blockTs,
      });
    }

    log.debug(
      { from: cursor.toString(), to: end.toString(), found: logs.length },
      "getLogs batch complete"
    );

    cursor = end + 1n;
  }

  // Sort by (blockNumber, logIndex) for deterministic processing order
  allEvents.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    return a.logIndex - b.logIndex;
  });

  return allEvents;
}

// ─── Block timestamp helper ───────────────────────────────────────────────────

async function getBlockTimestamp(blockNumber: bigint): Promise<number> {
  const cached = blockTimestampCache.get(blockNumber);
  if (cached !== undefined) return cached;

  await globalRateLimiter.throttle();

  const block = await withRetry(
    () => getPublicClient().getBlock({ blockNumber }),
    { label: `getBlock(${blockNumber})`, maxAttempts: 3 }
  );

  const ts = Number(block.timestamp);
  blockTimestampCache.set(blockNumber, ts);
  return ts;
}
