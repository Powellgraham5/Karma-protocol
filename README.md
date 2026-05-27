# Karma Protocol

> On-chain reputation system built on Uniswap V4 Hooks — deployed on X Layer

## Monorepo Structure

```
karma-protocol/
├── contracts/     Solidity 0.8.24 + Foundry — KarmaHook (Uniswap V4) + KarmaToken
├── agent/         Node.js + TypeScript off-chain agent — event monitoring & scoring
├── frontend/      Next.js 15 + Tailwind + shadcn/ui + wagmi/RainbowKit
└── README.md
```

## Quick Start

### Contracts

```bash
cd contracts
cp .env.example .env        # fill in RPC_URL and PRIVATE_KEY
forge build
forge test
forge script script/Deploy.s.sol --rpc-url xlayer --broadcast
```

### Agent

```bash
cd agent
cp .env.example .env        # fill in RPC_URL and PRIVATE_KEY
npm install
npm run dev
```

### Frontend

```bash
cd frontend
cp .env.local.example .env.local   # fill in WalletConnect project ID
npm install
npm run dev                         # http://localhost:3000
```

## Tech Stack

| Layer     | Technology                              |
|-----------|------------------------------------------|
| Chain     | X Layer (Chain ID 196)                   |
| Contracts | Solidity 0.8.24, Foundry, Uniswap V4    |
| Agent     | Node.js, TypeScript, viem, ethers        |
| Frontend  | Next.js 15, Tailwind CSS, shadcn/ui      |
| Web3      | wagmi v2, RainbowKit, viem               |

## Environment Variables

Each package has its own `.env.example`. Copy and fill before running.

## Deployment

- **Contracts**: `forge script` with `--broadcast`
- **Agent**: Railway (`railway.json` included)
- **Frontend**: Vercel (auto-detected Next.js)
