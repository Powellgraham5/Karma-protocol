# Karma Protocol

**Uniswap V4 Hook · X Layer · Autonomous AI Scoring Agent**

> *Your on-chain reputation earns you cheaper trades.*

[![Live Demo](https://img.shields.io/badge/Live%20Demo-karma--protocol--app.vercel.app-cyan?style=flat-square)](https://karma-protocol-app.vercel.app)
[![Chain](https://img.shields.io/badge/Chain-X%20Layer%20Testnet%201952-brightgreen?style=flat-square)](https://www.oklink.com/xlayer-test)
[![Hook](https://img.shields.io/badge/KarmaHook-V4%20beforeSwap-purple?style=flat-square)](#contracts)
[![Agent](https://img.shields.io/badge/Agent-Railway%2024%2F7-blue?style=flat-square)](#autonomous-agent)
[![License](https://img.shields.io/badge/License-MIT-gray?style=flat-square)](LICENSE)

---

## Overview

Karma Protocol is a production-grade Uniswap V4 Hook that applies **dynamic swap fees based on a wallet's on-chain reputation score**. An autonomous AI agent runs every 60 seconds, computing a 0–100 karma score for every wallet that has interacted with the protocol, and writing those scores to an immutable on-chain registry.

When a swap executes through a KarmaHook pool, the hook reads the swapper's karma score from the registry **in the same transaction** — no oracle, no off-chain call, no user action required. High-karma wallets pay 20× less than unknown wallets.

### The Problem

Every AMM today charges identical fees regardless of who is swapping. A wallet that has been active on X Layer for two years, held OKB through volatility, and contributed hundreds of swaps to protocol liquidity pays the same fee as a fresh MEV bot created an hour ago. This is economically irrational. It rewards extraction and penalises loyalty.

### The Solution

Karma Protocol introduces a **trustless, autonomous reputation layer** for Uniswap V4. No whitelist. No governance vote. No admin override. The fee tier is determined entirely by an on-chain score that any wallet can independently verify.

---

## Fee Schedule

| Karma Score | Tier       | Swap Fee | Savings vs Baseline |
|-------------|------------|----------|---------------------|
| 81 – 100    | ELITE      | 0.01%    | −0.19%              |
| 61 – 80     | VERY LOW   | 0.02%    | −0.18%              |
| 31 – 60     | LOW        | 0.05%    | −0.15%              |
|  1 – 30     | DISCOUNTED | 0.10%    | −0.10%              |
|  0          | STANDARD   | 0.20%    | —                   |

---

## Live Deployments

| Contract       | Address                      | Explorer                                                                              |
|----------------|------------------------------|---------------------------------------------------------------------------------------|
| KarmaRegistry  | `$XLAYER_REGISTRY_ADDRESS`   | [OKLink ↗](https://www.oklink.com/xlayer-test/address/$XLAYER_REGISTRY_ADDRESS)       |
| KarmaHook (V4) | `$XLAYER_HOOK_ADDRESS`       | [OKLink ↗](https://www.oklink.com/xlayer-test/address/$XLAYER_HOOK_ADDRESS)           |
| Agent Wallet   | `$AGENT_WALLET`              | [OKLink ↗](https://www.oklink.com/xlayer-test/address/$AGENT_WALLET)                  |

> Variables prefixed with `$` must be replaced with real addresses after deployment.  
> See [Deployment](#deployment) below.

**Chain:** X Layer Testnet · Chain ID `1952` · RPC `https://testrpc.xlayer.tech`  
**Frontend:** [karma-protocol-app.vercel.app](https://karma-protocol-app.vercel.app)  
**GitHub:** [github.com/Powellgraham5/KARMA](https://github.com/Powellgraham5/KARMA)

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          KARMA PROTOCOL STACK                              │
├──────────────────────┬──────────────────────────┬──────────────────────────┤
│  FRONTEND            │  AGENT (TypeScript)       │  X LAYER TESTNET (1952)  │
│  Next.js 15 · Vercel │  Railway · 60s loop       │                          │
│                      │                           │  ┌────────────────────┐  │
│  ┌────────────────┐  │  ┌────────────────────┐   │  │  KarmaRegistry     │  │
│  │  Karma Gauge   │  │  │  4-Factor Score    │   │  │────────────────────│  │
│  │  Fee Preview   │◄─┼──│  Engine            │──►│  │ karma(address)→u8  │  │
│  │  Wallet Lookup │  │  │  · Swap frequency  │   │  │ batchSetKarma()    │  │
│  │  Activity Feed │  │  │  · Active days     │   │  │ totalUpdates()     │  │
│  └────────────────┘  │  │  · Account age     │   │  │ owner / agent role │  │
│                      │  │  · Consistency     │   │  └─────────┬──────────┘  │
│  wagmi · viem        │  └────────────────────┘   │            │ reads       │
│  RainbowKit          │                           │  ┌─────────▼──────────┐  │
│  WalletConnect       │  Write-gate : ±3 pts      │  │  KarmaHook (V4)    │  │
│                      │  Decay sweep: every 6h    │  │────────────────────│  │
│                      │  Batch cap  : 500 wallets │  │ beforeSwap()       │  │
│                      │  Redis lock : 30s TTL     │  │ feeForKarma()      │  │
└──────────────────────┴──────────────────────────┤  │ previewFee()       │  │
                                                  │  │ trustedRouters     │  │
                                                  │  └────────────────────┘  │
                                                  │                          │
                                                  │  ┌────────────────────┐  │
                                                  │  │  Redis (Upstash)   │  │
                                                  │  │  Block cursor      │  │
                                                  │  │  Wallet store      │  │
                                                  │  │  Batch queue       │  │
                                                  │  └────────────────────┘  │
                                                  └──────────────────────────┘
```

### Swap Execution Flow

```
User initiates swap
       │
       ▼
PoolManager.swap()
       │
       ├──► KarmaHook.beforeSwap(sender, key, params, hookData)
       │           │
       │           ├─ Resolve swapper:
       │           │   if trustedRouters[sender] && hookData.length >= 32
       │           │       swapper = abi.decode(hookData, (address))   ← K-01 fix
       │           │   else
       │           │       swapper = sender
       │           │
       │           ├─ score = KarmaRegistry.karma(swapper)   [1 SLOAD, ~2100 gas]
       │           ├─ fee   = _feeForKarma(score)            [5 comparisons]
       │           │
       │           └─ return (selector, ZERO_DELTA, fee | OVERRIDE_FEE_FLAG)
       │
       └──► Swap settles at karma-adjusted fee. No user action required.
```

---

## Contracts

### KarmaRegistry.sol

The on-chain reputation store. Stores a `uint8` karma score (0–100) per wallet address. Two-role access model separates protocol ownership from day-to-day agent operations:

| Role    | Can Do                                                                 |
|---------|------------------------------------------------------------------------|
| `owner` | Rotate agent address, pause/unpause contract, transfer ownership       |
| `agent` | Write karma scores via `setKarma()` and `batchSetKarma()`              |

**Interface:**

```solidity
// Write (agent only)
function batchSetKarma(address[] calldata wallets, uint8[] calldata scores) external;
function setKarma(address wallet, uint8 score) external;

// Admin (owner only)
function setAgent(address newAgent) external;       // K-02: key rotation without redeployment
function setPaused(bool paused) external;           // K-17: emergency pause
function transferOwnership(address newOwner) external;

// Read (public)
function karma(address wallet) external view returns (uint8);
function scores(address wallet) external view returns (uint8);
function totalUpdates() external view returns (uint256);
function totalWalletsScored() external view returns (uint256);
```

**Events:**

```solidity
event BatchKarmaUpdated(uint256 count);
event KarmaUpdated(address indexed wallet, uint8 oldScore, uint8 newScore, uint256 timestamp);
event AgentUpdated(address indexed oldAgent, address indexed newAgent);
event PausedStateChanged(bool paused);
```

### KarmaHook.sol

Uniswap V4 `beforeSwap` hook. Reads a wallet's karma score and returns a fee override atomically within the swap transaction. Inherits from `BaseHook` — only `beforeSwap` is activated.

**Security — trusted router whitelist (K-01):**

Without access control on `hookData`, any caller could encode a high-karma address to steal fee discounts. The fix requires the `sender` to be in the `trustedRouters` mapping before decoding a custom swapper from `hookData`:

```solidity
address swapper = (hookData.length >= 32 && trustedRouters[sender])
    ? abi.decode(hookData, (address))
    : sender;
```

**Interface:**

```solidity
// Read (public)
function previewFee(address wallet) external view returns (uint24 fee, uint8 score);
function feeForKarma(uint8 score) external pure returns (uint24);

// Admin (routerAdmin only)
function setRouterTrusted(address router, bool trusted) external;
function transferRouterAdmin(address newAdmin) external;
```

**Fee constants (in pips — 1 pip = 0.0001%):**

```solidity
uint24 public constant FEE_STANDARD    = 2000;  // 0.20% — karma 0
uint24 public constant FEE_DISCOUNTED  = 1000;  // 0.10% — karma 1–30
uint24 public constant FEE_LOW         =  500;  // 0.05% — karma 31–60
uint24 public constant FEE_VERY_LOW    =  200;  // 0.02% — karma 61–80
uint24 public constant FEE_ELITE       =  100;  // 0.01% — karma 81–100
```

---

## Autonomous Agent

A TypeScript service running 24/7 on Railway. Polls X Layer every 60 seconds, computes a 4-factor karma score for each active wallet, and writes score changes on-chain through a delta-gated batch write.

### 4-Factor Scoring Model

```
Score (0–100) = swapFrequency + activeDays + accountAge + consistency
```

| Factor         | Weight | Signal Source                          | Computation                              |
|----------------|--------|----------------------------------------|------------------------------------------|
| Swap Frequency | 40 pts | `KarmaFeeApplied` event count          | Normalised vs. active wallet percentile  |
| Active Days    | 20 pts | Distinct calendar days with swaps      | `min(20, uniqueDays × 0.67)` — 90d window|
| Account Age    | 20 pts | First-seen block timestamp             | `min(20, ageInDays / 4.5)`               |
| Consistency    | 20 pts | Variance of inter-swap time intervals  | Low variance → high score                |

**Scoring window:** 90 days. Activity older than 90 days does not contribute to any factor.

### Write-Gate

The agent does **not** write on every cycle. An on-chain write is triggered only when a wallet's newly computed score differs from its last written score by **±3 points or more**. This keeps cumulative gas cost under the $10 OKB hackathon budget while ensuring meaningful reputation changes propagate promptly.

### Decay Sweep (K-04)

Every 360 loop iterations (approximately every 6 hours at a 60-second poll interval), the agent runs a full sweep of all tracked wallets whose `lastSeenAt` timestamp is older than the 90-day scoring window. These wallets are re-scored with `minSwapCount = 0`. Because their `recentTimestamps` arrays are entirely stale, all four scoring factors return near-zero values. The resulting score drop is written on-chain — ensuring karma decays for wallets that stop participating, rather than freezing at their peak score permanently.

### Agent Source Layout

```
agent/src/
├── scheduler/
│   └── loop.ts          Main poll loop · decay sweep · health state
├── chain/
│   ├── providers.ts      viem PublicClient + WalletClient factory
│   ├── contracts.ts      KarmaRegistry typed bindings
│   └── events/
│       └── poller.ts     getLogs for KarmaFeeApplied · block range chunking
├── scoring/
│   └── engine.ts         4-factor model · normalisation · minSwapCount gate
├── registry/
│   ├── batcher.ts        Delta threshold · batch accumulator · flush policy
│   └── writer.ts         batchSetKarma · requeue on failure
└── state/
    ├── redis.ts          Upstash Redis connection
    ├── walletStore.ts    Per-wallet swap history (Redis hash)
    ├── cursor.ts         Last-scanned block cursor (Redis string)
    └── schema.ts         Centralised Redis key namespace
```

---

## Security

### Resolved Audit Findings

| ID   | Severity | Title                                    | Resolution                                   |
|------|----------|------------------------------------------|----------------------------------------------|
| K-01 | Critical | hookData swapper spoofing                | Trusted router whitelist in `beforeSwap`     |
| K-02 | High     | Immutable agent — no key rotation path  | Owner/agent two-role separation + `setAgent` |
| K-04 | High     | Karma scores never decay                 | Periodic decay sweep every 360 iterations    |
| K-17 | Medium   | No emergency pause mechanism             | `setPaused(bool)` + `whenNotPaused` modifier |
| K-05 | Low      | Deployer / agent key conflation risk     | Deploy script enforces `agent != deployer`   |

### K-01 Detail — hookData Spoofing

**Attack vector:** Attacker calls the pool router with `hookData = abi.encode(highKarmaAddress)`. Without access control, `beforeSwap` decodes this and applies the victim's elite fee tier to the attacker's swap.

**Mitigation:** `trustedRouters[sender]` is checked before `hookData` is decoded. Senders not in the whitelist always receive the fee corresponding to their own `msg.sender` karma. The whitelist is managed by `routerAdmin` (set to the owner multisig at deploy time).

### K-02 Detail — Key Rotation

**Attack vector:** If the agent private key is compromised, there was no upgrade path under the original `immutable agent` design — requiring a full contract redeployment and migration of all stored scores.

**Mitigation:** `owner` can call `setAgent(newAgent)` at any time. The new key is authorised immediately. The old key loses write access. No redeployment. No score migration.

### Known Limitations

- **Approximate Sybil resistance.** Scoring uses public on-chain signals. A well-funded attacker simulating genuine swap activity over weeks could inflate their karma. V2 will incorporate verifiable credential anchors (e.g. Gitcoin Passport, on-chain attestations).
- **Single write key.** Compromise requires an owner-triggered `setAgent()` rotation call. Response time depends on owner (multisig) availability.
- **60-second score lag.** Karma scores are current to within one polling cycle. A wallet that has significantly changed its activity profile will receive an updated fee tier on its next swap after the agent write.

---

## Judge Verification Path

**End-to-end check in under 3 minutes:**

### Step 1 — Frontend (30 seconds)

Open [karma-protocol-app.vercel.app](https://karma-protocol-app.vercel.app).

Navigate to **Lookup** → enter any X Layer wallet address → the karma score and fee tier are read live from `KarmaRegistry.karma()` on-chain. No mock data is served if the contract is reachable.

### Step 2 — Agent Liveness (60 seconds)

Open the agent wallet on OKLink:

```
https://www.oklink.com/xlayer-test/address/$AGENT_WALLET
```

Refresh after 60 seconds. A new `batchSetKarma()` transaction will appear. Click it — the decoded calldata shows the exact wallets scored and their new values. Each transaction is one autonomous scoring cycle.

### Step 3 — Hook Read Verification (60 seconds)

Open KarmaHook on OKLink → **Contract** → **Read Contract**.

Call `previewFee(address)`:

| Input                          | Expected Output          | Interpretation          |
|--------------------------------|--------------------------|-------------------------|
| A fresh wallet (0 swaps)       | `fee: 2000, score: 0`    | 0.20% — STANDARD tier   |
| A high-activity wallet         | `fee: 100, score: 87`    | 0.01% — ELITE tier      |

That asymmetry — 20× fee difference — is the core value proposition, verifiable with a single read call.

### Step 4 — Registry Liveness (30 seconds)

Call `totalUpdates()` on KarmaRegistry. If the value exceeds 10, the agent has been actively writing since deployment. This number increments with every `batchSetKarma` call from the autonomous agent.

---

## Deployment

### Prerequisites

- Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- Node.js 18+
- Testnet OKB on X Layer Testnet (Chain ID 1952): [faucet](https://web3.okx.com/xlayer/faucet)

### 1. Contracts → X Layer Testnet

```bash
cd contracts
forge install
forge build
forge test -vv   # all tests must pass

forge script script/DeployKarmaHook.s.sol \
  --rpc-url https://testrpc.xlayer.tech \
  --sig "run(address,address,address)" \
  $POOL_MANAGER_ADDRESS \
  $AGENT_WALLET \
  $OWNER_ADDRESS \
  --private-key $PRIVATE_KEY \
  --broadcast
```

Save output addresses to `contracts/deployments/1952.json`.

### 2. Agent → Railway

```bash
# Set these in Railway dashboard under Variables:
RPC_URL=https://testrpc.xlayer.tech
CHAIN_ID=1952
KARMA_REGISTRY_ADDRESS=$XLAYER_REGISTRY_ADDRESS
KARMA_HOOK_ADDRESS=$XLAYER_HOOK_ADDRESS
AGENT_PRIVATE_KEY=$AGENT_PRIVATE_KEY
UPSTASH_REDIS_URL=$UPSTASH_REDIS_URL
UPSTASH_REDIS_TOKEN=$UPSTASH_REDIS_TOKEN
```

Health endpoint: `https://$RAILWAY_URL/health`

### 3. Frontend → Vercel

```bash
cd frontend
# Update .env:
# NEXT_PUBLIC_KARMA_REGISTRY_ADDRESS=$XLAYER_REGISTRY_ADDRESS
# NEXT_PUBLIC_KARMA_HOOK_ADDRESS=$XLAYER_HOOK_ADDRESS
# NEXT_PUBLIC_RPC_URL=https://testrpc.xlayer.tech
# NEXT_PUBLIC_CHAIN_ID=1952

npx vercel deploy --prod
```

Live at: [karma-protocol-app.vercel.app](https://karma-protocol-app.vercel.app)

---

## Repository Structure

```
KARMA/
├── contracts/                    Foundry project
│   ├── src/
│   │   ├── KarmaRegistry.sol     On-chain reputation store
│   │   └── KarmaHook.sol         Uniswap V4 beforeSwap hook
│   ├── script/
│   │   ├── Deploy.s.sol          Environment-driven deploy
│   │   └── DeployKarmaHook.s.sol Parameterised deploy (agent, owner, routerAdmin)
│   ├── test/
│   │   ├── KarmaRegistry.t.sol
│   │   └── KarmaHook.t.sol
│   └── deployments/
│       ├── 84532.json            Base Sepolia (reference deployment)
│       └── 1952.json             X Layer Testnet (primary submission)
│
├── agent/                        TypeScript scoring agent
│   ├── src/
│   │   ├── scheduler/loop.ts     Main loop + decay sweep (K-04)
│   │   ├── chain/                viem providers + contract bindings
│   │   ├── scoring/engine.ts     4-factor karma computation
│   │   ├── registry/             Write-gate + batch writer
│   │   └── state/                Redis cursor, wallet store, schema
│   └── railway.toml              Railway deployment config
│
├── frontend/                     Next.js 15 dashboard
│   ├── src/app/                  Pages: / · /dashboard · /lookup · /activity
│   ├── src/components/           KarmaGauge, FeeTierBadge, ActivityFeed
│   ├── src/hooks/                useKarmaScore, useLiveActivity, useProtocolStats
│   └── src/lib/                  wagmi config, ABIs, constants
│
└── .claude/launch.json           Dev server config (frontend · agent · redis)
```

---

## Local Development

```bash
git clone https://github.com/Powellgraham5/KARMA.git
cd KARMA

# Contracts
cd contracts && forge install && forge test -vv

# Agent
cd ../agent && npm install && cp .env.example .env && npm run dev

# Frontend
cd ../frontend && npm install && npm run dev
# → http://localhost:3000
```

---

## Hackathon Track Coverage

| Track                          | How Karma Protocol Qualifies                                                |
|--------------------------------|-----------------------------------------------------------------------------|
| DeFi Hook — dynamic fee tiers  | `KarmaHook.beforeSwap()` overrides fee per wallet reputation, atomically    |
| AI Agent Hook                  | Autonomous Railway agent · 60s loop · 4-factor scoring · on-chain writes    |
| Composable primitive           | `KarmaRegistry` is permissionlessly readable by any X Layer protocol        |

---

## License

MIT © 2026 Karma Protocol

Built for the **Hook the Future Hackathon** · X Layer × Uniswap V4  
Submission deadline: May 28, 2026 · 23:59 UTC
