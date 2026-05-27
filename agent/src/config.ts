/**
 * config.ts
 * ---------
 * Reads environment variables, validates them at startup, and exports a single
 * immutable `config` object consumed by every module.
 *
 * Fail-fast: any missing required var throws immediately so the process exits
 * with a clear error before Railway attempts retries.
 */

import * as dotenv from "dotenv";
dotenv.config();

// ─── helpers ─────────────────────────────────────────────────────────────────

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`[config] Missing required env var: ${key}`);
  return v;
}

function opt(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new Error(`[config] ${key} must be an integer, got: ${raw}`);
  return n;
}

// ─── Config shape ─────────────────────────────────────────────────────────────

export interface Config {
  /** Primary + optional fallback RPC endpoints (viem failback transport). */
  rpcUrls: [string, ...string[]];

  /** Network chain ID — used to verify connected chain at startup. */
  chainId: number;

  /** KarmaHook contract address (emits KarmaFeeApplied events). */
  karmaHookAddress: `0x${string}`;

  /** KarmaRegistry contract address (batchSetKarma writes go here). */
  karmaRegistryAddress: `0x${string}`;

  /** Agent wallet private key — the address must equal `registry.agent`. */
  agentPrivateKey: string;

  /**
   * Redis connection URL.
   * Local:    redis://localhost:6379
   * Railway:  ${{Redis.REDIS_URL}}  (injected automatically)
   * Upstash:  rediss://default:<token>@<host>:<port>
   */
  redisUrl: string;

  /** How often the main loop runs (ms). Default: 60 000 (1 min). */
  pollIntervalMs: number;

  /** Block to start scanning from on first run (0 = chain genesis). */
  startBlock: bigint;

  /**
   * Maximum blocks to scan in a single getLogs call.
   * Infura / Alchemy cap varies; 2 000 is safe for most providers.
   */
  blockBatchSize: bigint;

  /**
   * Rolling window used for scoring (days).
   * Activity older than this is ignored.
   */
  scoringWindowDays: number;

  /**
   * Target batch size for on-chain writes.
   * Flush is also triggered if the oldest pending entry is >= batchMaxAgeSec.
   */
  batchTargetSize: number;
  batchMaxAgeSec: number;

  /**
   * Minimum score delta before we bother writing to the chain.
   * Prevents burning gas on 1-point fluctuations.
   */
  minScoreDelta: number;

  /** HTTP health endpoint port. */
  port: number;

  /** Set to "pretty" in development to get human-readable pino output. */
  logMode: "json" | "pretty";
}

// ─── Build config ─────────────────────────────────────────────────────────────

function buildRpcUrls(): [string, ...string[]] {
  const primary  = opt("RPC_URL_PRIMARY", opt("RPC_URL", ""));
  const fallback = opt("RPC_URL_FALLBACK", "");

  const urls = [primary, ...fallback.split(",").map((s) => s.trim())]
    .filter(Boolean);

  if (urls.length === 0) {
    throw new Error(
      "[config] At least one RPC URL is required. " +
      "Set RPC_URL, RPC_URL_PRIMARY, or RPC_URL_FALLBACK."
    );
  }

  return urls as [string, ...string[]];
}

function toChecksumAddress(raw: string, key: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`[config] ${key} is not a valid EVM address: ${raw}`);
  }
  return raw as `0x${string}`;
}

export const config: Config = {
  rpcUrls:              buildRpcUrls(),
  chainId:              optInt("CHAIN_ID", 84532),  // Base Sepolia default

  karmaHookAddress:     toChecksumAddress(req("KARMA_HOOK_ADDRESS"),     "KARMA_HOOK_ADDRESS"),
  karmaRegistryAddress: toChecksumAddress(req("KARMA_REGISTRY_ADDRESS"), "KARMA_REGISTRY_ADDRESS"),

  agentPrivateKey:      req("AGENT_PRIVATE_KEY"),

  redisUrl:             opt("REDIS_URL", "redis://localhost:6379"),

  pollIntervalMs:       optInt("POLL_INTERVAL_MS", 60_000),
  startBlock:           BigInt(opt("START_BLOCK", "0")),
  blockBatchSize:       BigInt(opt("BLOCK_BATCH_SIZE", "2000")),

  scoringWindowDays:    optInt("SCORING_WINDOW_DAYS", 90),

  batchTargetSize:      optInt("BATCH_TARGET_SIZE", 200),
  batchMaxAgeSec:       optInt("BATCH_MAX_AGE_SEC", 30),
  minScoreDelta:        optInt("MIN_SCORE_DELTA", 2),

  port:                 optInt("PORT", 3001),
  logMode:              (opt("LOG_MODE", "json") === "pretty") ? "pretty" : "json",
};
