# Karma Protocol — User Guide

**Karma Protocol** gives every wallet a reputation score (0–100) based on its on-chain trading history.
That score is read in real time by a Uniswap V4 hook, which sets your swap fee accordingly.
Loyal, consistent traders pay up to **20× less** than brand-new wallets — automatically, on every swap.

---

## Live App

| | |
|---|---|
| **Frontend** | https://karma-protocol-app.vercel.app |
| **Network** | X Layer Testnet (Chain ID 1952) |
| **Explorer** | https://www.oklink.com/xlayer-test |

---

## Quick Start (2 minutes)

### 1. Add X Layer Testnet to your wallet

Open MetaMask → **Add Network** → fill in:

| Field | Value |
|-------|-------|
| Network Name | X Layer Testnet |
| RPC URL | `https://testrpc.xlayer.tech` |
| Chain ID | `1952` |
| Currency Symbol | `OKB` |
| Block Explorer | `https://www.oklink.com/xlayer-test` |

### 2. Get testnet OKB

Visit the [X Layer Testnet Faucet](https://www.okx.com/xlayer/faucet) and paste your wallet address.
A small amount of OKB will be sent — enough to pay gas on all transactions.

### 3. Open the app

Go to **https://karma-protocol-app.vercel.app** and click **Connect Wallet** in the top-right corner.
Approve the X Layer Testnet network switch when prompted.

---

## Pages

### Home `/`

The landing page explains the protocol at a glance:

- **Fee Tier table** — the five tiers from 0.20% down to 0.01%, colour-coded by karma range.
- **How It Works** — three-step explainer: swap → score computed → lower fee applied.
- **Check My Karma** button — takes you straight to your dashboard.

---

### Dashboard `/dashboard`

Your personal karma hub. Requires a connected wallet.

**Left column — Karma Card**
- Your score (0–100) rendered as a large number with an animated ring.
- Your current **tier name** (Newcomer → Bronze → Silver → Gold → Elite) and colour.
- A **Refresh** button to re-read the score from the chain.

**Fee Preview panel**
- **Your Rate** — the exact swap fee you pay right now (e.g. `0.05%`).
- **Savings** — how much cheaper your rate is versus the baseline 0.20%.
- **All Fee Tiers** table — so you can see exactly how many more karma points unlock the next tier.

**Right column — Protocol Stats**
| Stat | Meaning |
|------|---------|
| Scored Wallets | Number of unique wallets the agent has written scores for |
| Avg Karma | Average score across all tracked wallets |
| Total Swaps | Cumulative swap events processed |
| Fees Saved | Estimated OKB saved by karma discounts |

**Activity Feed** — the last 8 swap events on the hook, showing swapper address, karma, fee tier, and timestamp.

---

### Lookup `/lookup`

Look up **any** wallet address — no connection required.

1. Paste a full `0x…` address into the search bar and press Enter (or click Search).
2. The **Karma Card** appears with that wallet's score pulled live from the contract.
3. A **Current Tier** panel shows its swap fee and tier name.
4. The **All Fee Tiers** table highlights where that wallet sits.

**Demo buttons** — three pre-loaded wallets let you explore without typing an address:
- **vitalik.eth** — the canonical example wallet
- **Low karma** — a wallet with minimal trading history
- **Elite trader** — a seeded wallet at 90+ karma, paying 0.01% fees

Click **Search another wallet** to clear and start over.

---

### Activity `/activity`

A live feed of every `KarmaFeeApplied` event emitted by the hook.

**Stats row** (computed from the visible window of events):
- Events in window
- Average karma score
- Number of elite swappers (score ≥ 81)
- Average fee in pips

**Main feed** — up to 50 recent events with swapper address, karma score, fee tier badge, and time.
The status indicator in the top-right shows **Live** (green pulse, on-chain data) or **Simulated** (demo data when no live events exist yet).

**Tier Distribution sidebar** — a bar chart breaking down what percentage of swappers fall into each tier.

**Karma → Fee legend** — a quick reference mapping score ranges to fee percentages.

---

## Fee Tier System

The hook maps karma scores to swap fees using five fixed tiers:

| Tier | Karma Range | Swap Fee | Savings vs Baseline |
|------|------------|----------|---------------------|
| 🔴 Newcomer | 0 | 0.20% (2000 pips) | — |
| 🟠 Bronze | 1–30 | 0.10% (1000 pips) | −0.10% |
| 🟡 Silver | 31–60 | 0.05% (500 pips) | −0.15% |
| 🔵 Gold | 61–80 | 0.02% (200 pips) | −0.18% |
| 🟢 Elite | 81–100 | 0.01% (100 pips) | −0.19% |

The fee is applied automatically by the Uniswap V4 `KarmaHook` on every swap — no claiming, no staking, no manual steps required.

---

## How Karma Scores Are Calculated

The off-chain agent scores every wallet across four factors, weighted equally:

| Factor | What it measures |
|--------|-----------------|
| **Swap Frequency** | How many swaps in the last 90 days |
| **Active Days** | Number of distinct calendar days the wallet traded |
| **Account Age** | How long ago the wallet first appeared on-chain |
| **Consistency** | How regularly the wallet trades (low variance = higher score) |

Scores are written to `KarmaRegistry` on-chain in batches. The hook reads the registry on every swap so your fee updates within the next batch cycle (roughly every minute with a full deployment).

---

## Contract Addresses (X Layer Testnet)

| Contract | Address |
|----------|---------|
| KarmaRegistry | `0x1D13fF25b10C9a6741DFdce229073bed652197c7` |
| KarmaHook | `0x8520437A994BeC0C3b1fE3EbB3F52CF514698080` |

View on explorer: https://www.oklink.com/xlayer-test/address/0x1D13fF25b10C9a6741DFdce229073bed652197c7

---

## For Developers / Judges

### Run the full test suite
```bash
# Unit tests (72 tests, no network needed)
cd contracts
forge test --no-match-path "*Fork*" -v

# Fork tests against real Uniswap V4 on Base Sepolia (3 tests)
forge test --match-path "test/KarmaHookFork.t.sol" --fork-url https://sepolia.base.org -vv
```

### Run the agent locally
```bash
cd agent
cp .env.example .env   # fill in AGENT_PRIVATE_KEY
npm install
npm run dev
```
Health endpoint: `http://localhost:3001` — returns `{ status, loopCount, lastLoopAt, pendingSize }`.

### Run the frontend locally
```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

---

## Architecture

```
User wallet
    │
    ▼  swap()
Uniswap V4 PoolManager
    │
    ▼  beforeSwap hook
KarmaHook.sol
    │  reads
    ▼
KarmaRegistry.sol ◄── batchSetKarma() ◄── Karma Agent (Node.js)
                                               │
                                     watches KarmaFeeApplied events
                                     computes wallet scores
                                     writes scores on-chain every ~1 min
```

**KarmaRegistry** — stores `address → uint8 score` mappings. Only the designated agent wallet can write scores; the owner (multisig) can rotate the agent key.

**KarmaHook** — a Uniswap V4 `beforeSwap` hook that overrides the pool's dynamic fee based on the swapper's score. Trusted-router pattern (K-01) ensures the real swapper address is always used, not an intermediary.

**Agent** — TypeScript / Node.js process. Polls `KarmaFeeApplied` events, accumulates per-wallet activity in a store (Redis or in-memory), runs the scoring engine, and writes batches to `KarmaRegistry` via `batchSetKarma`.
