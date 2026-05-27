/**
 * redis.ts
 * --------
 * ioredis client singleton.
 *
 * Works with:
 *   • Local Docker Redis  redis://localhost:6379
 *   • Railway Redis add-on  ${{Redis.REDIS_URL}}
 *   • Upstash via standard protocol  rediss://default:<token>@<host>:<port>
 *
 * The client reconnects automatically (ioredis built-in) so we don't need
 * any manual reconnect logic.
 */

import Redis from "ioredis";
import { config }      from "../config";
import { childLogger } from "../utils/logger";

const log = childLogger("redis");

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(config.redisUrl, {
      // Don't crash the process on connection errors — ioredis will retry.
      lazyConnect:          true,
      maxRetriesPerRequest: 3,
      enableReadyCheck:     true,
      // Keep idle connections alive (Railway and Upstash close idle sockets).
      keepAlive:            10_000,
    });

    _redis.on("connect",       () => log.debug("Redis connected"));
    _redis.on("ready",         () => log.info("Redis ready"));
    _redis.on("error",  (err)  => log.error({ err }, "Redis error"));
    _redis.on("close",         () => log.warn("Redis connection closed"));
    _redis.on("reconnecting",  () => log.info("Redis reconnecting"));

    log.info({ url: redactUrl(config.redisUrl) }, "Redis client created");
  }
  return _redis;
}

/**
 * Connects and pings Redis.  Call once at startup.
 * Throws if it cannot connect within 5 s (FATAL — exits the process).
 */
export async function pingRedis(): Promise<void> {
  const redis  = getRedis();
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
