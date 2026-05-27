/**
 * index.ts
 * --------
 * KARMA PROTOCOL Agent — entry point.
 *
 * Startup sequence:
 *   1. Validate config (fail fast on missing env vars)
 *   2. Ping Redis
 *   3. Verify agent wallet matches on-chain registry.agent()
 *   4. Initialise write nonce
 *   5. Start HTTP health server (Railway health-check)
 *   6. Start main polling loop
 *
 * Signal handling:
 *   SIGTERM / SIGINT  -> graceful shutdown (flush pending batch, then exit 0)
 */

import * as http from "http";
import { config }             from "./config";
import { logger }             from "./utils/logger";
import { pingRedis }          from "./state/redis";
import { verifyAgentRole }    from "./chain/contracts";
import { initNonce }          from "./registry/writer";
import { startLoop, getLoopHealth } from "./scheduler/loop";
import { pendingSize, drainBatch, markWritten } from "./registry/batcher";
import { writeBatch }         from "./registry/writer";

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info(
    {
      version:  process.env["npm_package_version"] ?? "dev",
      chainId:  config.chainId,
      hook:     config.karmaHookAddress,
      registry: config.karmaRegistryAddress,
      interval: config.pollIntervalMs,
    },
    "KARMA PROTOCOL Agent starting"
  );

  // 1. Redis connectivity
  await pingRedis();

  // 2. Verify agent wallet matches on-chain registry.agent()
  await verifyAgentRole();

  // 3. Initialise nonce
  await initNonce();

  // 4. HTTP health server
  startHealthServer();

  // 5. Graceful shutdown handlers
  registerShutdownHandlers();

  // 6. Main loop (never resolves under normal operation)
  await startLoop();
}

// ─── HTTP health server ───────────────────────────────────────────────────────

function startHealthServer(): void {
  const server = http.createServer((_req, res) => {
    const health = getLoopHealth();
    const body   = JSON.stringify({
      status:      "ok",
      loopCount:   health.loopCount,
      lastLoopAt:  health.lastLoopAt,
      pendingSize: pendingSize(),
      lastError:   health.lastError,
    });

    res.writeHead(200, {
      "Content-Type":   "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  });

  server.listen(config.port, () => {
    logger.info({ port: config.port }, "Health server listening");
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function registerShutdownHandlers(): void {
  const onShutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutdown signal received — flushing pending batch");

    if (pendingSize() > 0) {
      const entries = drainBatch(500);
      if (entries.length > 0) {
        try {
          const txHash = await writeBatch(entries);
          await markWritten(entries);
          logger.info({ txHash, count: entries.length }, "Final batch flushed before exit");
        } catch (err) {
          logger.error({ err }, "Failed to flush final batch on shutdown");
        }
      }
    }

    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => { void onShutdown("SIGTERM"); });
  process.on("SIGINT",  () => { void onShutdown("SIGINT");  });

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — exiting");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled promise rejection — exiting");
    process.exit(1);
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  logger.fatal({ err }, "Startup failed");
  process.exit(1);
});
