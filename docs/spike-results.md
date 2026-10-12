# Spike results

## Step 1.2: Addresses, Chamber assets and SDK functions

Source: `@dhedge/v2-sdk` 2.2.6 in `node_modules/@dhedge/v2-sdk`. Paths below are relative to that folder.
Each signature is copied from the `.d.ts` file named; the implementation is in the matching `src/` file.

### SDK values and functions

| Item | Exact signature / value | Defined in |
| --- | --- | --- |
| Network for Base | `Network.BASE = "base"` | `dist/types.d.ts:9` (`src/types.ts:10`) |
| Dapp for KyberSwap | `Dapp.KYBERSWAP = "kyberswap"` | `dist/types.d.ts:36` (`src/types.ts:38`) |
| createPool | `Dhedge.createPool(managerName: string, poolName: string, symbol: string, supportedAssets: SupportedAsset[], performanceFeeNumerator?: number, managerFeeNumerator?: number, entryFeeNumerator?: number, exitFeeNumerator?: number, options?: any): Promise<Pool>` | `dist/entities/dhedge.d.ts:25` (`src/entities/dhedge.ts:43`) |
| loadPool | `Dhedge.loadPool(address: string, isDhedge?: boolean): Promise<Pool>` | `dist/entities/dhedge.d.ts:31` (`src/entities/dhedge.ts:98`) |
| setTrader | `Pool.setTrader(trader: string, options?: any, estimateGas?: boolean): Promise<any>` | `dist/entities/pool.d.ts:256` (`src/entities/pool.ts:1101`) |
| approve (for trading) | `Pool.approve(dapp: Dapp, asset: string, amount: BigNumber \| string, options?: any, sdkOptions?: SDKOptions): Promise<any>` | `dist/entities/pool.d.ts:55` (`src/entities/pool.ts:241`) |
| trade | `Pool.trade(dapp: Dapp, assetFrom: string, assetTo: string, amountIn: BigNumber \| string, slippage?: number, options?: any, sdkOptions?: SDKOptions): Promise<any>` | `dist/entities/pool.d.ts:107` (`src/entities/pool.ts:397`) |
| approveDeposit | `Pool.approveDeposit(asset: string, amount: BigNumber \| string, options?: any, estimateGas?: boolean): Promise<any>` | `dist/entities/pool.d.ts:28` (`src/entities/pool.ts:173`) |
| deposit | `Pool.deposit(asset: string, amount: string \| BigNumber, options?: any, estimateGas?: boolean): Promise<any>` | `dist/entities/pool.d.ts:37` (`src/entities/pool.ts:195`) |
| withdraw | `Pool.withdraw(fundTokenAmount: string \| BigNumber, options?: any, estimateGas?: boolean): Promise<any>` | `dist/entities/pool.d.ts:45` (`src/entities/pool.ts:215`) |
| getComposition | `Pool.getComposition(): Promise<FundComposition[]>`, where `FundComposition = { asset: string; isDeposit: boolean; balance: BigNumber; rate: BigNumber }` | `dist/entities/pool.d.ts:19`, type in `dist/types.d.ts` (`src/entities/pool.ts:146`) |

### Reads (not in SDK)

The SDK has no wrapper for these reads. A loaded `Pool` exposes both contracts as ethers `Contract` objects (`pool.poolLogic`, `pool.managerLogic`, `dist/entities/pool.d.ts:6-7`), so they are called directly on those.

| Read | SDK | Contract function (ABI file) | Call on |
| --- | --- | --- | --- |
| Share price | not in SDK | `tokenPrice() view returns (uint256 price)` (`src/abi/PoolLogic.json`) | `pool.poolLogic` |
| USD value of one holding | not in SDK | `assetValue(address asset) view returns (uint256)` (`src/abi/PoolManagerLogic.json`) | `pool.managerLogic` |
| USD value of the whole vault | not in SDK | `totalFundValue() view returns (uint256)` (`src/abi/PoolManagerLogic.json`) | `pool.managerLogic` |
| Remaining withdrawal cooldown of an address | not in SDK | `getExitRemainingCooldown(address _depositor) view returns (uint256 remaining)` (`src/abi/PoolLogic.json`) | `pool.poolLogic` |
| Trader address | not in SDK | `trader() view returns (address)` (`src/abi/PoolManagerLogic.json`) | `pool.managerLogic` |
| Manager address | not in SDK | `manager() view returns (address)` (`src/abi/PoolManagerLogic.json`) | `pool.managerLogic` |

### Notes for later steps

