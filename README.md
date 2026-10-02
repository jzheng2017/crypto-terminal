# Tape — crypto terminal

A crypto-only market and order-flow workspace, forked from [FinceptTerminal](https://github.com/Fincept-Corporation/FinceptTerminal).

Live public books and trades on **12 exchanges**, historical taker CVD, derivatives context, DEX discovery and pool inspection, risk sizing, price alerts, paper trading and an optional Bybit account/execution adapter.

## Run locally

Requires Node.js **22.12+** (Node 24 is also supported).

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:8787**. Public market feeds need no account or API key.

For development, run `npm run dev` and open http://127.0.0.1:5173. The bundled market service still runs on port 8787.

## What works

- **Markets and live desk:** Binance, Bybit, OKX, Coinbase, Kraken, Gate, Bitget, Bitstamp, MEXC, Crypto.com, KuCoin and HTX. Spot on all; connected perpetual coverage varies. Venue/type selection, search, persistent watchlists, candles, L2 book, trade tape, CVD, resting-liquidity heatmap and session volume profile.
- **Historical flow:** public taker-volume history on Binance spot/perpetuals and OKX perpetuals; 6h, 24h, 7d or 30d lookbacks and past UTC end dates. Source is explicit and independent of the live desk. Other compatible venue history and modelled liquidation heatmaps use your CoinGlass key/plan.
- **DEX research:** token-contract search, chain/pool identity, liquidity and volume filters, paid-boost labels, saved pools, pool candles, recent swaps and partial EVM contract checks. Provider coverage and missing fields are visible.
- **Risk and trading workflow:** loss-budget position sizing, three-venue funding comparison, price-crossing alerts, a persistent USDT paper account and CSV journal. Optional Bybit Unified Account reconciliation and market/limit/conditional/reduce-only order routing.

Historical CVD uses real taker volumes. Price candles without taker-volume fields are not turned into invented delta. Order-book heatmap history starts when you open a live market; historical liquidation models are separately labelled.

## Optional connections

Copy `.env.example` to `.env`. Add `COINGLASS_API_KEY` for compatible historical datasets; plan entitlements and instrument coverage apply.

Bybit account keys are separate. The execution adapter defaults to **testnet** and **disabled routing**. It requires explicit environment opt-ins and uses a 1,000 USDT submission cap by default. Keys stay in the local service. Actual authenticated fills/cancellations have not been validated with account credentials; verify on testnet before enabling mainnet. Authenticated execution on the other 11 exchanges and wallet/DEX swap execution are not implemented.

## Validate

```sh
npm run check
node scripts/probe-venues.mjs
node scripts/probe-streams.mjs
```

The probes use public network data; the unit/integration checks are deterministic and do not submit exchange orders.

Read [coverage, accounting, data semantics, setup and limitations](docs/CRYPTO_DESK.md) before using the execution adapter. Keyboard shortcuts: **Ctrl/Cmd K** search, **1–5** workspaces, **?** guide.

## Upstream and licence

This fork preserves the upstream source history and **AGPL-3.0-or-later** [licence](LICENSE). Tape is the fork's default local browser application; the original C++/Qt application remains in `fincept-qt/` and was not rebuilt or converted. The [original upstream README](docs/UPSTREAM_README.md) is retained for reference. The new application uses its own Tape name and icon.

Charts use [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/); exchange normalization uses [CCXT](https://github.com/ccxt/ccxt). Their dependency licences remain applicable.
