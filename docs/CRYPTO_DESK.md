# Tape crypto desk

Tape is the default application in this fork. It is a local React workspace with a Node market-data service. The original Fincept C++/Qt tree remains in `fincept-qt/` for provenance and further integration; it has not been converted or rebuilt. Its original README is retained in `docs/UPSTREAM_README.md`.

## Market coverage

| Venue      | Public spot | Public perpetuals | Historical taker CVD             |
| ---------- | ----------- | ----------------- | -------------------------------- |
| Binance    | Yes         | USDT linear       | Public spot and perpetual klines |
| OKX        | Yes         | USDT linear       | Public contract taker volume     |
| Bybit      | Yes         | USDT linear       | Compatible CoinGlass plan/key    |
| Coinbase   | Yes         | Not connected     | Provider coverage required       |
| Kraken     | Yes         | Not connected     | Provider coverage required       |
| Gate       | Yes         | CCXT linear swaps | Provider coverage required       |
| Bitget     | Yes         | CCXT linear swaps | Provider coverage required       |
| Bitstamp   | Yes         | Not connected     | Provider coverage required       |
| MEXC       | Yes         | CCXT linear swaps | Provider coverage required       |
| Crypto.com | Yes         | Not connected     | Provider coverage required       |
| KuCoin     | Yes         | CCXT linear swaps | Provider coverage required       |
| HTX        | Yes         | CCXT linear swaps | Provider coverage required       |

All twelve public spot adapters were checked against real market, candle, recent-trade, and WebSocket book/trade responses during development. Perpetual listings and ancillary fields vary by venue; supporting an adapter does not guarantee that every symbol, region or dataset is available. Missing OI, funding intervals and historical datasets stay unavailable. Ordinary OHLCV is never used to invent taker delta.

Dollar quotes are shown as their actual currency: USD, USDT or USDC. Approximate quote turnover calculated from base volume × last price is marked `~`. The turnover summary sums USDT markets only. Provider-classified stock, ETF, FX and commodity contracts are excluded from the crypto catalogues and Bybit order validation. Contract-count quantities are converted to base units using each instrument's contract size before book/trade analytics.

## Historical and live order flow

Historical is the default order-flow view. Choose a source, 6h/24h/7d/30d lookback and optional UTC end date. CVD is rebased at the first returned bar, rather than presented as an absolute lifetime balance. The last open bar is marked partial; gaps are counted and no missing volume is interpolated.

- Binance: taker buys are the exchange kline's taker-buy quote volume; sells are total quote volume minus buys. Uses authenticated-free public spot and USD-M futures endpoints.
- OKX perpetuals: the contract taker-volume endpoint is requested with `unit=2` for quote notional, with paginated historical bars.
- Other historical sources: the CoinGlass adapter requests the selected venue and date range. A compatible key, plan, instrument and provider schema are necessary. Unsupported responses remain explicit errors.

The historical source and live venue are independently labelled. When the current venue has no public taker-history adapter, the initial historical source is Binance for the matching USDT symbol. This does not turn Binance history into another exchange's flow.

Live CVD sums unique taker buy notional minus taker sell notional. A connection gap starts a new session and discards cached pre-session trades. Timeframe changes preserve the trade session. Charts retain up to 30 minutes of live CVD points; the session total keeps accumulating. The tape retains 120 trades and duplicate detection is bounded to the latest 25,000 IDs.

The volume profile uses executed session trades. The liquidity heatmap records actual visible L2 orders, retains the latest three minutes, and does not reconstruct unobserved historical books. CoinGlass Model1 is a separately labelled historical **modelled liquidation** heatmap; it is not a historical order-book recording. Binance liquidation events are a sampled exchange feed. Other unconnected liquidation streams are not represented as zero activity.

Binance depth snapshots are buffered and bridged with the exchange's update IDs; a sequence gap triggers a fresh connection. OKX uses `prevSeqId/seqId`; its current deprecated checksum field is fixed at zero. Coinbase uses the public `level2_batch` channel and inverts maker-side match messages to obtain the taker side. The other venues use maintained CCXT Pro adapters; MEXC's protobuf decoder is included. KuCoin perpetual trade streams were inconsistent in combined live checks. That adapter uses capped public REST trade captures with a 2s target interval, an explicit sampling notice, and session resets when consecutive history windows lose overlap. Its book remains a separate live stream. These session totals are captured flow, not a guarantee of complete exchange flow.

## DEX research

DEX Screener supplies symbol/contract search, chain + pool identity, liquidity, FDV, market cap, transaction counts and discovery feeds. Recently profiled tokens are distinguished from newly created pools; boosts are labelled paid. Up to 50 saved pools are reloaded by their identities independently of the current discovery/search results.

GeckoTerminal supplies pool candles and recent swaps where indexed. GoPlus supplies partial EVM token checks. Missing checks are unknown, including networks outside that adapter. AMM pools use swaps and reserves; the app does not fabricate CEX books or CVD for them. Wallet signing, DEX swap execution, gas simulation, MEV protection and transaction settlement are not implemented. Pool and explorer links provide further inspection.

## Execution

