/**
 * retry.ts
 * --------
 * Generic retry wrapper with exponential back-off and jitter.
 *
 * Error categories:
 *   TRANSIENT — network blips, rate limits, nonce collisions.  Retry up to
 *               `maxAttempts` with increasing delays.
 *   FATAL     — configuration bugs, out-of-gas, auth failure.  Re-throw
 *               immediately so the process exits and Railway restarts it.
 *   SKIP      — duplicate events, stale data.  Resolve silently.
 */

import { sleep, jitter } from "./sleep";
import { childLogger } from "./logger";

const log = childLogger("retry");

export interface RetryOptions {
  maxAttempts?: number;    // default 4
  baseDelayMs?: number;    // default 1000 ms
  maxDelayMs?:  number;    // default 30 000 ms
  label?:       string;    // used in log messages
  isFatal?:     (err: unknown) => boolean;
}

const DEFAULT_MAX   = 4;
const DEFAULT_BASE  = 1_000;
const DEFAULT_MAX_D = 30_000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX;
  const baseDelay   = opts.baseDelayMs ?? DEFAULT_BASE;
  const maxDelay    = opts.maxDelayMs  ?? DEFAULT_MAX_D;
  const label       = opts.label       ?? "operation";
  const isFatal     = opts.isFatal     ?? defaultIsFatal;

  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;

      if (isFatal(err)) {
        log.error({ err, label }, "Fatal error — not retrying");
        throw err;
      }

      if (attempt >= maxAttempts) {
        log.error({ err, label, attempt }, "Max retry attempts reached");
        throw err;
      }

      const rawDelay  = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      const delay     = jitter(rawDelay);

      log.warn(
        { label, attempt, maxAttempts, delayMs: delay, err: errMessage(err) },
        "Transient error — retrying"
      );

      await sleep(delay);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Messages that indicate non-recoverable conditions. */
const FATAL_PATTERNS = [
  "Unauthorized",
  "invalid private key",
  "contract not deployed",
  "execution reverted: Unauthorized",
  "ZeroAddress",
  "ArrayLengthMismatch",
  "BatchTooLarge",
  "ScoreOutOfBounds",
  "EmptyBatch",
];

function defaultIsFatal(err: unknown): boolean {
  const msg = errMessage(err).toLowerCase();
  return FATAL_PATTERNS.some((p) => msg.toLowerCase().includes(p.toLowerCase()));
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
