# HODL MVP – Build Plan for Claude Code

Oct 10, 2026 · @jonathan

## 1. Instructions for Claude Code (read first)&#32;

This document is the complete specification for the HODL MVP. Build exactly what it says, in the order it says, and nothing else.

**Main task (what the demo proves):** build a working demo in which an asset manager onboards, a vault is created with fixed rules, the asset manager's own key sends trades that the vault executes, and a neobank buys and sells vault shares through the HODL API.

**Scope rules**

- Build only the components, endpoints, commands and scripts in this document.
- Do not add features, extra endpoints, extra chains, other vault protocols, dashboards or a front-end. The only front-end is the optional Day 4 step, and only when the founder asks for it.
- Do not refactor working code unless a step in this document requires it. Write the least code that passes each "Done when" test: no caches, queues, extra retries, extra tables or extra endpoints.
- Do not replace a library or tool named in this document with a different one. If a named tool does not work, stop and use the fallback in section 12, or ask the founder.
- Two interfaces are mandatory: `VaultAdapter` (in hodl-api) and `Signer` (in hodl-agent). Add no other abstraction layers.

**Working method**

1. Work on one step at a time. Each step has a "Done when" test.
2. At the end of each step, run the "Done when" test, show the result, and stop. Wait for the founder to say "continue" before the next step.
3. Before you use a library function, read the library's README and its TypeScript type definitions in `node_modules`. Do not guess function names or parameters.
4. The founder is not a developer. Explain each result in plain language. When the founder must do something, give the exact command or the exact click path.
5. If a step fails two times, stop, explain the problem in plain language, and propose the fallback from section 12.

**Safety rules (mainnet, real money)**

- Never ask the founder to paste a private key into the chat. Keys go only into `.env` files or encrypted keystore files that the founder creates.
- Never print a private key, a mnemonic or a full API key in logs or terminal output.
- `.env`, `.secrets/` and `*.keystore.json` files must be in `.gitignore` before the first commit.
- Before any script sends a mainnet transaction, it must print: the action, the sending wallet, the amount, and the estimated gas. Then it must ask for confirmation (`y/N`), except when the agent CLI runs with --yes.
- Spend limits are configuration values, not hard-coded rules: GAS\_GRANT\_ETH in hodl-api and max\_order\_usd in the agent config. Do not add other amount caps in code.

**Code conventions**

- TypeScript, strict mode, Node.js 20 LTS, ES modules.
- Use the `ethers` v5 package that `@dhedge/v2-sdk` uses. Do not add viem or a second blockchain library.
- Validate all inputs with `zod`.
- Small files, clear names, comments only where the logic is not obvious.
- Every amount in code carries its unit in the variable name (`amountUsdc`, `sharesWei`).

## 2. Architecture

**Core principle:** HODL is infrastructure only. HODL is not in the trade path, holds no customer funds, holds no trading keys, and never signs or broadcasts trades or deposits.

**Parties and roles**

| Party | Holds | Can do | Cannot do |
| --- | --- | --- | --- |
| Asset manager | Its trading key (on its own machine) | Decide trades; sign and send trade instructions to its vault | Withdraw from the vault; change vault settings |
| Vault contract (Chamber on Base) | All vault assets | Check its rules; execute swaps; mint and burn shares; pay withdrawals | — |
| Neobank (distributor) | Its omnibus wallet, which holds the shares | Sign and send deposits and withdrawals | Trade the vault |
| HODL | Vault admin key (Chamber "manager" role) only | Create vaults; set enabled assets, fees and trader; serve the API; record trades | Move vault funds; trade; sign for anyone else |

**Components**

| Component | Repo | Runs on | Function |
| --- | --- | --- | --- |
| HODL API | `hodl-api` (private) | Railway | Onboarding (strategies), trade records, distribution (products, orders, positions), Swagger docs |
| VaultAdapter (Chamber) | `hodl-api` | Railway | The only code in the API that knows Chamber details |
| Demo neobank script | `hodl-api` (`scripts/`) | Founder's laptop | Simulates the neobank: buys and sells shares with the omnibus key |
| HODL Agent (library + CLI) | `hodl-agent` (public) | Asset manager's machine (VC laptop in the demo) | Receives weight signals, then builds, signs and sends trades to the vault; reports trades to the API |

**Flows**

```text
ONBOARDING (one time)
Agent: init -> creates the trading key on the asset manager's machine
Agent: onboard -> POST /v1/strategies (trader_address)
HODL API -> creates vault (admin key) -> sets trader -> gas grant -> returns config + manager API key

TRADING (HODL not involved)
Asset manager's system -> POST http://127.0.0.1:8787/signal {weights} -> hodl-agent listen
Agent -> reads vault -> computes trades -> signs with trading key -> sends to Base
Vault contract -> checks rules -> swaps on DEX -> tokens stay in vault
Agent -> POST /v1/strategies/{id}/trades (tx_hash) -> HODL API verifies on-chain and records

DISTRIBUTION
Neobank -> POST /v1/orders -> HODL API returns unsigned transactions
Neobank -> signs and sends with omnibus wallet -> vault mints or burns shares
Neobank -> POST /v1/orders/{id}/executions (tx_hashes) -> HODL API verifies and records the client's shares
```

**Fixed decisions (do not change)**

- Chain: Base mainnet, chain ID 8453.
- Vault protocol: Chamber (formerly dHEDGE), through `@dhedge/v2-sdk`.
- Vault assets: USDC (deposit asset), WETH, cbBTC. Vaults are public.
- Trade routing: KyberSwap through the SDK.
- Signal format: target weights only, for example `{"weights": {"cbBTC": 50, "WETH": 50}}`.
- Distribution model: omnibus. The neobank's wallet holds the shares; HODL records the shares of each `client_reference`.
- A live vault never changes. A changed strategy (assets, trader or fees) gets a new vault.
- Each deposit has a 24-hour withdrawal lockup set by the protocol. Trading is not locked. A withdrawal pays a pro-rata basket of the vault's current assets, not the deposit asset. The MVP has no USDC-only payout.

## 3. Third parties, services and tools

All accounts belong to HODL and are opened by the founder, except where the table says otherwise.

**Services and accounts**

