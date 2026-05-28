/**
 * contracts.ts
 * ------------
 * Typed ethers Contract instances used for on-chain writes.
 *
 * KarmaRegistry.batchSetKarma is the only write the agent makes.
 * The signer is derived from config.agentPrivateKey.
 */

import { ethers, Contract, Wallet } from "ethers";
import { config }             from "../config";
import { getEthersProvider }  from "./providers";
import { KARMA_REGISTRY_ABI_JSON } from "./abi";
import { childLogger }        from "../utils/logger";

const log = childLogger("contracts");

// ─── Signer ───────────────────────────────────────────────────────────────────

let _signer: Wallet | null = null;

export function getSigner(): Wallet {
  if (!_signer) {
    _signer = new Wallet(config.agentPrivateKey, getEthersProvider());
    log.info({ address: _signer.address }, "Signer wallet loaded");
  }
  return _signer;
}

/** Returns the signer address (the agent wallet). */
export function getAgentAddress(): string {
  return getSigner().address;
}

// ─── KarmaRegistry contract ───────────────────────────────────────────────────

let _registry: Contract | null = null;

export function getRegistryContract(): Contract {
  if (!_registry) {
    const iface = new ethers.Interface(KARMA_REGISTRY_ABI_JSON);
    _registry   = new Contract(
      config.karmaRegistryAddress,
      iface,
      getSigner()
    );
    log.info(
      { address: config.karmaRegistryAddress },
      "KarmaRegistry contract bound"
    );
  }
  return _registry;
}

/**
 * Re-creates the registry contract binding after a provider rotation.
 * Call this whenever `rotateEthersProvider` is called.
 */
export function resetRegistryContract(): void {
  _signer   = null;
  _registry = null;
  log.info("Contract bindings reset (after provider rotation)");
}

/**
 * Verifies that the configured agent wallet matches `registry.agent()`.
 * Called once at startup to catch misconfiguration early.
 *
 * Non-fatal: if the contract is unreachable (e.g. not yet deployed on this
 * network, or RPC is down) we log a warning and continue so the process can
 * still serve its health-check endpoint.
 */
export async function verifyAgentRole(): Promise<void> {
  try {
    const registry     = getRegistryContract();
    const onChainAgent = await registry["agent"]() as string;
    const localAgent   = getAgentAddress();

    if (onChainAgent.toLowerCase() !== localAgent.toLowerCase()) {
      log.warn(
        { onChainAgent, localAgent },
        "Agent mismatch — check AGENT_PRIVATE_KEY vs the address set in KarmaRegistry"
      );
      return;
    }

    log.info({ agent: localAgent }, "Agent role verified OK");
  } catch (err) {
    log.warn(
      { err },
      "Could not verify agent role — contract may not be deployed on this network yet. Continuing anyway."
    );
  }
}
