/**
 * writer.ts
 * ---------
 * Sends batchSetKarma transactions to KarmaRegistry on-chain.
 *
 * Nonce management
 * ────────────────
 * • Nonce is fetched once at module init and incremented optimistically.
 * • On "nonce too low" error, re-fetches from chain and retries.
 * • On RPC error, rotates to the fallback provider and retries.
 *
 * Gas strategy
 * ────────────
 * • Uses EIP-1559 (maxFeePerGas + maxPriorityFeePerGas) when the network
 *   supports it; falls back to legacy gasPrice otherwise.
 * • Gas limit is estimated via `estimateGas`; a 20% buffer is added.
 */

import { type TransactionResponse } from "ethers";
import { getRegistryContract, resetRegistryContract } from "../chain/contracts";
import { getEthersProvider, rotateEthersProvider }    from "../chain/providers";
import { PendingEntry }      from "../state/schema";
import { config }            from "../config";
import { withRetry }         from "../utils/retry";
import { childLogger }       from "../utils/logger";

const log = childLogger("writer");

// ─── Nonce state ──────────────────────────────────────────────────────────────

let _nonce: number | null = null;
let _currentRpcUrl: string = config.rpcUrls[0];

async function getNonce(): Promise<number> {
  if (_nonce !== null) return _nonce;

  const provider = getEthersProvider();
  const signer   = (await import("../chain/contracts")).getSigner();
  _nonce = await provider.getTransactionCount(signer.address, "pending");
  log.info({ nonce: _nonce }, "Nonce initialised");
  return _nonce;
}

function consumeNonce(): number {
  if (_nonce === null) throw new Error("[writer] Nonce not initialised");
  return _nonce++;
}

async function resetNonce(): Promise<void> {
  _nonce = null;
  await getNonce();
  log.info({ nonce: _nonce }, "Nonce reset from chain");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Writes a batch of score updates to KarmaRegistry.batchSetKarma.
 * Retries on transient failures (nonce too low, RPC errors).
 *
 * @returns The confirmed transaction hash.
 */
export async function writeBatch(entries: PendingEntry[]): Promise<string> {
  if (entries.length === 0) throw new Error("[writer] Empty batch");
  if (entries.length > 500) throw new Error("[writer] Batch exceeds MAX_BATCH_SIZE=500");

  const wallets = entries.map((e) => e.address as `0x${string}`);
  const scores  = entries.map((e) => e.score);

  log.info(
    { count: entries.length, wallets: wallets.slice(0, 3) },
    "Sending batchSetKarma"
  );

  const txHash = await withRetry(
    async () => {
      const registry = getRegistryContract();
      const nonce    = await getNonce();
      consumeNonce();

      let tx: TransactionResponse;
      try {
        tx = await registry["batchSetKarma"](wallets, scores, {
          nonce,
          gasLimit: await estimateGasWithBuffer(registry, wallets, scores),
        }) as TransactionResponse;
      } catch (err) {
        handleWriteError(err);
        throw err; // re-throw for withRetry
      }

      log.info({ txHash: tx.hash, nonce }, "Transaction submitted — waiting for confirmation");
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status === 0) {
        throw new Error(`[writer] Transaction reverted: ${tx.hash}`);
      }

      log.info(
        { txHash: tx.hash, gasUsed: receipt.gasUsed.toString(), count: entries.length },
        "batchSetKarma confirmed"
      );
      return tx.hash;
    },
    {
      label:       `batchSetKarma(${entries.length})`,
      maxAttempts: 4,
      baseDelayMs: 2_000,
      isFatal:     isWriteFatal,
    }
  );

  return txHash;
}

/**
 * Initialises the nonce. Call once at agent startup.
 */
export async function initNonce(): Promise<void> {
  await getNonce();
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function estimateGasWithBuffer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registry: any,
  wallets: string[],
  scores:  number[]
): Promise<bigint> {
  try {
    const est  = await registry["batchSetKarma"].estimateGas(wallets, scores) as bigint;
    const buf  = (est * 120n) / 100n;   // +20%
    return buf;
  } catch {
    // Fallback: ~5000 gas per entry + base
    const fallback = BigInt(50_000 + wallets.length * 5_000);
    log.warn({ fallback: fallback.toString() }, "Gas estimation failed — using fallback");
    return fallback;
  }
}

function handleWriteError(err: unknown): void {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  if (msg.includes("nonce too low") || msg.includes("replacement transaction underpriced")) {
    log.warn("Nonce too low — resetting");
    void resetNonce();
    return;
  }

  if (msg.includes("timeout") || msg.includes("network") || msg.includes("connection")) {
    log.warn({ rpc: _currentRpcUrl }, "RPC error — rotating provider");
    rotateEthersProvider(_currentRpcUrl);
    resetRegistryContract();
    _nonce = null;
    _currentRpcUrl = config.rpcUrls[
      (config.rpcUrls.indexOf(_currentRpcUrl as typeof config.rpcUrls[number]) + 1) %
      config.rpcUrls.length
    ]!;
  }
}

function isWriteFatal(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const FATAL = [
    "unauthorized",
    "execution reverted: unauthorized",
    "invalid private key",
    "transaction reverted",
  ];
  return FATAL.some((f) => msg.includes(f));
}