Paper accounts start with 100,000 USDT, are stored in this browser and separate positions by exchange, category and symbol. Market fills walk the visible book, reject insufficient visible liquidity and stale/crossed quotes, and include a fixed 6 bps fee per fill. The account caps gross exposure at 1× equity. Opposite fills reduce or reverse perpetual positions; spot shorts are rejected. Marks are last observed venue quotes. Funding, latency, market impact and liquidation mechanics are not simulated. The latest 200 fills are retained and exportable as CSV; cash/realized accounting persists beyond that history limit. USD/USDC paper execution is disabled rather than silently converted to USDT.

The optional authenticated execution adapter is **Bybit only**, using Unified Trading Accounts. Public analysis on other exchanges does not imply authenticated routing on them. Supports market/limit orders, GTC/IOC/FOK/PostOnly, explicit hedge-mode position indexes, reduce-only and conditional perpetual orders, cancellations, wallet/position/order/fill reconciliation. Other exchanges' execution, DEX execution, leverage changes and automated strategies are outside this version.

Keys stay in the service's `.env`; they are never returned to the browser. Read access is separate from routing. Default network is testnet, routing defaults off, and mainnet requires an additional explicit environment opt-in. Use trade/read permissions without withdrawals. `MAX_ORDER_NOTIONAL_USDT` defaults to 1,000 and validates submission notional against current, limit and trigger reference prices; it is not a guarantee of conditional future fill value through gaps.

Unconditional market orders request the exchange's 0.50% slippage cap. Conditional orders do not claim that unsupported slippage cap. The adapter validates instrument activity, tick/lot precision with decimal integer arithmetic, minimum notional, fresh execution-network quotes and submission caps. It uses unique client order IDs, never retries mutations automatically and treats an ambiguous response as unknown. Reconcile account orders before retrying with the same client ID. An acknowledgement is not a fill; account state is populated only from exchange responses. Actual credentialed submission/fill/cancel behavior was **not** exercised during development, and should be verified on testnet before enabling mainnet.

## Risk, alerts and data health

The risk calculator sizes by entry-stop distance plus fees/slippage on both fills, rounded down to the instrument step. It is an estimate; funding, gaps and market impact can change actual loss. The calculation uses the displayed quote currency and editable equity.

Cross-venue comparison covers Bybit, OKX and Hyperliquid, normalizes known contract multipliers, labels USDT/USDC separately and shows actual funding intervals plus an 8h equivalent. It does not represent executable arbitrage or projected funding income.

Price-crossing alerts evaluate all armed exchange markets every 15 seconds while the browser is open, with provider caches generally 10–30 seconds. They fire once, pause on stale/missing data, and persist locally. They are browser-workspace alerts, not a background notification service after the browser closes.

The service binds exclusively to `127.0.0.1`. It checks Host and Origin, rate-limits requests, bounds payloads/sockets/caches, coalesces duplicate provider requests, retains original observation times for stale fallback data, and requires an explicit non-simple header and JSON content type for order mutations. This is a local application, not an authenticated internet-hosted service.

## Design and validation

The workspace uses a selected instrument, persistent watchlists, aligned numeric tables, visible feed status, keyboard market search, explicit source/coverage labels, and advanced controls revealed when requested. It deliberately avoids generated signals, decorative dashboard cards and invented data. Native dialogs provide keyboard focus management; narrow screens retain internal table scrolling and stack dense book panels.

`npm run check` runs TypeScript with strict/unused checks, the production build and integrity tests. Tests cover book snapshots/sequence/checksum changes, CVD deduplication/reconnect boundaries, historical rebasing/gaps, tiny prices, contract conversion, paper depth/fees/netting/exposure, risk sizing, one-shot alerts, signing, exact decimal precision, routing opt-ins, mutation guards and missing-key errors. Public network probes are separate so CI remains deterministic:

```sh
node scripts/probe-venues.mjs
node scripts/probe-streams.mjs
node scripts/probe-streams.mjs --linear
```

## Primary references

- [Binance public market-data schema](https://developers.binance.info/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) and [depth continuity](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly).
- [OKX API documentation](https://www.okx.com/docs-v5/en/): contract taker-volume `unit=2`, book sequencing and deprecated checksum behavior.
- [Coinbase public batch book and match channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels).
- [Bybit taker trades](https://bybit-exchange.github.io/docs/v5/websocket/public/trade), [liquidations](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation), [order submission](https://bybit-exchange.github.io/docs/v5/order/create-order), and [authentication](https://bybit-exchange.github.io/docs/v5/guide).
- [DEX Screener API](https://docs.dexscreener.com/api/reference), [GeckoTerminal](https://api.geckoterminal.com/docs/index.html), [GoPlus](https://docs.gopluslabs.io/reference/tokensecurityusingget_1), [CoinGlass CVD](https://docs.coinglass.com/reference/futures-cvd-history), [CoinGlass heatmap](https://docs.coinglass.com/reference/liquidation-heatmap), [CCXT](https://docs.ccxt.com/) and [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/docs).
- Nielsen Norman Group's [data-table tasks](https://www.nngroup.com/articles/data-tables/) and [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) informed the information hierarchy and controls. The design choices here are an application of those principles, not a claim of measured perfect usability.
