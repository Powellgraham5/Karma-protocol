/**
 * redis.ts
 * --------
 * ioredis client singleton — or an in-memory fallback when REDIS_URL is unset.
 *
 * Works with:
 *   • Local Docker Redis      redis://localhost:6379
 *   • Railway Redis add-on    ${{Redis.REDIS_URL}}  (injected automatically)
 *   • Upstash                 rediss://default:<token>@<host>:<port>
 *   • No Redis (REDIS_URL="") → in-memory MemStore (state lost on restart)
 *
 * The real ioredis client reconnects automatically.
 */

import Redis from "ioredis";
import { MemStore }    from "./memStore";
import { config }      from "../config";
import { childLogger } from "../utils/logger";

const log = childLogger("redis");

// Use the in-memory store when no Redis URL is configured.
const USE_MEMORY = !config.redisUrl;

let _client: Redis | MemStore | null = null;

export function getRedis(): Redis {
  if (!_client) {
    if (USE_MEMORY) {
      log.warn(
        "REDIS_URL not configured — using ephemeral in-memory store. " +
        "Cursor and wallet state will reset on every restart."
      );
      _client = new MemStore() as unknown as Redis;
    } else {
      const redis = new Redis(config.redisUrl, {
        // Don't crash the process on connection errors — ioredis will retry.
        lazyConnect:          true,
        maxRetriesPerRequest: 3,
        enableReadyCheck:     true,
        // Keep idle connections alive (Railway and Upstash close idle sockets).
        keepAlive:            10_000,
      });

      redis.on("connect",       () => log.debug("Redis connected"));
      redis.on("ready",         () => log.info("Redis ready"));
      redis.on("error",  (err)  => log.error({ err }, "Redis error"));
      redis.on("close",         () => log.warn("Redis connection closed"));
      redis.on("reconnecting",  () => log.info("Redis reconnecting"));

      log.info({ url: redactUrl(config.redisUrl) }, "Redis client created");
      _client = redis;
    }
  }
  return _client as Redis;
}

/**
 * Connects and pings Redis.  Call once at startup.
 * In in-memory mode this is a no-op.
 * Throws if it cannot connect within the ioredis retry budget (FATAL — exits the process).
 */
export async function pingRedis(): Promise<void> {
  if (USE_MEMORY) {
    log.info("In-memory store active — Redis ping skipped");
    return;
  }
  const redis  = getRedis() as Redis;
  await redis.connect();
  const result = await redis.ping();
  if (result !== "PONG") {
    throw new Error(`[redis] Unexpected PING response: ${result}`);
  }
  log.info("Redis ping OK");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Hides password / token from the URL before logging. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url.replace(/:([^@/]+)@/, ":***@");
  }
}
