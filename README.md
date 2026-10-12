# hodl-agent

The HODL Agent runs on the asset manager's own machine. It holds the manager's trading key and trades the manager's Chamber (formerly dHEDGE) vault on Base. The input is target weights, for example `{"cbBTC": 50, "WETH": 50}`. The agent reads the vault, works out the trades, signs them with the trading key and sends them to Base. It then reports each trade to the HODL API, which checks it on-chain and records it.

HODL is not in the trade path: trades go straight from this machine to the vault on Base. No HODL API call is needed to trade.

## Safety facts

- **The key never leaves this machine.** `hodl-agent init` creates the trading key here and saves it encrypted with your password at `~/.hodl/keystore.json`, readable only by you (mode 600). The key and the password are never printed or sent anywhere.
- **The trading key cannot withdraw.** The vault gives this key the Chamber *trader* role. A trader can only swap between the vault's enabled assets (USDC, WETH, cbBTC). It cannot withdraw funds, move them to another address, or change vault settings. Those rules are enforced by the vault contract, not by this software.
- **Maximum order size.** The agent refuses any rebalance in which a single trade is above `max_order_usd` (default $10). You can change it in `~/.hodl/config.json`.
- **Slippage.** Every trade uses a slippage limit of `slippage_bps` (default 100 = 1%).
- **Confirmation.** By hand, `rebalance` shows each transaction (action, wallet, amount, estimated gas) and asks `y/N`. Only `--yes` and `listen` trade without asking.
- **Local only.** `listen` accepts connections from this machine only (127.0.0.1), and every signal must carry your secret.

## Quick start

Requires Node.js 22.

```bash
# 1. Create the trading key (asks for a new password, min 12 characters)
npx github:Jrastegar-HODL/hodl-agent init --api-url <HODL API URL>

# 2. Register your strategy. HODL creates the vault, makes your key its trader and sends a small gas grant.
npx github:Jrastegar-HODL/hodl-agent onboard --name "My Strategy" --manager "My Fund" --invite <onboarding key>

# 3. After the distributor funds the vault: start the agent (unlocks the key once)
read -s HODL_AGENT_PASSWORD; export HODL_AGENT_PASSWORD
export HODL_SIGNAL_SECRET=$(openssl rand -hex 24)
caffeinate -i npx github:Jrastegar-HODL/hodl-agent listen

# 4. In a second terminal, in a clone of this repo: send signals at a fixed interval
HODL_SIGNAL_SECRET=<same secret> INTERVAL_SECONDS=900 ./examples/signal-loop.sh
```

Other commands:

```bash
npx github:Jrastegar-HODL/hodl-agent rebalance --weights cbBTC=50,WETH=50   # trade once, by hand
npx github:Jrastegar-HODL/hodl-agent status                                 # holdings, weights, share price, last trades
```

`HODL_RPC_URL` replaces the default public Base RPC (`https://mainnet.base.org`) when it is busy.

## Connecting your existing system

Your strategy system only has to send target weights. There are two ways.

**1. HTTP (any language).** With `listen` running, send a POST to `/signal`:

```bash
curl -X POST http://127.0.0.1:8787/signal \
  -H "x-signal-secret: $HODL_SIGNAL_SECRET" \
  -d '{"weights":{"cbBTC":50,"WETH":50}}'
```

- Weights are in percent and must sum to 100. Assets you leave out get 0. Changes below $0.50 are skipped.
- The agent answers `202 {"signal_id": "..."}` at once, then trades. A wrong secret gets `401`, invalid weights get `400`.
- Signals run one at a time. If several arrive during a run, only the newest one runs next.
- `GET /health` returns `{status, last_signal_at, last_result}`.

**2. From code (Node.js).** Call the same function the CLI uses. You can bring your own key management by implementing the `Signer` interface. The key must be the vault's trader.

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { ethers } from "@dhedge/v2-sdk"; // ethers v5, the version the agent uses
import { rebalance, type Signer } from "hodl-agent"; // npm install github:Jrastegar-HODL/hodl-agent

const config = JSON.parse(readFileSync(`${homedir()}/.hodl/config.json`, "utf8")); // written by init + onboard
const wallet = new ethers.Wallet(process.env.TRADER_PRIVATE_KEY!); // or your HSM / KMS signer
const signer: Signer = { getAddress: async () => wallet.address, getEthersSigner: async (p) => wallet.connect(p) };

const { txHashes } = await rebalance({ weights: { cbBTC: 60, WETH: 40 }, config, signer, yes: true });
console.log(txHashes);
```

## How a rebalance works

1. Read the vault's holdings in USD at the vault's own oracle prices.
2. For each asset: target = total × weight / 100, and change = target − current value.
3. Sell overweight assets to USDC first, then buy underweight assets with USDC. Trades go through KyberSwap.
4. After each trade, send the transaction hash to the HODL API (`POST /v1/strategies/{id}/trades`). If the API cannot be reached after 3 tries, the agent warns you: the trade is still valid on-chain, it just isn't recorded.

Day 1 test results and contract details: [docs/spike-results.md](docs/spike-results.md).
