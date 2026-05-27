/**
 * rateLimit.ts
 * ------------
 * Simple token-bucket rate limiter for outgoing RPC calls.
 *
 * Prevents bursting too many getLogs / eth_call requests in a tight loop and
 * tripping provider rate limits (Alchemy free tier: 330 req/sec; Infura: 100/s).
 *
 * Usage:
 *   const limiter = new RateLimiter({ rps: 50 });
 *   await limiter.throttle();
 *   // now safe to fire an RPC call
 */

import { sleep } from "./sleep";

export interface RateLimiterOptions {
  /** Requests per second ceiling. Default: 50. */
  rps?: number;
}

export class RateLimiter {
  private readonly intervalMs: number;
  private nextAllowedAt: number;

  constructor(opts: RateLimiterOptions = {}) {
    const rps        = opts.rps ?? 50;
    this.intervalMs  = Math.ceil(1000 / rps);
    this.nextAllowedAt = Date.now();
  }

  /** Waits until the next token is available, then consumes it. */
  async throttle(): Promise<void> {
    const now  = Date.now();
    const wait = this.nextAllowedAt - now;

    if (wait > 0) await sleep(wait);

    this.nextAllowedAt = Math.max(Date.now(), this.nextAllowedAt) + this.intervalMs;
  }
}

/** Singleton shared across the poller. Override via RPC_RPS env var. */
export const globalRateLimiter = new RateLimiter({
  rps: parseInt(process.env["RPC_RPS"] ?? "50", 10),
});
