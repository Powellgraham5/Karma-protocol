/**
 * providers.ts
 * ------------
 * Creates a viem PublicClient with automatic RPC failover.
 *
 * If RPC_URL_PRIMARY fails (timeout, rate-limit, etc.) viem's built-in
 * `fallback` transport automatically tries the next URL in the list.
 *
 * Also exports an ethers JsonRpcProvider for signing + sending write txns.
 */

import {
  createPublicClient,
  fallback,
  http,
  type PublicClient,
  type Chain,
} from "viem";
import { baseSepolia, base, arbitrum, arbitrumSepolia, mainnet } from "viem/chains";
import { JsonRpcProvider } from "ethers";
import { config } from "../config";
import { childLogger } from "../utils/logger";

const log = childLogger("providers");

// ─── Chain registry ───────────────────────────────────────────────────────────

const CHAINS: Record<number, Chain> = {
  84532:  baseSepolia,
  8453:   base,
  42161:  arbitrum,
  421614: arbitrumSepolia,
  1:      mainnet,
};

function getChain(): Chain {
  const chain = CHAINS[config.chainId];
  if (!chain) {
    log.warn(
      { chainId: config.chainId },
      "Unknown chain ID — using minimal chain definition"
    );
    // Fallback: minimal chain descriptor
    return {
      id:   config.chainId,
      name: `chain-${config.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: config.rpcUrls },
        public:  { http: config.rpcUrls },
      },
    } as Chain;
  }
  return chain;
}

// ─── viem public client (reads + getLogs) ─────────────────────────────────────

let _publicClient: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (!_publicClient) {
    const transports = config.rpcUrls.map((url) =>
      http(url, { timeout: 15_000, retryCount: 0 })   // viem retries handled at our level
    );

    _publicClient = createPublicClient({
      chain:     getChain(),
      transport: fallback(transports, { rank: false }),
    }) as PublicClient;

    log.info(
      { chainId: config.chainId, rpcs: config.rpcUrls.length },
      "viem PublicClient created"
    );
  }
  return _publicClient;
}

// ─── ethers provider (writes) ─────────────────────────────────────────────────

let _ethersProvider: JsonRpcProvider | null = null;

/**
 * Returns a single-RPC ethers provider for the primary URL.
 * Write transactions (batchSetKarma) use ethers v6 for nonce management.
 */
export function getEthersProvider(): JsonRpcProvider {
  if (!_ethersProvider) {
    const url = config.rpcUrls[0];
    _ethersProvider = new JsonRpcProvider(url, config.chainId);
    log.info({ rpc: url }, "ethers JsonRpcProvider created");
  }
  return _ethersProvider;
}

/**
 * Rotates the ethers provider to the next RPC URL (called on nonce/RPC errors).
 * @param currentUrl  The URL that just failed.
 */
export function rotateEthersProvider(currentUrl: string): void {
  const urls    = config.rpcUrls;
  const current = urls.indexOf(currentUrl as typeof urls[number]);
  const nextIdx = (current + 1) % urls.length;
  const nextUrl = urls[nextIdx];

  log.warn({ from: currentUrl, to: nextUrl }, "Rotating ethers provider");
  _ethersProvider = new JsonRpcProvider(nextUrl, config.chainId);
}