| Service | Purpose in this build | Cost | Account owner |
| --- | --- | --- | --- |
| Claude Code | Writes and runs all code, step by step | Founder's Claude plan | Founder |
| GitHub | Two repos: `hodl-api` (private) and `hodl-agent` (public) | Free | HODL |
| Railway (Hobby plan) | Hosts the HODL API and its Postgres database | $5/month, includes $5 of usage | HODL |
| Alchemy | Base mainnet RPC for the HODL API | Free tier | HODL |
| Chamber (formerly dHEDGE) | Vault contracts on Base; Chamber app to view vaults and as a fallback for vault setup | Gas only; vault fees set to 0 | HODL Admin wallet |
| KyberSwap | DEX route for trades, called through the Chamber SDK | Free, no API key | None |
| Basescan | Show transactions and contract state | Free | None |
| Postman | Collection for live API calls in the demo | Free | HODL |
| Coinbase (or another exchange) | Buy USDC and ETH; withdraw directly to Base | Exchange fees | Founder |
| Rabby or MetaMask (browser wallet) | Hold the HODL Admin and Neobank Omnibus accounts; use the Chamber app | Free | HODL |
| 1Password or Bitwarden | Store private keys, API keys and passwords | Free tier or existing | HODL |
| Netlify | Optional Day 4 front-end only | Free | HODL |

**Software packages**

| Package | Used in | Purpose |
| --- | --- | --- |
| `@dhedge/v2-sdk` | hodl-api, hodl-agent | Create vaults, set trader, trade, deposit, withdraw, read vault state |
| `ethers` (v5, the version the SDK uses) | hodl-api, hodl-agent | Wallets, encrypted keystore, transaction encoding, receipts |
| `fastify` | hodl-api | HTTP server |
| `zod` + `fastify-type-provider-zod` | hodl-api | Input validation and OpenAPI schema generation |
| `@fastify/swagger` + `@fastify/swagger-ui` | hodl-api | Swagger docs page at `/docs` and `openapi.json` |
| `prisma` + `@prisma/client` | hodl-api | Postgres schema, migrations and queries |
| `dotenv` | hodl-api, hodl-agent | Load `.env` files |
| `commander` | hodl-agent | CLI commands |
| `@clack/prompts` | hodl-agent | Password and confirmation prompts |
| `tsx` | both | Run TypeScript scripts during development |
| `typescript` | both | Compile |

**Local tools on the founder's Mac:** Node.js 20 LTS (with npm), Git, Claude Code, Postman, a browser with Rabby or MetaMask.

**Wallets**

| Wallet | Created by | Role | Funds needed on Base |
| --- | --- | --- | --- |
| HODL Admin | Founder, in the browser wallet | Chamber vault manager; pays vault creation gas and gas grants | About $25 of ETH |
| Neobank Omnibus | Founder, in the browser wallet | Depositor; holds all shares | 100 USDC + about $5 of ETH |
| Test trader (Day 1 only) | Spike script, encrypted on disk | Trader of the first vault | Gas grant from HODL Admin |
| VC trading key (demo) | `hodl-agent init` on the VC's laptop | Trader of the VC's vault | Gas grant from HODL Admin |

## 4. Prerequisites (founder, before Day 1)

The founder does these steps manually. Claude Code can help with commands, but it must never see a private key.

**4.1 Local installs (macOS)**

- [ ] Git: run `xcode-select --install` in Terminal (skip if `git --version` already prints a version).
- [ ] Node.js 20 LTS: install from nodejs.org, then check that `node --version` prints `v20.x`.
- [ ] Claude Code: already installed.
- [ ] Postman: install the desktop app.
- [ ] Browser wallet: Rabby or MetaMask.

**4.2 Accounts**

- [ ] GitHub: create two empty repos, `hodl-api` (private) and `hodl-agent` (public).
- [ ] Railway: create an account with GitHub login and select the Hobby plan.
- [ ] Alchemy: create an app on **Base Mainnet**. Copy its HTTPS URL into the password manager as `BASE_RPC_URL`.

**4.3 Wallets**

- [ ] In the browser wallet, create two new accounts, named `HODL Admin` and `Neobank Omnibus`. Use them only for this demo.
- [ ] Export the private key of each account and store it in the password manager. You will paste these keys only into `.env` files, never into a chat.

**4.4 Funds (all on Base)**

- [ ] Buy USDC and ETH on the exchange.
- [ ] Withdraw directly on the **Base** network (not Ethereum mainnet) to:
  - HODL Admin: about $25 of ETH.
  - Neobank Omnibus: 100 USDC and about $5 of ETH.
- [ ] Check both balances on basescan.org.

**4.5 Key handling rules**

- The HODL API on Railway holds only `ADMIN_PRIVATE_KEY`. The Neobank Omnibus key never goes to Railway; it stays on the founder's laptop for the demo neobank script.
- Trading keys are created by the HODL Agent on the asset manager's machine, encrypted with a password, and never sent anywhere.

## 5. High-level plan

The build takes four working days after the prerequisites. Day 4 is optional.

| Day | Goal | Steps | Done when |
| --- | --- | --- | --- |
| 1 | Prove the on-chain parts work | 1.1–1.6: repo skeleton, verification, vault, trader, deposit, trade | A vault on Base holds USDC, WETH and cbBTC after a trade signed by the test trader key; `docs/spike-results.md` records every fact and decision |
| 2 | Onboarding and automated trading | 2.1–2.6 (hodl-api): server, database, VaultAdapter, onboarding, trade records, deploy. 2.7–2.10 (hodl-agent): setup, key and config, commands, listen | Three signals in a row, sent by the signal loop, each produce vault trades that appear in `GET /v1/strategies/{id}/trades`, with no person typing |
| 3 | Distribution, docs, rehearsal | 3.1–3.7: adapter methods, products, orders and positions, demo neobank script, docs and deploy, pre-demo setup, rehearsal | The runbook in section 11 runs two times without errors on a clean macOS user account |
| 4 (optional) | Minimal front-end | 4.1–4.3: read-only catalogue and product page on Netlify | The page shows live products, share price and trades from the API |

**Order rule:** finish and pass each "Done when" test before the next step starts.

**Timing rule:** start step 3.6 (pre-demo setup) at least 24 hours before the demo, because of the withdrawal lockup. An earlier start gives a longer trade history to show.

## 6. Repositories, structure and conventions

Use this structure. Steps add the scripts and docs they name.

**6.1 `hodl-api` (private)**

```text
hodl-api/
  src/
    server.ts            Fastify app, Swagger, routes
    config.ts            Validates server env vars with zod
    db.ts                Prisma client
    auth.ts              Bearer key check: onboarding, distributor, manager
    chain/
      constants.ts       Chain ID, token addresses, explorer URL
      provider.ts        ethers provider + admin wallet
    vault/
      VaultAdapter.ts    Interface (the only vault abstraction)
      ChamberAdapter.ts  Chamber implementation via @dhedge/v2-sdk
    routes/
      strategies.ts      POST /v1/strategies, trade records
      products.ts        GET /v1/products
      orders.ts          Orders and positions
  prisma/schema.prisma
  scripts/
    spike/               Day 1 scripts (00-check.ts to 04-trade.ts)
    demo-neobank.ts      Demo neobank CLI (founder's laptop only)
  docs/spike-results.md
  .env.example
  .gitignore             .env, .secrets/, node_modules/, dist/
```

