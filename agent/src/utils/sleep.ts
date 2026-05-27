/**
 * sleep.ts
 * --------
 * Promise-based delay helper.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * jitter adds up to `factor * base` random milliseconds.
 * Prevents thundering herd when multiple replicas restart simultaneously.
 */
export function jitter(base: number, factor = 0.3): number {
  return Math.floor(base + base * factor * Math.random());
}
