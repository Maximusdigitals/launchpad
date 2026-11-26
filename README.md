# Holdpad (placeholder name) — a hold-to-earn meme coin launchpad · TESTNET ONLY

**Paper hands pay. Diamond hands get paid.** Every coin trades on a pump-style bonding curve. Sell before your lock ends and you forfeit your profit plus a penalty; that ETH streams to the people still holding, weighted toward whoever has held longest.

> ⚠️ Testnet only (Base Sepolia, chain 84532). Unaudited. Not for real money.

Live site: https://maximusdigitals.github.io/launchpad/

## Rename it
The product name lives in one place: [`web/src/brand.js`](web/src/brand.js) (`name`, `wordmark`, `tickerPrefix`, hero copy, URL). Contracts are name-neutral (`LaunchFactory`, `LaunchCoin`, `LaunchLens`, `CoinDeployer`) and store no product name. Rebuild with `cd web && OUT=../docs node build.mjs`.

## Contracts (`contracts/`, Solidity 0.8.26 + Foundry)
| contract | role |
|---|---|
| `LaunchFactory` | permissionless `createCoin(params, image, description)` (+ optional opening buy). Registry of coins. No owner. |
| `CoinDeployer` | holds the coin creation code (keeps the factory < 24 KB). Callable only by the factory fixed at deploy. |
| `LaunchCoin` | ERC20 + bonding curve + locks + penalties + reward stream + graduation. Immutable rules, no admin. |
| `LaunchLens` | read-only batch views for the frontend. |

### Launch parameters (set once by the creator, immutable)
| param | bounds | UI default |
|---|---|---|
| `lockDuration` L | 60 s – 7 days | 1 h |
| creator lock | always 2L | 2 h |
| `penaltyBps` | 100 – 5000 (1–50%) | 1000 (10%) |
| `steepness` p | 1, 2, 3 | 2 |
| `snipeWindow` | 0 – 3600 s | 300 s |
| `snipeMaxBuy` | ≥ 0.00001 ETH | 0.001 ETH |
| name / symbol | 1–32 / 1–10 bytes | |

Factory constants (immutable at factory deploy): virtual ETH reserve `VETH0` (0.02 ETH on testnet → the curve sells out at ≈0.0586 ETH raised), Uniswap V2 factory + WETH addresses. Coin constants: 1B supply, 793.1M sold on the curve, 1.073B virtual token reserve, 30-minute reward stream.

### Rules enforced on-chain
1. **Curve.** Constant product on virtual reserves, ETH in/out, rounding always in the curve's favour, no fees.
2. **Holder lock.** Every buy sets `lockEnd = max(lockEnd, now + L)` for the wallet's whole bag (top-ups re-lock everything).
3. **Early sell** (`now < lockEnd`): seller receives `max(0, min(value, basis) − penalty% × basis)` where `basis` is the cost basis of the tokens sold (pro-rata). `value − received` is forfeited to the reward stream.
4. **Creator.** Creator buys (including the opening buy) lock for 2L and `sell` reverts (`DevLocked`) before then; transfers revert too. The creator is excluded from rewards.
5. **Transfers.** Wallet-to-wallet transfers **revert while the sender is locked** (`TransferLocked`). Cost basis moves pro-rata with post-lock transfers; the receiver's tokens start a fresh hold clock. Transfers to the coin contract always revert; transfers into the DEX pair revert before graduation (nobody can seed/front-run the pool).
6. **Anti-sniper.** During `snipeWindow` after launch each wallet's cumulative buys are capped at `snipeMaxBuy` (creator included).
7. **Graduation.** When the 793.1M curve tokens are sold the curve is `completed`: buys revert forever (`CurveClosed`), sells still work (with the same lock rules). `graduate()` (anyone) works only once `now ≥ maxLockEnd` — the latest lock ever set, creator's 2L included. It wraps the curve ETH to WETH, adds it with tokens at the final curve price to the Uniswap V2 pair created at launch, burns the LP to `0xdead`, burns leftover supply. WETH donations to the pair can't brick it (mint uses balances, not reserves).