- **Fees:** `createPool` multiplies each fee argument by 100 before it calls `factory.createFund`, so fee arguments are in percent. All four fees default to `0` (`src/entities/dhedge.ts:48-51`).
- **Sends straight away:** `createPool` has no `estimateGas` option. It sends the transaction and waits for one confirmation. To estimate gas for `confirm()` in step 1.3, call `dhedge.factory.estimateGas.createFund(...)` with the same arguments (`src/entities/dhedge.ts:54`).
- **Base contract addresses** (`src/config.ts`): the factory is `0x49Afe3abCf66CF09Fab86cb1139D8811C8afe56F`, and the KyberSwap router is `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`. KyberSwap needs no API key.
- **Sending as trader:** create the `Dhedge` client with the trader wallet and use the default `sdkOptions`. The SDK then sends `pool.execTransaction`, which the vault accepts from its trader (verified in step 1.6). Do **not** set `useTraderAddressAsFrom`: it sends the call straight from the wallet to the router or token, so the wallet would swap its own tokens, not the vault's (`src/utils/contract.ts:175-196`). _(Corrected in step 1.6; the first version of this note said the opposite, following the README.)_
- **Withdraw restriction:** `withdraw` cannot be called by the trader account (README, section 8).
- **Gas estimates:** `approveDeposit` and `deposit` take `estimateGas: boolean` as the 4th argument; `withdraw` and `setTrader` take it as the 3rd. `approve` and `trade` take `sdkOptions` (`{ estimateGas: true }`).

### Founder checks

