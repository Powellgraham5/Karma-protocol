/**
 * cursor.ts
 * ---------
 * Persists the "last processed block" pointer in Redis so the agent
 * resumes from where it left off after a restart.
 *
 * Key: `karma:cursor`  ->  string representation of a block number.
 */

import { getRedis } from "./redis";
import { Keys }     from "./schema";
import { config }   from "../config";
import { childLogger } from "../utils/logger";

const log = childLogger("cursor");

/**
 * Returns the last fully-processed block number.
 * Falls back to `config.startBlock` on first run.
 */
export async function getCursor(): Promise<bigint> {
  const redis = getRedis();
  const raw   = await redis.get(Keys.cursor());

  if (raw === null) {
    log.info(
      { startBlock: config.startBlock.toString() },
      "No cursor found — starting from configured start block"
    );
    return config.startBlock;
  }

  const block = BigInt(raw);
  log.debug({ cursor: block.toString() }, "Cursor loaded");
  return block;
}

/**
 * Persists the last fully-processed block number.
 * Called at the end of each successful polling cycle.
 */
export async function setCursor(block: bigint): Promise<void> {
  const redis = getRedis();
  await redis.set(Keys.cursor(), block.toString());
  log.debug({ cursor: block.toString() }, "Cursor saved");
}