### Payout formula (exact)
Forfeits are added to a stream released linearly over 30 minutes (a new forfeit re-spreads what's left over a fresh 30 min). Every slice `R` released at time `t` is split among eligible holders (everyone except the creator, the coin, the pair, `0x0`, `0xdead`):

    share_i = b_i · (t − h_i)^p  /  Σ_j b_j · (t − h_j)^p

* `b_i` balance, `p` the creator's steepness, `h_i` the wallet's **amount-weighted entry time** (`h ← (b·h + Δ·now)/(b+Δ)` on every buy/receive, unchanged on sells). Buying dust early then topping up big doesn't inherit the old clock.
* Weight is linear in `b`, so splitting one bag across N wallets earns exactly the same as one wallet; ranking is by time held, and `p` sets how steeply the longest holders win (p=1 linear, 2 quadratic, 3 cubic).
* O(1) gas: the contract keeps power sums `M_k = Σ b·h^k` (k ≤ p), computes `D(t) = Σ_k C(p,k)(−t)^{p−k}…` by binomial expansion, and accumulators `acc_k += R·C(p,k)(−1)^k·t^{p−k}/D`. A wallet's pending reward is `b · Σ_k h^k · (acc_k − snapshot_k)`, settled on every balance change; holders pull with `claim()`. `pendingRewards()` includes the part of the stream that has dripped since the last transaction, so the UI ticks every second.
* Rounding is always in the pool's favour; claims are capped by `rewardReserve` (invariant-tested: total pending ≤ reserve). If nobody eligible holds, the stream pauses instead of releasing into the void.

### Tests
`cd contracts && forge test` → 39 unit/fuzz tests + 5 invariants (256 runs × depth 64): buy/sell round trip, slippage, early-sell math in profit/at loss/partial/custom penalty, lock boundary, top-up relock, creator can't sell/transfer before 2L, creator earns nothing, **transfer dodge** (transfer + transferFrom revert while locked), basis/clock on post-lock transfers, **self-transfer weight inflation** (found by the invariant fuzzer, fixed), tokens to the coin/pair revert, sniper cap incl. creator, rewards tick without txs, longer holders earn more per token, steepness ordering, **wallet splitting earns nothing extra**, dust-then-top-up, exact formula vs brute force, paused stream, completion/refund, graduation waits for every lock incl. creator, sells after completion, WETH-donation griefing, rewards after graduation, **reentrancy** on sell/claim/buy-refund, solvency fuzz; invariants: solvency, curve accounting, weights consistent, never over-promise rewards, creator never earns.

## Indexer + frontend
* `web/src/core.js` — chain reader shared by the browser and the Node indexer: factory `CoinCreated`, coin `Trade`/`Transfer` events (chunked `getLogs` that adapts to RPC limits), Lens batch reads, holder ranking, candles.
* `indexer/index.mjs` — `node indexer/index.mjs --chain 84532 [--watch 15]` writes a JSON snapshot (coins, trades, ranked holders with pending rewards, reward pools).
* `web/` — vanilla JS + viem + TradingView lightweight-charts, bundled with esbuild, static on GitHub Pages. Injected wallets via EIP-6963 (MetaMask, Rabby, Coinbase, Phantom…), forced to Base Sepolia (`wallet_switchEthereumChain` / `wallet_addEthereumChain`). Until the Base Sepolia deployment exists the site runs in **preview mode** (a snapshot of a real local run of these contracts). `?net=local` points at a local anvil.

## Run locally
```bash
anvil --block-time 1 &
cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --private-key <anvil test key> --broadcast
cd ../web && npm i && node scripts/seed.mjs && node build.mjs && (cd site && python3 -m http.server 8097)
# open http://localhost:8097/?net=local
```

## Deploy to Base Sepolia
Fund the throwaway deployer (address in the report; key in gitignored `.secrets/`) with ~0.01 Base Sepolia ETH, then `scripts/deploy-base-sepolia.sh` (refuses any chain other than 84532, verifies on Blockscout). Rebuild the site; it switches from preview to live automatically when `deployments/84532.json` has a factory.

## Known limits / before any mainnet
* **Unaudited.** Needs a professional audit, a formal review of the reward math precision (fixed-point with cancellation; error grows with holding time³ for p=3 over years), and gas profiling.
* Sybil: the sniper cap is per wallet; many wallets bypass it. A creator can also buy from a second wallet to dodge the 2L lock and the reward exclusion (only the launch wallet is bound).
* Top-ups re-lock the whole bag (simple and anti-gaming, but some users will find it harsh).
* Holder lists in the UI come from events via the public RPC; very busy coins will need a hosted indexer.
* Graduation depends on Uniswap V2 being deployed on the chain; if the curve never sells out, the coin stays on the curve forever.
* Legal: penalties redistributed to holders can look like a yield/security mechanism in some jurisdictions; get legal advice before real money.