| Check | Result |
| --- | --- |
| `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on basescan.org | USD Coin ✅ |
| `0x4200000000000000000000000000000000000006` on basescan.org | Wrapped Ether ✅ |
| `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` on basescan.org | Coinbase Wrapped BTC ✅ |
| Chamber create-vault asset list on Base: USDC | Listed ✅ |
| Chamber create-vault asset list on Base: WETH | Listed ✅ |
| Chamber create-vault asset list on Base: cbBTC | Listed ✅ |

Checked by the founder on 2026-10-12. cbBTC is available, so the section 12 fallback (USDC and WETH only) is not needed.

## Step 1.3: First vault

| Field | Value |
| --- | --- |
| Vault address | `0xf1616330F6E7cb3a2B096f2F1C2d00520bF861B9` |
| Basescan | https://basescan.org/address/0xf1616330F6E7cb3a2B096f2F1C2d00520bF861B9 |
| Manager logic | `0x5E6Caa9aF06789702004E77A6f3d490DE634B2ff` |
| Manager | HODL Admin `0x7392F1C49c4683F08D29a5135c326B537aE99B79`, name "HODL Markets" |
| Name / symbol | HODL Demo BTC-ETH / hDEMO, public |
| Assets | USDC (deposit), WETH, cbBTC |
| Fees | performance, manager, entry, exit all 0 |
| Gas paid | about 0.0019 ETH |

All values above were read back from the chain after creation.

### Issues found

- **`createPool` crashed after the vault was created.** The creation transaction succeeded. Right after one confirmation, the SDK calls `poolManagerLogic()` on the new vault (`src/entities/dhedge.ts:76`). The RPC answered from a node that had not seen the new block yet, and returned `0x`, which gives a `CALL_EXCEPTION`. The script exited before it saved `.secrets/spike.json`, so the address was written by hand (section 12 fallback). For `createVault` in step 2.3: take the vault address from the `FundCreated` event in the receipt. Do not treat a failure after the transaction is sent as "no vault created".
- **Alchemy free tier** allows `eth_getLogs` over at most 10 blocks.
- **ethers v5 errors include the full RPC URL**, and the URL contains the Alchemy key. Scripts and the API must not print raw ethers errors from RPC calls.

## Step 1.4: Test trader key and trader role

| Field | Value |
| --- | --- |
| Test trader address | `0x937D4e28B46B86486E7c0C93d96d1b0a8daB8758` (keystore in `.secrets/test-trader.keystore.json`, mode 600) |
| Gas grant | 0.0005 ETH, tx https://basescan.org/tx/0xa5525457a98a7fa92f082dbbf7370095e6f98f57961c5bb0a0eed694869b265e |
| setTrader | tx https://basescan.org/tx/0x49016f504732c9270bb8df379649b154d8a7fc9cb57f20e609429fc5642adaef |
| Vault trader (read back) | `0x937D4e28B46B86486E7c0C93d96d1b0a8daB8758` |

Both transactions were sent from HODL Admin and succeeded. `setTrader` used about 69k gas.

### Issues found

- **The first password prompt echoed what was typed.** It silenced readline's internal `_writeToOutput`, which does not hide input in Node 22. It now uses stdin raw mode, and a test in a pseudo-terminal shows nothing echoed. For the agent (step 2.8), use `@clack/prompts` as the plan says, and test it the same way.

## Step 1.5: First deposit

| Field | Value |
| --- | --- |
| Approve tx (10 USDC, omnibus → vault) | https://basescan.org/tx/0x90463933ea4a5ca07dae8f52c53aa5271b7420fcdffc8ac2110abc169b4750af |
| Deposit tx | https://basescan.org/tx/0x08f64851e32e5559640a53644d7377b86a432a620dd7b60183ff7d5f0380f719 (block 52520852, about 575k gas) |
| Shares received | 9.9985217 hDEMO |
| Share price | $1.00 (`tokenPrice()`) |
| Vault holdings | 10.0 USDC, valued at $9.9985217 by the dHEDGE oracle (`assetValue`, `totalFundValue`) |
| Omnibus share balance | 9.9985217 (all shares) |
| Omnibus exit cooldown | 24 hours from the deposit (`getExitRemainingCooldown` returned 86366 s right after) |

All values were read back from the chain after the deposit.

### Issues found

- **Share price printed 0.0 on the first run.** `tokenPrice()` was read right after the receipt and hit an RPC node that had not seen the deposit block yet; a vault with no shares returns 0. The script now takes all results from the `Deposit` event in the receipt (`fundTokensReceived`, `totalInvestorFundTokens`, and `valueDeposited / fundTokensReceived` for the price). This is the same RPC lag as in step 1.3. Rule for later code: after a transaction, read its results from the receipt events, not from fresh `eth_call`s.
- **Deposit sets a 24-hour exit cooldown for the depositor.** Selling shares (Day 3) is blocked for 24 hours after each buy, as the plan expects (section 9, step 3.1).

## Step 1.6: First trade

All three transactions were sent by the test trader `0x937D4e28B46B86486E7c0C93d96d1b0a8daB8758` to the vault (`pool.execTransaction`), and all succeeded. Costs include Base's L1 data fee, and USD values use the dHEDGE oracle's ETH price.

| Transaction | Gas used | Cost |
| --- | --- | --- |
| [Approve 8 USDC for the KyberSwap router](https://basescan.org/tx/0x70ac388ad0a62b7f420232b73feb3f9b1ee39c55ddd9da60453db964452a50e0) | 199,352 | 0.0000012 ETH ($0.0030) |
| [Trade 4 USDC → cbBTC (KyberSwap, 1%)](https://basescan.org/tx/0xa90be6f3beb9bd61b981874451bed29293014c1d8effb65fa11f119e7b56a24f) | 677,886 | 0.0000041 ETH ($0.0102) |
| [Trade 4 USDC → WETH (KyberSwap, 1%)](https://basescan.org/tx/0x700c0e0b06cf9b604859d520c2ff020494daad6c2b5afe9022d8de8910d93671) | 551,977 | 0.0000033 ETH ($0.0083) |

Vault after the trades:

| Asset | Balance | Value |
| --- | --- | --- |
| USDC | 2.0 | $1.9997 |
| WETH | 0.001594412152145239 | $4.0018 |
| cbBTC | 0.00004859 | $4.0022 |
| Total | | $10.0037 |

The share price is $1.000523. The test trader has 0.00049 ETH left from its 0.0005 ETH grant.

### Issues found

- **ethers v5 overpaid gas about 250x.** Its default `getFeeData()` hard-codes a 1.5 gwei priority fee (`@ethersproject/abstract-provider`), while Base needs about 0.001 gwei. Steps 1.3 to 1.5 paid an effective 1.505 gwei, about 0.003 ETH in total. `src/chain/provider.ts` now overrides `getFeeData()` with the node's `eth_maxPriorityFeePerGas` and the latest base fee; step 1.6 paid about 0.006 gwei. **hodl-agent needs the same override**, or a 0.0005 ETH gas grant covers only about one trade.
- **At real Base prices, a trade costs about $0.01** (550k to 680k gas). A 0.0005 ETH grant covers roughly 100 trades.

## Decisions (Day 1)

| Check | Result | Decision |
| --- | --- | --- |
| Base chain ID from Alchemy RPC | 8453 | Keep Alchemy for hodl-api |
| Token addresses (USDC, WETH, cbBTC) | Names match on Basescan | Keep the 6.4 constants |
| cbBTC enabled on Chamber Base | Listed | Keep cbBTC (no USDC/WETH-only fallback) |
| SDK functions exist | All 11 in SDK; 6 reads via `poolLogic` / `managerLogic` ABI | Use the SDK plus direct contract reads, as listed in step 1.2 |
| Vault creation from a script | Vault created; the SDK crashed on a post-creation read (RPC lag) | Keep script creation. `createVault` takes the address from the `FundCreated` receipt event. No Chamber-app fallback needed |
| `setTrader` from a script | Worked | Keep script `setTrader` (no Chamber-app fallback) |
| Gas grant of 0.0005 ETH | Arrived; covers about 100 trades at real Base fees | Keep `GAS_GRANT_ETH=0.0005`; requires the fee override in both repos |
| Deposit from omnibus | 9.9985 shares at $1.00; 24-hour exit cooldown | As planned; sells are blocked for 24 hours after a buy |
| KyberSwap trades signed by the trader key | Both succeeded at 1% slippage | Keep KyberSwap, 1% (no 200 bps, Odos or 1inch fallback needed) |
| Reads right after a transaction | Sometimes stale (Alchemy load balancing) | Take post-transaction results from receipt events; do not trust an immediate `eth_call` |
| Raw ethers errors | Contain the RPC URL with the Alchemy key | Never print raw RPC errors in scripts, the API or the agent |