**6.2 `hodl-agent` (public)**

```text
hodl-agent/
  src/
    cli.ts               commander entry: init, onboard, rebalance, status, listen
    index.ts             Library exports: rebalance, getStatus, Signer type
    config.ts            Reads and writes ~/.hodl/config.json
    signer/
      Signer.ts          Interface (the only signer abstraction)
      KeystoreSigner.ts  Encrypted keystore at ~/.hodl/keystore.json
    vault.ts             Chamber calls via @dhedge/v2-sdk
    rebalance.ts         Target weights -> trades
    listen.ts            Local signal endpoint (Node built-in http module)
    report.ts            Sends trade records to the HODL API
  examples/signal-loop.sh  Sends new weights at a fixed interval
  docs/spike-results.md  Copy from hodl-api
  package.json           "bin": {"hodl-agent": "dist/cli.js"}, "prepare": "tsc"
  README.md
  .gitignore
```

The `prepare` script lets `npx github:<org>/hodl-agent` build the CLI on install, so no npm publishing is needed.

**6.3 Environment variables**

| Variable | Where | Value |
| --- | --- | --- |
| `DATABASE_URL` | hodl-api: local `.env` + Railway | Postgres URL from Railway |
| `BASE_RPC_URL` | hodl-api: local `.env` + Railway | Alchemy Base mainnet HTTPS URL |
| `ADMIN_PRIVATE_KEY` | hodl-api: local `.env` + Railway | HODL Admin key |
| `OMNIBUS_ADDRESS` | hodl-api: local `.env` + Railway | Neobank Omnibus public address (the demo distributor's wallet) |
| `GAS_GRANT_ETH` | hodl-api: local `.env` + Railway | `0.0005` |
| `ONBOARDING_API_KEY` | hodl-api: local `.env` + Railway | `hodl_onb_` + 48 random hex characters |
| `DISTRIBUTOR_API_KEY` | hodl-api: local `.env` + Railway | `hodl_dist_` + 48 random hex characters |
| `PORT` | Railway | Set by Railway |
| `OMNIBUS_PRIVATE_KEY` | hodl-api: local `.env` only | Neobank Omnibus key, for scripts |
| `HODL_API_URL` | hodl-api: local `.env` only | Railway public URL, for `demo-neobank.ts` |
| `HODL_AGENT_PASSWORD` | Agent machine, shell only | Keystore password, needed by `listen` |
| `HODL_SIGNAL_SECRET` | Agent machine, shell only | Secret that every signal must send |
| `HODL_RPC_URL` | Agent machine, shell only (optional) | Replaces the default public RPC |

The founder creates the two API keys and the signal secret with `openssl rand -hex 24`.

**6.4 Chain constants (verify in step 1.2)**

| Name | Value |
| --- | --- |
| Chain ID | `8453` (Base mainnet) |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| WETH | `0x4200000000000000000000000000000000000006` |
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` |
| Agent default RPC | `https://mainnet.base.org` (the agent never uses HODL's Alchemy key) |
| Explorer | `https://basescan.org` |

**6.5 API conventions**

- Base path `/v1`. JSON keys in `snake_case`. Times in ISO 8601 UTC.
- Auth header `Authorization: Bearer <api key>`. The onboarding and distributor keys come from env vars. Each strategy gets one manager key at onboarding, stored only as a sha256 hash. `GET /v1/products` and `GET /v1/products/{id}` are public.
- Amounts are decimal strings with units in the key name: `amount_usdc: "10.00"`, `shares: "9.512345678901234567"`.
- Errors: HTTP status + `{"error": {"code": "string", "message": "string"}}`.

**6.6 Git**

- Commit after each passing step with the message `Step X.Y: <summary>`.
- Push to GitHub at the end of each day.

## 7. Day 1: verification spike (on-chain parts)

Day 1 proves that every on-chain part works on Base before any API code exists. Section 4 must be complete. All Day 1 code is in `hodl-api/scripts/spike/`.

Each step uses these parts as needed: **Goal**, **Founder does**, **Prompt for Claude Code**, **Done when**, **Fallback**.

### Step 1.1: Repo skeleton and balance check

**Goal:** a minimal `hodl-api` project that can read Base.

**Founder does:** clone the empty `hodl-api` repo and open it in Claude Code. After Claude Code creates `.env.example`, copy it to `.env`. Fill `BASE_RPC_URL`, `ADMIN_PRIVATE_KEY`, `OMNIBUS_ADDRESS` and `OMNIBUS_PRIVATE_KEY` from the password manager, and set `GAS_GRANT_ETH` to `0.0005`.

**Prompt for Claude Code:**

```text
Read sections 1, 6.1, 6.3 and 6.4 of the build plan. Do step 1.1 only.
In this repo: create an npm project (TypeScript strict, ES modules, Node 20).
Install: @dhedge/v2-sdk, dotenv, zod, tsx, typescript.
Create .gitignore (as in 6.1) and .env.example (hodl-api variable names from 6.3, no values).
Create src/chain/constants.ts (values from 6.4) and src/chain/provider.ts
(exports an ethers provider from BASE_RPC_URL and an admin wallet from ADMIN_PRIVATE_KEY,
using the ethers version that @dhedge/v2-sdk exports).
Create scripts/spike/lib.ts with a confirm() helper that prints action, sending wallet,
amount and estimated gas, then asks y/N.
Create scripts/spike/00-check.ts that prints: chain ID, admin address and ETH balance,
omnibus address and its ETH and USDC balances.
Do not create any other files. Do not print private keys.
```

**Done when:** `npx tsx scripts/spike/00-check.ts` prints chain ID `8453` and the expected balances.

**Fallback:** wrong chain ID means the Alchemy app is not on Base mainnet; create a new Base mainnet app.

### Step 1.2: Verify addresses, Chamber assets and SDK functions

**Goal:** confirm every fact that later steps depend on, from the source.

**Founder does:**

1. Open each token address from 6.4 on basescan.org and confirm the names: USD Coin, Wrapped Ether, Coinbase Wrapped BTC.
2. Open the Chamber app with the HODL Admin wallet → Manage → Base → start the create-vault form. Confirm that USDC, WETH and cbBTC are in the asset list. Do not create the vault.
3. Tell Claude Code the results.

**Prompt for Claude Code:**

```text
Do step 1.2 only. Read the README and the TypeScript type definitions of
@dhedge/v2-sdk in node_modules. Do not guess.
Create docs/spike-results.md with a table of the exact signatures and the file
where each is defined, for: the Network value for Base, the Dapp value for KyberSwap,
createPool, loadPool, setTrader, approve (for trading), trade, approveDeposit,
deposit, withdraw, getComposition, and the functions that read: the share price,
the USD value of each holding and of the whole vault, the remaining withdrawal
cooldown of an address, and the trader and manager addresses.
If the SDK has no function for one of these, write "not in SDK" and name the
contract function from the SDK's ABI files instead.
Add the founder's results for the token addresses and the Chamber asset list.
```

**Done when:** `docs/spike-results.md` lists every item with a source file, or "not in SDK" plus the ABI function.

**Fallback:** if cbBTC is not in Chamber's asset list on Base, use USDC and WETH only for the whole build.

### Step 1.3: Create the first vault

**Goal:** one public Chamber vault on Base, managed by HODL Admin.

**Prompt for Claude Code:**

```text
Do step 1.3 only. Create scripts/spike/01-create-vault.ts.
Use the SDK signatures from docs/spike-results.md.
Create a public vault from the admin wallet on Base with: manager name "HODL Markets",
vault name "HODL Demo BTC-ETH", symbol "hDEMO", assets USDC (deposit enabled),
WETH (deposit disabled), cbBTC (deposit disabled), all fees 0.
Use confirm() before sending. Print the vault address and the Basescan link.
Save {"vaultAddress": ...} to .secrets/spike.json and add the address to
docs/spike-results.md.
```

**Done when:** Basescan shows the vault creation transaction from HODL Admin, and the Chamber app shows the vault.

**Fallback:** if the script fails two times, create the vault in the Chamber app with the same settings and write its address into `.secrets/spike.json` by hand.

### Step 1.4: Test trader key and trader role

**Goal:** a trader key that is not HODL's, registered as the vault's trader.

**Prompt for Claude Code:**

```text
Do step 1.4 only. Create scripts/spike/02-test-trader.ts that:
1. Creates a random wallet, asks for a password, and saves it encrypted to
   .secrets/test-trader.keystore.json. Prints only the address.
2. Sends GAS_GRANT_ETH from the admin wallet to that address (confirm()).
3. Calls setTrader(address) on the vault from .secrets/spike.json as the admin (confirm()).
4. Reads back the vault's trader address and prints it.
```

**Done when:** the vault's trader equals the test trader address, and the test trader holds 0.0005 ETH.

**Fallback:** set the trader in the Chamber app (Manage → vault → trader delegation).

### Step 1.5: First deposit

**Goal:** the omnibus wallet deposits USDC and receives shares.

**Prompt for Claude Code:**

```text
Do step 1.5 only. Create scripts/spike/03-deposit.ts that uses OMNIBUS_PRIVATE_KEY to
approve and deposit USDC into a vault (confirm() before each transaction).
Arguments: --amount <usdc> (default 10), --vault <address> (default: the vault in
.secrets/spike.json). Print: transaction hashes, shares received, share price,
omnibus share balance.
```

**Done when:** the omnibus wallet holds vault shares, and the vault holds about 10 USDC.

### Step 1.6: First trade and decisions

**Goal:** the vault executes a swap that the test trader key signed, and Day 1 results are recorded.

**Prompt for Claude Code:**

```text
Do step 1.6 only. Create scripts/spike/04-trade.ts that:
1. Loads .secrets/test-trader.keystore.json (password prompt).
2. Creates the SDK client with the trader wallet and loads the vault.
3. Does any approval the SDK requires for KyberSwap trading (confirm()).
4. Trades 4 USDC to cbBTC and 4 USDC to WETH through KyberSwap, slippage 1% (confirm()).
5. Prints the transaction hashes, the gas used and cost (ETH and USD) of each
   transaction, then the vault composition with USD values and the
   share price.
Then add a Decisions table to docs/spike-results.md: check | result | decision
(use the fallback from section 12 where a check failed).
```

**Done when:** both transactions succeed from the test trader address, the vault holds cbBTC and WETH, and `docs/spike-results.md` has a decision for each check. Commit and push.

**Fallback:** see section 12 (trade routing).

## 8. Day 2: onboarding API and HODL Agent

Day 2 builds strategy onboarding in `hodl-api` (steps 2.1–2.6) and the HODL Agent with automated signals in `hodl-agent` (steps 2.7–2.10). Use the facts in `docs/spike-results.md` for every SDK and contract call.

### Step 2.1: API server, config, health and docs

**Founder does:** in Railway, create a project named `hodl` and add a Postgres database. Copy its public connection URL into `hodl-api/.env` as `DATABASE_URL`. Create `ONBOARDING_API_KEY` and `DISTRIBUTOR_API_KEY` as 6.3 describes, add them to `.env`, and store them in the password manager.

**Prompt for Claude Code:**

```text
Read sections 1, 6.1, 6.3 and 6.5. Do step 2.1 only.
Install fastify, zod, fastify-type-provider-zod, @fastify/swagger, @fastify/swagger-ui,
prisma, @prisma/client.
Create src/config.ts: load .env with dotenv and validate these server variables with zod:
DATABASE_URL, BASE_RPC_URL, ADMIN_PRIVATE_KEY, OMNIBUS_ADDRESS, GAS_GRANT_ETH,
ONBOARDING_API_KEY, DISTRIBUTOR_API_KEY; PORT optional (default 3000). Exit with a clear
message if one is missing. Scripts validate their own variables.
Create src/server.ts: Fastify with the zod type provider, Swagger UI at /docs,
OpenAPI JSON at /openapi.json, title "HODL API", version "v1", request timeout 60 s.
Add GET /health that returns {status, chain_id, admin_address, block_number}.
Add npm scripts: dev (tsx watch), build (tsc), start (node dist).
```

**Done when:** after `npm run dev`, `http://localhost:3000/health` returns `chain_id: 8453`, and `http://localhost:3000/docs` shows the Swagger page.

### Step 2.2: Database schema

**Prompt for Claude Code:**

```text
Do step 2.2 only. Create prisma/schema.prisma with three models (snake_case table names):
- Strategy: id (cuid), name, manager_name, description?, trader_address, vault_address,
  symbol, assets (Json: symbol -> address), manager_key_hash (unique), created_at.
- Trade: id (cuid), strategy_id, tx_hash (unique), block_number, signal (Json?),
  created_at.
- Order: id (cuid), strategy_id, side (enum: buy, sell), client_reference,
  amount_usdc (Decimal?), shares_requested_wei (Decimal(78,0)?), status (enum: prepared,
  completed, failed), transactions (Json), tx_hashes (Json?),
  shares_delta_wei (Decimal(78,0)?), error_message?, created_at, updated_at.
A product is a strategy: product_id = strategy id. Positions are computed from completed
orders; there is no positions table.
Run the first migration against DATABASE_URL.
```

**Done when:** the migration succeeds and Prisma Studio shows the three tables.

### Step 2.3: VaultAdapter and ChamberAdapter

**Prompt for Claude Code:**

```text
Do step 2.3 only. Create src/vault/VaultAdapter.ts with this interface (amounts as bigint
or decimal strings, addresses checksummed):
  createVault({name, symbol, managerName}) -> {vaultAddress, txHash}
    (always: USDC deposit-enabled, WETH and cbBTC deposit-disabled, fees 0, public)
  setTrader(vaultAddress, traderAddress) -> {txHash}
  sendGasGrant(toAddress) -> {txHash}
  getVaultState(vaultAddress) -> {sharePriceUsd, totalSharesWei, totalValueUsd,
    holdings: {symbol, address, balance, valueUsd, weightPct}[], manager, trader}
  verifyTrade(vaultAddress, traderAddress, txHash) -> {ok, blockNumber, reason?}
  prepareDeposit(vaultAddress, fromAddress, amountUsdc) -> UnsignedTx[]   (Day 3)
  prepareWithdraw(vaultAddress, fromAddress, sharesWei) -> UnsignedTx[]   (Day 3)
  getSharesDelta(vaultAddress, txHash, holderAddress) -> sharesDeltaWei     (Day 3)
  getAssetsReceived(txHash, holderAddress) -> {symbol, amount}[]           (Day 3)
  getRemainingCooldownSeconds(vaultAddress, address) -> number             (Day 3)
UnsignedTx = {to, data, value, chain_id, description}.
Create src/vault/ChamberAdapter.ts implementing the methods not marked Day 3 with
@dhedge/v2-sdk and the ABI functions from docs/spike-results.md, signing with the admin
wallet. Day 3 methods throw "not implemented" for now.
verifyTrade: receipt status success, tx.from == trader, tx.to == vault address.
The gas grant amount comes only from GAS_GRANT_ETH. Log every transaction hash.
Add scripts/check-adapter.ts that calls getVaultState on the Day 1 vault.
```

**Done when:** `npx tsx scripts/check-adapter.ts` prints the Day 1 vault state with cbBTC and WETH holdings.

### Step 2.4: Auth and POST /v1/strategies (onboarding)

**Prompt for Claude Code:**

```text
Do step 2.4 only.
src/auth.ts: a requireRole(...roles) preHandler that reads Authorization: Bearer <key>.
Roles: onboarding (key equals ONBOARDING_API_KEY), distributor (key equals
DISTRIBUTOR_API_KEY), manager (sha256 of the key equals a Strategy.manager_key_hash;
attach strategyId). Use a constant-time compare. Missing or unknown key -> 401;
wrong role -> 403.
src/routes/strategies.ts: POST /v1/strategies (role: onboarding).
Body (zod): name (3-40 chars), manager_name (2-60), description (max 280, optional),
trader_address (valid address), symbol (optional, 3-8 letters or digits; default "h" +
first 4 letters of name, uppercase).
Process in order: createVault -> setTrader(trader_address) -> sendGasGrant(trader_address)
-> create manager key "hodl_mgr_" + 48 random hex characters -> save Strategy with the
key's sha256 hash.
On any error: respond 502 {error: {code: "onboarding_failed", message, failed_step,
tx_hashes, vault_address (if created)}} and save nothing. No resume logic: a new call
creates a new vault.
Response 201: {strategy_id, product_id (= strategy_id), vault_address, trader_address,
symbol, chain_id, explorer_url, tx_hashes, manager_api_key (only in this response),
sdk_config: {api_url, strategy_id, vault_address, chain_id, assets: {symbol: address}}}.
```

**Done when:** one call from Swagger with the onboarding key and a fresh test address creates a new vault on Basescan with that trader, and the response matches the spec.

### Step 2.5: Trade records

**Prompt for Claude Code:**

```text
Do step 2.5 only. In src/routes/strategies.ts add:
- POST /v1/strategies/{id}/trades (role: manager, only for its own strategy).
  Body: {tx_hash, signal (optional object)}. Call verifyTrade with the strategy's vault
  and trader. ok -> save Trade, 201 {trade_id, tx_hash, block_number, explorer_url}.
  Not ok -> 422 {error: {code: "trade_not_verified", message: reason}}.
  The same tx_hash again -> 200 with the saved record.
- GET /v1/strategies/{id}/trades (role: onboarding, or the manager of that strategy):
  newest first, max 50, with explorer_url per trade.
```

**Done when:** posting the Day 1 test-trader trade hash to the step 2.4 strategy returns 422 `trade_not_verified`. Valid trades are tested in step 2.9.

### Step 2.6: First deploy to Railway

**Founder does:** follow Claude Code's click-by-click instructions in Railway.

**Prompt for Claude Code:**

```text
Do step 2.6 only. Prepare hodl-api for Railway: build command "npm run build", start
command "npx prisma migrate deploy && npm start", listen on 0.0.0.0 and PORT.
Then give me click-by-click Railway steps: add a service from the GitHub repo hodl-api
in the existing "hodl" project, reference the Postgres DATABASE_URL, add BASE_RPC_URL,
ADMIN_PRIVATE_KEY, OMNIBUS_ADDRESS, GAS_GRANT_ETH, ONBOARDING_API_KEY,
DISTRIBUTOR_API_KEY, and generate a public domain.
After the deploy, tell me to put the public URL in .env as HODL_API_URL.
```

**Done when:** `https://<railway-domain>/health` returns `chain_id: 8453`, and `/docs` loads.

### Step 2.7: hodl-agent repo setup

**Founder does:** clone the empty `hodl-agent` repo, create `docs/`, copy `hodl-api/docs/spike-results.md` into it, and open the repo in Claude Code.

**Prompt for Claude Code:**

```text
Read sections 1, 6.2 and 6.4 of the build plan. Do step 2.7 only.
Create an npm package "hodl-agent" (TypeScript strict, ES modules, Node 20).
Install @dhedge/v2-sdk, commander, @clack/prompts, zod, typescript.
package.json: "bin": {"hodl-agent": "dist/cli.js"}, "prepare": "tsc", "files": ["dist"].
src/cli.ts starts with a node shebang and shows --help with the commands init, onboard,
rebalance, status and listen (stubs for now). Create .gitignore.
Push to GitHub, then test: npx github:<org>/hodl-agent --help
```

**Done when:** `npx github:<org>/hodl-agent --help` lists `init`, `onboard`, `rebalance`, `status` and `listen`.

### Step 2.8: Trading key and config

**Prompt for Claude Code:**

```text
Do step 2.8 only. Use the ethers version exported by @dhedge/v2-sdk.
- src/signer/Signer.ts: interface Signer { getAddress(): Promise<string>;
  getEthersSigner(provider): Promise<ethers.Signer> }.
- src/signer/KeystoreSigner.ts: create() makes a random wallet, asks for a password two
  times (min 12 chars), and saves the encrypted JSON to ~/.hodl/keystore.json with file
  mode 600; it refuses to overwrite an existing file. load() takes the password from
  HODL_AGENT_PASSWORD or a prompt. Never print the key or the password.
- src/config.ts: ~/.hodl/config.json (file mode 600), validated with zod:
  {api_url, rpc_url (default https://mainnet.base.org; HODL_RPC_URL replaces it),
  chain_id (8453), strategy_id?, vault_address?, manager_api_key?, assets? (symbol ->
  address), max_order_usd (default 10), slippage_bps (default 100)}.
  Functions: read(), write(partial), requireOnboarded().
```

**Done when:** a test creates the keystore and prints only the address, loads it again with the password, and the config file has mode 600.

### Step 2.9: Commands init, onboard, rebalance, status

**Prompt for Claude Code:**

```text
Do step 2.9 only. Implement in src/cli.ts, src/vault.ts, src/rebalance.ts, src/report.ts
and src/index.ts:
- init [--api-url <url>]: create the keystore if missing, save api_url, print the
  trading address and the next command.
- onboard --name <name> --manager <manager_name> --invite <onboarding_key>
  [--description <text>]: POST /v1/strategies with trader_address = keystore address.
  Save the sdk_config fields and manager_api_key to the config. Print the vault address,
  the Basescan link, and "Next: the distributor funds the vault".
- rebalance --weights <SYMBOL=PCT,...> [--yes]: weights must sum to 100 and use only
  config assets (missing ones = 0). Algorithm: read holdings in USD (price source from
  docs/spike-results.md); target_i = total * w_i / 100; delta_i = target_i - value_i;
  ignore |delta_i| < 0.50 USD; first sell overweight non-USDC assets to USDC, then buy
  underweight non-USDC assets with USDC; stop with a clear message if one trade is
  above max_order_usd. Trades go through the SDK with KyberSwap and slippage_bps.
  Print a before/after table. Ask for confirmation unless --yes.
- After each successful trade, report.ts sends POST /v1/strategies/{id}/trades with
  Authorization: Bearer <manager_api_key> and body {tx_hash, signal: {weights,
  created_at}}. On failure: retry 2 times, then print a warning that the trade is valid
  on-chain but not recorded.
- status: holdings, weights, share price and total value from the chain, and the last
  5 trades from GET /v1/strategies/{id}/trades.
- src/index.ts exports rebalance({weights, config, signer}) and getStatus({config}) and
  the Signer type. The CLI calls these same functions.
All chain reads and trades use the trading key's SDK client. No HODL API call is
needed to trade.
```

**Done when:**

1. `npx github:<org>/hodl-agent init --api-url <HODL_API_URL>`
2. `npx github:<org>/hodl-agent onboard --name "Day2 Test" --manager "HODL Test" --invite <ONBOARDING_API_KEY>`
3. In hodl-api: `npx tsx scripts/spike/03-deposit.ts --vault <new vault address>`
4. `npx github:<org>/hodl-agent rebalance --weights cbBTC=50,WETH=50`
5. `npx github:<org>/hodl-agent status` shows about 50/50, and the trades appear in `GET /v1/strategies/{id}/trades`.

### Step 2.10: listen (automated signals) and README

**Goal:** the asset manager's existing system sends target weights, and the vault trades with no person involved.

**Prompt for Claude Code:**

```text
Do step 2.10 only.
- src/listen.ts and the command listen [--port 8787]: requires HODL_AGENT_PASSWORD and
  HODL_SIGNAL_SECRET. Load the keystore once. Start a Node built-in http server bound to
  127.0.0.1 only (no web framework).
  POST /signal: header x-signal-secret must equal HODL_SIGNAL_SECRET (else 401); body
  {"weights": {"cbBTC": 50, "WETH": 50}} validated with the rebalance rules (else 400).
  Respond 202 {signal_id} at once, then run rebalance() without prompts.
  Run one signal at a time. If signals arrive while one runs, keep only the newest and
  run it next.
  GET /health: {status, last_signal_at, last_result}.
  Log each signal, its trades and the Basescan links.
- examples/signal-loop.sh: bash. Sends POST /signal with curl, alternating
  {"weights":{"cbBTC":60,"WETH":40}} and {"weights":{"cbBTC":40,"WETH":60}}, then sleeps
  INTERVAL_SECONDS (default 900). Reads HODL_SIGNAL_SECRET and PORT (default 8787).
  This script stands in for the asset manager's strategy system.
- README.md: what the agent does; safety facts (the key is created and encrypted on this
  machine, the trader role cannot withdraw, max order size); quick start (init, onboard,
  listen, signal-loop); how a fund connects its existing system (send POST /signal with
  target weights, or call rebalance() from code); a 10-line library example.
Push to GitHub.
```

**Done when:** with `listen` running and `INTERVAL_SECONDS=120 ./examples/signal-loop.sh`, three signals in a row each produce trades in `GET /v1/strategies/{id}/trades`, with no person typing. A signal with a wrong secret returns 401.

## 9. Day 3: distribution API, docs, deploy and rehearsal

Day 3 lets a neobank list products, buy and sell shares for its users, and see each user's position. HODL only prepares transactions; the neobank's omnibus wallet signs and sends them. All work is in `hodl-api`.

### Step 3.1: Day 3 adapter methods

**Prompt for Claude Code:**

```text
Read sections 1, 2 and 6.5. Do step 3.1 only. In src/vault/ChamberAdapter.ts implement:
- prepareDeposit(vault, from, amountUsdc): if the USDC allowance from "from" to the vault
  is below the amount, first an approve transaction; then the deposit transaction.
  Encode with the ABI functions from docs/spike-results.md. Give each a plain
  description ("Approve 10 USDC", "Deposit 10 USDC into hDEMO").
- prepareWithdraw(vault, from, sharesWei): one transaction: the vault's standard
  withdraw (the call that the SDK's vault.withdraw sends). It burns the shares and pays
  the holder a pro-rata basket of the vault's assets (USDC, WETH and cbBTC in their
  current weights).
- getSharesDelta(vault, txHash, holder): from the receipt's vault-share Transfer events,
  shares minted to the holder (positive) or burned from the holder (negative).
- getAssetsReceived(txHash, holder): from the receipt's ERC20 Transfer events to the
  holder, a list of {symbol, amount} for USDC, WETH and cbBTC.
- getRemainingCooldownSeconds(vault, address): from the function found in step 1.2.
Add scripts/check-day3-adapter.ts that prints prepareDeposit for 1 USDC (no sending)
and the omnibus cooldown on the Day 1 vault.
```

**Done when:** the check script prints two unsigned transactions with descriptions and a cooldown value (0 if the Day 1 deposit is older than 24 hours).

### Step 3.2: Products (public catalogue)

**Prompt for Claude Code:**

```text
Do step 3.2 only. In src/routes/products.ts add (no auth):
- GET /v1/products: one entry per strategy: {product_id, name, symbol, manager_name,
  description, chain_id, vault_address, deposit_asset ("USDC"), share_price_usd,
  total_value_usd, lockup_hours (24), explorer_url}.
- GET /v1/products/{id}: the same fields plus holdings [{symbol, weight_pct, value_usd}],
  trades_count and last_trade_at.
```

**Done when:** `GET /v1/products` lists the product from step 2.4 with a live share price.

### Step 3.3: Orders and positions

**Prompt for Claude Code:**

```text
Do step 3.3 only. In src/routes/orders.ts add (role: distributor; the distributor's
wallet is OMNIBUS_ADDRESS):
- POST /v1/orders. Body: {product_id, side: "buy"|"sell", amount_usdc (buy only,
  positive decimal string), shares (sell only, decimal string or "all"),
  client_reference (1-64 chars)}.
  buy: prepareDeposit(vault, OMNIBUS_ADDRESS, amount_usdc).
  sell: shares must be <= the client's shares (sum of shares_delta_wei of the client's
  completed orders for this product); if getRemainingCooldownSeconds for OMNIBUS_ADDRESS
  > 0, return 409 {error: {code: "lockup_active", message, unlock_at}}; else
  prepareWithdraw.
  Save the Order (status prepared) and return 201 {order_id, status, side, product_id,
  client_reference, transactions: UnsignedTx[]}.
- POST /v1/orders/{id}/executions. Body: {tx_hashes: string[]} in the same order as the
  transactions. For each: receipt success, from == OMNIBUS_ADDRESS, to == the prepared
  "to". Then getSharesDelta on the deposit or withdraw transaction and set the order
  completed with shares_delta_wei. For a sell, also return assets_received (from
  getAssetsReceived); do not save it. Any check fails -> order failed, 422 with the
  reason. A completed order returns its saved result on repeat calls.
- GET /v1/orders/{id}: the order with status, transactions, tx_hashes, shares_delta.
- GET /v1/positions (role: distributor), optional query client_reference and
  product_id: per (product, client): {product_id, client_reference, shares (sum of
  completed orders), share_price_usd, value_usd}.
```

**Done when:** in Swagger, a buy order for 1 USDC returns an approve and a deposit transaction (not sent yet), and `GET /v1/positions` returns an empty list.

### Step 3.4: Demo neobank script

**Prompt for Claude Code:**

```text
Do step 3.4 only. Create scripts/demo-neobank.ts (founder's laptop only), using
HODL_API_URL, DISTRIBUTOR_API_KEY and OMNIBUS_PRIVATE_KEY from .env. Commands:
- products: GET /v1/products as a table.
- buy --product <id> --amount <usdc> --client <ref>
- sell --product <id> (--shares <n> | --all) --client <ref>
- positions [--client <ref>]
buy and sell: POST /v1/orders -> print each transaction description -> confirm (y/N)
-> sign and send each transaction in order with the omnibus wallet, waiting for each
receipt -> POST /v1/orders/{id}/executions -> print shares change, assets received
(sell: USDC, WETH and cbBTC amounts), new position and Basescan links.
The script never calls the vault directly; it only signs what the API returns.
```

**Done when:** `buy` of 2 USDC for client `test-user-1` on the step 2.4 product completes, and `positions --client test-user-1` shows the shares.

### Step 3.5: Docs, final deploy and Postman

**Prompt for Claude Code:**

```text
Do step 3.5 only. Add to every endpoint: a summary, a description, request and response
examples, and one tag (Onboarding, Trades, Products, Orders). Add a Bearer security
scheme. Push to GitHub so Railway redeploys.
```

**Founder does:** in Postman, Import → Link → `<HODL_API_URL>/openapi.json`. Create the environment "HODL Demo" with `base_url`, `onboarding_key`, `distributor_key`, `manager_key`, `strategy_id`, `product_id`, `order_id`.

**Done when:** `/docs` on Railway shows the examples, and `GET /health` and `GET /v1/products` work from Postman.

### Step 3.6: Pre-demo setup (at least 24 hours before the demo)

**Founder does (Claude Code helps with the commands):**

1. On the laptop, with the founder's own agent key: `init` (if not done), then `onboard --name "HODL Demo Fund" --manager "HODL Markets" --invite <ONBOARDING_API_KEY>`. Save the product ID.
2. Send about $10 of ETH on Base to the fund's trading address. At one signal every 15 minutes, gas costs about $2–6 per day (step 1.6 shows the real cost per swap); at one signal every 60 minutes, about a quarter of that.
3. In hodl-api: `npx tsx scripts/demo-neobank.ts buy --product <id> --amount 20 --client demo-user-1`
4. Terminal 1: type the keystore password with `read -s HODL_AGENT_PASSWORD`, then `export HODL_AGENT_PASSWORD HODL_SIGNAL_SECRET=<secret>`, then `caffeinate -i npx github:<org>/hodl-agent listen`.
5. Terminal 2, in a clone of hodl-agent: `HODL_SIGNAL_SECRET=<secret> ./examples/signal-loop.sh`. Leave both running until the demo.
6. Record the product ID, the vault address and the deposit time in `docs/demo-notes.md`.

**Done when:** `positions --client demo-user-1` shows shares, `GET /v1/strategies/{id}/trades` shows a new trade about every 15 minutes, and the deposit is more than 24 hours old at the demo start.

### Step 3.7: Rehearsal

**Founder does:** create a new macOS user account (System Settings → Users & Groups) to act as the VC's clean laptop. Run the runbook in section 11 two times. Note the time of each step.

**Prompt for Claude Code (only if a rehearsal step fails):**

```text
Step <n> of the runbook failed with this output: <paste output, no keys>.
Fix only this defect. Do not change anything else.
```

**Done when:** two complete runs succeed without errors.

## 10. Day 4 (optional): minimal front-end

Do Day 4 only when the founder asks for it, after Day 3 passes. The front-end is read-only: it shows the public product catalogue. It has no wallet connection, no forms and no API keys.

### Step 4.1: Scaffold and CORS

**Prompt for Claude Code (in hodl-api):**

```text
Do step 4.1 only. Create a web/ folder with a Vite + React + TypeScript app (no UI
library). Read the API base URL from VITE_HODL_API_URL. In src/server.ts allow CORS
for GET requests from the Netlify domain (from env WEB_ORIGIN) and from
http://localhost:5173. No other API changes.
```

**Done when:** `npm run dev` in `web/` shows a blank page that loads `GET /v1/products` without a CORS error.

### Step 4.2: Two pages

**Prompt for Claude Code:**

```text
Do step 4.2 only. Build two pages with plain CSS:
- Catalogue (/): one card per product from GET /v1/products: name, manager,
  share price, total value, lockup, link to the vault on Basescan.
- Product (/products/:id): GET /v1/products/{id}: the same fields, holdings with
  weight bars, trades_count and last_trade_at.
Show a loading state and a clear error message. Refresh the data every 30 seconds.
```

**Done when:** both pages show live data from the Railway API.

### Step 4.3: Deploy to Netlify

**Founder does:** follow Claude Code's click-by-click steps: new Netlify site from the `hodl-api` GitHub repo, base directory `web`, build command `npm run build`, publish directory `web/dist`, environment variable `VITE_HODL_API_URL`. Then set `WEB_ORIGIN` on Railway to the Netlify URL.

**Done when:** the Netlify URL shows the catalogue with live data.

## 11. VC demo runbook

The demo takes about 15 minutes and shows the full pipeline live on Base mainnet.

**One day before**

- [ ] Step 3.6 is done, and the `demo-user-1` deposit is more than 24 hours old.
- [ ] Send the VC the requirement: Node.js 20 LTS installed on their Mac. Fallback: the clean macOS user account on the founder's laptop.

**30 minutes before**

- [ ] In Postman, `GET /health` and `GET /v1/products` work, and the latest HODL Demo Fund trade is less than 20 minutes old.
- [ ] HODL Admin holds at least 0.003 ETH. Neobank Omnibus holds at least 15 USDC and some ETH.
- [ ] Postman environment "HODL Demo" is filled in. Basescan is open in a browser tab.
- [ ] Terminal open in `hodl-api` for the demo neobank script.

**Live steps**

| # | Who | Command or action | What the VC sees |
| --- | --- | --- | --- |
| 1 | VC | `npx github:<org>/hodl-agent init --api-url <HODL_API_URL>` | A trading key is created and encrypted on their own laptop; only the address is shown |
| 2 | VC | `npx github:<org>/hodl-agent onboard --name "<VC> Test Fund" --manager "<VC name>" --invite <ONBOARDING_API_KEY>` | A new vault on Base, with their address as the only trader (Basescan link) |
| 3 | Founder (as neobank) | `npx tsx scripts/demo-neobank.ts buy --product <new product id> --amount 10 --client vc-user-1` | The neobank signs the deposit; the vault mints shares to the omnibus wallet |
| 4 | VC | `read -s HODL_AGENT_PASSWORD; export HODL_AGENT_PASSWORD HODL_SIGNAL_SECRET=<secret>`, then `npx github:<org>/hodl-agent listen` | The agent unlocks the key once and waits for signals on their laptop |
| 5 | VC | `curl -X POST http://127.0.0.1:8787/signal -H "x-signal-secret: $HODL_SIGNAL_SECRET" -d '{"weights":{"cbBTC":50,"WETH":50}}'` | The vault trades with no further input: two swaps signed by their key (Basescan: from = VC key, to = vault) |
| 6 | VC | `npx github:<org>/hodl-agent status` | Holdings near 50/50, share price, the recorded trades |
| 7 | Founder (as neobank) | `npx tsx scripts/demo-neobank.ts sell --product <HODL Demo Fund id> --shares <half> --client demo-user-1` | The vault contract pays the withdrawal as a pro-rata basket of USDC, WETH and cbBTC; the client's position updates |
| 8 | Founder | Postman: `GET /v1/products`, then `GET /v1/strategies/{HODL Demo Fund id}/trades` | The VC's product in the catalogue; the HODL Demo Fund trades about every 15 minutes since setup, each from a signal with no person involved |

**Three points to say during the demo**

1. The trades came from signals with no person in the loop; the trading key never left the VC's laptop, and it cannot withdraw.
2. The vault contract executed every trade and paid the withdrawal; HODL only created the vault, prepared the neobank's transactions and recorded the results.
3. The neobank signed its own deposits and withdrawals; HODL held no funds at any point.

**After the demo**

- [ ] Change ONBOARDING\_API\_KEY on Railway, because the VC used the old one.
- [ ] Record the VC's vault address in `docs/demo-notes.md`.

## 12. Fallbacks and troubleshooting

Use these fallbacks in this order. Do not invent other solutions; if none applies, stop and ask the founder.

**Planned fallbacks (from the Day 1 checks)**

| Problem | Fallback | Code change |
| --- | --- | --- |
| cbBTC is not an enabled asset on Chamber Base | Use USDC and WETH only | Remove cbBTC from the 6.4 constants and from the asset lists |
| Vault creation from a script fails | HODL Admin creates each vault in the Chamber app | Add optional `vault_address` to `POST /v1/strategies`: when present, skip `createVault` and check that HODL Admin is the vault's manager |
| `setTrader` from a script fails | Set the trader in the Chamber app (trader delegation) | Same optional `vault_address` path; skip `setTrader` and check the trader on-chain |
| KyberSwap trade fails | 1. Retry with slippage 200 bps. 2. Odos (needs a free API key). 3. 1inch (needs an API key) | Add a `dapp` setting to the agent config; API keys only on the asset manager's machine |

**Troubleshooting**

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `insufficient funds for gas` | Wallet ETH too low | Send ETH on Base to that wallet. A trading key that receives a signal every 15 minutes uses about $2–6 of ETH per day |
| `409 lockup_active` on a sell | Deposit is less than 24 hours old | Wait until `unlock_at`, or sell from the older `demo-user-1` position |
| `listen` stops trading | The Mac slept or the terminal closed | Run `listen` with `caffeinate -i`; restart `listen` and the signal loop |
| A signal returns 401 | Wrong or missing `x-signal-secret` | Use the same `HODL_SIGNAL_SECRET` in `listen` and in the sender |
| Agent warns "trade not recorded" | HODL API not reachable | The trade is valid on-chain; HODL records the next trades when the API is back |
| `npx github:...` fails on the VC's laptop | Node.js missing or older than 20 | Install Node.js 20 LTS; fallback: the clean macOS user account on the founder's laptop |
| Agent errors with RPC rate limits | Public Base RPC is busy | Set `HODL_RPC_URL` to a private Base RPC on that machine |
| Railway deploy fails before the demo | Build or env var problem | Run the API locally (`npm run dev`) and use `--api-url http://localhost:3000` on the founder's laptop |
| Share price is 0 | The vault has no deposits | Run a neobank `buy` first |
