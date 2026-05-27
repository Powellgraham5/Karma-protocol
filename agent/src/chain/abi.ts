/**
 * abi.ts
 * ------
 * Minimal ABI fragments for KarmaHook and KarmaRegistry.
 * Only the events / functions actually used by the agent are included.
 */

// ─── KarmaHook ────────────────────────────────────────────────────────────────

export const KARMA_HOOK_ABI = [
  {
    type:   "event",
    name:   "KarmaFeeApplied",
    inputs: [
      { type: "address", name: "swapper", indexed: true  },
      { type: "uint8",   name: "karma",   indexed: false },
      { type: "uint24",  name: "fee",     indexed: false },
    ],
  },
] as const;

// ─── KarmaRegistry ────────────────────────────────────────────────────────────

export const KARMA_REGISTRY_ABI = [
  {
    type:            "function",
    name:            "batchSetKarma",
    inputs: [
      { type: "address[]", name: "wallets"   },
      { type: "uint8[]",   name: "newScores" },
    ],
    outputs:         [],
    stateMutability: "nonpayable",
  },
  {
    type:            "function",
    name:            "setKarma",
    inputs: [
      { type: "address", name: "wallet" },
      { type: "uint8",   name: "score"  },
    ],
    outputs:         [],
    stateMutability: "nonpayable",
  },
  {
    type:            "function",
    name:            "scores",
    inputs:          [{ type: "address", name: "wallet" }],
    outputs:         [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type:            "function",
    name:            "agent",
    inputs:          [],
    outputs:         [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type:   "event",
    name:   "BatchKarmaUpdated",
    inputs: [
      { type: "uint256", name: "count", indexed: false },
    ],
  },
  {
    type:   "error",
    name:   "Unauthorized",
    inputs: [],
  },
  {
    type:   "error",
    name:   "BatchTooLarge",
    inputs: [{ type: "uint256", name: "size" }],
  },
  {
    type:   "error",
    name:   "EmptyBatch",
    inputs: [],
  },
] as const;

// ─── Ethers-compatible JSON ABI (for ContractFactory / Interface) ─────────────

export const KARMA_REGISTRY_ABI_JSON = [
  "function batchSetKarma(address[] calldata wallets, uint8[] calldata newScores) external",
  "function setKarma(address wallet, uint8 score) external",
  "function scores(address wallet) external view returns (uint8)",
  "function agent() external view returns (address)",
  "event BatchKarmaUpdated(uint256 count)",
  "event KarmaUpdated(address indexed wallet, uint8 oldScore, uint8 newScore)",
  "error Unauthorized()",
  "error BatchTooLarge(uint256 size)",
  "error EmptyBatch()",
];
