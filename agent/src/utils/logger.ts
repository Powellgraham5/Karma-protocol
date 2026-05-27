/**
 * logger.ts
 * ---------
 * Singleton pino logger.
 *
 * • In production (LOG_MODE=json) outputs newline-delimited JSON — perfect for
 *   Railway's log drain, Datadog, etc.
 * • In development (LOG_MODE=pretty) pretty-prints via pino-pretty.
 *
 * Usage:
 *   import { logger } from "./utils/logger";
 *   logger.info({ poolId }, "Pool initialized");
 *   logger.error({ err }, "Transaction failed");
 */

import pino from "pino";

const isPretty = process.env["LOG_MODE"] === "pretty";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  ...(isPretty
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize:    true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore:      "pid,hostname",
          },
        },
      }
    : {
        // JSON mode: include timestamp + structured fields
        timestamp: pino.stdTimeFunctions.isoTime,
        base: { service: "karma-agent" },
      }),
});

/** Child logger bound to a specific module name. */
export function childLogger(module: string) {
  return logger.child({ module });
}
